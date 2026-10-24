import axios from 'axios';

export type ReelData = { description: string, videoUrl: string | null, thumbnailUrl: string | null, author?: string | null };

/**
 * Główne wejście: najpierw HikerAPI (stabilniejsze), a jeśli nie ma klucza
 * albo HikerAPI zawiedzie - zapasowo stary scraper JoTucker na RapidAPI.
 */
export async function processInstagramReel(url: string): Promise<ReelData> {
    const hikerKey = process.env.HIKER_API_KEY;
    const rapidKey = process.env.RAPID_API_KEY;

    if (!hikerKey && !rapidKey) {
        throw new Error("Brak klucza: ustaw HIKER_API_KEY (zalecane) lub RAPID_API_KEY w zmiennych Railway.");
    }

    if (hikerKey) {
        try {
            return await fetchFromHiker(url, hikerKey);
        } catch (error: any) {
            console.error(`[HikerAPI] ${error.message}`);
            if (!rapidKey) throw error;
            console.log("HikerAPI zawiodło - próbuję zapasowo JoTucker (RapidAPI)...");
        }
    }

    return fetchFromJoTucker(url, rapidKey as string);
}

function cleanInstagramUrl(url: string): string {
    const match = url.match(/https?:\/\/(?:www\.)?instagram\.com\/(?:[A-Za-z0-9_.]+\/)?(reel|reels|p|tv)\/([A-Za-z0-9_-]+)/);
    if (!match) return url.trim();
    const kind = match[1] === 'reels' ? 'reel' : match[1];
    return `https://www.instagram.com/${kind}/${match[2]}/`;
}

async function fetchFromHiker(url: string, apiKey: string): Promise<ReelData> {
    const cleanUrl = cleanInstagramUrl(url);
    console.log(`Calling HikerAPI for: ${cleanUrl}`);

    try {
        const response = await axios.get('https://api.hikerapi.com/v1/media/by/url', {
            params: { url: cleanUrl },
            headers: { 'x-access-key': apiKey, 'accept': 'application/json' },
            timeout: 30000
        });

        const media = response.data;
        if (!media || typeof media !== 'object') {
            throw new Error(`Nieoczekiwana odpowiedź HikerAPI: ${String(media).slice(0, 200)}`);
        }

        // Karuzela: wideo może siedzieć w pierwszym elemencie "resources"
        const firstResource = Array.isArray(media.resources) ? media.resources.find((r: any) => r?.video_url) || media.resources[0] : null;

        const description: string = media.caption_text || media.caption?.text || "";
        const videoUrl: string | null = media.video_url || firstResource?.video_url || null;
        const thumbnailUrl: string | null = media.thumbnail_url || firstResource?.thumbnail_url || null;

        if (!videoUrl && !description) {
            throw new Error("HikerAPI nie zwróciło ani wideo, ani opisu tej rolki.");
        }

        const author: string | null = media.user?.username || null;

        return { description, videoUrl, thumbnailUrl, author };
    } catch (error: any) {
        if (error.response) {
            const status = error.response.status;
            const detail = JSON.stringify(error.response.data || '').slice(0, 300);
            if (status === 401 || status === 403) {
                throw new Error(`HikerAPI odrzuciło klucz (${status}): sprawdź HIKER_API_KEY w Railway.`);
            }
            if (status === 402) {
                throw new Error("HikerAPI: skończyły się środki na koncie. Doładuj saldo na hikerapi.com.");
            }
            if (status === 404) {
                throw new Error("Nie znaleziono rolki (404). Sprawdź, czy link jest prawidłowy i czy konto jest publiczne.");
            }
            if (status === 429) {
                throw new Error("HikerAPI: zbyt wiele zapytań naraz. Spróbuj za chwilę.");
            }
            throw new Error(`Błąd HikerAPI (${status}): ${detail}`);
        }
        throw error;
    }
}

async function fetchFromJoTucker(url: string, rapidApiKey: string): Promise<ReelData> {

    // Extract shortcode from URL
    const regex = /(?:reel|p)\/([A-Za-z0-9_-]+)/;
    const match = url.match(regex);
    const shortcode = match ? match[1] : url;

    try {
        console.log(`Calling JoTucker API for shortcode: ${shortcode}`);

        // Próbujemy najpierw media_info (v1), który jest bardziej stabilny
        const response = await axios.get('https://instagram-scraper2.p.rapidapi.com/media_info', {
            params: { short_code: shortcode },
            headers: {
                'x-rapidapi-host': 'instagram-scraper2.p.rapidapi.com',
                'x-rapidapi-key': rapidApiKey
            }
        });

        const data = response.data;

        // RapidAPI sometimes returns a plain string like "401 - {...json...}" instead of
        // a parsed object when Instagram blocks the underlying scraper request.
        if (typeof data === 'string') {
            const igBlockMatch = data.match(/^(\d+)\s*-\s*(\{.+\})/s);
            if (igBlockMatch) {
                let igMessage = igBlockMatch[2];
                try { igMessage = JSON.parse(igBlockMatch[2]).message; } catch {}
                const igStatus = parseInt(igBlockMatch[1]);
                if (igStatus === 401 || igStatus === 403 || igMessage?.toLowerCase().includes('wait') || igMessage?.toLowerCase().includes('login')) {
                    throw new Error(
                        `⛔ Instagram zablokował scraper (${igStatus}): "${igMessage}".\n` +
                        `To tymczasowa blokada – poczekaj kilka minut i spróbuj ponownie.`
                    );
                }
                throw new Error(`Instagram API error ${igStatus}: ${igMessage}`);
            }
            throw new Error(`Nieoczekiwana odpowiedź tekstowa z API: ${data.slice(0, 200)}`);
        }

        // Próbujemy różnych ścieżek dostępu do danych, bo RapidAPI potrafi je zmieniać
        const media = data?.data?.shortcode_media ||
            data?.graphql?.shortcode_media ||
            data?.shortcode_media ||
            data?.data?.items?.[0] ||
            data?.items?.[0];

        if (!media) {
            const topLevelKeys = Object.keys(data || {});
            const firstLevelPreview = JSON.stringify(data, null, 2).slice(0, 800);
            console.error("DEBUG response structure:", firstLevelPreview);
            throw new Error(
                `API Instagrama zmieniło format odpowiedzi.\n` +
                `Klucze główne: [${topLevelKeys.join(', ')}]\n` +
                `Podgląd:\n${firstLevelPreview}`
            );
        }

        // Wyciąganie opisu (obsługa różnych nazw pól w v1 i v2)
        const description = media.edge_media_to_caption?.edges?.[0]?.node?.text ||
            media.caption?.text ||
            "";

        // Wyciąganie wideo
        let videoUrl: string | null = null;
        if (media.video_url) {
            videoUrl = media.video_url;
        } else if (media.video_versions && media.video_versions.length > 0) {
            videoUrl = media.video_versions[0].url;
        }

        // Wyciąganie miniatury
        const thumbnailUrl = media.display_url ||
            media.image_versions2?.candidates?.[0]?.url ||
            null;

        return { description, videoUrl, thumbnailUrl };

    } catch (error: any) {
        if (error.response) {
            const status = error.response.status;
            const body = JSON.stringify(error.response.data);

            if (status === 429) {
                throw new Error("LIMIT_EXCEEDED: Darmowy limit dzienny API (10 zapytań) został wyczerpany. Spróbuj ponownie jutro.");
            }
            if (status === 401 || status === 403) {
                throw new Error(`Błąd autoryzacji RapidAPI (${status}): klucz RAPID_API_KEY jest nieprawidłowy lub wygasł. Sprawdź klucz w ustawieniach.`);
            }
            if (status === 404) {
                throw new Error(`Nie znaleziono rolki w Instagramie (404). Sprawdź, czy link jest prawidłowy i czy post jest publiczny.`);
            }
            if (status >= 500) {
                throw new Error(`Serwer RapidAPI zwrócił błąd (${status}). Usługa może być chwilowo niedostępna – spróbuj za kilka minut.`);
            }

            throw new Error(`Błąd Instagrama (${status}): ${body}`);
        }

        throw new Error(`Błąd połączenia z Instagram API: ${error.message}`);
    }
}
