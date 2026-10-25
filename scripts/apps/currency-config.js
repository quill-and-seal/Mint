/**
 * Configuration des monnaies (MJ) : systèmes monétaires, devises, taux de change et frais.
 */

import { MODULE_ID, SETTINGS, t, esc } from "../constants.js";
import { getConfig, saveConfig, presets, coinDot } from "../currencies.js";
import { MintApp, confirmDialog, options } from "./base.js";

export class CurrencyConfig extends MintApp {
  static watches = ["currencies"];

  static DEFAULT_OPTIONS = {
    id: "mint-currency-config",
    tag: "form",
    classes: ["mint", "mint-currency-config"],
    window: { icon: "fa-solid fa-coins", resizable: true },
    position: { width: 760, height: 620 },
    form: { handler: CurrencyConfig.#onSubmit, submitOnChange: true, closeOnSubmit: false },
    actions: {
      addSystem: CurrencyConfig.#onAddSystem,
      removeSystem: CurrencyConfig.#onRemoveSystem,
      addCurrency: CurrencyConfig.#onAddCurrency,
      removeCurrency: CurrencyConfig.#onRemoveCurrency,
      preset: CurrencyConfig.#onPreset
    }
  };

  get title() {
    return t("Currencies.Title");
  }

  _html() {
    const cfg = getConfig();
    const sheetPath = game.settings.get(MODULE_ID, SETTINGS.sheetPath);

    const systems = cfg.systems
      .map((s, i) => {
        const own = cfg.currencies.filter((c) => c.system === s.id).sort((a, b) => b.value - a.value);
        const smallest = own[own.length - 1];
        const warn = smallest && smallest.value !== 1 ? `<p class="mint-warn"><i class="fa-solid fa-triangle-exclamation"></i> ${t("Currencies.SmallestWarn")}</p>` : "";
        const rows = own
          .map((c) => {
            const idx = cfg.currencies.indexOf(c);
            return `
            <tr>
              <td>${coinDot(c)}</td>
              <td><input type="text" name="currencies.${idx}.name" value="${esc(c.name)}"></td>
              <td><input type="text" name="currencies.${idx}.abbr" value="${esc(c.abbr)}" class="mint-short"></td>
              <td><input type="number" name="currencies.${idx}.value" min="1" step="1" value="${c.value}"></td>
              <td><input type="color" name="currencies.${idx}.color" value="${esc(/^#[0-9a-f]{6}$/i.test(c.color ?? "") ? c.color : "#999999")}"></td>
              <td><input type="text" name="currencies.${idx}.sheetKey" value="${esc(c.sheetKey ?? "")}" class="mint-short" placeholder="—"></td>
              <td><button type="button" class="mint-icon-btn" data-action="removeCurrency" data-index="${idx}" data-tooltip="${esc(t("Currencies.RemoveCurrency"))}"><i class="fa-solid fa-trash"></i></button></td>
            </tr>`;
          })
          .join("");
        return `
        <fieldset class="mint-system-config">
          <legend>${esc(s.name)}</legend>
          <div class="mint-grid">
            <div class="form-group"><label>${t("Currencies.SystemName")}</label><input type="text" name="systems.${i}.name" value="${esc(s.name)}"></div>
            <div class="form-group"><label data-tooltip="${esc(t("Currencies.RateHint"))}">${t("Currencies.Rate")}</label><input type="number" name="systems.${i}.rate" min="0" step="any" value="${s.rate}"></div>
            <div class="form-group"><label data-tooltip="${esc(t("Currencies.PrimaryHint"))}">${t("Currencies.Primary")}</label><select name="systems.${i}.primary">${options(own, s.primary)}</select></div>
          </div>
          <table class="mint-table mint-edit-table">
            <thead><tr><th></th><th>${t("Currencies.Name")}</th><th>${t("Currencies.Abbr")}</th>
              <th data-tooltip="${esc(t("Currencies.ValueHint"))}">${t("Currencies.Value")}</th><th>${t("Currencies.Color")}</th>
              <th data-tooltip="${esc(t("Currencies.SheetKeyHint"))}">${t("Currencies.SheetKey")}</th><th></th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
          ${warn}
          <div class="mint-row">
            <button type="button" data-action="addCurrency" data-system="${esc(s.id)}"><i class="fa-solid fa-plus"></i> ${t("Currencies.AddCurrency")}</button>
            ${cfg.systems.length > 1 ? `<button type="button" data-action="removeSystem" data-index="${i}"><i class="fa-solid fa-trash"></i> ${t("Currencies.RemoveSystem")}</button>` : ""}
          </div>
        </fieldset>`;
      })
      .join("");

    return `
      <section class="mint-grid">
        <div class="form-group"><label data-tooltip="${esc(t("Currencies.FeeHint"))}">${t("Currencies.Fee")}</label>
          <div class="form-fields"><input type="number" name="feePct" min="0" max="100" step="0.5" value="${Math.round(cfg.fee * 1000) / 10}"><span>%</span></div></div>
        <div class="form-group"><label data-tooltip="${esc(t("Currencies.SheetPathHint"))}">${t("Currencies.SheetPath")}</label>
          <input type="text" name="sheetPath" value="${esc(sheetPath)}" placeholder="auto"></div>
      </section>
      <div class="mint-scroll" data-scroll="systems">${systems}</div>
      <footer class="mint-actions">
        <button type="button" data-action="addSystem"><i class="fa-solid fa-plus"></i> ${t("Currencies.AddSystem")}</button>
        <button type="button" data-action="preset" data-preset="fantasy"><i class="fa-solid fa-dragon"></i> ${t("Currencies.PresetFantasy")}</button>
        <button type="button" data-action="preset" data-preset="simple"><i class="fa-solid fa-circle"></i> ${t("Currencies.PresetSimple")}</button>
      </footer>`;
  }

  /* -------------------------------------------- */

  static async #onSubmit(event, form, formData) {
    const data = foundry.utils.expandObject(formData.object);
    const cfg = foundry.utils.deepClone(getConfig());
    cfg.fee = Math.min(Math.max((Number(data.feePct) || 0) / 100, 0), 1);
    cfg.systems.forEach((s, i) => {
      const row = data.systems?.[i];
      if (!row) return;
      s.name = String(row.name ?? s.name).trim() || s.name;
      s.rate = Number(row.rate) > 0 ? Number(row.rate) : s.rate;
      if (row.primary) s.primary = row.primary;
    });
    cfg.currencies.forEach((c, i) => {
      const row = data.currencies?.[i];
      if (!row) return;
      c.name = String(row.name ?? c.name).trim() || c.name;
      c.abbr = String(row.abbr ?? c.abbr).trim() || c.abbr;
      c.value = Math.max(1, Math.floor(Number(row.value) || c.value));
      c.color = row.color || c.color;
      c.sheetKey = String(row.sheetKey ?? "").trim();
    });
    const path = String(data.sheetPath ?? "").trim() || "auto";
    if (path !== game.settings.get(MODULE_ID, SETTINGS.sheetPath)) await game.settings.set(MODULE_ID, SETTINGS.sheetPath, path);
    await saveConfig(cfg);
  }

  static async #onAddSystem() {
    const cfg = foundry.utils.deepClone(getConfig());
    const sysId = foundry.utils.randomID();
    const coinId = foundry.utils.randomID();
    cfg.systems.push({ id: sysId, name: t("Currencies.NewSystem"), rate: 1, primary: coinId });
    cfg.currencies.push({ id: coinId, system: sysId, name: t("Currencies.NewCurrency"), abbr: "?", value: 1, color: "#999999", sheetKey: "" });
    await saveConfig(cfg);
  }

  static async #onRemoveSystem(event, target) {
    const cfg = foundry.utils.deepClone(getConfig());
    const sys = cfg.systems[Number(target.dataset.index)];
    if (!sys || cfg.systems.length <= 1) return;
    if (!(await confirmDialog(t("Currencies.RemoveSystem"), t("Currencies.ConfirmRemoveSystem", { name: sys.name })))) return;
    cfg.systems = cfg.systems.filter((s) => s.id !== sys.id);
    cfg.currencies = cfg.currencies.filter((c) => c.system !== sys.id);
    await saveConfig(cfg);
  }

  static async #onAddCurrency(event, target) {
    const cfg = foundry.utils.deepClone(getConfig());
    cfg.currencies.push({
      id: foundry.utils.randomID(),
      system: target.dataset.system,
      name: t("Currencies.NewCurrency"),
      abbr: "?",
      value: 1,
      color: "#999999",
      sheetKey: ""
    });
    await saveConfig(cfg);
  }

  static async #onRemoveCurrency(event, target) {
    const cfg = foundry.utils.deepClone(getConfig());
    const c = cfg.currencies[Number(target.dataset.index)];
    if (!c) return;
    if (cfg.currencies.filter((x) => x.system === c.system).length <= 1) return ui.notifications.warn(t("Currencies.LastCurrency"));
    cfg.currencies = cfg.currencies.filter((x) => x !== c);
    const sys = cfg.systems.find((s) => s.id === c.system);
    if (sys?.primary === c.id) sys.primary = cfg.currencies.find((x) => x.system === sys.id)?.id;
    await saveConfig(cfg);
  }

  static async #onPreset(event, target) {
    if (!(await confirmDialog(t("Currencies.Preset"), t("Currencies.ConfirmPreset")))) return;
    await saveConfig(presets()[target.dataset.preset]());
  }
}
