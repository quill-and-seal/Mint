// Tests du cœur de Mint (sans Foundry) : node --test tools/
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  sortedDenoms, walletValue, breakdown, formatValue, parseAmount, pay, addCoins, removeCoins, exchangeValue
} from "../scripts/core/money.js";
import { unitPrice, buyTotal, sellTotal, restockStock, priceFactor, customerFactors, haggleOutcome } from "../scripts/core/pricing.js";
import { amountOwed, periodsElapsed, isOverdue, lateFee, daysUntilDue, dueTime } from "../scripts/core/interest.js";

const currencies = [
  { id: "pc", system: "s", abbr: "pc", name: "Cuivre", value: 1 },
  { id: "pa", system: "s", abbr: "pa", name: "Argent", value: 10 },
  { id: "pe", system: "s", abbr: "pe", name: "Électrum", value: 50 },
  { id: "po", system: "s", abbr: "po", name: "Or", value: 100 },
  { id: "pp", system: "s", abbr: "pp", name: "Platine", value: 1000 },
  { id: "cr", system: "x", abbr: "cr", name: "Crédit", value: 1 }
];
const D = sortedDenoms(currencies, "s");

test("tri et valeur", () => {
  assert.deepEqual(D.map((d) => d.id), ["pp", "po", "pe", "pa", "pc"]);
  assert.equal(walletValue({ po: 2, pa: 3, pc: 4, cr: 99 }, D), 234);
});

test("décomposition et affichage", () => {
  assert.deepEqual(breakdown(1263, D).coins, { pp: 1, po: 2, pe: 1, pa: 1, pc: 3 });
  assert.equal(formatValue(250, D), "2 po 1 pe");
  assert.equal(formatValue(0, D), "0 pc");
});

test("lecture des montants", () => {
  assert.equal(parseAmount("2 po 5 pa", D, "po"), 250);
  assert.equal(parseAmount("2po5pa", D, "po"), 250);
  assert.equal(parseAmount("1,5", D, "po"), 150);
  assert.equal(parseAmount("12 pc", D, "po"), 12);
  assert.equal(parseAmount("", D, "po"), 0);
  assert.equal(parseAmount("3 zz", D, "po"), null);
  assert.equal(parseAmount("abc", D, "po"), null);
  assert.equal(parseAmount("2 Or", D, "po"), 200);
});

test("paiement exact", () => {
  const r = pay({ po: 3, pa: 5 }, D, 250);
  assert.deepEqual(r.paid, { po: 2, pa: 5 });
  assert.equal(r.wallet.po, 1);
  assert.equal(r.wallet.pa, 0);
  assert.deepEqual(r.change, {});
});

test("paiement avec monnaie rendue", () => {
  const r = pay({ po: 1 }, D, 37);
  assert.deepEqual(r.paid, { po: 1 });
  assert.deepEqual(r.change, { pe: 1, pa: 1, pc: 3 });
  assert.equal(walletValue(r.wallet, D), 63);
});

test("paiement impossible", () => {
  assert.equal(pay({ pa: 3 }, D, 31), null);
});

test("paiement : la valeur est toujours conservée", () => {
  for (let i = 0; i < 2000; i++) {
    const w = Object.fromEntries(D.map((d) => [d.id, Math.floor(Math.random() * 6)]));
    const total = walletValue(w, D);
    const cost = Math.floor(Math.random() * (total + 50));
    const r = pay(w, D, cost);
    if (cost > total) assert.equal(r, null);
    else {
      assert.ok(r, `paiement ${cost} sur ${total}`);
      assert.equal(walletValue(r.wallet, D), total - cost);
      for (const d of D) assert.ok(r.wallet[d.id] >= 0);
    }
  }
});

test("ajout et retrait de pièces", () => {
  assert.deepEqual(addCoins({ po: 1 }, { po: 2, pa: 1 }), { po: 3, pa: 1 });
  assert.equal(removeCoins({ po: 1 }, { po: 2 }), null);
  assert.deepEqual(removeCoins({ po: 3 }, { po: 2 }), { po: 1 });
});

test("change entre systèmes", () => {
  assert.equal(exchangeValue(100, 1, 10, 0), 10);
  assert.equal(exchangeValue(100, 1, 10, 0.1), 9);
  assert.equal(exchangeValue(3, 0.1, 0.1, 0), 3);
});

test("prix dynamiques", () => {
  const shop = { elasticity: 0.5, minFactor: 0.5, maxFactor: 3, markup: 0, sellRatio: 0.5 };
  const item = { price: 100, stock: 10, target: 10 };
  assert.equal(unitPrice(item, shop), 100);
  assert.equal(unitPrice({ ...item, stock: 0 }, shop), 150);
  assert.equal(unitPrice({ ...item, stock: 20 }, shop), 50);
  assert.equal(unitPrice({ ...item, stock: null }, shop), 100);
  assert.equal(unitPrice({ ...item, modifier: 1.2 }, { ...shop, markup: 0.1 }), 132);
  assert.equal(priceFactor(-100, 10, 0.5, 0.5, 3), 3);
  // Acheter 2 : 100 (stock 10) + 105 (stock 9)
  assert.equal(buyTotal(item, shop, 2), 205);
  // Revendre 1 : prix au stock 11 = 95, × 0,5
  assert.equal(sellTotal(item, shop, 1), 47);
  assert.equal(buyTotal({ price: 10, stock: null }, shop, 3), 30);
});

test("réassort", () => {
  assert.equal(restockStock({ stock: 2, target: 10, restock: 3 }, 2), 8);
  assert.equal(restockStock({ stock: 2, target: 10, restock: 3 }, 5), 10);
  assert.equal(restockStock({ stock: 15, target: 10, restock: 2 }, 1), 13);
  assert.equal(restockStock({ stock: null, target: 10, restock: 2 }, 1), null);
});

test("intérêts", () => {
  const day = 86400;
  const debt = { principal: 1000, rate: 10, periodDays: 7, start: 0, repaid: 0 };
  assert.equal(periodsElapsed(0, 6 * day, 7 * day), 0);
  assert.equal(amountOwed(debt, 6 * day), 1000);
  assert.equal(amountOwed(debt, 7 * day), 1100);
  assert.equal(amountOwed(debt, 15 * day), 1200);
  assert.equal(amountOwed({ ...debt, repaid: 500 }, 15 * day), 700);
  assert.equal(amountOwed({ ...debt, rate: 0 }, 100 * day), 1000);
  assert.equal(amountOwed({ ...debt, repaid: 5000 }, 0), 0);
});

test("réputation et marchandage", () => {
  const shop = { elasticity: 0.5, minFactor: 0.5, maxFactor: 3, markup: 0, sellRatio: 0.5 };
  const item = { price: 100, stock: 10, target: 10 };
  const f = customerFactors([-10, -5]);
  assert.equal(f.pct, -15);
  assert.equal(f.buy, 0.85);
  assert.equal(f.sell, 1.15);
  assert.equal(unitPrice(item, shop, 10, f.buy), 85);
  assert.equal(buyTotal(item, shop, 2, f.buy), 85 + 89);
  assert.equal(sellTotal(item, shop, 1, f.sell), 54); // 95 × 1,15 × 0,5 = 54,6
  assert.equal(customerFactors([500]).buy, 3);
  assert.equal(haggleOutcome(15, 15), -5);
  assert.equal(haggleOutcome(22, 15), -12);
  assert.equal(haggleOutcome(40, 15), -20);
  assert.equal(haggleOutcome(12, 15), 0);
  assert.equal(haggleOutcome(10, 15), 10);
  assert.equal(haggleOutcome(30, 15, { maxDiscount: 8 }), -8);
});

test("échéances et retards", () => {
  const day = 86400;
  const debt = { principal: 1000, rate: 0, periodDays: 7, start: 0, repaid: 0, dueDays: 10, lateFee: 5 };
  assert.equal(dueTime(debt), 10 * day);
  assert.equal(isOverdue(debt, 10 * day), false);
  assert.equal(isOverdue(debt, 10 * day + 1), true);
  assert.equal(lateFee(debt, 11 * day), 50);
  assert.equal(amountOwed(debt, 9 * day), 1000);
  assert.equal(amountOwed(debt, 11 * day), 1050);
  assert.equal(daysUntilDue(debt, 7 * day), 3);
  assert.equal(daysUntilDue(debt, 12 * day), -2);
  assert.equal(daysUntilDue({ ...debt, dueDays: 0 }, 0), null);
});
