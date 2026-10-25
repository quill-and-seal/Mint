/**
 * Paiements pour les autres modules (Otium, mini-jeux, macros) et cagnottes de mises.
 *
 * Une cagnotte réunit les mises de plusieurs personnages, puis le module de jeu la
 * distribue aux gagnants (ou rembourse tout le monde). L'argent misé quitte la bourse
 * au moment de la mise : il est gardé par Mint jusqu'au règlement.
 *
 * Cagnottes, dans le réglage de monde « pots » : { [id]: cagnotte }.
 * Cagnotte : { id, label, system, owner (utilisateur qui l'a créée), status: "open" | "settled" | "refunded",
 *              stakes: [{ actor, name, amount }], createdAt, settledAt, source }
 */

import { MODULE_ID, SETTINGS, MintError, t, esc } from "./constants.js";
import { getSystem, defaultSystemId, format } from "./currencies.js";
import { registerHandler, gmCall } from "./socket.js";
import { resolveActor, requireOwner, chargeActor, creditActor } from "./wallet.js";
import { logTransaction } from "./chat.js";

export function getPots() {
  return foundry.utils.deepClone(game.settings.get(MODULE_ID, SETTINGS.pots) ?? {});
}

async function savePots(pots) {
  await game.settings.set(MODULE_ID, SETTINGS.pots, pots);
}

export function potTotal(pot) {
  return (pot?.stakes ?? []).reduce((sum, s) => sum + (Number(s.amount) || 0), 0);
}

function loadOpen(id, user) {
  const pots = getPots();
  const pot = pots[id];
  if (!pot) throw new MintError("NoPot");
  if (pot.status !== "open") throw new MintError("PotClosed");
  const canManage = user.isGM || pot.owner === user.id;
  return { pots, pot, canManage };
}

const amountOf = (v) => {
  const n = Math.floor(Number(v));
  if (!(n > 0)) throw new MintError("BadAmount");
  return n;
};

/* -------------------------------------------- */
/*  Paiements simples                           */
/* -------------------------------------------- */

/** Fait payer un personnage (monnaie rendue). Le joueur doit posséder le personnage. */
registerHandler("bridge.pay", async ({ actorUuid, amount, system, reason, source }, user) => {
  const actor = await resolveActor(actorUuid);
  requireOwner(user, actor);
  const sys = getSystem(system)?.id ?? defaultSystemId();
  const value = amountOf(amount);
  await chargeActor(actor, value, sys);
  await logTransaction(t("Chat.Pay", { name: esc(actor.name), amount: esc(format(value, sys)), reason: esc(reason ?? source ?? "") }), {
    icon: "fa-money-bill-wave",
    type: source || "pay",
    actors: [actor.uuid],
    amount: value,
    system: sys
  });
  return { amount: value };
});

/** Verse de l'argent à un personnage (gains, salaire, pourboire…). MJ uniquement. */
registerHandler("bridge.receive", async ({ actorUuid, amount, system, reason, source }, user) => {
  if (!user.isGM) throw new MintError("GMOnly");
  const actor = await resolveActor(actorUuid);
  const sys = getSystem(system)?.id ?? defaultSystemId();
  const value = amountOf(amount);
  await creditActor(actor, value, sys);
  await logTransaction(t("Chat.Receive", { name: esc(actor.name), amount: esc(format(value, sys)), reason: esc(reason ?? source ?? "") }), {
    icon: "fa-hand-holding-dollar",
    type: source || "receive",
    actors: [actor.uuid],
    amount: value,
    system: sys
  });
  return { amount: value };
});

/* -------------------------------------------- */
/*  Cagnottes                                   */
/* -------------------------------------------- */

registerHandler("pot.create", async ({ label, system, source }, user) => {
  const pots = getPots();
  const id = foundry.utils.randomID();
  pots[id] = {
    id,
    label: String(label ?? "").slice(0, 120) || t("Pot.Default"),
    system: getSystem(system)?.id ?? defaultSystemId(),
    owner: user.id,
    source: String(source ?? ""),
    status: "open",
    stakes: [],
    createdAt: Date.now(),
    settledAt: null
  };
  await savePots(pots);
  return { id };
});

registerHandler("pot.stake", async ({ id, actorUuid, amount }, user) => {
  const { pots, pot } = loadOpen(id, user);
  const actor = await resolveActor(actorUuid);
  requireOwner(user, actor);
  const value = amountOf(amount);
  await chargeActor(actor, value, pot.system);
  const existing = pot.stakes.find((s) => s.actor === actor.uuid);
  if (existing) existing.amount += value;
  else pot.stakes.push({ actor: actor.uuid, name: actor.name, amount: value });
  await savePots(pots);
  await logTransaction(t("Chat.Stake", { name: esc(actor.name), amount: esc(format(value, pot.system)), pot: esc(pot.label) }), {
    icon: "fa-dice",
    type: "stake",
    actors: [actor.uuid],
    amount: value,
    system: pot.system
  });
  return { total: potTotal(pot) };
});

/**
 * Distribue la cagnotte. winners : [{ actorUuid, share }] (parts relatives, 1 par défaut).
 * Le reste de la division va au premier gagnant.
 */
registerHandler("pot.settle", async ({ id, winners }, user) => {
  const { pots, pot, canManage } = loadOpen(id, user);
  if (!canManage) throw new MintError("NotPotOwner");
  const list = (winners ?? []).filter((w) => w?.actorUuid);
  if (!list.length) throw new MintError("NoWinner");
  const total = potTotal(pot);
  const shares = list.map((w) => Math.max(0, Number(w.share ?? 1) || 0));
  const sum = shares.reduce((a, b) => a + b, 0) || 1;
  const amounts = shares.map((s) => Math.floor((total * s) / sum));
  amounts[0] += total - amounts.reduce((a, b) => a + b, 0);

  const paid = [];
  for (let i = 0; i < list.length; i++) {
    const actor = await resolveActor(list[i].actorUuid);
    if (amounts[i] > 0) await creditActor(actor, amounts[i], pot.system);
    paid.push({ actor: actor.uuid, name: actor.name, amount: amounts[i] });
  }
  pot.status = "settled";
  pot.settledAt = Date.now();
  pot.winners = paid;
  await savePots(pots);
  await logTransaction(
    t("Chat.Settle", {
      pot: esc(pot.label),
      winners: paid.map((p) => `<strong>${esc(p.name)}</strong> (${esc(format(p.amount, pot.system))})`).join(", ")
    }),
    { icon: "fa-trophy", type: "settle", actors: [...pot.stakes.map((s) => s.actor), ...paid.map((p) => p.actor)], amount: total, system: pot.system }
  );
  return { paid };
});

registerHandler("pot.refund", async ({ id }, user) => {
  const { pots, pot, canManage } = loadOpen(id, user);
  if (!canManage) throw new MintError("NotPotOwner");
  for (const stake of pot.stakes) {
    const actor = await fromUuid(stake.actor);
    if (actor instanceof Actor && stake.amount > 0) await creditActor(actor, stake.amount, pot.system);
  }
  pot.status = "refunded";
  pot.settledAt = Date.now();
  await savePots(pots);
  await logTransaction(t("Chat.Refund", { pot: esc(pot.label) }), {
    icon: "fa-rotate-left",
    type: "refund",
    actors: pot.stakes.map((s) => s.actor),
    amount: potTotal(pot),
    system: pot.system
  });
  return {};
});

/* -------------------------------------------- */
/*  Appels côté client                          */
/* -------------------------------------------- */

export const bridgeApi = {
  /** Fait payer `amount` (unités de base) à un personnage du joueur. */
  pay: (actor, amount, { system = null, reason = "", source = "" } = {}) =>
    gmCall("bridge.pay", { actorUuid: actor?.uuid ?? actor, amount, system, reason, source }),
  /** Verse `amount` à un personnage (MJ). */
  receive: (actor, amount, { system = null, reason = "", source = "" } = {}) =>
    gmCall("bridge.receive", { actorUuid: actor?.uuid ?? actor, amount, system, reason, source })
};

export const potApi = {
  create: ({ label = "", system = null, source = "" } = {}) => gmCall("pot.create", { label, system, source }),
  stake: (id, actor, amount) => gmCall("pot.stake", { id, actorUuid: actor?.uuid ?? actor, amount }),
  settle: (id, winners) =>
    gmCall("pot.settle", {
      id,
      winners: (winners ?? []).map((w) => (typeof w === "string" || w?.uuid ? { actorUuid: w?.uuid ?? w } : { ...w, actorUuid: w.actorUuid ?? w.actor?.uuid ?? w.actor }))
    }),
  refund: (id) => gmCall("pot.refund", { id }),
  get: (id) => getPots()[id] ?? null,
  total: (id) => potTotal(getPots()[id])
};
