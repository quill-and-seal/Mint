/**
 * Bourse d'un acteur : pièces par système, don à un autre acteur, change, regroupement.
 * Le MJ peut modifier les quantités directement.
 */

import { t, esc } from "../constants.js";
import { getConfig, denoms, format, parse, coinDot } from "../currencies.js";
import { walletValue, count } from "../core/money.js";
import { getWallet, walletApi, ownedActors, defaultActor, giftTargets } from "../wallet.js";
import { historyFor } from "../history.js";
import { MintApp, formDialog, options, openApps } from "./base.js";
import { HistoryApp } from "./history-app.js";

export class WalletApp extends MintApp {
  static watches = ["wallet", "currencies", "history"];

  constructor(actor = null, options = {}) {
    super(options);
    this.actorUuid = (actor ?? defaultActor())?.uuid ?? null;
  }

  static DEFAULT_OPTIONS = {
    id: "mint-wallet",
    classes: ["mint", "mint-wallet"],
    window: { icon: "fa-solid fa-coins", resizable: true },
    position: { width: 400, height: "auto" },
    actions: {
      give: WalletApp.#onGive,
      exchange: WalletApp.#onExchange,
      consolidate: WalletApp.#onConsolidate,
      history: WalletApp.#onHistory
    }
  };

  get title() {
    return t("Wallet.Title");
  }

  get actor() {
    return this.actorUuid ? fromUuidSync(this.actorUuid) : null;
  }

  /** Change l'acteur affiché. */
  showActor(actor) {
    this.actorUuid = actor?.uuid ?? null;
    this.render({ force: true });
  }

  _html() {
    const actor = this.actor;
    const actors = ownedActors();
    if (actor && !actors.includes(actor)) actors.unshift(actor);
    const picker = `
      <div class="mint-row mint-actor-pick">
        <label>${t("Common.Actor")}</label>
        <select data-pick="actor">
          ${actor ? "" : `<option value="">—</option>`}
          ${options(actors, this.actorUuid, { value: (a) => a.uuid })}
        </select>
      </div>`;
    if (!actor) return `${picker}<p class="mint-empty">${t("Wallet.NoActor")}</p>`;

    const { systems } = getConfig();
    const wallet = getWallet(actor);
    const gm = game.user.isGM;

    const blocks = systems
      .map((sys) => {
        const d = denoms(sys.id);
        if (!d.length) return "";
        const rows = d
          .map(
            (c) => `
          <li class="mint-coin-row">
            ${coinDot(c)}
            <span class="mint-coin-name">${esc(c.name)}</span>
            ${
              gm
                ? `<input type="number" min="0" step="1" data-coin="${esc(c.id)}" value="${count(wallet[c.id])}">`
                : `<span class="mint-coin-count">${count(wallet[c.id])}</span>`
            }
            <span class="mint-coin-abbr">${esc(c.abbr)}</span>
          </li>`
          )
          .join("");
        return `
        <section class="mint-system">
          ${systems.length > 1 ? `<h3>${esc(sys.name)}</h3>` : ""}
          <ul class="mint-coins">${rows}</ul>
          <div class="mint-total">
            <span>${t("Wallet.Total")}</span>
            <strong>${esc(format(walletValue(wallet, d), sys.id))}</strong>
            <button type="button" class="mint-icon-btn" data-action="consolidate" data-system="${esc(sys.id)}" data-tooltip="${esc(t("Wallet.ConsolidateHint"))}">
              <i class="fa-solid fa-layer-group"></i>
            </button>
          </div>
        </section>`;
      })
      .join("");

    const recent = historyFor(actor).slice(0, 4);
    const recentHtml = recent.length
      ? `<ul class="mint-recent">${recent
          .map((e) => `<li><i class="fa-solid ${esc(e.icon || "fa-coins")}"></i> <span>${esc(e.text)}</span></li>`)
          .join("")}</ul>`
      : "";

    return `
      ${picker}
      ${blocks}
      ${recentHtml}
      <footer class="mint-actions">
        <button type="button" data-action="give"><i class="fa-solid fa-hand-holding-dollar"></i> ${t("Wallet.Give")}</button>
        ${systems.length > 1 ? `<button type="button" data-action="exchange"><i class="fa-solid fa-scale-balanced"></i> ${t("Wallet.Exchange")}</button>` : ""}
        <button type="button" data-action="history"><i class="fa-solid fa-clock-rotate-left"></i> ${t("History.Title")}</button>
      </footer>`;
  }

  _onRender(context, options) {
    super._onRender?.(context, options);
    const html = this.element;
    html.querySelector("[data-pick=actor]")?.addEventListener("change", (ev) => {
      this.actorUuid = ev.currentTarget.value || null;
      this.render();
    });
    for (const input of html.querySelectorAll("input[data-coin]")) {
      input.addEventListener("change", (ev) => {
        const actor = this.actor;
        if (!actor) return;
        this.attempt(() => walletApi.set(actor.uuid, { [ev.currentTarget.dataset.coin]: count(ev.currentTarget.value) }));
      });
    }
  }

  /* -------------------------------------------- */

  static async #onGive() {
    const actor = this.actor;
    if (!actor) return;
    const targets = giftTargets(actor.uuid);
    if (!targets.length) return ui.notifications.warn(t("Wallet.NoTargets"));
    const wallet = getWallet(actor);
    const { systems } = getConfig();
    const coinInputs = systems
      .flatMap((s) => denoms(s.id))
      .map(
        (c) => `
        <div class="form-group">
          <label>${coinDot(c)} ${esc(c.name)} <small>(${count(wallet[c.id])})</small></label>
          <input type="number" name="coins.${esc(c.id)}" min="0" max="${count(wallet[c.id])}" step="1" value="0">
        </div>`
      )
      .join("");
    const data = await formDialog({
      title: t("Wallet.GiveTitle", { name: actor.name }),
      ok: t("Wallet.Give"),
      icon: "fa-solid fa-hand-holding-dollar",
      content: `
        <div class="form-group">
          <label>${t("Wallet.Recipient")}</label>
          <select name="to">${options(targets, null, { value: (a) => a.uuid })}</select>
        </div>
        ${coinInputs}`
    });
    if (!data) return;
    const coins = foundry.utils.expandObject(data).coins ?? {};
    await this.attempt(() => walletApi.give(actor.uuid, data.to, coins));
  }

  static async #onExchange() {
    const actor = this.actor;
    if (!actor) return;
    const { systems, fee } = getConfig();
    const data = await formDialog({
      title: t("Wallet.ExchangeTitle"),
      ok: t("Wallet.Exchange"),
      icon: "fa-solid fa-scale-balanced",
      content: `
        <p class="hint">${t("Wallet.ExchangeHint", { fee: Math.round(fee * 1000) / 10 })}</p>
        <div class="form-group">
          <label>${t("Wallet.From")}</label>
          <select name="from">${options(systems, systems[0].id)}</select>
        </div>
        <div class="form-group">
          <label>${t("Wallet.To")}</label>
          <select name="to">${options(systems, systems[1]?.id)}</select>
        </div>
        <div class="form-group">
          <label>${t("Wallet.Amount")}</label>
          <input type="text" name="amount" placeholder="${esc(t("Wallet.AmountPlaceholder"))}">
        </div>
        <p class="hint">${t("Wallet.ExchangeAll")}</p>`
    });
    if (!data) return;
    let amount = null;
    if (String(data.amount ?? "").trim()) {
      amount = parse(data.amount, data.from);
      if (amount === null || !(amount > 0)) return ui.notifications.warn(t("Error.BadAmount"));
    }
    await this.attempt(() => walletApi.exchange(actor.uuid, data.from, data.to, amount));
  }

  static #onHistory() {
    const open = [...openApps].find((a) => a instanceof HistoryApp);
    if (open) {
      open.filter = this.actorUuid ?? "";
      open.render({ force: true });
    } else new HistoryApp(this.actor).render({ force: true });
  }

  static async #onConsolidate(event, target) {
    const actor = this.actor;
    if (!actor) return;
    await this.attempt(() => walletApi.consolidate(actor.uuid, target.dataset.system));
  }
}
