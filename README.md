# 🤖 Instagram to Notion Recipe Bot

Automatyczny bot Telegram, który zamienia rolki (Reels) z Instagrama w pięknie sformatowane strony z przepisami w Twoim Notion. Wyciąga opis, transkrybuje dźwięk z wideo (jeśli jest), generuje listę składników i instrukcje za pomocą AI oraz ustawia miniaturę wideo jako okładkę strony.

---

## ✨ Funkcje
- **Automatyczne pobieranie**: Wystarczy wkleić link do Instagram Reel.
- **Transkrypcja Audio**: Używa AssemblyAI do zamiany mowy z wideo na tekst.
- **Inteligencja Gemini AI**: Formatuje surowy tekst i transkrypcję w czytelny przepis (Składniki + Instrukcje).
- **Piękne Notion**: Tworzy stronę z ikoną, okładką i zdjęciem w treści.
- **Gotowy na Chmurę**: Zoptymalizowany pod kątem wdrożenia na Railway.app.

---

## 🛠 Stos Technologiczny
- **Język**: TypeScript / Node.js
- **Baza danych**: Notion API
- **AI**: Google Gemini Pro
- **Audio**: AssemblyAI
- **Instagram**: RapidAPI (Instagram Scraper 2 by JoTucker)

---

## 🚀 Jak stworzyć własną instancję?

### 1. Przygotowanie Kluczy API (Prerequisites)
Będziesz potrzebował następujących dostępów:

1.  **Telegram Bot**: Stwórz bota u [@BotFather](https://t.me/botfather) i pobierz `TELEGRAM_BOT_TOKEN`.
2.  **Notion**:
    - Stwórz nową integrację na [developers.notion.com](https://www.notion.so/my-integrations).
    - Skopiuj `Internal Integration Token`.
    - Stwórz bazę danych w Notion i **udostępnij ją (Invite)** swojej integracji.
    - Skopiuj `Database ID` (znajdziesz go w URL bazy).
3.  **Google Gemini**: Pobierz klucz API z [Google AI Studio](https://aistudio.google.com/).
4.  **AssemblyAI**: Załóż darmowe konto na [assemblyai.com](https://www.assemblyai.com/) i pobierz klucz.
5.  **RapidAPI**: Zapisz się na [Instagram Scraper 2 (JoTucker)](https://rapidapi.com/JoTucker/api/instagram-scraper2) i pobierz `X-RapidAPI-Key`.

### 2. Instalacja Lokalna
1.  Sklonuj repozytorium:
    ```bash
    git clone https://github.com/TwojLogin/ig-to-notion-bot.git
    cd ig-to-notion-bot
    ```
2.  Zainstaluj zależności:
    ```bash
    npm install
    ```
3.  Stwórz plik `.env` w głównym katalogu i uzupełnij go:
    ```env
    TELEGRAM_BOT_TOKEN=twój_token
    GEMINI_API_KEY=twój_klucz
    NOTION_API_KEY=twój_klucz
    NOTION_DATABASE_ID=id_bazy
    RAPID_API_KEY=twój_klucz_rapidapi
    ASSEMBLYAI_API_KEY=twój_klucz
    ```
4.  Uruchom w trybie deweloperskim:
    ```bash
    npm run dev
    ```

---

## ☁️ Wdrożenie na Railway (24/7)
Ten bot jest gotowy do wdrożenia na **Railway.app**:
1. Połącz Railway ze swoim repozytorium na GitHub.
2. W zakładce **Variables** w Railway wklej wszystkie zmienne z pliku `.env`.
3. Railway automatycznie wykryje komendy `build` oraz `start` i uruchomi bota.

---

## 📄 Struktura Projektu
- `src/index.ts` - Główna logika bota i obsługa wiadomości.
- `src/services/instagram.ts` - Pobieranie danych z Instagrama.
- `src/services/ai.ts` - Komunikacja z Gemini AI (formatowanie przepisu).
- `src/services/audio.ts` - Transkrypcja wideo przez AssemblyAI.
- `src/services/notion.ts` - Zapisywanie gotowego przepisu w Notion.

---

## 🔧 Komendy
- `npm run build` - Kompilacja TypeScript do JavaScript (do folderu `dist`).
- `npm run start` - Uruchomienie skompilowanej wersji.
- `npm run dev` - Uruchomienie bezpośrednie przez `ts-node`.

Created by RoAgency 🚀
