/**
 * Éditeur du monde (MJ) : biens, régions, routes, factions et réglages de la simulation.
 * Chaque champ s'enregistre dès qu'il change ; seuls les champs de l'onglet affiché sont lus.
 */

import { t, esc } from "../constants.js";
import { getConfig, format, parse, defaultSystemId } from "../currencies.js";
import { MARKET_DEFAULTS, stockTarget } from "../core/market.js";
import { getWorld, saveWorld, resetWorld, toSystem, toRef } from "../world.js";
import { MintApp, confirmDialog, options } from "./base.js";

const TABS = ["goods", "regions", "routes", "factions", "settings"];
const CATEGORIES = ["food", "raw", "goods", "luxury"];
const KINDS = ["guild", "company", "bank"];

export class WorldEditor extends MintApp {
  static watches = ["world", "currencies"];

  constructor(options = {}) {
    super(options);
    this.tab = "goods";
    this.regionId = null;
    this.factionId = null;
  }

  static DEFAULT_OPTIONS = {
    id: "mint-world-editor",
    tag: "form",
    classes: ["mint", "mint-exchange", "mint-world-editor"],
    window: { icon: "fa-solid fa-sliders", resizable: true },
    position: { width: 920, height: 680 },
    form: { handler: WorldEditor.#onSubmit, submitOnChange: true, closeOnSubmit: false },
    actions: {
      tab: WorldEditor.#onTab,
      add: WorldEditor.#onAdd,
      remove: WorldEditor.#onRemove,
      pickRegion: WorldEditor.#onPickRegion,
      pickFaction: WorldEditor.#onPickFaction,
      linkScene: WorldEditor.#onLinkScene,
      unlinkScene: WorldEditor.#onUnlinkScene,
      fillStock: WorldEditor.#onFillStock,
      reset: WorldEditor.#onReset
    }
  };

  get title() {
    return t("World.Title");
  }

  /** Monnaie dans laquelle on saisit les prix de base (le système par défaut). */
  get sys() {
    return defaultSystemId();
  }

  _money(ref, sys = this.sys) {
    return format(Math.round(toSystem(ref, sys)), sys);
  }

  _readMoney(text, fallback, sys = this.sys) {
    const v = parse(text, sys);
    return v === null ? fallback : toRef(v, sys);
  }

  _html() {
    const world = getWorld();
    if (!world) return `<div class="mint-x mint-x-setup"><p>${t("World.NotReady")}</p></div>`;
    const nav = TABS.map((id) => `<button type="button" class="mint-x-tab ${this.tab === id ? "on" : ""}" data-action="tab" data-tab="${id}">${t(`World.Tab.${id}`)}</button>`).join("");
    const body = {
      goods: () => this._goodsHtml(world),
      regions: () => this._regionsHtml(world),
      routes: () => this._routesHtml(world),
      factions: () => this._factionsHtml(world),
      settings: () => this._settingsHtml(world)
    }[this.tab]();
    return `<div class="mint-x"><nav class="mint-x-tabs">${nav}</nav><section class="mint-x-body scroll">${body}</section></div>`;
  }

  _goodsHtml(world) {
    const rows = world.goods
      .map(
        (g, i) => `
        <tr>
          <td><input type="text" name="goods.${i}.name" value="${esc(g.name)}"></td>
          <td><input type="text" name="goods.${i}.unit" value="${esc(g.unit)}" class="short"></td>
          <td><select name="goods.${i}.category">${CATEGORIES.map((c) => `<option value="${c}" ${c === g.category ? "selected" : ""}>${esc(t(`World.Category.${c}`))}</option>`).join("")}</select></td>
          <td><input type="text" name="goods.${i}.price" value="${esc(this._money(g.price))}"></td>
          <td><input type="number" name="goods.${i}.spoil" min="0" max="100" step="0.1" value="${Math.round(g.spoil * 1000) / 10}" class="short"></td>
          <td><button type="button" class="mint-x-btn ghost small" data-action="remove" data-list="goods" data-index="${i}" aria-label="${esc(t("World.Remove"))}"><i class="fa-solid fa-trash"></i></button></td>
        </tr>`
      )
      .join("");
    return `
      <p class="mint-x-muted">${t("World.GoodsHint")}</p>
      <table class="mint-x-table edit">
        <thead><tr><th>${t("World.Name")}</th><th>${t("World.Unit")}</th><th>${t("World.Category.label")}</th><th>${t("World.BasePrice")}</th><th title="${esc(t("World.SpoilHint"))}">${t("World.Spoil")}</th><th></th></tr></thead>
        <tbody>${rows || `<tr><td colspan="6" class="mint-x-empty">${t("World.NoGoods")}</td></tr>`}</tbody>
      </table>
      <button type="button" class="mint-x-btn" data-action="add" data-list="goods"><i class="fa-solid fa-plus"></i> ${t("World.AddGood")}</button>`;
  }

  _regionsHtml(world) {
    if (!world.regions.some((r) => r.id === this.regionId)) this.regionId = world.regions[0]?.id ?? null;
    const idx = world.regions.findIndex((r) => r.id === this.regionId);
    const region = world.regions[idx];
    const { systems } = getConfig();
    const list = world.regions
      .map((r) => `<button type="button" class="mint-x-region ${r.id === this.regionId ? "on" : ""}" data-action="pickRegion" data-region="${esc(r.id)}"><span class="name">${esc(r.name)}</span></button>`)
      .join("");
    let form = `<p class="mint-x-empty">${t("World.NoRegions")}</p>`;
    if (region) {
      const opts = { ...MARKET_DEFAULTS, ...world.settings };
      const scenes = region.scenes.map((id) => game.scenes.get(id)).filter(Boolean);
      const rows = world.goods
        .map(
          (g) => `
          <tr>
            <td>${esc(g.name)}</td>
            <td><input type="number" min="0" step="0.5" name="region.production.${esc(g.id)}" value="${region.production[g.id] ?? ""}" placeholder="0"></td>
            <td><input type="number" min="0" step="0.5" name="region.consumption.${esc(g.id)}" value="${region.consumption[g.id] ?? ""}" placeholder="0"></td>
            <td><input type="number" min="0" step="1" name="region.stock.${esc(g.id)}" value="${Math.round(region.stock[g.id] ?? 0)}"></td>
            <td class="mint-x-muted num">${Math.round(stockTarget(region, g.id, opts))}</td>
            <td><input type="number" min="0.1" step="0.05" name="region.modifiers.${esc(g.id)}" value="${region.modifiers[g.id] ?? 1}" class="short"></td>
          </tr>`
        )
        .join("");
      form = `
        <div class="mint-x-grid2">
          <label class="mint-x-field"><span>${t("World.Name")}</span><input type="text" name="region.name" value="${esc(region.name)}"></label>
          <label class="mint-x-field"><span>${t("World.Currency")}</span><select name="region.system">${options(systems, region.system)}</select></label>
          <label class="mint-x-field"><span title="${esc(t("World.TaxHint"))}">${t("World.Tax")}</span><input type="number" min="0" max="100" step="0.5" name="region.taxPct" value="${Math.round(region.tax * 1000) / 10}"></label>
          <label class="mint-x-field"><span title="${esc(t("World.ProsperityHint"))}">${t("World.Prosperity")}</span><input type="number" min="0.3" max="2" step="0.05" name="region.prosperity" value="${region.prosperity}"></label>
        </div>
        <div class="mint-x-row">
          <span class="mint-x-muted">${t("World.Scenes")} :</span>
          ${scenes.map((s) => `<span class="mint-x-chip">${esc(s.name)} <button type="button" data-action="unlinkScene" data-scene="${esc(s.id)}" aria-label="${esc(t("World.Remove"))}">×</button></span>`).join("") || `<span class="mint-x-muted">—</span>`}
          <button type="button" class="mint-x-btn ghost small" data-action="linkScene" ${canvas?.scene ? "" : "disabled"}><i class="fa-solid fa-link"></i> ${t("World.LinkScene")}</button>
        </div>
        <table class="mint-x-table edit">
          <thead><tr><th>${t("Exchange.Good")}</th><th>${t("World.Production")}</th><th>${t("World.Consumption")}</th><th>${t("Exchange.Stock")}</th><th title="${esc(t("World.TargetHint"))}">${t("World.Target")}</th><th title="${esc(t("World.ModifierHint"))}">×</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
        <div class="mint-x-row">
          <button type="button" class="mint-x-btn ghost small" data-action="fillStock"><i class="fa-solid fa-boxes-stacked"></i> ${t("World.FillStock")}</button>
          <span class="mint-x-grow"></span>
          <button type="button" class="mint-x-btn ghost small down" data-action="remove" data-list="regions" data-index="${idx}"><i class="fa-solid fa-trash"></i> ${t("World.RemoveRegion")}</button>
        </div>`;
    }
    return `
      <div class="mint-x-markets editor">
        <aside class="mint-x-col regions">${list}<button type="button" class="mint-x-btn ghost small" data-action="add" data-list="regions"><i class="fa-solid fa-plus"></i> ${t("World.AddRegion")}</button></aside>
        <div class="mint-x-col main">${form}</div>
      </div>`;
  }

  _routesHtml(world) {
    const rows = world.routes
      .map(
        (r, i) => `
        <tr>
          <td><select name="routes.${i}.a">${options(world.regions, r.a)}</select></td>
          <td><select name="routes.${i}.b">${options(world.regions, r.b)}</select></td>
          <td><input type="number" min="1" step="1" name="routes.${i}.days" value="${r.days}" class="short"></td>
          <td><input type="number" min="0" step="0.5" name="routes.${i}.costPct" value="${Math.round(r.cost * 1000) / 10}" class="short"></td>
          <td><input type="number" min="0" step="5" name="routes.${i}.capacity" value="${r.capacity}" class="short"></td>
          <td><input type="number" min="0" max="100" step="1" name="routes.${i}.riskPct" value="${Math.round(r.risk * 100)}" class="short"></td>
          <td class="center"><input type="checkbox" name="routes.${i}.open" ${r.open ? "checked" : ""}></td>
          <td><button type="button" class="mint-x-btn ghost small" data-action="remove" data-list="routes" data-index="${i}" aria-label="${esc(t("World.Remove"))}"><i class="fa-solid fa-trash"></i></button></td>
        </tr>`
      )
      .join("");
    return `
      <p class="mint-x-muted">${t("World.RoutesHint")}</p>
      <table class="mint-x-table edit">
        <thead><tr><th>${t("World.From")}</th><th>${t("World.To")}</th><th>${t("World.Days")}</th><th title="${esc(t("World.CostHint"))}">${t("World.Cost")}</th><th title="${esc(t("World.CapacityHint"))}">${t("World.Capacity")}</th><th title="${esc(t("World.RiskHint"))}">${t("World.Risk")}</th><th>${t("World.Open")}</th><th></th></tr></thead>
        <tbody>${rows || `<tr><td colspan="8" class="mint-x-empty">${t("World.NoRoutes")}</td></tr>`}</tbody>
      </table>
      <button type="button" class="mint-x-btn" data-action="add" data-list="routes" ${world.regions.length > 1 ? "" : "disabled"}><i class="fa-solid fa-plus"></i> ${t("World.AddRoute")}</button>`;
  }

  _factionsHtml(world) {
    if (!world.factions.some((f) => f.id === this.factionId)) this.factionId = world.factions[0]?.id ?? null;
    const idx = world.factions.findIndex((f) => f.id === this.factionId);
    const f = world.factions[idx];
    const list = world.factions
      .map((x) => `<button type="button" class="mint-x-region ${x.id === this.factionId ? "on" : ""}" data-action="pickFaction" data-faction="${esc(x.id)}"><span class="name">${esc(x.name)}</span><span class="mint-x-muted">${t(`Exchange.Kind.${x.kind}`)}</span></button>`)
      .join("");
    let form = `<p class="mint-x-empty">${t("Exchange.NoFactions")}</p>`;
    if (f) {
      const sys = world.regions.find((r) => r.id === f.region)?.system ?? this.sys;
      const goods = world.goods
        .map((g) => `<label class="mint-x-chip check"><input type="checkbox" name="faction.goods.${esc(g.id)}" ${f.goods.includes(g.id) ? "checked" : ""}> ${esc(g.name)}</label>`)
        .join("");
      const holders = Object.entries(f.holders).map(([, h]) => `<li><span>${esc(h.name || "?")}</span><span class="num">${h.n}</span></li>`).join("");
      form = `
        <div class="mint-x-grid2">
          <label class="mint-x-field"><span>${t("World.Name")}</span><input type="text" name="faction.name" value="${esc(f.name)}"></label>
          <label class="mint-x-field"><span>${t("World.Kind")}</span><select name="faction.kind">${KINDS.map((k) => `<option value="${k}" ${k === f.kind ? "selected" : ""}>${esc(t(`Exchange.Kind.${k}`))}</option>`).join("")}</select></label>
          <label class="mint-x-field"><span>${t("World.Region")}</span><select name="faction.region">${options(world.regions, f.region)}</select></label>
          <label class="mint-x-field"><span title="${esc(t("World.TreasuryHint"))}">${t("Exchange.Treasury")}</span><input type="text" name="faction.treasury" value="${esc(this._money(f.treasury, sys))}"></label>
          <label class="mint-x-field"><span>${t("World.Shares")}</span><input type="number" min="1" step="1" name="faction.shares" value="${f.shares}"></label>
          <label class="mint-x-field"><span title="${esc(t("World.PriceHint"))}">${t("World.SharePrice")}</span><input type="text" name="faction.price" value="${esc(this._money(f.price, sys))}"></label>
          <label class="mint-x-field"><span title="${esc(t("World.DividendHint"))}">${t("Exchange.Dividend")} (%)</span><input type="number" min="0" max="100" step="0.5" name="faction.dividend" value="${f.dividend}"></label>
          <label class="mint-x-field"><span title="${esc(t("World.UpkeepHint"))}">${t("World.Upkeep")}</span><input type="text" name="faction.upkeep" value="${esc(this._money(f.upkeep, sys))}"></label>
        </div>
        ${
          f.kind === "bank"
            ? `<div class="mint-x-grid2">
                <label class="mint-x-field"><span>${t("World.LoanRate")}</span><input type="number" min="0" step="0.5" name="faction.loanRate" value="${f.loanRate}"></label>
                <label class="mint-x-field"><span>${t("World.LoanPeriod")}</span><input type="number" min="1" step="1" name="faction.loanPeriodDays" value="${f.loanPeriodDays}"></label>
                <label class="mint-x-field"><span title="${esc(t("World.LoanMaxHint"))}">${t("World.LoanMax")}</span><input type="text" name="faction.loanMax" value="${f.loanMax ? esc(this._money(f.loanMax, sys)) : ""}" placeholder="∞"></label>
              </div>`
            : `<h4>${t("World.FactionGoods")}</h4><p class="mint-x-muted">${t("World.FactionGoodsHint")}</p><div class="mint-x-row wrap">${goods}</div>`
        }
        ${holders ? `<h4>${t("Exchange.Holders")}</h4><ul class="mint-x-list">${holders}</ul>` : ""}
        <div class="mint-x-row"><span class="mint-x-grow"></span><button type="button" class="mint-x-btn ghost small down" data-action="remove" data-list="factions" data-index="${idx}"><i class="fa-solid fa-trash"></i> ${t("World.RemoveFaction")}</button></div>`;
    }
    return `
      <div class="mint-x-markets editor">
        <aside class="mint-x-col regions">${list}<button type="button" class="mint-x-btn ghost small" data-action="add" data-list="factions" ${world.regions.length ? "" : "disabled"}><i class="fa-solid fa-plus"></i> ${t("World.AddFaction")}</button></aside>
        <div class="mint-x-col main">${form}</div>
      </div>`;
  }

  _settingsHtml(world) {
    const s = { ...MARKET_DEFAULTS, ...world.settings };
    const field = (name, step, hint, extra = "") =>
      `<label class="mint-x-field"><span title="${esc(t(`World.Set.${hint}`))}">${t(`World.Set.${name}`)}</span><input type="number" step="${step}" name="settings.${name}" value="${s[name]}" ${extra}></label>`;
    return `
      <label class="mint-x-field inline"><input type="checkbox" name="auto" ${world.auto ? "checked" : ""}> <span>${t("World.Auto")}</span></label>
      <p class="mint-x-muted">${t("World.AutoHint")}</p>
      <div class="mint-x-grid2">
        ${field("elasticity", 0.05, "elasticityHint", 'min="0"')}
        ${field("coverDays", 1, "coverDaysHint", 'min="1"')}
        ${field("minFactor", 0.05, "minFactorHint", 'min="0.01"')}
        ${field("maxFactor", 0.5, "maxFactorHint", 'min="1"')}
        ${field("tradeIntensity", 0.1, "tradeIntensityHint", 'min="0"')}
        ${field("volatility", 0.005, "volatilityHint", 'min="0" max="0.5"')}
        ${field("spread", 0.005, "spreadHint", 'min="0" max="0.5"')}
        ${field("dividendDays", 1, "dividendDaysHint", 'min="1"')}
        ${field("historySize", 10, "historySizeHint", 'min="10" max="365"')}
      </div>
      <div class="mint-x-panel danger">
        <h4>${t("World.ResetTitle")}</h4>
        <p class="mint-x-muted">${t("World.ResetHint")}</p>
        <div class="mint-x-row">
          <button type="button" class="mint-x-btn ghost" data-action="reset" data-kind="preset"><i class="fa-solid fa-map"></i> ${t("Exchange.SetupPreset")}</button>
          <button type="button" class="mint-x-btn ghost down" data-action="reset" data-kind="empty"><i class="fa-solid fa-file"></i> ${t("Exchange.SetupEmpty")}</button>
        </div>
      </div>`;
  }

  /* -------------------------------------------- */

  static async #onSubmit(event, form, formData) {
    const world = getWorld();
    if (!world) return;
    const data = foundry.utils.expandObject(formData.object);
    const n = (v, d) => (v === "" || v === null || v === undefined || !Number.isFinite(Number(v)) ? d : Number(v));

    if (this.tab === "goods") {
      world.goods.forEach((g, i) => {
        const row = data.goods?.[i];
        if (!row) return;
        g.name = row.name ?? g.name;
        g.unit = row.unit ?? g.unit;
        g.category = row.category ?? g.category;
        g.price = Math.max(0.01, this._readMoney(row.price, g.price));
        g.spoil = Math.min(Math.max(n(row.spoil, g.spoil * 100) / 100, 0), 1);
      });
    } else if (this.tab === "regions") {
      const region = world.regions.find((r) => r.id === this.regionId);
      const row = data.region;
      if (region && row) {
        region.name = row.name ?? region.name;
        region.system = row.system ?? region.system;
        region.tax = Math.min(Math.max(n(row.taxPct, region.tax * 100) / 100, 0), 1);
        region.prosperity = n(row.prosperity, region.prosperity);
        for (const k of ["production", "consumption", "stock"]) {
          for (const [g, v] of Object.entries(row[k] ?? {})) {
            if (v === "" || v === null) delete region[k][g];
            else region[k][g] = Math.max(0, n(v, 0));
          }
        }
        for (const [g, v] of Object.entries(row.modifiers ?? {})) region.modifiers[g] = n(v, 1);
      }
    } else if (this.tab === "routes") {
      world.routes.forEach((r, i) => {
        const row = data.routes?.[i];
        if (!row) return;
        r.a = row.a ?? r.a;
        r.b = row.b ?? r.b;
        r.days = n(row.days, r.days);
        r.cost = n(row.costPct, r.cost * 100) / 100;
        r.capacity = n(row.capacity, r.capacity);
        r.risk = n(row.riskPct, r.risk * 100) / 100;
        r.open = !!row.open;
      });
    } else if (this.tab === "factions") {
      const f = world.factions.find((x) => x.id === this.factionId);
      const row = data.faction;
      if (f && row) {
        const sys = world.regions.find((r) => r.id === (row.region ?? f.region))?.system ?? this.sys;
        f.name = row.name ?? f.name;
        f.kind = row.kind ?? f.kind;
        f.region = row.region ?? f.region;
        f.treasury = this._readMoney(row.treasury, f.treasury, sys);
        f.shares = Math.max(1, Math.floor(n(row.shares, f.shares)));
        f.price = Math.max(0.01, this._readMoney(row.price, f.price, sys));
        f.dividend = n(row.dividend, f.dividend);
        f.upkeep = Math.max(0, this._readMoney(row.upkeep, f.upkeep, sys));
        if (f.kind === "bank") {
          f.loanRate = n(row.loanRate, f.loanRate);
          f.loanPeriodDays = n(row.loanPeriodDays, f.loanPeriodDays);
          f.loanMax = String(row.loanMax ?? "").trim() ? this._readMoney(row.loanMax, f.loanMax, sys) : 0;
        }
        if (row.goods) f.goods = Object.entries(row.goods).filter(([, v]) => v).map(([g]) => g);
      }
    } else if (this.tab === "settings") {
      world.auto = !!data.auto;
      for (const [k, v] of Object.entries(data.settings ?? {})) {
        const value = n(v, null);
        if (value !== null) world.settings[k] = value;
      }
    }
    await saveWorld(world);
  }

  static #onTab(event, target) {
    this.tab = target.dataset.tab;
    this.render();
  }

  static async #onAdd(event, target) {
    const world = getWorld();
    if (!world) return;
    const id = foundry.utils.randomID(8);
    const list = target.dataset.list;
    if (list === "goods") world.goods.push({ id, name: t("World.NewGood"), unit: "", category: "goods", price: 100, spoil: 0.01 });
    if (list === "regions") {
      world.regions.push({ id, name: t("World.NewRegion"), system: defaultSystemId(), prosperity: 1, tax: 0, production: {}, consumption: {}, stock: {} });
      this.regionId = id;
    }
    if (list === "routes" && world.regions.length > 1) world.routes.push({ id, a: world.regions[0].id, b: world.regions[1].id, days: 3, cost: 0.02, capacity: 30, risk: 0.02, open: true });
    if (list === "factions" && world.regions.length) {
      world.factions.push({ id, name: t("World.NewFaction"), kind: "guild", region: this.regionId ?? world.regions[0].id, goods: [], treasury: 100000, shares: 1000, price: 100, dividend: 2, holders: {} });
      this.factionId = id;
    }
    await saveWorld(world);
  }

  static async #onRemove(event, target) {
    const world = getWorld();
    const list = target.dataset.list;
    const i = Number(target.dataset.index);
    const item = world?.[list]?.[i];
    if (!item) return;
    if (list !== "routes" && !(await confirmDialog(t("World.Remove"), t("World.ConfirmRemove", { name: item.name ?? "" })))) return;
    world[list].splice(i, 1);
    if (list === "goods") {
      for (const r of world.regions) for (const k of ["production", "consumption", "stock", "modifiers"]) delete r[k]?.[item.id];
      for (const f of world.factions) f.goods = f.goods.filter((g) => g !== item.id);
    }
    if (list === "regions") world.routes = world.routes.filter((r) => r.a !== item.id && r.b !== item.id);
    await saveWorld(world);
  }

  static #onPickRegion(event, target) {
    this.regionId = target.dataset.region;
    this.render();
  }

  static #onPickFaction(event, target) {
    this.factionId = target.dataset.faction;
    this.render();
  }

  static async #onLinkScene() {
    const world = getWorld();
    const scene = canvas?.scene;
    if (!world || !scene) return;
    for (const r of world.regions) r.scenes = r.scenes.filter((id) => id !== scene.id);
    world.regions.find((r) => r.id === this.regionId)?.scenes.push(scene.id);
    await saveWorld(world);
  }

  static async #onUnlinkScene(event, target) {
    const world = getWorld();
    const region = world?.regions.find((r) => r.id === this.regionId);
    if (!region) return;
    region.scenes = region.scenes.filter((id) => id !== target.dataset.scene);
    await saveWorld(world);
  }

  /** Remet les stocks de la région à leur niveau normal. */
  static async #onFillStock() {
    const world = getWorld();
    const region = world?.regions.find((r) => r.id === this.regionId);
    if (!region) return;
    const opts = { ...MARKET_DEFAULTS, ...world.settings };
    for (const g of world.goods) region.stock[g.id] = Math.round(stockTarget(region, g.id, opts));
    await saveWorld(world);
  }

  static async #onReset(event, target) {
    if (!(await confirmDialog(t("World.ResetTitle"), t("World.ResetConfirm")))) return;
    await resetWorld(target.dataset.kind);
  }
}
