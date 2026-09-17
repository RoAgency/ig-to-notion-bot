import axios from 'axios';

export async function processInstagramReel(url: string): Promise<{ description: string, videoUrl: string | null, thumbnailUrl: string | null }> {
    const rapidApiKey = process.env.RAPID_API_KEY;
    if (!rapidApiKey) {
        throw new Error("RAPID_API_KEY is not defined in .env");
    }

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

        // Próbujemy różnych ścieżek dostępu do danych, bo RapidAPI potrafi je zmieniać
        const media = data?.data?.shortcode_media ||
            data?.graphql?.shortcode_media ||
            data?.shortcode_media ||
            data?.data?.items?.[0] ||
            data?.items?.[0];

        if (!media) {
            // Surface the top-level keys so we can update the parser
            const topLevelKeys = Object.keys(data || {});
            const firstLevelPreview = JSON.stringify(data, null, 2).slice(0, 800);
            console.error("DEBUG response structure:", firstLevelPreview);
            throw new Error(
                `API Instagrama zmieniło format odpowiedzi.\n` +
                `Klucze główne: [${topLevelKeys.join(', ')}]\n` +
                `Podgląd odpowiedzi:\n${firstLevelPreview}`
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
