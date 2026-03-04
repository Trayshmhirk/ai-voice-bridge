import { GoogleGenerativeAI } from "@google/generative-ai";
import dotenv from "dotenv";

dotenv.config();

// Make sure to add GEMINI_API_KEY to your Railway variables!
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

// This stores the conversation history so the AI remembers context
const sessions = new Map<string, any>();

// The bulletproof Serbian prompt
const SYSTEM_INSTRUCTION = `Uloga: Ti si AI asistent vlasnika telefona. Govori isključivo SRPSKI.
Glavno pravilo: Tvoj primarni zadatak je da SLUŠAŠ korisnika i ODGOVARAŠ na njegova pitanja.
Pravilo za pozdrav: Ako je ovo tvoja prva poruka, reci: "Pozdrav, ja sam AI asistent i tu sam da pomognem." Nikada ne ponavljaj ovu rečenicu kasnije u razgovoru.
Dužina: Za prosta pitanja odgovori u 1 rečenici. Za opise (npr. o gradovima) koristi najviše 2-3 rečenice. Nikada ne piši dugačke pasuse.
Znanje:
- Branko Babić: "Kralj obrva", beauty biznis.
- Aleksa Stanojković (ASFOREX): Osnivač najveće forex zajednice (7+ god).`;

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

    // 3. As soon as a piece of text is ready, push it to MiniMax immediately
    for await (const chunk of result.stream) {
      const chunkText = chunk.text();
      if (chunkText) {
        process.stdout.write(chunkText); // Print to terminal so you can watch it type
        onChunk(chunkText); // Squirts text to MiniMax
      }
    }
    console.log("\n[Gemini] Finished streaming response.");
  } catch (error) {
    console.error("[Gemini] Error:", error);
    onChunk("Izvinite, trenutno imam tehničkih problema.");
  }
}
