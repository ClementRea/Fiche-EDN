// Localise les schémas du PDF (page + position) et les redimensionne pour
// tenir dans un document `db` (256 KiB, base64 compris).
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, isAbsolute } from "node:path";

const PDF = process.argv[2];
const OUT = process.argv[3] || "data/images";
const WORK = process.argv[4] || "/tmp/fiche-img";

const PAGE_H_PT = 841.92;   // A4
const MIN_SIDE = 60;        // en deçà : pictogramme décoratif, pas un schéma
const MAX_W = 1100;         // largeur de rendu suffisante pour un algorithme
const MAX_BYTES = 150 * 1024; // marge sous le plafond de 256 KiB une fois en base64

mkdirSync(WORK, { recursive: true });
mkdirSync(OUT, { recursive: true });

execFileSync("pdftohtml", ["-xml", PDF, join(WORK, "out.xml")], { stdio: "ignore" });
const xml = readFileSync(join(WORK, "out.xml"), "utf8");

const images = [];
let page = 0, pageH = 1262;
for (const m of xml.matchAll(/<page number="(\d+)"[^>]*height="(\d+)"|<image ([^>]*)\/>/g)) {
  if (m[1]) { page = +m[1]; pageH = +m[2]; continue; }
  const at = n => { const r = m[3].match(new RegExp(n + '="([^"]*)"')); return r ? r[1] : null; };
  const w = +at("width"), h = +at("height");
  if (w < MIN_SIDE || h < MIN_SIDE) continue;   // ⚠️ décoratif
  const scale = PAGE_H_PT / pageH;
  images.push({
    page, src: at("src"),
    yTop: +(+at("top") * scale).toFixed(1),
    yBottom: +((+at("top") + h) * scale).toFixed(1),
  });
}

const manifest = [];
images.forEach((im, i) => {
  const id = `schema-${String(i + 1).padStart(2, "0")}`;
  const src = im.src.startsWith("/") ? im.src : join(WORK, im.src);
  let quality = 82, out = join(OUT, id + ".jpg"), bytes = Infinity;
  while (quality >= 40) {
    execFileSync("convert", [src, "-resize", `${MAX_W}x>`, "-background", "white",
      "-alpha", "remove", "-alpha", "off", "-quality", String(quality), out]);
    bytes = readFileSync(out).length;
    if (bytes <= MAX_BYTES) break;
    quality -= 10;
  }
  manifest.push({ id, page: im.page, yTop: im.yTop, yBottom: im.yBottom, file: id + ".jpg", bytes });
});

writeFileSync(join(OUT, "manifest.json"), JSON.stringify(manifest, null, 2));
console.log(`schémas retenus : ${manifest.length}`);
for (const m of manifest) console.log(`  ${m.file}  p${String(m.page).padStart(2)}  y=${m.yTop}  ${(m.bytes/1024).toFixed(0)} Kio`);
