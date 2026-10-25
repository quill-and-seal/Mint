/** Identifiant du module, utilisé pour les flags, les réglages, le socket et l'API. */
export const MODULE_ID = "mint-economy";

/** Canal socket du module (nécessite "socket": true dans module.json). */
export const SOCKET = `module.${MODULE_ID}`;

/** Clés des réglages. */
export const SETTINGS = Object.freeze({
  currencies: "currencies",
  shops: "shops",
  debts: "debts",
  sheetPath: "sheetPath",
  chatLog: "chatLog"
});

/** Flag d'acteur qui contient la bourse (devises non reliées à la fiche). */
export const FLAG_WALLET = "wallet";

/** Erreur « métier » : la clé est traduite sous MINT.Error.<clé>. */
export class MintError extends Error {
  constructor(key, data = {}) {
    super(key);
    this.key = key;
    this.data = data;
  }
}

export function log(...args) {
  console.log("Mint |", ...args);
}

export function warn(...args) {
  console.warn("Mint |", ...args);
}

/** Traduction raccourcie. */
export function t(key, data) {
  const full = `MINT.${key}`;
  return data ? game.i18n.format(full, data) : game.i18n.localize(full);
}

/** Échappement HTML. */
export function esc(value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]
  );
}

/** Affiche une erreur métier (ou inattendue) à l'utilisateur. */
export function notifyError(err) {
  if (err instanceof MintError || err?.key) {
    ui.notifications.warn(t(`Error.${err.key}`, err.data ?? {}));
  } else {
    console.error("Mint |", err);
    ui.notifications.error(t("Error.Unexpected"));
  }
}

/** Secondes dans un jour du calendrier du monde (86 400 par défaut). */
export function secondsPerDay() {
  try {
    const d = game.time?.calendar?.days;
    const s = d ? d.hoursPerDay * d.minutesPerHour * d.secondsPerMinute : 0;
    return s > 0 ? s : 86400;
  } catch {
    return 86400;
  }
}

/** Temps du monde actuel, en secondes. */
export function worldTime() {
  return game.time?.worldTime ?? 0;
}
