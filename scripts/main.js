/**
 * Mint — économie pour Foundry VTT v14 : monnaies et change, boutiques aux prix dynamiques,
 * prêts et dettes entre joueurs.
 * Point d'entrée : réglages, socket, boutons, hooks et API publique.
 */

import { MODULE_ID, SETTINGS, log, worldTime } from "./constants.js";
import { initSocket } from "./socket.js";
import { getConfig, clearCache, format, parse, denoms, defaultSystemId } from "./currencies.js";
import { getWallet, setWallet, walletApi, actorValue } from "./wallet.js";
import { getShops, getShop, restockShops, shopApi } from "./shops.js";
import { getDebts, debtApi } from "./debts.js";
import { refreshApps, openApps } from "./apps/base.js";
import { WalletApp } from "./apps/wallet-app.js";
import { ShopApp } from "./apps/shop-app.js";
import { LedgerApp } from "./apps/ledger-app.js";
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

export function openShops(shopId = null) {
  const app = findOpen(ShopApp);
  if (app) {
    app.openShop(shopId ?? app.shopId);
    return app;
  }
  return new ShopApp(shopId).render({ force: true });
}

export function openLedger() {
  return (findOpen(LedgerApp) ?? new LedgerApp()).render({ force: true });
}

export function openCurrencies() {
  return (findOpen(CurrencyConfig) ?? new CurrencyConfig()).render({ force: true });
}

/* -------------------------------------------- */
/*  Initialisation                              */
/* -------------------------------------------- */

Hooks.once("init", () => {
  log("Initialisation");

  game.settings.register(MODULE_ID, SETTINGS.currencies, {
    scope: "world",
    config: false,
    type: Object,
    default: {},
    onChange: () => {
      clearCache();
      refreshApps();
    }
  });

  game.settings.register(MODULE_ID, SETTINGS.shops, {
    scope: "world",
    config: false,
    type: Object,
    default: {},
    onChange: () => refreshApps("shops")
  });

  game.settings.register(MODULE_ID, SETTINGS.debts, {
    scope: "world",
    config: false,
    type: Object,
    default: {},
    onChange: () => refreshApps("debts")
  });

  game.settings.register(MODULE_ID, SETTINGS.sheetPath, {
    scope: "world",
    config: false,
    type: String,
    default: "auto",
    onChange: () => refreshApps()
  });

  game.settings.register(MODULE_ID, SETTINGS.chatLog, {
    name: "MINT.Settings.ChatLog.Name",
    hint: "MINT.Settings.ChatLog.Hint",
    scope: "world",
    config: true,
    type: String,
    choices: {
      off: "MINT.Settings.ChatLog.Off",
      gm: "MINT.Settings.ChatLog.GM",
      all: "MINT.Settings.ChatLog.All"
    },
    default: "gm"
  });

  game.settings.registerMenu(MODULE_ID, "currencyMenu", {
    name: "MINT.Settings.Currencies.Name",
    label: "MINT.Settings.Currencies.Label",
    hint: "MINT.Settings.Currencies.Hint",
    icon: "fa-solid fa-coins",
    type: CurrencyConfig,
    restricted: true
  });
});

Hooks.once("ready", () => {
  initSocket();

  game.modules.get(MODULE_ID).api = {
    // Fenêtres
    openWallet,
    openShops,
    openLedger,
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
    // Boutiques
    getShops,
    getShop,
    shop: shopApi,
    // Dettes
    getDebts,
    debt: debtApi
  };

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

Hooks.on("updateWorldTime", (time) => {
  refreshApps("time");
  // Seul le MJ actif fait avancer le réassort, pour éviter les écritures en double
  if (game.user.isGM && game.users.activeGM?.id === game.user.id) restockShops({ now: time ?? worldTime() });
});

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

// Bouton « Bourse » dans l'en-tête des fiches d'acteur
Hooks.on("getHeaderControlsActorSheetV2", (app, controls) => {
  const actor = app.document;
  if (!actor?.isOwner) return;
  // Repli si onClick n'est pas pris en charge : l'action est aussi déclarée sur la fiche
  if (app.options?.actions && !app.options.actions.mintWallet) {
    app.options.actions.mintWallet = () => openWallet(actor);
  }
  controls.push({
    icon: "fa-solid fa-coins",
    label: "MINT.Wallet.Title",
    action: "mintWallet",
    onClick: () => openWallet(actor)
  });
});
