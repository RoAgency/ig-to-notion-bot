import { Client } from '@notionhq/client';
import { uploadImageToNotion } from './notion';
import type { AiNote } from './ai';

const text = (content: string) => ({ type: 'text', text: { content } });

/** Notion przyjmuje max 2000 znaków w jednym kawałku tekstu - dzielimy dłuższe. */
function richText(content: string) {
    const parts = [];
    for (let i = 0; i < content.length; i += 1900) parts.push(text(content.slice(i, i + 1900)));
    return parts.length ? parts : [text('')];
}

const heading = (content: string) => ({ object: 'block', type: 'heading_2', heading_2: { rich_text: [text(content)] } });
const bullet = (rich_text: any[]) => ({ object: 'block', type: 'bulleted_list_item', bulleted_list_item: { rich_text } });

export async function saveAiNote(note: AiNote, originalUrl: string, thumbnailUrl: string | null, author?: string | null): Promise<string> {
    const apiKey = process.env.NOTION_API_KEY;
    const databaseId = process.env.NOTION_AI_DATABASE_ID;
    if (!apiKey || !databaseId) {
        throw new Error("Brak NOTION_API_KEY lub NOTION_AI_DATABASE_ID w zmiennych Railway.");
    }

    const notion = new Client({ auth: apiKey });
    const cleanDatabaseId = databaseId.split('?')[0].replace(/-/g, '').slice(-32);

    let coverFileId: string | null = null;
    let imageFileId: string | null = null;
    if (thumbnailUrl) {
        coverFileId = await uploadImageToNotion(notion, thumbnailUrl);
        imageFileId = await uploadImageToNotion(notion, thumbnailUrl);
    }

    const children: any[] = [];
    if (imageFileId) {
        children.push({ object: 'block', type: 'image', image: { type: 'file_upload', file_upload: { id: imageFileId } } });
    }

    if (note.summary) {
        children.push(heading('Streszczenie'));
        children.push({ object: 'block', type: 'paragraph', paragraph: { rich_text: richText(note.summary) } });
    }

    if (note.tips.length) {
        children.push(heading('Kluczowe wskazówki'));
        note.tips.forEach(t => children.push(bullet(richText(t))));
    }

    if (note.tools.length) {
        children.push(heading('Narzędzia'));
        note.tools.forEach(t => children.push(bullet(t.url && /^https?:\/\//.test(t.url)
            ? [{ type: 'text', text: { content: t.name, link: { url: t.url } } }]
            : [text(t.name)])));
    }

    if (note.prompts.length) {
        children.push(heading('Gotowe prompty'));
        note.prompts.forEach(p => children.push({ object: 'block', type: 'code', code: { language: 'plain text', rich_text: richText(p) } }));
    }

    children.push({ object: 'block', type: 'bookmark', bookmark: { url: originalUrl } });

    // Nazwy tagów w Notion nie mogą zawierać przecinków
    const toolTags = [...new Set(note.tools.map(t => t.name.replace(/,/g, ' ').trim()).filter(Boolean))].slice(0, 25);

    try {
        const response: any = await notion.pages.create({
            parent: { database_id: cleanDatabaseId },
            cover: coverFileId
                ? { type: 'file_upload', file_upload: { id: coverFileId } }
                : thumbnailUrl ? { type: 'external', external: { url: thumbnailUrl } } : undefined,
            icon: { type: 'emoji', emoji: '🤖' },
            properties: {
                "Name": { title: [text(note.title)] },
                "Kategoria": { select: { name: note.category } },
                "Narzędzia": { multi_select: toolTags.map(name => ({ name })) },
                "Autor": { rich_text: author ? [text('@' + author)] : [] },
                "Link": { url: originalUrl }
            },
            children
        } as any);
        return response.url;
    } catch (error: any) {
        console.error("Notion AI Error:", error.message);
        throw new Error(`Błąd zapisywania notatki do Notion: ${error.message}`);
    }
}

/** Czy ta rolka jest już w bazie Wiedza AI (porównanie po kodzie rolki w kolumnie Link). */
export async function aiNoteExists(url: string): Promise<boolean> {
    const apiKey = process.env.NOTION_API_KEY;
    const databaseId = process.env.NOTION_AI_DATABASE_ID;
    if (!apiKey || !databaseId) return false;
    const code = url.match(/\/(?:reel|reels|p|tv)\/([A-Za-z0-9_-]+)/)?.[1];
    if (!code) return false;
    try {
        const notion = new Client({ auth: apiKey });
        const db: any = await notion.databases.retrieve({ database_id: databaseId.split('?')[0].replace(/-/g, '').slice(-32) });
        const dataSourceId = db.data_sources?.[0]?.id;
        if (!dataSourceId) return false;
        const res: any = await notion.dataSources.query({
            data_source_id: dataSourceId,
            filter: { property: 'Link', url: { contains: code } },
            page_size: 1
        } as any);
        return res.results.length > 0;
    } catch (e: any) {
        console.error(`[AI] Nie udało się sprawdzić duplikatu: ${e.message}`);
        return false;
    }
}
