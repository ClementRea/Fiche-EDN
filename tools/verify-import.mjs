// Vérifie que le parse n'a rien perdu : tout mot du PDF doit se retrouver
// dans le JSON, et réciproquement. C'est la garantie du transfert verbatim.
import { readFileSync } from "node:fs";
import { extractLines } from "./lines.mjs";

const norm = s => s
  .replace(/[   ]/g, " ")
  .replace(/['']/g, "'")
  .toLowerCase();

const words = s => norm(s).match(/[\p{L}\p{N}][\p{L}\p{N}'.,%°µ\-\/]*/gu) || [];

const bag = arr => {
  const m = new Map();
  for (const w of arr) m.set(w, (m.get(w) || 0) + 1);
  return m;
};

function textOfBlocks(blocks) {
  const out = [];
  for (const b of blocks) {
    if (b.type === "text" || b.type === "mnemo" || b.type === "schema") out.push(b.text || "");
    else if (b.type === "list") out.push(...b.items);
    else if (b.type === "table") { out.push(...b.head); for (const r of b.rows) out.push(...r); }
  }
  return out.join(" ");
}

const fiche = JSON.parse(readFileSync(process.argv[2] || "data/fiche.json", "utf8"));

const jsonWords = [];
for (const s of fiche.specs) jsonWords.push(...words(s));
for (const n of fiche.notions) {
  jsonWords.push(...words(n.title));
  jsonWords.push(...words(textOfBlocks(n.blocks)));
}

// Les en-têtes de tableau répétés à chaque saut de page ne sont comptés
// qu'une fois côté JSON : on les neutralise des deux côtés.
const HEADER = /^(notion clé|ce qu'il faut retenir)$/i;
const pdfLines = extractLines().filter(l => !HEADER.test(l.text.trim()));
const pdfWords = [];
for (const l of pdfLines) pdfWords.push(...words(l.text));

const a = bag(pdfWords), b = bag(jsonWords);
const missing = [], extra = [];
for (const [w, n] of a) { const d = n - (b.get(w) || 0); if (d > 0) missing.push([w, d]); }
for (const [w, n] of b) { const d = n - (a.get(w) || 0); if (d > 0) extra.push([w, d]); }

// Les seules omissions voulues : l'en-tête du document, et la mention
// « (moyen mnémotechnique …) » sortie des titres pour devenir un bloc mnemo.
const DELIBERATE = new Map([
  ...words("Fiche erreurs — EDN").map(w => [w, 1]),
  ...words("Points à ne pas refaire, complétés au fil des révisions.").map(w => [w, 1]),
]);
for (const line of fiche.dropped || []) {
  for (const w of words(line)) DELIBERATE.set(w, (DELIBERATE.get(w) || 0) + 1);
}
const mnemoCount = fiche.notions.reduce(
  (n, x) => n + x.blocks.filter(b => b.type === "mnemo").length, 0);
DELIBERATE.set("moyen", (DELIBERATE.get("moyen") || 0) + mnemoCount);
DELIBERATE.set("mnémotechnique", (DELIBERATE.get("mnémotechnique") || 0) + mnemoCount);

const unexplained = missing
  .map(([w, n]) => [w, n - (DELIBERATE.get(w) || 0)])
  .filter(([, n]) => n > 0);

const sum = l => l.reduce((s, [, n]) => s + n, 0);
console.log(`mots dans le PDF  : ${pdfWords.length}`);
console.log(`mots dans le JSON : ${jsonWords.length}`);
console.log(`manquants         : ${sum(missing)} (${missing.length} formes)`);
console.log(`en trop           : ${sum(extra)} (${extra.length} formes)`);
console.log(`  dont omissions voulues : ${sum(missing) - sum(unexplained)}`);
console.log(`    · en-têtes de tableau réimprimés : ${(fiche.dropped || []).length} lignes`);
console.log(`  PERTES INEXPLIQUÉES    : ${sum(unexplained)}`);
if (unexplained.length) {
  console.log("\n— mots perdus —");
  unexplained.sort((x, y) => y[1] - x[1]).slice(0, 40).forEach(([w, n]) => console.log(`  ×${n}  ${w}`));
}
if (extra.length) {
  console.log("\n— échantillon de mots ajoutés —");
  extra.sort((x, y) => y[1] - x[1]).slice(0, 15).forEach(([w, n]) => console.log(`  ×${n}  ${w}`));
}
const ok = sum(unexplained) === 0 && sum(extra) === 0;
console.log(ok
  ? "\n✓ import verbatim : aucun mot perdu, aucun mot inventé."
  : "\n✗ l'import n'est pas fidèle.");
process.exit(ok ? 0 : 1);
