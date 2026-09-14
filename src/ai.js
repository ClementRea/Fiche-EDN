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
    readPhoto: readPhoto,
    imageAccept: imageAccept,
  };
})();
