import TelegramBot from 'node-telegram-bot-api';

/** Trwające importy - przy restarcie serwera wysyłamy informację, zamiast milczeć. */
const active = new Map<string, { bot: TelegramBot, chatId: number }>();

export function importStarted(key: string, bot: TelegramBot, chatId: number) { active.set(key, { bot, chatId }); }
export function importFinished(key: string) { active.delete(key); }

process.once('SIGTERM', async () => {
    await Promise.all([...active.values()].map(({ bot, chatId }) =>
        bot.sendMessage(chatId, '⚠️ Serwer bota właśnie się restartuje i import został przerwany. Za 2-3 minuty wyślij tę samą listę jeszcze raz - zapisane pozycje zostaną pominięte.').catch(() => {})));
    process.exit(0);
});
