/**
 * Bourses des acteurs.
 *
 * Mint est agnostique : chaque devise est stockée dans un flag de l'acteur, sauf si elle
 * a un « champ de fiche » (sheetKey) et que le chemin de fiche est réglé ; elle est alors
 * lue et écrite directement sur la fiche du système (ex. system.currency.gp pour dnd5e),
 * pour rester synchronisée avec ce que les joueurs voient sur leur fiche.
 */

import { MODULE_ID, SETTINGS, FLAG_WALLET, MintError, t, esc } from "./constants.js";
import { getConfig, getSystem, denoms, format, formatPurse } from "./currencies.js";
import { count, walletValue, removeCoins, addCoins, pay, breakdown, exchangeValue } from "./core/money.js";
import { registerHandler, gmCall } from "./socket.js";
import { logTransaction } from "./chat.js";

/* -------------------------------------------- */
/*  Lecture et écriture                         */
/* -------------------------------------------- */

/** Chemin de la fiche où lire les devises reliées (« » = tout est stocké par Mint). */
export function sheetPath() {
  const value = game.settings.get(MODULE_ID, SETTINGS.sheetPath);
  if (value === "auto") return game.system.id === "dnd5e" ? "system.currency" : "";
  return String(value ?? "").trim();
}

function sheetField(currency) {
  const path = sheetPath();
  return path && currency.sheetKey ? `${path}.${currency.sheetKey}` : null;
}

/** Bourse complète d'un acteur : { [idDevise]: nombre }. */
export function getWallet(actor) {
  const flags = actor?.flags?.[MODULE_ID]?.[FLAG_WALLET] ?? {};
  const out = {};
  for (const c of getConfig().currencies) {
    const field = sheetField(c);
    const fromSheet = field ? foundry.utils.getProperty(actor, field) : undefined;
    out[c.id] = count(typeof fromSheet === "number" || typeof fromSheet === "string" ? fromSheet : flags[c.id]);
  }
  return out;
}

/** Données de mise à jour d'acteur pour écrire une bourse. */
export function walletUpdateData(wallet) {
  const data = {};
  for (const c of getConfig().currencies) {
    if (!(c.id in wallet)) continue;
    const n = count(wallet[c.id]);
    const field = sheetField(c);
    if (field) data[field] = n;
    data[`flags.${MODULE_ID}.${FLAG_WALLET}.${c.id}`] = n;
  }
  return data;
}

export async function setWallet(actor, wallet) {
  await actor.update(walletUpdateData(wallet));
}

/** Valeur totale d'un acteur dans un système. */
export function actorValue(actor, systemId) {
  return walletValue(getWallet(actor), denoms(systemId));
}

/* -------------------------------------------- */
/*  Acteurs et droits                           */
/* -------------------------------------------- */

/** Acteur à partir d'un UUID (acteur du monde ou de token). */
export async function resolveActor(uuid) {
  const doc = uuid ? await fromUuid(uuid) : null;
  if (!(doc instanceof Actor)) throw new MintError("NoActor");
  return doc;
}

export function userOwns(user, actor) {
  return !!actor && (user.isGM || actor.testUserPermission(user, "OWNER"));
}

export function requireOwner(user, actor) {
  if (!userOwns(user, actor)) throw new MintError("NotOwner", { name: actor?.name ?? "?" });
}

/** Joueurs (non-MJ) propriétaires d'un acteur. */
export function playerOwners(actor) {
  if (!actor) return [];
  return game.users.filter((u) => !u.isGM && actor.testUserPermission(u, "OWNER"));
}

/** Acteurs que l'utilisateur courant peut gérer. */
export function ownedActors() {
  const list = game.actors.filter((a) => a.isOwner && (game.user.isGM || a.testUserPermission(game.user, "OWNER")));
  return list.sort((a, b) => a.name.localeCompare(b.name));
}

/** Acteur par défaut de l'utilisateur. */
export function defaultActor() {
  const controlled = canvas?.tokens?.controlled?.[0]?.actor;
  if (controlled?.isOwner) return controlled;
  if (game.user.character) return game.user.character;
  return ownedActors().find((a) => a.hasPlayerOwner) ?? ownedActors()[0] ?? null;
}

/** Destinataires possibles d'un don : personnages des joueurs et acteurs des tokens de la scène. */
export function giftTargets(excludeUuid) {
  const map = new Map();
  for (const a of game.actors) if (a.hasPlayerOwner || game.user.isGM) map.set(a.uuid, a);
  for (const tok of canvas?.scene?.tokens ?? []) if (tok.actor) map.set(tok.actor.uuid, tok.actor);
  map.delete(excludeUuid);
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/* -------------------------------------------- */
/*  Utilitaires côté MJ                         */
/* -------------------------------------------- */

function cleanCoins(coins) {
  const known = new Set(getConfig().currencies.map((c) => c.id));
  const out = {};
  for (const [id, n] of Object.entries(coins ?? {})) if (known.has(id) && count(n)) out[id] = count(n);
  return out;
}

/** Fait payer une somme à un acteur (monnaie rendue) et retourne les pièces données. */
export async function chargeActor(actor, value, systemId) {
  const result = pay(getWallet(actor), denoms(systemId), value);
  if (!result) {
    throw new MintError("NotEnough", { name: actor.name, amount: format(value, systemId) });
  }
  await setWallet(actor, result.wallet);
  return result;
}

/** Crédite une somme à un acteur, en pièces les plus fortes. */
export async function creditActor(actor, value, systemId) {
  const { coins } = breakdown(value, denoms(systemId));
  await setWallet(actor, addCoins(getWallet(actor), coins));
  return coins;
}

/* -------------------------------------------- */
/*  Opérations (exécutées par le MJ)            */
/* -------------------------------------------- */

registerHandler("wallet.give", async ({ fromUuid, toUuid, coins }, user) => {
  const from = await resolveActor(fromUuid);
  const to = await resolveActor(toUuid);
  requireOwner(user, from);
  if (from.uuid === to.uuid) throw new MintError("SameActor");
  const given = cleanCoins(coins);
  if (!Object.keys(given).length) throw new MintError("NothingToGive");
  const left = removeCoins(getWallet(from), given);
  if (!left) throw new MintError("NotEnoughCoins", { name: from.name });
  await setWallet(from, left);
  await setWallet(to, addCoins(getWallet(to), given));
  const text = groupedText(given);
  await logTransaction(t("Chat.Give", { from: esc(from.name), to: esc(to.name), amount: esc(text) }), { icon: "fa-hand-holding-dollar" });
  return { coins: given };
});

/**
 * Change : l'acteur donne `amount` (unités de base du système de départ, null = tout ce qu'il a
 * dans ce système) au changeur, qui rend la monnaie dans le système de départ et verse
 * l'équivalent, frais déduits, dans le système d'arrivée.
 */
registerHandler("wallet.exchange", async ({ actorUuid, fromSystem, toSystem, amount }, user) => {
  const actor = await resolveActor(actorUuid);
  requireOwner(user, actor);
  const from = getSystem(fromSystem);
  const to = getSystem(toSystem);
  if (!from || !to || to.id === from.id) throw new MintError("SameSystem");
  const wallet = getWallet(actor);
  const value = amount === null || amount === undefined ? walletValue(wallet, denoms(from.id)) : count(amount);
  if (!(value > 0)) throw new MintError("BadAmount");
  const obtained = exchangeValue(value, from.rate, to.rate, getConfig().fee);
  if (obtained <= 0) throw new MintError("ExchangeTooSmall");
  const paid = pay(wallet, denoms(from.id), value);
  if (!paid) throw new MintError("NotEnough", { name: actor.name, amount: format(value, from.id) });
  const { coins: received } = breakdown(obtained, denoms(to.id));
  await setWallet(actor, addCoins(paid.wallet, received));
  await logTransaction(
    t("Chat.Exchange", {
      name: esc(actor.name),
      given: esc(format(value, from.id)),
      received: esc(formatPurse(received, to.id))
    }),
    { icon: "fa-scale-balanced" }
  );
  return { received };
});

registerHandler("wallet.consolidate", async ({ actorUuid, systemId }, user) => {
  const actor = await resolveActor(actorUuid);
  requireOwner(user, actor);
  const d = denoms(systemId);
  const wallet = getWallet(actor);
  const { coins, remainder } = breakdown(walletValue(wallet, d), d);
  // Avec des pièces aux valeurs inhabituelles (ex. 3 et 5), le regroupement glouton peut perdre de la valeur
  if (remainder) throw new MintError("CannotConsolidate");
  const next = { ...wallet };
  for (const c of d) next[c.id] = coins[c.id] ?? 0;
  await setWallet(actor, next);
  return { coins };
});

registerHandler("wallet.set", async ({ actorUuid, wallet }, user) => {
  if (!user.isGM) throw new MintError("GMOnly");
  const actor = await resolveActor(actorUuid);
  const next = { ...getWallet(actor) };
  for (const [id, n] of Object.entries(wallet ?? {})) if (id in next) next[id] = count(n);
  await setWallet(actor, next);
  return {};
});

/** Texte « 2 po 5 pa » de pièces de plusieurs systèmes. */
export function groupedText(coins) {
  const systems = [...new Set(Object.keys(coins).map((id) => getConfig().currencies.find((c) => c.id === id)?.system))];
  return systems.map((s) => formatPurse(coins, s)).join(" + ");
}

/* -------------------------------------------- */
/*  Appels côté client                          */
/* -------------------------------------------- */

export const walletApi = {
  give: (fromUuid, toUuid, coins) => gmCall("wallet.give", { fromUuid, toUuid, coins }),
  exchange: (actorUuid, fromSystem, toSystem, amount = null) => gmCall("wallet.exchange", { actorUuid, fromSystem, toSystem, amount }),
  consolidate: (actorUuid, systemId) => gmCall("wallet.consolidate", { actorUuid, systemId }),
  set: (actorUuid, wallet) => gmCall("wallet.set", { actorUuid, wallet })
};
