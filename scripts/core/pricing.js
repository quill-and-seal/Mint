/**
 * Prix dynamiques des boutiques (offre et demande), sans dépendance à Foundry.
 *
 * Chaque article a un stock « normal » (target). Quand le stock passe sous la normale,
 * le prix monte ; au-dessus (les joueurs ont beaucoup revendu), il baisse :
 *   facteur = 1 + élasticité × (normale − stock) / normale, borné entre minFactor et maxFactor.
 * Un article sans stock (stock = null) est illimité et garde son prix de base.
 */

export const PRICING_DEFAULTS = Object.freeze({
  markup: 0, // majoration de la boutique, en fraction (0,2 = +20 %)
  sellRatio: 0.5, // part du prix que la boutique paie quand on lui vend
  elasticity: 0.5,
  minFactor: 0.5,
  maxFactor: 3
});

const num = (v, d) => (Number.isFinite(Number(v)) && v !== null && v !== "" ? Number(v) : d);

/** Facteur d'offre et de demande pour un stock donné. */
export function priceFactor(stock, target, elasticity, minFactor, maxFactor) {
  if (stock === null || stock === undefined || !(target > 0)) return 1;
  const f = 1 + elasticity * ((target - stock) / target);
  return Math.min(Math.max(f, minFactor), maxFactor);
}

/**
 * Prix d'une unité quand le stock vaut `stock` (par défaut, le stock actuel).
 * `factor` : ajustement propre au client (réputation, marchandage), voir customerFactors.
 */
export function unitPrice(item, shop = {}, stock = item.stock, factor = 1) {
  const base = Math.max(0, num(item.price, 0));
  if (!base) return 0;
  const f = priceFactor(
    stock,
    num(item.target, 0),
    num(shop.elasticity, PRICING_DEFAULTS.elasticity),
    num(shop.minFactor, PRICING_DEFAULTS.minFactor),
    num(shop.maxFactor, PRICING_DEFAULTS.maxFactor)
  );
  const markup = 1 + num(shop.markup, PRICING_DEFAULTS.markup);
  const modifier = num(item.modifier, 1);
  return Math.max(1, Math.round(base * f * markup * modifier * num(factor, 1)));
}

/** Prix total pour acheter `qty` unités : chaque unité achetée fait monter la suivante. */
export function buyTotal(item, shop, qty, factor = 1) {
  const n = Math.max(0, Math.floor(qty));
  if (item.stock === null || item.stock === undefined) return unitPrice(item, shop, null, factor) * n;
  let total = 0;
  for (let i = 0; i < n; i++) total += unitPrice(item, shop, item.stock - i, factor);
  return total;
}

/** Somme payée par la boutique pour `qty` unités revendues : chaque unité fait baisser la suivante. */
export function sellTotal(item, shop, qty, factor = 1) {
  const n = Math.max(0, Math.floor(qty));
  const ratio = num(shop.sellRatio, PRICING_DEFAULTS.sellRatio);
  const unlimited = item.stock === null || item.stock === undefined;
  let total = 0;
  for (let i = 0; i < n; i++) total += unitPrice(item, shop, unlimited ? null : item.stock + i + 1, factor) * ratio;
  return Math.floor(total);
}

/**
 * Réassort : le stock revient vers la normale de `restock` unités par intervalle écoulé,
 * dans les deux sens (une boutique pleine de marchandise revendue finit par l'écouler).
 */
export function restockStock(item, intervals) {
  const { stock } = item;
  const target = num(item.target, 0);
  const step = num(item.restock, 0) * Math.max(0, Math.floor(intervals));
  if (stock === null || stock === undefined || !step) return stock;
  if (stock < target) return Math.min(target, stock + step);
  if (stock > target) return Math.max(target, stock - step);
  return stock;
}

/**
 * Ajustements de prix propres à un client, en % (négatif = moins cher pour lui) :
 * réputation auprès de la boutique + résultat d'un marchandage.
 * Retourne les facteurs à l'achat et à la revente (un bon client achète moins cher
 * et revend plus cher).
 */
export function customerFactors(adjustments = []) {
  const pct = adjustments.reduce((sum, v) => sum + (Number(v) || 0), 0);
  return {
    pct,
    buy: Math.min(Math.max(1 + pct / 100, 0.1), 3),
    sell: Math.min(Math.max(1 - pct / 100, 0), 2)
  };
}

/**
 * Résultat d'un marchandage, en % d'ajustement du prix.
 * Réussite (total ≥ difficulté) : 5 % de remise + 1 % par point au-dessus, plafonnée.
 * Échec de 5 ou plus : le marchand, vexé, majore ses prix. Sinon, rien ne change.
 */
export function haggleOutcome(total, dc, { maxDiscount = 20, penalty = 10 } = {}) {
  const margin = Math.floor(Number(total) || 0) - Math.floor(Number(dc) || 0);
  if (margin >= 0) return -Math.min(Math.max(0, maxDiscount), 5 + margin);
  if (margin <= -5) return Math.max(0, penalty);
  return 0;
}
