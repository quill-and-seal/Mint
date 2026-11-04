// Aperçu des fenêtres de la Bourse hors de Foundry : rejoue le test de fumée (monde simulé),
// puis écrit une page HTML par onglet dans le dossier donné.
// Usage : node tools/preview.mjs <dossier>
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const out = process.argv[2] ?? "preview";
mkdirSync(out, { recursive: true });
const log = console.log;
console.log = () => {};
await import("./smoke.mjs");
console.log = log;

const css = readFileSync(new URL("../styles/mint.css", import.meta.url), "utf8");
const { ExchangeApp, WorldEditor } = globalThis.__mintApps;
const { advanceDays, startEvent } = await import("../scripts/world.js");

// Un peu plus d'histoire pour des courbes parlantes, et un événement en cours
game.user = game.users.find((u) => u.isGM);
await advanceDays(40);
await startEvent("tempete", { region: "port-brume" });
await advanceDays(3);

const page = (title, icon, body, w, h) => `<!doctype html><html lang="fr"><head><meta charset="utf-8">
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.2/css/all.min.css">
<style>${css}</style><style>body{margin:0;padding:20px;background:#1b1d22}.window-header{display:flex;gap:8px;align-items:center;padding:8px 12px;font-size:14px}</style></head>
<body><div class="application mint mint-exchange" style="width:${w}px;height:${h}px;display:flex;flex-direction:column">
<header class="window-header"><i class="window-icon fa-solid ${icon}"></i> ${title}</header>
<section class="window-content" style="flex:1;min-height:0;display:flex;flex-direction:column"><div class="mint-body">${body}</div></section></div></body></html>`;

for (const [user, suffix] of [[game.users.find((u) => u.isGM), "mj"], [game.users.find((u) => u.id === "alice"), "joueur"]]) {
  game.user = user;
  const app = new ExchangeApp();
  app.goodId = "poisson";
  app.regionId = "port-brume";
  for (const tab of suffix === "mj" ? ["markets", "factions", "money", "events"] : ["markets", "factions", "portfolio"]) {
    app.tab = tab;
    writeFileSync(join(out, `bourse-${tab}-${suffix}.html`), page("Bourse", "fa-chart-line", app._html(), 1120, 740));
  }
}
game.user = game.users.find((u) => u.isGM);
const editor = new WorldEditor();
for (const tab of ["regions", "factions"]) {
  editor.tab = tab;
  writeFileSync(join(out, `editeur-${tab}.html`), page("Éditeur du monde", "fa-sliders", editor._html(), 920, 680));
}
console.log(`Aperçus écrits dans ${out}`);
process.exit(0);
