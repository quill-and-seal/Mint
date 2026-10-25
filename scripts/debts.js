/**
 * Prêts et dettes.
 *
 * Stockés dans le réglage de monde « debts » : { [id]: dette }.
 * Dette : {
 *   id, creditor: { uuid, name }, debtor: { uuid, name },   // uuid null = partie libre (banque, PNJ…), MJ seulement
 *   principal, system, rate (% par période), periodDays,
 *   transfer   : le capital est versé du créancier au débiteur à l'acceptation (prêt) ;
 *                sinon, simple reconnaissance de dette
 *   status     : "proposed" | "active" | "closed"
 *   closedReason: "repaid" | "forgiven" | "cancelled" | "refused" | "withdrawn"
 *   awaiting   : "creditor" | "debtor" (partie qui doit accepter une proposition)
 *   proposedBy : id de l'utilisateur, imposed : créée par le MJ
 *   start      : temps du monde au début du prêt (intérêts), repaid : déjà remboursé
 *   note, createdAt, closedAt
 * }
 */

import { MODULE_ID, SETTINGS, MintError, t, esc, worldTime, secondsPerDay } from "./constants.js";
import { getSystem, defaultSystemId, format } from "./currencies.js";
import { amountOwed } from "./core/interest.js";
import { registerHandler, gmCall, notifyUsers } from "./socket.js";
import { resolveActor, userOwns, playerOwners, chargeActor, creditActor } from "./wallet.js";
import { logTransaction } from "./chat.js";

/* -------------------------------------------- */
/*  Données                                     */
/* -------------------------------------------- */

export function getDebts() {
  return foundry.utils.deepClone(game.settings.get(MODULE_ID, SETTINGS.debts) ?? {});
}

async function saveDebts(debts) {
  await game.settings.set(MODULE_ID, SETTINGS.debts, debts);
}

/** Reste à payer d'une dette (intérêts compris), en unités de base de son système. */
export function owed(debt, now = worldTime()) {
  return amountOwed(debt, now, secondsPerDay());
}

function partyActor(party) {
  return party?.uuid ? fromUuidSync(party.uuid) : null;
}

/** L'utilisateur gère-t-il cette partie (créancier ou débiteur) ? */
export function userHasSide(user, debt, side) {
  const actor = partyActor(debt[side]);
  return actor ? userOwns(user, actor) : user.isGM;
}

/** Dettes visibles par l'utilisateur courant (toutes pour le MJ). */
export function visibleDebts() {
  const all = Object.values(getDebts());
  if (game.user.isGM) return all;
  return all.filter((d) => userHasSide(game.user, d, "creditor") || userHasSide(game.user, d, "debtor"));
}

/** Utilisateurs à prévenir pour une partie : ses joueurs, ou les MJ si elle n'en a pas. */
function usersForSide(debt, side) {
  const owners = playerOwners(partyActor(debt[side])).filter((u) => u.active);
  return (owners.length ? owners : game.users.filter((u) => u.isGM && u.active)).map((u) => u.id);
}

/* -------------------------------------------- */
/*  Validation                                  */
/* -------------------------------------------- */

async function cleanParty(party, user) {
  if (party?.uuid) {
    const actor = await resolveActor(party.uuid);
    return { uuid: actor.uuid, name: actor.name };
  }
  if (!user.isGM) throw new MintError("NoActor");
  const name = String(party?.name ?? "").trim();
  if (!name) throw new MintError("NoParty");
  return { uuid: null, name };
}

async function buildDebt(data, user) {
  const creditor = await cleanParty(data.creditor, user);
  const debtor = await cleanParty(data.debtor, user);
  if (creditor.uuid && creditor.uuid === debtor.uuid) throw new MintError("SameActor");
  const principal = Math.floor(Number(data.principal));
  if (!(principal > 0)) throw new MintError("BadAmount");
  return {
    id: foundry.utils.randomID(),
    creditor,
    debtor,
    principal,
    system: getSystem(data.system)?.id ?? defaultSystemId(),
    rate: Math.min(Math.max(Number(data.rate) || 0, 0), 1000),
    periodDays: Math.max(0, Number(data.periodDays) || 0),
    transfer: !!data.transfer,
    note: String(data.note ?? "").slice(0, 500),
    status: "proposed",
    closedReason: null,
    awaiting: null,
    proposedBy: user.id,
    imposed: false,
    start: worldTime(),
    repaid: 0,
    createdAt: Date.now(),
    closedAt: null
  };
}

/** Verse le capital (prêt) au moment où la dette devient active. */
async function disburse(debt) {
  if (!debt.transfer) return;
  const creditor = partyActor(debt.creditor);
  const debtor = partyActor(debt.debtor);
  if (creditor) await chargeActor(creditor, debt.principal, debt.system);
  if (debtor) await creditActor(debtor, debt.principal, debt.system);
}

async function activate(debts, debt) {
  await disburse(debt);
  debt.status = "active";
  debt.awaiting = null;
  debt.start = worldTime();
  debts[debt.id] = debt;
  await saveDebts(debts);
  await logTransaction(
    t(debt.transfer ? "Chat.Loan" : "Chat.Debt", {
      creditor: esc(debt.creditor.name),
      debtor: esc(debt.debtor.name),
      amount: esc(format(debt.principal, debt.system))
    }),
    { icon: "fa-file-signature" }
  );
}

async function close(debts, debt, reason) {
  debt.status = "closed";
  debt.closedReason = reason;
  debt.awaiting = null;
  debt.closedAt = Date.now();
  debts[debt.id] = debt;
  await saveDebts(debts);
}

function load(id) {
  const debts = getDebts();
  const debt = debts[id];
  if (!debt) throw new MintError("NoDebt");
  return { debts, debt };
}

/* -------------------------------------------- */
/*  Opérations (exécutées par le MJ)            */
/* -------------------------------------------- */

/** Un joueur propose une dette ; l'autre partie doit accepter. */
registerHandler("debt.propose", async (data, user) => {
  const debt = await buildDebt(data, user);
  const ownsCreditor = userHasSide(user, debt, "creditor");
  const ownsDebtor = userHasSide(user, debt, "debtor");
  if (!ownsCreditor && !ownsDebtor) throw new MintError("NotParty");

  const debts = getDebts();
  // Même joueur des deux côtés (ou MJ) : rien à accepter
  if (ownsCreditor && ownsDebtor) {
    await activate(debts, debt);
    return { id: debt.id, status: debt.status };
  }
  debt.awaiting = ownsCreditor ? "debtor" : "creditor";
  debts[debt.id] = debt;
  await saveDebts(debts);
  notifyUsers(usersForSide(debt, debt.awaiting), "Notify.Proposal", {
    from: debt[ownsCreditor ? "creditor" : "debtor"].name,
    amount: format(debt.principal, debt.system)
  });
  return { id: debt.id, status: debt.status };
});

/** Le MJ impose une dette, active tout de suite. */
registerHandler("debt.impose", async (data, user) => {
  if (!user.isGM) throw new MintError("GMOnly");
  const debt = await buildDebt(data, user);
  debt.imposed = true;
  await activate(getDebts(), debt);
  notifyUsers([...usersForSide(debt, "debtor"), ...usersForSide(debt, "creditor")].filter((id) => id !== user.id), "Notify.Imposed", {
    creditor: debt.creditor.name,
    debtor: debt.debtor.name,
    amount: format(debt.principal, debt.system)
  });
  return { id: debt.id };
});

/** Réponse à une proposition : accept = true / false. */
registerHandler("debt.respond", async ({ id, accept }, user) => {
  const { debts, debt } = load(id);
  if (debt.status !== "proposed") throw new MintError("NotPending");
  if (!user.isGM && !userHasSide(user, debt, debt.awaiting)) throw new MintError("NotParty");
  const responder = debt[debt.awaiting]?.name ?? "?";
  if (accept) await activate(debts, debt);
  else await close(debts, debt, "refused");
  const proposer = game.users.get(debt.proposedBy);
  notifyUsers(proposer ? [proposer.id] : [], accept ? "Notify.Accepted" : "Notify.Refused", {
    name: responder,
    amount: format(debt.principal, debt.system)
  });
  return { status: debt.status };
});

/** Le joueur qui a proposé retire sa proposition. */
registerHandler("debt.withdraw", async ({ id }, user) => {
  const { debts, debt } = load(id);
  if (debt.status !== "proposed") throw new MintError("NotPending");
  if (!user.isGM && debt.proposedBy !== user.id) throw new MintError("NotParty");
  await close(debts, debt, "withdrawn");
  return {};
});

/** Le débiteur rembourse tout ou partie (monnaie rendue). */
registerHandler("debt.repay", async ({ id, amount }, user) => {
  const { debts, debt } = load(id);
  if (debt.status !== "active") throw new MintError("NotActive");
  if (!userHasSide(user, debt, "debtor")) throw new MintError("NotParty");
  const due = owed(debt);
  const value = Math.min(Math.floor(Number(amount)), due);
  if (!(value > 0)) throw new MintError("BadAmount");

  const debtor = partyActor(debt.debtor);
  const creditor = partyActor(debt.creditor);
  if (debtor) await chargeActor(debtor, value, debt.system);
  if (creditor) await creditActor(creditor, value, debt.system);

  debt.repaid = (Number(debt.repaid) || 0) + value;
  const left = owed(debt);
  if (left <= 0) await close(debts, debt, "repaid");
  else {
    debts[debt.id] = debt;
    await saveDebts(debts);
  }
  await logTransaction(
    t("Chat.Repay", {
      debtor: esc(debt.debtor.name),
      creditor: esc(debt.creditor.name),
      amount: esc(format(value, debt.system)),
      left: esc(format(left, debt.system))
    }),
    { icon: "fa-receipt" }
  );
  notifyUsers(usersForSide(debt, "creditor").filter((uid) => uid !== user.id), "Notify.Repaid", {
    name: debt.debtor.name,
    amount: format(value, debt.system)
  });
  return { left };
});

/** Le créancier (ou le MJ) efface la dette. */
registerHandler("debt.forgive", async ({ id }, user) => {
  const { debts, debt } = load(id);
  if (debt.status !== "active") throw new MintError("NotActive");
  if (!userHasSide(user, debt, "creditor")) throw new MintError("NotParty");
  await close(debts, debt, "forgiven");
  await logTransaction(t("Chat.Forgive", { creditor: esc(debt.creditor.name), debtor: esc(debt.debtor.name) }), { icon: "fa-dove" });
  notifyUsers(usersForSide(debt, "debtor").filter((uid) => uid !== user.id), "Notify.Forgiven", { name: debt.creditor.name });
  return {};
});

/** Le MJ annule une dette (sans mouvement d'argent) ou la supprime définitivement. */
registerHandler("debt.cancel", async ({ id, remove }, user) => {
  if (!user.isGM) throw new MintError("GMOnly");
  const { debts, debt } = load(id);
  if (remove) {
    delete debts[id];
    await saveDebts(debts);
  } else await close(debts, debt, "cancelled");
  return {};
});

/* -------------------------------------------- */
/*  Appels côté client                          */
/* -------------------------------------------- */

export const debtApi = {
  propose: (data) => gmCall("debt.propose", data),
  impose: (data) => gmCall("debt.impose", data),
  respond: (id, accept) => gmCall("debt.respond", { id, accept }),
  withdraw: (id) => gmCall("debt.withdraw", { id }),
  repay: (id, amount) => gmCall("debt.repay", { id, amount }),
  forgive: (id) => gmCall("debt.forgive", { id }),
  cancel: (id, remove = false) => gmCall("debt.cancel", { id, remove }),
  owed
};
