/**
 * Éditeur de boutique (MJ) : réglages, articles, prix et stocks.
 * Glisser un objet (barre latérale ou compendium) dans la fenêtre l'ajoute à la boutique.
 */

import { t, esc } from "../constants.js";
import { getConfig, getSystem, format, parse, getCurrency } from "../currencies.js";
import { getShop, saveShop, newItem } from "../shops.js";
import { MintApp, options } from "./base.js";

export class ShopEditor extends MintApp {
  static watches = ["shops", "currencies"];

  constructor(shopId, options = {}) {
    super({ id: `mint-shop-editor-${shopId}`, ...options });
    this.shopId = shopId;
  }

  static DEFAULT_OPTIONS = {
    tag: "form",
    classes: ["mint", "mint-shop-editor"],
    window: { icon: "fa-solid fa-pen-to-square", resizable: true },
    position: { width: 820, height: 640 },
    form: { handler: ShopEditor.#onSubmit, submitOnChange: true, closeOnSubmit: false },
    actions: {
      addItem: ShopEditor.#onAddItem,
      removeItem: ShopEditor.#onRemoveItem,
      unlinkItem: ShopEditor.#onUnlinkItem,
      pickImage: ShopEditor.#onPickImage
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
    const { systems } = getConfig();
    const pct = (v) => Math.round(v * 1000) / 10;

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
      <section class="mint-editor-settings">
        <div class="form-group"><label>${t("Editor.Name")}</label><input type="text" name="name" value="${esc(shop.name)}"></div>
        <div class="form-group"><label>${t("Editor.Description")}</label><input type="text" name="description" value="${esc(shop.description)}"></div>
        <div class="mint-grid">
          <div class="form-group"><label>${t("Editor.System")}</label><select name="system">${options(systems, shop.system)}</select></div>
          <div class="form-group"><label>${t("Editor.Open")}</label><input type="checkbox" name="open" ${shop.open ? "checked" : ""}></div>
          <div class="form-group"><label data-tooltip="${esc(t("Editor.MarkupHint"))}">${t("Editor.Markup")}</label><input type="number" name="markupPct" step="1" value="${pct(shop.markup)}"></div>
          <div class="form-group"><label data-tooltip="${esc(t("Editor.SellRatioHint"))}">${t("Editor.SellRatio")}</label><input type="number" name="sellRatioPct" min="0" max="100" step="1" value="${pct(shop.sellRatio)}"></div>
          <div class="form-group"><label data-tooltip="${esc(t("Editor.ElasticityHint"))}">${t("Editor.Elasticity")}</label><input type="number" name="elasticity" min="0" step="0.05" value="${shop.elasticity}"></div>
          <div class="form-group"><label data-tooltip="${esc(t("Editor.FactorsHint"))}">${t("Editor.Factors")}</label>
            <div class="form-fields"><input type="number" name="minFactor" min="0" step="0.05" value="${shop.minFactor}"><span>–</span><input type="number" name="maxFactor" min="0" step="0.05" value="${shop.maxFactor}"></div></div>
          <div class="form-group"><label data-tooltip="${esc(t("Editor.RestockHint"))}">${t("Editor.RestockHours")}</label><input type="number" name="restockHours" min="0" step="1" value="${shop.restockHours}"></div>
          <div class="form-group"><label data-tooltip="${esc(t("Editor.TreasuryHint"))}">${t("Editor.Treasury")}</label><input type="text" name="treasury" value="${shop.treasury === null ? "" : esc(format(shop.treasury, shop.system))}" placeholder="∞"></div>
        </div>
      </section>
      <section class="mint-editor-items">
        <div class="mint-row">
          <h3>${t("Editor.Items")}</h3>
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

  _onFirstRender(context, options) {
    super._onFirstRender(context, options);
    // Sur la fenêtre elle-même (qui persiste entre les rendus) : une seule fois
    this.element.addEventListener("dragover", (ev) => ev.preventDefault());
    this.element.addEventListener("drop", (ev) => this.#onDrop(ev));
  }

  /* -------------------------------------------- */

  static async #onSubmit(event, form, formData) {
    const shop = this.shop;
    if (!shop) return;
    const data = foundry.utils.expandObject(formData.object);
    const system = getSystem(data.system)?.id ?? shop.system;
    // Les prix sont lus dans l'ancien système (ils ont été affichés avec), puis gardés en valeur
    const readAmount = (text, fallback) => {
      const v = parse(text, shop.system);
      return v === null ? fallback : v;
    };
    const items = shop.items.map((e, i) => {
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
    const treasuryText = String(data.treasury ?? "").trim();
    await saveShop({
      ...shop,
      name: data.name,
      description: data.description,
      system,
      open: !!data.open,
      markup: (Number(data.markupPct) || 0) / 100,
      sellRatio: (Number(data.sellRatioPct) || 0) / 100,
      elasticity: data.elasticity,
      minFactor: data.minFactor,
      maxFactor: data.maxFactor,
      restockHours: data.restockHours,
      treasury: treasuryText ? readAmount(treasuryText, shop.treasury) : null,
      items
    });
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
    if (data?.type !== "Item" || !data.uuid) return;
    const item = await fromUuid(data.uuid);
    if (!(item instanceof Item)) return;
    const shop = this.shop;
    if (!shop) return;
    shop.items.push(
      newItem({
        name: item.name,
        img: item.img,
        uuid: item.uuid,
        price: guessPrice(item, shop.system) ?? 100
      })
    );
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
