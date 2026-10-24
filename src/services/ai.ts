import { GoogleGenAI } from '@google/genai';

export async function generateRecipe(description: string, transcriptionText: string): Promise<string> {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        throw new Error("GEMINI_API_KEY is not defined in .env");
    }

    const ai = new GoogleGenAI({ apiKey: apiKey });

    const prompt = `
Jesteś profesjonalnym kucharzem i asystentem notowania przepisów kulinarnych.
Otrzymujesz opis z Instagrama oraz transkrypcję z wideo (audio). 
Twoim zadaniem jest wydobycie składników i instrukcji przygotowania posiłku.
Nawet jeśli materiały źródłowe są w innym języku (np. angielskim), **MUSISZ BEZWZGLĘDNIE przetłumaczyć i sformatować cały przepis w języku POLSKIM.**

--- MATERIAŁY ŹRÓDŁOWE ---
OPIS Z INSTAGRAMA:
${description}

TRANSKRYPCJA AUDIO (CO POWIEDZIANO NA WIDEO):
${transcriptionText}
----------------------

Wygeneruj odpowiedź w czystym formacie markdown. Odpowiedź ma zawierać:
1. Tytuł przepisu (jako Nagłówek H1)
2. Sekcję ze składnikami (jako lista punktowana)
3. Sekcję z instrukcjami krok po kroku (jako lista numerowana)
Dołącz również krótkie porady, jeśli pojawiają się w tekście.
Twoja finalna odpowiedź zostania wklejona bezpośrednio do notatki, więc nie używaj wstępów w stylu "Oto Twój przepis..." - wypisz sam wyodrębniony przepis.
`;

    try {
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: prompt,
        });

        // gemini-2.5-flash is a thinking model — response.text aggregates all text parts
        const text = response.text ?? response.candidates?.[0]?.content?.parts
            ?.filter((p: any) => p.text)
            .map((p: any) => p.text)
            .join('');

        if (text && text.trim().length > 0) {
            return text;
        } else {
            throw new Error("Pusta odpowiedź od modelu Gemini. Sprawdź czy klucz GEMINI_API_KEY jest aktywny.");
        }
    } catch (error: any) {
        throw new Error(`Błąd generowania przepisu przez AI: ${error.message}`);
    }
}

export type AiNote = {
    title: string;
    category: string;
    summary: string;
    tips: string[];
    tools: { name: string, url?: string }[];
    prompts: string[];
};

export const AI_CATEGORIES = ["Narzędzia", "Prompty", "Automatyzacje", "Strategia i biznes", "Treści i marketing", "Newsy", "Inne"];

/** Notatka z rolki o AI: streszczenie, wskazówki, narzędzia, prompty - po polsku, jako JSON. */
export async function generateAiNote(description: string, transcriptionText: string): Promise<AiNote> {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("GEMINI_API_KEY is not defined in .env");

    const ai = new GoogleGenAI({ apiKey });

    const prompt = `
Jesteś analitykiem, który robi praktyczne notatki z krótkich filmów o sztucznej inteligencji.
Otrzymujesz opis z Instagrama oraz transkrypcję audio z rolki. Materiały mogą być w dowolnym języku,
ale CAŁA notatka musi być po POLSKU. Wyjątek: prompty przepisz w oryginalnym języku, dokładnie tak, jak padły.

--- OPIS Z INSTAGRAMA ---
${description}

--- TRANSKRYPCJA AUDIO ---
${transcriptionText}
-------------------------

Zwróć WYŁĄCZNIE obiekt JSON o polach:
- "title": krótki, konkretny tytuł notatki (do 80 znaków), bez emoji
- "category": jedna z: ${AI_CATEGORIES.map(c => `"${c}"`).join(', ')}
- "summary": 2-3 zdania - o czym jest rolka i co z niej wynika dla praktyka
- "tips": lista konkretnych wskazówek do zastosowania (każda jako jedno zdanie, bez numeracji)
- "tools": lista wymienionych narzędzi i usług AI jako obiekty {"name": "...", "url": "..."}; url tylko jeśli padł w materiałach albo to oczywista strona główna narzędzia, inaczej pomiń pole
- "prompts": lista gotowych promptów pokazanych lub podyktowanych w rolce (pusta lista, jeśli żadnego nie było)
Nie wymyślaj informacji, których nie ma w materiałach. Jeśli czegoś brak, zostaw pustą listę.
`;

    try {
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: prompt,
            config: { responseMimeType: 'application/json' }
        });

        const text = response.text ?? response.candidates?.[0]?.content?.parts
            ?.filter((p: any) => p.text)
            .map((p: any) => p.text)
            .join('');
        if (!text || !text.trim()) throw new Error("Pusta odpowiedź od modelu Gemini.");

        const json = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, ''));
        return {
            title: String(json.title || "Notatka o AI z Instagrama").slice(0, 200),
            category: AI_CATEGORIES.includes(json.category) ? json.category : "Inne",
            summary: String(json.summary || ""),
            tips: Array.isArray(json.tips) ? json.tips.map(String).filter(Boolean) : [],
            tools: Array.isArray(json.tools) ? json.tools.filter((t: any) => t?.name).map((t: any) => ({ name: String(t.name).slice(0, 90), url: t.url ? String(t.url) : undefined })) : [],
            prompts: Array.isArray(json.prompts) ? json.prompts.map(String).filter(Boolean) : []
        };
    } catch (error: any) {
        throw new Error(`Błąd tworzenia notatki AI: ${error.message}`);
    }
}
