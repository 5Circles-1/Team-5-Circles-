/**
 * Fake Google — just enough of the Apps Script services that Code.gs calls,
 * backed by this browser's localStorage. It lets the REAL server code run
 * inside a plain web page, which powers the demo and the automated tests.
 *
 * Shared state model: the "spreadsheet" lives in localStorage (shared by
 * every tab of this browser), so two tabs behave like two people using the
 * same server. Login tokens live in sessionStorage (per tab), so each tab
 * is its own signed-in device.
 *
 * This file never ships to Google — the real deployment is Code.gs + index.
 */
(function () {
  'use strict';

  var KEY = '5cp2_db';

  // Some sandboxes (embedded demos) block localStorage entirely — fall back to
  // page memory so the demo still works, just without cross-tab sharing.
  var MEM = {};
  function lsGet(k) {
    try { var v = localStorage.getItem(k); if (v !== null) return v; } catch (e) {}
    return MEM[k] !== undefined ? MEM[k] : null;
  }
  function lsSet(k, v) {
    try { localStorage.setItem(k, v); } catch (e) {}
    MEM[k] = v;
  }
  function lsDel(k) {
    try { localStorage.removeItem(k); } catch (e) {}
    delete MEM[k];
  }

  function load() {
    try {
      var raw = lsGet(KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) {}
    return null;
  }
  function save(db) { lsSet(KEY, JSON.stringify(db)); }
  function blank() { return { id: 'fake-book', name: '', sheets: {}, props: {}, cache: {} }; }

  /* ── synchronous SHA-256 (Code.gs hashes PINs with Utilities.computeDigest)
        Compact public-domain implementation; verified against known vectors
        in the test suite. Input here is always ASCII (uuid salt + digits). ── */
  function sha256Bytes(ascii) {
    function rr(v, a) { return (v >>> a) | (v << (32 - a)); }
    var maxWord = Math.pow(2, 32);
    var words = [], asciiBitLength = ascii.length * 8;
    var hash = [], k = [];
    var primeCounter = 0;
    var isComposite = {};
    for (var candidate = 2; primeCounter < 64; candidate++) {
      if (!isComposite[candidate]) {
        for (var i = 0; i < 313; i += candidate) isComposite[i] = candidate;
        hash[primeCounter] = (Math.pow(candidate, 0.5) * maxWord) | 0;
        k[primeCounter++] = (Math.pow(candidate, 1 / 3) * maxWord) | 0;
      }
    }
    ascii += '\x80';
    while (ascii.length % 64 - 56) ascii += '\x00';
    for (i = 0; i < ascii.length; i++) {
      var j = ascii.charCodeAt(i);
      if (j >> 8) throw new Error('sha256 fake: ASCII input only');
      words[i >> 2] |= j << ((3 - i) % 4) * 8;
    }
    words[words.length] = (asciiBitLength / maxWord) | 0;
    words[words.length] = asciiBitLength;
    for (j = 0; j < words.length;) {
      var w = words.slice(j, j += 16);
      var oldHash = hash.slice(0, 8);
      hash = hash.slice(0, 8);
      for (i = 0; i < 64; i++) {
        var w15 = w[i - 15], w2 = w[i - 2];
        var a = hash[0], e = hash[4];
        var temp1 = hash[7]
          + (rr(e, 6) ^ rr(e, 11) ^ rr(e, 25))
          + ((e & hash[5]) ^ (~e & hash[6]))
          + k[i]
          + (w[i] = (i < 16) ? w[i] : (w[i - 16]
              + (rr(w15, 7) ^ rr(w15, 18) ^ (w15 >>> 3))
              + w[i - 7]
              + (rr(w2, 17) ^ rr(w2, 19) ^ (w2 >>> 10))) | 0);
        var temp2 = (rr(a, 2) ^ rr(a, 13) ^ rr(a, 22))
          + ((a & hash[1]) ^ (a & hash[2]) ^ (hash[1] & hash[2]));
        hash = [(temp1 + temp2) | 0].concat(hash);
        hash[4] = (hash[4] + temp1) | 0;
      }
      for (i = 0; i < 8; i++) hash[i] = (hash[i] + oldHash[i]) | 0;
    }
    var bytes = [];
    for (i = 0; i < 8; i++) {
      for (var b = 3; b >= 0; b--) bytes.push((hash[i] >> (b * 8)) & 0xFF);
    }
    return bytes;
  }
  window.__sha256 = sha256Bytes;   // exposed for the test suite's known-answer check

  /* ── Utilities ── */
  window.Utilities = {
    DigestAlgorithm: { SHA_256: 'SHA_256' },
    computeDigest: function (alg, str) { return sha256Bytes(String(str)); },
    getUuid: function () {
      if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
      return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
        var r = Math.random() * 16 | 0;
        return (c === 'x' ? r : (r & 3 | 8)).toString(16);
      });
    }
  };

  /* ── PropertiesService / CacheService / LockService / ScriptApp ── */
  window.PropertiesService = {
    getScriptProperties: function () {
      return {
        getProperty: function (k) { var d = load(); return d && d.props[k] != null ? d.props[k] : null; },
        setProperty: function (k, v) { var d = load() || blank(); d.props[k] = String(v); save(d); }
      };
    }
  };
  window.CacheService = {
    getScriptCache: function () {
      return {
        get: function (k) { var d = load(); return d && d.cache[k] != null ? String(d.cache[k]) : null; },
        put: function (k, v) { var d = load() || blank(); d.cache[k] = String(v); save(d); }
      };
    }
  };
  window.LockService = {
    getScriptLock: function () {
      return {
        waitLock: function () {},
        tryLock: function () { return true; },   // single-threaded here
        releaseLock: function () {}
      };
    }
  };
  window.ScriptApp = {
    getService: function () {
      return { getUrl: function () { return location.href.split('#')[0]; } };
    }
  };

  /* ── SpreadsheetApp ── */
  function sheetApi(name) {
    return {
      getName: function () { return name; },
      getLastRow: function () { var d = load(); return ((d && d.sheets[name]) || []).length; },
      getMaxRows: function () { return 1000; },
      appendRow: function (row) {
        var d = load() || blank();
        (d.sheets[name] = d.sheets[name] || []).push(row.slice());
        save(d);
      },
      getRange: function (row, col, numRows, numCols) {
        if (typeof row === 'string') {
          // A1-notation ranges are only used for setNumberFormat — a no-op here
          return { setNumberFormat: function () { return this; } };
        }
        if (numRows === undefined) numRows = 1;
        if (numCols === undefined) numCols = 1;
        return {
          setNumberFormat: function () { return this; },
          getValues: function () {
            var d = load();
            var rows = (d && d.sheets[name]) || [];
            var out = [];
            for (var r = 0; r < numRows; r++) {
              var src = rows[row - 1 + r] || [];
              var line = [];
              for (var c = 0; c < numCols; c++) {
                line.push(src[col - 1 + c] !== undefined ? src[col - 1 + c] : '');
              }
              out.push(line);
            }
            return out;
          },
          setValues: function (vals) {
            var d = load() || blank();
            var rows = d.sheets[name] = d.sheets[name] || [];
            for (var r = 0; r < vals.length; r++) {
              var tr = rows[row - 1 + r] = rows[row - 1 + r] || [];
              for (var c = 0; c < vals[r].length; c++) tr[col - 1 + c] = vals[r][c];
            }
            save(d);
          },
          setValue: function (v) { this.setValues([[v]]); }
        };
      }
    };
  }

  function bookApi() {
    return {
      getId: function () { return 'fake-book'; },
      getUrl: function () { return location.href.split('#')[0] + '#demo-sheet'; },
      getSheetByName: function (n) {
        var d = load();
        return d && d.sheets[n] ? sheetApi(n) : null;
      },
      insertSheet: function (n) {
        var d = load() || blank();
        d.sheets[n] = d.sheets[n] || [];
        save(d);
        return sheetApi(n);
      },
      getSheets: function () {
        var d = load();
        return Object.keys((d && d.sheets) || {}).map(sheetApi);
      },
      deleteSheet: function (sh) {
        var d = load();
        if (d) { delete d.sheets[sh.getName()]; save(d); }
      }
    };
  }

  window.SpreadsheetApp = {
    create: function (name) {
      var d = load() || blank();
      d.name = name;
      save(d);
      return bookApi();
    },
    openById: function (id) {
      // Fault injection for the tests: Google's Sheets service does fail
      // transiently, and the app must not mistake that for "sheet deleted".
      if (window.FAKE_OPEN_FAILS) throw new Error('Service Spreadsheets failed while accessing document');
      var d = load();
      if (!d) throw new Error('Spreadsheet not found');
      return bookApi();
    }
  };

  window.FAKE_RESET = function () {
    lsDel(KEY);
  };
})();
