/**
 * Éditeur de boutique (MJ), en trois onglets :
 * - Boutique  : nom, monnaie, marchand, caisse, prix (offre et demande), réassort
 * - Articles  : prix, stocks, rachat ; glisser un objet dans la fenêtre l'ajoute
 * - Clientèle : marchandage et réputation de chaque personnage auprès de la boutique
 * Glisser un acteur (ou un token) dans la fenêtre en fait le marchand.
 */

import { t, esc } from "../constants.js";
import { getConfig, getSystem, format, parse, getCurrency } from "../currencies.js";
import { getShop, saveShop, newItem, merchantActor, haggleFormula } from "../shops.js";
import { MintApp, options } from "./base.js";

const TABS = ["shop", "items", "customers"];

export class ShopEditor extends MintApp {
  static watches = ["shops", "currencies"];

  constructor(shopId, options = {}) {
    super({ id: `mint-shop-editor-${shopId}`, ...options });
    this.shopId = shopId;
    this.tab = "shop";
  }

  static DEFAULT_OPTIONS = {
    tag: "form",
    classes: ["mint", "mint-shop-editor"],
    window: { icon: "fa-solid fa-pen-to-square", resizable: true },
    position: { width: 820, height: 640 },
    form: { handler: ShopEditor.#onSubmit, submitOnChange: true, closeOnSubmit: false },
    actions: {
      tab: ShopEditor.#onTab,
      addItem: ShopEditor.#onAddItem,
      removeItem: ShopEditor.#onRemoveItem,
      unlinkItem: ShopEditor.#onUnlinkItem,
      pickImage: ShopEditor.#onPickImage,
      unlinkMerchant: ShopEditor.#onUnlinkMerchant,
      clearHaggles: ShopEditor.#onClearHaggles
    }
  };

  get title() {
    return t("Editor.Title", { name: getShop(this.shopId)?.name ?? "" });
  }

  get shop() {
    return getShop(this.shopId);
  }

  _html() {
    const shop = this.shop;
    if (!shop) return `<p class="mint-empty">${t("Editor.Missing")}</p>`;
    const nav = TABS.map(
      (id) => `<a class="${this.tab === id ? "active" : ""}" data-action="tab" data-tab="${id}">${t(`Editor.Tab.${id}`)}</a>`
    ).join("");
    const body = this.tab === "items" ? this._itemsHtml(shop) : this.tab === "customers" ? this._customersHtml(shop) : this._shopHtml(shop);
    return `<nav class="mint-tabs">${nav}</nav>${body}`;
  }

  _shopHtml(shop) {
    const { systems } = getConfig();
    const pct = (v) => Math.round(v * 1000) / 10;
    const merchant = merchantActor(shop);
    const npcs = game.actors.filter((a) => !a.hasPlayerOwner).sort((a, b) => a.name.localeCompare(b.name));
    if (merchant && !npcs.includes(merchant)) npcs.unshift(merchant);
    const tills = ["unlimited", "fixed", "merchant"].map((id) => ({ id, name: t(`Editor.Till.${id}`) }));

    return `
      <section class="mint-editor-settings mint-scroll" data-scroll="shop">
        <div class="form-group"><label>${t("Editor.Name")}</label><input type="text" name="name" value="${esc(shop.name)}"></div>
        <div class="form-group"><label>${t("Editor.Description")}</label><input type="text" name="description" value="${esc(shop.description)}"></div>
        <div class="mint-grid">
          <div class="form-group"><label>${t("Editor.System")}</label><select name="system">${options(systems, shop.system)}</select></div>
          <div class="form-group"><label>${t("Editor.Open")}</label><input type="checkbox" name="open" ${shop.open ? "checked" : ""}></div>
        </div>

        <h3>${t("Editor.Merchant")}</h3>
        <div class="mint-row mint-merchant-pick">
          ${merchant ? `<img class="mint-merchant" src="${esc(merchant.img)}" alt="">` : `<i class="fa-solid fa-user-tie mint-muted mint-merchant-empty"></i>`}
          <select name="merchant" class="mint-grow">
            <option value="">${esc(t("Editor.NoMerchant"))}</option>
            ${options(npcs, shop.merchant, { value: (a) => a.uuid })}
          </select>
          ${merchant ? `<button type="button" class="mint-icon-btn" data-action="unlinkMerchant" data-tooltip="${esc(t("Editor.UnlinkMerchant"))}"><i class="fa-solid fa-link-slash"></i></button>` : ""}
        </div>
        <p class="hint">${t("Editor.MerchantHint")}</p>
        <div class="mint-grid">
          <div class="form-group"><label data-tooltip="${esc(t("Editor.TillHint"))}">${t("Editor.TillMode")}</label><select name="till">${options(tills, shop.till)}</select></div>
          ${
            shop.till === "fixed"
              ? `<div class="form-group"><label data-tooltip="${esc(t("Editor.TreasuryHint"))}">${t("Editor.Treasury")}</label><input type="text" name="treasury" value="${esc(format(shop.treasury, shop.system))}"></div>`
              : ""
          }
        </div>
        ${shop.till === "merchant" && !merchant ? `<p class="mint-warn"><i class="fa-solid fa-triangle-exclamation"></i> ${t("Editor.TillNoMerchant")}</p>` : ""}

        <h3>${t("Editor.Prices")}</h3>
        <div class="mint-grid">
          <div class="form-group"><label data-tooltip="${esc(t("Editor.MarkupHint"))}">${t("Editor.Markup")}</label><input type="number" name="markupPct" step="1" value="${pct(shop.markup)}"></div>
          <div class="form-group"><label data-tooltip="${esc(t("Editor.SellRatioHint"))}">${t("Editor.SellRatio")}</label><input type="number" name="sellRatioPct" min="0" max="100" step="1" value="${pct(shop.sellRatio)}"></div>
          <div class="form-group"><label data-tooltip="${esc(t("Editor.ElasticityHint"))}">${t("Editor.Elasticity")}</label><input type="number" name="elasticity" min="0" step="0.05" value="${shop.elasticity}"></div>
          <div class="form-group"><label data-tooltip="${esc(t("Editor.FactorsHint"))}">${t("Editor.Factors")}</label>
            <div class="form-fields"><input type="number" name="minFactor" min="0" step="0.05" value="${shop.minFactor}"><span>–</span><input type="number" name="maxFactor" min="0" step="0.05" value="${shop.maxFactor}"></div></div>
          <div class="form-group"><label data-tooltip="${esc(t("Editor.RestockHint"))}">${t("Editor.RestockHours")}</label><input type="number" name="restockHours" min="0" step="1" value="${shop.restockHours}"></div>
        </div>
      </section>`;
  }

  _itemsHtml(shop) {
    const items = shop.items
      .map(
        (e, i) => `
        <tr>
          <td class="mint-item-img"><img src="${esc(e.img)}" alt="" data-action="pickImage" data-index="${i}" data-tooltip="${esc(t("Editor.ChangeImage"))}"></td>
          <td>
            <input type="text" name="items.${i}.name" value="${esc(e.name)}">
            ${
              e.uuid
                ? `<a class="mint-link" data-action="unlinkItem" data-index="${i}" data-tooltip="${esc(t("Editor.Linked"))}"><i class="fa-solid fa-link"></i></a>`
                : `<i class="fa-solid fa-bell-concierge mint-muted" data-tooltip="${esc(t("Editor.NotLinked"))}"></i>`
            }
          </td>
          <td><input type="text" name="items.${i}.price" value="${esc(format(e.price, shop.system))}"></td>
          <td><input type="number" name="items.${i}.stock" min="0" step="1" value="${e.stock ?? ""}" placeholder="∞"></td>
          <td><input type="number" name="items.${i}.target" min="0" step="1" value="${e.target ?? ""}" ${e.stock === null ? "disabled" : ""}></td>
          <td><input type="number" name="items.${i}.restock" min="0" step="1" value="${e.restock}"></td>
          <td><input type="number" name="items.${i}.modifier" min="0" step="0.05" value="${e.modifier}"></td>
          <td class="mint-center"><input type="checkbox" name="items.${i}.buyback" ${e.buyback ? "checked" : ""}></td>
          <td><button type="button" class="mint-icon-btn" data-action="removeItem" data-index="${i}" data-tooltip="${esc(t("Editor.RemoveItem"))}"><i class="fa-solid fa-trash"></i></button></td>
        </tr>`
      )
      .join("");

    return `
      <section class="mint-editor-items">
        <div class="mint-row">
          <span class="mint-muted mint-grow">${t("Editor.DropHint")}</span>
          <button type="button" data-action="addItem"><i class="fa-solid fa-plus"></i> ${t("Editor.AddItem")}</button>
        </div>
        <div class="mint-table-wrap" data-scroll="items">
          <table class="mint-table mint-edit-table">
            <thead><tr>
              <th></th><th>${t("Shop.Item")}</th><th>${t("Editor.BasePrice")}</th><th>${t("Shop.Stock")}</th>
              <th data-tooltip="${esc(t("Editor.TargetHint"))}">${t("Editor.Target")}</th>
              <th data-tooltip="${esc(t("Editor.RestockAmountHint"))}">${t("Editor.RestockAmount")}</th>
              <th data-tooltip="${esc(t("Editor.ModifierHint"))}">${t("Editor.Modifier")}</th>
              <th data-tooltip="${esc(t("Editor.BuybackHint"))}">${t("Editor.Buyback")}</th><th></th>
            </tr></thead>
            <tbody>${items || `<tr><td colspan="9" class="mint-empty">${t("Shop.Empty")}</td></tr>`}</tbody>
          </table>
        </div>
      </section>`;
  }

  _customersHtml(shop) {
    const h = shop.haggle;
    const characters = game.actors.filter((a) => a.hasPlayerOwner).sort((a, b) => a.name.localeCompare(b.name));
    const rows = characters
      .map((a) => {
        const rep = shop.customers[a.uuid] ?? 0;
        const haggle = shop.haggles[a.uuid];
        const active = haggle && haggle.until > (game.time?.worldTime ?? 0) && haggle.pct;
        return `
        <tr>
          <td class="mint-item-img"><img src="${esc(a.img)}" alt=""></td>
          <td class="mint-item-name">${esc(a.name)}</td>
          <td><input type="number" name="customers.${esc(a.id)}" step="1" min="-90" max="200" value="${rep}"> %</td>
          <td class="mint-muted">${active ? esc(t(haggle.pct < 0 ? "Shop.HaggleWon" : "Shop.HaggleLost", { pct: Math.abs(haggle.pct) })) : "—"}</td>
        </tr>`;
      })
      .join("");

    return `
      <section class="mint-scroll" data-scroll="customers">
        <h3>${t("Editor.Haggle")}</h3>
        <div class="mint-grid">
          <div class="form-group"><label>${t("Editor.HaggleEnabled")}</label><input type="checkbox" name="haggle.enabled" ${h.enabled ? "checked" : ""}></div>
          <div class="form-group"><label data-tooltip="${esc(t("Editor.HaggleDCHint"))}">${t("Editor.HaggleDC")}</label><input type="number" name="haggle.dc" min="0" step="1" value="${h.dc}"></div>
          <div class="form-group"><label data-tooltip="${esc(t("Editor.HaggleMaxHint"))}">${t("Editor.HaggleMax")}</label><input type="number" name="haggle.maxDiscount" min="0" max="90" step="1" value="${h.maxDiscount}"></div>
          <div class="form-group"><label data-tooltip="${esc(t("Editor.HagglePenaltyHint"))}">${t("Editor.HagglePenalty")}</label><input type="number" name="haggle.penalty" min="0" max="200" step="1" value="${h.penalty}"></div>
          <div class="form-group"><label data-tooltip="${esc(t("Editor.HaggleHoursHint"))}">${t("Editor.HaggleHours")}</label><input type="number" name="haggle.hours" min="1" step="1" value="${h.hours}"></div>
        </div>
        <p class="hint">${t("Editor.HaggleFormula", { formula: esc(haggleFormula()) })}</p>
        ${Object.keys(shop.haggles).length ? `<button type="button" data-action="clearHaggles"><i class="fa-solid fa-eraser"></i> ${t("Editor.ClearHaggles")}</button>` : ""}

        <h3>${t("Editor.Reputation")}</h3>
        <p class="hint">${t("Editor.ReputationHint")}</p>
        <table class="mint-table mint-edit-table">
          <thead><tr><th></th><th>${t("Common.Actor")}</th><th>${t("Editor.PriceAdjust")}</th><th>${t("Editor.HaggleCurrent")}</th></tr></thead>
          <tbody>${rows || `<tr><td colspan="4" class="mint-empty">${t("Editor.NoCharacters")}</td></tr>`}</tbody>
        </table>
      </section>`;
  }

  _onFirstRender(context, options) {
    super._onFirstRender(context, options);
    // Sur la fenêtre elle-même (qui persiste entre les rendus) : une seule fois
    this.element.addEventListener("dragover", (ev) => ev.preventDefault());
    this.element.addEventListener("drop", (ev) => this.#onDrop(ev));
  }

  /* -------------------------------------------- */

  /** Seuls les champs de l'onglet affiché sont envoyés : les autres gardent leur valeur. */
  static async #onSubmit(event, form, formData) {
    const shop = this.shop;
    if (!shop) return;
    const data = foundry.utils.expandObject(formData.object);
    const has = (k) => Object.prototype.hasOwnProperty.call(data, k);
    // Les montants sont lus dans le système affiché, puis gardés en valeur
    const readAmount = (text, fallback) => {
      const v = parse(text, shop.system);
      return v === null ? fallback : v;
    };
    const next = { ...shop };

    if (this.tab === "shop") {
      if (has("name")) next.name = data.name;
      if (has("description")) next.description = data.description;
      if (has("system")) next.system = getSystem(data.system)?.id ?? shop.system;
      next.open = !!data.open;
      if (has("merchant")) next.merchant = data.merchant || "";
      if (has("till")) next.till = data.till;
      if (has("treasury")) next.treasury = readAmount(data.treasury, shop.treasury ?? 0);
      else if (next.till === "fixed" && shop.till !== "fixed") next.treasury = 0;
      if (has("markupPct")) next.markup = (Number(data.markupPct) || 0) / 100;
      if (has("sellRatioPct")) next.sellRatio = (Number(data.sellRatioPct) || 0) / 100;
      for (const k of ["elasticity", "minFactor", "maxFactor", "restockHours"]) if (has(k)) next[k] = data[k];
    } else if (this.tab === "items") {
      next.items = shop.items.map((e, i) => {
        const row = data.items?.[i] ?? {};
        const stock = row.stock === null || row.stock === undefined || row.stock === "" ? null : Number(row.stock);
        return {
          ...e,
          name: row.name ?? e.name,
          price: readAmount(row.price, e.price),
          stock,
          target: stock === null ? null : row.target === null || row.target === undefined || row.target === "" ? (e.target ?? stock) : Number(row.target),
          restock: Number(row.restock ?? e.restock) || 0,
          modifier: Number(row.modifier ?? e.modifier),
          buyback: !!row.buyback
        };
      });
    } else if (this.tab === "customers") {
      next.haggle = { ...shop.haggle, ...(data.haggle ?? {}), enabled: !!data.haggle?.enabled };
      const customers = {};
      for (const [id, pct] of Object.entries(data.customers ?? {})) {
        const actor = game.actors.get(id);
        if (actor && Number(pct)) customers[actor.uuid] = Number(pct);
      }
      next.customers = customers;
    }
    await saveShop(next);
  }

  static #onTab(event, target) {
    this.tab = target.dataset.tab;
    this.render();
  }

  static async #onAddItem() {
    const shop = this.shop;
    if (!shop) return;
    shop.items.push(newItem({ uuid: "" }));
    await saveShop(shop);
  }

  static async #onRemoveItem(event, target) {
    const shop = this.shop;
    if (!shop) return;
    shop.items.splice(Number(target.dataset.index), 1);
    await saveShop(shop);
  }

  static async #onUnlinkItem(event, target) {
    const shop = this.shop;
    const item = shop?.items[Number(target.dataset.index)];
    if (!item) return;
    item.uuid = "";
    await saveShop(shop);
  }

  static async #onUnlinkMerchant() {
    const shop = this.shop;
    if (!shop) return;
    shop.merchant = "";
    if (shop.till === "merchant") shop.till = "unlimited";
    await saveShop(shop);
  }

  static async #onClearHaggles() {
    const shop = this.shop;
    if (!shop) return;
    shop.haggles = {};
    await saveShop(shop);
  }

  static async #onPickImage(event, target) {
    const shop = this.shop;
    const item = shop?.items[Number(target.dataset.index)];
    if (!item) return;
    const FP = foundry.applications.apps.FilePicker.implementation;
    new FP({
      type: "image",
      current: item.img,
      callback: async (path) => {
        item.img = path;
        await saveShop(shop);
      }
    }).render(true);
  }

  async #onDrop(event) {
    event.preventDefault();
    const TE = foundry.applications.ux.TextEditor.implementation;
    const data = TE.getDragEventData(event);
    if (!data?.uuid) return;
    const shop = this.shop;
    if (!shop) return;
    const doc = await fromUuid(data.uuid);

    // Un acteur ou un token : il devient le marchand
    const actor = doc instanceof Actor ? doc : doc?.actor instanceof Actor ? doc.actor : null;
    if (actor) {
      shop.merchant = actor.isToken ? (game.actors.get(actor.id)?.uuid ?? actor.uuid) : actor.uuid;
      this.tab = "shop";
      await saveShop(shop);
      return ui.notifications.info(t("Editor.MerchantSet", { name: actor.name, shop: shop.name }));
    }

    if (!(doc instanceof Item)) return;
    shop.items.push(
      newItem({
        name: doc.name,
        img: doc.img,
        uuid: doc.uuid,
        price: guessPrice(doc, shop.system) ?? 100
      })
    );
    this.tab = "items";
    await saveShop(shop);
  }
}

/**
 * Devine le prix d'un objet du système de jeu (ex. dnd5e : system.price = { value, denomination }),
 * converti en unités de base du système de la boutique. null si rien n'est reconnu.
 */
function guessPrice(item, systemId) {
  const price = foundry.utils.getProperty(item, "system.price");
  const value = typeof price === "number" ? price : Number(price?.value);
  if (!Number.isFinite(value) || value <= 0) return null;
  const sys = getSystem(systemId);
  const denomination = price?.denomination;
  const currency =
    (denomination && getConfig().currencies.find((c) => c.system === sys.id && (c.sheetKey === denomination || c.id === denomination))) ||
    getCurrency(sys.primary);
  return currency ? Math.round(value * currency.value) : null;
}
