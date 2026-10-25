/**
 * Historique des transactions.
 *
 * Stocké dans le réglage de monde « history » : { entries: [...] }, du plus récent au plus ancien,
 * limité au nombre d'entrées du réglage « historySize ».
 * Entrée : { id, ts (date réelle), worldTime, type, icon, text, actors: [uuid], amount, system }
 */

import { MODULE_ID, SETTINGS, MintError, worldTime } from "./constants.js";
import { registerHandler, gmCall } from "./socket.js";

/** Types d'entrées que les joueurs peuvent ajouter eux-mêmes (modules tiers comme Otium). */
const PLAYER_TYPES = new Set(["otium"]);

export function getHistory() {
  return foundry.utils.deepClone(game.settings.get(MODULE_ID, SETTINGS.history)?.entries ?? []);
}

/** Entrées qui concernent un acteur. */
export function historyFor(actor) {
  if (!actor) return [];
  return getHistory().filter((e) => e.actors?.includes(actor.uuid));
}

/** Texte brut (sans balises) pour l'historique. */
export function plainText(html) {
  return String(html ?? "")
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

/** Ajoute une entrée (à appeler côté MJ actif). */
export async function addHistory({ type = "misc", icon = "fa-coins", text = "", actors = [], amount = null, system = null } = {}) {
  const size = Math.max(0, Number(game.settings.get(MODULE_ID, SETTINGS.historySize)) || 0);
  if (!size) return;
  const entries = getHistory();
  entries.unshift({
    id: foundry.utils.randomID(),
    ts: Date.now(),
    worldTime: worldTime(),
    type: String(type),
    icon: String(icon),
    text: plainText(text).slice(0, 500),
    actors: [...new Set(actors.filter(Boolean))],
    amount: Number.isFinite(Number(amount)) && amount !== null ? Math.floor(Number(amount)) : null,
    system
  });
  await game.settings.set(MODULE_ID, SETTINGS.history, { entries: entries.slice(0, size) });
}

export async function clearHistory() {
  await game.settings.set(MODULE_ID, SETTINGS.history, { entries: [] });
}

/** Exporte l'historique (ou celui d'un acteur) en CSV. */
export function exportCsv(entries, filename = "mint-historique.csv") {
  const cell = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines = [["date", "type", "texte", "montant", "monnaie"].map(cell).join(",")];
  for (const e of entries) {
    lines.push([new Date(e.ts).toISOString(), e.type, e.text, e.amount ?? "", e.system ?? ""].map(cell).join(","));
  }
  foundry.utils.saveDataToFile(lines.join("\n"), "text/csv", filename);
}

/* -------------------------------------------- */
/*  Opérations (exécutées par le MJ)            */
/* -------------------------------------------- */

/** Un joueur ajoute une entrée pour un de ses personnages (ex. commande Otium). */
registerHandler("history.add", async (data, user) => {
  if (!user.isGM && !PLAYER_TYPES.has(data?.type)) throw new MintError("GMOnly");
  const actors = [];
  for (const uuid of data?.actors ?? []) {
    const actor = uuid ? await fromUuid(uuid) : null;
    if (actor instanceof Actor && (user.isGM || actor.testUserPermission(user, "OWNER"))) actors.push(actor.uuid);
  }
  if (!actors.length) throw new MintError("NotOwner", { name: "?" });
  await addHistory({ ...data, actors });
  return {};
});

export const historyApi = {
  add: (entry) => gmCall("history.add", entry),
  get: getHistory,
  for: historyFor
};
