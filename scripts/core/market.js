/**
 * Économie du monde, sans dépendance à Foundry (testable avec Node).
 *
 * Un « monde » contient :
 *   goods    : biens échangés { id, name, category, price (prix de base, unités de référence), unit, spoil (perte/jour, 0-1) }
 *   regions  : marchés { id, name, system, prosperity, tax, production {bien: unités/jour}, consumption {…}, stock {…}, modifiers {bien: ×} }
 *   routes   : liaisons commerciales { id, a, b, days, cost (fraction du prix de base par jour de trajet), capacity (unités/jour), risk (0-1), open }
 *   factions : guildes, compagnies, banques { id, name, kind, region, goods [ids], treasury, shares, price, sentiment, dividend (%), holders { uuid: { n, cost } } }
 *   events   : événements { id, name, region|null, good|null, production ×, consumption ×, price ×, block (routes de la région coupées), sentiment, start, days }
 *
 * Tous les prix internes sont en « unités de référence » (les unités de base du système monétaire
 * de taux 1) ; l'affichage les convertit dans la monnaie de chaque région.
 *
 * Un tick = un jour : production et consommation, pertes, commerce par arbitrage entre régions
 * reliées, factions (bénéfices, cours, dividendes), indices et historique.
 */

export const MARKET_DEFAULTS = Object.freeze({
  elasticity: 0.6, // sensibilité du prix au stock
  minFactor: 0.3, // prix plancher (× prix de base)
  maxFactor: 4, // prix plafond
  coverDays: 10, // stock « normal » = 10 jours de besoins
  tradeIntensity: 1, // multiplicateur des volumes échangés
  volatility: 0.03, // bruit quotidien sur la production et les cours
  historySize: 90, // points gardés dans l'historique
  dividendDays: 30, // périodicité des dividendes
  spread: 0.01 // écart achat/vente des actions
});

/* -------------------------------------------- */
/*  Outils                                      */
/* -------------------------------------------- */

const num = (v, d = 0) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? d : Number(v));
const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

/** Générateur pseudo-aléatoire reproductible (mulberry32). */
export function rng(seed) {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Bruit centré (−1 à 1, en cloche). */
function noise(random) {
  return (random() + random() + random()) / 1.5 - 1;
}

export const key = (regionId, goodId) => `${regionId}:${goodId}`;

/* -------------------------------------------- */
/*  Événements                                  */
/* -------------------------------------------- */

/** L'événement est-il actif au jour `day` ? */
export function eventActive(event, day) {
  const start = num(event.start, 0);
  const days = num(event.days, 0);
  return day >= start && (days <= 0 || day < start + days);
}

/** Effets cumulés des événements actifs sur un bien d'une région. */
export function eventEffects(events, regionId, goodId, day) {
  const fx = { production: 1, consumption: 1, price: 1 };
  for (const e of events ?? []) {
    if (!eventActive(e, day)) continue;
    if (e.region && e.region !== regionId) continue;
    if (e.good && e.good !== goodId) continue;
    fx.production *= num(e.production, 1);
    fx.consumption *= num(e.consumption, 1);
    fx.price *= num(e.price, 1);
  }
  return fx;
}

/** Une route est-elle coupée (fermée, ou région d'un bout touchée par un blocus) ? */
export function routeBlocked(route, events, day) {
  if (route.open === false) return true;
  return (events ?? []).some((e) => e.block && eventActive(e, day) && (!e.region || e.region === route.a || e.region === route.b));
}

/* -------------------------------------------- */
/*  Prix                                        */
/* -------------------------------------------- */

/** Stock « normal » d'un bien dans une région : quelques jours de besoins (ou de production). */
export function stockTarget(region, goodId, opts = MARKET_DEFAULTS) {
  const need = Math.max(num(region.consumption?.[goodId]), num(region.production?.[goodId]) * 0.5);
  return Math.max(1, need * num(opts.coverDays, MARKET_DEFAULTS.coverDays));
}

/** Facteur d'offre et de demande : stock bas → cher, stock haut → bon marché. */
export function supplyFactor(stock, target, opts = MARKET_DEFAULTS) {
  const ratio = (Math.max(0, num(stock)) + 1) / (Math.max(0, num(target)) + 1);
  return clamp(Math.pow(ratio, -num(opts.elasticity, MARKET_DEFAULTS.elasticity)), num(opts.minFactor, 0.3), num(opts.maxFactor, 4));
}

/** Prix d'un bien dans une région (unités de référence). */
export function regionPrice(world, regionId, goodId, opts = world.settings ?? MARKET_DEFAULTS) {
  const region = world.regions.find((r) => r.id === regionId);
  const good = world.goods.find((g) => g.id === goodId);
  if (!region || !good) return 0;
  const fx = eventEffects(world.events, regionId, goodId, num(world.day));
  const f = supplyFactor(region.stock?.[goodId], stockTarget(region, goodId, opts), opts);
  const mod = num(region.modifiers?.[goodId], 1);
  return Math.max(0.01, num(good.price) * f * mod * fx.price * (1 + num(region.tax)));
}

/** Indice des prix (100 = prix de base), pondéré par la consommation. */
export function priceIndex(world) {
  let sum = 0;
  let weight = 0;
  for (const r of world.regions) {
    for (const g of world.goods) {
      if (!(g.price > 0)) continue;
      const w = num(r.consumption?.[g.id]) + 0.1;
      sum += (regionPrice(world, r.id, g.id) / g.price) * w;
      weight += w;
    }
  }
  return weight ? (sum / weight) * 100 : 100;
}

/* -------------------------------------------- */
/*  Factions                                    */
/* -------------------------------------------- */

/** Actions détenues par les joueurs (le reste est à vendre par la faction). */
export function heldShares(faction) {
  return Object.values(faction.holders ?? {}).reduce((s, h) => s + num(h?.n), 0);
}

/** Valeur comptable d'une action. */
export function bookValue(faction) {
  return Math.max(0, num(faction.treasury)) / Math.max(1, num(faction.shares, 1));
}

/** Prix d'achat et de vente d'une action (écart de cotation). */
export function sharePrices(faction, spread = MARKET_DEFAULTS.spread) {
  const p = Math.max(0.01, num(faction.price));
  return { buy: p * (1 + spread), sell: p * (1 - spread) };
}

/** Coût et effet sur le cours d'un achat (n > 0) ou d'une vente (n < 0) d'actions. */
export function shareTrade(faction, n, spread = MARKET_DEFAULTS.spread) {
  const { buy, sell } = sharePrices(faction, spread);
  const qty = Math.trunc(num(n));
  const total = qty > 0 ? Math.ceil(buy * qty) : Math.floor(sell * -qty);
  // La demande fait monter le cours : +0,5 % pour 1 % du capital acheté
  const impact = (qty / Math.max(1, num(faction.shares, 1))) * 0.5;
  return { qty, total, impact };
}

/* -------------------------------------------- */
/*  Tick                                        */
/* -------------------------------------------- */

function pushHistory(list, value, size) {
  const out = Array.isArray(list) ? list.slice(-(size - 1)) : [];
  out.push(Math.round(value * 1000) / 1000);
  return out;
}

/**
 * Avance le monde d'un jour. Ne modifie pas l'objet reçu : retourne
 * { world, trades, payouts, shortages } (payouts = dividendes à verser aux personnages).
 */
export function tick(input, { random = Math.random } = {}) {
  const world = structuredClone(input);
  const opts = { ...MARKET_DEFAULTS, ...(world.settings ?? {}) };
  const day = num(world.day) + 1;
  world.day = day;
  world.events = (world.events ?? []).filter((e) => num(e.days) <= 0 || day < num(e.start) + num(e.days));

  // 1. Production, consommation, pertes
  const shortages = [];
  for (const r of world.regions) {
    r.stock ??= {};
    let needed = 0;
    let met = 0;
    for (const g of world.goods) {
      const fx = eventEffects(world.events, r.id, g.id, day);
      const prosperity = clamp(num(r.prosperity, 1), 0.3, 2);
      const vol = num(opts.volatility);
      const produced = Math.max(0, num(r.production?.[g.id]) * fx.production * (1 + vol * noise(random)) * (0.75 + prosperity / 4));
      const wanted = Math.max(0, num(r.consumption?.[g.id]) * fx.consumption * prosperity);
      // Une petite perte minimale garde les stocks bornés sur une longue campagne
      let stock = num(r.stock[g.id]) * (1 - clamp(num(g.spoil, 0.02), 0.001, 1)) + produced;
      const eaten = Math.min(stock, wanted);
      stock -= eaten;
      // La nourriture compte triple dans le contentement de la population
      const weight = g.category === "food" ? 3 : 1;
      needed += wanted * weight;
      met += eaten * weight;
      if (wanted > 0 && eaten < wanted * 0.9) shortages.push({ region: r.id, good: g.id, missing: wanted - eaten });
      r.stock[g.id] = Math.round(stock * 100) / 100;
    }
    // Prospérité : monte quand les besoins sont couverts, baisse en cas de pénurie
    const satisfaction = needed > 0 ? met / needed : 1;
    const p0 = num(r.prosperity, 1);
    r.prosperity = Math.round(clamp(p0 + 0.02 * (satisfaction - 0.95) + 0.02 * (1 - p0), 0.3, 2) * 1000) / 1000;
  }

  // 2. Commerce : les marchands achètent là où c'est bon marché et revendent là où c'est cher
  const trades = [];
  for (const route of world.routes ?? []) {
    if (routeBlocked(route, world.events, day)) continue;
    const A = world.regions.find((r) => r.id === route.a);
    const B = world.regions.find((r) => r.id === route.b);
    if (!A || !B) continue;
    for (const g of world.goods) {
      const pA = regionPrice(world, A.id, g.id, opts);
      const pB = regionPrice(world, B.id, g.id, opts);
      const [low, high, pLow, pHigh] = pA <= pB ? [A, B, pA, pB] : [B, A, pB, pA];
      const cost = num(g.price) * num(route.cost, 0.02) * Math.max(1, num(route.days, 1)) + pLow * clamp(num(route.risk), 0, 1);
      const spread = pHigh - pLow;
      if (spread <= cost) continue;
      const margin = (spread - cost) / pLow;
      const available = num(low.stock[g.id]) * 0.25;
      const volume = Math.min(num(route.capacity, 10) * num(opts.tradeIntensity, 1) * Math.min(1, margin), available);
      if (!(volume > 0.01)) continue;
      low.stock[g.id] = Math.round((num(low.stock[g.id]) - volume) * 100) / 100;
      high.stock[g.id] = Math.round((num(high.stock[g.id]) + volume) * 100) / 100;
      trades.push({ route: route.id, good: g.id, from: low.id, to: high.id, volume, profit: volume * (spread - cost), value: volume * pLow });
    }
  }

  // 3. Factions : bénéfices, cours, dividendes
  const payouts = [];
  for (const f of world.factions ?? []) {
    const goods = f.goods?.length ? new Set(f.goods) : null;
    const mine = (g) => !goods || goods.has(g);
    let revenue = 0;
    const trader = f.kind !== "bank";
    for (const t of trader ? trades : []) {
      if (!mine(t.good)) continue;
      if (t.from === f.region || t.to === f.region) revenue += t.profit * 0.1;
    }
    const region = world.regions.find((r) => r.id === f.region);
    if (region && trader) {
      for (const g of world.goods) {
        if (mine(g.id)) revenue += num(region.production?.[g.id]) * regionPrice(world, region.id, g.id, opts) * 0.2;
      }
    }
    if (f.kind === "bank") revenue += Math.max(0, num(f.treasury)) * 0.0021;
    const upkeep = Math.max(0, num(f.treasury)) * 0.002 + num(f.upkeep);
    f.treasury = Math.round((num(f.treasury) + revenue - upkeep) * 100) / 100;

    // Sentiment : effets des événements, puis retour vers 1
    let sentiment = num(f.sentiment, 1);
    for (const e of world.events) {
      if (num(e.sentiment) && eventActive(e, day) && (!e.region || e.region === f.region)) sentiment *= 1 + num(e.sentiment) / 100;
    }
    sentiment += 0.05 * (1 - sentiment);
    f.sentiment = Math.round(clamp(sentiment, 0.3, 3) * 1000) / 1000;

    const target = bookValue(f) * f.sentiment;
    const price = Math.max(0.01, num(f.price, target));
    f.price = Math.max(0.01, price + 0.2 * (target - price) + price * num(opts.volatility) * noise(random));
    f.price = Math.round(f.price * 1000) / 1000;

    // Dividendes
    const every = Math.max(1, num(opts.dividendDays, 30));
    if (num(f.dividend) > 0 && day % every === 0 && f.treasury > 0) {
      const perShare = (f.price * num(f.dividend)) / 100;
      for (const [uuid, h] of Object.entries(f.holders ?? {})) {
        const amount = Math.floor(perShare * num(h?.n));
        if (amount > 0 && amount <= f.treasury) {
          f.treasury -= amount;
          payouts.push({ faction: f.id, actor: uuid, amount });
        }
      }
    }
  }

  // 4. Historique
  const size = Math.max(10, num(opts.historySize, 90));
  world.history ??= {};
  world.history.prices ??= {};
  world.history.factions ??= {};
  for (const r of world.regions) {
    for (const g of world.goods) {
      const k = key(r.id, g.id);
      world.history.prices[k] = pushHistory(world.history.prices[k], regionPrice(world, r.id, g.id, opts), size);
    }
  }
  for (const f of world.factions ?? []) world.history.factions[f.id] = pushHistory(world.history.factions[f.id], f.price, size);
  world.history.index = pushHistory(world.history.index, priceIndex(world), size);
  world.history.days = pushHistory(world.history.days, day, size);
  // Volumes échangés du jour, par région et bien (pour l'affichage)
  world.lastTrades = trades.map((t) => ({ ...t, volume: Math.round(t.volume * 10) / 10, profit: Math.round(t.profit) }));

  return { world, trades, payouts, shortages };
}

/** Variation en % d'une série sur les `n` derniers points. */
export function change(series, n = 7) {
  if (!Array.isArray(series) || series.length < 2) return 0;
  const last = series[series.length - 1];
  const prev = series[Math.max(0, series.length - 1 - n)];
  return prev ? ((last - prev) / prev) * 100 : 0;
}
