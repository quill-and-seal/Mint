/**
 * Économie du monde dans Foundry : stockage, ticks selon le temps du monde, actions des
 * factions, prêts des banques, masse monétaire.
 *
 * Le monde est stocké dans le réglage « world » (voir core/market.js pour sa forme).
 * Les prix internes sont en unités de référence ; chaque région affiche et encaisse dans
 * sa propre monnaie (son système monétaire).
 */

import { MODULE_ID, SETTINGS, MintError, t, esc, worldTime, secondsPerDay, log } from "./constants.js";
import { getConfig, getSystem, defaultSystemId, format } from "./currencies.js";
import {
  tick, regionPrice, shareTrade, sharePrices, heldShares, MARKET_DEFAULTS, stockTarget, eventActive, routeBlocked
} from "./core/market.js";
import { presetWorld, eventTemplates } from "./core/world-preset.js";
import { registerHandler, gmCall } from "./socket.js";
import { resolveActor, requireOwner, chargeActor, creditActor, actorValue } from "./wallet.js";
import { proposeFactionLoan, registerCreditorHandler } from "./debts.js";
import { logTransaction } from "./chat.js";

/** Nombre maximal de jours simulés d'un coup (saut de temps important). */
const MAX_TICKS = 365;

/* -------------------------------------------- */
/*  Données                                     */
/* -------------------------------------------- */

const numOr = (v, d) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? d : Number(v));
const slug = (s) =>
  String(s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || foundry.utils.randomID(6);

export function emptyWorld() {
  return { day: 0, lastTick: null, auto: true, goods: [], regions: [], routes: [], factions: [], events: [], history: {}, settings: {} };
}

/** Monde normalisé, ou null si le MJ ne l'a pas encore créé. */
export function getWorld() {
  const raw = game.settings.get(MODULE_ID, SETTINGS.world);
  if (!raw || !Array.isArray(raw.regions)) return null;
  return normalizeWorld(foundry.utils.deepClone(raw));
}

export function isConfigured() {
  return !!getWorld();
}

export async function saveWorld(world) {
  await game.settings.set(MODULE_ID, SETTINGS.world, normalizeWorld(world));
}

export async function resetWorld(kind = "preset") {
  const world = kind === "preset" ? presetWorld(game.i18n.lang === "fr" ? "fr" : "en", defaultSystemId()) : emptyWorld();
  world.lastTick = worldTime();
  await saveWorld(world);
}

export function normalizeWorld(w) {
  const goods = (w.goods ?? []).map((g) => ({
    id: g.id || slug(g.name),
    name: String(g.name ?? "").trim() || "?",
    unit: String(g.unit ?? ""),
    category: ["food", "raw", "goods", "luxury"].includes(g.category) ? g.category : "goods",
    price: Math.max(0.01, numOr(g.price, 10)),
    spoil: Math.min(Math.max(numOr(g.spoil, 0.01), 0), 1)
  }));
  const ids = new Set(goods.map((g) => g.id));
  const perGood = (o) => Object.fromEntries(Object.entries(o ?? {}).filter(([k, v]) => ids.has(k) && Number.isFinite(Number(v))).map(([k, v]) => [k, Math.max(0, Number(v))]));
  const regions = (w.regions ?? []).map((r) => ({
    id: r.id || slug(r.name),
    name: String(r.name ?? "").trim() || "?",
    system: getSystem(r.system)?.id ?? defaultSystemId(),
    prosperity: Math.min(Math.max(numOr(r.prosperity, 1), 0.3), 2),
    tax: Math.min(Math.max(numOr(r.tax, 0), 0), 1),
    production: perGood(r.production),
    consumption: perGood(r.consumption),
    stock: perGood(r.stock),
    modifiers: Object.fromEntries(Object.entries(r.modifiers ?? {}).filter(([k, v]) => ids.has(k) && Number(v) > 0 && Number(v) !== 1)),
    scenes: Array.isArray(r.scenes) ? r.scenes.filter(Boolean) : []
  }));
  const rids = new Set(regions.map((r) => r.id));
  return {
    day: Math.max(0, Math.floor(numOr(w.day, 0))),
    lastTick: w.lastTick ?? null,
    auto: w.auto !== false,
    settings: { ...(w.settings ?? {}) },
    goods,
    regions,
    routes: (w.routes ?? [])
      .filter((r) => rids.has(r.a) && rids.has(r.b) && r.a !== r.b)
      .map((r) => ({
        id: r.id || foundry.utils.randomID(),
        a: r.a,
        b: r.b,
        days: Math.max(1, numOr(r.days, 3)),
        cost: Math.max(0, numOr(r.cost, 0.02)),
        capacity: Math.max(0, numOr(r.capacity, 30)),
        risk: Math.min(Math.max(numOr(r.risk, 0), 0), 1),
        open: r.open !== false
      })),
    factions: (w.factions ?? []).map((f) => ({
      id: f.id || slug(f.name),
      name: String(f.name ?? "").trim() || "?",
      kind: ["guild", "company", "bank"].includes(f.kind) ? f.kind : "guild",
      region: rids.has(f.region) ? f.region : regions[0]?.id ?? "",
      goods: (f.goods ?? []).filter((g) => ids.has(g)),
      treasury: numOr(f.treasury, 0),
      shares: Math.max(1, Math.floor(numOr(f.shares, 1000))),
      price: Math.max(0.01, numOr(f.price, numOr(f.treasury, 0) / Math.max(1, numOr(f.shares, 1000)))),
      sentiment: numOr(f.sentiment, 1),
      dividend: Math.min(Math.max(numOr(f.dividend, 0), 0), 100),
      loanRate: Math.max(0, numOr(f.loanRate, 5)),
      loanPeriodDays: Math.max(1, numOr(f.loanPeriodDays, 30)),
      loanMax: Math.max(0, numOr(f.loanMax, 0)),
      upkeep: Math.max(0, numOr(f.upkeep, 0)),
      holders: Object.fromEntries(
        Object.entries(f.holders ?? {})
          .filter(([, h]) => numOr(h?.n, 0) > 0)
          .map(([uuid, h]) => [uuid, { n: Math.floor(h.n), cost: Math.max(0, numOr(h.cost, 0)), name: String(h.name ?? "") }])
      )
    })),
    events: (w.events ?? []).map((e) => ({ ...e, id: e.id || foundry.utils.randomID(), name: String(e.name ?? "?") })),
    history: w.history ?? {},
    lastTrades: w.lastTrades ?? [],
    alerts: w.alerts ?? []
  };
}

/* -------------------------------------------- */
/*  Monnaies                                    */
/* -------------------------------------------- */

const rateOf = (systemId) => numOr(getSystem(systemId)?.rate, 1) || 1;

/** Valeur de référence → unités de base d'un système. */
export function toSystem(refValue, systemId) {
  return refValue / rateOf(systemId);
}

/** Unités de base d'un système → valeur de référence. */
export function toRef(value, systemId) {
  return value * rateOf(systemId);
}

/** Prix d'un bien dans une région, dans la monnaie demandée (celle de la région par défaut). */
export function marketPrice(regionId, goodId, systemId = null, world = getWorld()) {
  if (!world) return null;
  const region = world.regions.find((r) => r.id === regionId);
  if (!region || !world.goods.some((g) => g.id === goodId)) return null;
  return toSystem(regionPrice(world, regionId, goodId, { ...MARKET_DEFAULTS, ...world.settings }), systemId ?? region.system);
}

/** Affiche une valeur de référence dans la monnaie d'une région. */
export function formatRef(refValue, systemId) {
  return format(Math.round(toSystem(refValue, systemId)), systemId);
}

/** Région liée à une scène (ou null). */
export function regionForScene(scene, world = getWorld()) {
  if (!scene || !world) return null;
  return world.regions.find((r) => r.scenes.includes(scene.id)) ?? null;
}

/* -------------------------------------------- */
/*  Masse monétaire                             */
/* -------------------------------------------- */

/** Argent des personnages de joueurs et des factions, en unités de référence. */
export function moneySupply(world = getWorld()) {
  const { systems } = getConfig();
  const actors = game.actors.filter((a) => a.hasPlayerOwner);
  const perActor = actors.map((a) => ({
    uuid: a.uuid,
    name: a.name,
    img: a.img,
    value: systems.reduce((s, sys) => s + toRef(actorValue(a, sys.id), sys.id), 0)
  }));
  const players = perActor.reduce((s, a) => s + a.value, 0);
  const factions = (world?.factions ?? []).reduce((s, f) => s + Math.max(0, f.treasury), 0);
  return { players, factions, total: players + factions, perActor: perActor.sort((a, b) => b.value - a.value) };
}

/* -------------------------------------------- */
/*  Simulation (MJ actif)                       */
/* -------------------------------------------- */

function pushSeries(list, value, size) {
  const out = Array.isArray(list) ? list.slice(-(size - 1)) : [];
  out.push(Math.round(value));
  return out;
}

/**
 * Avance le monde de `days` jours : prix, commerce, factions, dividendes versés aux
 * personnages, masse monétaire. Une seule écriture du réglage à la fin.
 */
export async function advanceDays(days = 1, { now = worldTime() } = {}) {
  let world = getWorld();
  if (!world) return null;
  const n = Math.min(MAX_TICKS, Math.max(0, Math.floor(days)));
  const payouts = [];
  let shortages = [];
  for (let i = 0; i < n; i++) {
    const result = tick(world);
    world = result.world;
    payouts.push(...result.payouts);
    shortages = result.shortages;
  }
  const size = Math.max(10, numOr(world.settings?.historySize, MARKET_DEFAULTS.historySize));
  const supply = moneySupply(world);
  world.history.money = pushSeries(world.history.money, supply.players, size);
  world.history.treasuries = pushSeries(world.history.treasuries, supply.factions, size);
  world.alerts = shortages.slice(0, 20).map((s) => ({ region: s.region, good: s.good, missing: Math.round(s.missing) }));
  world.lastTick = now;
  await saveWorld(world);

  // Dividendes : versés dans la monnaie de la région de la faction
  const byActor = new Map();
  for (const p of payouts) {
    const key = `${p.actor}|${p.faction}`;
    byActor.set(key, (byActor.get(key) ?? 0) + p.amount);
  }
  for (const [key, ref] of byActor) {
    const [uuid, fid] = key.split("|");
    const faction = world.factions.find((f) => f.id === fid);
    const actor = await fromUuid(uuid).catch(() => null);
    if (!(actor instanceof Actor) || !faction) continue;
    const system = world.regions.find((r) => r.id === faction.region)?.system ?? defaultSystemId();
    const amount = Math.floor(toSystem(ref, system));
    if (amount <= 0) continue;
    await creditActor(actor, amount, system);
    await logTransaction(t("Chat.Dividend", { name: esc(actor.name), faction: esc(faction.name), amount: esc(format(amount, system)) }), {
      icon: "fa-hand-holding-dollar",
      type: "dividend",
      actors: [actor.uuid],
      amount,
      system
    });
  }
  log(`Économie : ${n} jour(s) simulé(s), jour ${world.day}`);
  return world;
}

/** Fait avancer l'économie selon le temps du monde écoulé (appelé par le MJ actif). */
export async function syncWithWorldTime(now = worldTime()) {
  const world = getWorld();
  if (!world || !world.auto) return;
  const period = secondsPerDay();
  if (world.lastTick === null || world.lastTick === undefined || now < world.lastTick) {
    // Premier passage ou retour en arrière : on recale sans simuler
    world.lastTick = now;
    await saveWorld(world);
    return;
  }
  const days = Math.floor((now - world.lastTick) / period);
  if (days > 0) await advanceDays(days, { now: world.lastTick + days * period });
}

/* -------------------------------------------- */
/*  Événements                                  */
/* -------------------------------------------- */

export function templates() {
  return eventTemplates(game.i18n.lang === "fr" ? "fr" : "en");
}

export async function startEvent(templateId, { region = null, good = undefined, days = null } = {}) {
  const world = getWorld();
  const tpl = templates().find((e) => e.id === templateId);
  if (!world || !tpl) return;
  world.events.push({
    ...tpl,
    id: foundry.utils.randomID(),
    template: tpl.id,
    region: region || null,
    good: good === undefined ? tpl.good ?? null : good || null,
    start: world.day + 1,
    days: days ?? tpl.days
  });
  await saveWorld(world);
  const regionName = world.regions.find((r) => r.id === region)?.name ?? t("World.AllRegions");
  await logTransaction(t("Chat.Event", { name: esc(tpl.name), region: esc(regionName) }), { icon: tpl.icon ?? "fa-bolt", type: "event" });
}

export async function endEvent(id) {
  const world = getWorld();
  if (!world) return;
  world.events = world.events.filter((e) => e.id !== id);
  await saveWorld(world);
}

export { eventActive, routeBlocked, stockTarget, heldShares, sharePrices };

/* -------------------------------------------- */
/*  Opérations des joueurs (exécutées par le MJ) */
/* -------------------------------------------- */

function factionSystem(world, faction) {
  return world.regions.find((r) => r.id === faction.region)?.system ?? defaultSystemId();
}

/** Achat (qty > 0) ou vente (qty < 0) d'actions d'une faction. */
registerHandler("world.trade", async ({ factionId, actorUuid, qty }, user) => {
  const actor = await resolveActor(actorUuid);
  requireOwner(user, actor);
  const world = getWorld();
  const faction = world?.factions.find((f) => f.id === factionId);
  if (!faction) throw new MintError("NoFaction");
  const n = Math.trunc(Number(qty));
  if (!n || Math.abs(n) > 100000) throw new MintError("BadQuantity");
  const holder = faction.holders[actor.uuid] ?? { n: 0, cost: 0, name: actor.name };
  const system = factionSystem(world, faction);
  const trade = shareTrade(faction, n, numOr(world.settings?.spread, MARKET_DEFAULTS.spread));
  const amount = Math.max(1, Math.round(toSystem(trade.total, system)));

  if (n > 0) {
    if (heldShares(faction) + n > faction.shares) throw new MintError("NoFloat", { faction: faction.name, left: faction.shares - heldShares(faction) });
    await chargeActor(actor, amount, system);
    holder.n += n;
    holder.cost += trade.total;
    faction.treasury += trade.total;
  } else {
    if (holder.n < -n) throw new MintError("NotEnoughShares", { faction: faction.name, n: holder.n });
    if (faction.treasury < trade.total) throw new MintError("FactionBroke", { faction: faction.name });
    holder.cost = holder.n ? holder.cost * (1 - -n / holder.n) : 0;
    holder.n += n;
    faction.treasury -= trade.total;
    await creditActor(actor, amount, system);
  }
  holder.name = actor.name;
  if (holder.n > 0) faction.holders[actor.uuid] = holder;
  else delete faction.holders[actor.uuid];
  faction.price = Math.max(0.01, faction.price * (1 + trade.impact));
  await saveWorld(world);

  await logTransaction(
    t(n > 0 ? "Chat.SharesBuy" : "Chat.SharesSell", { name: esc(actor.name), n: Math.abs(n), faction: esc(faction.name), amount: esc(format(amount, system)) }),
    { icon: "fa-chart-line", type: n > 0 ? "shares-buy" : "shares-sell", actors: [actor.uuid], amount, system }
  );
  return { amount, held: holder.n };
});

/** Demande de prêt à une banque : crée une dette en attente de la réponse du MJ. */
registerHandler("world.loan", async ({ factionId, actorUuid, amount, dueDays, note }, user) => {
  const actor = await resolveActor(actorUuid);
  requireOwner(user, actor);
  const world = getWorld();
  const faction = world?.factions.find((f) => f.id === factionId && f.kind === "bank");
  if (!faction) throw new MintError("NoFaction");
  const system = factionSystem(world, faction);
  const value = Math.floor(Number(amount));
  if (!(value > 0)) throw new MintError("BadAmount");
  const max = faction.loanMax > 0 ? Math.floor(toSystem(faction.loanMax, system)) : Infinity;
  if (value > max) throw new MintError("LoanTooBig", { bank: faction.name, max: format(max, system) });
  if (toRef(value, system) > faction.treasury) throw new MintError("FactionBroke", { faction: faction.name });
  const debt = await proposeFactionLoan(
    {
      faction,
      debtorUuid: actor.uuid,
      principal: value,
      system,
      rate: faction.loanRate,
      periodDays: faction.loanPeriodDays,
      dueDays: Math.max(0, Math.floor(Number(dueDays) || faction.loanPeriodDays * 3)),
      lateFee: 10,
      note
    },
    user
  );
  return { id: debt.id };
});

/** Argent prêté par une banque (delta < 0) ou remboursé (delta > 0) : trésorerie de la faction. */
registerCreditorHandler(async (debt, delta) => {
  const fid = debt.creditor?.faction;
  if (!fid) return;
  const world = getWorld();
  const faction = world?.factions.find((f) => f.id === fid);
  if (!faction) return;
  faction.treasury += toRef(delta, debt.system);
  await saveWorld(world);
});

/* -------------------------------------------- */
/*  Appels côté client                          */
/* -------------------------------------------- */

export const worldApi = {
  get: getWorld,
  price: marketPrice,
  advance: (days = 1) => (game.user.isGM ? advanceDays(days) : Promise.reject(new MintError("GMOnly"))),
  buyShares: (factionId, actorUuid, qty) => gmCall("world.trade", { factionId, actorUuid, qty: Math.abs(qty) }),
  sellShares: (factionId, actorUuid, qty) => gmCall("world.trade", { factionId, actorUuid, qty: -Math.abs(qty) }),
  requestLoan: (factionId, actorUuid, amount, opts = {}) => gmCall("world.loan", { factionId, actorUuid, amount, ...opts }),
  moneySupply
};
