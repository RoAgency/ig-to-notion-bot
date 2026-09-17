import TelegramBot from 'node-telegram-bot-api';
import dotenv from 'dotenv';
import { processInstagramReel } from './services/instagram';
import { transcribeAudio } from './services/audio';
import { generateRecipe } from './services/ai';
import { saveToNotion } from './services/notion';

dotenv.config();

const token = process.env.TELEGRAM_BOT_TOKEN;

if (!token) {
    console.error("TELEGRAM_BOT_TOKEN is not defined in .env");
    process.exit(1);
}

const bot = new TelegramBot(token, { polling: true });

console.log("Instagram to Notion Bot Started!");
console.log("Waiting for Instagram Reel links...");

bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;

    if (text === '/start') {
        return bot.sendMessage(chatId, 'Cześć! Jestem Twoim prywatnym botem do zapisywania przepisów z Instagrama.\nPo prostu wyślij mi link do Rolki z przepisem!');
    }

    if (text && (text.includes('instagram.com/reel/') || text.includes('instagram.com/p/'))) {
        try {
            // 1. Send processing message
            const processingMsg = await bot.sendMessage(chatId, '⏳ Znaleziono link do Instagrama. Pobieram wideo i opis...');

            // 2. Fetch from Instagram via RapidAPI
            const { description, videoUrl, thumbnailUrl } = await processInstagramReel(text);

            let transcriptionText = "";
            if (videoUrl) {
                bot.editMessageText('🎵 Pobrano nośnik. Rozpoczynam transkrypcję audio z wideo...', { chat_id: chatId, message_id: processingMsg.message_id });
                try {
                    transcriptionText = await transcribeAudio(videoUrl);
                } catch (e) {
                    console.error("Audio error", e);
                    transcriptionText = "[Nie udało się pobrać transkrypcji audio zapasowego.]";
                }
            }

            // 3. Generate recipe via Gemini
            bot.editMessageText('🧠 Audio gotowe! Wysyłam dane do Google Gemini w celu formatowania przepisu po polsku...', { chat_id: chatId, message_id: processingMsg.message_id });
            const recipe = await generateRecipe(description, transcriptionText);

            // 4. Save to Notion
            bot.editMessageText('📝 Mam gotowy przepis. Zapisuję do bazy w Notion (wraz z okładką)...', { chat_id: chatId, message_id: processingMsg.message_id });
            const notionUrl = await saveToNotion(recipe, text, thumbnailUrl);

            // 5. Success
            bot.editMessageText(`✅ Gotowe! Zapisano przepis w Notion:\n${notionUrl}`, { chat_id: chatId, message_id: processingMsg.message_id });

        } catch (error: any) {
            const msg = error.message || String(error);
            console.error(`[ERROR] ${msg}`);
            bot.sendMessage(chatId, `❌ Wystąpił błąd:\n${msg}`);
        }
    } else if (text) {
        bot.sendMessage(chatId, 'Proszę wyślij mi poprawny link do rolki na Instagramie.');
    }
});
