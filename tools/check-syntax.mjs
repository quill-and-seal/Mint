// Vérifications sans Foundry : syntaxe des scripts, clés de traduction, manifeste.
// Usage : node tools/check-syntax.mjs
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const root = new URL("..", import.meta.url).pathname;
let failed = false;
const fail = (msg) => {
  failed = true;
  console.error("✗", msg);
};

const walk = (dir) =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith(".js") ? [p] : [];
  });
const files = walk(join(root, "scripts"));

// 1. Syntaxe
for (const f of files) {
  try {
    execFileSync(process.execPath, ["--check", f], { stdio: "pipe" });
  } catch (err) {
    fail(`syntaxe : ${f}\n${err.stderr}`);
  }
}

// 2. Imports : chaque nom importé existe dans le module cible
for (const f of files) {
  const src = readFileSync(f, "utf8");
  for (const m of src.matchAll(/import\s*\{([^}]+)\}\s*from\s*"(\.[^"]+)"/g)) {
    const target = join(f, "..", m[2]);
    let tsrc;
    try {
      tsrc = readFileSync(target, "utf8");
    } catch {
      fail(`${f} : module introuvable ${m[2]}`);
      continue;
    }
    for (const raw of m[1].split(",")) {
      const name = raw.trim().split(/\s+as\s+/)[0];
      if (!name) continue;
      const exported =
        new RegExp(`export\\s+(async\\s+)?(function|class|const|let)\\s+${name}\\b`).test(tsrc) ||
        new RegExp(`export\\s*\\{[^}]*\\b${name}\\b[^}]*\\}`).test(tsrc);
      if (!exported) fail(`${f} : « ${name} » n'est pas exporté par ${m[2]}`);
    }
  }
}

// 3. Traductions
const flatten = (obj, prefix = "") =>
  Object.entries(obj).flatMap(([k, v]) => (typeof v === "object" ? flatten(v, `${prefix}${k}.`) : [`${prefix}${k}`]));
const fr = new Set(flatten(JSON.parse(readFileSync(join(root, "lang/fr.json"), "utf8"))));
const en = new Set(flatten(JSON.parse(readFileSync(join(root, "lang/en.json"), "utf8"))));
for (const k of fr) if (!en.has(k)) fail(`clé absente de en.json : ${k}`);
for (const k of en) if (!fr.has(k)) fail(`clé absente de fr.json : ${k}`);

const used = new Set();
const prefixes = "Common|Controls|Settings|Preset|Wallet|Shop|Editor|Ledger|Currencies|Chat|Notify|Error|History|Haggle|Pot";
for (const f of files) {
  const src = readFileSync(f, "utf8");
  for (const m of src.matchAll(new RegExp(`"(?:MINT\\.)?((?:${prefixes})\\.[A-Za-z.]+)"`, "g"))) used.add(`MINT.${m[1]}`);
  for (const m of src.matchAll(/MintError\("([A-Za-z]+)"/g)) used.add(`MINT.Error.${m[1]}`);
}
for (const k of used) if (!fr.has(k)) fail(`clé utilisée mais non traduite : ${k}`);
// Clés dynamiques
for (const k of ["active", "proposed", "closed"]) {
  for (const p of ["MINT.Ledger.Tab.", "MINT.Ledger.Empty."]) if (!fr.has(p + k)) fail(`clé dynamique absente : ${p + k}`);
}
const dynamic = [
  ...["shop", "items", "customers"].map((k) => `MINT.Editor.Tab.${k}`),
  ...["unlimited", "fixed", "merchant"].map((k) => `MINT.Editor.Till.${k}`),
  ...["Success", "Offended", "Nothing"].map((k) => `MINT.Haggle.${k}`),
  ...["ChatLog", "HistorySize", "MerchantDoubleClick", "MerchantRange", "HaggleFormula", "DueReminderDays", "OtiumHistory"].flatMap(
    (k) => [`MINT.Settings.${k}.Name`, `MINT.Settings.${k}.Hint`]
  )
];
for (const k of dynamic) if (!fr.has(k)) fail(`clé dynamique absente : ${k}`);
for (const r of ["repaid", "forgiven", "cancelled", "refused", "withdrawn"]) {
  if (!fr.has(`MINT.Ledger.Closed.${r}`)) fail(`clé dynamique absente : MINT.Ledger.Closed.${r}`);
}

// 4. Manifeste
const manifest = JSON.parse(readFileSync(join(root, "module.json"), "utf8"));
for (const p of [...manifest.esmodules, ...manifest.styles, ...manifest.languages.map((l) => l.path)]) {
  try {
    statSync(join(root, p));
  } catch {
    fail(`module.json référence un fichier absent : ${p}`);
  }
}
if (!manifest.socket) fail("module.json : socket doit être true");

console.log(failed ? "Des vérifications ont échoué." : `OK — ${files.length} scripts, ${fr.size} clés de traduction.`);
process.exit(failed ? 1 : 0);
