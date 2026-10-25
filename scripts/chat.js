/** Journal des transactions dans le chat (réglage « chatLog » : off, gm ou all). */

import { MODULE_ID, SETTINGS, esc } from "./constants.js";

export async function logTransaction(text, { icon = "fa-coins", speaker = null } = {}) {
  const mode = game.settings.get(MODULE_ID, SETTINGS.chatLog);
  if (mode === "off") return;
  const data = {
    content: `<div class="mint-chat"><i class="fa-solid ${esc(icon)}"></i> ${text}</div>`,
    speaker: speaker ? ChatMessage.getSpeaker({ actor: speaker }) : ChatMessage.getSpeaker({ alias: "Mint" })
  };
  if (mode === "gm") data.whisper = ChatMessage.getWhisperRecipients("GM").map((u) => u.id);
  try {
    await ChatMessage.create(data);
  } catch (err) {
    console.warn("Mint | message de chat impossible", err);
  }
}
