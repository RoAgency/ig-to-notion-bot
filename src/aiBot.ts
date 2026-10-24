import { importStarted, importFinished } from './shutdown';
import TelegramBot from 'node-telegram-bot-api';
import { processInstagramReel } from './services/instagram';
import { transcribeAudio } from './services/audio';
import { generateAiNote } from './services/ai';
import { saveAiNote, aiNoteExists } from './services/notionAi';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
let batchRunning = false;

/** Pełna ścieżka dla jednej rolki o AI: Instagram → transkrypcja → notatka Gemini → Notion. */
export async function processAiReel(url: string, onStep?: (text: string) => Promise<void> | void): Promise<{ notionUrl: string, title: string }> {
    const { description, videoUrl, thumbnailUrl, author } = await processInstagramReel(url);

    let transcript = "";
    if (videoUrl) {
        await onStep?.('🎵 Mam wideo. Robię transkrypcję...');
        try {
            transcript = await transcribeAudio(videoUrl);
        } catch (e: any) {
            console.error("Audio error", e.message);
        }
    }

    await onStep?.('🧠 Tworzę notatkę: streszczenie, wskazówki, narzędzia, prompty...');
    const note = await generateAiNote(description, transcript);

    await onStep?.('📝 Zapisuję do bazy „Wiedza AI" w Notion...');
    const notionUrl = await saveAiNote(note, url, thumbnailUrl, author);
    return { notionUrl, title: note.title };
}

export function startAiBot(token: string) {
    const bot = new TelegramBot(token, { polling: true });
    console.log("AI Knowledge Bot Started!");

    bot.on('message', async (msg) => {
        const chatId = msg.chat.id;
        const text = msg.text;

        if (text === '/start') {
            return bot.sendMessage(chatId, 'Cześć! Wyślij mi link do rolki z Instagrama o AI, a zrobię z niej notatkę w Notion: streszczenie, wskazówki, narzędzia i gotowe prompty.');
        }

        const links = [...new Set(text?.match(/https?:\/\/(?:www\.)?instagram\.com\/(?:reel|reels|p|tv)\/[A-Za-z0-9_-]+\/?/g) || [])];

        // Wiele linków w jednej wiadomości = import całej listy
        if (links.length > 1) {
            if (batchRunning) return bot.sendMessage(chatId, '⏳ Import już trwa, poczekaj na podsumowanie.');
            batchRunning = true;
            importStarted('ai', bot, chatId);
            let saved = 0, skipped = 0;
            const failed: string[] = [];
            try {
                await bot.sendMessage(chatId, `📥 Import: ${links.length} rolek. Rolki, które już są w bazie, pominę. Będę raportować postęp.`);
                for (let i = 0; i < links.length; i++) {
                    const url = links[i];
                    if (await aiNoteExists(url)) { skipped++; continue; }
                    try {
                        const { title } = await processAiReel(url);
                        saved++;
                        await bot.sendMessage(chatId, `✅ ${i + 1}/${links.length}: ${title}`);
                    } catch (e: any) {
                        console.error(`[AI import] ${url}: ${e.message}`);
                        failed.push(`${url} - ${e.message.split('\n')[0]}`);
                        if (/środki|402/.test(e.message)) {
                            await bot.sendMessage(chatId, '⛔ Skończyły się środki w HikerAPI. Doładuj konto i wyślij tę samą listę jeszcze raz - zapisane rolki zostaną pominięte.');
                            break;
                        }
                    }
                    await sleep(2000);
                }
                let summary = `🏁 Import zakończony. Zapisane: ${saved}, pominięte (już były): ${skipped}, błędy: ${failed.length}.`;
                if (failed.length) summary += `\n\n⚠️ Nie udało się:\n- ` + failed.join('\n- ');
                await bot.sendMessage(chatId, summary.slice(0, 4000));
            } finally {
                batchRunning = false;
                importFinished('ai');
            }
            return;
        }

        const link = links[0];
        if (!link) {
            if (text) bot.sendMessage(chatId, 'Wyślij mi link do rolki na Instagramie.');
            return;
        }

        try {
            if (await aiNoteExists(link)) {
                return bot.sendMessage(chatId, 'ℹ️ Ta rolka jest już w bazie Wiedza AI.');
            }
            const status = await bot.sendMessage(chatId, '⏳ Pobieram rolkę i opis...');
            const edit = async (t: string) => { await bot.editMessageText(t, { chat_id: chatId, message_id: status.message_id }).catch(() => {}); };
            const { notionUrl, title } = await processAiReel(link, edit);
            await edit(`✅ Zapisano: ${title}\n${notionUrl}`);
        } catch (error: any) {
            const m = error.message || String(error);
            console.error(`[AI ERROR] ${m}`);
            bot.sendMessage(chatId, `❌ Wystąpił błąd:\n${m}`);
        }
    });

    bot.on('polling_error', (e: any) => console.error(`[AI bot polling] ${e.message}`));
    return bot;
}
