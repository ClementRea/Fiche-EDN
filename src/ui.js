/* Le rendu et les interactions.

   Un seul principe gouverne l'écriture : rien n'entre dans la fiche sans un
   geste explicite d'elle. L'IA propose, elle valide. */
(function () {
  "use strict";

  var FE = window.FE;
  var B = FE.blocks;
  var esc = B.esc;

  var S = {
    notions: [],
    specs: [],
    images: {},
    query: "",
    activeSpec: "all",
    exam: false,
    mode: "clavier",
    raw: "",
    recording: false,
    micState: "unknown",   // unsupported | unknown | granted | denied
    photoUrl: null,
    busy: null,
    proposal: null,
    editingId: null,
    draft: "",
    flashId: null,
    loaded: false,

    importOpen: false,
    importStage: "pick",   // pick | working | review
    importName: "",
    importText: "",
    importInfo: "",
    importProgress: null,  // { done, total, label }
    importEntries: [],
    importIgnores: [],
    importSkip: {},
  };

  var $ = function (id) { return document.getElementById(id); };
  var downloads = null;
  var recognition = null;
  var toastTimer = null;
  var flashTimer = null;
  var pendingFile = null;

  /* ---- thème ------------------------------------------------------------ */
  /* La page hérite du thème de claude.ai. Ce sélecteur permet d'en sortir :
     « auto » rend la main à l'hôte, les deux autres l'emportent. */
  var THEME_KEY = "fiche-edn-theme";
  var hostTheme = null;
  var themeMode = "auto";

  function applyTheme() {
    var root = document.documentElement;
    if (themeMode === "auto") {
      if (hostTheme) root.setAttribute("data-theme", hostTheme);
      else root.removeAttribute("data-theme");
    } else {
      root.setAttribute("data-theme", themeMode);
    }
    var label = themeMode === "light" ? "clair" : themeMode === "dark" ? "sombre" : "auto";
    var btn = $("btn-theme");
    btn.textContent = "Thème : " + label;
    btn.setAttribute("aria-label", "Thème d'affichage : " + label + ". Cliquer pour changer.");
  }

  function cycleTheme() {
    themeMode = themeMode === "auto" ? "light" : themeMode === "light" ? "dark" : "auto";
    try { window.localStorage.setItem(THEME_KEY, themeMode); } catch (e) {}
    applyTheme();
  }

  function initTheme() {
    hostTheme = document.documentElement.getAttribute("data-theme");
    try {
      var saved = window.localStorage.getItem(THEME_KEY);
      if (saved === "light" || saved === "dark" || saved === "auto") themeMode = saved;
    } catch (e) {}
    applyTheme();
  }

  /* ---- petits utilitaires ---------------------------------------------- */

  function toast(msg) {
    var root = $("toast-root");
    root.innerHTML = '<div class="toast">' + esc(msg) + "</div>";
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { root.innerHTML = ""; }, 3400);
  }

  function specsOf(notions) {
    var seen = [];
    notions.forEach(function (n) { if (seen.indexOf(n.spec) < 0) seen.push(n.spec); });
    return seen;
  }

  function visible() {
    var q = S.query.trim().toLowerCase();
    return S.notions.filter(function (n) {
      if (S.activeSpec !== "all" && n.spec !== S.activeSpec) return false;
      if (!q) return true;
      return B.notionText(n).toLowerCase().indexOf(q) > -1;
    });
  }

  /* ---- rendu ------------------------------------------------------------ */

  function renderStats() {
    if (!S.loaded) { $("stats").textContent = "chargement…"; return; }
    var n = S.notions.length;
    $("stats").textContent =
      n + (n > 1 ? " notions · " : " notion · ") +
      S.specs.length + (S.specs.length > 1 ? " spécialités" : " spécialité");
  }

  function renderRail() {
    var counts = {};
    S.notions.forEach(function (n) { counts[n.spec] = (counts[n.spec] || 0) + 1; });
    var rows = [{ id: "all", name: "Toute la fiche", count: S.notions.length }]
      .concat(S.specs.map(function (s) { return { id: s, name: s, count: counts[s] || 0 }; }));

    $("rail").innerHTML = rows.map(function (r) {
      return '<button class="rail-item" type="button" data-spec="' + esc(r.id) + '"' +
        ' aria-current="' + (S.activeSpec === r.id ? "true" : "false") + '">' +
        '<span class="name">' + esc(r.name) + "</span>" +
        '<span class="count">' + r.count + "</span></button>";
    }).join("");
  }

  /* La dictée a quatre états, et aucun ne laisse l'écran vide : il y a
     toujours un bouton à presser ou une marche à suivre. */
  function renderDictee() {
    var panel = $("panel-dictee");
    var osHelp =
      "Sur iPhone et iPad, touchez le micro du clavier. Sur Mac, appuyez deux " +
      "fois sur <strong>Fn</strong>. La dictée du système écrit directement dans " +
      "le champ ci-dessus et reste la voie la plus fiable.";

    if (S.micState === "unsupported") {
      panel.innerHTML =
        '<div class="notice"><strong>Ce navigateur ne sait pas transcrire</strong>' +
        "<p>Utilisez la dictée du système, qui fait la même chose en mieux. " + osHelp + "</p></div>";
      return;
    }

    if (S.micState === "denied") {
      panel.innerHTML =
        '<div class="notice"><strong>Le micro est bloqué pour cette page</strong>' +
        "<p>Rien n'a été enregistré. Pour le débloquer&nbsp;:</p>" +
        "<ol><li><strong>Safari</strong> — menu <em>Réglages de ce site web</em>, " +
        "puis <em>Microphone&nbsp;: Autoriser</em>.</li>" +
        "<li><strong>Chrome</strong> — l'icône de cadenas ou de réglages dans la " +
        "barre d'adresse, puis <em>Microphone</em>.</li>" +
        "<li>Rechargez la page, puis réessayez.</li></ol>" +
        "<p>Si aucun réglage n'apparaît, c'est que la page, intégrée dans " +
        "Claude, n'a pas accès au micro. " + osHelp + "</p>" +
        '<div class="notice-actions">' +
        '<button class="btn-outline" type="button" data-mic="retry">Réessayer</button>' +
        '<button class="btn-quiet" type="button" data-mic="keyboard">Revenir au clavier</button>' +
        "</div></div>";
      return;
    }

    if (S.micState === "unknown") {
      panel.innerHTML =
        '<div class="notice"><strong>Autorisez le micro pour dicter</strong>' +
        "<p>Votre navigateur va demander la permission. Rien n'est enregistré " +
        "avant que vous n'acceptiez, et la transcription s'écrit dans le champ " +
        "ci-dessus où vous pouvez la relire.</p>" +
        '<div class="notice-actions">' +
        '<button class="btn-primary" type="button" data-mic="ask">Autoriser le micro</button>' +
        '<button class="btn-quiet" type="button" data-mic="keyboard">Plutôt au clavier</button>' +
        "</div></div>";
      return;
    }

    var bars = "";
    for (var i = 0; i < 14; i++) bars += '<i style="animation-delay:' + (i * 55) + 'ms"></i>';
    panel.innerHTML =
      '<button class="rec-btn" type="button" data-mic="toggle" aria-pressed="' +
        (S.recording ? "true" : "false") + '" aria-label="' +
        (S.recording ? "Arrêter la dictée" : "Démarrer la dictée") + '">' +
        (S.recording ? "■" : "●") + "</button>" +
      '<div class="bars' + (S.recording ? " on" : "") + '" aria-hidden="true">' + bars + "</div>" +
      '<div class="hint">' +
        (S.recording
          ? "Dictée en cours — parlez normalement, le texte s'écrit au fil de la phrase."
          : "La transcription du navigateur s'arrête aux silences&nbsp;: relancez-la si elle se coupe. " + osHelp) +
      "</div>";
  }

  function renderComposer() {
    $("composer").hidden = S.exam;
    if (S.exam) return;

    ["clavier", "dictee", "photo"].forEach(function (m) {
      $("tab-" + m).setAttribute("aria-selected", S.mode === m ? "true" : "false");
    });
    $("panel-dictee").hidden = S.mode !== "dictee";
    $("panel-photo").hidden = S.mode !== "photo";
    if (S.mode === "dictee") renderDictee();

    if ($("raw").value !== S.raw) $("raw").value = S.raw;

    var thumb = $("photo-thumb");
    if (S.photoUrl) { thumb.src = S.photoUrl; thumb.hidden = false; }
    else { thumb.hidden = true; thumb.removeAttribute("src"); }

    var analyse = $("btn-analyse");
    var busy = !!S.busy;
    analyse.disabled = busy || !S.raw.trim();
    analyse.innerHTML = busy
      ? '<span class="spinner"></span>' +
        (S.busy === "photo" ? "Lecture de la photo…"
          : S.busy === "classify" ? "Classement…" : "Rédaction…")
      : "Analyser et classer";

    $("chips").innerHTML = '<span class="hint" style="flex:0 1 auto">' +
      (S.specs.length ? "Classement dans l'une de vos " + S.specs.length + " spécialités." : "") +
      "</span>";
  }

  function renderProposal() {
    var p = S.proposal;
    var root = $("proposal");
    if (!p || S.exam) { root.innerHTML = ""; return; }

    if (p.decision === "refus") {
      root.innerHTML =
        '<section class="proposal refus">' +
          '<div class="proposal-head"><span class="tag">Écriture refusée</span>' +
          '<span class="route">Aucune écriture effectuée</span></div>' +
          "<h3>Rien n'a été écrit dans la fiche</h3>" +
          '<p class="refus-lede">L\'IA a un doute. En cas d\'incertitude sur le classement, ' +
          "le contenu ou la mise en forme, la règle est de <strong>ne rien écrire</strong> " +
          "plutôt que d'approximer.</p>" +
          '<ul class="reasons">' +
            p.reasons.map(function (r) { return "<li>" + esc(r) + "</li>"; }).join("") +
          "</ul>" +
          '<div class="proposal-actions">' +
            '<button class="btn-warn" type="button" data-act="reformulate">Je reformule</button>' +
            '<button class="btn-outline" type="button" data-act="manual">Classer moi-même</button>' +
          "</div>" +
        "</section>";
      return;
    }

    var merging = p.decision === "merge";
    root.innerHTML =
      '<section class="proposal">' +
        '<div class="proposal-head">' +
          '<span class="tag">' + (merging ? "Fusion proposée" : "Nouvelle notion") + "</span>" +
          '<span class="route">' + esc(p.spec) + " → " + esc(p.notionTitle) +
            (merging ? " · entrée existante complétée" : " · nouvelle notion clé") + "</span>" +
        "</div>" +
        "<h3>" + esc(p.notionTitle) + "</h3>" +
        '<div class="preview">' + B.render(p.blocks, S.images) + "</div>" +
        (p.note ? '<div class="proposal-note">' + esc(p.note) + "</div>" : "") +
        '<div class="proposal-actions">' +
          '<button class="btn-primary" type="button" data-act="accept">Ajouter à la fiche</button>' +
          '<button class="btn-outline" type="button" data-act="accept-edit">Ajouter et corriger</button>' +
          '<button class="btn-quiet" type="button" data-act="discard">Annuler</button>' +
        "</div>" +
      "</section>";
  }

  function renderNotion(n) {
    var editing = S.editingId === n.id;
    var key =
      '<div class="notion-key"><h3>' + esc(n.title) + "</h3>" +
      '<div class="notion-tags">' +
        (n.item ? '<span class="item-no">' + esc(n.item) + "</span>" : "") +
        (n.ai && !S.exam ? '<span class="badge-ai">IA</span>' : "") +
      "</div>" +
      (S.exam ? "" :
        '<button class="edit-link" type="button" data-edit="' + esc(n.id) + '">' +
        (editing ? "Édition en cours" : "Modifier") + "</button>") +
      "</div>";

    var body = editing
      ? '<div class="editor">' +
          '<label for="draft-' + esc(n.id) + '" hidden>Contenu de la notion</label>' +
          '<textarea id="draft-' + esc(n.id) + '" data-draft="' + esc(n.id) + '">' +
          esc(S.draft) + "</textarea>" +
          '<div class="editor-actions">' +
            '<button class="btn-save" type="button" data-save="' + esc(n.id) + '">Enregistrer</button>' +
            '<button class="btn-quiet" type="button" data-cancel="1">Annuler</button>' +
            '<span class="editor-help">Édition directe, sans IA — « a | b | c » fait un tableau, ' +
            "« • » une liste, « Mnémo : » un moyen mnémotechnique.</span>" +
          "</div>" +
        "</div>"
      : '<div class="blocks">' + B.render(n.blocks, S.images) + "</div>";

    return '<article class="notion' +
      (S.exam ? " compact" : "") +
      (S.flashId === n.id ? " flash" : "") + '">' +
      key + '<div class="notion-body">' + body + "</div></article>";
  }

  function renderSheet() {
    var list = visible();
    var root = $("sheet");
    if (!S.loaded) { root.innerHTML = ""; return; }

    if (!list.length) {
      root.innerHTML = '<div class="empty">' +
        (S.notions.length
          ? "Aucune notion ne correspond à « " + esc(S.query) + " »."
          : "La fiche est vide. Importez celle que vous tenez déjà, ou ajoutez votre première information.") +
        "</div>";
      return;
    }

    var order = S.specs.filter(function (s) {
      return list.some(function (n) { return n.spec === s; });
    });

    root.innerHTML = order.map(function (s) {
      var group = list.filter(function (n) { return n.spec === s; });
      return '<section class="section"><div class="section-head">' +
        "<h2>" + esc(s) + "</h2>" +
        '<span class="meta">' + group.length + (group.length > 1 ? " notions" : " notion") + "</span>" +
        "</div>" + group.map(renderNotion).join("") + "</section>";
    }).join("");
  }

  /* ---- la modale d'import ----------------------------------------------- */

  function excerpt(blocks) {
    var t = (blocks || []).map(B.blockText).join(" ");
    return t.length > 190 ? t.slice(0, 190) + "…" : t;
  }

  function renderImport() {
    var root = $("modal-root");
    if (!S.importOpen) { root.innerHTML = ""; return; }
    var inner;

    if (S.importStage === "working") {
      var p = S.importProgress || { done: 0, total: 1, label: "" };
      var pct = Math.round((p.done / Math.max(p.total, 1)) * 100);
      inner =
        "<h2 id=\"imp-t\">Analyse en cours</h2>" +
        "<p>" + esc(p.label) + "</p>" +
        '<div class="progress"><i style="width:' + pct + '%"></i></div>' +
        '<div class="proposal-note">' + p.done + " / " + p.total + " — rien n'est écrit tant que vous n'avez pas validé.</div>" +
        '<div class="modal-actions">' +
          '<button class="btn-outline" type="button" data-act="cancel-import">Arrêter</button>' +
        "</div>";
    } else if (S.importStage === "review") {
      var kept = S.importEntries.filter(function (_, i) { return !S.importSkip[i]; }).length;
      inner =
        "<h2 id=\"imp-t\">" + S.importEntries.length +
          (S.importEntries.length > 1 ? " entrées proposées" : " entrée proposée") + "</h2>" +
        "<p>Décochez ce que vous ne voulez pas. Rien n'entre dans la fiche avant " +
        "que vous ne validiez.</p>" +
        (S.importEntries.length
          ? '<div class="pick-list">' + S.importEntries.map(function (e, i) {
              return '<label class="pick"><input type="checkbox" data-pick="' + i + '"' +
                (S.importSkip[i] ? "" : " checked") + " />" +
                '<span class="pick-body">' +
                  '<span class="pick-title">' + esc(e.title) + "</span>" +
                  '<span class="pick-route">' + esc(e.spec) +
                    (e.action === "merge" ? " · complète une entrée existante" : " · nouvelle notion") +
                  "</span>" +
                  '<span class="pick-preview">' + esc(excerpt(e.blocks)) + "</span>" +
                "</span></label>";
            }).join("") + "</div>"
          : '<div class="empty" style="margin-top:0">Aucune entrée exploitable n\'a été tirée de ce document.</div>') +
        (S.importIgnores.length
          ? '<div class="notice" style="margin-top:14px"><strong>' + S.importIgnores.length +
            (S.importIgnores.length > 1 ? " passages écartés" : " passage écarté") + "</strong>" +
            '<ol>' + S.importIgnores.slice(0, 8).map(function (g) {
              return "<li>" + (g.extrait ? "<em>" + esc(g.extrait.slice(0, 70)) + "</em> — " : "") +
                esc(g.raison) + "</li>";
            }).join("") + "</ol>" +
            "<p>Rien n'en a été écrit : en cas de doute, la fiche reste en l'état.</p></div>"
          : "") +
        '<div class="modal-actions">' +
          '<button class="btn-primary" type="button" data-act="commit-import"' +
            (kept ? "" : " disabled") + ">Ajouter " + kept +
            (kept > 1 ? " entrées" : " entrée") + "</button>" +
          '<button class="btn-outline" type="button" data-act="close-import">Annuler</button>' +
        "</div>";
    } else {
      inner =
        "<h2 id=\"imp-t\">Compléter la fiche depuis un document</h2>" +
        "<p>Chargez un fichier — l'IA le découpe en notions et vous les montre " +
        "avant d'écrire quoi que ce soit.</p>" +
        (S.notions.length
          ? '<div class="proposal-note" style="margin:-8px 0 16px">Votre fiche d\'origine (' +
            S.notions.length + " notions, " + S.specs.length +
            " spécialités) est déjà en place : ce qui suit s'y ajoute.</div>"
          : "") +
        '<div class="import-file" id="drop">' +
          '<button class="btn-outline" type="button" data-act="pick-file">Choisir un fichier</button>' +
          '<span class="meta">' +
            (S.importName
              ? "<strong>" + esc(S.importName) + "</strong>" + (S.importInfo ? "<br />" + esc(S.importInfo) : "")
              : "…ou déposez-le ici. Formats acceptés&nbsp;: PDF, Word (.docx), Markdown, texte.") +
          "</span>" +
        "</div>" +
        '<div class="drop">' +
          '<label for="imp-text" hidden>Contenu à importer</label>' +
          '<textarea id="imp-text" placeholder="…ou collez directement le texte ici.">' +
          esc(S.importText) + "</textarea>" +
        "</div>" +
        '<div class="modal-actions">' +
          '<button class="btn-primary" type="button" data-act="do-import">Analyser</button>' +
          '<button class="btn-outline" type="button" data-act="close-import">Fermer</button>' +
        "</div>";
    }

    root.innerHTML = '<div class="scrim" data-scrim="1">' +
      '<div class="modal" role="dialog" aria-modal="true" aria-labelledby="imp-t">' + inner + "</div></div>";
  }

  function render() {
    renderStats();
    renderRail();
    renderComposer();
    renderProposal();
    renderSheet();
    renderImport();
    $("btn-exam").setAttribute("aria-pressed", S.exam ? "true" : "false");
    $("btn-exam").textContent = S.exam ? "Quitter la relecture" : "Mode relecture";
    $("btn-export").hidden = !downloads;
  }

  /* ---- écriture dans la fiche ------------------------------------------ */

  function flash(id) {
    S.flashId = id;
    clearTimeout(flashTimer);
    flashTimer = setTimeout(function () { S.flashId = null; render(); }, 1800);
  }

  function accept(thenEdit) {
    var p = S.proposal;
    if (!p || p.decision === "refus") return;

    var target;
    if (p.decision === "merge") {
      target = Object.assign({}, p.notion, {
        ai: true,
        blocks: (p.notion.blocks || []).concat(p.blocks),
      });
      S.notions = S.notions.map(function (n) { return n.id === target.id ? target : n; });
    } else {
      target = {
        id: FE.store.newId(), spec: p.spec, title: p.notionTitle,
        item: "", ai: true, blocks: p.blocks, order: S.notions.length,
      };
      S.notions = S.notions.concat([target]);
      S.specs = specsOf(S.notions);
    }

    S.proposal = null;
    S.raw = "";
    S.photoUrl = null;
    S.activeSpec = p.spec;
    if (thenEdit) { S.editingId = target.id; S.draft = B.toPlain(target.blocks); }
    flash(target.id);
    render();

    FE.store.saveNotion(target, S.notions).then(function () {
      toast(p.decision === "merge"
        ? "Entrée complétée : « " + p.notionTitle + " »"
        : "Nouvelle notion ajoutée : « " + p.notionTitle + " »");
    }).catch(function () {
      toast("L'enregistrement a échoué — la modification n'est visible que sur cet appareil.");
    });
  }

  function saveEdit(id) {
    var box = document.querySelector('[data-draft="' + id + '"]');
    var text = box ? box.value : S.draft;
    var blocks = B.parsePlain(text);
    var check = B.validate(blocks);
    if (!check.ok) { toast("Rien enregistré : " + check.error); return; }

    var updated = null;
    S.notions = S.notions.map(function (n) {
      if (n.id !== id) return n;
      updated = Object.assign({}, n, { blocks: blocks });
      return updated;
    });
    if (!updated) { toast("Cette notion n'existe plus."); return; }
    S.editingId = null;
    S.draft = "";
    render();

    FE.store.saveNotion(updated, S.notions).then(function () {
      toast("Entrée modifiée à la main.");
    }).catch(function () {
      toast("L'enregistrement a échoué — la modification n'est visible que sur cet appareil.");
    });
  }

  /* ---- analyse d'une note ---------------------------------------------- */

  function analyse() {
    var raw = S.raw.trim();
    if (!raw || S.busy) return;
    S.busy = "classify";
    S.proposal = null;
    render();

    FE.ai.classify(raw, S.notions, S.specs).then(function (verdict) {
      if (verdict.decision === "refus") {
        S.busy = null; S.proposal = verdict; render();
        return null;
      }
      S.busy = "structure";
      render();
      return FE.ai.structure(raw, verdict).then(function (out) {
        S.busy = null; S.proposal = out; render();
      });
    }).catch(function () {
      S.busy = null;
      S.proposal = { decision: "refus", reasons: ["L'analyse a échoué — rien n'a été écrit."] };
      render();
    });
  }

  /* ---- import d'un document -------------------------------------------- */

  var importCancelled = false;

  function chooseFile(file) {
    if (!file) return;
    pendingFile = file;
    S.importName = file.name || "document";
    S.importInfo = "Lecture…";
    render();
    FE.reader.read(file, function (done, total) {
      S.importInfo = "Lecture de la page " + done + " sur " + total + "…";
      renderImport();
    }).then(function (res) {
      S.importText = res.text;
      var chars = res.text.replace(/\s+/g, " ").length;
      S.importInfo = (res.pages ? res.pages + " pages · " : "") +
        chars.toLocaleString("fr-FR") + " caractères · " +
        FE.reader.chunk(res.text).length + " lots à analyser";
      render();
    }).catch(function (e) {
      pendingFile = null;
      S.importName = "";
      S.importInfo = "";
      render();
      toast(e && e.message ? e.message : "Ce fichier n'a pas pu être lu.");
    });
  }

  function runImport() {
    var box = $("imp-text");
    var text = (box ? box.value : S.importText).trim();
    if (!text) { toast("Chargez un fichier ou collez du texte à analyser."); return; }

    var chunks = FE.reader.chunk(text);
    importCancelled = false;
    S.importText = text;
    S.importStage = "working";
    S.importEntries = [];
    S.importIgnores = [];
    S.importSkip = {};
    S.importProgress = { done: 0, total: chunks.length, label: "Analyse du document…" };
    render();

    function step(i) {
      if (importCancelled) return Promise.resolve();
      if (i >= chunks.length) return Promise.resolve();
      S.importProgress = {
        done: i, total: chunks.length,
        label: "Lot " + (i + 1) + " sur " + chunks.length + " — lecture et mise en forme.",
      };
      renderImport();
      return FE.ai.extractNotions(chunks[i], S.notions, S.specs).then(function (out) {
        S.importEntries = S.importEntries.concat(out.entrees || []);
        S.importIgnores = S.importIgnores.concat(out.ignores || []);
        return step(i + 1);
      });
    }

    step(0).then(function () {
      S.importProgress = null;
      S.importStage = importCancelled && !S.importEntries.length ? "pick" : "review";
      render();
    }).catch(function () {
      S.importProgress = null;
      S.importStage = "review";
      render();
      toast("L'analyse s'est interrompue — rien n'a été écrit.");
    });
  }

  function commitImport() {
    var keep = S.importEntries.filter(function (_, i) { return !S.importSkip[i]; });
    if (!keep.length) return;

    // Plusieurs lots peuvent viser la même notion : on les cumule avant
    // d'écrire, pour n'enregistrer chaque document qu'une fois.
    var byId = {};
    var created = [];
    keep.forEach(function (e) {
      if (e.action === "merge" && e.notion) {
        var cur = byId[e.notion.id] || Object.assign({}, e.notion, {
          ai: true, blocks: (e.notion.blocks || []).slice(),
        });
        cur.blocks = cur.blocks.concat(e.blocks);
        byId[e.notion.id] = cur;
      } else {
        created.push({
          id: FE.store.newId(), spec: e.spec, title: e.title,
          item: "", ai: true, blocks: e.blocks, order: S.notions.length + created.length,
        });
      }
    });

    var merged = Object.keys(byId).map(function (k) { return byId[k]; });
    S.notions = S.notions
      .map(function (n) { return byId[n.id] || n; })
      .concat(created);
    S.specs = specsOf(S.notions);

    var all = merged.concat(created);
    S.importStage = "working";
    S.importProgress = { done: 0, total: all.length, label: "Écriture dans la fiche…" };
    render();

    var i = 0;
    function write() {
      if (i >= all.length) return Promise.resolve();
      S.importProgress = { done: i, total: all.length, label: "Écriture dans la fiche…" };
      renderImport();
      var n = all[i];
      i += 1;
      return FE.store.saveNotion(n, S.notions).then(write);
    }

    write().then(function () {
      S.importOpen = false;
      S.importStage = "pick";
      S.importEntries = [];
      S.importIgnores = [];
      S.importText = "";
      S.importName = "";
      S.importInfo = "";
      S.importProgress = null;
      pendingFile = null;
      render();
      toast(all.length + (all.length > 1 ? " entrées ajoutées." : " entrée ajoutée."));
    }).catch(function () {
      S.importProgress = null;
      S.importStage = "review";
      render();
      toast("L'écriture a échoué — rechargez la page pour repartir de l'état enregistré.");
    });
  }

  /* ---- export ----------------------------------------------------------- */

  function toMarkdown() {
    var out = ["# Fiche EDN", ""];
    S.specs.forEach(function (s) {
      var group = S.notions.filter(function (n) { return n.spec === s; });
      if (!group.length) return;
      out.push("## " + s, "");
      group.forEach(function (n) {
        out.push("### " + n.title, "");
        (n.blocks || []).forEach(function (b) {
          if (b.type === "list") b.items.forEach(function (i) { out.push("- " + i); });
          else if (b.type === "table") {
            out.push("| " + b.head.join(" | ") + " |");
            out.push("|" + b.head.map(function () { return " --- "; }).join("|") + "|");
            b.rows.forEach(function (r) { out.push("| " + r.join(" | ") + " |"); });
          } else if (b.type === "mnemo") out.push("> **Mnémo** — " + b.text);
          else if (b.type === "schema") out.push("_[schéma : " + (b.text || b.imageId || "image") + "]_");
          else out.push(b.text);
          out.push("");
        });
      });
    });
    return out.join("\n");
  }

  function exportFiche() {
    if (!downloads) return;
    var stamp = new Date().toISOString().slice(0, 10);
    downloads.save({ filename: "fiche-edn-" + stamp + ".md", data: toMarkdown() })
      .then(function () { toast("Fiche exportée."); })
      .catch(function () { toast("Export annulé."); });
  }

  /* ---- micro et dictée --------------------------------------------------- */

  function setupRecognition() {
    var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return null;
    var r;
    try { r = new SR(); } catch (e) { return null; }
    r.lang = "fr-FR";
    r.continuous = true;
    r.interimResults = true;

    var committed = "";
    r.onstart = function () { committed = S.raw ? S.raw.replace(/\s*$/, " ") : ""; };
    r.onresult = function (ev) {
      var interim = "";
      for (var i = ev.resultIndex; i < ev.results.length; i++) {
        var chunk = ev.results[i][0].transcript;
        if (ev.results[i].isFinal) committed += chunk;
        else interim += chunk;
      }
      S.raw = (committed + interim).replace(/\s+/g, " ").replace(/^\s+/, "");
      $("raw").value = S.raw;
      $("btn-analyse").disabled = !S.raw.trim();
    };
    r.onerror = function (ev) {
      S.recording = false;
      var err = ev && ev.error;
      if (err === "not-allowed" || err === "service-not-allowed") S.micState = "denied";
      render();
      if (err && err !== "aborted" && err !== "no-speech" && S.micState !== "denied") {
        toast("La dictée s'est interrompue. Le micro du clavier reste plus fiable.");
      }
    };
    r.onend = function () { S.recording = false; render(); };
    return r;
  }

  /* Demande la permission explicitement : c'est ce qui déclenche la boîte de
     dialogue du navigateur, au lieu de laisser un bouton inerte. */
  function askMic() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      return Promise.resolve(true); // on laissera la reconnaissance demander elle-même
    }
    return navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
      stream.getTracks().forEach(function (t) { t.stop(); });
      S.micState = "granted";
      return true;
    }).catch(function (err) {
      var name = err && err.name;
      if (name === "NotFoundError" || name === "DevicesNotFoundError") {
        S.micState = "denied";
        toast("Aucun micro détecté sur cet appareil.");
      } else {
        S.micState = "denied";
      }
      return false;
    });
  }

  function refreshMicState() {
    if (!recognition) { S.micState = "unsupported"; return Promise.resolve(); }
    if (!navigator.permissions || !navigator.permissions.query) {
      if (S.micState !== "granted" && S.micState !== "denied") S.micState = "unknown";
      return Promise.resolve();
    }
    return navigator.permissions.query({ name: "microphone" }).then(function (st) {
      S.micState = st.state === "granted" ? "granted" : st.state === "denied" ? "denied" : "unknown";
      st.onchange = function () {
        S.micState = st.state === "granted" ? "granted" : st.state === "denied" ? "denied" : "unknown";
        render();
      };
    }).catch(function () {
      if (S.micState !== "granted" && S.micState !== "denied") S.micState = "unknown";
    });
  }

  function startDictation() {
    if (!recognition) return;
    try {
      recognition.start();
      S.recording = true;
    } catch (e) {
      S.recording = false;
      toast("La dictée est déjà en cours.");
    }
    render();
  }

  function onMic(action) {
    if (action === "keyboard") { S.mode = "clavier"; render(); $("raw").focus(); return; }
    if (action === "ask" || action === "retry") {
      askMic().then(function (ok) {
        render();
        if (ok) startDictation();
        else toast("Le micro reste bloqué — la marche à suivre est indiquée ci-dessus.");
      });
      return;
    }
    if (action === "toggle") {
      if (S.recording) { try { recognition.stop(); } catch (e) {} S.recording = false; render(); return; }
      if (S.micState === "granted") startDictation();
      else askMic().then(function (ok) { render(); if (ok) startDictation(); });
    }
  }

  /* ---- photo ------------------------------------------------------------ */

  function onPhoto(file) {
    if (!file) return;
    if (S.photoUrl) URL.revokeObjectURL(S.photoUrl);
    S.photoUrl = URL.createObjectURL(file);
    S.busy = "photo";
    render();

    FE.ai.readPhoto(file).then(function (out) {
      S.busy = null;
      if (out.error) { toast(out.error); render(); return; }
      S.raw = out.text;
      S.mode = "clavier";
      render();
      toast("Texte extrait de la photo — relisez-le avant de le classer.");
    }).catch(function () {
      S.busy = null;
      toast("La lecture de la photo a échoué.");
      render();
    });
  }

  /* ---- événements -------------------------------------------------------- */

  function wire() {
    $("btn-theme").addEventListener("click", cycleTheme);

    $("q").addEventListener("input", function (e) { S.query = e.target.value; renderSheet(); });

    $("raw").addEventListener("input", function (e) {
      S.raw = e.target.value;
      $("btn-analyse").disabled = !S.raw.trim() || !!S.busy;
    });

    ["clavier", "dictee", "photo"].forEach(function (m) {
      $("tab-" + m).addEventListener("click", function () {
        S.mode = m;
        if (m !== "dictee" && S.recording && recognition) { try { recognition.stop(); } catch (e) {} }
        if (m === "dictee") refreshMicState().then(render);
        else render();
      });
    });

    $("panel-dictee").addEventListener("click", function (e) {
      var b = e.target.closest("[data-mic]");
      if (b) onMic(b.getAttribute("data-mic"));
    });

    $("btn-analyse").addEventListener("click", analyse);
    $("btn-photo").addEventListener("click", function () { $("photo").click(); });
    $("photo").addEventListener("change", function (e) { onPhoto(e.target.files && e.target.files[0]); });

    $("btn-exam").addEventListener("click", function () {
      S.exam = !S.exam; S.proposal = null; S.editingId = null; render();
    });

    $("btn-import").addEventListener("click", function () {
      S.importOpen = true; S.importStage = "pick"; render();
    });
    $("btn-export").addEventListener("click", exportFiche);

    $("import-file-input").addEventListener("change", function (e) {
      chooseFile(e.target.files && e.target.files[0]);
      e.target.value = "";
    });

    $("rail").addEventListener("click", function (e) {
      var b = e.target.closest("[data-spec]");
      if (!b) return;
      S.activeSpec = b.getAttribute("data-spec");
      render();
    });

    $("proposal").addEventListener("click", function (e) {
      var b = e.target.closest("[data-act]");
      if (!b) return;
      var act = b.getAttribute("data-act");
      if (act === "accept") accept(false);
      else if (act === "accept-edit") accept(true);
      else if (act === "discard" || act === "reformulate") { S.proposal = null; render(); }
      else if (act === "manual") {
        S.proposal = null; render();
        toast("Choisissez la spécialité dans la colonne de gauche, puis « Modifier » sur la notion.");
      }
    });

    $("sheet").addEventListener("click", function (e) {
      var ed = e.target.closest("[data-edit]");
      if (ed) {
        var id = ed.getAttribute("data-edit");
        var n = S.notions.filter(function (x) { return x.id === id; })[0];
        if (!n) return;
        S.editingId = S.editingId === id ? null : id;
        S.draft = S.editingId ? B.toPlain(n.blocks) : "";
        render();
        var box = document.querySelector('[data-draft="' + id + '"]');
        if (box) box.focus();
        return;
      }
      var sv = e.target.closest("[data-save]");
      if (sv) { saveEdit(sv.getAttribute("data-save")); return; }
      if (e.target.closest("[data-cancel]")) { S.editingId = null; S.draft = ""; render(); }
    });

    var modal = $("modal-root");
    modal.addEventListener("click", function (e) {
      var b = e.target.closest("[data-act]");
      if (b) {
        var act = b.getAttribute("data-act");
        if (act === "close-import") {
          S.importOpen = false; S.importStage = "pick"; S.importEntries = []; S.importIgnores = [];
          render();
        } else if (act === "pick-file") $("import-file-input").click();
        else if (act === "do-import") runImport();
        else if (act === "cancel-import") { importCancelled = true; toast("Analyse arrêtée — rien n'a été écrit."); }
        else if (act === "commit-import") commitImport();
        return;
      }
      if (e.target.hasAttribute("data-scrim") && S.importStage !== "working") {
        S.importOpen = false; render();
      }
    });
    modal.addEventListener("change", function (e) {
      var pick = e.target.closest("[data-pick]");
      if (!pick) return;
      S.importSkip[pick.getAttribute("data-pick")] = !pick.checked;
      renderImport();
    });
    modal.addEventListener("input", function (e) {
      if (e.target.id === "imp-text") S.importText = e.target.value;
    });
    ["dragover", "dragleave", "drop"].forEach(function (kind) {
      modal.addEventListener(kind, function (e) {
        var zone = e.target.closest ? e.target.closest("#drop") : null;
        if (!zone && kind !== "dragover") return;
        e.preventDefault();
        if (kind === "dragover" && zone) zone.classList.add("over");
        if (kind === "dragleave" && zone) zone.classList.remove("over");
        if (kind === "drop") {
          if (zone) zone.classList.remove("over");
          var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
          if (f) chooseFile(f);
        }
      });
    });

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && S.importOpen && S.importStage !== "working") {
        S.importOpen = false; render();
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && document.activeElement === $("raw")) {
        e.preventDefault(); analyse();
      }
    });
  }

  /* ---- démarrage --------------------------------------------------------- */

  function boot() {
    initTheme();
    recognition = setupRecognition();
    if (!recognition) S.micState = "unsupported";
    wire();
    render();

    FE.store.init().then(function () {
      // Base vide : c'est le tout premier lancement sur ce compte, la fiche
      // embarquée avec la page s'y installe d'elle-même.
      return FE.store.seedIfEmpty(function (done, total) {
        $("stats").textContent = "installation de la fiche… " + done + " / " + total;
      });
    }).then(function (res) {
      S.notions = res.notions || [];
      S.specs = specsOf(S.notions);
      S.loaded = true;
      render();
      if (res.seeded) toast("Fiche installée : " + S.notions.length + " notions, " + S.specs.length + " spécialités.");
      $("rail-foot").textContent = FE.store.online
        ? "Fiche personnelle, enregistrée sur votre compte."
        : "Hors ligne : les modifications restent sur cet appareil.";
    }).catch(function () {
      S.loaded = true;
      render();
      toast("La fiche n'a pas pu être chargée.");
    });

    if (window.claude && typeof window.claude.use === "function") {
      window.claude.use("downloads").then(function (d) {
        downloads = d;
        $("btn-export").hidden = !d;
      }).catch(function () {});
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
