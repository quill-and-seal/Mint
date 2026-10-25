/**
 * Registre des prêts et dettes.
 * Joueurs : proposer, accepter / refuser, rembourser, effacer une dette dont ils sont créanciers.
 * MJ : voit tout, impose des dettes (y compris avec des parties libres : banque, guilde…), annule.
 */

import { t, esc, worldTime } from "../constants.js";
import { getConfig, format, parse, defaultSystemId } from "../currencies.js";
import { visibleDebts, owed, userHasSide, debtApi, daysLeft, overdue } from "../debts.js";
import { ownedActors, giftTargets } from "../wallet.js";
import { MintApp, formDialog, confirmDialog, options } from "./base.js";

export class LedgerApp extends MintApp {
  static watches = ["debts", "currencies", "time"];

  constructor(options = {}) {
    super(options);
    this.tab = "active";
  }

  static DEFAULT_OPTIONS = {
    id: "mint-ledger",
    classes: ["mint", "mint-ledger"],
    window: { icon: "fa-solid fa-book", resizable: true },
    position: { width: 680, height: 520 },
    actions: {
      tab: LedgerApp.#onTab,
      create: LedgerApp.#onCreate,
      accept: LedgerApp.#onAccept,
      refuse: LedgerApp.#onRefuse,
      withdraw: LedgerApp.#onWithdraw,
      repay: LedgerApp.#onRepay,
      forgive: LedgerApp.#onForgive,
      cancel: LedgerApp.#onCancel,
      remove: LedgerApp.#onRemove
    }
  };

  get title() {
    return t("Ledger.Title");
  }

  _html() {
    const debts = visibleDebts();
    const groups = {
      active: debts.filter((d) => d.status === "active"),
      proposed: debts.filter((d) => d.status === "proposed"),
      closed: debts.filter((d) => d.status === "closed").sort((a, b) => (b.closedAt ?? 0) - (a.closedAt ?? 0))
    };
    const tab = (id) =>
      `<a class="${this.tab === id ? "active" : ""}" data-action="tab" data-tab="${id}">${t(`Ledger.Tab.${id}`)}${groups[id].length ? ` <span class="mint-badge">${groups[id].length}</span>` : ""}</a>`;
    const list = groups[this.tab] ?? [];
    const now = worldTime();

    const rows = list.map((d) => this._row(d, now)).join("");
    return `
      <div class="mint-row">
        <nav class="mint-tabs mint-grow">${tab("active")}${tab("proposed")}${tab("closed")}</nav>
        <button type="button" data-action="create"><i class="fa-solid fa-file-signature"></i> ${t(game.user.isGM ? "Ledger.Impose" : "Ledger.Propose")}</button>
      </div>
      <div class="mint-debts" data-scroll="debts">
        ${rows || `<p class="mint-empty">${t(`Ledger.Empty.${this.tab}`)}</p>`}
      </div>`;
  }

  _row(d, now) {
    const gm = game.user.isGM;
    const isCreditor = userHasSide(game.user, d, "creditor");
    const isDebtor = userHasSide(game.user, d, "debtor");
    const left = owed(d, now);
    const interest =
      d.rate > 0 ? t("Ledger.Interest", { rate: d.rate, days: d.periodDays }) : t("Ledger.NoInterest");
    const buttons = [];
    const btn = (action, icon, label) =>
      `<button type="button" data-action="${action}" data-id="${esc(d.id)}"><i class="fa-solid ${icon}"></i> ${t(label)}</button>`;

    if (d.status === "proposed") {
      const canAnswer = gm || userHasSide(game.user, d, d.awaiting);
      if (canAnswer && d.proposedBy !== game.user.id) {
        buttons.push(btn("accept", "fa-check", "Ledger.Accept"), btn("refuse", "fa-xmark", "Ledger.Refuse"));
      }
      if (d.proposedBy === game.user.id || gm) buttons.push(btn("withdraw", "fa-rotate-left", "Ledger.Withdraw"));
    } else if (d.status === "active") {
      if (isDebtor) buttons.push(btn("repay", "fa-receipt", "Ledger.Repay"));
      if (isCreditor) buttons.push(btn("forgive", "fa-dove", "Ledger.Forgive"));
      if (gm) buttons.push(btn("cancel", "fa-ban", "Ledger.Cancel"));
    } else if (gm) {
      buttons.push(btn("remove", "fa-trash", "Ledger.Remove"));
    }

    let status = "";
    if (d.status === "proposed") {
      status = t("Ledger.Awaiting", { name: esc(d[d.awaiting]?.name ?? "?") });
    } else if (d.status === "closed") {
      status = t(`Ledger.Closed.${d.closedReason ?? "cancelled"}`);
    } else {
      status = t("Ledger.Left", { amount: esc(format(left, d.system)) });
      const days = daysLeft(d, now);
      if (days !== null) {
        const late = overdue(d, now);
        const label = late
          ? t("Ledger.Overdue", { days: Math.max(1, -days) })
          : days <= 0
            ? t("Ledger.DueToday")
            : t("Ledger.DueIn", { days });
        const tip = d.lateFee ? t("Ledger.LateFeeHint", { pct: d.lateFee }) : "";
        status += ` <span class="mint-due ${late ? "late" : days <= 1 ? "soon" : ""}" ${tip ? `data-tooltip="${esc(tip)}"` : ""}><i class="fa-solid fa-hourglass-half"></i> ${esc(label)}</span>`;
      }
    }

    return `
      <article class="mint-debt mint-debt-${d.status}">
        <div class="mint-debt-parties">
          <span class="mint-party ${isCreditor ? "mine" : ""}">${esc(d.creditor.name)}</span>
          <i class="fa-solid fa-arrow-right-long"></i>
          <span class="mint-party ${isDebtor ? "mine" : ""}">${esc(d.debtor.name)}</span>
          ${d.imposed ? `<i class="fa-solid fa-gavel mint-muted" data-tooltip="${esc(t("Ledger.Imposed"))}"></i>` : ""}
          ${d.transfer ? `<i class="fa-solid fa-money-bill-transfer mint-muted" data-tooltip="${esc(t("Ledger.TransferHint"))}"></i>` : ""}
        </div>
        <div class="mint-debt-info">
          <strong>${esc(format(d.principal, d.system))}</strong>
          <span class="mint-muted">${esc(interest)}</span>
          <span class="mint-debt-status">${status}</span>
        </div>
        ${d.note ? `<p class="mint-debt-note">${esc(d.note)}</p>` : ""}
        ${buttons.length ? `<div class="mint-debt-actions">${buttons.join("")}</div>` : ""}
      </article>`;
  }

  /* -------------------------------------------- */

  static #onTab(event, target) {
    this.tab = target.dataset.tab;
    this.render();
  }

  static async #onCreate() {
    const gm = game.user.isGM;
    const mine = ownedActors();
    const others = giftTargets(null);
    const { systems } = getConfig();
    if (!gm && !mine.length) return ui.notifications.warn(t("Wallet.NoActor"));

    const partySelect = (name, list, withFree) => `
      <select name="${name}">
        ${options(list, null, { value: (a) => a.uuid })}
        ${withFree ? `<option value="">${esc(t("Ledger.FreeParty"))}</option>` : ""}
      </select>
      ${withFree ? `<input type="text" name="${name}Name" placeholder="${esc(t("Ledger.FreePartyName"))}">` : ""}`;

    const content = gm
      ? `
        <div class="form-group"><label>${t("Ledger.Creditor")}</label><div class="form-fields">${partySelect("creditor", others, true)}</div></div>
        <div class="form-group"><label>${t("Ledger.Debtor")}</label><div class="form-fields">${partySelect("debtor", others, true)}</div></div>`
      : `
        <div class="form-group"><label>${t("Ledger.MyActor")}</label>${partySelect("me", mine, false)}</div>
        <div class="form-group"><label>${t("Ledger.Role")}</label>
          <select name="role">
            <option value="creditor">${t("Ledger.RoleCreditor")}</option>
            <option value="debtor">${t("Ledger.RoleDebtor")}</option>
          </select></div>
        <div class="form-group"><label>${t("Ledger.Other")}</label>${partySelect("other", others, false)}</div>`;

    const data = await formDialog({
      title: t(gm ? "Ledger.Impose" : "Ledger.Propose"),
      ok: t(gm ? "Ledger.Impose" : "Ledger.Propose"),
      icon: "fa-solid fa-file-signature",
      content: `
        ${content}
        <div class="form-group"><label>${t("Ledger.Amount")}</label><input type="text" name="amount" required placeholder="${esc(t("Wallet.AmountPlaceholder"))}"></div>
        ${systems.length > 1 ? `<div class="form-group"><label>${t("Editor.System")}</label><select name="system">${options(systems, defaultSystemId())}</select></div>` : ""}
        <div class="form-group"><label>${t("Ledger.Rate")}</label>
          <div class="form-fields"><input type="number" name="rate" min="0" step="0.5" value="0"><span>%</span>
          <span>${t("Ledger.Every")}</span><input type="number" name="periodDays" min="0" step="1" value="7"><span>${t("Ledger.Days")}</span></div></div>
        <div class="form-group"><label data-tooltip="${esc(t("Ledger.DueHint"))}">${t("Ledger.Due")}</label>
          <div class="form-fields"><input type="number" name="dueDays" min="0" step="1" value="0"><span>${t("Ledger.Days")}</span>
          <span>${t("Ledger.LateFee")}</span><input type="number" name="lateFee" min="0" step="1" value="0"><span>%</span></div></div>
        <div class="form-group"><label>${t("Ledger.Transfer")}</label><input type="checkbox" name="transfer" checked></div>
        <p class="hint">${t("Ledger.TransferHint")}</p>
        <div class="form-group"><label>${t("Ledger.Note")}</label><input type="text" name="note"></div>`
    });
    if (!data) return;

    const system = data.system || defaultSystemId();
    const principal = parse(data.amount, system);
    if (!principal) return ui.notifications.warn(t("Error.BadAmount"));
    const party = (uuid, name) => ({ uuid: uuid || null, name: uuid ? null : name });
    let creditor;
    let debtor;
    if (gm) {
      creditor = party(data.creditor, data.creditorName);
      debtor = party(data.debtor, data.debtorName);
    } else {
      const me = party(data.me);
      const other = party(data.other);
      [creditor, debtor] = data.role === "creditor" ? [me, other] : [other, me];
    }
    const payload = {
      creditor, debtor, principal, system,
      rate: data.rate, periodDays: data.periodDays, dueDays: data.dueDays, lateFee: data.lateFee,
      transfer: !!data.transfer, note: data.note
    };
    const result = await this.attempt(() => (gm ? debtApi.impose(payload) : debtApi.propose(payload)));
    if (result) {
      this.tab = result.status === "proposed" ? "proposed" : "active";
      this.render();
    }
  }

  static async #onAccept(event, target) {
    await this.attempt(() => debtApi.respond(target.dataset.id, true));
  }

  static async #onRefuse(event, target) {
    await this.attempt(() => debtApi.respond(target.dataset.id, false));
  }

  static async #onWithdraw(event, target) {
    await this.attempt(() => debtApi.withdraw(target.dataset.id));
  }

  static async #onRepay(event, target) {
    const d = visibleDebts().find((x) => x.id === target.dataset.id);
    if (!d) return;
    const left = owed(d);
    const data = await formDialog({
      title: t("Ledger.Repay"),
      ok: t("Ledger.Repay"),
      icon: "fa-solid fa-receipt",
      content: `
        <p>${t("Ledger.Left", { amount: esc(format(left, d.system)) })}</p>
        <div class="form-group"><label>${t("Ledger.Amount")}</label><input type="text" name="amount" value="${esc(format(left, d.system))}"></div>`
    });
    if (!data) return;
    const amount = parse(data.amount, d.system);
    if (!amount) return ui.notifications.warn(t("Error.BadAmount"));
    await this.attempt(() => debtApi.repay(d.id, amount));
  }

  static async #onForgive(event, target) {
    if (!(await confirmDialog(t("Ledger.Forgive"), t("Ledger.ConfirmForgive")))) return;
    await this.attempt(() => debtApi.forgive(target.dataset.id));
  }

  static async #onCancel(event, target) {
    if (!(await confirmDialog(t("Ledger.Cancel"), t("Ledger.ConfirmCancel")))) return;
    await this.attempt(() => debtApi.cancel(target.dataset.id));
  }

  static async #onRemove(event, target) {
    await this.attempt(() => debtApi.cancel(target.dataset.id, true));
  }
}

