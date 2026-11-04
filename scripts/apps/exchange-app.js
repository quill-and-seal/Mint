/**
 * La Bourse : économie du monde en un coup d'œil.
 *
 * Onglets : Marchés (cours par région), Factions (actions, prêts), Portefeuille (joueur),
 * Monnaie et Événements (MJ). Le MJ y fait avancer les jours et déclenche les événements.
 */

import { t, esc } from "../constants.js";
import { format, parse } from "../currencies.js";
import { change, shareTrade, MARKET_DEFAULTS, key } from "../core/market.js";
import {
  getWorld, resetWorld, advanceDays, startEvent, endEvent, templates, marketPrice, toSystem, formatRef,
  regionForScene, moneySupply, worldApi, stockTarget, heldShares, eventActive, routeBlocked
} from "../world.js";
import { ownedActors, defaultActor } from "../wallet.js";
import { visibleDebts, owed } from "../debts.js";
import { MintApp, confirmDialog, options } from "./base.js";
import { sparkline, chart, gauge, delta } from "./charts.js";

const KIND_ICON = { guild: "fa-hammer", company: "fa-ship", bank: "fa-building-columns" };

export class ExchangeApp extends MintApp {
  static watches = ["world", "wallet", "debts", "currencies"];

  constructor(tab = null, options = {}) {
    super(options);
    this.tab = tab ?? "markets";
    this.regionId = null;
    this.goodId = null;
    this.factionId = null;
    this.actorUuid = defaultActor()?.uuid ?? null;
    this.qty = 1;
    this.eventRegion = "";
  }

  static DEFAULT_OPTIONS = {
    id: "mint-exchange",
    classes: ["mint", "mint-exchange"],
    window: { icon: "fa-solid fa-chart-line", resizable: true },
    position: { width: 1120, height: 740 },
    actions: {
      tab: ExchangeApp.#onTab,
      region: ExchangeApp.#onRegion,
      good: ExchangeApp.#onGood,
      faction: ExchangeApp.#onFaction,
      advance: ExchangeApp.#onAdvance,
      setup: ExchangeApp.#onSetup,
      editWorld: ExchangeApp.#onEditWorld,
      buy: ExchangeApp.#onBuy,
      sell: ExchangeApp.#onSell,
      loan: ExchangeApp.#onLoan,
      startEvent: ExchangeApp.#onStartEvent,
      endEvent: ExchangeApp.#onEndEvent
    }
  };

  get title() {
    return t("Exchange.Title");
  }

  get actor() {
    return this.actorUuid ? fromUuidSync(this.actorUuid) : null;
  }

  /* -------------------------------------------- */

  _html() {
    const world = getWorld();
    if (!world) return this._setupHtml();
    const gm = game.user.isGM;

    // Sélections par défaut
    if (!world.regions.some((r) => r.id === this.regionId)) {
      this.regionId = regionForScene(canvas?.scene, world)?.id ?? world.regions[0]?.id ?? null;
    }
    if (!world.goods.some((g) => g.id === this.goodId)) this.goodId = world.goods[0]?.id ?? null;
    if (!world.factions.some((f) => f.id === this.factionId)) this.factionId = world.factions[0]?.id ?? null;
    const tabs = ["markets", "factions", "portfolio", ...(gm ? ["money", "events"] : [])];
    if (!tabs.includes(this.tab)) this.tab = "markets";

    const region = world.regions.find((r) => r.id === this.regionId);
    const body = {
      markets: () => this._marketsHtml(world, region),
      factions: () => this._factionsHtml(world),
      portfolio: () => this._portfolioHtml(world),
      money: () => this._moneyHtml(world),
      events: () => this._eventsHtml(world)
    }[this.tab]();

    const nav = tabs
      .map((id) => {
        const badge = id === "events" && world.events.length ? `<span class="mint-x-badge">${world.events.length}</span>` : "";
        return `<button type="button" class="mint-x-tab ${this.tab === id ? "on" : ""}" data-action="tab" data-tab="${id}" aria-pressed="${this.tab === id}">${t(`Exchange.Tab.${id}`)}${badge}</button>`;
      })
      .join("");

    return `
      <div class="mint-x">
        <header class="mint-x-head">
          <div class="mint-x-brand"><span class="mint-x-logo">MINT</span><span class="mint-x-slash">/</span><span>${t("Exchange.Title")}</span></div>
          <div class="mint-x-clock"><span class="mint-x-live" aria-hidden="true"></span>${t("Exchange.Day", { day: world.day })}${world.auto ? "" : ` <span class="mint-x-muted">· ${t("Exchange.Manual")}</span>`}</div>
          <div class="mint-x-grow"></div>
          ${
            gm
              ? `<div class="mint-x-tools">
                  <button type="button" class="mint-x-btn" data-action="advance" data-days="1"><i class="fa-solid fa-forward-step"></i> ${t("Exchange.Plus1")}</button>
                  <button type="button" class="mint-x-btn" data-action="advance" data-days="7"><i class="fa-solid fa-forward"></i> ${t("Exchange.Plus7")}</button>
                  <button type="button" class="mint-x-btn ghost" data-action="editWorld"><i class="fa-solid fa-sliders"></i> ${t("Exchange.EditWorld")}</button>
                </div>`
              : ""
          }
        </header>
        ${this._tickerHtml(world, region)}
        <nav class="mint-x-tabs" aria-label="${esc(t("Exchange.Title"))}">${nav}</nav>
        <section class="mint-x-body">${body}</section>
      </div>`;
  }

  _setupHtml() {
    if (!game.user.isGM) return `<div class="mint-x mint-x-setup"><p>${t("Exchange.NotReady")}</p></div>`;
    return `
      <div class="mint-x mint-x-setup">
        <h2>${t("Exchange.SetupTitle")}</h2>
        <p>${t("Exchange.SetupText")}</p>
        <div class="mint-x-row">
          <button type="button" class="mint-x-btn" data-action="setup" data-kind="preset"><i class="fa-solid fa-map"></i> ${t("Exchange.SetupPreset")}</button>
          <button type="button" class="mint-x-btn ghost" data-action="setup" data-kind="empty"><i class="fa-solid fa-file"></i> ${t("Exchange.SetupEmpty")}</button>
        </div>
      </div>`;
  }

  /** Bandeau défilant des cours de la région. */
  _tickerHtml(world, region) {
    if (!region || !world.goods.length) return "";
    const items = world.goods
      .map((g) => {
        const hist = world.history.prices?.[key(region.id, g.id)] ?? [];
        const price = marketPrice(region.id, g.id, null, world);
        return `<span class="mint-x-tick"><b>${esc(g.name)}</b> ${esc(format(Math.round(price), region.system))} ${delta(change(hist, 1))}</span>`;
      })
      .join("");
    const factions = world.factions
      .map((f) => {
        const sys = world.regions.find((r) => r.id === f.region)?.system ?? region.system;
        return `<span class="mint-x-tick fac"><b>${esc(f.name)}</b> ${esc(formatRef(f.price, sys))} ${delta(change(world.history.factions?.[f.id], 1))}</span>`;
      })
      .join("");
    // Contenu doublé pour une boucle continue
    return `<div class="mint-x-ticker" aria-label="${esc(t("Exchange.Ticker", { region: region.name }))}"><div class="mint-x-ticker-track">${items}${factions}<span aria-hidden="true">${items}${factions}</span></div></div>`;
  }

  /* -------------------------------------------- */
  /*  Marchés                                     */
  /* -------------------------------------------- */

  _marketsHtml(world, region) {
    const gm = game.user.isGM;
    if (!region) return `<p class="mint-x-empty">${t("Exchange.NoRegions")}</p>`;
    const opts = { ...MARKET_DEFAULTS, ...world.settings };

    const regions = world.regions
      .map((r) => {
        const alerts = (world.alerts ?? []).filter((a) => a.region === r.id).length;
        return `
        <button type="button" class="mint-x-region ${r.id === region.id ? "on" : ""}" data-action="region" data-region="${esc(r.id)}" aria-pressed="${r.id === region.id}">
          <span class="name">${esc(r.name)}</span>
          <span class="mint-x-muted">${t("Exchange.Prosperity")} ${gauge(r.prosperity / 1.5, { warn: 0.6, label: `${Math.round(r.prosperity * 100)} %` })}</span>
          ${alerts ? `<span class="mint-x-alert" title="${esc(t("Exchange.ShortageCount", { n: alerts }))}"><i class="fa-solid fa-triangle-exclamation"></i> ${alerts}</span>` : ""}
        </button>`;
      })
      .join("");

    const rows = world.goods
      .map((g) => {
        const hist = world.history.prices?.[key(region.id, g.id)] ?? [];
        const price = marketPrice(region.id, g.id, null, world);
        const target = stockTarget(region, g.id, opts);
        const stock = region.stock?.[g.id] ?? 0;
        const short = (world.alerts ?? []).some((a) => a.region === region.id && a.good === g.id);
        return `
        <tr class="${g.id === this.goodId ? "on" : ""}">
          <td><button type="button" class="mint-x-link" data-action="good" data-good="${esc(g.id)}">${esc(g.name)}</button>${short ? ` <i class="fa-solid fa-triangle-exclamation mint-x-warn" title="${esc(t("Exchange.Shortage"))}"></i>` : ""}<span class="mint-x-muted unit">${esc(g.unit)}</span></td>
          <td class="num">${esc(format(Math.round(price), region.system))}</td>
          <td class="num">${delta(change(hist, 7))}</td>
          <td>${sparkline(hist.slice(-30))}</td>
          ${gm ? `<td>${gauge(stock / target, { warn: 0.5, label: `${Math.round(stock)} / ${Math.round(target)}` })}</td>` : ""}
        </tr>`;
      })
      .join("");

    return `
      <div class="mint-x-markets">
        <aside class="mint-x-col regions" aria-label="${esc(t("Exchange.Regions"))}">${regions}</aside>
        <div class="mint-x-col main">
          <table class="mint-x-table">
            <thead><tr>
              <th>${t("Exchange.Good")}</th><th class="num">${t("Exchange.Price")}</th><th class="num">${t("Exchange.Week")}</th><th>${t("Exchange.Days30")}</th>
              ${gm ? `<th>${t("Exchange.Stock")}</th>` : ""}
            </tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
        <div class="mint-x-col detail">${this._goodDetail(world, region)}</div>
      </div>`;
  }

  _goodDetail(world, region) {
    const good = world.goods.find((g) => g.id === this.goodId);
    if (!good) return "";
    const hist = world.history.prices?.[key(region.id, good.id)] ?? [];
    const toLocal = (ref) => toSystem(ref, region.system);
    const fmt = (v) => format(Math.round(v), region.system);
    const prices = world.regions.map((r) => ({ r, p: marketPrice(r.id, good.id, region.system, world) }));
    const max = Math.max(...prices.map((x) => x.p), 1);
    const bars = prices
      .map(
        ({ r, p }) => `
        <div class="mint-x-bar ${r.id === region.id ? "on" : ""}">
          <span class="label">${esc(r.name)}</span>
          <span class="track"><span style="width:${((p / max) * 100).toFixed(0)}%"></span></span>
          <span class="num">${esc(fmt(p))}</span>
        </div>`
      )
      .join("");
    const flows = (world.lastTrades ?? [])
      .filter((tr) => tr.good === good.id && (tr.from === region.id || tr.to === region.id))
      .map((tr) => {
        const out = tr.from === region.id;
        const other = world.regions.find((r) => r.id === (out ? tr.to : tr.from))?.name ?? "?";
        return `<li><i class="fa-solid ${out ? "fa-arrow-right-from-bracket" : "fa-arrow-right-to-bracket"}"></i> ${t(out ? "Exchange.Export" : "Exchange.Import", { n: tr.volume, unit: esc(good.unit), other: esc(other) })}</li>`;
      })
      .join("");
    const blocked = (world.routes ?? []).filter((rt) => (rt.a === region.id || rt.b === region.id) && routeBlocked(rt, world.events, world.day + 1));

    const opts = { ...MARKET_DEFAULTS, ...world.settings };
    const gmLine = game.user.isGM
      ? `<dl class="mint-x-kpis">
          <div><dt>${t("Exchange.Stock")}</dt><dd>${fmtN(region.stock?.[good.id])} / ${fmtN(stockTarget(region, good.id, opts))}</dd></div>
          <div><dt>${t("Exchange.Prod")}</dt><dd>${fmtN(region.production?.[good.id])}</dd></div>
          <div><dt>${t("Exchange.Cons")}</dt><dd>${fmtN(region.consumption?.[good.id])}</dd></div>
        </dl>`
      : "";
    return `
      <h3>${esc(good.name)} <span class="mint-x-muted">${t("Exchange.In", { region: esc(region.name) })}</span></h3>
      <div class="mint-x-chartbox">${chart(hist.map(toLocal), { w: 340, h: 150, fmt, label: t("Exchange.ChartLabel", { good: good.name }), days: world.history.days })}</div>
      ${gmLine}
      <h4>${t("Exchange.Compare")}</h4>
      <div class="mint-x-bars">${bars}</div>
      <h4>${t("Exchange.Flows")}</h4>
      ${flows ? `<ul class="mint-x-flows">${flows}</ul>` : `<p class="mint-x-muted">${t("Exchange.NoFlows")}</p>`}
      ${blocked.length ? `<p class="mint-x-warn"><i class="fa-solid fa-road-barrier"></i> ${t("Exchange.RoutesBlocked", { n: blocked.length })}</p>` : ""}`;
  }

  /* -------------------------------------------- */
  /*  Factions                                    */
  /* -------------------------------------------- */

  _factionsHtml(world) {
    if (!world.factions.length) return `<p class="mint-x-empty">${t("Exchange.NoFactions")}</p>`;
    const cards = world.factions
      .map((f) => {
        const sys = this._sys(world, f);
        const hist = world.history.factions?.[f.id] ?? [];
        return `
        <button type="button" class="mint-x-card ${f.id === this.factionId ? "on" : ""}" data-action="faction" data-faction="${esc(f.id)}" aria-pressed="${f.id === this.factionId}">
          <span class="top"><i class="fa-solid ${KIND_ICON[f.kind]}"></i> <span class="name">${esc(f.name)}</span></span>
          <span class="mint-x-muted">${t(`Exchange.Kind.${f.kind}`)} · ${esc(world.regions.find((r) => r.id === f.region)?.name ?? "")}</span>
          <span class="price">${esc(formatRef(f.price, sys))}</span>
          ${delta(change(hist, 7))}
          ${sparkline(hist.slice(-30), { w: 150, h: 30 })}
        </button>`;
      })
      .join("");
    return `<div class="mint-x-factions"><div class="mint-x-cards">${cards}</div><div class="mint-x-col detail wide">${this._factionDetail(world)}</div></div>`;
  }

  _factionDetail(world) {
    const f = world.factions.find((x) => x.id === this.factionId);
    if (!f) return "";
    const gm = game.user.isGM;
    const sys = this._sys(world, f);
    const fmt = (v) => formatRef(v, sys);
    const hist = world.history.factions?.[f.id] ?? [];
    const held = heldShares(f);
    const actor = this.actor;
    const mine = actor ? f.holders[actor.uuid] : null;
    const spread = world.settings?.spread ?? MARKET_DEFAULTS.spread;
    const buy = shareTrade(f, this.qty, spread);
    const sell = shareTrade(f, -this.qty, spread);
    const actors = ownedActors().filter((a) => game.user.isGM ? a.hasPlayerOwner : true);
    if (actor && !actors.includes(actor)) actors.unshift(actor);

    const holders = Object.entries(f.holders)
      .map(([, h]) => `<li><span>${esc(h.name || "?")}</span><span class="num">${h.n}</span></li>`)
      .join("");

    const trade = actors.length
      ? `
      <div class="mint-x-trade">
        <label class="mint-x-field"><span>${t("Common.Actor")}</span><select data-pick="actor">${options(actors, this.actorUuid, { value: (a) => a.uuid })}</select></label>
        <label class="mint-x-field small"><span>${t("Exchange.Qty")}</span><input type="number" min="1" step="1" value="${this.qty}" data-pick="qty"></label>
        <button type="button" class="mint-x-btn up" data-action="buy"><i class="fa-solid fa-arrow-trend-up"></i> ${t("Exchange.Buy")} <span class="num">${esc(fmt(buy.total))}</span></button>
        <button type="button" class="mint-x-btn down" data-action="sell" ${mine?.n ? "" : "disabled"}><i class="fa-solid fa-arrow-trend-down"></i> ${t("Exchange.Sell")} <span class="num">${esc(fmt(sell.total))}</span></button>
      </div>
      <p class="mint-x-muted">${mine?.n ? t("Exchange.YouHold", { n: mine.n, value: esc(fmt(mine.n * f.price)) }) : t("Exchange.YouHoldNone")}</p>`
      : "";

    const loan =
      f.kind === "bank" && actors.length
        ? `
      <div class="mint-x-panel">
        <h4><i class="fa-solid fa-building-columns"></i> ${t("Exchange.LoanTitle")}</h4>
        <p class="mint-x-muted">${t("Exchange.LoanTerms", { rate: f.loanRate, days: f.loanPeriodDays, max: f.loanMax ? esc(fmt(f.loanMax)) : "—" })}</p>
        <div class="mint-x-trade">
          <label class="mint-x-field"><span>${t("Exchange.LoanAmount")}</span><input type="text" data-pick="loanAmount" placeholder="${esc(t("Wallet.AmountPlaceholder"))}"></label>
          <label class="mint-x-field small"><span>${t("Exchange.LoanDue")}</span><input type="number" min="1" step="1" value="${f.loanPeriodDays * 3}" data-pick="loanDue"></label>
          <button type="button" class="mint-x-btn" data-action="loan"><i class="fa-solid fa-file-signature"></i> ${t("Exchange.LoanAsk")}</button>
        </div>
      </div>`
        : "";

    return `
      <div class="mint-x-row baseline">
        <h3><i class="fa-solid ${KIND_ICON[f.kind]}"></i> ${esc(f.name)}</h3>
        <span class="mint-x-grow"></span>
        <span class="mint-x-big">${esc(fmt(f.price))}</span>
        ${delta(change(hist, 30))}
      </div>
      <div class="mint-x-chartbox">${chart(hist.map((v) => toSystem(v, sys)), { w: 560, h: 170, fmt: (v) => format(Math.round(v), sys), label: t("Exchange.ChartFaction", { faction: f.name }), days: world.history.days })}</div>
      <dl class="mint-x-kpis">
        <div><dt>${t("Exchange.Dividend")}</dt><dd>${f.dividend ? `${f.dividend} % / ${world.settings?.dividendDays ?? MARKET_DEFAULTS.dividendDays} j` : "—"}</dd></div>
        <div><dt>${t("Exchange.Float")}</dt><dd>${f.shares - held} / ${f.shares}</dd></div>
        ${gm ? `<div><dt>${t("Exchange.Treasury")}</dt><dd>${esc(fmt(f.treasury))}</dd></div><div><dt>${t("Exchange.Book")}</dt><dd>${esc(fmt(f.treasury / f.shares))}</dd></div>` : ""}
      </dl>
      ${trade}
      ${loan}
      ${gm && holders ? `<h4>${t("Exchange.Holders")}</h4><ul class="mint-x-list">${holders}</ul>` : ""}`;
  }

  /* -------------------------------------------- */
  /*  Portefeuille                                */
  /* -------------------------------------------- */

  _portfolioHtml(world) {
    const mine = new Set(ownedActors().filter((a) => (game.user.isGM ? a.hasPlayerOwner : true)).map((a) => a.uuid));
    const rows = [];
    let total = 0;
    let cost = 0;
    for (const f of world.factions) {
      for (const [uuid, h] of Object.entries(f.holders)) {
        if (!mine.has(uuid)) continue;
        const value = h.n * f.price;
        total += value;
        cost += h.cost;
        const sys = this._sys(world, f);
        const pl = h.cost ? ((value - h.cost) / h.cost) * 100 : 0;
        rows.push(`
          <tr>
            <td>${esc(h.name || fromUuidSync(uuid)?.name || "?")}</td>
            <td><button type="button" class="mint-x-link" data-action="faction" data-faction="${esc(f.id)}" data-goto="factions">${esc(f.name)}</button></td>
            <td class="num">${h.n}</td>
            <td class="num">${esc(formatRef(value, sys))}</td>
            <td class="num">${delta(pl)}</td>
          </tr>`);
      }
    }
    const loans = visibleDebts()
      .filter((d) => d.creditor?.faction && d.status !== "closed" && (game.user.isGM || mine.has(d.debtor.uuid)))
      .map(
        (d) => `
        <tr>
          <td>${esc(d.debtor.name)}</td><td>${esc(d.creditor.name)}</td>
          <td>${t(`Exchange.LoanStatus.${d.status}`)}</td>
          <td class="num">${esc(format(d.principal, d.system))}</td>
          <td class="num">${d.status === "active" ? esc(format(owed(d), d.system)) : "—"}</td>
        </tr>`
      )
      .join("");
    const sys = world.regions[0]?.system;
    return `
      <div class="mint-x-stack">
        <dl class="mint-x-kpis big">
          <div><dt>${t("Exchange.PortfolioValue")}</dt><dd>${esc(formatRef(total, sys))}</dd></div>
          <div><dt>${t("Exchange.PortfolioCost")}</dt><dd>${esc(formatRef(cost, sys))}</dd></div>
          <div><dt>${t("Exchange.PortfolioPL")}</dt><dd>${delta(cost ? ((total - cost) / cost) * 100 : 0)}</dd></div>
        </dl>
        ${
          rows.length
            ? `<table class="mint-x-table"><thead><tr><th>${t("Common.Actor")}</th><th>${t("Exchange.Faction")}</th><th class="num">${t("Exchange.Qty")}</th><th class="num">${t("Exchange.Value")}</th><th class="num">${t("Exchange.PL")}</th></tr></thead><tbody>${rows.join("")}</tbody></table>`
            : `<p class="mint-x-empty">${t("Exchange.NoShares")}</p>`
        }
        <h4>${t("Exchange.Loans")}</h4>
        ${
          loans
            ? `<table class="mint-x-table"><thead><tr><th>${t("Common.Actor")}</th><th>${t("Exchange.Bank")}</th><th>${t("Exchange.Status")}</th><th class="num">${t("Exchange.Principal")}</th><th class="num">${t("Exchange.Owed")}</th></tr></thead><tbody>${loans}</tbody></table>`
            : `<p class="mint-x-muted">${t("Exchange.NoLoans")}</p>`
        }
      </div>`;
  }

  /* -------------------------------------------- */
  /*  Monnaie (MJ)                                */
  /* -------------------------------------------- */

  _moneyHtml(world) {
    const supply = moneySupply(world);
    const sys = world.regions[0]?.system;
    const fmt = (v) => formatRef(v, sys);
    const idx = world.history.index ?? [];
    const last = idx[idx.length - 1] ?? 100;
    const money = world.history.money ?? [];
    const max = Math.max(...supply.perActor.map((a) => a.value), 1);
    const dist = supply.perActor
      .slice(0, 12)
      .map(
        (a) => `
        <div class="mint-x-bar">
          <span class="label">${esc(a.name)}</span>
          <span class="track"><span style="width:${((a.value / max) * 100).toFixed(0)}%"></span></span>
          <span class="num">${esc(fmt(a.value))}</span>
        </div>`
      )
      .join("");
    return `
      <div class="mint-x-stack">
        <dl class="mint-x-kpis big">
          <div><dt>${t("Exchange.MoneyPlayers")}</dt><dd>${esc(fmt(supply.players))}</dd><span>${delta(change(money, 30))}</span></div>
          <div><dt>${t("Exchange.MoneyFactions")}</dt><dd>${esc(fmt(supply.factions))}</dd><span>${delta(change(world.history.treasuries, 30))}</span></div>
          <div><dt>${t("Exchange.PriceIndex")}</dt><dd>${last.toFixed(1).replace(".", ",")}</dd><span>${delta(change(idx, 30))}</span></div>
        </dl>
        <div class="mint-x-grid2">
          <div class="mint-x-panel">
            <h4>${t("Exchange.PriceIndex")} <span class="mint-x-muted">${t("Exchange.IndexHint")}</span></h4>
            ${chart(idx, { w: 500, h: 170, fmt: (v) => v.toFixed(0), label: t("Exchange.PriceIndex"), days: world.history.days })}
          </div>
          <div class="mint-x-panel">
            <h4>${t("Exchange.MoneyPlayers")} <span class="mint-x-muted">${t("Exchange.MoneyHint")}</span></h4>
            ${money.length > 1 ? chart(money, { w: 500, h: 170, fmt: (v) => fmt(v), label: t("Exchange.MoneyPlayers") }) : `<p class="mint-x-muted">${t("Exchange.MoneyLater")}</p>`}
          </div>
        </div>
        <div class="mint-x-panel">
          <h4>${t("Exchange.Distribution")}</h4>
          <div class="mint-x-bars">${dist || `<p class="mint-x-muted">${t("Exchange.NoCharacters")}</p>`}</div>
        </div>
      </div>`;
  }

  /* -------------------------------------------- */
  /*  Événements (MJ)                             */
  /* -------------------------------------------- */

  _eventsHtml(world) {
    const regionName = (id) => (id ? world.regions.find((r) => r.id === id)?.name ?? "?" : t("World.AllRegions"));
    const goodName = (id) => (id ? world.goods.find((g) => g.id === id)?.name ?? "?" : t("World.AllGoods"));
    const active = world.events
      .map((e) => {
        const left = e.days > 0 ? e.start + e.days - world.day - 1 : null;
        const waiting = !eventActive(e, world.day + 1);
        return `
        <li class="mint-x-event">
          <i class="fa-solid ${esc(e.icon ?? "fa-bolt")}"></i>
          <span class="name">${esc(e.name)}</span>
          <span class="mint-x-muted">${esc(regionName(e.region))} · ${esc(goodName(e.good))}</span>
          <span class="mint-x-grow"></span>
          <span class="mint-x-muted">${waiting ? t("Exchange.EventSoon") : left === null ? "∞" : t("Exchange.EventLeft", { n: Math.max(0, left) })}</span>
          <button type="button" class="mint-x-btn ghost small" data-action="endEvent" data-id="${esc(e.id)}">${t("Exchange.EventEnd")}</button>
        </li>`;
      })
      .join("");
    const tpls = templates()
      .map(
        (e) => `
        <button type="button" class="mint-x-card event" data-action="startEvent" data-template="${esc(e.id)}">
          <span class="top"><i class="fa-solid ${esc(e.icon)}"></i> <span class="name">${esc(e.name)}</span></span>
          <span class="mint-x-muted">${esc(eventSummary(e, goodName))}</span>
        </button>`
      )
      .join("");
    const alerts = (world.alerts ?? [])
      .map((a) => {
        const unit = world.goods.find((g) => g.id === a.good)?.unit ?? "";
        return `<li><i class="fa-solid fa-triangle-exclamation mint-x-warn"></i> <span>${t("Exchange.AlertLine", { region: esc(regionName(a.region)), good: esc(goodName(a.good)), n: a.missing, unit: esc(unit) })}</span></li>`;
      })
      .join("");
    return `
      <div class="mint-x-stack">
        <div class="mint-x-panel">
          <h4>${t("Exchange.ActiveEvents")}</h4>
          ${active ? `<ul class="mint-x-events">${active}</ul>` : `<p class="mint-x-muted">${t("Exchange.NoEvents")}</p>`}
        </div>
        <div class="mint-x-panel">
          <div class="mint-x-row">
            <h4 class="mint-x-grow">${t("Exchange.Trigger")}</h4>
            <label class="mint-x-field inline"><span>${t("Exchange.Where")}</span>
              <select data-pick="eventRegion"><option value="">${esc(t("World.AllRegions"))}</option>${options(world.regions, this.eventRegion)}</select>
            </label>
          </div>
          <div class="mint-x-cards events">${tpls}</div>
        </div>
        ${alerts ? `<div class="mint-x-panel"><h4>${t("Exchange.Alerts")}</h4><ul class="mint-x-alerts">${alerts}</ul></div>` : ""}
      </div>`;
  }

  _sys(world, faction) {
    return world.regions.find((r) => r.id === faction.region)?.system ?? world.regions[0]?.system;
  }

  /* -------------------------------------------- */

  _onRender(context, options) {
    super._onRender?.(context, options);
    const el = this.element;
    el.querySelector("[data-pick=actor]")?.addEventListener("change", (ev) => {
      this.actorUuid = ev.currentTarget.value || null;
      this.render();
    });
    el.querySelector("[data-pick=qty]")?.addEventListener("change", (ev) => {
      this.qty = Math.max(1, Math.floor(Number(ev.currentTarget.value) || 1));
      this.render();
    });
    el.querySelector("[data-pick=eventRegion]")?.addEventListener("change", (ev) => {
      this.eventRegion = ev.currentTarget.value;
    });
  }

  static #onTab(event, target) {
    this.tab = target.dataset.tab;
    this.render();
  }

  static #onRegion(event, target) {
    this.regionId = target.dataset.region;
    this.render();
  }

  static #onGood(event, target) {
    this.goodId = target.dataset.good;
    this.render();
  }

  static #onFaction(event, target) {
    this.factionId = target.dataset.faction;
    if (target.dataset.goto) this.tab = target.dataset.goto;
    this.render();
  }

  static async #onAdvance(event, target) {
    target.disabled = true;
    await this.attempt(() => advanceDays(Number(target.dataset.days) || 1));
  }

  static async #onSetup(event, target) {
    await this.attempt(() => resetWorld(target.dataset.kind));
  }

  static #onEditWorld() {
    game.modules.get("mint-economy")?.api?.openWorldEditor();
  }

  static async #onBuy() {
    const actor = this.actor;
    if (!actor || !this.factionId) return ui.notifications.warn(t("Wallet.NoActor"));
    await this.attempt(() => worldApi.buyShares(this.factionId, actor.uuid, this.qty));
  }

  static async #onSell() {
    const actor = this.actor;
    if (!actor || !this.factionId) return;
    await this.attempt(() => worldApi.sellShares(this.factionId, actor.uuid, this.qty));
  }

  static async #onLoan() {
    const actor = this.actor;
    const world = getWorld();
    const f = world?.factions.find((x) => x.id === this.factionId);
    if (!actor || !f) return ui.notifications.warn(t("Wallet.NoActor"));
    const sys = this._sys(world, f);
    const amount = parse(this.element.querySelector("[data-pick=loanAmount]")?.value, sys);
    if (!amount) return ui.notifications.warn(t("Error.BadAmount"));
    const dueDays = Number(this.element.querySelector("[data-pick=loanDue]")?.value) || 0;
    const ok = await confirmDialog(t("Exchange.LoanTitle"), t("Exchange.LoanConfirm", { amount: format(amount, sys), bank: f.name, rate: f.loanRate, days: f.loanPeriodDays }));
    if (!ok) return;
    const result = await this.attempt(() => worldApi.requestLoan(f.id, actor.uuid, amount, { dueDays }));
    if (result) ui.notifications.info(t("Exchange.LoanSent", { bank: f.name }));
  }

  static async #onStartEvent(event, target) {
    await this.attempt(() => startEvent(target.dataset.template, { region: this.eventRegion || null }));
  }

  static async #onEndEvent(event, target) {
    await this.attempt(() => endEvent(target.dataset.id));
  }
}

function fmtN(v) {
  const n = Number(v) || 0;
  return n ? (Math.round(n * 10) / 10).toString().replace(".", ",") : "—";
}

/** Résumé lisible d'un modèle d'événement : « Blé : production ×0,35 ». */
function eventSummary(e, goodName) {
  const parts = [];
  const x = (v) => `×${String(v).replace(".", ",")}`;
  if (e.production && e.production !== 1) parts.push(t("Exchange.FxProduction", { x: x(e.production) }));
  if (e.consumption && e.consumption !== 1) parts.push(t("Exchange.FxConsumption", { x: x(e.consumption) }));
  if (e.price && e.price !== 1) parts.push(t("Exchange.FxPrice", { x: x(e.price) }));
  if (e.block) parts.push(t("Exchange.FxBlock"));
  const what = e.good ? `${goodName(e.good)} : ` : "";
  return `${what}${parts.join(", ")} · ${t("Exchange.FxDays", { n: e.days })}`;
}

