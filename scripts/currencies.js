/**
 * Configuration des monnaies : systèmes monétaires, devises et frais de change.
 *
 * Stockée dans le réglage de monde « currencies » :
 * {
 *   fee: 0.05,                       // frais du changeur entre deux systèmes (fraction)
 *   systems: [{ id, name, rate, primary }],
 *     rate    : valeur d'une unité de base de ce système dans l'unité de référence commune
 *     primary : devise affichée et utilisée quand on tape un montant sans unité
 *   currencies: [{ id, system, name, abbr, value, color, sheetKey }]
 *     value    : valeur en unités de base de son système (la plus petite pièce vaut en général 1)
 *     sheetKey : champ de la fiche à synchroniser (ex. « gp » pour dnd5e), vide = stocké par Mint
 * }
 */

import { MODULE_ID, SETTINGS, t } from "./constants.js";
import { sortedDenoms, formatValue, parseAmount, formatCoins } from "./core/money.js";

/** Préréglages proposés dans la configuration. */
export function presets() {
  return {
    fantasy: () => ({
      fee: 0.05,
      systems: [{ id: "standard", name: t("Preset.Fantasy.System"), rate: 1, primary: "po" }],
      currencies: [
        { id: "pp", system: "standard", name: t("Preset.Fantasy.pp"), abbr: t("Preset.Fantasy.ppAbbr"), value: 1000, color: "#d9dde3", sheetKey: "pp" },
        { id: "po", system: "standard", name: t("Preset.Fantasy.po"), abbr: t("Preset.Fantasy.poAbbr"), value: 100, color: "#e7b84a", sheetKey: "gp" },
        { id: "pe", system: "standard", name: t("Preset.Fantasy.pe"), abbr: t("Preset.Fantasy.peAbbr"), value: 50, color: "#c9b37a", sheetKey: "ep" },
        { id: "pa", system: "standard", name: t("Preset.Fantasy.pa"), abbr: t("Preset.Fantasy.paAbbr"), value: 10, color: "#b8c0c8", sheetKey: "sp" },
        { id: "pc", system: "standard", name: t("Preset.Fantasy.pc"), abbr: t("Preset.Fantasy.pcAbbr"), value: 1, color: "#b8733d", sheetKey: "cp" }
      ]
    }),
    simple: () => ({
      fee: 0,
      systems: [{ id: "standard", name: t("Preset.Simple.System"), rate: 1, primary: "credit" }],
      currencies: [
        { id: "credit", system: "standard", name: t("Preset.Simple.Name"), abbr: t("Preset.Simple.Abbr"), value: 1, color: "#5fb3a1", sheetKey: "" }
      ]
    })
  };
}

let cache = null;

/** Configuration actuelle (préréglage fantasy si rien n'est encore enregistré). */
export function getConfig() {
  if (cache) return cache;
  const stored = game.settings.get(MODULE_ID, SETTINGS.currencies);
  const base = stored?.systems?.length ? stored : presets().fantasy();
  cache = {
    fee: Number(base.fee) || 0,
    systems: (base.systems ?? []).map((s) => ({ ...s, rate: Number(s.rate) || 1 })),
    currencies: (base.currencies ?? []).map((c) => ({ ...c, value: Math.max(1, Math.floor(Number(c.value) || 1)) }))
  };
  return cache;
}

/** À appeler quand le réglage change. */
export function clearCache() {
  cache = null;
}

/** Enregistre une nouvelle configuration (MJ). */
export async function saveConfig(config) {
  clearCache();
  await game.settings.set(MODULE_ID, SETTINGS.currencies, config);
}

export function getSystem(systemId) {
  const { systems } = getConfig();
  return systems.find((s) => s.id === systemId) ?? systems[0];
}

/** Devises d'un système, de la plus forte à la plus faible. */
export function denoms(systemId) {
  return sortedDenoms(getConfig().currencies, getSystem(systemId)?.id);
}

export function getCurrency(id) {
  return getConfig().currencies.find((c) => c.id === id);
}

/** Système par défaut (le premier). */
export function defaultSystemId() {
  return getConfig().systems[0]?.id;
}

/** Valeur → texte dans un système : « 2 po 5 pa ». */
export function format(value, systemId) {
  return formatValue(value, denoms(systemId));
}

/** Pièces → texte. */
export function formatPurse(coins, systemId) {
  return formatCoins(coins, denoms(systemId));
}

/** Texte → valeur dans un système (null si incompris). */
export function parse(text, systemId) {
  const sys = getSystem(systemId);
  return parseAmount(text, denoms(sys?.id), sys?.primary);
}

/** Petit badge coloré d'une devise. */
export function coinDot(currency) {
  const color = /^#[0-9a-f]{3,8}$/i.test(currency?.color ?? "") ? currency.color : "#999";
  return `<span class="mint-coin" style="--mint-coin:${color}"></span>`;
}
