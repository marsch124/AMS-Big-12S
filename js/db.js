/*
 * db.js — IndexedDB storage for AMS Big 12S.
 *
 * Everything lives on the device: the imported book text, notes, bookmarks,
 * reading position and settings. Nothing is ever sent anywhere.
 */
(function (global) {
    'use strict';

    var DB_NAME = 'ams-big-12s';
    var DB_VERSION = 3;

    var STORE_META = 'meta';
    var STORE_BOOK = 'book';
    var STORE_NOTES = 'notes';
    var STORE_BOOKMARKS = 'bookmarks';
    // Step four's inventory rows. Structured records rather than prose, so they
    // are kept apart from the note store instead of being bent into its shape.
    var STORE_INVENTORY = 'inventory';
    // Cravings: when one started, when it ended, how. Structured for the same
    // reason, and kept out of the inventory store because it belongs to no step.
    var STORE_CRAVINGS = 'cravings';

    var dbPromise = null;

    function open() {
        if (dbPromise) return dbPromise;
        dbPromise = new Promise(function (resolve, reject) {
            var request = indexedDB.open(DB_NAME, DB_VERSION);

            request.onupgradeneeded = function (event) {
                var db = event.target.result;

                if (!db.objectStoreNames.contains(STORE_META)) {
                    db.createObjectStore(STORE_META);
                }
                if (!db.objectStoreNames.contains(STORE_BOOK)) {
                    db.createObjectStore(STORE_BOOK);
                }
                if (!db.objectStoreNames.contains(STORE_NOTES)) {
                    var notes = db.createObjectStore(STORE_NOTES, { keyPath: 'id' });
                    notes.createIndex('sectionId', 'sectionId', { unique: false });
                    notes.createIndex('updatedAt', 'updatedAt', { unique: false });
                }
                if (!db.objectStoreNames.contains(STORE_BOOKMARKS)) {
                    var bookmarks = db.createObjectStore(STORE_BOOKMARKS, { keyPath: 'id' });
                    bookmarks.createIndex('sectionId', 'sectionId', { unique: false });
                }
                // Added in DB_VERSION 2. The guard means an install that already
                // has it — and every store above — comes through untouched.
                if (!db.objectStoreNames.contains(STORE_INVENTORY)) {
                    var inventory = db.createObjectStore(STORE_INVENTORY, { keyPath: 'id' });
                    inventory.createIndex('stepId', 'stepId', { unique: false });
                }
                // Added in DB_VERSION 3, guarded the same way.
                if (!db.objectStoreNames.contains(STORE_CRAVINGS)) {
                    var cravings = db.createObjectStore(STORE_CRAVINGS, { keyPath: 'id' });
                    cravings.createIndex('startedAt', 'startedAt', { unique: false });
                }
            };

            request.onsuccess = function () { resolve(request.result); };
            request.onerror = function () { reject(request.error); };
            request.onblocked = function () {
                reject(new Error('Database is blocked by another open tab. Close other copies of the app and retry.'));
            };
        });
        return dbPromise;
    }

    function asPromise(request) {
        return new Promise(function (resolve, reject) {
            request.onsuccess = function () { resolve(request.result); };
            request.onerror = function () { reject(request.error); };
        });
    }

    function get(store, key) {
        return open().then(function (db) {
            return asPromise(db.transaction(store, 'readonly').objectStore(store).get(key));
        });
    }

    function getAll(store) {
        return open().then(function (db) {
            return asPromise(db.transaction(store, 'readonly').objectStore(store).getAll());
        });
    }

    function put(store, value, key) {
        return open().then(function (db) {
            var tx = db.transaction(store, 'readwrite');
            var request = key === undefined
                ? tx.objectStore(store).put(value)
                : tx.objectStore(store).put(value, key);
            return asPromise(request).then(function (result) {
                return new Promise(function (resolve, reject) {
                    tx.oncomplete = function () { resolve(result); };
                    tx.onerror = function () { reject(tx.error); };
                });
            });
        });
    }

    function remove(store, key) {
        return open().then(function (db) {
            var tx = db.transaction(store, 'readwrite');
            return asPromise(tx.objectStore(store)['delete'](key)).then(function () {
                return new Promise(function (resolve, reject) {
                    tx.oncomplete = resolve;
                    tx.onerror = function () { reject(tx.error); };
                });
            });
        });
    }

    function clear(store) {
        return open().then(function (db) {
            var tx = db.transaction(store, 'readwrite');
            return asPromise(tx.objectStore(store).clear()).then(function () {
                return new Promise(function (resolve, reject) {
                    tx.oncomplete = resolve;
                    tx.onerror = function () { reject(tx.error); };
                });
            });
        });
    }

    function putMany(store, records) {
        if (!records.length) return Promise.resolve();
        return open().then(function (db) {
            return new Promise(function (resolve, reject) {
                var tx = db.transaction(store, 'readwrite');
                var objectStore = tx.objectStore(store);
                records.forEach(function (record) { objectStore.put(record); });
                tx.oncomplete = resolve;
                tx.onerror = function () { reject(tx.error); };
                tx.onabort = function () { reject(tx.error || new Error('Transaction aborted')); };
            });
        });
    }

    global.DB = {
        STORE_META: STORE_META,
        STORE_BOOK: STORE_BOOK,
        STORE_NOTES: STORE_NOTES,
        STORE_BOOKMARKS: STORE_BOOKMARKS,
        STORE_INVENTORY: STORE_INVENTORY,
        STORE_CRAVINGS: STORE_CRAVINGS,
        open: open,
        get: get,
        getAll: getAll,
        put: put,
        remove: remove,
        clear: clear,
        putMany: putMany
    };
})(window);
