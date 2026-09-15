/* La persistance. `db` quand la page tourne dans un viewer Claude, sinon un
   repli localStorage pour que la fiche reste lisible hors ligne. Un document
   par notion : le plafond est de 256 Kio par document et de 5 000 documents. */
(function () {
  "use strict";

  var FE = (window.FE = window.FE || {});
  var LS_KEY = "fiche-edn-v1";

  var db = null;
  var ready = false;

  function localRead() {
    try {
      var raw = window.localStorage.getItem(LS_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  function localWrite(notions) {
    try {
      window.localStorage.setItem(LS_KEY, JSON.stringify({ notions: notions }));
    } catch (e) { /* quota plein ou stockage bloqué : la session reste utilisable */ }
  }

  /* La fiche de départ pèse 76 Kio : on ne la charge que si la base est
     vide, jamais pour une simple relecture. */
  function loadSeed() {
    if (window.FE_SEED) return Promise.resolve(window.FE_SEED);
    return new Promise(function (resolve) {
      var s = document.createElement("script");
      s.src = "fiche-data.js";
      s.onload = function () { resolve(window.FE_SEED || null); };
      s.onerror = function () { resolve(null); };
      document.head.appendChild(s);
    });
  }

  function newId() {
    return "n" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  var store = {
    online: false,

    init: function () {
      if (ready) return Promise.resolve(store.online);
      ready = true;
      if (!window.claude || typeof window.claude.use !== "function") {
        return Promise.resolve(false);
      }
      return window.claude.use("db").then(function (handle) {
        db = handle;
        store.online = !!handle;
        return store.online;
      }).catch(function () { return false; });
    },

    /* Toutes les notions, ordonnées comme dans la fiche d'origine. */
    loadNotions: function () {
      if (!db) {
        var local = localRead();
        return Promise.resolve(local && local.notions ? local.notions : []);
      }
      return db.collection("notions").get().then(function (snap) {
        var out = snap.docs.map(function (d) {
          var data = d.data() || {};
          data.id = d.id;
          return data;
        });
        out.sort(function (a, b) { return (a.order || 0) - (b.order || 0); });
        return out;
      });
    },

    loadMeta: function () {
      if (!db) return Promise.resolve(null);
      return db.doc("meta/fiche").get().then(function (d) {
        return d.exists ? d.data() : null;
      }).catch(function () { return null; });
    },

    /* Les schémas sont volumineux : on les charge après le premier rendu. */
    loadImages: function () {
      if (!db) return Promise.resolve({});
      return db.collection("images").get().then(function (snap) {
        var map = {};
        snap.docs.forEach(function (d) {
          var data = d.data() || {};
          if (data.dataUrl) map[d.id] = data.dataUrl;
        });
        return map;
      }).catch(function () { return {}; });
    },

    saveNotion: function (notion, allNotions) {
      var n = Object.assign({}, notion);
      if (!n.id) n.id = newId();
      n.updatedAt = new Date().toISOString();
      if (!n.createdAt) n.createdAt = n.updatedAt;
      if (!db) { localWrite(allNotions || []); return Promise.resolve(n); }
      var id = n.id;
      var body = Object.assign({}, n);
      delete body.id;
      return db.doc("notions/" + id).set(body).then(function () { return n; });
    },

    removeNotion: function (id, allNotions) {
      if (!db) { localWrite(allNotions || []); return Promise.resolve(); }
      return db.doc("notions/" + id).delete();
    },

    /* Import en masse : écrit une notion à la fois pour qu'un échec en
       milieu de course laisse quand même la fiche cohérente. */
    importNotions: function (list, onProgress) {
      var i = 0;
      var saved = [];
      function step() {
        if (i >= list.length) return Promise.resolve(saved);
        var n = Object.assign({}, list[i], { order: i });
        i += 1;
        if (onProgress) onProgress(i, list.length);
        return store.saveNotion(n, null).then(function (s) {
          saved.push(s);
          return step();
        });
      }
      return step().then(function (out) {
        if (!db) localWrite(out);
        return out;
      });
    },

    /* Au tout premier lancement la base est vide : on y verse la fiche
       embarquée avec la page. C'est ce qui rend l'application installable
       sur n'importe quel compte sans écrire 187 documents à la main. */
    seedIfEmpty: function (onProgress) {
      return store.loadNotions().then(function (existing) {
        if (existing.length) return { notions: existing, seeded: false };
        return loadSeed().then(function (bundle) {
          if (!bundle || !bundle.notions || !bundle.notions.length) {
            return { notions: [], seeded: false };
          }
          if (!db) {
            localWrite(bundle.notions);
            return { notions: bundle.notions, seeded: true };
          }
          var list = bundle.notions;
          var i = 0;
          function step() {
            if (i >= list.length) return Promise.resolve();
            var n = list[i];
            i += 1;
            if (onProgress) onProgress(i, list.length);
            var body = Object.assign({}, n);
            delete body.id;
            body.createdAt = body.updatedAt = new Date().toISOString();
            return db.doc("notions/" + n.id).set(body).then(step);
          }
          return step().then(function () {
            return store.saveMeta({
              specOrder: bundle.specs || [],
              importedAt: new Date().toISOString(),
              schemaVersion: 1,
            });
          }).then(function () {
            return { notions: list, seeded: true };
          });
        });
      });
    },

    saveMeta: function (meta) {
      if (!db) return Promise.resolve();
      return db.doc("meta/fiche").set(meta).catch(function () {});
    },

    newId: newId,
  };

  FE.store = store;
})();
