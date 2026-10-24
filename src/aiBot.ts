import TelegramBot from 'node-telegram-bot-api';
import { processInstagramReel } from './services/instagram';
import { transcribeAudio } from './services/audio';
import { generateAiNote } from './services/ai';
import { saveAiNote } from './services/notionAi';

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

        const link = text?.match(/https?:\/\/(?:www\.)?instagram\.com\/\S+/)?.[0];
        if (!link) {
            if (text) bot.sendMessage(chatId, 'Wyślij mi link do rolki na Instagramie.');
            return;
        }

        try {
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
