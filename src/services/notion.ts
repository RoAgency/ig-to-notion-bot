import { Client } from '@notionhq/client';
import axios from 'axios';

/**
 * Linki do zdjęć z Instagrama są czasowe (wygasają po kilku dniach), więc
 * pobieramy zdjęcie i wgrywamy je do Notion na stałe. Zwraca id pliku w Notion
 * albo null, jeśli się nie udało (wtedy zostaje stary link jako zapas).
 */
async function uploadImageToNotion(notion: Client, imageUrl: string): Promise<string | null> {
    try {
        const res = await axios.get(imageUrl, { responseType: 'arraybuffer', timeout: 30000 });
        const contentType = String(res.headers['content-type'] || 'image/jpeg').split(';')[0];
        const ext = contentType.includes('png') ? 'png' : contentType.includes('webp') ? 'webp' : 'jpg';
        const filename = `okladka.${ext}`;

        const upload: any = await notion.fileUploads.create({ mode: 'single_part', filename, content_type: contentType } as any);
        await notion.fileUploads.send({
            file_upload_id: upload.id,
            file: { filename, data: new Blob([res.data], { type: contentType }) }
        } as any);
        return upload.id;
    } catch (error: any) {
        console.error(`Nie udało się wgrać zdjęcia do Notion: ${error.message}`);
        return null;
    }
}

export async function saveToNotion(recipeMarkdown: string, originalUrl: string, thumbnailUrl: string | null): Promise<string> {
    const apiKey = process.env.NOTION_API_KEY;
    const databaseId = process.env.NOTION_DATABASE_ID;

    if (!apiKey || !databaseId) {
        throw new Error("NOTION_API_KEY lub NOTION_DATABASE_ID nie jest zdefiniowane w .env");
    }

    const notion = new Client({ auth: apiKey });

    // Remove the ?v=... param from the database ID if user pasted full url
    const cleanDatabaseId = databaseId.split('?')[0].replace(/-/g, '').slice(-32);

    const lines = recipeMarkdown.split('\n');
    let title = "Odkryty Przepis z Instagrama";

    // Wyłapujemy pierwszy nagłówek na tytuł strony
    for (const line of lines) {
        if (line.trim().startsWith('# ')) {
            title = line.replace('# ', '').trim();
            break;
        }
    }

    const childrenBlocks: any[] = [];

    // Osobne wgranie dla okładki i dla zdjęcia w treści - każde trzymane na stałe w Notion
    let coverFileId: string | null = null;
    let imageFileId: string | null = null;
    if (thumbnailUrl) {
        coverFileId = await uploadImageToNotion(notion, thumbnailUrl);
        imageFileId = await uploadImageToNotion(notion, thumbnailUrl);
    }

    // Dodanie zdjęcia na początku treści strony
    if (thumbnailUrl) {
        childrenBlocks.push({
            object: 'block',
            type: 'image',
            image: imageFileId
                ? { type: 'file_upload', file_upload: { id: imageFileId } }
                : { type: 'external', external: { url: thumbnailUrl } }
        });
    }

    let currentText = "";

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (currentText.length + line.length > 1800) {
            childrenBlocks.push({
                object: 'block',
                type: 'paragraph',
                paragraph: {
                    rich_text: [{ type: 'text', text: { content: currentText } }]
                }
            });
            currentText = line + "\n";
        } else {
            currentText += line + "\n";
        }
    }

    if (currentText.trim().length > 0) {
        childrenBlocks.push({
            object: 'block',
            type: 'paragraph',
            paragraph: {
                rich_text: [{ type: 'text', text: { content: currentText } }]
            }
        });
    }

    // Dodanie linku do oryginalnego wideo na końcu bazy
    childrenBlocks.push({
        object: 'block',
        type: 'bookmark',
        bookmark: {
            url: originalUrl
        }
    });

    try {
        const response: any = await notion.pages.create({
            parent: { database_id: cleanDatabaseId },
            cover: coverFileId
                ? { type: "file_upload", file_upload: { id: coverFileId } }
                : thumbnailUrl ? { type: "external", external: { url: thumbnailUrl } } : undefined,
            // External CDN URLs from Instagram expire quickly, so fall back to emoji icon
            icon: {
                type: "emoji",
                emoji: "🍲"
            },
            properties: {
                "Name": {
                    title: [
                        {
                            text: {
                                content: title
                            }
                        }
                    ]
                }
            },
            children: childrenBlocks
        });

        return response.url;
    } catch (error: any) {
        console.error("Notion Error Details:", error.body ? JSON.parse(error.body).message : error.message);
        throw new Error(`Błąd zapisywania do Notion: ${error.message}`);
    }
}
