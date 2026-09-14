/* Lecture d'un fichier déposé : .txt, .md, .docx, .pdf → du texte brut.

   Les bibliothèques ne sont chargées qu'au moment où un fichier en a besoin :
   ouvrir la fiche pour la relire ne doit rien télécharger de plus. */
(function () {
  "use strict";

  var FE = (window.FE = window.FE || {});

  // Seul cdnjs est admis par la politique de sécurité des artifacts.
  var PDFJS = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
  var PDFJS_WORKER = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
  var MAMMOTH = "https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.9.0/mammoth.browser.min.js";

  var loaded = {};

  function loadScript(url) {
    if (loaded[url]) return loaded[url];
    loaded[url] = new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      s.src = url;
      s.onload = function () { resolve(); };
      s.onerror = function () {
        loaded[url] = null;
        reject(new Error("chargement impossible"));
      };
      document.head.appendChild(s);
    });
    return loaded[url];
  }

  function readAsText(file) {
    if (file.text) return file.text();
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () { resolve(String(r.result)); };
      r.onerror = function () { reject(new Error("lecture impossible")); };
      r.readAsText(file);
    });
  }

  function readAsBuffer(file) {
    if (file.arrayBuffer) return file.arrayBuffer();
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () { resolve(r.result); };
      r.onerror = function () { reject(new Error("lecture impossible")); };
      r.readAsArrayBuffer(file);
    });
  }

  /* Les mots d'une page PDF sont regroupés en lignes par leur ordonnée :
     sans cela tout le texte revient en un seul bloc illisible. */
  function pageToText(content) {
    var lines = [];
    var current = null;
    content.items.forEach(function (item) {
      if (!item.str) return;
      var y = Math.round(item.transform[5]);
      if (!current || Math.abs(current.y - y) > 2) {
        current = { y: y, parts: [] };
        lines.push(current);
      }
      current.parts.push(item.str);
    });
    return lines
      .map(function (l) { return l.parts.join(" ").replace(/\s+/g, " ").trim(); })
      .filter(Boolean)
      .join("\n");
  }

  function readPdf(file, onProgress) {
    return loadScript(PDFJS).then(function () {
      var lib = window.pdfjsLib;
      if (!lib) throw new Error("pdf.js indisponible");
      try { lib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER; } catch (e) { /* repli sans worker */ }
      return readAsBuffer(file).then(function (buf) {
        return lib.getDocument({ data: buf }).promise;
      });
    }).then(function (pdf) {
      var pages = [];
      function next(i) {
        if (i > pdf.numPages) return Promise.resolve(pages);
        if (onProgress) onProgress(i, pdf.numPages);
        return pdf.getPage(i)
          .then(function (page) { return page.getTextContent(); })
          .then(function (content) {
            pages.push(pageToText(content));
            return next(i + 1);
          });
      }
      return next(1).then(function (all) {
        return { text: all.join("\n\n"), pages: pdf.numPages };
      });
    });
  }

  function readDocx(file) {
    return loadScript(MAMMOTH).then(function () {
      if (!window.mammoth) throw new Error("mammoth indisponible");
      return readAsBuffer(file);
    }).then(function (buf) {
      return window.mammoth.extractRawText({ arrayBuffer: buf });
    }).then(function (res) {
      return { text: res.value || "", pages: 0 };
    });
  }

  var EXT = /\.([a-z0-9]+)$/i;

  function read(file, onProgress) {
    var ext = (EXT.exec(file.name || "") || [])[1];
    ext = (ext || "").toLowerCase();

    if (ext === "pdf" || file.type === "application/pdf") {
      return readPdf(file, onProgress).catch(function () {
        throw new Error("Ce PDF n'a pas pu être lu. S'il s'agit d'un scan, photographiez plutôt les pages : l'IA sait les lire.");
      });
    }
    if (ext === "docx") {
      return readDocx(file).catch(function () {
        throw new Error("Ce document Word n'a pas pu être lu. Enregistrez-le en .txt, ou collez son contenu.");
      });
    }
    if (ext === "doc") {
      return Promise.reject(new Error("Le format .doc (ancien Word) n'est pas lisible ici. Enregistrez le document en .docx."));
    }
    if (ext === "txt" || ext === "md" || ext === "markdown" || ext === "csv" ||
        (file.type || "").indexOf("text/") === 0) {
      return readAsText(file).then(function (t) { return { text: t, pages: 0 }; });
    }
    return Promise.reject(new Error("Format non reconnu. Acceptés : .pdf, .docx, .md, .txt — ou collez le texte."));
  }

  /* Découpe le texte en lots qui tiennent dans un appel, sans couper un
     paragraphe en deux. */
  function chunk(text, size) {
    var max = size || 6000;
    var paras = String(text).split(/\n\s*\n/);
    var out = [];
    var cur = "";
    paras.forEach(function (p) {
      p = p.trim();
      if (!p) return;
      if (cur && (cur.length + p.length + 2) > max) { out.push(cur); cur = p; }
      else cur = cur ? cur + "\n\n" + p : p;
    });
    if (cur) out.push(cur);
    // Un paragraphe seul plus long que la limite est coupé en dernier recours.
    var safe = [];
    out.forEach(function (c) {
      while (c.length > max * 1.6) { safe.push(c.slice(0, max)); c = c.slice(max); }
      safe.push(c);
    });
    return safe.filter(function (c) { return c.trim(); });
  }

  FE.reader = { read: read, chunk: chunk, accept: ".pdf,.docx,.md,.markdown,.txt,.csv" };
})();
