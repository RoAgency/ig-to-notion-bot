import TelegramBot from 'node-telegram-bot-api';
import dotenv from 'dotenv';
import express from 'express';
import { processInstagramReel } from './services/instagram';
import { transcribeAudio } from './services/audio';
import { generateRecipe } from './services/ai';
import { saveToNotion } from './services/notion';

dotenv.config();

const token = process.env.TELEGRAM_BOT_TOKEN;
const webhookUrl = process.env.WEBHOOK_URL; // e.g. https://your-app.up.railway.app
const port = parseInt(process.env.PORT || '3000');

if (!token) {
    console.error("TELEGRAM_BOT_TOKEN is not defined in .env");
    process.exit(1);
}

const bot = new TelegramBot(token);

async function handleMessage(msg: TelegramBot.Message) {
    const chatId = msg.chat.id;
    const text = msg.text;

    if (text === '/start') {
        return bot.sendMessage(chatId, 'Cześć! Jestem Twoim prywatnym botem do zapisywania przepisów z Instagrama.\nPo prostu wyślij mi link do Rolki z przepisem!');
    }

    if (text && (text.includes('instagram.com/reel/') || text.includes('instagram.com/p/'))) {
        try {
            const processingMsg = await bot.sendMessage(chatId, '⏳ Znaleziono link do Instagrama. Pobieram wideo i opis...');

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

            bot.editMessageText('🧠 Audio gotowe! Wysyłam dane do Google Gemini w celu formatowania przepisu po polsku...', { chat_id: chatId, message_id: processingMsg.message_id });
            const recipe = await generateRecipe(description, transcriptionText);

            bot.editMessageText('📝 Mam gotowy przepis. Zapisuję do bazy w Notion (wraz z okładką)...', { chat_id: chatId, message_id: processingMsg.message_id });
            const notionUrl = await saveToNotion(recipe, text, thumbnailUrl);

            bot.editMessageText(`✅ Gotowe! Zapisano przepis w Notion:\n${notionUrl}`, { chat_id: chatId, message_id: processingMsg.message_id });

        } catch (error: any) {
            console.error(error);
            bot.sendMessage(chatId, `❌ Wystąpił błąd podczas przetwarzania linku:\n${error.message || error}`);
        }
    } else if (text) {
        bot.sendMessage(chatId, 'Proszę wyślij mi poprawny link do rolki na Instagramie.');
    }
}

bot.on('message', handleMessage);

const app = express();
app.use(express.json());

// Telegram sends updates here
app.post(`/webhook/${token}`, (req, res) => {
    bot.processUpdate(req.body);
    res.sendStatus(200);
});

// Health check for Railway
app.get('/', (_req, res) => res.send('Bot is running!'));

app.listen(port, async () => {
    console.log(`Server running on port ${port}`);
    if (webhookUrl) {
        await bot.setWebHook(`${webhookUrl}/webhook/${token}`);
        console.log(`Webhook set: ${webhookUrl}/webhook/${token}`);
    } else {
        console.warn("WEBHOOK_URL not set — webhook not registered with Telegram");
    }
});
