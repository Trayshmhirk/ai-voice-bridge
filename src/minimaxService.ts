import WebSocket from "ws";
import dotenv from "dotenv";

dotenv.config();

export function streamMiniMaxAudio(
  aiText: string,
  streamSid: string,
  twilioSocket: WebSocket,
) {
  const groupId = process.env.MINIMAX_GROUP_ID;
  const apiKey = process.env.MINIMAX_API_KEY;

  if (!groupId || !apiKey) {
    console.error("MiniMax credentials missing.");
    return;
  }

  // 1. Open the connection to MiniMax
  const minimaxWs = new WebSocket(
    `wss://api.minimax.io/v1/t2a_v2?GroupId=${groupId}`,
  );

  minimaxWs.on("open", () => {
    console.log("Connected to MiniMax streaming API.");

    // 2. Construct the initialization payload using the exact settings from your n8n workflow
    const requestPayload = {
      header: {
        action: "run",
        task_id: "stream_audio_" + streamSid,
      },
      payload: {
        model: "speech-2.8-hd",
        text: aiText,
        stream: true, // Set to true for WebSockets to get instant chunks
        voice_setting: {
          voice_id: "moss_audio_f2f64e31-0360-11f1-9cb8-d2836630c025",
          speed: 1,
          vol: 1,
          pitch: 0,
        },
        audio_setting: {
          sample_rate: 8000, // Changed to 8000 to match Twilio's exact requirement
          bitrate: 128000,
          format: "ulaw", // Changed to ulaw (mu-law) so Twilio can play it without conversion
          channel: 1,
        },
      },
    };

    minimaxWs.send(JSON.stringify(requestPayload));
  });

  minimaxWs.on("message", (data: WebSocket.Data) => {
    const response = JSON.parse(data.toString());

    // 3. Extract the audio and route it to Twilio
    if (response.payload && response.payload.audio) {
      const audioChunk = response.payload.audio;

      // 4. Send the audio to Twilio
      twilioSocket.send(
        JSON.stringify({
          event: "media",
          streamSid: streamSid,
          media: {
            payload: audioChunk,
          },
        }),
      );
    }
  });

  minimaxWs.on("error", (error) => {
    console.error("MiniMax WebSocket error:", error);
  });

  minimaxWs.on("close", () => {
    console.log("MiniMax stream finished.");
  });
}
