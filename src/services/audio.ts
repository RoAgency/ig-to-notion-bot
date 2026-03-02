import { AssemblyAI } from 'assemblyai';

export async function transcribeAudio(audioUrl: string): Promise<string> {
    const apiKey = process.env.ASSEMBLYAI_API_KEY;
    if (!apiKey) {
        throw new Error("ASSEMBLYAI_API_KEY is not defined in .env");
    }

    const client = new AssemblyAI({
        apiKey: apiKey
    });

    try {
        const transcript = await client.transcripts.transcribe({
            audio: audioUrl,
            // 'best' is the standard model in most SDK versions for higher accuracy
            language_detection: true
        });

        if (transcript.status === 'error') {
            throw new Error(transcript.error);
        }

        return transcript.text || "";
    } catch (error: any) {
        throw new Error(`Błąd podczas transkrypcji wideo: ${error.message}`);
    }
}
