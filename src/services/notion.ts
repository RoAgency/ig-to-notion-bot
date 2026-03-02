import { Client } from '@notionhq/client';

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

    // Dodanie zdjęcia na początku treści strony
    if (thumbnailUrl) {
        childrenBlocks.push({
            object: 'block',
            type: 'image',
            image: {
                type: 'external',
                external: { url: thumbnailUrl }
            }
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
            cover: thumbnailUrl ? {
                type: "external",
                external: { url: thumbnailUrl }
            } : undefined,
            icon: thumbnailUrl ? {
                type: "external",
                external: { url: thumbnailUrl }
            } : {
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
