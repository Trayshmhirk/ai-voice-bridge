import { createClient } from "@deepgram/sdk";
import dotenv from "dotenv";

dotenv.config();

export function createDeepgramConnection() {
  // 1. Initialize the Deepgram client
  const deepgram = createClient(process.env.DEEPGRAM_API_KEY);

  // 2. Create the live transcription connection
  const connection = deepgram.listen.live({
    model: "nova-3",
    smart_format: true,
    encoding: "mulaw",
    sample_rate: 8000,
    channels: 1,
    endpointing: 500, // <-- ADD THIS: Triggers response after 500ms of silence
  });

  // 3. Keep track of the connection status in your terminal
  connection.addListener("Open", () => {
    console.log("Deepgram WebSocket connection opened.");
  });

  connection.addListener("Error", (error) => {
    console.error("Deepgram connection error:", error);
  });

  connection.addListener("Close", () => {
    console.log("Deepgram connection closed.");
  });

  return connection;
}
