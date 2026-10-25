/**
 * Calculs de monnaie, sans dépendance à Foundry (testables avec Node).
 *
 * Vocabulaire :
 * - une « devise » (currency) : { id, system, name, abbr, value } ; value = valeur en unités de base de son système
 * - un « système » monétaire : un groupe de devises qui se convertissent entre elles sans frais
 *   (ex. pièces de cuivre, d'argent, d'or d'un même royaume)
 * - une « bourse » (wallet) : { [idDevise]: nombre de pièces }
 */

/** Devises d'un système, de la plus forte à la plus faible. */
export function sortedDenoms(currencies, systemId) {
  return currencies.filter((c) => c.system === systemId).sort((a, b) => b.value - a.value);
}

/** Nombre entier positif ou nul. */
export function count(n) {
  const v = Math.floor(Number(n));
  return Number.isFinite(v) && v > 0 ? v : 0;
}

/** Valeur totale des pièces d'un système contenues dans une bourse, en unités de base. */
export function walletValue(wallet, denoms) {
  return denoms.reduce((sum, d) => sum + count(wallet?.[d.id]) * d.value, 0);
}

/**
 * Décompose une valeur en pièces, en commençant par les plus fortes.
 * remainder : ce qui ne peut pas être rendu si la plus petite pièce vaut plus de 1.
 */
export function breakdown(value, denoms) {
  const coins = {};
  let rest = count(value);
  for (const d of denoms) {
    const n = Math.floor(rest / d.value);
    if (n > 0) {
      coins[d.id] = n;
      rest -= n * d.value;
    }
  }
  return { coins, remainder: rest };
}

/** « 2 po 5 pa » ; « 0 pc » pour une valeur nulle. */
export function formatValue(value, denoms) {
  if (!denoms.length) return String(count(value));
  const { coins } = breakdown(value, denoms);
  const parts = denoms.filter((d) => coins[d.id]).map((d) => `${coins[d.id]} ${d.abbr}`);
  return parts.length ? parts.join(" ") : `0 ${denoms[denoms.length - 1].abbr}`;
}

/** Pièces → texte, sans regrouper : « 3 po 12 pa ». */
export function formatCoins(coins, denoms) {
  const parts = denoms.filter((d) => count(coins?.[d.id])).map((d) => `${count(coins[d.id])} ${d.abbr}`);
  return parts.length ? parts.join(" ") : "—";
}

/**
 * Lit un montant tapé par l'utilisateur, en unités de base.
 * « 2 po 5 pa », « 2po5pa », « 1,5 po », « 150 » (sans unité = devise principale).
 * Retourne null si le texte n'est pas compris.
 */
export function parseAmount(text, denoms, primaryId) {
  const s = String(text ?? "").trim().toLowerCase().replace(/,/g, ".");
  if (!s) return 0;
  const primary = denoms.find((d) => d.id === primaryId) ?? denoms[denoms.length - 1];
  const re = /(\d+(?:\.\d+)?)\s*([^\d\s.]*)/g;
  let total = 0;
  let consumed = "";
  let m;
  while ((m = re.exec(s))) {
    if (!m[0]) break;
    consumed += m[0];
    const unitText = m[2];
    const unit = unitText
      ? denoms.find((d) => [d.abbr, d.id, d.name].some((k) => String(k ?? "").toLowerCase() === unitText))
      : primary;
    if (!unit) return null;
    total += Number(m[1]) * unit.value;
  }
  if (s.replace(/\s+/g, "") !== consumed.replace(/\s+/g, "")) return null;
  return Math.round(total);
}

/** Ajoute des pièces à une bourse (nouvelle bourse). */
export function addCoins(wallet, coins) {
  const out = { ...wallet };
  for (const [id, n] of Object.entries(coins ?? {})) out[id] = count(out[id]) + count(n);
  return out;
}

/** Retire des pièces précises ; null s'il en manque. */
export function removeCoins(wallet, coins) {
  const out = { ...wallet };
  for (const [id, n] of Object.entries(coins ?? {})) {
    const left = count(out[id]) - count(n);
    if (left < 0) return null;
    out[id] = left;
  }
  return out;
}

/**
 * Paie une somme avec les pièces d'une bourse, monnaie rendue comprise.
 * On donne d'abord les plus fortes pièces sans dépasser la somme, puis, s'il reste
 * quelque chose à payer, la plus petite pièce qui couvre le reste ; la monnaie est
 * rendue en pièces les plus fortes possible.
 * Retourne { wallet, paid, change } ou null si la bourse ne suffit pas.
 */
export function pay(wallet, denoms, cost) {
  const price = count(cost);
  if (walletValue(wallet, denoms) < price) return null;
  const left = { ...wallet };
  const paid = {};
  let rest = price;

  for (const d of denoms) {
    const take = Math.min(count(left[d.id]), Math.floor(rest / d.value));
    if (take > 0) {
      left[d.id] = count(left[d.id]) - take;
      paid[d.id] = take;
      rest -= take * d.value;
    }
  }

  let change = {};
  if (rest > 0) {
    // Les pièces restantes valent toutes plus que le reste : on prend la plus petite
    const coin = [...denoms].reverse().find((d) => count(left[d.id]) > 0 && d.value >= rest);
    if (!coin) return null;
    left[coin.id] = count(left[coin.id]) - 1;
    paid[coin.id] = (paid[coin.id] ?? 0) + 1;
    change = breakdown(coin.value - rest, denoms).coins;
  }

  return { wallet: addCoins(left, change), paid, change };
}

/** Change d'un système à l'autre : valeur obtenue, frais déduits (fee entre 0 et 1). */
export function exchangeValue(value, fromRate, toRate, fee = 0) {
  if (!(fromRate > 0) || !(toRate > 0)) return 0;
  const raw = ((count(value) * fromRate) / toRate) * (1 - Math.min(Math.max(fee, 0), 1));
  // Petite marge pour les erreurs d'arrondi des flottants (0,1 × 3 = 0,30000000000000004…)
  return Math.floor(raw + 1e-9);
}
