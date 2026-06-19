/**
 * Telegram alerting utility.
 * Sends messages via the Telegram Bot API when TELEGRAM_BOT_TOKEN and
 * TELEGRAM_CHAT_ID are configured. Chat IDs can be comma-separated.
 */

export interface TelegramConfig {
  enabled: boolean;
  botToken?: string;
  chatIds: string[];
}

export function getTelegramConfig(): TelegramConfig {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const rawChatIds = process.env.TELEGRAM_CHAT_ID;
  const chatIds = rawChatIds
    ? rawChatIds
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean)
    : [];
  const enabled =
    Boolean(botToken) &&
    chatIds.length > 0 &&
    process.env.TELEGRAM_ENABLED !== "false";
  return { enabled, botToken, chatIds };
}

export async function sendTelegramMessage(
  text: string,
  options?: { disableNotification?: boolean }
): Promise<void> {
  const cfg = getTelegramConfig();
  if (!cfg.enabled || !cfg.botToken) {
    return;
  }

  const url = `https://api.telegram.org/bot${cfg.botToken}/sendMessage`;
  const body = {
    chat_id: cfg.chatIds[0],
    text,
    parse_mode: "HTML",
    disable_notification: options?.disableNotification ?? false,
  };

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.text();
      console.warn(`[telegram] send failed: ${res.status} ${err}`);
    } else {
      // Send to any additional chat IDs.
      for (const chatId of cfg.chatIds.slice(1)) {
        fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...body, chat_id: chatId }),
        }).catch((e) => console.warn(`[telegram] secondary send failed: ${e.message}`));
      }
    }
  } catch (e: any) {
    console.warn(`[telegram] send error: ${e.message}`);
  }
}
