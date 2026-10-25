/**
 * Boutiques côté joueurs (et MJ) : liste des boutiques, achat, revente, marchandage.
 * Les prix affichés sont ceux du personnage choisi (réputation et marchandage compris).
 * Le MJ y crée, ouvre, réassortit et modifie ses boutiques.
 */

import { t, esc, worldTime } from "../constants.js";
import { format, denoms } from "../currencies.js";
import { walletValue } from "../core/money.js";
import { getWallet, ownedActors, defaultActor } from "../wallet.js";
import {
  visibleShops, getShop, newShop, saveShop, deleteShop, restockShops, sellableItems, itemQuantity,
  unitPrice, buyTotal, sellTotal, shopApi, customerPricing, activeHaggle, merchantActor
} from "../shops.js";
import { actorValue } from "../wallet.js";
import { MintApp, confirmDialog, options } from "./base.js";
import { ShopEditor } from "./shop-editor.js";

export class ShopApp extends MintApp {
  static watches = ["shops", "wallet", "currencies", "time"];

  constructor(shopId = null, options = {}) {
    super(options);
    this.shopId = shopId;
    this.actorUuid = defaultActor()?.uuid ?? null;
    this.tab = "buy";
  }

  static DEFAULT_OPTIONS = {
    id: "mint-shops",
    classes: ["mint", "mint-shops"],
    window: { icon: "fa-solid fa-store", resizable: true },
    position: { width: 720, height: 560 },
    actions: {
      selectShop: ShopApp.#onSelectShop,
      tab: ShopApp.#onTab,
      buy: ShopApp.#onBuy,
      sell: ShopApp.#onSell,
      newShop: ShopApp.#onNewShop,
      editShop: ShopApp.#onEditShop,
      toggleOpen: ShopApp.#onToggleOpen,
      restock: ShopApp.#onRestock,
      deleteShop: ShopApp.#onDeleteShop,
      haggle: ShopApp.#onHaggle
    }
  };

  get title() {
    return t("Shop.Title");
  }

  get actor() {
    return this.actorUuid ? fromUuidSync(this.actorUuid) : null;
  }

  openShop(id) {
    this.shopId = id;
    this.render({ force: true });
  }

  _html() {
    const shops = visibleShops();
    if (!shops.find((s) => s.id === this.shopId)) this.shopId = shops[0]?.id ?? null;
    const shop = this.shopId ? getShop(this.shopId) : null;
    const gm = game.user.isGM;

    const list = shops
      .map(
        (s) => `
        <li class="${s.id === this.shopId ? "active" : ""}" data-action="selectShop" data-shop="${esc(s.id)}">
          <img src="${esc(s.img)}" alt="">
          <span>${esc(s.name)}</span>
          ${gm ? `<i class="fa-solid ${s.open ? "fa-door-open" : "fa-door-closed"} mint-muted" data-tooltip="${esc(t(s.open ? "Shop.Open" : "Shop.Closed"))}"></i>` : ""}
        </li>`
      )
      .join("");

    const sidebar = `
      <aside class="mint-shop-list">
        <ul data-scroll="shops">${list || `<li class="mint-empty">${t("Shop.None")}</li>`}</ul>
        ${gm ? `<button type="button" data-action="newShop"><i class="fa-solid fa-plus"></i> ${t("Shop.Create")}</button>` : ""}
      </aside>`;

    return `<div class="mint-shop-layout">${sidebar}<section class="mint-shop-main">${shop ? this._shopHtml(shop) : ""}</section></div>`;
  }

  _shopHtml(shop) {
    const gm = game.user.isGM;
    const actor = this.actor;
    const actors = ownedActors();
    if (actor && !actors.includes(actor)) actors.unshift(actor);
    const purse = actor ? format(walletValue(getWallet(actor), denoms(shop.system)), shop.system) : "—";

    const merchant = merchantActor(shop);
    const pricing = customerPricing(shop, actor?.uuid);
    const till =
      shop.till === "fixed"
        ? format(shop.treasury, shop.system)
        : shop.till === "merchant" && merchant
          ? format(actorValue(merchant, shop.system), shop.system)
          : null;

    // Prix du client : réputation et marchandage en cours
    const tags = [];
    if (actor && pricing.reputation) {
      tags.push(`<span class="mint-tag ${pricing.reputation < 0 ? "good" : "bad"}" data-tooltip="${esc(t("Shop.ReputationHint"))}"><i class="fa-solid fa-handshake"></i> ${t(pricing.reputation < 0 ? "Shop.Discount" : "Shop.Markup", { pct: Math.abs(pricing.reputation) })}</span>`);
    }
    const haggle = actor ? activeHaggle(shop, actor.uuid) : null;
    if (haggle && haggle.pct) {
      const hours = Math.max(1, Math.ceil((haggle.until - worldTime()) / 3600));
      tags.push(`<span class="mint-tag ${haggle.pct < 0 ? "good" : "bad"}" data-tooltip="${esc(t("Shop.HaggleLasts", { hours }))}"><i class="fa-solid fa-comments-dollar"></i> ${t(haggle.pct < 0 ? "Shop.HaggleWon" : "Shop.HaggleLost", { pct: Math.abs(haggle.pct) })}</span>`);
    }
    const canHaggle = actor && shop.haggle.enabled && !haggle;
    const haggleBtn = shop.haggle.enabled && actor
      ? `<button type="button" class="mint-haggle" data-action="haggle" ${canHaggle ? "" : "disabled"} data-tooltip="${esc(t(canHaggle ? "Shop.HaggleHint" : "Shop.HaggleDone", { dc: shop.haggle.dc }))}"><i class="fa-solid fa-comments-dollar"></i> ${t("Shop.Haggle")}</button>`
      : "";

    const header = `
      <header class="mint-shop-head">
        ${merchant ? `<img class="mint-merchant" src="${esc(merchant.img)}" alt="" data-tooltip="${esc(merchant.name)}">` : ""}
        <div>
          <h2>${esc(shop.name)}</h2>
          ${merchant ? `<p class="mint-muted">${t("Shop.HeldBy", { name: esc(merchant.name) })}</p>` : ""}
          ${shop.description ? `<p class="mint-muted">${esc(shop.description)}</p>` : ""}
          ${gm && till !== null ? `<p class="mint-muted">${t("Shop.Treasury")} : ${esc(till)}</p>` : ""}
        </div>
        ${
          gm
            ? `<div class="mint-gm-tools">
            <button type="button" class="mint-icon-btn" data-action="toggleOpen" data-tooltip="${esc(t(shop.open ? "Shop.CloseShop" : "Shop.OpenShop"))}"><i class="fa-solid ${shop.open ? "fa-door-open" : "fa-door-closed"}"></i></button>
            <button type="button" class="mint-icon-btn" data-action="restock" data-tooltip="${esc(t("Shop.RestockNow"))}"><i class="fa-solid fa-truck-ramp-box"></i></button>
            <button type="button" class="mint-icon-btn" data-action="editShop" data-tooltip="${esc(t("Shop.Edit"))}"><i class="fa-solid fa-pen"></i></button>
            <button type="button" class="mint-icon-btn" data-action="deleteShop" data-tooltip="${esc(t("Shop.Delete"))}"><i class="fa-solid fa-trash"></i></button>
          </div>`
            : ""
        }
      </header>
      <div class="mint-row mint-actor-pick">
        <label>${t("Common.Actor")}</label>
        <select data-pick="actor">
          ${actor ? "" : `<option value="">—</option>`}
          ${options(actors, this.actorUuid, { value: (a) => a.uuid })}
        </select>
        <span class="mint-purse"><i class="fa-solid fa-coins"></i> ${esc(purse)}</span>
      </div>
      ${tags.length || haggleBtn ? `<div class="mint-row mint-customer">${tags.join("")}<span class="mint-grow"></span>${haggleBtn}</div>` : ""}
      <nav class="mint-tabs">
        <a class="${this.tab === "buy" ? "active" : ""}" data-action="tab" data-tab="buy">${t("Shop.Buy")}</a>
        <a class="${this.tab === "sell" ? "active" : ""}" data-action="tab" data-tab="sell">${t("Shop.Sell")}</a>
      </nav>`;

    return header + (this.tab === "buy" ? this._buyHtml(shop, pricing) : this._sellHtml(shop, actor, pricing));
  }

  _buyHtml(shop, pricing) {
    if (!shop.items.length) return `<p class="mint-empty">${t("Shop.Empty")}</p>`;
    const rows = shop.items
      .map((e) => {
        const out = e.stock !== null && e.stock <= 0;
        const price = unitPrice(e, shop, e.stock, pricing.buy);
        const base = Math.max(1, Math.round(e.price * (1 + shop.markup) * e.modifier * pricing.buy));
        const trend = e.price ? (price > base ? "up" : price < base ? "down" : "") : "";
        return `
        <tr class="${out ? "mint-out" : ""}">
          <td class="mint-item-img"><img src="${esc(e.img)}" alt=""></td>
          <td class="mint-item-name" ${e.description ? `data-tooltip="${esc(e.description)}"` : ""}>${esc(e.name)}${e.uuid ? "" : ` <i class="fa-solid fa-bell-concierge mint-muted" data-tooltip="${esc(t("Shop.Service"))}"></i>`}</td>
          <td class="mint-price ${trend}">${esc(e.price ? format(price, shop.system) : t("Shop.Free"))}${trend ? ` <i class="fa-solid fa-arrow-trend-${trend}"></i>` : ""}</td>
          <td class="mint-stock">${e.stock === null ? "∞" : e.stock}</td>
          <td class="mint-qty"><input type="number" min="1" ${e.stock === null ? "" : `max="${Math.max(1, e.stock)}"`} value="1" data-qty="${esc(e.id)}" ${out ? "disabled" : ""}></td>
          <td><button type="button" data-action="buy" data-entry="${esc(e.id)}" ${out ? "disabled" : ""}>${t("Shop.BuyOne")}</button></td>
        </tr>`;
      })
      .join("");
    return `
      <div class="mint-table-wrap" data-scroll="buy">
        <table class="mint-table">
          <thead><tr><th></th><th>${t("Shop.Item")}</th><th>${t("Shop.Price")}</th><th>${t("Shop.Stock")}</th><th>${t("Shop.Qty")}</th><th></th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  }

  _sellHtml(shop, actor, pricing) {
    if (!actor) return `<p class="mint-empty">${t("Wallet.NoActor")}</p>`;
    const sellable = sellableItems(actor, shop);
    if (!sellable.length) return `<p class="mint-empty">${t("Shop.NothingToSell")}</p>`;
    const rows = sellable
      .map(({ item, entry }) => {
        const has = itemQuantity(item);
        const qtyField = typeof foundry.utils.getProperty(item, "system.quantity") === "number";
        return `
        <tr>
          <td class="mint-item-img"><img src="${esc(item.img)}" alt=""></td>
          <td class="mint-item-name">${esc(item.name)} <span class="mint-muted">×${has}</span></td>
          <td class="mint-price">${esc(format(sellTotal(entry, shop, 1, pricing.sell), shop.system))}</td>
          <td class="mint-qty"><input type="number" min="1" max="${qtyField ? has : 1}" value="1" data-qty="${esc(item.id)}" ${qtyField ? "" : "disabled"}></td>
          <td><button type="button" data-action="sell" data-entry="${esc(entry.id)}" data-item="${esc(item.id)}">${t("Shop.SellOne")}</button></td>
        </tr>`;
      })
      .join("");
    return `
      <p class="hint">${t("Shop.SellHint", { ratio: Math.round(shop.sellRatio * 100) })}</p>
      <div class="mint-table-wrap" data-scroll="sell">
        <table class="mint-table">
          <thead><tr><th></th><th>${t("Shop.Item")}</th><th>${t("Shop.UnitOffer")}</th><th>${t("Shop.Qty")}</th><th></th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  }

  _onRender(context, options) {
    super._onRender?.(context, options);
    this.element.querySelector("[data-pick=actor]")?.addEventListener("change", (ev) => {
      this.actorUuid = ev.currentTarget.value || null;
      this.render();
    });
  }

  _qty(id) {
    const input = this.element.querySelector(`input[data-qty="${CSS.escape(id)}"]`);
    return Math.max(1, Math.floor(Number(input?.value) || 1));
  }

  /* -------------------------------------------- */

  static #onSelectShop(event, target) {
    this.shopId = target.dataset.shop;
    this.render();
  }

  static #onTab(event, target) {
    this.tab = target.dataset.tab;
    this.render();
  }

  static async #onBuy(event, target) {
    const actor = this.actor;
    if (!actor) return ui.notifications.warn(t("Wallet.NoActor"));
    const shop = getShop(this.shopId);
    const entry = shop?.items.find((i) => i.id === target.dataset.entry);
    if (!entry) return;
    const qty = this._qty(entry.id);
    const total = buyTotal(entry, shop, qty, customerPricing(shop, actor.uuid).buy);
    const ok = await confirmDialog(t("Shop.Buy"), t("Shop.ConfirmBuy", { qty, item: entry.name, amount: format(total, shop.system), name: actor.name }));
    if (!ok) return;
    target.disabled = true;
    await this.attempt(() => shopApi.buy(shop.id, entry.id, actor.uuid, qty));
  }

  static async #onSell(event, target) {
    const actor = this.actor;
    if (!actor) return;
    const shop = getShop(this.shopId);
    const entry = shop?.items.find((i) => i.id === target.dataset.entry);
    if (!entry) return;
    const qty = this._qty(target.dataset.item);
    const total = sellTotal(entry, shop, qty, customerPricing(shop, actor.uuid).sell);
    const ok = await confirmDialog(t("Shop.Sell"), t("Shop.ConfirmSell", { qty, item: entry.name, amount: format(total, shop.system) }));
    if (!ok) return;
    target.disabled = true;
    await this.attempt(() => shopApi.sell(shop.id, entry.id, actor.uuid, target.dataset.item, qty));
  }

  static async #onHaggle(event, target) {
    const actor = this.actor;
    if (!actor || !this.shopId) return;
    target.disabled = true;
    const result = await this.attempt(() => shopApi.haggle(this.shopId, actor.uuid));
    if (!result) target.disabled = false;
  }

  static async #onNewShop() {
    const shop = newShop();
    await saveShop(shop);
    this.shopId = shop.id;
    new ShopEditor(shop.id).render({ force: true });
  }

  static #onEditShop() {
    if (this.shopId) new ShopEditor(this.shopId).render({ force: true });
  }

  static async #onToggleOpen() {
    const shop = getShop(this.shopId);
    if (!shop) return;
    shop.open = !shop.open;
    await saveShop(shop);
    ui.notifications.info(t(shop.open ? "Shop.NowOpen" : "Shop.NowClosed", { name: shop.name }));
  }

  static async #onRestock() {
    if (!this.shopId) return;
    await restockShops({ force: this.shopId });
  }

  static async #onDeleteShop() {
    const shop = getShop(this.shopId);
    if (!shop) return;
    if (!(await confirmDialog(t("Shop.Delete"), t("Shop.ConfirmDelete", { name: shop.name })))) return;
    await deleteShop(shop.id);
    this.shopId = null;
  }
}
