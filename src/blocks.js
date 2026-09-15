/* Les blocs de la fiche : les cinq formes qu'utilise déjà la fiche papier,
   leur conversion en texte brut pour l'édition à la main, et leur
   validation stricte — c'est elle qui fait tomber une réponse de l'IA
   malformée du côté « on n'écrit rien ». */
(function () {
  "use strict";

  var FE = (window.FE = window.FE || {});

  var TYPES = ["text", "list", "table", "mnemo", "schema"];

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  /* ---- validation ------------------------------------------------------ */

  /* Renvoie null si le bloc est valide, sinon la raison du refus. Aucune
     réparation silencieuse : un bloc douteux fait refuser l'écriture. */
  function checkBlock(b, i) {
    var at = "bloc " + (i + 1);
    if (!b || typeof b !== "object" || Array.isArray(b)) return at + " : ce n'est pas un bloc.";
    if (TYPES.indexOf(b.type) < 0) return at + " : type « " + b.type + " » inconnu.";

    if (b.type === "text" || b.type === "mnemo") {
      if (typeof b.text !== "string" || !b.text.trim()) return at + " : texte vide.";
      return null;
    }
    if (b.type === "list") {
      if (!Array.isArray(b.items) || !b.items.length) return at + " : liste vide.";
      for (var j = 0; j < b.items.length; j++) {
        if (typeof b.items[j] !== "string" || !b.items[j].trim()) {
          return at + " : le point " + (j + 1) + " est vide.";
        }
      }
      return null;
    }
    if (b.type === "table") {
      if (!Array.isArray(b.head) || b.head.length < 2) return at + " : tableau sans en-tête exploitable.";
      if (!Array.isArray(b.rows) || !b.rows.length) return at + " : tableau sans ligne.";
      for (var r = 0; r < b.rows.length; r++) {
        if (!Array.isArray(b.rows[r])) return at + " : ligne " + (r + 1) + " malformée.";
        if (b.rows[r].length !== b.head.length) {
          return at + " : la ligne " + (r + 1) + " a " + b.rows[r].length +
            " cellules pour " + b.head.length + " colonnes.";
        }
      }
      return null;
    }
    if (b.type === "schema") {
      if (!b.imageId && !b.text) return at + " : schéma sans image ni légende.";
      return null;
    }
    return at + " : bloc non reconnu.";
  }

  function validate(blocks) {
    if (!Array.isArray(blocks) || !blocks.length) {
      return { ok: false, error: "aucun bloc à écrire." };
    }
    for (var i = 0; i < blocks.length; i++) {
      var problem = checkBlock(blocks[i], i);
      if (problem) return { ok: false, error: problem };
    }
    return { ok: true };
  }

  /* ---- blocs → texte brut (édition à la main) -------------------------- */

  function toPlain(blocks) {
    return (blocks || []).map(function (b) {
      if (b.type === "list") return b.items.map(function (i) { return "• " + i; }).join("\n");
      if (b.type === "table") {
        return [b.head.join(" | ")].concat(b.rows.map(function (r) { return r.join(" | "); })).join("\n");
      }
      if (b.type === "mnemo") return "Mnémo : " + b.text;
      if (b.type === "schema") return "[schéma" + (b.imageId ? " " + b.imageId : "") + "] " + (b.text || "");
      return b.text;
    }).join("\n\n");
  }

  /* ---- texte brut → blocs ---------------------------------------------- */

  function parsePlain(draft) {
    return String(draft == null ? "" : draft)
      .split(/\n\s*\n/)
      .map(function (c) { return c.trim(); })
      .filter(Boolean)
      .map(function (chunk) {
        var lines = chunk.split("\n").map(function (l) { return l.trim(); }).filter(Boolean);

        var schema = /^\[schéma(?:\s+([\w-]+))?\]\s*/i.exec(lines[0]);
        if (schema) {
          return { type: "schema", imageId: schema[1] || null, text: chunk.replace(/^\[schéma(?:\s+[\w-]+)?\]\s*/i, "") };
        }
        if (lines.length > 1 && lines.every(function (l) { return l.indexOf("|") > -1; })) {
          var cut = function (l) { return l.split("|").map(function (c) { return c.trim(); }); };
          var head = cut(lines[0]);
          var rows = lines.slice(1).map(cut);
          // Une ligne trop courte est complétée plutôt que perdue : ici
          // c'est elle qui écrit, pas le modèle.
          rows = rows.map(function (r) {
            while (r.length < head.length) r.push("");
            return r.slice(0, head.length);
          });
          return { type: "table", head: head, rows: rows };
        }
        if (lines.every(function (l) { return /^[•\-*·]\s/.test(l); })) {
          return { type: "list", items: lines.map(function (l) { return l.replace(/^[•\-*·]\s*/, ""); }) };
        }
        if (/^mn[ée]mo\s*:/i.test(lines[0])) {
          return { type: "mnemo", text: chunk.replace(/^mn[ée]mo\s*:\s*/i, "") };
        }
        var joined = lines.join(" ");
        // On garde les retours à la ligne d'un algorithme (flèches ↓).
        if (chunk.indexOf("↓") > -1) return { type: "text", text: chunk, pre: true };
        return { type: "text", text: joined };
      });
  }

  /* ---- texte indexable (recherche, contexte IA) ------------------------ */

  function blockText(b) {
    if (!b) return "";
    if (b.type === "list") return (b.items || []).join(" ");
    if (b.type === "table") {
      return (b.head || []).join(" ") + " " +
        (b.rows || []).map(function (r) { return r.join(" "); }).join(" ");
    }
    return b.text || "";
  }

  function notionText(n) {
    return [n.title, n.spec].concat((n.blocks || []).map(blockText)).join(" ");
  }

  /* ---- rendu ------------------------------------------------------------ */

  function renderBlocks(blocks, images) {
    return (blocks || []).map(function (b) {
      if (b.type === "list") {
        return '<ul>' + b.items.map(function (i) { return "<li>" + esc(i) + "</li>"; }).join("") + "</ul>";
      }
      if (b.type === "table") {
        return '<div class="table-wrap"><table><thead><tr>' +
          b.head.map(function (h) { return "<th>" + esc(h) + "</th>"; }).join("") +
          "</tr></thead><tbody>" +
          b.rows.map(function (r) {
            return "<tr>" + r.map(function (c) { return "<td>" + esc(c) + "</td>"; }).join("") + "</tr>";
          }).join("") +
          "</tbody></table></div>";
      }
      if (b.type === "mnemo") {
        return '<div class="mnemo"><span class="lbl">Mnémo</span><span class="txt">' +
          esc(b.text) + "</span></div>";
      }
      if (b.type === "schema") {
        // Les schémas sont publiés avec la page : un identifiant qui ne suit
        // pas le format attendu ne construit aucune URL.
        var src = /^schema-\d{2}$/.test(String(b.imageId || ""))
          ? "schemas/" + b.imageId + ".jpg"
          : null;
        if (src) {
          return '<figure class="schema" style="margin:0"><img src="' + esc(src) +
            '" alt="' + esc(b.text || "Schéma de la fiche") + '" loading="lazy" />' +
            '<figcaption>Schéma importé</figcaption></figure>';
        }
        return '<div class="schema missing"><span>Schéma importé</span><span>' +
          esc(b.text || "image indisponible") + "</span></div>";
      }
      return '<p' + (b.pre ? ' class="pre"' : "") + ">" + esc(b.text) + "</p>";
    }).join("");
  }

  FE.blocks = {
    esc: esc,
    validate: validate,
    toPlain: toPlain,
    parsePlain: parsePlain,
    blockText: blockText,
    notionText: notionText,
    render: renderBlocks,
  };
})();
