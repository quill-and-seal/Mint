/**
 * Base des fenêtres de Mint (ApplicationV2, rendu par chaîne HTML, sans template).
 */

import { esc, notifyError, t } from "../constants.js";

const { ApplicationV2, DialogV2 } = foundry.applications.api;

/** Fenêtres ouvertes, rafraîchies quand l'argent, les boutiques ou les dettes changent. */
export const openApps = new Set();

export function refreshApps(kind = null) {
  for (const app of openApps) {
    if (!kind || app.constructor.watches?.includes(kind)) app.render();
  }
}

export class MintApp extends ApplicationV2 {
  /** Ce que la fenêtre surveille : "wallet", "shops", "debts", "currencies". */
  static watches = [];

  /** À surcharger : HTML du contenu. */
  _html() {
    return "";
  }

  async _renderHTML() {
    const div = document.createElement("div");
    div.className = "mint-body";
    div.innerHTML = this._html();
    return div;
  }

  _replaceHTML(result, content) {
    // Garde la position de défilement des listes d'une mise à jour à l'autre
    const scroll = [...content.querySelectorAll("[data-scroll]")].map((el) => [el.dataset.scroll, el.scrollTop]);
    content.replaceChildren(result);
    for (const [key, top] of scroll) {
      const el = content.querySelector(`[data-scroll="${key}"]`);
      if (el) el.scrollTop = top;
    }
  }

  _onFirstRender(context, options) {
    super._onFirstRender?.(context, options);
    openApps.add(this);
  }

  _onClose(options) {
    super._onClose?.(options);
    openApps.delete(this);
  }

  /** Lance une opération et affiche proprement ses erreurs. */
  async attempt(fn) {
    try {
      return await fn();
    } catch (err) {
      notifyError(err);
      return undefined;
    }
  }
}

/**
 * Petit formulaire modal. Retourne les valeurs du formulaire, ou null si annulé.
 */
export async function formDialog({ title, content, ok = t("Common.Confirm"), icon = "fa-solid fa-coins" }) {
  try {
    return await DialogV2.input({
      window: { title, icon },
      classes: ["mint", "mint-dialog"],
      content,
      ok: { label: ok, icon: "fa-solid fa-check" },
      rejectClose: false
    });
  } catch {
    return null;
  }
}

export async function confirmDialog(title, text) {
  try {
    return await DialogV2.confirm({
      window: { title },
      content: `<p>${esc(text)}</p>`,
      rejectClose: false
    });
  } catch {
    return false;
  }
}

/** Options d'un <select>. */
export function options(list, selected, { value = (x) => x.id, label = (x) => x.name } = {}) {
  return list
    .map((x) => `<option value="${esc(value(x))}" ${value(x) === selected ? "selected" : ""}>${esc(label(x))}</option>`)
    .join("");
}
