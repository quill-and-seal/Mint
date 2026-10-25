// Test de fumée : charge Mint dans un faux Foundry minimal et rejoue les opérations
// principales (bourse, change, boutique, dettes), y compris les droits d'un joueur.
// Usage : node tools/smoke.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/* ---------- utilitaires façon foundry.utils ---------- */
const getProperty = (o, path) => path.split(".").reduce((x, k) => (x == null ? undefined : x[k]), o);
const setProperty = (o, path, v) => {
  const ks = path.split(".");
  let x = o;
  for (const k of ks.slice(0, -1)) x = x[k] ??= {};
  x[ks.at(-1)] = v;
};
const hasProperty = (o, path) => getProperty(o, path) !== undefined;
const deepClone = (o) => (o === undefined ? undefined : structuredClone(o));
let idn = 0;
const randomID = () => `id${++idn}`;
const expandObject = (flat) => {
  const out = {};
  for (const [k, v] of Object.entries(flat)) setProperty(out, k, v);
  return out;
};

/* ---------- documents ---------- */
const docs = new Map();
class Item {
  constructor(data, parent) {
    Object.assign(this, deepClone(data));
    this.id = data._id ?? randomID();
    this.parent = parent;
    this.flags ??= {};
  }
  getFlag(scope, key) {
    return this.flags?.[scope]?.[key];
  }
  toObject() {
    const { parent, ...rest } = this;
    return deepClone({ ...rest, _id: this.id });
  }
  async update(changes) {
    for (const [k, v] of Object.entries(changes)) setProperty(this, k, v);
  }
  async delete() {
    this.parent.items.delete(this.id);
  }
}
class Collection extends Map {
  find(fn) {
    return [...this.values()].find(fn);
  }
  filter(fn) {
    return [...this.values()].filter(fn);
  }
  [Symbol.iterator]() {
    return this.values();
  }
}
class Actor {
  constructor(name, owners = [], system = {}) {
    this.id = randomID();
    this.uuid = `Actor.${this.id}`;
    this.name = name;
    this.owners = owners;
    this.system = system;
    this.flags = {};
    this.items = new Collection();
    docs.set(this.uuid, this);
  }
  get hasPlayerOwner() {
    return this.owners.some((u) => !u.isGM);
  }
  get isOwner() {
    return this.testUserPermission(globalThis.game.user, "OWNER");
  }
  testUserPermission(user) {
    return user.isGM || this.owners.includes(user);
  }
  getFlag(scope, key) {
    return this.flags?.[scope]?.[key];
  }
  async update(changes) {
    for (const [k, v] of Object.entries(changes)) setProperty(this, k, v);
  }
  async createEmbeddedDocuments(type, list) {
    return list.map((d) => {
      const it = new Item(d, this);
      this.items.set(it.id, it);
      return it;
    });
  }
}

/* ---------- utilisateurs, réglages, socket ---------- */
const gm = { id: "gm", name: "MJ", isGM: true, active: true };
const alice = { id: "alice", name: "Alice", isGM: false, active: true };
const bob = { id: "bob", name: "Bob", isGM: false, active: true };
const users = [gm, alice, bob];
users.activeGM = gm;
users.get = (id) => users.find((u) => u.id === id);

const settings = new Map();
const settingDefs = new Map();
const listeners = [];
const hooks = {};
const chat = [];
const notes = [];

globalThis.Actor = Actor;
globalThis.Item = Item;
globalThis.CSS = { escape: (s) => s };
globalThis.ui = { notifications: { info: (m) => notes.push(["info", m]), warn: (m) => notes.push(["warn", m]), error: (m) => notes.push(["error", m]) } };
globalThis.Hooks = {
  on: (n, f) => (hooks[n] ??= []).push(f),
  once: (n, f) => (hooks[n] ??= []).push(f),
  call: (n, ...a) => (hooks[n] ?? []).forEach((f) => f(...a)),
  callAll: (n, ...a) => (hooks[n] ?? []).forEach((f) => f(...a))
};
globalThis.ChatMessage = {
  create: async (d) => chat.push(d),
  getSpeaker: (x) => x,
  getWhisperRecipients: () => [gm]
};
globalThis.fromUuid = async (u) => docs.get(u) ?? null;
globalThis.fromUuidSync = (u) => docs.get(u) ?? null;
globalThis.canvas = { tokens: { controlled: [] }, scene: { tokens: [] } };
// Jet de dés factice : le total est réglé par le test
let nextRoll = 10;
globalThis.Roll = class {
  constructor(formula, data) {
    this.formula = formula;
    this.data = data;
  }
  async evaluate() {
    this.total = nextRoll;
    return this;
  }
  async toMessage(d) {
    chat.push({ roll: this.total, ...d });
  }
};
class FakeToken {
  constructor(actor, x, y) {
    Object.assign(this, { actor, actorId: actor.id, actorLink: true, x, y, width: 1, height: 1 });
  }
}
const sceneTokens = [];
sceneTokens.find = Array.prototype.find;
globalThis.CONFIG = { Token: { objectClass: class { _canView() { return false; } _onClickLeft2() { return "sheet"; } } } };

const fr = JSON.parse(readFileSync(new URL("../lang/fr.json", import.meta.url)));
const localize = (k) => getProperty(fr, k) ?? k;

globalThis.game = {
  user: gm,
  users,
  system: { id: "dnd5e" },
  time: { worldTime: 0 },
  actors: new Collection(),
  modules: new Map([["mint-economy", {}], ["otium", { active: true }]]),
  scenes: [{ tokens: sceneTokens, grid: { size: 100, distance: 5 } }],
  i18n: {
    localize,
    format: (k, d) => localize(k).replace(/\{(\w+)\}/g, (_, x) => d[x]),
    has: (k) => getProperty(fr, k) !== undefined
  },
  settings: {
    register: (m, k, def) => {
      settingDefs.set(k, def);
      settings.set(k, deepClone(def.default));
    },
    registerMenu: () => {},
    get: (m, k) => deepClone(settings.get(k)),
    set: async (m, k, v) => {
      settings.set(k, deepClone(v));
      settingDefs.get(k)?.onChange?.(v);
    }
  },
  socket: {
    on: (ch, fn) => listeners.push(fn),
    emit: (ch, msg) => {
      // Rejoue le message sur « l'autre client » : la requête chez le MJ, la réponse chez le joueur
      const sender = game.user;
      const target = msg.type === "request" ? gm : users.get(msg.to) ?? sender;
      if (msg.type === "notify") return;
      queueMicrotask(() => {
        // Chaque « client » voit son propre utilisateur : le temps de la partie synchrone de
        // l'écouteur (vérification « suis-je le MJ actif ? » / « cette réponse est-elle pour moi ? »)
        const previous = game.user;
        game.user = target;
        for (const l of listeners) l(msg);
        game.user = previous;
      });
    }
  }
};

class ApplicationV2 {}
globalThis.foundry = {
  utils: { getProperty, setProperty, hasProperty, deepClone, randomID, expandObject, saveDataToFile: () => {} },
  applications: { api: { ApplicationV2, DialogV2: {} }, ux: { TextEditor: { implementation: {} } }, apps: { FilePicker: {} } }
};

/* ---------- chargement ---------- */
await import("../scripts/main.js");
Hooks.call("init");
Hooks.call("setup");
Hooks.call("ready");
const api = game.modules.get("mint-economy").api;
assert.ok(api, "API publiée");

const heroA = new Actor("Aria", [alice], { currency: { pp: 0, gp: 10, ep: 0, sp: 5, cp: 0 } });
const heroB = new Actor("Brann", [bob], { currency: { pp: 0, gp: 0, ep: 0, sp: 0, cp: 0 } });
const merchant = new Actor("Marchand", []);
for (const a of [heroA, heroB, merchant]) game.actors.set(a.id, a);
const value = (a) => api.value(a);

/* ---------- monnaies ---------- */
assert.equal(api.format(1050), "1 pp 1 pe");
assert.equal(api.parse("2 po 5 pa"), 250);
assert.equal(value(heroA), 1050, "lecture de system.currency (dnd5e)");

/* ---------- bourse : en tant que joueur ---------- */
game.user = alice;
await api.wallet.give(heroA.uuid, heroB.uuid, { po: 2 });
assert.equal(heroA.system.currency.gp, 8);
assert.equal(heroB.system.currency.gp, 2, "don écrit sur la fiche");
await assert.rejects(api.wallet.give(heroB.uuid, heroA.uuid, { po: 1 }), (e) => e.key === "NotOwner");
await assert.rejects(api.wallet.give(heroA.uuid, heroB.uuid, { po: 99 }), (e) => e.key === "NotEnoughCoins");
await api.wallet.consolidate(heroA.uuid, "standard");
assert.equal(value(heroA), 850);
assert.deepEqual(heroA.system.currency, { pp: 0, gp: 8, ep: 1, sp: 0, cp: 0 });

/* ---------- change entre systèmes (MJ) ---------- */
game.user = gm;
const cfg = api.currencies();
const { saveConfig } = await import("../scripts/currencies.js");
await saveConfig({
  ...cfg,
  fee: 0.1,
  systems: [...cfg.systems, { id: "east", name: "Orient", rate: 10, primary: "ryo" }],
  currencies: [...cfg.currencies, { id: "ryo", system: "east", name: "Ryō", abbr: "ryō", value: 1, color: "#ccaa00", sheetKey: "" }]
});
game.user = alice;
await api.wallet.exchange(heroA.uuid, "standard", "east", 100); // 1 po → 10 unités ×0,9 = 9 ryō
assert.equal(heroA.flags["mint-economy"].wallet.ryo, 9, "devise non reliée stockée en flag");
assert.equal(value(heroA), 750);

/* ---------- boutique ---------- */
game.user = gm;
const potion = new Item({ name: "Potion de soins", img: "p.png", system: { quantity: 1, price: { value: 50, denomination: "gp" } } });
potion.uuid = "Item.potion";
docs.set(potion.uuid, potion);
const { newShop, saveShop, newItem, restockShops } = await import("../scripts/shops.js");
const shop = newShop({ name: "Herboriste", open: false, restockHours: 24 });
shop.items.push(newItem({ name: "Potion de soins", uuid: potion.uuid, price: 50, stock: 3, target: 3, restock: 1 }));
shop.items.push(newItem({ name: "Nuit à l'auberge", uuid: "", price: 5, stock: null }));
await saveShop(shop);
const entry = api.getShop(shop.id).items[0];

game.user = alice;
await assert.rejects(api.shop.buy(shop.id, entry.id, heroA.uuid, 1), (e) => e.key === "ShopClosed");
game.user = gm;
await saveShop({ ...api.getShop(shop.id), open: true });
game.user = alice;
const before = value(heroA);
const { total } = await api.shop.buy(shop.id, entry.id, heroA.uuid, 2); // 50 (stock 3) + 58 (stock 2)
assert.equal(total, 50 + 58);
assert.equal(value(heroA), before - total);
const bought = heroA.items.find((i) => i.name === "Potion de soins");
assert.equal(bought.system.quantity, 2, "objets reçus avec la quantité");
assert.equal(api.getShop(shop.id).items[0].stock, 1);
await assert.rejects(api.shop.buy(shop.id, entry.id, heroA.uuid, 5), (e) => e.key === "OutOfStock");
const service = api.getShop(shop.id).items[1];
await api.shop.buy(shop.id, service.id, heroA.uuid, 1);
assert.equal(heroA.items.size, 1, "un service ne donne pas d'objet");

// Revente d'une potion : prix au stock 2 = 58, × 0,5 = 29
const v2 = value(heroA);
const sold = await api.shop.sell(shop.id, entry.id, heroA.uuid, bought.id, 1);
assert.equal(sold.total, 29);
assert.equal(value(heroA), v2 + 29);
assert.equal(bought.system.quantity, 1);
assert.equal(api.getShop(shop.id).items[0].stock, 2);

// Réassort au bout de 24 h
game.user = gm;
game.time.worldTime = 24 * 3600;
await restockShops();
assert.equal(api.getShop(shop.id).items[0].stock, 3);

/* ---------- dettes ---------- */
game.user = alice;
heroB.system.currency.gp = 0;
const vA = value(heroA);
// Alice prête 1 po à Brann : proposition en attente de Bob
const prop = await api.debt.propose({
  creditor: { uuid: heroA.uuid }, debtor: { uuid: heroB.uuid }, principal: 100, system: "standard",
  rate: 10, periodDays: 7, transfer: true, note: "Pour l'épée"
});
assert.equal(prop.status, "proposed");
await assert.rejects(api.debt.respond(prop.id, true), (e) => e.key === "NotParty");
game.user = bob;
await api.debt.respond(prop.id, true);
assert.equal(value(heroA), vA - 100, "le créancier a versé le prêt");
assert.equal(heroB.system.currency.gp, 1, "le débiteur a reçu le prêt");

// Une semaine passe : 10 % d'intérêts
game.time.worldTime += 7 * 86400;
const debt = Object.values(api.getDebts())[0];
assert.equal(api.debt.owed(debt), 110);
heroB.system.currency.gp = 2;
await api.debt.repay(prop.id, 50);
assert.equal(api.debt.owed(api.getDebts()[prop.id]), 60);
await api.debt.repay(prop.id, 1000); // plafonné au reste
assert.equal(api.getDebts()[prop.id].status, "closed");
assert.equal(api.getDebts()[prop.id].closedReason, "repaid");
assert.equal(value(heroA), vA - 100 + 110, "le créancier a récupéré capital et intérêts");

// Le MJ impose une dette envers une banque (partie libre)
game.user = alice;
await assert.rejects(api.debt.impose({ creditor: { name: "Banque" }, debtor: { uuid: heroA.uuid }, principal: 10 }), (e) => e.key === "GMOnly");
game.user = gm;
const imposed = await api.debt.impose({ creditor: { uuid: null, name: "Banque de Lys" }, debtor: { uuid: heroA.uuid }, principal: 500, transfer: true });
assert.equal(api.getDebts()[imposed.id].status, "active");
assert.equal(value(heroA), vA - 100 + 110 + 500, "prêt d'une banque versé au débiteur");

// Le créancier joueur efface une dette
game.user = bob;
const iou = await api.debt.propose({ creditor: { uuid: heroB.uuid }, debtor: { uuid: heroA.uuid }, principal: 30, transfer: false });
game.user = alice;
await api.debt.respond(iou.id, true);
game.user = bob;
await api.debt.forgive(iou.id);
assert.equal(api.getDebts()[iou.id].closedReason, "forgiven");

/* ---------- 0.2 : historique ---------- */
const hist = api.history.get();
assert.ok(hist.length >= 8, "transactions inscrites à l'historique");
assert.ok(api.history.for(heroA).some((e) => e.type === "buy" && e.amount === 108), "achat dans l'historique d'Aria");
assert.ok(hist[0].ts >= hist.at(-1).ts, "historique du plus récent au plus ancien");

/* ---------- 0.2 : marchand sur la scène, caisse = bourse du marchand ---------- */
game.user = gm;
const { getShop: shopNow } = await import("../scripts/shops.js");
await saveShop({ ...shopNow(shop.id), merchant: merchant.uuid, till: "merchant" });
assert.equal(api.shopForActor(merchant)?.id, shop.id, "boutique retrouvée depuis le marchand");
game.user = alice;
heroA.system.currency.gp = 20;
const merchantBefore = value(merchant);
const r2 = await api.shop.buy(shop.id, entry.id, heroA.uuid, 1);
assert.equal(value(merchant), merchantBefore + r2.total, "l'achat enrichit le marchand");
// Le marchand ne peut racheter que ce qu'il a en bourse
game.user = gm;
await api.wallet.set(merchant.uuid, { pp: 0, po: 0, pe: 0, pa: 0, pc: 3, ryo: 0 });
game.user = alice;
const potionA = heroA.items.find((i) => i.name === "Potion de soins");
await assert.rejects(api.shop.sell(shop.id, entry.id, heroA.uuid, potionA.id, 1), (e) => e.key === "ShopBroke");

// Double-clic : un joueur peut « voir » le token d'un marchand ouvert
const tokenProto = CONFIG.Token.objectClass.prototype;
assert.equal(tokenProto._canView.call({ actor: merchant }, alice), true, "token du marchand ouvrable");
assert.equal(tokenProto._canView.call({ actor: heroB }, alice), false, "autre token inchangé");

/* ---------- 0.2 : réputation ---------- */
game.user = gm;
const fullPrice = api.shop.price(shop.id, entry.id, heroA.uuid);
await saveShop({ ...shopNow(shop.id), customers: { [heroA.uuid]: -10 } });
const repPrice = api.shop.price(shop.id, entry.id, heroA.uuid);
assert.ok(Math.abs(repPrice - fullPrice * 0.9) <= 1, `réputation : 10 % de remise (${repPrice} / ${fullPrice})`);
assert.equal(api.shop.price(shop.id, entry.id, heroB.uuid), fullPrice, "les autres paient le prix normal");

/* ---------- 0.2 : marchandage ---------- */
game.user = alice;
await assert.rejects(api.shop.haggle(shop.id, heroA.uuid), (e) => e.key === "NoHaggle");
game.user = gm;
await saveShop({ ...shopNow(shop.id), haggle: { enabled: true, dc: 15, maxDiscount: 20, penalty: 10, hours: 24 } });
game.user = alice;
nextRoll = 20;
const h1 = await api.shop.haggle(shop.id, heroA.uuid);
assert.equal(h1.pct, -10, "marchandage réussi de 5 : −10 %");
assert.ok(chat.some((c) => c.roll === 20), "jet de marchandage affiché dans le chat");
await assert.rejects(api.shop.haggle(shop.id, heroA.uuid), (e) => e.key === "AlreadyHaggled");
assert.ok(Math.abs(api.shop.price(shop.id, entry.id, heroA.uuid) - fullPrice * 0.8) <= 1, "réputation + marchandage cumulés");
game.time.worldTime += 25 * 3600;
nextRoll = 5;
const h2 = await api.shop.haggle(shop.id, heroA.uuid);
assert.equal(h2.pct, 10, "jet raté de 10 : marchand vexé");

/* ---------- 0.2 : distance au marchand ---------- */
game.user = gm;
await game.settings.set("mint-economy", "merchantRange", 10);
sceneTokens.push(new FakeToken(merchant, 0, 0), new FakeToken(heroA, 1000, 0));
game.user = alice;
await assert.rejects(api.shop.buy(shop.id, service.id, heroA.uuid, 1), (e) => e.key === "TooFar");
sceneTokens[1].x = 100; // une case = 5 unités
await api.shop.buy(shop.id, service.id, heroA.uuid, 1);
game.user = gm;
await game.settings.set("mint-economy", "merchantRange", 0);

/* ---------- 0.2 : échéances, pénalité, rappels ---------- */
const due = await api.debt.impose({ creditor: { uuid: null, name: "Usurier" }, debtor: { uuid: heroB.uuid }, principal: 100, dueDays: 3, lateFee: 10 });
const tick = async (seconds) => {
  game.time.worldTime += seconds;
  for (const f of hooks.updateWorldTime ?? []) await f(game.time.worldTime);
};
assert.equal(api.debt.daysLeft(api.getDebts()[due.id]), 3);
await tick(2 * 86400 + 60);
assert.equal(api.getDebts()[due.id].reminded.soon, true, "rappel la veille de l'échéance");
assert.equal(api.getDebts()[due.id].reminded.overdue, false);
await tick(2 * 86400);
const lateDebt = api.getDebts()[due.id];
assert.equal(lateDebt.reminded.overdue, true, "rappel de retard");
assert.equal(api.debt.overdue(lateDebt), true);
assert.equal(api.debt.owed(lateDebt), 110, "pénalité de retard de 10 %");
assert.ok(api.history.get().some((e) => e.type === "overdue"), "retard inscrit à l'historique");

/* ---------- 0.2 : paiements pour les autres modules et cagnottes ---------- */
game.user = alice;
heroA.system.currency.gp = 10;
heroB.system.currency.gp = 10;
const vA2 = value(heroA);
await api.pay(heroA, 5, { reason: "Péage", source: "macro" });
assert.equal(value(heroA), vA2 - 5);
await assert.rejects(api.receive(heroA, 5), (e) => e.key === "GMOnly");
const pot = await api.pot.create({ label: "Dés du menteur", source: "otium" });
await api.pot.stake(pot.id, heroA, 100);
game.user = bob;
await api.pot.stake(pot.id, heroB, 200);
assert.equal(api.pot.total(pot.id), 300);
await assert.rejects(api.pot.settle(pot.id, [heroB]), (e) => e.key === "NotPotOwner");
game.user = alice;
const vB = value(heroB);
await api.pot.settle(pot.id, [heroB]);
assert.equal(value(heroB), vB + 300, "le gagnant remporte la cagnotte");
assert.equal(api.pot.get(pot.id).status, "settled");
await assert.rejects(api.pot.stake(pot.id, heroA, 10), (e) => e.key === "PotClosed");
// Cagnotte remboursée
const pot2 = await api.pot.create({ label: "Bras de fer" });
const vA3 = value(heroA);
await api.pot.stake(pot2.id, heroA, 50);
await api.pot.refund(pot2.id);
assert.equal(value(heroA), vA3, "mise rendue");
game.user = gm;
await api.receive(heroA, 7, { reason: "Pourboire" });
assert.equal(value(heroA), vA3 + 7);

/* ---------- 0.2 : pont Otium ---------- */
game.user = alice;
Hooks.call("otium.orderPlaced", { actor: heroA, tavern: { name: "Le Gué" }, lines: [{ item: { name: "Bière" }, qty: 2 }], total: 8 });
await new Promise((r) => setTimeout(r, 20));
const otiumEntry = api.history.get().find((e) => e.type === "otium");
assert.ok(otiumEntry, "commande Otium inscrite à l'historique");
assert.equal(otiumEntry.amount, 8);
assert.match(otiumEntry.text, /Le Gué/);
game.user = gm;

assert.ok(chat.length >= 6, "transactions annoncées dans le chat");
assert.ok(chat.filter((c) => c.roll === undefined).every((c) => c.whisper?.includes("gm")), "transactions en privé au MJ par défaut");
console.log(`OK — test de fumée réussi (${chat.length} messages de chat, ${notes.length} notifications).`);
