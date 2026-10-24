import { Client } from '@notionhq/client';
import { processInstagramReel } from './instagram';
import { uploadImageToNotion } from './notion';

/**
 * Jednorazowe uzupełnienie zdjęć w starych przepisach.
 * Starsze strony mają okładkę i zdjęcie jako czasowy link do Instagrama,
 * który już wygasł. Dla każdej takiej strony pobieramy rolkę jeszcze raz
 * (link do niej jest w zakładce na końcu strony), wgrywamy świeże zdjęcie
 * do Notion na stałe i podmieniamy okładkę oraz zdjęcie w treści.
 */

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

function isInstagramCdn(url?: string | null): boolean {
    return !!url && /(cdninstagram\.com|fbcdn\.net|instagram\.)/i.test(url);
}

async function listAllChildren(notion: Client, blockId: string): Promise<any[]> {
    const blocks: any[] = [];
    let cursor: string | undefined = undefined;
    do {
        const res: any = await notion.blocks.children.list({ block_id: blockId, start_cursor: cursor, page_size: 100 });
        blocks.push(...res.results);
        cursor = res.has_more ? res.next_cursor : undefined;
    } while (cursor);
    return blocks;
}

async function listAllPages(notion: Client, databaseId: string): Promise<any[]> {
    const db: any = await notion.databases.retrieve({ database_id: databaseId });
    const dataSourceId = db.data_sources?.[0]?.id;
    if (!dataSourceId) throw new Error("Nie znalazłem źródła danych w bazie Notion.");

    const pages: any[] = [];
    let cursor: string | undefined = undefined;
    do {
        const res: any = await notion.dataSources.query({ data_source_id: dataSourceId, start_cursor: cursor, page_size: 100 } as any);
        pages.push(...res.results);
        cursor = res.has_more ? res.next_cursor : undefined;
    } while (cursor);
    return pages;
}

export type BackfillReport = { total: number, needed: number, fixed: number, failed: string[] };

export async function backfillImages(onProgress: (text: string) => Promise<void>): Promise<BackfillReport> {
    const apiKey = process.env.NOTION_API_KEY;
    const databaseId = process.env.NOTION_DATABASE_ID;
    if (!apiKey || !databaseId) throw new Error("Brak NOTION_API_KEY lub NOTION_DATABASE_ID.");

    const notion = new Client({ auth: apiKey });
    const cleanDatabaseId = databaseId.split('?')[0].replace(/-/g, '').slice(-32);

    const pages = await listAllPages(notion, cleanDatabaseId);
    const report: BackfillReport = { total: pages.length, needed: 0, fixed: 0, failed: [] };

    for (const page of pages) {
        const title = page.properties?.Name?.title?.[0]?.plain_text || "Bez tytułu";
        const coverIsOld = page.cover?.type === 'external' && isInstagramCdn(page.cover.external?.url);

        const children = await listAllChildren(notion, page.id);
        const oldImageBlocks = children.filter(b => b.type === 'image' && b.image?.type === 'external' && isInstagramCdn(b.image.external?.url));

        if (page.icon?.type === 'external' && isInstagramCdn(page.icon.external?.url)) {
            await notion.pages.update({ page_id: page.id, icon: { type: 'emoji', emoji: '🍲' } } as any).catch(() => {});
        }

        if (!coverIsOld && oldImageBlocks.length === 0) continue;
        report.needed++;

        const bookmark = children.find(b => b.type === 'bookmark' && /instagram\.com/i.test(b.bookmark?.url || ''));
        const reelUrl = bookmark?.bookmark?.url;
        if (!reelUrl) {
            report.failed.push(`${title} (brak linku do rolki)`);
            continue;
        }

        try {
            const { thumbnailUrl } = await processInstagramReel(reelUrl);
            if (!thumbnailUrl) throw new Error("rolka nie ma zdjęcia");

            if (coverIsOld) {
                const coverId = await uploadImageToNotion(notion, thumbnailUrl);
                if (!coverId) throw new Error("nie udało się wgrać okładki");
                await notion.pages.update({ page_id: page.id, cover: { type: 'file_upload', file_upload: { id: coverId } } } as any);
            }

            for (const block of oldImageBlocks) {
                const imageId = await uploadImageToNotion(notion, thumbnailUrl);
                if (!imageId) throw new Error("nie udało się wgrać zdjęcia");
                await notion.blocks.update({ block_id: block.id, image: { file_upload: { id: imageId } } } as any);
            }

            report.fixed++;
            await onProgress(`✅ ${report.fixed}/${report.needed}: ${title}`);
        } catch (error: any) {
            console.error(`[Uzupełnianie] ${title}: ${error.message}`);
            report.failed.push(`${title} (${error.message})`);
            // Skończone środki w HikerAPI - nie ma sensu próbować dalej
            if (/środki|402/.test(error.message)) break;
        }

        await sleep(1500);
    }

    return report;
}

/** Kody rolek (z zakładek na dole stron), które już są w bazie przepisów. */
export async function listRecipeShortcodes(): Promise<Set<string>> {
    const apiKey = process.env.NOTION_API_KEY;
    const databaseId = process.env.NOTION_DATABASE_ID;
    if (!apiKey || !databaseId) throw new Error("Brak NOTION_API_KEY lub NOTION_DATABASE_ID.");
    const notion = new Client({ auth: apiKey });
    const pages = await listAllPages(notion, databaseId.split('?')[0].replace(/-/g, '').slice(-32));
    const codes = new Set<string>();
    for (const page of pages) {
        const children = await listAllChildren(notion, page.id);
        for (const b of children) {
            const code = (b.bookmark?.url || '').match(/\/(?:reel|reels|p|tv)\/([A-Za-z0-9_-]+)/)?.[1];
            if (code) codes.add(code);
        }
    }
    return codes;
}
