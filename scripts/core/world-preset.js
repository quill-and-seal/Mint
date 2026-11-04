/**
 * Monde de départ (fantasy) et modèles d'événements, sans dépendance à Foundry.
 * Prix de base en unités de référence (pièces de cuivre avec le préréglage fantasy).
 */

const L = (fr, en) => ({ fr, en });

const GOODS = [
  { id: "ble", name: L("Blé", "Wheat"), unit: L("sac", "sack"), category: "food", price: 20, spoil: 0.01 },
  { id: "poisson", name: L("Poisson", "Fish"), unit: L("caisse", "crate"), category: "food", price: 30, spoil: 0.08 },
  { id: "vin", name: L("Vin", "Wine"), unit: L("tonneau", "cask"), category: "food", price: 80, spoil: 0.005 },
  { id: "sel", name: L("Sel", "Salt"), unit: L("sac", "sack"), category: "raw", price: 50, spoil: 0 },
  { id: "bois", name: L("Bois", "Timber"), unit: L("stère", "cord"), category: "raw", price: 30, spoil: 0.005 },
  { id: "fer", name: L("Fer", "Iron"), unit: L("lingot", "ingot"), category: "raw", price: 100, spoil: 0 },
  { id: "laine", name: L("Laine", "Wool"), unit: L("balle", "bale"), category: "raw", price: 40, spoil: 0.01 },
  { id: "epices", name: L("Épices", "Spices"), unit: L("sachet", "pouch"), category: "luxury", price: 400, spoil: 0.005 }
];

const REGIONS = [
  {
    id: "port-brume", name: L("Port-Brume", "Mistport"), prosperity: 1.05, tax: 0.05,
    production: { poisson: 40, sel: 25, epices: 2 },
    consumption: { ble: 30, bois: 12, vin: 8, fer: 4, laine: 6, poisson: 15, sel: 3, epices: 1 }
  },
  {
    id: "valombre", name: L("Valombre", "Shadevale"), prosperity: 1, tax: 0.03,
    production: { ble: 95, laine: 20, vin: 26 },
    consumption: { ble: 25, poisson: 8, sel: 6, bois: 8, fer: 3, vin: 5, epices: 0.5 }
  },
  {
    id: "forge-noire", name: L("Forge-Noire", "Blackforge"), prosperity: 0.95, tax: 0.04,
    production: { fer: 20 },
    consumption: { ble: 20, bois: 18, vin: 7, sel: 4, poisson: 6, laine: 4, fer: 6 }
  },
  {
    id: "sylvemarche", name: L("Sylvemarche", "Woodmarch"), prosperity: 1, tax: 0.02,
    production: { bois: 55, laine: 6, ble: 10 },
    consumption: { ble: 12, sel: 3, fer: 4, vin: 3, poisson: 4, bois: 6 }
  }
];

const ROUTES = [
  { id: "r1", a: "port-brume", b: "valombre", days: 3, cost: 0.02, capacity: 60, risk: 0.02 },
  { id: "r2", a: "valombre", b: "forge-noire", days: 4, cost: 0.02, capacity: 50, risk: 0.03 },
  { id: "r3", a: "forge-noire", b: "sylvemarche", days: 2, cost: 0.02, capacity: 50, risk: 0.02 },
  { id: "r4", a: "sylvemarche", b: "port-brume", days: 5, cost: 0.025, capacity: 40, risk: 0.05 }
];

const FACTIONS = [
  { id: "compagnie-mers", name: L("Compagnie des Mers", "Sea Company"), kind: "company", region: "port-brume", goods: ["poisson", "sel", "epices"], treasury: 350000, shares: 1000, dividend: 2 },
  { id: "guilde-forgerons", name: L("Guilde des Forgerons", "Smiths' Guild"), kind: "guild", region: "forge-noire", goods: ["fer"], treasury: 70000, shares: 1000, dividend: 3 },
  { id: "confrerie-grain", name: L("Confrérie du Grain", "Grain Brotherhood"), kind: "guild", region: "valombre", goods: ["ble", "vin", "laine"], treasury: 300000, shares: 1000, dividend: 2 },
  { id: "banque-lys", name: L("Banque de Lys", "Lily Bank"), kind: "bank", region: "valombre", goods: [], treasury: 500000, shares: 1000, dividend: 1.5, loanRate: 5, loanPeriodDays: 30, loanMax: 50000 }
];

/** Modèles d'événements que le MJ peut déclencher (région et bien choisis au déclenchement). */
export const EVENT_TEMPLATES = [
  { id: "famine", name: L("Famine", "Famine"), icon: "fa-wheat-awn-circle-exclamation", good: "ble", production: 0.35, days: 20, sentiment: -1 },
  { id: "guerre", name: L("Guerre", "War"), icon: "fa-shield-halved", block: true, consumption: 1.2, price: 1.15, days: 30, sentiment: -3 },
  { id: "peste", name: L("Peste", "Plague"), icon: "fa-skull-crossbones", production: 0.6, consumption: 0.7, days: 25, sentiment: -2 },
  { id: "ruee", name: L("Ruée minière", "Mining rush"), icon: "fa-gem", good: "fer", production: 1.8, days: 20, sentiment: 2 },
  { id: "festival", name: L("Grand festival", "Great festival"), icon: "fa-champagne-glasses", good: "vin", consumption: 2.5, days: 5, sentiment: 1 },
  { id: "tempete", name: L("Tempêtes", "Storms"), icon: "fa-cloud-bolt", block: true, good: "poisson", production: 0.3, days: 7, sentiment: -1 },
  { id: "abondance", name: L("Récolte abondante", "Bumper harvest"), icon: "fa-seedling", good: "ble", production: 1.7, days: 15, sentiment: 1 },
  { id: "embargo", name: L("Embargo", "Embargo"), icon: "fa-ban", block: true, days: 15, sentiment: -2 }
];

const pick = (v, lang) => (v && typeof v === "object" && "fr" in v ? (lang === "fr" ? v.fr : v.en) : v);

/** Monde de départ dans la langue demandée, stocks déjà au niveau « normal ». */
export function presetWorld(lang = "fr", system = null) {
  const localize = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, pick(v, lang)]));
  const regions = REGIONS.map((r) => {
    const stock = {};
    for (const g of GOODS) stock[g.id] = Math.round(Math.max(r.consumption[g.id] ?? 0, (r.production[g.id] ?? 0) * 0.5) * 10);
    return { ...localize(r), system, stock, modifiers: {} };
  });
  return {
    day: 0,
    lastTick: null,
    auto: true,
    goods: GOODS.map(localize),
    regions,
    routes: ROUTES.map((r) => ({ ...r, open: true })),
    factions: FACTIONS.map((f) => {
      const o = localize(f);
      return { ...o, price: o.treasury / o.shares, sentiment: 1, holders: {} };
    }),
    events: [],
    history: {}
  };
}

export function eventTemplates(lang = "fr") {
  return EVENT_TEMPLATES.map((e) => ({ ...e, name: pick(e.name, lang) }));
}
