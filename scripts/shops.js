/**
 * Boutiques et marchands.
 *
 * Stockées dans le réglage de monde « shops » : { [id]: boutique }.
 * Boutique : {
 *   id, name, img, description, system,
 *   open        : visible et utilisable par les joueurs
 *   markup      : majoration de la boutique (fraction)
 *   sellRatio   : part du prix payée quand un joueur revend
 *   elasticity, minFactor, maxFactor : offre et demande (voir core/pricing.js)
 *   restockHours: intervalle de réassort, en heures de temps du monde (0 = manuel)
 *   lastRestock : temps du monde du dernier réassort
 *   till        : caisse — "unlimited" (illimitée), "fixed" (montant `treasury`) ou "merchant"
 *                 (la bourse de l'acteur marchand : les achats l'enrichissent, les rachats la vident)
 *   treasury    : montant de la caisse en mode "fixed"
 *   merchant    : UUID de l'acteur marchand (double-clic sur son token = ouvrir la boutique)
 *   customers   : { [UUID acteur]: % } réputation (négatif = moins cher pour ce client)
 *   haggle      : { enabled, dc, maxDiscount, penalty, hours } réglages du marchandage
 *   haggles     : { [UUID acteur]: { pct, until, total } } marchandages en cours (temps du monde)
 *   items: [{ id, name, img, uuid, description, price, stock, target, restock, modifier, buyback }]
 *     price : prix de base en unités de base du système de la boutique
 *     stock : null = illimité ; target = stock normal ; restock = unités par intervalle
 * }
 */

import { MODULE_ID, SETTINGS, MintError, t, esc, worldTime, log } from "./constants.js";
import { getSystem, defaultSystemId, format } from "./currencies.js";
import { PRICING_DEFAULTS, unitPrice, buyTotal, sellTotal, restockStock, customerFactors, haggleOutcome } from "./core/pricing.js";
import { registerHandler, gmCall } from "./socket.js";
import { resolveActor, requireOwner, chargeActor, creditActor, actorValue } from "./wallet.js";
import { logTransaction } from "./chat.js";

/* -------------------------------------------- */
/*  Données                                     */
/* -------------------------------------------- */

export function getShops() {
  return foundry.utils.deepClone(game.settings.get(MODULE_ID, SETTINGS.shops) ?? {});
}

export function getShop(id) {
  const shop = getShops()[id];
  return shop ? normalizeShop(shop) : null;
}

/** Boutiques visibles par l'utilisateur courant, triées par nom. */
export function visibleShops() {
  return Object.values(getShops())
    .map(normalizeShop)
    .filter((s) => game.user.isGM || s.open)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function saveShops(shops) {
  await game.settings.set(MODULE_ID, SETTINGS.shops, shops);
}

/** Enregistre une boutique (MJ). */
export async function saveShop(shop) {
  const shops = getShops();
  shops[shop.id] = normalizeShop(shop);
  await saveShops(shops);
}

export async function deleteShop(id) {
  const shops = getShops();
  delete shops[id];
  await saveShops(shops);
}

const numOr = (v, d) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? d : Number(v));
const stockOrNull = (v) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Math.max(0, Math.floor(Number(v))));

export function newItem(data = {}) {
  return normalizeItem({ id: foundry.utils.randomID(), name: t("Shop.NewItem"), price: 100, stock: 5, target: 5, restock: 1, ...data });
}

export function normalizeItem(item) {
  const stock = stockOrNull(item.stock);
  return {
    id: item.id ?? foundry.utils.randomID(),
    name: String(item.name ?? "").trim() || "?",
    img: item.img || "icons/svg/item-bag.svg",
    uuid: item.uuid || "",
    description: String(item.description ?? ""),
    price: Math.max(0, Math.round(numOr(item.price, 0))),
    stock,
    target: stock === null ? null : Math.max(0, Math.floor(numOr(item.target, stock))),
    restock: Math.max(0, Math.floor(numOr(item.restock, 0))),
    modifier: Math.max(0, numOr(item.modifier, 1)),
    buyback: item.buyback !== false
  };
}

export function newShop(data = {}) {
  return normalizeShop({
    id: foundry.utils.randomID(),
    name: t("Shop.NewShop"),
    system: defaultSystemId(),
    lastRestock: worldTime(),
    items: [],
    ...data
  });
}

export const HAGGLE_DEFAULTS = Object.freeze({ enabled: false, dc: 15, maxDiscount: 20, penalty: 10, hours: 24 });

export function normalizeShop(shop) {
  const legacyTill = shop.treasury === null || shop.treasury === undefined || shop.treasury === "" ? "unlimited" : "fixed";
  const till = ["unlimited", "fixed", "merchant"].includes(shop.till) ? shop.till : legacyTill;
  const haggle = { ...HAGGLE_DEFAULTS, ...(shop.haggle ?? {}) };
  const customers = {};
  for (const [uuid, pct] of Object.entries(shop.customers ?? {})) {
    const v = Math.min(Math.max(numOr(pct, 0), -90), 200);
    if (v) customers[uuid] = v;
  }
  return {
    id: shop.id,
    name: String(shop.name ?? "").trim() || "?",
    img: shop.img || "icons/svg/chest.svg",
    description: String(shop.description ?? ""),
    system: getSystem(shop.system)?.id ?? defaultSystemId(),
    open: !!shop.open,
    merchant: shop.merchant || "",
    markup: numOr(shop.markup, PRICING_DEFAULTS.markup),
    sellRatio: Math.min(Math.max(numOr(shop.sellRatio, PRICING_DEFAULTS.sellRatio), 0), 1),
    elasticity: Math.max(0, numOr(shop.elasticity, PRICING_DEFAULTS.elasticity)),
    minFactor: Math.max(0, numOr(shop.minFactor, PRICING_DEFAULTS.minFactor)),
    maxFactor: Math.max(0, numOr(shop.maxFactor, PRICING_DEFAULTS.maxFactor)),
    restockHours: Math.max(0, numOr(shop.restockHours, 24)),
    lastRestock: numOr(shop.lastRestock, 0),
    till,
    treasury: till === "fixed" ? Math.max(0, Math.floor(numOr(shop.treasury, 0))) : null,
    customers,
    haggle: {
      enabled: !!haggle.enabled,
      dc: Math.max(0, Math.floor(numOr(haggle.dc, HAGGLE_DEFAULTS.dc))),
      maxDiscount: Math.min(Math.max(numOr(haggle.maxDiscount, HAGGLE_DEFAULTS.maxDiscount), 0), 90),
      penalty: Math.min(Math.max(numOr(haggle.penalty, HAGGLE_DEFAULTS.penalty), 0), 200),
      hours: Math.max(0, numOr(haggle.hours, HAGGLE_DEFAULTS.hours))
    },
    haggles: foundry.utils.deepClone(shop.haggles ?? {}),
    items: (shop.items ?? []).map(normalizeItem)
  };
}

/** Boutique tenue par cet acteur (ou par l'acteur de base de ce token). */
export function shopForActor(actor) {
  if (!actor) return null;
  const uuids = new Set([actor.uuid, actor.baseActor?.uuid, actor.isToken ? game.actors.get(actor.id)?.uuid : null].filter(Boolean));
  return Object.values(getShops()).map(normalizeShop).find((s) => s.merchant && uuids.has(s.merchant)) ?? null;
}

/** Acteur marchand d'une boutique (synchrone, peut être null). */
export function merchantActor(shop) {
  return shop?.merchant ? fromUuidSync(shop.merchant) : null;
}

/* -------------------------------------------- */
/*  Prix propres au client                      */
/* -------------------------------------------- */

/** Marchandage encore valable pour un client, ou null. */
export function activeHaggle(shop, actorUuid, now = worldTime()) {
  const h = shop?.haggles?.[actorUuid];
  return h && Number(h.until) > now ? h : null;
}

/** Ajustements de prix d'un client : { reputation, haggle, buy, sell, pct }. */
export function customerPricing(shop, actorUuid, now = worldTime()) {
  const reputation = actorUuid ? Number(shop?.customers?.[actorUuid]) || 0 : 0;
  const haggle = actorUuid ? Number(activeHaggle(shop, actorUuid, now)?.pct) || 0 : 0;
  return { reputation, haggle, ...customerFactors([reputation, haggle]) };
}

export { unitPrice, buyTotal, sellTotal };

/* -------------------------------------------- */
/*  Objets des acteurs                          */
/* -------------------------------------------- */

/** Quantité d'un objet d'acteur (1 si le système n'a pas de champ quantité). */
export function itemQuantity(item) {
  const q = foundry.utils.getProperty(item, "system.quantity");
  return typeof q === "number" ? Math.max(0, q) : 1;
}

/** L'objet d'acteur correspond-il à cet article de boutique ? */
export function matchesEntry(item, entry) {
  if (item.getFlag?.(MODULE_ID, "entry") === entry.id) return true;
  if (entry.uuid) {
    const sources = [item.getFlag?.(MODULE_ID, "uuid"), item._stats?.compendiumSource, item.flags?.core?.sourceId];
    if (sources.includes(entry.uuid)) return true;
  }
  return item.name.trim().toLowerCase() === entry.name.trim().toLowerCase();
}

/** Objets d'un acteur que cette boutique peut racheter : [{ item, entry }]. */
export function sellableItems(actor, shop) {
  if (!actor) return [];
  const out = [];
  for (const item of actor.items) {
    const entry = shop.items.find((e) => e.buyback && matchesEntry(item, e));
    if (entry && itemQuantity(item) > 0) out.push({ item, entry });
  }
  return out;
}

async function giveItems(actor, entry, qty) {
  if (!entry.uuid) return; // service ou article sans objet (nuit à l'auberge, repas…)
  const source = await fromUuid(entry.uuid);
  if (!(source instanceof Item)) throw new MintError("ItemMissing", { name: entry.name });
  const data = source.toObject();
  delete data._id;
  foundry.utils.setProperty(data, `flags.${MODULE_ID}.uuid`, entry.uuid);
  foundry.utils.setProperty(data, `flags.${MODULE_ID}.entry`, entry.id);
  if (typeof foundry.utils.getProperty(data, "system.quantity") === "number") {
    // Empile sur un exemplaire déjà possédé si possible
    const existing = actor.items.find((i) => matchesEntry(i, entry) && typeof foundry.utils.getProperty(i, "system.quantity") === "number");
    if (existing) {
      await existing.update({ "system.quantity": itemQuantity(existing) + qty });
      return;
    }
    data.system.quantity = qty;
    await actor.createEmbeddedDocuments("Item", [data]);
  } else {
    await actor.createEmbeddedDocuments("Item", Array.from({ length: qty }, () => foundry.utils.deepClone(data)));
  }
}

/* -------------------------------------------- */
/*  Opérations (exécutées par le MJ)            */
/* -------------------------------------------- */

function findForUser(shopId, entryId, user) {
  const shop = getShop(shopId);
  if (!shop || (!shop.open && !user.isGM)) throw new MintError("ShopClosed");
  const entry = entryId === null ? null : shop.items.find((i) => i.id === entryId);
  if (entryId !== null && !entry) throw new MintError("ItemMissing", { name: "?" });
  return { shop, entry };
}

/**
 * Distance (en unités de la grille) entre l'acteur et le marchand, s'ils ont tous deux un token
 * sur la même scène ; null sinon.
 */
function merchantDistance(shop, actor) {
  const merchant = merchantActor(shop);
  if (!merchant) return null;
  const merchantIds = new Set([merchant.id, merchant.baseActor?.id].filter(Boolean));
  for (const scene of game.scenes ?? []) {
    const mt = scene.tokens.find((t) => merchantIds.has(t.actorId) || t.actor?.uuid === merchant.uuid);
    if (!mt) continue;
    const bt = scene.tokens.find((t) => t.actor?.uuid === actor.uuid || (t.actorLink && t.actorId === actor.id));
    if (!bt) continue;
    const size = scene.grid?.size || 100;
    const unit = scene.grid?.distance || 1;
    const cx = (t) => t.x + ((t.width ?? 1) * size) / 2;
    const cy = (t) => t.y + ((t.height ?? 1) * size) / 2;
    return (Math.hypot(cx(mt) - cx(bt), cy(mt) - cy(bt)) / size) * unit;
  }
  return null;
}

function checkRange(shop, actor, user) {
  if (user.isGM) return;
  const range = Number(game.settings.get(MODULE_ID, SETTINGS.merchantRange)) || 0;
  if (!(range > 0)) return;
  const d = merchantDistance(shop, actor);
  if (d !== null && d > range) throw new MintError("TooFar", { name: merchantActor(shop)?.name ?? shop.name });
}

/** Ce que la caisse du marchand peut payer (Infinity si illimitée). */
function tillFunds(shop) {
  if (shop.till === "fixed") return shop.treasury;
  if (shop.till === "merchant") {
    const m = merchantActor(shop);
    return m ? actorValue(m, shop.system) : 0;
  }
  return Infinity;
}

registerHandler("shop.buy", async ({ shopId, entryId, actorUuid, qty }, user) => {
  const actor = await resolveActor(actorUuid);
  requireOwner(user, actor);
  const { shop, entry } = findForUser(shopId, entryId, user);
  checkRange(shop, actor, user);
  const n = Math.floor(Number(qty));
  if (!(n >= 1) || n > 999) throw new MintError("BadQuantity");
  if (entry.stock !== null && entry.stock < n) throw new MintError("OutOfStock", { name: entry.name, stock: entry.stock });
  const pricing = customerPricing(shop, actor.uuid);
  const total = buyTotal(entry, shop, n, pricing.buy);

  await chargeActor(actor, total, shop.system);
  try {
    await giveItems(actor, entry, n);
  } catch (err) {
    await creditActor(actor, total, shop.system); // rembourse si l'objet n'a pas pu être donné
    throw err;
  }

  const shops = getShops();
  const s = shops[shop.id];
  const e = s.items.find((i) => i.id === entry.id);
  if (e.stock !== null && e.stock !== undefined) e.stock = Math.max(0, e.stock - n);
  if (shop.till === "fixed") s.treasury = shop.treasury + total;
  await saveShops(shops);
  const merchant = shop.till === "merchant" ? merchantActor(shop) : null;
  if (merchant && total > 0) await creditActor(merchant, total, shop.system);

  await logTransaction(
    t("Chat.Buy", { name: esc(actor.name), qty: n, item: esc(entry.name), shop: esc(shop.name), amount: esc(format(total, shop.system)) }),
    { icon: "fa-cart-shopping", type: "buy", actors: [actor.uuid, merchant?.uuid], amount: total, system: shop.system }
  );
  return { total };
});

registerHandler("shop.sell", async ({ shopId, entryId, actorUuid, itemId, qty }, user) => {
  const actor = await resolveActor(actorUuid);
  requireOwner(user, actor);
  const { shop, entry } = findForUser(shopId, entryId, user);
  checkRange(shop, actor, user);
  if (!entry.buyback) throw new MintError("NoBuyback", { name: entry.name });
  const item = actor.items.get(itemId);
  if (!item || !matchesEntry(item, entry)) throw new MintError("ItemMissing", { name: entry.name });
  const n = Math.floor(Number(qty));
  const has = itemQuantity(item);
  const hasQtyField = typeof foundry.utils.getProperty(item, "system.quantity") === "number";
  if (!(n >= 1) || n > has || (!hasQtyField && n !== 1)) throw new MintError("BadQuantity");
  const pricing = customerPricing(shop, actor.uuid);
  const total = sellTotal(entry, shop, n, pricing.sell);
  const funds = tillFunds(shop);
  if (funds < total) throw new MintError("ShopBroke", { shop: shop.name, amount: format(funds, shop.system) });

  const merchant = shop.till === "merchant" ? merchantActor(shop) : null;
  if (merchant && total > 0) await chargeActor(merchant, total, shop.system);
  if (hasQtyField && n < has) await item.update({ "system.quantity": has - n });
  else await item.delete();
  if (total > 0) await creditActor(actor, total, shop.system);

  const shops = getShops();
  const s = shops[shop.id];
  const e = s.items.find((i) => i.id === entry.id);
  if (e.stock !== null && e.stock !== undefined) e.stock = Number(e.stock) + n;
  if (shop.till === "fixed") s.treasury = Math.max(0, shop.treasury - total);
  await saveShops(shops);

  await logTransaction(
    t("Chat.Sell", { name: esc(actor.name), qty: n, item: esc(entry.name), shop: esc(shop.name), amount: esc(format(total, shop.system)) }),
    { icon: "fa-sack-dollar", type: "sell", actors: [actor.uuid, merchant?.uuid], amount: total, system: shop.system }
  );
  return { total };
});

/** Formule du jet de marchandage (réglage ; vide = Persuasion pour dnd5e, 1d20 sinon). */
export function haggleFormula() {
  const value = String(game.settings.get(MODULE_ID, SETTINGS.haggleFormula) ?? "").trim();
  if (value) return value;
  return game.system.id === "dnd5e" ? "1d20 + @skills.per.total" : "1d20";
}

/** Marchandage : le jet est fait par le MJ (formule du réglage, données de l'acteur). */
registerHandler("shop.haggle", async ({ shopId, actorUuid }, user) => {
  const actor = await resolveActor(actorUuid);
  requireOwner(user, actor);
  const { shop } = findForUser(shopId, null, user);
  checkRange(shop, actor, user);
  if (!shop.haggle.enabled) throw new MintError("NoHaggle", { shop: shop.name });
  const now = worldTime();
  if (activeHaggle(shop, actor.uuid, now)) throw new MintError("AlreadyHaggled", { shop: shop.name });

  const formula = haggleFormula();
  let roll;
  try {
    roll = await new Roll(formula, actor.getRollData?.() ?? {}).evaluate();
  } catch (err) {
    console.warn(`Mint | formule de marchandage invalide (${formula}), 1d20 utilisé`, err);
    roll = await new Roll("1d20").evaluate();
  }
  const total = Math.floor(roll.total);
  const pct = haggleOutcome(total, shop.haggle.dc, shop.haggle);
  const outcome = pct < 0 ? "Success" : pct > 0 ? "Offended" : "Nothing";
  try {
    await roll.toMessage({
      speaker: ChatMessage.getSpeaker({ actor }),
      flavor: t(`Haggle.${outcome}`, { shop: esc(shop.name), pct: Math.abs(pct), dc: shop.haggle.dc })
    });
  } catch (err) {
    console.warn("Mint | message du jet impossible", err);
  }

  const shops = getShops();
  const s = shops[shop.id];
  s.haggles = Object.fromEntries(Object.entries(s.haggles ?? {}).filter(([, h]) => Number(h.until) > now));
  s.haggles[actor.uuid] = { pct, total, until: now + Math.max(1, shop.haggle.hours) * 3600 };
  await saveShops(shops);
  return { total, pct, outcome };
});

/* -------------------------------------------- */
/*  Réassort                                    */
/* -------------------------------------------- */

/**
 * Fait avancer le réassort de toutes les boutiques selon le temps du monde (MJ actif).
 * `force` : réassort immédiat d'une boutique, d'un intervalle, quel que soit le temps écoulé.
 */
export async function restockShops({ now = worldTime(), force = null } = {}) {
  const shops = getShops();
  let changed = false;
  for (const raw of Object.values(shops)) {
    const shop = normalizeShop(raw);
    let intervals = 0;
    const period = shop.restockHours * 3600;
    if (force === shop.id) intervals = 1;
    else if (period > 0) {
      if (now < shop.lastRestock) {
        // Retour en arrière dans le temps : on recale sans réassortir
        raw.lastRestock = now;
        changed = true;
        continue;
      }
      intervals = Math.floor((now - shop.lastRestock) / period);
    }
    if (intervals <= 0) continue;
    for (const item of raw.items ?? []) {
      const next = restockStock(normalizeItem(item), intervals);
      if (next !== item.stock) item.stock = next;
    }
    raw.lastRestock = force === shop.id ? now : shop.lastRestock + intervals * period;
    changed = true;
  }
  if (changed) {
    log("Réassort des boutiques");
    await saveShops(shops);
  }
}

/* -------------------------------------------- */
/*  Appels côté client                          */
/* -------------------------------------------- */

export const shopApi = {
  buy: (shopId, entryId, actorUuid, qty = 1) => gmCall("shop.buy", { shopId, entryId, actorUuid, qty }),
  sell: (shopId, entryId, actorUuid, itemId, qty = 1) => gmCall("shop.sell", { shopId, entryId, actorUuid, itemId, qty }),
  haggle: (shopId, actorUuid) => gmCall("shop.haggle", { shopId, actorUuid }),
  /** Prix unitaire actuel, pour un client donné (réputation et marchandage compris) si actorUuid est fourni. */
  price: (shopId, entryId, actorUuid = null) => {
    const shop = getShop(shopId);
    const entry = shop?.items.find((i) => i.id === entryId);
    return entry ? unitPrice(entry, shop, entry.stock, customerPricing(shop, actorUuid).buy) : null;
  }
};
