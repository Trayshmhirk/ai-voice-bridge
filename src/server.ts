import Fastify from "fastify";
import fastifyWebsocket from "@fastify/websocket";
import dotenv from "dotenv";
import { createDeepgramConnection } from "./deepgramService";
import { handleN8nLogic } from "./n8nService";
import { streamMiniMaxAudio } from "./minimaxService";

dotenv.config();

const fastify = Fastify({ logger: true });
fastify.register(fastifyWebsocket);

// Railway Health Check Route
fastify.get("/", async (request, reply) => {
  return { status: "PollyBot Voice Bridge is awake and healthy!" };
});

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

        // 👉 INJECTED LOGGING: See exactly what n8n returns
        fastify.log.info(`[Brain] n8n returned: "${aiResponseText}"`);

        // 6. Send AI text to MiniMax only if we have actual text
        if (streamSid) {
          if (aiResponseText && aiResponseText.trim().length > 0) {
            streamMiniMaxAudio(aiResponseText, streamSid, connection as any);
          } else {
            fastify.log.warn(
              "[Voice] Skipped MiniMax because n8n returned empty text.",
            );
          }
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
    // Railway dynamically injects the PORT variable
    const port = Number(process.env.PORT) || 3000;

    // Host MUST be 0.0.0.0 for cloud providers
    await fastify.listen({ port: port, host: "0.0.0.0" });

    console.log(`Server listening proudly on port ${port}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
