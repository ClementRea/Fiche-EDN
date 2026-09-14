// Transforme le JSON de l'import en documents `db` prêts à écrire :
// un document par notion, un par schéma (image en data-URI), plus la méta.
import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const fiche = JSON.parse(readFileSync("data/fiche.json", "utf8"));
const OUT = "data/seed";
rmSync(OUT, { recursive: true, force: true });
mkdirSync(join(OUT, "notions"), { recursive: true });
mkdirSync(join(OUT, "images"), { recursive: true });

const now = new Date().toISOString();
const ids = [];

fiche.notions.forEach((n, i) => {
  const id = "n" + String(i + 1).padStart(3, "0");
  ids.push(id);
  writeFileSync(join(OUT, "notions", id + ".json"), JSON.stringify({
    spec: n.spec,
    title: n.title,
    item: "",
    ai: false,            // contenu d'origine : jamais marqué « IA »
    blocks: n.blocks,
    order: i,
    createdAt: now,
    updatedAt: now,
  }, null, 1));
});

const manifest = JSON.parse(readFileSync("data/images/manifest.json", "utf8"));
const images = [];
for (const m of manifest) {
  const b64 = readFileSync(join("data/images", m.file)).toString("base64");
  const doc = { dataUrl: "data:image/jpeg;base64," + b64, page: m.page };
  const bytes = Buffer.byteLength(JSON.stringify(doc));
  if (bytes > 250 * 1024) throw new Error(`${m.id} dépasse le plafond d'un document : ${bytes} octets`);
  writeFileSync(join(OUT, "images", m.id + ".json"), JSON.stringify(doc));
  images.push({ id: m.id, bytes });
}

writeFileSync(join(OUT, "meta.json"), JSON.stringify({
  specOrder: fiche.specs,
  importedAt: now,
  schemaVersion: 1,
  source: "fiche_erreurs.pdf — 28 pages, import déterministe vérifié",
}, null, 1));

const biggest = Math.max(...images.map(i => i.bytes));
console.log(`notions : ${ids.length}`);
console.log(`schémas : ${images.length} (le plus lourd : ${(biggest / 1024).toFixed(0)} Kio sur 256 autorisés)`);
console.log(`spécialités : ${fiche.specs.length}`);
