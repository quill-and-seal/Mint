/**
 * Petits graphiques SVG (chaînes HTML) pour la Bourse : courbes, mini-courbes, barres.
 * Les couleurs viennent des classes CSS (styles/mint.css, section « Bourse »).
 */

const f1 = (n) => (Math.round(n * 10) / 10).toString();

function scale(values, w, h, pad = 2) {
  const vals = values.filter((v) => Number.isFinite(v));
  if (vals.length < 2) return null;
  let lo = Math.min(...vals);
  let hi = Math.max(...vals);
  if (hi - lo < 1e-9) {
    lo -= 1;
    hi += 1;
  }
  const x = (i) => pad + (i * (w - pad * 2)) / (vals.length - 1);
  const y = (v) => pad + (1 - (v - lo) / (hi - lo)) * (h - pad * 2);
  return { vals, lo, hi, x, y };
}

/** Sens de la série : "up", "down" ou "flat" (sur toute la série). */
export function trend(values) {
  if (!Array.isArray(values) || values.length < 2) return "flat";
  const a = values[0];
  const b = values[values.length - 1];
  if (Math.abs(b - a) / Math.max(Math.abs(a), 1e-9) < 0.002) return "flat";
  return b > a ? "up" : "down";
}

/** Mini-courbe (dans une ligne de tableau). */
export function sparkline(values, { w = 96, h = 26, label = "" } = {}) {
  const s = scale(values ?? [], w, h);
  if (!s) return `<svg class="mint-spark" width="${w}" height="${h}" aria-hidden="true"></svg>`;
  const pts = s.vals.map((v, i) => `${f1(s.x(i))},${f1(s.y(v))}`);
  const dir = trend(s.vals);
  const last = pts[pts.length - 1].split(",");
  return `<svg class="mint-spark ${dir}" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" ${label ? `role="img" aria-label="${label}"` : 'aria-hidden="true"'}>
    <path class="area" d="M${pts[0]} L${pts.join(" L")} L${f1(s.x(s.vals.length - 1))},${h} L${f1(s.x(0))},${h} Z"></path>
    <path class="line" d="M${pts.join(" L")}"></path>
    <circle class="dot" cx="${last[0]}" cy="${last[1]}" r="2.2"></circle>
  </svg>`;
}

/**
 * Grande courbe avec grille, valeurs min/max et dernier point.
 * fmt : formate une valeur pour les étiquettes.
 */
export function chart(values, { w = 520, h = 180, fmt = (v) => String(Math.round(v)), label = "", days = null } = {}) {
  const padL = 6;
  const padR = 100;
  const s = scale(values ?? [], w - padR, h, 10);
  if (!s) return `<div class="mint-chart-empty">—</div>`;
  const pts = s.vals.map((v, i) => `${f1(s.x(i) + padL)},${f1(s.y(v))}`);
  const dir = trend(s.vals);
  const last = s.vals[s.vals.length - 1];
  const lastY = s.y(last);
  const grid = [0.25, 0.5, 0.75].map((p) => `<line class="grid" x1="${padL}" x2="${w - padR}" y1="${f1(10 + p * (h - 20))}" y2="${f1(10 + p * (h - 20))}"></line>`).join("");
  const firstDay = days?.[0];
  const lastDay = days?.[days.length - 1];
  return `<svg class="mint-chart ${dir}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img" aria-label="${label}">
    ${grid}
    <path class="area" d="M${pts[0]} L${pts.join(" L")} L${f1(s.x(s.vals.length - 1) + padL)},${h} L${f1(s.x(0) + padL)},${h} Z"></path>
    <path class="line" d="M${pts.join(" L")}"></path>
    <line class="last" x1="${padL}" x2="${w - padR + 4}" y1="${f1(lastY)}" y2="${f1(lastY)}"></line>
    <rect class="tag" x="${w - padR + 4}" y="${f1(lastY - 9)}" width="${padR - 6}" height="18" rx="2"></rect>
    <text class="tag-text" x="${w - padR + 8}" y="${f1(lastY + 4)}">${fmt(last)}</text>
    ${Math.abs(lastY - 12) > 16 ? `<text class="axis" x="${w - padR + 8}" y="16">${fmt(s.hi)}</text>` : ""}
    ${Math.abs(lastY - (h - 10)) > 16 ? `<text class="axis" x="${w - padR + 8}" y="${h - 6}">${fmt(s.lo)}</text>` : ""}
    ${firstDay !== undefined ? `<text class="axis" x="${padL}" y="${h - 4}">J${firstDay}</text>` : ""}
    ${lastDay !== undefined ? `<text class="axis end" x="${w - padR - 2}" y="${h - 4}" text-anchor="end">J${lastDay}</text>` : ""}
  </svg>`;
}

/** Barre de jauge (0 à 1, au-delà pour un dépassement). */
export function gauge(ratio, { warn = 0.5, label = "" } = {}) {
  const r = Math.max(0, Number(ratio) || 0);
  const cls = r < warn * 0.5 ? "low" : r < warn ? "mid" : "ok";
  return `<span class="mint-gauge ${cls}" ${label ? `title="${label}"` : ""}><span style="width:${Math.min(100, r * 100).toFixed(0)}%"></span></span>`;
}

/** Variation en % avec flèche (la couleur n'est pas le seul indice). */
export function delta(pct) {
  const v = Number(pct) || 0;
  if (Math.abs(v) < 0.05) return `<span class="mint-delta flat">= 0,0 %</span>`;
  const txt = `${Math.abs(v).toFixed(1).replace(".", ",")} %`;
  return v > 0 ? `<span class="mint-delta up">▲ ${txt}</span>` : `<span class="mint-delta down">▼ ${txt}</span>`;
}
