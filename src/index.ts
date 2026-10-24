import { importStarted, importFinished } from './shutdown';
import TelegramBot from 'node-telegram-bot-api';
import dotenv from 'dotenv';
import { processInstagramReel } from './services/instagram';
import { transcribeAudio } from './services/audio';
import { generateRecipe } from './services/ai';
import { saveToNotion } from './services/notion';
import { backfillImages, listRecipeShortcodes } from './services/backfill';
import { startAiBot } from './aiBot';

let backfillRunning = false;
let batchRunning = false;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/** Pełna ścieżka dla jednej rolki z przepisem: Instagram → transkrypcja → Gemini → Notion. */
async function processRecipe(url: string, onStep?: (t: string) => Promise<any> | void): Promise<string> {
    const { description, videoUrl, thumbnailUrl } = await processInstagramReel(url);
    let transcriptionText = "";
    if (videoUrl) {
        await onStep?.('🎵 Pobrano nośnik. Rozpoczynam transkrypcję audio z wideo...');
        try {
            transcriptionText = await transcribeAudio(videoUrl);
        } catch (e) {
            console.error("Audio error", e);
            transcriptionText = "[Nie udało się pobrać transkrypcji audio zapasowego.]";
        }
    }
    await onStep?.('🧠 Audio gotowe! Wysyłam dane do Google Gemini w celu formatowania przepisu po polsku...');
    const recipe = await generateRecipe(description, transcriptionText);
    await onStep?.('📝 Mam gotowy przepis. Zapisuję do bazy w Notion (wraz z okładką)...');
    return saveToNotion(recipe, url, thumbnailUrl);
}

dotenv.config();

const token = process.env.TELEGRAM_BOT_TOKEN;

if (!token) {
    console.error("TELEGRAM_BOT_TOKEN is not defined in .env");
    process.exit(1);
}

const bot = new TelegramBot(token, { polling: true });

console.log("Instagram to Notion Bot Started!");
console.log("Waiting for Instagram Reel links...");

// Drugi bot (Wiedza AI) startuje w tym samym procesie, jeśli ma swój token
if (process.env.TELEGRAM_AI_BOT_TOKEN) {
    startAiBot(process.env.TELEGRAM_AI_BOT_TOKEN);
}

bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;

    if (text === '/start') {
        return bot.sendMessage(chatId, 'Cześć! Jestem Twoim prywatnym botem do zapisywania przepisów z Instagrama.\nPo prostu wyślij mi link do Rolki z przepisem!');
    }

    if (text === '/zdjecia') {
        if (backfillRunning) return bot.sendMessage(chatId, '⏳ Uzupełnianie zdjęć już trwa.');
        backfillRunning = true;
        try {
            await bot.sendMessage(chatId, '🔎 Szukam przepisów z wygasłymi zdjęciami...');
            const report = await backfillImages(async (line) => { await bot.sendMessage(chatId, line); });
            let summary = `🏁 Gotowe. Przepisów w bazie: ${report.total}, do naprawy: ${report.needed}, naprawione: ${report.fixed}.`;
            if (report.failed.length) summary += `\n\n⚠️ Nie udało się (${report.failed.length}):\n- ` + report.failed.join('\n- ');
            await bot.sendMessage(chatId, summary);
        } catch (error: any) {
            console.error(`[ERROR] ${error.message}`);
            await bot.sendMessage(chatId, `❌ Błąd uzupełniania zdjęć:\n${error.message}`);
        } finally {
            backfillRunning = false;
        }
        return;
    }

    const links = [...new Set(text?.match(/https?:\/\/(?:www\.)?instagram\.com\/(?:reel|reels|p|tv)\/[A-Za-z0-9_-]+\/?/g) || [])];

    // Wiele linków w jednej wiadomości = import listy, z pominięciem przepisów już zapisanych
    if (links.length > 1) {
        if (batchRunning) return bot.sendMessage(chatId, '⏳ Import już trwa, poczekaj na podsumowanie.');
        batchRunning = true;
        importStarted('recipes', bot, chatId);
        let saved = 0, skipped = 0;
        const failed: string[] = [];
        try {
            await bot.sendMessage(chatId, `📥 Import: ${links.length} linków. Sprawdzam, które przepisy już są w bazie...`);
            const existing = await listRecipeShortcodes();
            const todo = links.filter(u => {
                const code = u.match(/\/(?:reel|reels|p|tv)\/([A-Za-z0-9_-]+)/)?.[1];
                return !(code && existing.has(code));
            });
            skipped = links.length - todo.length;
            await bot.sendMessage(chatId, `Już w bazie: ${skipped}. Do zapisania: ${todo.length}. Zaczynam.`);
            for (let i = 0; i < todo.length; i++) {
                try {
                    const notionUrl = await processRecipe(todo[i]);
                    saved++;
                    await bot.sendMessage(chatId, `✅ ${i + 1}/${todo.length}: ${notionUrl}`);
                } catch (e: any) {
                    console.error(`[Import] ${todo[i]}: ${e.message}`);
                    failed.push(`${todo[i]} - ${e.message.split('\n')[0]}`);
                    if (/środki|402/.test(e.message)) {
                        await bot.sendMessage(chatId, '⛔ Skończyły się środki w HikerAPI. Doładuj konto i wyślij tę samą listę jeszcze raz - zapisane przepisy zostaną pominięte.');
                        break;
                    }
                }
                await sleep(2000);
            }
            let summary = `🏁 Import zakończony. Zapisane: ${saved}, pominięte (już były): ${skipped}, błędy: ${failed.length}.`;
            if (failed.length) summary += `\n\n⚠️ Nie udało się:\n- ` + failed.join('\n- ');
            await bot.sendMessage(chatId, summary.slice(0, 4000));
        } catch (error: any) {
            await bot.sendMessage(chatId, `❌ Błąd importu:\n${error.message}`);
        } finally {
            batchRunning = false;
            importFinished('recipes');
        }
        return;
    }

    if (links[0]) {
        try {
            const processingMsg = await bot.sendMessage(chatId, '⏳ Znaleziono link do Instagrama. Pobieram wideo i opis...');
            const edit = (t: string) => bot.editMessageText(t, { chat_id: chatId, message_id: processingMsg.message_id }).catch(() => {});
            const notionUrl = await processRecipe(links[0], edit);
            await edit(`✅ Gotowe! Zapisano przepis w Notion:\n${notionUrl}`);
        } catch (error: any) {
            const msg = error.message || String(error);
            console.error(`[ERROR] ${msg}`);
            bot.sendMessage(chatId, `❌ Wystąpił błąd:\n${msg}`);
        }
    } else if (text) {
        bot.sendMessage(chatId, 'Proszę wyślij mi poprawny link do rolki na Instagramie.');
    }
});
