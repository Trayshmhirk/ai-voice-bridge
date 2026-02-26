import Fastify from "fastify";
import fastifyWebsocket from "@fastify/websocket";
import dotenv from "dotenv";
import { createDeepgramConnection } from "./deepgramService";
import { handleN8nLogic } from "./n8nService";
import { streamMiniMaxAudio } from "./minimaxService";

dotenv.config();

const fastify = Fastify({ logger: true });
fastify.register(fastifyWebsocket);

fastify.register(async function (fastify) {
  fastify.get("/twilio-stream", { websocket: true }, (connection, req) => {
    fastify.log.info("Twilio connected to WebSocket bridge");

    let streamSid: string | null = null;

    // 1. Initialize Deepgram connection here
    const deepgramLive = createDeepgramConnection();

    connection.on("message", async (message: any) => {
      const data = JSON.parse(message.toString());

      if (data.event === "start") {
        streamSid = data.start.streamSid;
        fastify.log.info(`Stream started: ${streamSid}`);
      }

      if (data.event === "media") {
        // 2. Extract base64 audio payload from Twilio
        const audioPayload = Buffer.from(data.media.payload, "base64");

        // 3. Send raw audio to Deepgram
        if (deepgramLive.getReadyState() === 1) {
          deepgramLive.send(audioPayload as any);
        }
      }

      if (data.event === "stop") {
        fastify.log.info("Twilio stream stopped");
        deepgramLive.finish();
      }
    });

    // 4. Listen for Deepgram transcript results
    deepgramLive.addListener("Results", async (data) => {
      const transcript = data.channel.alternatives[0].transcript;
      const isFinal = data.is_final;

      if (transcript && isFinal) {
        fastify.log.info(`User said: ${transcript}`);

        // 5. Send transcript to n8n to get the AI response
        const aiResponseText = await handleN8nLogic(
          transcript,
          streamSid || "unknown_session",
        );

        // 6. Send AI text to MiniMax and pipe the returning audio directly to Twilio
        if (streamSid) {
          streamMiniMaxAudio(aiResponseText, streamSid, connection as any);
        }
      }
    });

    connection.on("close", () => {
      fastify.log.info("Twilio disconnected");
      deepgramLive.finish();
    });
  });
});

const start = async () => {
  try {
    await fastify.listen({
      port: Number(process.env.PORT) || 3000,
      host: "0.0.0.0",
    });
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
