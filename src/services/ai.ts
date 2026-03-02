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

        if (response.text) {
            return response.text;
        } else {
            throw new Error("Pusta odpowiedź od modelu Gemini.");
        }
    } catch (error: any) {
        throw new Error(`Błąd generowania przepisu przez AI: ${error.message}`);
    }
}
