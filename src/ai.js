/* Le pipeline IA, en deux phases et sous budget de contexte.

   Phase 1 — classement : ne reçoit que l'index des notions (spécialité +
   titre), jamais leur contenu. Phase 2 — structuration : ne reçoit que la
   notion visée. C'est ce qui évite de renvoyer la fiche entière à chaque
   appel, qui dépasserait de toute façon les 64 Kio d'un appel.

   Toute réponse qui ne respecte pas exactement le contrat JSON est traitée
   comme un refus. On ne répare rien, on ne devine rien. */
(function () {
  "use strict";

  var FE = (window.FE = window.FE || {});
  var sample = null;
  var resolved = false;
  var limits = null;

  var MAX_PROMPT = 60000;   // marge sous les 65 536 octets annoncés
  var TIER = "complex";     // une erreur médicale coûte plus cher que l'attente

  function bytes(s) {
    try { return new TextEncoder().encode(s).length; } catch (e) { return s.length * 2; }
  }

  function get() {
    if (resolved) return Promise.resolve(sample);
    resolved = true;
    if (!window.claude || typeof window.claude.use !== "function") return Promise.resolve(null);
    return window.claude.use("sample").then(function (s) {
      sample = s;
      if (s && typeof s.limits === "function") {
        return s.limits().then(function (l) { limits = l; return s; }).catch(function () { return s; });
      }
      return s;
    }).catch(function () { return null; });
  }

  function refus(reasons) {
    return { decision: "refus", reasons: [].concat(reasons) };
  }

  /* Message lisible pour chaque code d'erreur de `sample`. */
  function explain(e) {
    var code = e && e.code;
    if (code === "not_granted") return "L'accès à l'IA n'a pas été autorisé pour cette page.";
    if (code === "rate_limited") return "Limite d'usage atteinte sur votre compte Claude — réessayez dans quelques minutes.";
    if (code === "cancelled") return "Analyse interrompue.";
    if (code === "refused") return "Le modèle n'a pas voulu traiter cette note.";
    if (code === "invalid_json") return "Réponse illisible du modèle : rien n'a été écrit.";
    if (code === "too_large") return "La note est trop longue pour être analysée d'un seul tenant.";
    return "L'analyse a échoué : rien n'a été écrit.";
  }

  /* ---- index compact : « 12 | Cardiologie | Fibrillation atriale » ------ */
  function buildIndex(notions) {
    return notions.map(function (n, i) {
      return i + " | " + n.spec + " | " + n.title;
    }).join("\n");
  }

  var RULES =
    "RÈGLE ABSOLUE — au moindre doute, tu réponds \"refus\" et rien n'est écrit.\n" +
    "Tu réponds \"refus\" si l'un de ces cas se présente :\n" +
    "- la notion ou la spécialité concernée n'est pas identifiable avec certitude ;\n" +
    "- la note est ambiguë, tronquée, ou contient une valeur sans unité ni contexte ;\n" +
    "- l'auteure y signale elle-même un doute (« à vérifier », « je crois », « ? ») ;\n" +
    "- tu hésites entre deux notions existantes ;\n" +
    "- tu n'es pas certain de l'exactitude médicale de ce qui est écrit.\n" +
    "Ne choisis JAMAIS une spécialité ou une notion « par défaut », « la plus proche » " +
    "ou « la plus probable ». Écrire une information fausse dans cette fiche est bien " +
    "plus grave que de ne rien écrire du tout.";

  /* ---- phase 1 : classement -------------------------------------------- */
  function classify(raw, notions, specs) {
    return get().then(function (s) {
      if (!s) return refus(["L'IA n'est pas disponible dans cette vue."]);

      var index = buildIndex(notions);
      var fresh = !specs.length;
      var prompt =
        "Tu classes une note de révision dans une fiche d'erreurs pour les EDN " +
        "(examens nationaux de médecine). La fiche est organisée par spécialité, " +
        "puis par notion clé.\n\n" +
        (fresh
          ? "La fiche est encore vide : nomme toi-même la spécialité, avec le nom " +
            "usuel de la discipline (« Cardiologie », « Hépato-gastro-entérologie »…).\n\n"
          : "SPÉCIALITÉS EXISTANTES (les seules autorisées) :\n" + specs.join("\n") + "\n\n") +
        "NOTIONS EXISTANTES (numéro | spécialité | titre) :\n" + index + "\n\n" +
        "NOTE BRUTE À CLASSER :\n\"\"\"\n" + raw + "\n\"\"\"\n\n" +
        RULES + "\n\n" +
        "Réponds UNIQUEMENT par un objet JSON, sans aucun texte autour :\n" +
        "{\"decision\":\"merge\",\"index\":<numéro d'une notion ci-dessus>}\n" +
        "  — seulement si cette notion traite déjà exactement ce sujet.\n" +
        "{\"decision\":\"new\",\"spec\":\"<une spécialité de la liste, copiée exactement>\"," +
        "\"notionTitle\":\"<titre court, style du reste de la fiche>\"}\n" +
        "  — seulement si la spécialité est certaine et qu'aucune notion existante ne convient.\n" +
        "{\"decision\":\"refus\",\"reasons\":[\"<une phrase>\",\"<une phrase>\"]}\n" +
        "  — dans tous les autres cas. Explique en français ce qui t'a fait refuser.";

      if (bytes(prompt) > MAX_PROMPT) {
        return refus(["La fiche est trop volumineuse pour être analysée d'un seul tenant."]);
      }

      return s.json(prompt, { modelTier: TIER }).then(function (out) {
        return checkClassify(out, notions, specs);
      }).catch(function (e) {
        return refus([explain(e)]);
      });
    });
  }

  function checkClassify(out, notions, specs) {
    if (!out || typeof out !== "object") return refus(["Réponse illisible du modèle."]);

    if (out.decision === "refus") {
      var reasons = Array.isArray(out.reasons)
        ? out.reasons.filter(function (r) { return typeof r === "string" && r.trim(); })
        : [];
      return refus(reasons.length ? reasons : ["Le modèle n'a pas su classer cette note avec certitude."]);
    }

    if (out.decision === "merge") {
      var i = out.index;
      if (typeof i !== "number" || i % 1 !== 0 || i < 0 || i >= notions.length) {
        return refus(["Le modèle a désigné une notion qui n'existe pas — rien n'a été écrit."]);
      }
      var target = notions[i];
      return { decision: "merge", notion: target, spec: target.spec, notionTitle: target.title };
    }

    if (out.decision === "new") {
      var known = specs.length === 0 || specs.indexOf(out.spec) > -1;
      if (typeof out.spec !== "string" || !out.spec.trim() || !known) {
        return refus(["Le modèle a proposé une spécialité absente de la fiche — rien n'a été écrit."]);
      }
      if (typeof out.notionTitle !== "string" || out.notionTitle.trim().length < 3 ||
          out.notionTitle.length > 120) {
        return refus(["Le titre de notion proposé est inexploitable — rien n'a été écrit."]);
      }
      return { decision: "new", spec: out.spec, notionTitle: out.notionTitle.trim(), notion: null };
    }

    return refus(["Le modèle n'a pas répondu dans le format attendu — rien n'a été écrit."]);
  }

  /* ---- phase 2 : structuration ----------------------------------------- */
  function structure(raw, verdict) {
    return get().then(function (s) {
      if (!s) return refus(["L'IA n'est pas disponible dans cette vue."]);

      var merging = verdict.decision === "merge";
      var existing = merging ? JSON.stringify(verdict.notion.blocks || []) : "";

      var prompt =
        "Tu rédiges une entrée de fiche de révision pour les EDN, dans le style " +
        "exact du reste de la fiche : phrases courtes, pas de délayage, pas de " +
        "« il faut », le vocabulaire médical d'usage.\n\n" +
        "SPÉCIALITÉ : " + verdict.spec + "\n" +
        "NOTION : " + verdict.notionTitle + "\n\n" +
        (merging
          ? "ENTRÉE DÉJÀ PRÉSENTE dans la fiche (blocs JSON) :\n" + existing + "\n\n" +
            "Tu ne renvoies QUE les blocs À AJOUTER à cette entrée. Ne répète rien " +
            "de ce qu'elle dit déjà, ne la réécris pas, ne la reformule pas. Si la " +
            "note n'apporte rien de nouveau, réponds refus en le disant.\n\n"
          : "C'est une nouvelle entrée : tu renvoies tous ses blocs.\n\n") +
        "NOTE BRUTE :\n\"\"\"\n" + raw + "\n\"\"\"\n\n" +
        "RÈGLES DE RÉDACTION :\n" +
        "- N'invente RIEN. N'ajoute aucune valeur, aucun seuil, aucune précision, " +
        "aucune nuance qui ne soit pas dans la note brute.\n" +
        "- Corrige l'orthographe, la ponctuation et les abréviations de saisie rapide, " +
        "mais ne change jamais le sens, ni un chiffre, ni une unité.\n" +
        "- Choisis la forme qui convient : du texte, une liste, un tableau comparatif, " +
        "ou un moyen mnémotechnique.\n" +
        "- Dans un tableau, chaque ligne a exactement autant de cellules que l'en-tête.\n\n" +
        RULES + "\n\n" +
        "Réponds UNIQUEMENT par un objet JSON, sans texte autour :\n" +
        "{\"blocks\":[ ... ],\"note\":\"<une phrase disant ce que tu as fait>\"}\n" +
        "ou {\"refus\":true,\"reasons\":[\"<une phrase>\"]}\n\n" +
        "Formes de bloc autorisées, et aucune autre :\n" +
        "{\"type\":\"text\",\"text\":\"…\"}\n" +
        "{\"type\":\"list\",\"items\":[\"…\",\"…\"]}\n" +
        "{\"type\":\"table\",\"head\":[\"…\",\"…\"],\"rows\":[[\"…\",\"…\"]]}\n" +
        "{\"type\":\"mnemo\",\"text\":\"…\"}";

      if (bytes(prompt) > MAX_PROMPT) {
        return refus(["La note et son contexte dépassent la taille d'un appel."]);
      }

      return s.json(prompt, { modelTier: TIER }).then(function (out) {
        if (!out || typeof out !== "object") return refus(["Réponse illisible du modèle."]);
        if (out.refus) {
          var rs = Array.isArray(out.reasons)
            ? out.reasons.filter(function (r) { return typeof r === "string" && r.trim(); })
            : [];
          return refus(rs.length ? rs : ["Le modèle a préféré ne rien écrire."]);
        }
        var check = FE.blocks.validate(out.blocks);
        if (!check.ok) {
          return refus(["La proposition du modèle est malformée (" + check.error + ") — rien n'a été écrit."]);
        }
        return {
          decision: verdict.decision,
          spec: verdict.spec,
          notion: verdict.notion,
          notionTitle: verdict.notionTitle,
          blocks: out.blocks,
          note: typeof out.note === "string" ? out.note : "",
        };
      }).catch(function (e) {
        return refus([explain(e)]);
      });
    });
  }


  /* ---- import en masse : un lot de document → des entrées proposées ----- */
  function extractNotions(chunkText, notions, specs) {
    return get().then(function (s) {
      if (!s) return { entrees: [], ignores: [{ raison: "L'IA n'est pas disponible dans cette vue." }] };

      var fresh = !specs.length;
      var prompt =
        "Voici un extrait d'un document de révision médicale (EDN). Tu en tires " +
        "les entrées à ajouter à une fiche organisée par spécialité puis par " +
        "notion clé.\n\n" +
        (fresh
          ? "La fiche est encore vide : nomme toi-même les spécialités, avec le nom " +
            "usuel de la discipline.\n\n"
          : "SPÉCIALITÉS EXISTANTES (les seules autorisées) :\n" + specs.join("\n") + "\n\n" +
            "NOTIONS EXISTANTES (numéro | spécialité | titre) :\n" + buildIndex(notions) + "\n\n") +
        "EXTRAIT À TRAITER :\n\"\"\"\n" + chunkText + "\n\"\"\"\n\n" +
        "RÈGLES DE RÉDACTION :\n" +
        "- N'invente RIEN. Tout ce que tu écris doit être dans l'extrait.\n" +
        "- Ne reformule pas le sens, ne change aucun chiffre ni aucune unité.\n" +
        "- Regroupe ce qui va ensemble : une notion clé par sujet, pas une par phrase.\n" +
        "- Dans un tableau, chaque ligne a exactement autant de cellules que l'en-tête.\n" +
        "- Ignore les en-têtes de page, numéros de page et titres de document.\n\n" +
        RULES + "\n\n" +
        "Tout passage sur lequel tu as le moindre doute va dans \"ignores\", " +
        "jamais dans \"entrees\".\n\n" +
        "Réponds UNIQUEMENT par un objet JSON, sans texte autour :\n" +
        "{\"entrees\":[\n" +
        "  {\"action\":\"new\",\"spec\":\"<spécialité>\",\"title\":\"<titre court>\",\"blocks\":[…]},\n" +
        "  {\"action\":\"merge\",\"index\":<numéro d'une notion existante>,\"blocks\":[…]}\n" +
        "],\"ignores\":[{\"extrait\":\"<début du passage>\",\"raison\":\"<pourquoi>\"}]}\n\n" +
        "Formes de bloc autorisées, et aucune autre :\n" +
        "{\"type\":\"text\",\"text\":\"…\"}\n" +
        "{\"type\":\"list\",\"items\":[\"…\"]}\n" +
        "{\"type\":\"table\",\"head\":[\"…\",\"…\"],\"rows\":[[\"…\",\"…\"]]}\n" +
        "{\"type\":\"mnemo\",\"text\":\"…\"}";

      if (bytes(prompt) > MAX_PROMPT) {
        return { entrees: [], ignores: [{ raison: "Ce lot est trop volumineux pour un seul appel." }] };
      }

      return s.json(prompt, { modelTier: TIER }).then(function (out) {
        return checkExtraction(out, notions, specs);
      }).catch(function (e) {
        return { entrees: [], ignores: [{ raison: explain(e) }] };
      });
    });
  }

  /* Une entrée qui ne passe pas la validation n'est pas réparée : elle est
     écartée, avec sa raison, et rien n'entre dans la fiche par accident. */
  function checkExtraction(out, notions, specs) {
    var entrees = [];
    var ignores = [];

    if (!out || typeof out !== "object") {
      return { entrees: [], ignores: [{ raison: "Réponse illisible du modèle." }] };
    }
    if (Array.isArray(out.ignores)) {
      out.ignores.forEach(function (i) {
        if (i && typeof i === "object") {
          ignores.push({
            extrait: typeof i.extrait === "string" ? i.extrait : "",
            raison: typeof i.raison === "string" ? i.raison : "Passage écarté par l'IA.",
          });
        }
      });
    }
    if (!Array.isArray(out.entrees)) return { entrees: entrees, ignores: ignores };

    out.entrees.forEach(function (e) {
      if (!e || typeof e !== "object") {
        ignores.push({ extrait: "", raison: "Entrée malformée — écartée." });
        return;
      }
      var check = FE.blocks.validate(e.blocks);
      if (!check.ok) {
        ignores.push({ extrait: String(e.title || ""), raison: "Mise en forme invalide (" + check.error + ")." });
        return;
      }
      if (e.action === "merge") {
        var i = e.index;
        if (typeof i !== "number" || i % 1 !== 0 || i < 0 || i >= notions.length) {
          ignores.push({ extrait: "", raison: "Le modèle a visé une notion qui n'existe pas." });
          return;
        }
        entrees.push({
          action: "merge", notion: notions[i], spec: notions[i].spec,
          title: notions[i].title, blocks: e.blocks,
        });
        return;
      }
      var known = specs.length === 0 || specs.indexOf(e.spec) > -1;
      if (typeof e.spec !== "string" || !e.spec.trim() || !known) {
        ignores.push({ extrait: String(e.title || ""), raison: "Spécialité absente de la fiche." });
        return;
      }
      if (typeof e.title !== "string" || e.title.trim().length < 3 || e.title.length > 120) {
        ignores.push({ extrait: String(e.title || ""), raison: "Titre de notion inexploitable." });
        return;
      }
      entrees.push({
        action: "new", spec: e.spec, title: e.title.trim(), blocks: e.blocks, notion: null,
      });
    });

    return { entrees: entrees, ignores: ignores };
  }

  /* ---- photo : l'image devient du texte brut, relu avant tout classement */
  function readPhoto(file) {
    return get().then(function (s) {
      if (!s) return { error: "L'IA n'est pas disponible dans cette vue." };
      if (!limits || !limits.images) {
        return { error: "L'envoi d'images n'est pas disponible sur ce compte." };
      }
      var prompt =
        "Cette image est une page de cours ou une fiche de révision de médecine. " +
        "Recopie fidèlement l'information qu'elle contient, en texte brut, sans la " +
        "reformuler, sans rien ajouter et sans rien commenter. Si l'image est " +
        "illisible ou ne contient pas d'information médicale exploitable, réponds " +
        "exactement : ILLISIBLE";
      return s(prompt, { images: file, modelTier: TIER }).then(function (r) {
        var text = (r.text || "").trim();
        if (!text || /^ILLISIBLE/i.test(text)) {
          return { error: "Image illisible : rien n'en a été tiré." };
        }
        return { text: text };
      }).catch(function (e) {
        return { error: explain(e) };
      });
    });
  }

  function imageAccept() {
    return limits && limits.images ? limits.images.mediaTypes.join(",") : "image/*";
  }

  FE.ai = {
    available: get,
    classify: classify,
    structure: structure,
    extractNotions: extractNotions,
    readPhoto: readPhoto,
    imageAccept: imageAccept,
  };
})();
