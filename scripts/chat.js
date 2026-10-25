/**
 * Journal des transactions : historique de Mint (toujours) et chat (réglage « chatLog » : off, gm ou all).
 */

import { MODULE_ID, SETTINGS, esc } from "./constants.js";
import { addHistory } from "./history.js";

/**
 * @param {string} text  HTML (noms déjà échappés)
 * @param {object} meta  icon, type, actors (UUID des acteurs concernés), amount, system, speaker
 */
export async function logTransaction(text, { icon = "fa-coins", speaker = null, type = "misc", actors = [], amount = null, system = null } = {}) {
  try {
    await addHistory({ type, icon, text, actors, amount, system });
  } catch (err) {
    console.warn("Mint | historique impossible", err);
  }

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
