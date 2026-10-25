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
 *   treasury    : caisse du marchand (null = illimitée)
 *   items: [{ id, name, img, uuid, description, price, stock, target, restock, modifier, buyback }]
 *     price : prix de base en unités de base du système de la boutique
 *     stock : null = illimité ; target = stock normal ; restock = unités par intervalle
 * }
 */

import { MODULE_ID, SETTINGS, MintError, t, esc, worldTime, log } from "./constants.js";
import { getSystem, defaultSystemId, format } from "./currencies.js";
import { PRICING_DEFAULTS, unitPrice, buyTotal, sellTotal, restockStock } from "./core/pricing.js";
import { registerHandler, gmCall } from "./socket.js";
import { resolveActor, requireOwner, chargeActor, creditActor } from "./wallet.js";
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

export function normalizeShop(shop) {
  return {
    id: shop.id,
    name: String(shop.name ?? "").trim() || "?",
    img: shop.img || "icons/svg/chest.svg",
    description: String(shop.description ?? ""),
    system: getSystem(shop.system)?.id ?? defaultSystemId(),
    open: !!shop.open,
    markup: numOr(shop.markup, PRICING_DEFAULTS.markup),
    sellRatio: Math.min(Math.max(numOr(shop.sellRatio, PRICING_DEFAULTS.sellRatio), 0), 1),
    elasticity: Math.max(0, numOr(shop.elasticity, PRICING_DEFAULTS.elasticity)),
    minFactor: Math.max(0, numOr(shop.minFactor, PRICING_DEFAULTS.minFactor)),
    maxFactor: Math.max(0, numOr(shop.maxFactor, PRICING_DEFAULTS.maxFactor)),
    restockHours: Math.max(0, numOr(shop.restockHours, 24)),
    lastRestock: numOr(shop.lastRestock, 0),
    treasury: shop.treasury === null || shop.treasury === undefined || shop.treasury === "" ? null : Math.max(0, Math.floor(numOr(shop.treasury, 0))),
    items: (shop.items ?? []).map(normalizeItem)
  };
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
  const entry = shop.items.find((i) => i.id === entryId);
  if (!entry) throw new MintError("ItemMissing", { name: "?" });
  return { shop, entry };
}

registerHandler("shop.buy", async ({ shopId, entryId, actorUuid, qty }, user) => {
  const actor = await resolveActor(actorUuid);
  requireOwner(user, actor);
  const { shop, entry } = findForUser(shopId, entryId, user);
  const n = Math.floor(Number(qty));
  if (!(n >= 1) || n > 999) throw new MintError("BadQuantity");
  if (entry.stock !== null && entry.stock < n) throw new MintError("OutOfStock", { name: entry.name, stock: entry.stock });
  const total = buyTotal(entry, shop, n);

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
  if (s.treasury !== null && s.treasury !== undefined && s.treasury !== "") s.treasury = Number(s.treasury) + total;
  await saveShops(shops);

  await logTransaction(
    t("Chat.Buy", { name: esc(actor.name), qty: n, item: esc(entry.name), shop: esc(shop.name), amount: esc(format(total, shop.system)) }),
    { icon: "fa-cart-shopping" }
  );
  return { total };
});

registerHandler("shop.sell", async ({ shopId, entryId, actorUuid, itemId, qty }, user) => {
  const actor = await resolveActor(actorUuid);
  requireOwner(user, actor);
  const { shop, entry } = findForUser(shopId, entryId, user);
  if (!entry.buyback) throw new MintError("NoBuyback", { name: entry.name });
  const item = actor.items.get(itemId);
  if (!item || !matchesEntry(item, entry)) throw new MintError("ItemMissing", { name: entry.name });
  const n = Math.floor(Number(qty));
  const has = itemQuantity(item);
  const hasQtyField = typeof foundry.utils.getProperty(item, "system.quantity") === "number";
  if (!(n >= 1) || n > has || (!hasQtyField && n !== 1)) throw new MintError("BadQuantity");
  const total = sellTotal(entry, shop, n);
  if (shop.treasury !== null && shop.treasury < total) {
    throw new MintError("ShopBroke", { shop: shop.name, amount: format(shop.treasury, shop.system) });
  }

  if (hasQtyField && n < has) await item.update({ "system.quantity": has - n });
  else await item.delete();
  if (total > 0) await creditActor(actor, total, shop.system);

  const shops = getShops();
  const s = shops[shop.id];
  const e = s.items.find((i) => i.id === entry.id);
  if (e.stock !== null && e.stock !== undefined) e.stock = Number(e.stock) + n;
  if (s.treasury !== null && s.treasury !== undefined && s.treasury !== "") s.treasury = Math.max(0, Number(s.treasury) - total);
  await saveShops(shops);

  await logTransaction(
    t("Chat.Sell", { name: esc(actor.name), qty: n, item: esc(entry.name), shop: esc(shop.name), amount: esc(format(total, shop.system)) }),
    { icon: "fa-sack-dollar" }
  );
  return { total };
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
  price: (shopId, entryId) => {
    const shop = getShop(shopId);
    const entry = shop?.items.find((i) => i.id === entryId);
    return entry ? unitPrice(entry, shop) : null;
  }
};
