import axios from "axios";

export async function handleN8nLogic(
  transcript: string,
  sessionId: string,
): Promise<string> {
  const webhookUrl = process.env.N8N_WEBHOOK_URL;

  if (!webhookUrl) {
    throw new Error("N8N_WEBHOOK_URL is missing from environment variables.");
  }

  try {
    // 1. Send the POST request to n8n
    const response = await axios.post(
      webhookUrl,
      {
        text: transcript,
        sessionId: sessionId,
      },
      {
        headers: { "Content-Type": "application/json" },
      },
    );

    // 👉 INJECTED LOGGING: Log the raw data object from n8n
    console.log("[n8n Raw Response]:", JSON.stringify(response.data));

    // 2. Extract the response
    // NOTE: You will need to map this to the exact JSON key your n8n "Respond to Webhook" node outputs.
    const aiResponseText = response.data.response;

    return aiResponseText;
  } catch (error) {
    console.error("Error communicating with n8n:", error);
    // A polite fallback in Serbian just in case the n8n server times out
    return "Izvinite, trenutno imam tehničkih problema.";
  }
}
