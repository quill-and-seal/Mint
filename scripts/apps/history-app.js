/**
 * Historique des transactions : celui d'un personnage, ou tout l'historique pour le MJ.
 * Export CSV ; le MJ peut aussi vider l'historique.
 */

import { t, esc } from "../constants.js";
import { format } from "../currencies.js";
import { getHistory, exportCsv, clearHistory } from "../history.js";
import { ownedActors, defaultActor } from "../wallet.js";
import { MintApp, confirmDialog, options } from "./base.js";

const PAGE = 100;

export class HistoryApp extends MintApp {
  static watches = ["history"];

  constructor(actor = null, options = {}) {
    super(options);
    // Le MJ voit tout par défaut ; un joueur voit son personnage
    this.filter = actor?.uuid ?? (game.user.isGM ? "" : defaultActor()?.uuid ?? "");
    this.limit = PAGE;
  }

  static DEFAULT_OPTIONS = {
    id: "mint-history",
    classes: ["mint", "mint-history"],
    window: { icon: "fa-solid fa-clock-rotate-left", resizable: true },
    position: { width: 600, height: 560 },
    actions: {
      more: HistoryApp.#onMore,
      exportCsv: HistoryApp.#onExport,
      clear: HistoryApp.#onClear
    }
  };

  get title() {
    return t("History.Title");
  }

  /** Entrées visibles avec le filtre actuel. */
  _entries() {
    const all = getHistory();
    if (this.filter) return all.filter((e) => e.actors?.includes(this.filter));
    if (game.user.isGM) return all;
    const mine = new Set(ownedActors().map((a) => a.uuid));
    return all.filter((e) => e.actors?.some((u) => mine.has(u)));
  }

  _html() {
    const gm = game.user.isGM;
    const actors = ownedActors().filter((a) => gm ? a.hasPlayerOwner || a.uuid === this.filter : true);
    const entries = this._entries();
    const shown = entries.slice(0, this.limit);
    const dateFmt = new Intl.DateTimeFormat(game.i18n.lang, { dateStyle: "short", timeStyle: "short" });

    const rows = shown
      .map(
        (e) => `
        <li class="mint-history-row mint-history-${esc(e.type)}">
          <i class="fa-solid ${esc(e.icon || "fa-coins")}"></i>
          <span class="mint-history-text">${esc(e.text)}</span>
          ${e.amount !== null && e.amount !== undefined && e.system ? `<span class="mint-history-amount">${esc(format(e.amount, e.system))}</span>` : ""}
          <time class="mint-muted">${esc(dateFmt.format(new Date(e.ts)))}</time>
        </li>`
      )
      .join("");

    return `
      <div class="mint-row">
        <label>${t("Common.Actor")}</label>
        <select data-pick="filter" class="mint-grow">
          ${gm ? `<option value="" ${this.filter ? "" : "selected"}>${esc(t("History.All"))}</option>` : `<option value="" ${this.filter ? "" : "selected"}>${esc(t("History.AllMine"))}</option>`}
          ${options(actors, this.filter, { value: (a) => a.uuid })}
        </select>
        <button type="button" class="mint-icon-btn" data-action="exportCsv" data-tooltip="${esc(t("History.Export"))}"><i class="fa-solid fa-file-csv"></i></button>
        ${gm ? `<button type="button" class="mint-icon-btn" data-action="clear" data-tooltip="${esc(t("History.Clear"))}"><i class="fa-solid fa-trash"></i></button>` : ""}
      </div>
      <ul class="mint-history" data-scroll="history">
        ${rows || `<li class="mint-empty">${t("History.Empty")}</li>`}
      </ul>
      ${entries.length > shown.length ? `<button type="button" data-action="more">${t("History.More", { n: entries.length - shown.length })}</button>` : ""}`;
  }

  _onRender(context, options) {
    super._onRender?.(context, options);
    this.element.querySelector("[data-pick=filter]")?.addEventListener("change", (ev) => {
      this.filter = ev.currentTarget.value;
      this.limit = PAGE;
      this.render();
    });
  }

  static #onMore() {
    this.limit += PAGE;
    this.render();
  }

  static #onExport() {
    const name = this.filter ? fromUuidSync(this.filter)?.name : null;
    exportCsv(this._entries(), name ? `mint-${name.replace(/[^\p{L}\p{N}]+/gu, "-")}.csv` : "mint-historique.csv");
  }

  static async #onClear() {
    if (!(await confirmDialog(t("History.Clear"), t("History.ConfirmClear")))) return;
    await clearHistory();
  }
}
