/*
 * backup.js — export and restore everything the app knows about you.
 *
 * One JSON file carries notes, bookmarks, reading position, settings and
 * (optionally) the imported book text, so moving to a new phone is a matter of
 * exporting on the old one and importing on the new one.
 */
(function (global) {
    'use strict';

    var BACKUP_SCHEMA = 1;

    function timestampForFilename() {
        var now = new Date();
        function pad(value) { return String(value).padStart(2, '0'); }
        return now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate()) +
            '-' + pad(now.getHours()) + pad(now.getMinutes());
    }

    function buildPayload(options) {
        options = options || {};
        var state = Store.state;
        var payload = {
            app: 'AMS Big 12S',
            schema: BACKUP_SCHEMA,
            appVersion: global.APP_VERSION || '1.0',
            exportedAt: new Date().toISOString(),
            includesBookText: false,
            settings: state.settings,
            position: state.position,
            notes: state.notes,
            bookmarks: state.bookmarks,
            // Questions put away, and questions of the reader's own. Answers
            // themselves are notes and travel above; without this a restore
            // would bring back questions they had hidden and lose the ones they
            // wrote.
            stepPrefs: state.stepPrefs,
            // Step four's rows. Years of work can sit in here, so it travels
            // with everything else rather than being something you export
            // separately and forget.
            inventory: state.inventory,
            // Every craving written down, and how each one ended. The value of
            // that list is entirely in its length, so it must survive a new
            // phone like anything else.
            cravings: state.cravings
        };

        if (options.includeBookText && state.book && state.book.textIncluded) {
            payload.includesBookText = true;
            payload.book = {
                title: state.book.title,
                subtitle: state.book.subtitle,
                edition: state.book.edition,
                importedAt: state.book.importedAt,
                sourceName: state.book.sourceName,
                sections: state.book.sections.map(function (section) {
                    return {
                        id: section.id,
                        kind: section.kind,
                        number: section.number,
                        title: section.title,
                        paragraphs: section.paragraphs
                    };
                })
            };
        }
        return payload;
    }

    function filename() {
        return 'ams-big-12s-backup-' + timestampForFilename() + '.json';
    }

    function serialize(options) {
        return JSON.stringify(buildPayload(options), null, 2);
    }

    /*
     * iOS is the awkward case: a plain <a download> is unreliable inside an
     * installed PWA. The share sheet is the route that actually works there, so
     * try it first and fall back to a download for desktop browsers.
     */
    function exportBackup(options) {
        var json = serialize(options);
        var name = filename();
        var file = null;

        try {
            file = new File([json], name, { type: 'application/json' });
        } catch (error) { /* File constructor missing on older Safari */ }

        if (file && navigator.canShare && navigator.canShare({ files: [file] }) && navigator.share) {
            return navigator.share({ files: [file], title: 'AMS Big 12S backup' })
                .then(function () { return { method: 'share', name: name, size: json.length }; })
                .catch(function (error) {
                    if (error && error.name === 'AbortError') return { method: 'cancelled' };
                    return downloadBackup(json, name);
                });
        }
        return Promise.resolve(downloadBackup(json, name));
    }

    function downloadBackup(json, name) {
        var blob = new Blob([json], { type: 'application/json' });
        var url = URL.createObjectURL(blob);
        var link = document.createElement('a');
        link.href = url;
        link.download = name;
        link.rel = 'noopener';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        setTimeout(function () { URL.revokeObjectURL(url); }, 30000);
        return { method: 'download', name: name, size: json.length };
    }

    function copyBackupToClipboard(options) {
        var json = serialize(options);
        if (navigator.clipboard && navigator.clipboard.writeText) {
            return navigator.clipboard.writeText(json).then(function () {
                return { method: 'clipboard', size: json.length };
            });
        }
        return Promise.reject(new Error('Clipboard is not available in this browser.'));
    }

    function parseBackup(text) {
        var payload;
        try {
            payload = JSON.parse(text);
        } catch (error) {
            throw new Error('That file is not valid JSON.');
        }
        if (!payload || payload.app !== 'AMS Big 12S') {
            throw new Error('That does not look like an AMS Big 12S backup.');
        }
        if (payload.schema > BACKUP_SCHEMA) {
            throw new Error('That backup was made by a newer version of the app. Update the app first.');
        }
        return payload;
    }

    function newerOf(incoming, existing) {
        if (!existing) return incoming;
        var a = incoming.updatedAt || incoming.createdAt || '';
        var b = existing.updatedAt || existing.createdAt || '';
        return a >= b ? incoming : existing;
    }

    /*
     * mode: 'merge' keeps what is already on this device and takes the newer of
     * any two records that share an id. 'replace' wipes first — the right choice
     * when restoring onto a fresh phone.
     */
    function restoreBackup(payload, mode) {
        mode = mode || 'merge';
        var summary = { notes: 0, bookmarks: 0, inventory: 0, cravings: 0,
                        bookText: false, mode: mode };

        var prepare = mode === 'replace'
            ? Promise.all([
                DB.clear(DB.STORE_NOTES),
                DB.clear(DB.STORE_BOOKMARKS),
                DB.clear(DB.STORE_INVENTORY),
                DB.clear(DB.STORE_CRAVINGS)
            ])
            : Promise.resolve();

        return prepare.then(function () {
            var existingNotes = {};
            var existingBookmarks = {};
            if (mode === 'merge') {
                Store.state.notes.forEach(function (note) { existingNotes[note.id] = note; });
                Store.state.bookmarks.forEach(function (bm) { existingBookmarks[bm.id] = bm; });
            }

            var notes = (payload.notes || []).map(function (note) {
                return newerOf(note, existingNotes[note.id]);
            });
            var bookmarks = (payload.bookmarks || []).map(function (bm) {
                return newerOf(bm, existingBookmarks[bm.id]);
            });
            summary.notes = notes.length;
            summary.bookmarks = bookmarks.length;

            // Absent from backups written before step four had tables, which
            // must restore cleanly rather than emptying what is on this device.
            var existingRows = {};
            if (mode === 'merge') {
                Store.state.inventory.forEach(function (row) { existingRows[row.id] = row; });
            }
            var inventory = (payload.inventory || []).map(function (row) {
                return newerOf(row, existingRows[row.id]);
            });
            summary.inventory = inventory.length;

            // Absent from backups written before the craving screen existed —
            // same rule, and the same reason: restoring an older file must not
            // empty a list that is only worth anything whole.
            var existingCravings = {};
            if (mode === 'merge') {
                Store.state.cravings.forEach(function (row) { existingCravings[row.id] = row; });
            }
            var cravings = (payload.cravings || []).map(function (row) {
                return newerOf(row, existingCravings[row.id]);
            });
            summary.cravings = cravings.length;

            return Promise.all([
                DB.putMany(DB.STORE_NOTES, notes),
                DB.putMany(DB.STORE_BOOKMARKS, bookmarks),
                DB.putMany(DB.STORE_INVENTORY, inventory),
                DB.putMany(DB.STORE_CRAVINGS, cravings)
            ]);
        }).then(function () {
            if (payload.book && payload.book.sections && payload.book.sections.length) {
                summary.bookText = true;
                return DB.put(DB.STORE_BOOK, {
                    title: payload.book.title,
                    subtitle: payload.book.subtitle,
                    edition: payload.book.edition,
                    sections: payload.book.sections,
                    importedAt: payload.book.importedAt || new Date().toISOString(),
                    sourceName: payload.book.sourceName || 'restored from backup'
                }, 'current');
            }
        }).then(function () {
            if (payload.settings) {
                return Store.saveSettings(payload.settings);
            }
        }).then(function () {
            // Absent from backups written before step work existed, which must
            // restore cleanly rather than wiping what is on this device.
            if (!payload.stepPrefs) return;
            var incoming = payload.stepPrefs;
            if (mode === 'replace') {
                Store.state.stepPrefs = {
                    hidden: incoming.hidden || {},
                    custom: incoming.custom || {}
                };
            } else {
                var current = Store.state.stepPrefs;
                current.hidden = Object.assign({}, current.hidden, incoming.hidden || {});
                Object.keys(incoming.custom || {}).forEach(function (stepId) {
                    var mine = current.custom[stepId] || [];
                    var seen = {};
                    mine.forEach(function (q) { seen[q.id] = true; });
                    current.custom[stepId] = mine.concat(
                        (incoming.custom[stepId] || []).filter(function (q) { return !seen[q.id]; }));
                });
            }
            summary.stepPrefs = true;
            return Store.saveStepPrefs();
        }).then(function () {
            // Only adopt the backup's position if it is newer than what is here.
            var incoming = payload.position;
            if (!incoming || !incoming.sectionId) return;
            var current = Store.state.position;
            if (current && current.updatedAt && incoming.updatedAt && current.updatedAt > incoming.updatedAt) return;
            return Store.savePosition(incoming);
        }).then(function () {
            return Store.init();
        }).then(function () {
            return summary;
        });
    }

    function readFile(file) {
        return new Promise(function (resolve, reject) {
            var reader = new FileReader();
            reader.onload = function () { resolve(String(reader.result)); };
            reader.onerror = function () { reject(new Error('Could not read that file.')); };
            reader.readAsText(file);
        });
    }

    global.Backup = {
        BACKUP_SCHEMA: BACKUP_SCHEMA,
        buildPayload: buildPayload,
        serialize: serialize,
        filename: filename,
        exportBackup: exportBackup,
        copyBackupToClipboard: copyBackupToClipboard,
        parseBackup: parseBackup,
        restoreBackup: restoreBackup,
        readFile: readFile
    };
})(window);
