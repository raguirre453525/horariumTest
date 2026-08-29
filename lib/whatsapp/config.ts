import "server-only";

export function getWhatsappConfig() {
  return {
    verifyToken: process.env.WHATSAPP_VERIFY_TOKEN ?? "",
    appSecret: process.env.WHATSAPP_APP_SECRET ?? "",
    accessToken: process.env.WHATSAPP_ACCESS_TOKEN ?? "",
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID ?? "",
    graphVersion: process.env.WHATSAPP_GRAPH_VERSION ?? "v21.0",
    deepseekApiKey: process.env.DEEPSEEK_API_KEY ?? "",
    deepseekBaseUrl: (process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com").replace(/\/$/, ""),
    deepseekModel: process.env.DEEPSEEK_MODEL ?? "deepseek-chat",
    timezone: process.env.HORARIUM_TIMEZONE ?? "America/Argentina/Buenos_Aires",
  };
}

export const HORARIUM_TIMEZONE = process.env.HORARIUM_TIMEZONE ?? "America/Argentina/Buenos_Aires";
