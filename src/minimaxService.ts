import WebSocket from "ws";
import dotenv from "dotenv";

dotenv.config();

// Custom audio converter: MiniMax 16-bit PCM to Twilio 8-bit mu-law
function pcm16ToMuLaw(pcm16Buffer: Buffer): Buffer {
  const muLawBuffer = Buffer.alloc(pcm16Buffer.length / 2);
  const VOLUME_BOOST = 2.0; // <--- This will make the AI louder on the handset

  for (let i = 0; i < muLawBuffer.length; i++) {
    let sample = pcm16Buffer.readInt16LE(i * 2);

    // Apply digital gain (boost volume)
    sample = Math.round(sample * VOLUME_BOOST);

    // Clip sample to prevent "crackling" distortion
    if (sample > 32767) sample = 32767;
    else if (sample < -32768) sample = -32768;

    let sign = (sample >> 8) & 0x80;
    if (sign !== 0) sample = -sample;

    sample += 132;
    if (sample > 32767) sample = 32767;

    let exponent = 7;
    for (let mask = 0x4000; (sample & mask) === 0 && exponent > 0; mask >>= 1) {
      exponent--;
    }

    let mantissa = (sample >> (exponent + 3)) & 0x0f;
    let muLawByte = ~(sign | (exponent << 4) | mantissa);
    muLawBuffer[i] = muLawByte;
  }
  return muLawBuffer;
}

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
    `wss://api.minimax.io/ws/v1/t2a_v2?GroupId=${groupId}`,
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
    },
  );

  minimaxWs.on("open", () => {
    console.log("Connected to MiniMax streaming API.");

    // FIX: Fire the task_start configuration immediately upon opening the connection!
    minimaxWs.send(
      JSON.stringify({
        event: "task_start",
        model: "speech-2.8-hd",
        voice_setting: {
          voice_id: "moss_audio_f2f64e31-0360-11f1-9cb8-d2836630c025",
          speed: 1.05, // Slightly faster feels more "human" and less muffled
          vol: 1.5, // Increase base volume from MiniMax side
          pitch: 1, // A slight pitch increase (1) helps it stay "crisp" on 8kHz lines
        },
        audio_setting: {
          sample_rate: 8000,
          bitrate: 128000,
          format: "pcm",
          channel: 1,
        },
      }),
    );
  });

  minimaxWs.on("message", (data: WebSocket.Data) => {
    const response = JSON.parse(data.toString());

    // Log the exact events MiniMax is sending back to us
    if (response.event !== "task_continued") {
      console.log(`[MiniMax Event]: ${response.event}`);
    }

    if (response.event === "task_started") {
      // Once the server acknowledges the start, push the text and close the queue
      minimaxWs.send(
        JSON.stringify({
          event: "task_continue",
          text: aiText,
        }),
      );

      minimaxWs.send(
        JSON.stringify({
          event: "task_finish",
        }),
      );
    }

    if (response.event === "task_continued") {
      if (
        response.data &&
        response.data.audio &&
        response.data.audio.length > 0
      ) {
        // Convert MiniMax's HEX/Base64 audio string to a standard Buffer
        const isHex = /^[0-9A-Fa-f]+$/.test(response.data.audio);
        const pcmBuffer = isHex
          ? Buffer.from(response.data.audio, "hex")
          : Buffer.from(response.data.audio, "base64");

        // Convert PCM-16 to Twilio's Mu-Law format
        const muLawBuffer = pcm16ToMuLaw(pcmBuffer);

        // Pipe it directly back to the active phone call
        twilioSocket.send(
          JSON.stringify({
            event: "media",
            streamSid: streamSid,
            media: {
              payload: muLawBuffer.toString("base64"),
            },
          }),
        );
      }
    }

    if (response.event === "task_failed") {
      console.error("MiniMax Task Failed Details:", response);
    }
  });

  minimaxWs.on("error", (error) => {
    console.error("MiniMax WebSocket error:", error);
  });

  minimaxWs.on("close", () => {
    console.log("MiniMax stream finished.");
  });
}
