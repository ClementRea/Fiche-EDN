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
    photoFile: null,
    photoUrl: null,
    busy: null,
    proposal: null,
    editingId: null,
    draft: "",
    flashId: null,
    importOpen: false,
    importText: "",
    importBusy: null,
    loaded: false,
  };

  var $ = function (id) { return document.getElementById(id); };
  var downloads = null;
  var recognition = null;
  var toastTimer = null;
  var flashTimer = null;

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

  function renderComposer() {
    $("composer").hidden = S.exam;
    if (S.exam) return;

    ["clavier", "dictee", "photo"].forEach(function (m) {
      $("tab-" + m).setAttribute("aria-selected", S.mode === m ? "true" : "false");
    });
    $("panel-dictee").hidden = S.mode !== "dictee";
    $("panel-photo").hidden = S.mode !== "photo";

    if ($("raw").value !== S.raw) $("raw").value = S.raw;

    var bars = $("bars");
    if (!bars.childElementCount) {
      var html = "";
      for (var i = 0; i < 14; i++) html += '<i style="animation-delay:' + (i * 55) + 'ms"></i>';
      bars.innerHTML = html;
    }
    bars.className = "bars" + (S.recording ? " on" : "");

    var rec = $("btn-rec");
    rec.setAttribute("aria-pressed", S.recording ? "true" : "false");
    rec.textContent = S.recording ? "■" : "●";
    rec.setAttribute("aria-label", S.recording ? "Arrêter la dictée" : "Démarrer la dictée");
    rec.disabled = !recognition;

    $("rec-hint").innerHTML = recognition
      ? (S.recording
        ? "Dictée en cours — parlez normalement, le texte s'écrit au fil de la phrase."
        : "La reconnaissance du navigateur s'arrête aux silences : relancez-la si elle se coupe. Sur iPhone, le micro du clavier reste plus fiable.")
      : "Ce navigateur ne fait pas de reconnaissance vocale. Utilisez la dictée du système : le micro du clavier sur iPhone et iPad, ou <strong>Fn Fn</strong> sur Mac — elle écrit directement dans le champ ci-dessus.";

    var thumb = $("photo-thumb");
    if (S.photoUrl) { thumb.src = S.photoUrl; thumb.hidden = false; }
    else { thumb.hidden = true; thumb.removeAttribute("src"); }

    var analyse = $("btn-analyse");
    var busy = S.busy === "classify" || S.busy === "structure" || S.busy === "photo";
    analyse.disabled = busy || !S.raw.trim();
    analyse.innerHTML = busy
      ? '<span class="spinner"></span>' +
        (S.busy === "photo" ? "Lecture de la photo…"
          : S.busy === "classify" ? "Classement…" : "Rédaction…")
      : "Analyser et classer";

    $("chips").innerHTML = '<span class="hint" style="flex:0 1 auto">' +
      (S.specs.length
        ? "Classement dans l'une de vos " + S.specs.length + " spécialités."
        : "") + "</span>";
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

  function renderModal() {
    var root = $("modal-root");
    if (!S.importOpen) { root.innerHTML = ""; return; }
    var busy = !!S.importBusy;
    root.innerHTML =
      '<div class="scrim" data-scrim="1"><div class="modal" role="dialog" aria-modal="true" aria-labelledby="imp-t">' +
        '<h2 id="imp-t">Compléter la fiche depuis un document</h2>' +
        "<p>Collez ici le contenu d'un cours ou d'une fiche — l'IA le découpe en notions " +
        "et vous le montre avant d'écrire quoi que ce soit. Votre fiche d'origine, elle, " +
        "est déjà en place.</p>" +
        '<div class="drop">' +
          '<label for="imp-text" hidden>Contenu à importer</label>' +
          '<textarea id="imp-text" placeholder="Collez le texte ici…">' + esc(S.importText) + "</textarea>" +
        "</div>" +
        (busy ? '<div class="proposal-note"><span class="spinner"></span>' + esc(S.importBusy) + "</div>" : "") +
        '<div class="modal-actions">' +
          '<button class="btn-primary" type="button" data-act="do-import"' + (busy ? " disabled" : "") + ">Analyser le texte</button>" +
          '<button class="btn-outline" type="button" data-act="close-import">Fermer</button>' +
        "</div>" +
      "</div></div>";
  }

  function render() {
    renderStats();
    renderRail();
    renderComposer();
    renderProposal();
    renderSheet();
    renderModal();
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
        id: FE.store.newId(),
        spec: p.spec,
        title: p.notionTitle,
        item: "",
        ai: true,
        blocks: p.blocks,
        order: S.notions.length,
      };
      S.notions = S.notions.concat([target]);
      S.specs = specsOf(S.notions);
    }

    S.proposal = null;
    S.raw = "";
    S.photoFile = null;
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

  /* ---- analyse ---------------------------------------------------------- */

  function analyse() {
    var raw = S.raw.trim();
    if (!raw || S.busy) return;

    S.busy = "classify";
    S.proposal = null;
    render();

    FE.ai.classify(raw, S.notions, S.specs).then(function (verdict) {
      if (verdict.decision === "refus") {
        S.busy = null;
        S.proposal = verdict;
        render();
        return null;
      }
      S.busy = "structure";
      render();
      return FE.ai.structure(raw, verdict).then(function (out) {
        S.busy = null;
        S.proposal = out;
        render();
      });
    }).catch(function () {
      S.busy = null;
      S.proposal = { decision: "refus", reasons: ["L'analyse a échoué — rien n'a été écrit."] };
      render();
    });
  }

  /* ---- import depuis du texte collé ------------------------------------ */

  function runImport() {
    var text = ($("imp-text") ? $("imp-text").value : S.importText).trim();
    if (!text) { toast("Collez d'abord du texte à analyser."); return; }
    S.importText = text;
    S.importBusy = "Analyse du texte…";
    render();

    FE.ai.classify(text, S.notions, S.specs).then(function (verdict) {
      if (verdict.decision === "refus") {
        S.importBusy = null;
        S.importOpen = false;
        S.proposal = verdict;
        render();
        return null;
      }
      S.importBusy = "Rédaction de l'entrée…";
      render();
      return FE.ai.structure(text, verdict).then(function (out) {
        S.importBusy = null;
        S.importOpen = false;
        S.importText = "";
        S.raw = text;
        S.proposal = out;
        render();
      });
    }).catch(function () {
      S.importBusy = null;
      toast("L'analyse a échoué — rien n'a été écrit.");
      render();
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
          if (b.type === "list") {
            b.items.forEach(function (i) { out.push("- " + i); });
          } else if (b.type === "table") {
            out.push("| " + b.head.join(" | ") + " |");
            out.push("|" + b.head.map(function () { return " --- "; }).join("|") + "|");
            b.rows.forEach(function (r) { out.push("| " + r.join(" | ") + " |"); });
          } else if (b.type === "mnemo") {
            out.push("> **Mnémo** — " + b.text);
          } else if (b.type === "schema") {
            out.push("_[schéma : " + (b.text || b.imageId || "image") + "]_");
          } else {
            out.push(b.text);
          }
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

  /* ---- dictée ----------------------------------------------------------- */

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
      S.raw = (committed + interim).replace(/\s+/g, " ").trimStart();
      $("raw").value = S.raw;
      $("btn-analyse").disabled = !S.raw.trim();
    };
    r.onerror = function (ev) {
      S.recording = false;
      render();
      if (ev && ev.error === "not-allowed") {
        toast("Micro refusé. Autorisez-le, ou utilisez la dictée du clavier.");
      } else if (ev && ev.error !== "aborted") {
        toast("La dictée s'est interrompue. Le micro du clavier reste plus fiable.");
      }
    };
    r.onend = function () { S.recording = false; render(); };
    return r;
  }

  function toggleRec() {
    if (!recognition) return;
    if (S.recording) { try { recognition.stop(); } catch (e) {} S.recording = false; render(); return; }
    try {
      recognition.start();
      S.recording = true;
    } catch (e) {
      S.recording = false;
      toast("Impossible de démarrer la dictée.");
    }
    render();
  }

  /* ---- photo ------------------------------------------------------------ */

  function onPhoto(file) {
    if (!file) return;
    if (S.photoUrl) URL.revokeObjectURL(S.photoUrl);
    S.photoFile = file;
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
    $("q").addEventListener("input", function (e) { S.query = e.target.value; renderSheet(); });

    $("raw").addEventListener("input", function (e) {
      S.raw = e.target.value;
      $("btn-analyse").disabled = !S.raw.trim() || !!S.busy;
    });

    ["clavier", "dictee", "photo"].forEach(function (m) {
      $("tab-" + m).addEventListener("click", function () {
        S.mode = m;
        if (m !== "dictee" && S.recording && recognition) { try { recognition.stop(); } catch (e) {} }
        render();
      });
    });

    $("btn-rec").addEventListener("click", toggleRec);
    $("btn-analyse").addEventListener("click", analyse);

    $("btn-photo").addEventListener("click", function () { $("photo").click(); });
    $("photo").addEventListener("change", function (e) { onPhoto(e.target.files && e.target.files[0]); });

    $("btn-exam").addEventListener("click", function () {
      S.exam = !S.exam;
      S.proposal = null;
      S.editingId = null;
      render();
    });

    $("btn-import").addEventListener("click", function () { S.importOpen = true; render(); });
    $("btn-export").addEventListener("click", exportFiche);

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
        S.proposal = null;
        render();
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

    $("modal-root").addEventListener("click", function (e) {
      var b = e.target.closest("[data-act]");
      if (b) {
        var act = b.getAttribute("data-act");
        if (act === "close-import") { S.importOpen = false; render(); }
        else if (act === "do-import") runImport();
        return;
      }
      if (e.target.hasAttribute("data-scrim") && !S.importBusy) { S.importOpen = false; render(); }
    });

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && S.importOpen && !S.importBusy) { S.importOpen = false; render(); }
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && document.activeElement === $("raw")) {
        e.preventDefault();
        analyse();
      }
    });
  }

  /* ---- démarrage --------------------------------------------------------- */

  function boot() {
    recognition = setupRecognition();
    wire();
    render();

    FE.store.init().then(function () {
      return FE.store.loadNotions();
    }).then(function (notions) {
      S.notions = notions;
      S.specs = specsOf(notions);
      S.loaded = true;
      render();
      // Les schémas pèsent lourd : ils arrivent après le premier rendu.
      return FE.store.loadImages();
    }).then(function (images) {
      S.images = images || {};
      if (Object.keys(S.images).length) render();
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
      FE.ai.available().then(function (s) {
        if (!s) toast("L'IA n'est pas disponible ici : la fiche reste consultable et modifiable à la main.");
      });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
