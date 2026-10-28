/* =========================================================================
   db.js – lokale Ablage der Takes in IndexedDB
   Nichts verlässt das Gerät: Es gibt ausschließlich Schreib- und Lesezugriffe
   auf die browserinterne Datenbank dieses Geräts.
   ========================================================================= */
(function (global) {
  'use strict';

  var DB_NAME = 'stimmenclon-studio';
  var DB_VERSION = 1;
  var STORE = 'takes';

  var dbPromise = null;
  var unavailable = false;

  function open() {
    if (unavailable) return Promise.reject(new Error('IndexedDB nicht verfügbar'));
    if (dbPromise) return dbPromise;

    dbPromise = new Promise(function (resolve, reject) {
      if (!('indexedDB' in global)) {
        reject(new Error('IndexedDB wird von diesem Browser nicht unterstützt.'));
        return;
      }
      var request;
      try {
        request = global.indexedDB.open(DB_NAME, DB_VERSION);
      } catch (err) {
        reject(err);
        return;
      }

      request.onupgradeneeded = function () {
        var db = request.result;
        if (!db.objectStoreNames.contains(STORE)) {
          var store = db.createObjectStore(STORE, { keyPath: 'id' });
          store.createIndex('number', 'number', { unique: false });
          store.createIndex('createdAt', 'createdAt', { unique: false });
        }
      };
      request.onsuccess = function () { resolve(request.result); };
      request.onerror = function () {
        unavailable = true;
        reject(request.error || new Error('IndexedDB konnte nicht geöffnet werden.'));
      };
      request.onblocked = function () {
        reject(new Error('IndexedDB ist blockiert (anderer Tab mit alter Version).'));
      };
    });

    return dbPromise;
  }

  function tx(mode, fn) {
    return open().then(function (db) {
      return new Promise(function (resolve, reject) {
        var transaction = db.transaction(STORE, mode);
        var store = transaction.objectStore(STORE);
        var result;
        try {
          result = fn(store);
        } catch (err) {
          reject(err);
          return;
        }
        transaction.oncomplete = function () { resolve(result && result.result !== undefined ? result.result : result); };
        transaction.onerror = function () { reject(transaction.error); };
        transaction.onabort = function () { reject(transaction.error || new Error('Transaktion abgebrochen')); };
      });
    });
  }

  /** Speichert einen Take (Metadaten + WAV-Blob). */
  function put(take) {
    return tx('readwrite', function (store) {
      store.put(take);
      return take;
    });
  }

  /** Liefert alle Takes, nach Nummer aufsteigend. */
  function getAll() {
    return open().then(function (db) {
      return new Promise(function (resolve, reject) {
        var transaction = db.transaction(STORE, 'readonly');
        var request = transaction.objectStore(STORE).getAll();
        request.onsuccess = function () {
          var list = (request.result || []).slice().sort(function (a, b) {
            return (a.number || 0) - (b.number || 0) || (a.createdAt || 0) - (b.createdAt || 0);
          });
          resolve(list);
        };
        request.onerror = function () { reject(request.error); };
      });
    });
  }

  function remove(id) {
    return tx('readwrite', function (store) {
      store.delete(id);
      return id;
    });
  }

  function clear() {
    return tx('readwrite', function (store) {
      store.clear();
      return true;
    });
  }

  function isAvailable() {
    return !unavailable && 'indexedDB' in global;
  }

  /** Belegter Speicher, sofern der Browser es meldet. */
  function estimate() {
    if (!navigator.storage || !navigator.storage.estimate) return Promise.resolve(null);
    return navigator.storage.estimate().catch(function () { return null; });
  }

  global.StimmenDB = {
    put: put,
    getAll: getAll,
    remove: remove,
    clear: clear,
    isAvailable: isAvailable,
    estimate: estimate
  };
})(window);
