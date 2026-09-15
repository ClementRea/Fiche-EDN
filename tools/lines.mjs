// Extract every text line from pdftotext -bbox-layout output, with geometry.
import { readFileSync } from "node:fs";

export const BBOX = process.env.FICHE_BBOX || "data/fiche.bbox.html";

const ENT = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'", "&#39;": "'" };
const unesc = s => s.replace(/&(?:amp|lt|gt|quot|apos|#39);/g, m => ENT[m]);

export function extractLines(src) {
  if (src === undefined) src = readFileSync(BBOX, "utf8");
  const lines = [];
  const pages = src.split(/<page\b/).slice(1);
  pages.forEach((pageSrc, pageIdx) => {
    for (const lm of pageSrc.matchAll(/<line\b([^>]*)>([\s\S]*?)<\/line>/g)) {
      const at = n => parseFloat((lm[1].match(new RegExp(n + '="([\\d.]+)"')) || [])[1]);
      const words = [];
      for (const wm of lm[2].matchAll(/<word\b([^>]*)>([\s\S]*?)<\/word>/g)) {
        const wa = n => parseFloat((wm[1].match(new RegExp(n + '="([\\d.]+)"')) || [])[1]);
        words.push({ x: wa("xMin"), xMax: wa("xMax"), text: unesc(wm[2]) });
      }
      if (!words.length) continue;
      lines.push({
        page: pageIdx + 1,
        x: at("xMin"), xMax: at("xMax"), y: at("yMin"), yMax: at("yMax"),
        h: +(at("yMax") - at("yMin")).toFixed(2),
        text: words.map(w => w.text).join(" "),
        words,
      });
    }
  });
  // document order within a page is not guaranteed to be top-down across flows
  lines.sort((a, b) => a.page - b.page || a.y - b.y || a.x - b.x);
  return lines;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const lines = extractLines();
  const hist = {};
  for (const l of lines) hist[l.h] = (hist[l.h] || 0) + 1;
  console.log("lignes:", lines.length);
  console.log("\n=== hauteurs de ligne (= niveaux de titre) ===");
  Object.entries(hist).sort((a, b) => b[1] - a[1]).slice(0, 12)
    .forEach(([h, n]) => console.log(`  h=${h}  ×${n}`));
  const xh = {};
  for (const l of lines) { const b = Math.round(l.x / 5) * 5; xh[b] = (xh[b] || 0) + 1; }
  console.log("\n=== xMin regroupés par 5pt (= colonnes) ===");
  Object.entries(xh).sort((a, b) => b[1] - a[1]).slice(0, 14)
    .forEach(([x, n]) => console.log(`  x≈${x}  ×${n}`));
}
