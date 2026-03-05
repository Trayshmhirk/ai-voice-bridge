import WebSocket from "ws";
import dotenv from "dotenv";

dotenv.config();

/**
 * Creates a stateful audio converter.
 * It remembers the "previousSample" across chunks to prevent static clicks,
 * and applies a Pre-Emphasis filter to boost treble clarity over phone lines.
 */
function createMuLawConverter() {
  let previousSample = 0;

  // THE SHARPNESS DIAL: 0.40 for a balanced treble boost
  // Keeps the clarity but kills the metallic echo.
  const ALPHA = 0.4;
  const VOLUME_BOOST = 1.5;

  return function pcm16ToMuLaw(pcm16Buffer: Buffer): Buffer {
    const outputLength = Math.floor(pcm16Buffer.length / 4);
    const muLawBuffer = Buffer.alloc(outputLength);

    for (let i = 0; i < outputLength; i++) {
      // 1. Downsample 16kHz to 8kHz by averaging
      const sampleA = pcm16Buffer.readInt16LE(i * 4);
      const sampleB = pcm16Buffer.readInt16LE(i * 4 + 2);
      let currentSample = Math.round((sampleA + sampleB) / 2);

      // 2. Apply Pre-emphasis (Treble Boost) Formula
      let filteredSample = currentSample - ALPHA * previousSample;
      previousSample = currentSample; // Save for the next loop

      // 3. Apply Digital Gain
      let sample = Math.round(filteredSample * VOLUME_BOOST);

      // 4. Clip to prevent distortion
      if (sample > 32767) sample = 32767;
      else if (sample < -32768) sample = -32768;

      // 5. Mu-Law compression (ITU G.711)
      let sign = (sample >> 8) & 0x80;
      if (sign !== 0) sample = -sample;

      sample += 132;
      if (sample > 32767) sample = 32767;

      let exponent = 7;
      for (
        let mask = 0x4000;
        (sample & mask) === 0 && exponent > 0;
        mask >>= 1
      ) {
        exponent--;
      }

      const mantissa = (sample >> (exponent + 3)) & 0x0f;
      muLawBuffer[i] = ~(sign | (exponent << 4) | mantissa);
    }
    return muLawBuffer;
  };
}

export function createMiniMaxStream(
  streamSid: string,
  twilioSocket: WebSocket,
) {
  const groupId = process.env.MINIMAX_GROUP_ID;
  const apiKey = process.env.MINIMAX_API_KEY;

  let isReady = false;
  let isFinished = false;
  let textQueue: string[] = [];

  // Initialize the converter for this specific phone call
  const pcm16ToMuLaw = createMuLawConverter();

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
          sample_rate: 16000,
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
      while (textQueue.length > 0) {
        const chunk = textQueue.shift();
        if (chunk) {
          minimaxWs.send(
            JSON.stringify({ event: "task_continue", text: chunk }),
          );
        }
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

        // Convert the audio using our new Treble Boost function
        const muLawBuffer = pcm16ToMuLaw(pcmBuffer);

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
        isFinished = true;
      }
    },
  };
}
