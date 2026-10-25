/**
 * Mint — économie pour Foundry VTT v14 : monnaies et change, boutiques aux prix dynamiques,
 * marchands sur la scène, réputation et marchandage, prêts et dettes, historique.
 * Point d'entrée : réglages, socket, boutons, hooks et API publique.
 */

import { MODULE_ID, SETTINGS, log, worldTime } from "./constants.js";
import { initSocket } from "./socket.js";
import { getConfig, clearCache, format, parse, denoms, defaultSystemId } from "./currencies.js";
import { getWallet, setWallet, walletApi, actorValue } from "./wallet.js";
import { getShops, getShop, restockShops, shopApi, shopForActor } from "./shops.js";
import { getDebts, debtApi, checkDueDates } from "./debts.js";
import { historyApi } from "./history.js";
import { bridgeApi, potApi } from "./pots.js";
import { registerOtiumBridge } from "./otium.js";
import { refreshApps, openApps } from "./apps/base.js";
import { WalletApp } from "./apps/wallet-app.js";
import { ShopApp } from "./apps/shop-app.js";
import { LedgerApp } from "./apps/ledger-app.js";
import { HistoryApp } from "./apps/history-app.js";
import { CurrencyConfig } from "./apps/currency-config.js";

/* -------------------------------------------- */
/*  Ouverture des fenêtres                      */
/* -------------------------------------------- */

function findOpen(cls) {
  return [...openApps].find((a) => a instanceof cls);
}

export function openWallet(actor = null) {
  const app = findOpen(WalletApp);
  if (app) {
    if (actor) app.showActor(actor);
    else app.render({ force: true });
    return app;
  }
  return new WalletApp(actor).render({ force: true });
}

/** Boutique du marchand ciblé par le joueur, s'il y en a une. */
function targetedShop() {
  for (const token of game.user.targets ?? []) {
    const shop = shopForActor(token.actor);
    if (shop && (shop.open || game.user.isGM)) return shop;
  }
  return null;
}

export function openShops(shopId = null) {
  const id = shopId ?? targetedShop()?.id ?? null;
  const app = findOpen(ShopApp);
  if (app) {
    app.openShop(id ?? app.shopId);
    return app;
  }
  return new ShopApp(id).render({ force: true });
}

export function openLedger() {
  return (findOpen(LedgerApp) ?? new LedgerApp()).render({ force: true });
}

export function openHistory(actor = null) {
  const app = findOpen(HistoryApp);
  if (app) {
    app.filter = actor?.uuid ?? app.filter;
    return app.render({ force: true });
  }
  return new HistoryApp(actor).render({ force: true });
}

export function openCurrencies() {
  return (findOpen(CurrencyConfig) ?? new CurrencyConfig()).render({ force: true });
}

/* -------------------------------------------- */
/*  Initialisation                              */
/* -------------------------------------------- */

Hooks.once("init", () => {
  log("Initialisation");

  const hidden = (key, type, def, onChange) =>
    game.settings.register(MODULE_ID, key, { scope: "world", config: false, type, default: def, onChange });

  hidden(SETTINGS.currencies, Object, {}, () => {
    clearCache();
    refreshApps();
  });
  hidden(SETTINGS.shops, Object, {}, () => refreshApps("shops"));
  hidden(SETTINGS.debts, Object, {}, () => refreshApps("debts"));
  hidden(SETTINGS.history, Object, { entries: [] }, () => refreshApps("history"));
  hidden(SETTINGS.pots, Object, {});
  hidden(SETTINGS.sheetPath, String, "auto", () => refreshApps());

  const visible = (key, data) =>
    game.settings.register(MODULE_ID, key, {
      name: `MINT.Settings.${data.label}.Name`,
      hint: `MINT.Settings.${data.label}.Hint`,
      scope: "world",
      config: true,
      ...data
    });

  visible(SETTINGS.chatLog, {
    label: "ChatLog",
    type: String,
    choices: { off: "MINT.Settings.ChatLog.Off", gm: "MINT.Settings.ChatLog.GM", all: "MINT.Settings.ChatLog.All" },
    default: "gm"
  });
  visible(SETTINGS.historySize, { label: "HistorySize", type: Number, range: { min: 0, max: 5000, step: 50 }, default: 500 });
  visible(SETTINGS.merchantDoubleClick, { label: "MerchantDoubleClick", type: Boolean, default: true });
  visible(SETTINGS.merchantRange, { label: "MerchantRange", type: Number, default: 0 });
  visible(SETTINGS.haggleFormula, { label: "HaggleFormula", type: String, default: "" });
  visible(SETTINGS.dueReminderDays, { label: "DueReminderDays", type: Number, range: { min: 0, max: 30, step: 1 }, default: 1 });
  visible(SETTINGS.otiumHistory, { label: "OtiumHistory", type: Boolean, default: true });

  game.settings.registerMenu(MODULE_ID, "currencyMenu", {
    name: "MINT.Settings.Currencies.Name",
    label: "MINT.Settings.Currencies.Label",
    hint: "MINT.Settings.Currencies.Hint",
    icon: "fa-solid fa-coins",
    type: CurrencyConfig,
    restricted: true
  });
});

Hooks.once("setup", () => patchMerchantTokens());

Hooks.once("ready", () => {
  initSocket();
  registerOtiumBridge();

  game.modules.get(MODULE_ID).api = {
    // Fenêtres
    openWallet,
    openShops,
    openLedger,
    openHistory,
    openCurrencies,
    // Monnaies
    currencies: () => getConfig(),
    format: (value, systemId = defaultSystemId()) => format(value, systemId),
    parse: (text, systemId = defaultSystemId()) => parse(text, systemId),
    denominations: (systemId = defaultSystemId()) => denoms(systemId),
    // Bourses (lecture directe ; les opérations passent par le MJ)
    getWallet,
    setWallet,
    value: (actor, systemId = defaultSystemId()) => actorValue(actor, systemId),
    wallet: walletApi,
    // Paiements pour les autres modules et cagnottes de mises
    pay: bridgeApi.pay,
    receive: bridgeApi.receive,
    pot: potApi,
    // Boutiques
    getShops,
    getShop,
    shopForActor,
    shop: shopApi,
    // Dettes
    getDebts,
    debt: debtApi,
    // Historique
    history: historyApi
  };

  Hooks.callAll(`${MODULE_ID}.ready`, game.modules.get(MODULE_ID).api);
  log("Prêt");
});

/* -------------------------------------------- */
/*  Rafraîchissements                           */
/* -------------------------------------------- */

const walletChanged = (changes) =>
  foundry.utils.hasProperty(changes, `flags.${MODULE_ID}`) || foundry.utils.hasProperty(changes, "system");

Hooks.on("updateActor", (actor, changes) => {
  if (walletChanged(changes)) refreshApps("wallet");
});
Hooks.on("createItem", () => refreshApps("wallet"));
Hooks.on("updateItem", () => refreshApps("wallet"));
Hooks.on("deleteItem", () => refreshApps("wallet"));
Hooks.on("targetToken", (user) => {
  if (user.id === game.user.id) refreshApps("targets");
});

Hooks.on("updateWorldTime", async (time) => {
  refreshApps("time");
  // Seul le MJ actif fait avancer le réassort et les échéances, pour éviter les écritures en double
  if (!game.user.isGM || game.users.activeGM?.id !== game.user.id) return;
  const now = time ?? worldTime();
  try {
    await restockShops({ now });
    await checkDueDates(now);
  } catch (err) {
    console.error("Mint |", err);
  }
});

/* -------------------------------------------- */
/*  Marchands sur la scène                      */
/* -------------------------------------------- */

/** Boutique ouvrable par l'utilisateur courant depuis ce token, ou null. */
function merchantShopFor(token) {
  if (!game.settings.get(MODULE_ID, SETTINGS.merchantDoubleClick)) return null;
  const shop = shopForActor(token?.actor);
  if (!shop) return null;
  return shop.open || game.user.isGM ? shop : null;
}

/**
 * Double-clic sur le token d'un marchand : les joueurs ouvrent sa boutique (même sans droit
 * de voir sa fiche) ; le MJ garde la fiche, et ouvre la boutique avec Alt + double-clic.
 */
function patchMerchantTokens() {
  const proto = CONFIG.Token?.objectClass?.prototype;
  if (!proto || proto._mintPatched) return;
  proto._mintPatched = true;

  const canView = proto._canView;
  proto._canView = function (user, event) {
    if (user?.id === game.user.id && !user.isGM && merchantShopFor(this)) return true;
    return canView.call(this, user, event);
  };

  const dblClick = proto._onClickLeft2;
  proto._onClickLeft2 = function (event) {
    const shop = merchantShopFor(this);
    const alt = !!(event?.altKey ?? event?.data?.originalEvent?.altKey);
    if (shop && (!game.user.isGM || alt)) return openShops(shop.id);
    return dblClick.call(this, event);
  };
}

/* -------------------------------------------- */
/*  Boutons                                     */
/* -------------------------------------------- */

// Outils ajoutés au groupe « Jetons », visible par tous les joueurs
Hooks.on("getSceneControlButtons", (controls) => {
  const tokens = controls.tokens;
  if (!tokens?.tools) return;
  const base = Object.keys(tokens.tools).length + 10;
  const button = (name, title, icon, order, fn) => ({ name, title, icon, order, button: true, visible: true, onChange: fn });
  tokens.tools.mintWallet = button("mintWallet", "MINT.Controls.Wallet", "fa-solid fa-coins", base, () => openWallet());
  tokens.tools.mintShops = button("mintShops", "MINT.Controls.Shops", "fa-solid fa-store", base + 1, () => openShops());
  tokens.tools.mintLedger = button("mintLedger", "MINT.Controls.Ledger", "fa-solid fa-book", base + 2, () => openLedger());
});

// Bouton « Bourse » (et « Boutique » pour un marchand) dans l'en-tête des fiches d'acteur
Hooks.on("getHeaderControlsActorSheetV2", (app, controls) => {
  const actor = app.document;
  if (!actor) return;
  const add = (action, icon, label, fn) => {
    // Repli si onClick n'est pas pris en charge : l'action est aussi déclarée sur la fiche
    if (app.options?.actions && !app.options.actions[action]) app.options.actions[action] = fn;
    controls.push({ icon, label, action, onClick: fn });
  };
  if (actor.isOwner) add("mintWallet", "fa-solid fa-coins", "MINT.Wallet.Title", () => openWallet(actor));
  const shop = shopForActor(actor);
  if (shop && (shop.open || game.user.isGM)) add("mintShop", "fa-solid fa-store", "MINT.Shop.OpenMerchant", () => openShops(shop.id));
});

