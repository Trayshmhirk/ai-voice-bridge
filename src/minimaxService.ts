import WebSocket from "ws";
import dotenv from "dotenv";

dotenv.config();

/**
 * PCM-16 (16kHz) to Twilio Mu-Law (8kHz) Converter
 * Downsamples by AVERAGING pairs of adjacent samples instead of skipping.
 * Averaging acts as a simple low-pass filter, preventing the aliasing
 * distortion (muffled/buzzy sound) caused by naive sample-skipping.
 */
function pcm16ToMuLaw(pcm16Buffer: Buffer): Buffer {
  // Each output sample = average of 2 input samples (16kHz -> 8kHz)
  // Each PCM16 sample = 2 bytes, so we step 4 bytes per output sample
  const outputLength = Math.floor(pcm16Buffer.length / 4);
  const muLawBuffer = Buffer.alloc(outputLength);
  const VOLUME_BOOST = 1.5;

  for (let i = 0; i < outputLength; i++) {
    // Average two adjacent 16kHz samples to produce one 8kHz sample
    const sampleA = pcm16Buffer.readInt16LE(i * 4);
    const sampleB = pcm16Buffer.readInt16LE(i * 4 + 2);
    let sample = Math.round((sampleA + sampleB) / 2);

    // Apply digital gain
    sample = Math.round(sample * VOLUME_BOOST);

    // Clip to prevent distortion
    if (sample > 32767) sample = 32767;
    else if (sample < -32768) sample = -32768;

    // Standard ITU G.711 Mu-Law compression
    let sign = (sample >> 8) & 0x80;
    if (sign !== 0) sample = -sample;

    sample += 132;
    if (sample > 32767) sample = 32767;

    let exponent = 7;
    for (let mask = 0x4000; (sample & mask) === 0 && exponent > 0; mask >>= 1) {
      exponent--;
    }

    const mantissa = (sample >> (exponent + 3)) & 0x0f;
    muLawBuffer[i] = ~(sign | (exponent << 4) | mantissa);
  }
  return muLawBuffer;
}

// NEW EXPORT: Returns an object that lets us push chunks in real-time
export function createMiniMaxStream(
  streamSid: string,
  twilioSocket: WebSocket,
) {
  const groupId = process.env.MINIMAX_GROUP_ID;
  const apiKey = process.env.MINIMAX_API_KEY;

  let isReady = false;
  let isFinished = false;
  let textQueue: string[] = [];

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

    minimaxWs.send(
      JSON.stringify({
        event: "task_start",
        model: "speech-2.8-hd",
        voice_setting: {
          voice_id: "moss_audio_f2f64e31-0360-11f1-9cb8-d2836630c025",
          speed: 1.0,
          vol: 1.2,
          pitch: 0,
        },
        audio_setting: {
          sample_rate: 16000, // Request 16kHz for proper downsampling to 8kHz
          bitrate: 128000,
          format: "pcm",
          channel: 1,
        },
      }),
    );
  });

  minimaxWs.on("message", (data: WebSocket.Data) => {
    const response = JSON.parse(data.toString());

    if (response.event === "task_started") {
      isReady = true;
      // If Gemini thought of words before MiniMax was ready, send them now
      while (textQueue.length > 0) {
        minimaxWs.send(
          JSON.stringify({ event: "task_continue", text: textQueue.shift() }),
        );
      }
      if (isFinished) {
        minimaxWs.send(JSON.stringify({ event: "task_finish" }));
      }
    }

    if (response.event === "task_continued") {
      if (response.data?.audio?.length > 0) {
        const isHex = /^[0-9A-Fa-f]+$/.test(response.data.audio);
        const pcmBuffer = isHex
          ? Buffer.from(response.data.audio, "hex")
          : Buffer.from(response.data.audio, "base64");

        // Use the new 16k -> 8k converter
        const muLawBuffer = pcm16ToMuLaw(pcmBuffer);

        // Stream audio directly into Twilio's ear immediately
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
  });

  return {
    pushText: (textChunk: string) => {
      if (isReady) {
        minimaxWs.send(
          JSON.stringify({ event: "task_continue", text: textChunk }),
        );
      } else {
        textQueue.push(textChunk);
      }
    },
    finish: () => {
      if (isReady) {
        minimaxWs.send(JSON.stringify({ event: "task_finish" }));
      } else {
        isFinished = true; // Mark to finish once it connects
      }
    },
  };
}
