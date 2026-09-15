#!/usr/bin/env bash
# Ré-importe la fiche depuis un nouvel export PDF, de bout en bout.
#   ./tools/import.sh ~/Téléchargements/fiche_erreurs.pdf
# S'arrête si un seul mot est perdu ou inventé : rien ne part en publication
# sans que l'import soit prouvé fidèle.
set -euo pipefail

PDF="${1:?usage: tools/import.sh <fiche.pdf>}"
[ -f "$PDF" ] || { echo "Fichier introuvable : $PDF" >&2; exit 1; }
cd "$(dirname "$0")/.."
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

echo "→ extraction des schémas"
node tools/extract-images.mjs "$PDF" data/images "$WORK"

echo "→ reconstruction de la structure"
pdftotext -bbox-layout "$PDF" "$WORK/fiche.bbox.html"
export FICHE_BBOX="$WORK/fiche.bbox.html"
node tools/parse-fiche.mjs data/fiche.json

echo "→ vérification (échoue si un mot manque ou a été inventé)"
node tools/verify-import.mjs data/fiche.json

echo "→ fabrication du paquet embarqué"
mkdir -p src/schemas
cp data/images/schema-*.jpg src/schemas/
node -e '
const fs = require("fs");
const f = JSON.parse(fs.readFileSync("data/fiche.json", "utf8"));
const out = {
  specs: f.specs,
  notions: f.notions.map((n, i) => ({
    id: "n" + String(i + 1).padStart(3, "0"),
    spec: n.spec, title: n.title, item: "", ai: false, blocks: n.blocks, order: i,
  })),
};
fs.writeFileSync("src/fiche-data.js",
  "/* Fiche de départ, embarquée pour l\x27amorçage de la base au premier lancement. */\n" +
  "window.FE_SEED = " + JSON.stringify(out) + ";\n");
console.log("  " + out.notions.length + " notions, " + out.specs.length + " spécialités");
'
echo
echo "✓ prêt à publier. src/fiche-data.js et src/schemas/ sont à jour."
