import { GoogleGenerativeAI } from "@google/generative-ai";
import dotenv from "dotenv";

dotenv.config();

// Make sure to add GEMINI_API_KEY to your Railway variables!
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

// This stores the conversation history so the AI remembers context
const sessions = new Map<string, any>();

// The Premium Concierge System Prompt
const SYSTEM_INSTRUCTION = `Uloga: Ti si profesionalan, topao i izuzetno koristan asistent vlasnika telefona. Govoriš isključivo SRPSKI.

Glavni zadatak: Slušaj korisnika, daj mu precizne informacije i održavaj prirodan tok razgovora. 

Pravila ponašanja:
1. Prvi kontakt: Samo u svojoj prvoj poruci reci: "Pozdrav, ja sam asistent vlasnika telefona, kako vam mogu pomoći?" Nikada više ne ponavljaj ovaj pozdrav.
2. Dužina: Za prosta pitanja koristi 1 rečenicu. Za objašnjenja koristi najviše 2-3 rečenice. Nikada ne drži duge govore.
3. Nejasnoće (VAŽNO): Ako dobiješ besmislen tekst (jer te korisnik nije dobro čuo), NIKADA ne reci "Ne razumem". Umesto toga reci: "Oprostite, izgleda da je loš signal, možete li da ponovite?"
4. Izgovor: Strane reči su napisane fonetski kako bi ih lakše izgovorio (npr. "Foreks", a ne Forex). Brojeve do deset uvek piši slovima.
5. Zadržavanje razgovora: Povremeno završi svoj odgovor pitanjem kako bi se izbegla tišina (npr. "Mogu li još nešto da proverim za vas?").

Znanje koje poseduješ:
- Branko Babić: Poznat kao "Kralj obrva", izuzetno uspešan preduzetnik u beauty industriji.
- Aleksa Stanojković: Poznat kao AS-Foreks. Osnivač je najveće Foreks zajednice na Balkanu koja postoji više od sedam godina.

Ograničenja: Ne pominji da si AI, bot, ili softver. Ponašaj se kao profesionalni ljudski asistent.`;

// We use the new hyper-fast lite model
const model = genAI.getGenerativeModel({
  model: "gemini-2.5-flash-lite",
  systemInstruction: SYSTEM_INSTRUCTION,
});

export async function streamGeminiLogic(
  transcript: string,
  sessionId: string,
  onChunk: (text: string) => void,
) {
  // 1. Get or start a chat session for this caller
  if (!sessions.has(sessionId)) {
    sessions.set(sessionId, model.startChat({ history: [] }));
  }
  const chat = sessions.get(sessionId);

  try {
    console.log(`[Gemini] Thinking...`);

    // 2. Stream the response
    const result = await chat.sendMessageStream(transcript);
    let sentenceBuffer = ""; // Our holding pen for words

    // 3. Process the stream with the Sentence Buffer
    for await (const chunk of result.stream) {
      const chunkText = chunk.text();
      if (chunkText) {
        process.stdout.write(chunkText); // Print to terminal so you can watch it type
        sentenceBuffer += chunkText;

        // Check if the buffer contains a punctuation mark
        let match = sentenceBuffer.match(/([.,!?\n])/);

        // Loop to extract ALL complete phrases if multiple punctuations arrived at once
        while (match && match.index !== undefined) {
          const splitIndex = match.index + 1;
          const completePhrase = sentenceBuffer.slice(0, splitIndex); // Grab up to the punctuation

          if (completePhrase.trim().length > 0) {
            onChunk(completePhrase.trim()); // Send the smooth phrase to MiniMax
          }

          // Remove the sent phrase from the buffer and check again
          sentenceBuffer = sentenceBuffer.slice(splitIndex);
          match = sentenceBuffer.match(/([.,!?\n])/);
        }
      }
    }

    // 4. Flush any leftover words at the very end of the AI's response
    if (sentenceBuffer.trim().length > 0) {
      onChunk(sentenceBuffer.trim());
    }

    console.log("\n[Gemini] Finished streaming response.");
  } catch (error) {
    console.error("[Gemini] Error:", error);
    onChunk("Izvinite, trenutno imam tehničkih problema.");
  }
}
