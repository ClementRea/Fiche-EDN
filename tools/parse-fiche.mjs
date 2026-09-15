// Parse la fiche PDF existante en JSON structuré — sans IA, sans reformulation.
// Le contenu médical est transféré verbatim : ce script ne fait que retrouver,
// à partir des coordonnées, la structure « spécialité → notion → blocs » que
// le PDF ne porte plus.
import { writeFileSync } from "node:fs";
import { readFileSync, existsSync } from "node:fs";
import { extractLines } from "./lines.mjs";

// -- géométrie mesurée sur le document (voir docs/import.md) -----------------
const H_SPEC = 16;      // hauteur de ligne d'un titre de spécialité
const H_SUB = 12.5;     // hauteur de ligne d'un titre de tableau autonome
const X_CELL = 72.4;    // les cellules commencent à 72.72, les titres à 72.0
const ROW_GAP = 11.75;  // écart continuation (≤11.5) / nouvelle ligne (≥12.0)
const COL_TOL = 12;     // tolérance d'alignement d'une colonne
const PAGE_TOP = 160;   // au-delà, une ligne n'est plus en tête de page
const SPACE_W = 3.5;    // largeur d'une espace, mesurée sur le document

// Les en-têtes de tableau réimprimés à chaque page sont retirés : on les
// consigne pour que la vérification les déclare au lieu de les ignorer.
let dropped = [];

// x d'abord, hauteur ensuite : des guillemets « » suffisent à gonfler la
// hauteur d'une ligne de cellule au-delà d'un titre, mais jamais son xMin.
const kindOf = l =>
  l.x >= X_CELL ? "cell" : l.h >= H_SPEC ? "spec" : "para";

// Les en-têtes du tableau à deux colonnes, répétés à chaque saut de page.
const HEADER_CELL = /^(notion\s+clé|ce qu'il faut retenir)$/i;
const isHeaderRow = cells =>
  /^notion\s+clé$/i.test((cells[0] || "").trim()) ||
  /^ce qu'il faut retenir$/i.test((cells[1] || "").trim());

/** Regroupe des lignes en colonnes d'après leur xMin. */
function columnsOf(lines) {
  const xs = [...new Set(lines.map(l => Math.round(l.x)))].sort((a, b) => a - b);
  const cols = [];
  for (const x of xs) {
    if (!cols.length || x - cols[cols.length - 1] > COL_TOL) cols.push(x);
  }
  return cols;
}

// Colonnes alignées à gauche : un mot appartient à la dernière colonne qui
// commence avant lui, jamais à la plus proche — un mot long déborde sur la
// colonne suivante sans lui appartenir.
const colIndex = (cols, x) => {
  let best = 0;
  for (let i = 0; i < cols.length; i++) if (x >= cols[i] - COL_TOL) best = i;
  return best;
};

const BULLET = /^[-\u2013\u2014\u2022\u00b7]\s+/;

/** Reconstitue les paragraphes d'une cellule : ≤11.75 = suite, > = nouveau. */
function paragraphsOf(lines, rightEdge) {
  const out = [];
  let cur = null, prevY = null, prevPage = null, prevXMax = null;
  for (const l of lines) {
    // Un saut de page remet y à zéro : l'écart vertical n'y veut plus rien
    // dire. Une puce ouvre alors un paragraphe, le reste poursuit le précédent.
    const crossesPage = prevPage !== null && l.page !== prevPage;
    // Une puce ouvre toujours un paragraphe : dans une liste serrée les puces
    // sont espacées comme un simple repli de ligne, l'écart ne les sépare pas.
    const t = l.text.trim();
    const starts = BULLET.test(t) || /^\d+[.)]\s/.test(t);
    // Une ligne repliée occupe toute la largeur de sa colonne. Si la
    // précédente s'arrêtait nettement avant le bord, c'est que le retour à
    // la ligne était voulu : la suivante ouvre une entrée.
    // Un retour à la ligne est voulu si le premier mot de la ligne suivante
    // aurait tenu sur la précédente. Sinon c'est un simple repli, et le
    // point de coupe ne dépend que de la longueur de ce mot.
    const deliberate = rightEdge != null && prevXMax != null &&
      prevXMax + SPACE_W + l.firstWordW <= rightEdge;
    const breaks = crossesPage ? starts : (starts || deliberate || l.y - prevY > ROW_GAP);
    if (cur === null || prevY === null || breaks) {
      if (cur) out.push(cur);
      cur = l.text.trim();
    } else {
      cur += " " + l.text.trim();
    }
    prevY = l.y; prevPage = l.page; prevXMax = l.xMax;
  }
  if (cur) out.push(cur);
  return out.map(p => p.replace(/\s+/g, " ").trim()).filter(Boolean);
}

/** Transforme les paragraphes d'une cellule en blocs de la fiche. */
function blocksOf(paras) {
  if (!paras.length) return [];
  // Un algorithme (flèches ↓) garde sa mise en forme d'origine, verbatim.
  if (paras.some(p => p.startsWith("↓"))) {
    return [{ type: "text", text: paras.join("\n"), pre: true }];
  }
  const blocks = [];
  let run = null;
  for (const p of paras) {
    if (BULLET.test(p)) {
      if (!run) { run = { type: "list", items: [] }; blocks.push(run); }
      run.items.push(p.replace(BULLET, "").trim());
    } else {
      run = null;
      blocks.push({ type: "text", text: p });
    }
  }
  return blocks;
}

const MNEMO = /\s*\((?:moyen\s+)?mnémotechniques?\s*(?:«\s*)?([^»)]*?)\s*(?:»\s*)?\)\s*$/i;

/** Sort « (moyen mnémotechnique « X ») » du titre pour en faire un bloc. */
function splitMnemo(title) {
  const m = title.match(MNEMO);
  if (!m) return { title, mnemo: null };
  const inner = (m[1] || "").trim();
  // « (moyen mnémotechnique) » sans contenu : l'astuce est dans la cellule,
  // on garde le titre tel quel plutôt que de perdre l'indication.
  if (!inner) return { title, mnemo: null };
  return { title: title.slice(0, m.index).trim(), mnemo: inner };
}

// -- découpage du document ---------------------------------------------------
const PARA_GROUP_GAP = 20;  // au-delà, deux paragraphes distincts

/** Regroupe les lignes en blocs homogènes {kind, lines}. */
function groupLines(lines) {
  const groups = [];
  for (const l of lines) {
    if (l.kind === "image") { groups.push({ kind: "image", image: l.image, lines: [], page: l.page, lastY: l.y }); continue; }
    const kind = kindOf(l);
    const last = groups[groups.length - 1];
    const contiguous = last && last.kind === kind && last.page === l.page &&
      (kind !== "para" || l.y - last.lastY <= PARA_GROUP_GAP);
    if (kind === "cell" && last && last.kind === "cell") {
      last.lines.push(l); last.lastY = l.y; last.page = l.page; continue;
    }
    if (contiguous) { last.lines.push(l); last.lastY = l.y; continue; }
    groups.push({ kind, lines: [l], page: l.page, lastY: l.y });
  }
  return groups;
}

/** Charge le manifeste des schémas, s'il a été produit. */
function loadImages(dir = "data/images") {
  const f = `${dir}/manifest.json`;
  if (!existsSync(f)) return [];
  return JSON.parse(readFileSync(f, "utf8"));
}

export function parse(lines = extractLines(), images = loadImages()) {
  const specs = [];
  const regions = [];
  // Les schémas prennent leur place dans le flux du document : c'est le
  // paragraphe qui les précède qui leur donne leur titre.
  const stream = lines.concat(images.map(im => ({
    page: im.page, y: im.yTop, x: 0, kind: "image", image: im,
  }))).sort((a, b) => a.page - b.page || a.y - b.y || a.x - b.x);
  const groups = groupLines(stream);
  let spec = null;

  for (let i = 0; i < groups.length; i++) {
    const g = groups[i];

    if (g.kind === "spec") {
      const name = g.lines.map(l => l.text.trim()).join(" ");
      if (name !== "Fiche erreurs — EDN") {
        spec = name;
        if (!specs.includes(spec)) specs.push(spec);
      }
      continue;
    }

    if (g.kind === "cell") {
      regions.push({ kind: "cells", spec, title: g.title || null, lines: g.lines, notes: [] });
      continue;
    }

    if (g.kind === "image") {
      regions.push({ kind: "image", spec, title: g.title || null, image: g.image, notes: [] });
      continue;
    }

    // g.kind === "para" : titre du tableau qui suit, ou note du précédent.
    // Dans une suite de paragraphes, seul le dernier avant un tableau est un
    // titre ; les autres complètent la région déjà fermée.
    const text = g.lines.map(l => l.text.trim()).join(" ");
    const next = groups[i + 1];
    const isTitle = next && (next.kind === "cell" || next.kind === "image");
    if (isTitle) next.title = text;
    else if (regions.length) regions[regions.length - 1].notes.push(text);
  }
  return { specs, regions };
}

/** Une région de cellules → des lignes de tableau. */
const firstOf = ls => ls.filter(l => l.col === 0).sort((a, b) => a.page - b.page || a.y - b.y);

function rowsOf(lines) {
  const cols = columnsOf(lines);
  // Une ligne peut chevaucher deux colonnes : pdftotext fusionne parfois deux
  // cellules d'une même ligne de base. On répartit donc mot par mot.
  const split = [];
  for (const l of lines) {
    const runs = new Map();
    for (const w of l.words) {
      const ci = colIndex(cols, w.x);
      if (!runs.has(ci)) runs.set(ci, []);
      runs.get(ci).push(w);
    }
    for (const [ci, ws] of runs) {
      split.push({ page: l.page, y: l.y, x: cols[ci], col: ci,
                   xMax: Math.max.apply(null, ws.map(w => w.xMax)),
                   firstWordW: ws[0].xMax - ws[0].x,
                   text: ws.map(w => w.text).join(" ").trim() });
    }
  }
  // Les en-têtes répétés en haut de chaque page sont retirés avant le
  // découpage : sinon la ligne d'en-tête ouvrirait une ligne de tableau qui
  // avalerait la fin de la cellule coupée par le saut de page.
  let keyed = split.filter(l => l.text && !HEADER_CELL.test(l.text.trim()))
    .sort((a, b) => a.page - b.page || a.y - b.y || a.x - b.x);

  // Tout tableau réimprime son en-tête en haut de chaque page. Quand cet
  // en-tête n'a pas de cellule en première colonne, il n'ouvre aucune ligne
  // et se fait avaler par la ligne précédente : on le retire d'abord.
  if (keyed.length) {
    const top = keyed[0];
    const header = new Map();
    for (const l of keyed) {
      if (l.page !== top.page || l.y - top.y > ROW_GAP) break;
      header.set(l.col, l.text);
    }
    keyed = keyed.filter(l => {
      const repeat = l.page !== top.page && l.y <= PAGE_TOP && header.get(l.col) === l.text;
      if (repeat) dropped.push(l.text);
      return !repeat;
    });
  }
  // En-tête dont la 1ʳᵉ cellule est vide : la région commence avant la 1ʳᵉ ligne.
  const edges = cols.map((_, ci) => {
    const xs = keyed.filter(l => l.col === ci).map(l => l.xMax);
    return xs.length ? Math.max.apply(null, xs) : null;
  });
  const first = firstOf(keyed);
  // Les frontières de ligne viennent de la 1ʳᵉ colonne : un titre de notion
  // s'y replie (écart 11.5) mais n'y saute jamais de paragraphe.
  const starts = [];
  let prev = null;
  for (const l of first) {
    if (prev === null || l.page !== prev.page || l.y - prev.y >= ROW_GAP) starts.push(l);
    prev = l;
  }
  const bounds = starts.map(s => ({ page: s.page, y: s.y }));
  if (keyed.length && (!bounds.length ||
      keyed[0].page < bounds[0].page ||
      (keyed[0].page === bounds[0].page && keyed[0].y < bounds[0].y - 1))) {
    bounds.unshift({ page: keyed[0].page, y: keyed[0].y });
  }
  const before = (l, b) => l.page < b.page || (l.page === b.page && l.y < b.y - 1);
  const rows = [];
  for (let i = 0; i < bounds.length; i++) {
    const lo = bounds[i], hi = bounds[i + 1];
    const mine = keyed.filter(l => !before(l, lo) && (!hi || before(l, hi)));
    const cells = cols.map(() => []);
    for (const l of mine) cells[l.col].push(l);
    rows.push({ cols: cols.length, cells: cells.map((c, ci) => paragraphsOf(c, edges[ci])), raw: cells });
  }
  // Un en-tête répété qui possède, lui, une cellule en première colonne
  // ouvre bien une ligne : elle est identique à l'en-tête, on l'écarte.
  const sig = r => r.cells.map(c => c.join(" ").trim()).join("\u0001");
  const head = rows.length ? sig(rows[0]) : null;
  return rows.filter((r, i) => {
    if (i === 0 || sig(r) !== head) return true;
    r.cells.forEach(c => c.forEach(t => dropped.push(t)));
    return false;
  });
}

export function build() {
  dropped = [];
  const { specs, regions } = parse();
  const notions = [];
  let order = 0;

  for (const region of regions) {
    if (region.kind === "image") {
      // Pas de légende : le titre de la notion la porte déjà.
      const blocks = [{ type: "schema", imageId: region.image.id }];
      for (const note of region.notes) blocks.push({ type: "text", text: note });
      notions.push({
        spec: region.spec,
        title: region.title || "Schéma",
        blocks, order: order++,
      });
      continue;
    }
    const rows = rowsOf(region.lines);
    if (!rows.length) continue;
    // L'en-tête ayant été retiré, une région à deux colonnes dont le titre
    // n'est pas celui d'un tableau autonome est un tableau de notions.
    const twoCol = rows[0].cols === 2 && !region.title;

    if (twoCol) {
      // Tableau « Notion clé / Ce qu'il faut retenir » : une notion par ligne.
      for (const row of rows) {
        const left = row.cells[0].join(" ").trim();
        const right = row.cells[1] || [];
        if (isHeaderRow([left, (right[0] || "")])) continue;
        if (!left && notions.length) {
          // Suite d'une notion coupée par un saut de page.
          notions[notions.length - 1].blocks.push(...blocksOf(right));
          continue;
        }
        if (!left && !right.length) continue;
        const { title, mnemo } = splitMnemo(left);
        const blocks = blocksOf(right);
        if (mnemo) blocks.push({ type: "mnemo", text: mnemo });
        notions.push({ spec: region.spec, title, blocks, order: order++ });
      }
      if (region.notes.length && notions.length) {
        for (const note of region.notes) {
          notions[notions.length - 1].blocks.push({ type: "text", text: note });
        }
      }
    } else {
      // Tableau comparatif autonome : une notion portant un seul bloc tableau.
      const head = rows[0].cells.map(c => c.join(" ").trim());
      const body = rows.slice(1).map(r => r.cells.map(c => c.join("\n").trim()));
      if (!body.length) continue;
      const blocks = [{ type: "table", head, rows: body }];
      for (const note of region.notes) blocks.push({ type: "text", text: note });
      notions.push({
        spec: region.spec,
        title: region.title || head.filter(Boolean)[0] || "Tableau",
        blocks, order: order++,
      });
    }
  }
  return { specs, notions, dropped };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const out = build();
  writeFileSync(process.argv[2] || "data/fiche.json", JSON.stringify(out, null, 2));
  console.log(`spécialités : ${out.specs.length}`);
  console.log(`notions     : ${out.notions.length}`);
  const byType = {};
  for (const n of out.notions) for (const b of n.blocks) byType[b.type] = (byType[b.type] || 0) + 1;
  console.log("blocs       :", byType);
}
