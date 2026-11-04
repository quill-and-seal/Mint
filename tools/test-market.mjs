// Tests du moteur économique (sans Foundry) : node --test tools/test-market.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  tick, rng, regionPrice, supplyFactor, stockTarget, eventEffects, routeBlocked, priceIndex,
  shareTrade, heldShares, bookValue, change, key
} from "../scripts/core/market.js";
import { presetWorld, eventTemplates } from "../scripts/core/world-preset.js";

const run = (world, days, seed = 1) => {
  const random = rng(seed);
  let w = world;
  const all = [];
  for (let i = 0; i < days; i++) {
    const r = tick(w, { random });
    w = r.world;
    all.push(r);
  }
  return { world: w, results: all };
};

test("prix selon le stock", () => {
  assert.equal(supplyFactor(10, 10), 1);
  assert.ok(supplyFactor(0, 100) > 3, "stock vide : cher");
  assert.ok(supplyFactor(1000, 100) < 0.5, "stock plein : bon marché");
  assert.equal(supplyFactor(0, 1e9), 4, "plafond");
  assert.equal(supplyFactor(1e9, 1), 0.3, "plancher");
  const region = { consumption: { ble: 5 }, production: { ble: 40 } };
  assert.equal(stockTarget(region, "ble"), 200, "la moitié de la production l'emporte");
});

test("prix d'une région : taxe, modificateur, événement", () => {
  const w = presetWorld("fr");
  const r = w.regions.find((x) => x.id === "valombre");
  r.stock.ble = stockTarget(r, "ble");
  const base = regionPrice(w, "valombre", "ble");
  assert.ok(Math.abs(base - 20 * 1.03) < 0.5, `prix normal ≈ base × taxe (${base})`);
  r.modifiers.ble = 1.5;
  assert.ok(Math.abs(regionPrice(w, "valombre", "ble") - base * 1.5) < 0.01);
  w.events.push({ id: "e", region: "valombre", good: "ble", price: 2, start: 0, days: 5 });
  assert.ok(Math.abs(regionPrice(w, "valombre", "ble") - base * 3) < 0.01);
});

test("effets et fin des événements", () => {
  const events = [
    { region: null, good: "ble", production: 0.5, start: 0, days: 3 },
    { region: "a", good: null, consumption: 2, start: 0, days: 0 }
  ];
  assert.deepEqual(eventEffects(events, "a", "ble", 1), { production: 0.5, consumption: 2, price: 1 });
  assert.deepEqual(eventEffects(events, "b", "ble", 5), { production: 1, consumption: 1, price: 1 }, "expiré");
  const w = presetWorld("fr");
  w.events.push({ id: "x", name: "x", production: 1, start: 1, days: 2 });
  const out = run(w, 4).world;
  assert.equal(out.events.length, 0, "événement retiré à sa fin");
});

test("blocus et routes fermées", () => {
  const route = { a: "a", b: "b", open: true };
  assert.equal(routeBlocked(route, [], 1), false);
  assert.equal(routeBlocked({ ...route, open: false }, [], 1), true);
  assert.equal(routeBlocked(route, [{ block: true, region: "b", start: 0, days: 5 }], 1), true);
  assert.equal(routeBlocked(route, [{ block: true, region: "c", start: 0, days: 5 }], 1), false);
});

test("le commerce rapproche les prix entre régions", () => {
  const w = presetWorld("fr");
  // Sans routes, l'écart de prix du blé entre producteur et consommateur reste énorme
  const isolated = run({ ...structuredClone(w), routes: [] }, 40).world;
  const linked = run(structuredClone(w), 40).world;
  const gap = (x) => regionPrice(x, "port-brume", "ble") / regionPrice(x, "valombre", "ble");
  assert.ok(gap(isolated) > 2, `écart sans commerce : ${gap(isolated).toFixed(2)}`);
  assert.ok(gap(linked) < gap(isolated) * 0.7, `le commerce réduit l'écart (${gap(linked).toFixed(2)} contre ${gap(isolated).toFixed(2)})`);
  const { results } = run(structuredClone(w), 5);
  assert.ok(results.some((r) => r.trades.some((t) => t.good === "ble" && t.from === "valombre")), "Valombre exporte du blé");
});

test("une famine fait monter les prix et baisser la prospérité", () => {
  const w = run(presetWorld("fr"), 20, 3).world;
  const before = regionPrice(w, "valombre", "ble");
  const famine = eventTemplates("fr").find((e) => e.id === "famine");
  w.events.push({ ...famine, id: "f1", region: null, start: w.day + 1, days: 40 });
  const after = run(w, 35, 3).world;
  assert.ok(regionPrice(after, "valombre", "ble") > before * 1.3, "blé plus cher après la famine");
  const ref = run(run(presetWorld("fr"), 20, 3).world, 35, 3).world;
  const total = (x) => x.regions.reduce((s, r) => s + r.prosperity, 0);
  assert.ok(total(after) < total(ref) - 0.03, `la pénurie fait baisser la prospérité (${total(after).toFixed(3)} contre ${total(ref).toFixed(3)})`);
});

test("stocks bornés par les pertes", () => {
  const w = presetWorld("fr");
  w.routes = [];
  const out = run(w, 200).world;
  const fish = out.regions.find((r) => r.id === "port-brume").stock.poisson;
  assert.ok(fish < 40 / 0.08 * 1.2, `le poisson se gâte, le stock plafonne (${fish})`);
  for (const r of out.regions) for (const v of Object.values(r.stock)) assert.ok(v >= 0, "jamais de stock négatif");
});

test("factions : trésorerie, cours, dividendes", () => {
  const w = presetWorld("fr");
  const f = w.factions.find((x) => x.id === "guilde-forgerons");
  f.holders = { "Actor.a": { n: 100, cost: 12000 } };
  const { world, results } = run(w, 60, 7);
  const after = world.factions.find((x) => x.id === "guilde-forgerons");
  assert.ok(after.price > 0, "cours positif");
  assert.equal(world.history.factions[f.id].length, 60, "historique des cours");
  const payouts = results.flatMap((r) => r.payouts).filter((p) => p.actor === "Actor.a");
  assert.equal(payouts.length, 2, "dividende tous les 30 jours");
  assert.ok(payouts.every((p) => p.amount > 0));
  // Le cours suit la valeur comptable
  const rich = structuredClone(world);
  rich.factions.find((x) => x.id === f.id).treasury *= 3;
  const richer = run(rich, 30, 9).world.factions.find((x) => x.id === f.id).price;
  const normal = run(structuredClone(world), 30, 9).world.factions.find((x) => x.id === f.id).price;
  assert.ok(richer > normal * 1.8, `trésorerie ×3 → cours bien plus haut (${richer.toFixed(1)} contre ${normal.toFixed(1)})`);
});

test("achat et vente d'actions", () => {
  const f = { price: 100, shares: 1000, treasury: 100000, holders: { a: { n: 10 }, b: { n: 5 } } };
  assert.equal(heldShares(f), 15);
  assert.equal(bookValue(f), 100);
  const buy = shareTrade(f, 10);
  assert.equal(buy.total, 1010, "achat avec 1 % d'écart");
  assert.ok(buy.impact > 0);
  const sell = shareTrade(f, -10);
  assert.equal(sell.total, 990, "vente avec 1 % d'écart");
  assert.ok(sell.impact < 0);
});

test("indices et historique", () => {
  const w = presetWorld("fr");
  for (const r of w.regions) for (const g of w.goods) r.stock[g.id] = stockTarget(r, g.id);
  const idx = priceIndex(w);
  assert.ok(idx > 100 && idx < 106, `indice ≈ 100 + taxes (${idx.toFixed(1)})`);
  const out = run(w, 12).world;
  assert.equal(out.history.index.length, 12);
  assert.equal(out.history.prices[key("valombre", "ble")].length, 12);
  assert.deepEqual(out.history.days.slice(-3), [10, 11, 12]);
  assert.equal(change([100, 110], 7), 10);
  assert.equal(change([50], 7), 0);
});

test("reproductible avec la même graine", () => {
  const a = run(presetWorld("fr"), 30, 42).world;
  const b = run(presetWorld("fr"), 30, 42).world;
  assert.deepEqual(a.history.index, b.history.index);
});

test("le monde reste stable sur un an", () => {
  const out = run(presetWorld("fr"), 365, 5).world;
  for (const r of out.regions) {
    assert.ok(r.prosperity > 0.5 && r.prosperity < 1.6, `${r.id} : prospérité ${r.prosperity}`);
  }
  const idx = out.history.index.at(-1);
  assert.ok(idx > 60 && idx < 250, `indice des prix raisonnable après un an (${idx.toFixed(0)})`);
  for (const f of out.factions) assert.ok(f.treasury > 0 && f.price > 0, `${f.id} solvable`);
});
