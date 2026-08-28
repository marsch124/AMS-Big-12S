/*
 * safekeeping.js — keeping the work when nothing else will.
 *
 * This app has no server and no account. What is in it exists on one phone, in
 * one browser's IndexedDB, and that is a more fragile place than it looks: a
 * browser may evict an origin's storage under pressure, and iOS is the least
 * forgiving about it. A day count, an inventory and a craving log are not the
 * kind of thing anybody can write again from memory.
 *
 * Two things happen here, and neither replaces making a real backup file.
 *
 * 1. The app asks the browser to keep its data — navigator.storage.persist().
 *    Chromium grants it on its own heuristics; Safari grants it to an app on
 *    the Home Screen and usually refuses a tab. Asking costs one call, and the
 *    answer is worth showing rather than assuming.
 *
 * 2. A copy of everything except the book is kept in localStorage, in two
 *    generations, and put back if the database ever comes up empty. That is a
 *    different failure from eviction — a broken upgrade, a half-finished
 *    write — and it is the one a person notices as "it has forgotten me".
 *
 * The rules below were learnt in the sibling app the expensive way, and they
 * are the whole of the file's value:
 *
 *   - A copy holding work is NEVER replaced by one holding none. An empty
 *     database at save time means something has gone wrong, not that the work
 *     is gone. Without this rule the first faulty read overwrites the backup.
 *   - The previous generation stays roughly a day behind, so it is genuinely
 *     an older copy rather than one write ago. Two copies of the same mistake
 *     are one copy.
 *   - Putting data back must happen BEFORE anything writes, or the first write
 *     saves an empty snapshot over the copy being restored from.
 */
(function (global) {
    'use strict';

    var CURRENT  = 'ams-big-12s:safe';
    var PREVIOUS = 'ams-big-12s:safe-prev';
    var FAILED   = 'ams-big-12s:safe-failed';
    var EXPORTED = 'ams-big-12s:last-export';
    /*
     * How many records the app last knew it had, written on every snapshot
     * whether or not the copy itself was replaced. It is what tells an empty
     * database that was emptied on purpose from one that lost its contents.
     *
     * Without it the two look identical at boot, and the anti-empty rule below
     * turns "I deleted my last note" into "the app brought it back the next
     * morning" — which is worse than the failure the rule exists to prevent,
     * and in this app it is somebody's private business being un-deleted.
     */
    var MARK     = 'ams-big-12s:safe-mark';

    var GENERATION_GAP_MS = 24 * 60 * 60 * 1000;
    // Long enough that saving a note does not serialise the world three times
    // (a save is a put and a reload), short enough to survive a phone going in
    // a pocket. pagehide covers the rest.
    var SETTLE_MS = 1500;

    // Everything a person made. Settings and reading position are not in this
    // list on purpose: they are worth carrying, but a copy holding only those
    // is an empty copy and must not be allowed to overwrite a full one.
    var WORK = ['notes', 'bookmarks', 'inventory', 'cravings', 'meetings',
                'checkins', 'breaks', 'messages', 'tradlog'];

    var suspended = true;   // until openingUp() has decided
    var timer = null;
    var granted = null;     // true / false / null, meaning "never answered"

    function countWork(source) {
        if (!source) return 0;
        return WORK.reduce(function (total, key) {
            var list = source[key];
            return total + (list && list.length ? list.length : 0);
        }, 0);
    }

    function readSlot(key) {
        try {
            var raw = localStorage.getItem(key);
            if (!raw) return null;
            var parsed = JSON.parse(raw);
            // A slot that is not a backup at all is worse than an empty one:
            // it would satisfy every check below and restore nothing.
            return parsed && parsed.app === 'AMS Big 12S' ? parsed : null;
        } catch (error) {
            return null;
        }
    }

    /*
     * localStorage is a few megabytes and the copy does not contain the book,
     * so this should not fill it — but an inventory kept for years might. If
     * it does, the older generation goes first: one recent copy beats two that
     * cannot be written. A failure is recorded rather than swallowed, because
     * an app that has silently stopped keeping copies looks exactly like one
     * that is keeping them.
     */
    function write(key, json) {
        try {
            localStorage.setItem(key, json);
            localStorage.removeItem(FAILED);
            return true;
        } catch (error) {
            try {
                localStorage.removeItem(PREVIOUS);
                localStorage.setItem(key, json);
                localStorage.removeItem(FAILED);
                return true;
            } catch (second) {
                try { localStorage.setItem(FAILED, new Date().toISOString()); } catch (ignored) {}
                return false;
            }
        }
    }

    function rollGeneration(existing) {
        if (!existing || !countWork(existing)) return;
        var previous = readSlot(PREVIOUS);
        var at = previous && previous.exportedAt ? Date.parse(previous.exportedAt) : NaN;
        // Already a copy from within the day — leave it be, or the older
        // generation creeps forward until both copies are the same age.
        if (isFinite(at) && Date.now() - at < GENERATION_GAP_MS) return;
        try { write(PREVIOUS, JSON.stringify(existing)); } catch (ignored) {}
    }

    /*
     * Take a copy now. `allowEmpty` exists for the one legitimate case — a
     * restore that wipes first — and nothing else should pass it.
     */
    function snapshot(options) {
        options = options || {};
        if (!global.Backup || !global.Store || !Store.state) return false;

        var payload;
        try {
            // No book text, ever: the bundled book is on disk and an imported
            // one can be imported again. It is 577 KB and this is localStorage.
            payload = Backup.buildPayload({});
        } catch (error) {
            return false;
        }

        var records = countWork(payload);

        // Always, and before the refusal below: the mark is a statement about
        // the database, not about the copy, and it has to stay true even when
        // the copy is deliberately left alone.
        try { localStorage.setItem(MARK, String(records)); } catch (ignored) {}

        var existing = readSlot(CURRENT);
        if (!options.allowEmpty && !records && countWork(existing)) {
            return false;
        }

        rollGeneration(existing);
        return write(CURRENT, JSON.stringify(payload));
    }

    function schedule() {
        if (suspended) return;
        if (timer) clearTimeout(timer);
        timer = setTimeout(function () { timer = null; snapshot(); }, SETTLE_MS);
    }

    function flush() {
        if (suspended) return;
        if (timer) { clearTimeout(timer); timer = null; }
        snapshot();
    }

    /*
     * One hook, at the only door. Every write in the app goes through DB.put,
     * DB.remove, DB.putMany or DB.clear, so wrapping those four is the whole
     * of it — the sibling app wrapped fourteen Store functions by name and a
     * fifteenth was added later without one.
     */
    function watchTheDoor() {
        if (!global.DB) return;
        ['put', 'remove', 'putMany', 'clear'].forEach(function (name) {
            var original = DB[name];
            if (typeof original !== 'function') return;
            DB[name] = function () {
                return original.apply(DB, arguments).then(function (result) {
                    schedule();
                    return result;
                });
            };
        });
    }

    function askToBeKept() {
        if (!navigator.storage || !navigator.storage.persist) {
            return Promise.resolve(null);
        }
        return Promise.resolve(navigator.storage.persisted ? navigator.storage.persisted() : false)
            .then(function (already) { return already ? true : navigator.storage.persist(); })
            .then(function (answer) { granted = !!answer; return granted; })
            // A browser that throws on being asked has not said no, it has said
            // nothing, and "we do not know" is the honest thing to report.
            .catch(function () { granted = null; return null; });
    }

    /*
     * Runs once, after Store.init() and before the app is on screen. Nothing
     * may be written between the database opening and this finishing, or the
     * copy being restored from is the copy that gets overwritten.
     */
    function openingUp() {
        var restored = null;
        // An absent mark means this phone has never run a version that kept
        // one — restore on the copy alone, as there is nothing better to go on.
        // A mark of 0 means the app was last seen holding nothing, and an empty
        // database is then exactly what it should be.
        var mark = null;
        try {
            var raw = localStorage.getItem(MARK);
            mark = raw === null ? null : parseInt(raw, 10);
        } catch (error) { mark = null; }
        var emptyOnPurpose = mark === 0;

        if (!countWork(Store.state) && !emptyOnPurpose) {
            var best = readSlot(CURRENT);
            if (!countWork(best)) best = readSlot(PREVIOUS);
            if (countWork(best)) restored = best;
        }

        var work = restored
            // Merge, never replace: replace would clear the stores first, and
            // clearing on the strength of a copy we have not read back yet is
            // the one move that could lose more than it saves.
            ? Backup.restoreBackup(restored, 'merge').then(function (summary) {
                return { restored: countWork(restored), summary: summary };
            })
            : Promise.resolve(null);

        return work
            .catch(function () { return null; })
            .then(function (outcome) {
                suspended = false;
                snapshot();
                return askToBeKept().then(function () { return outcome; });
            });
    }

    function noteExport() {
        try { localStorage.setItem(EXPORTED, new Date().toISOString()); } catch (ignored) {}
    }

    function lastExport() {
        try { return localStorage.getItem(EXPORTED) || null; } catch (error) { return null; }
    }

    function describe(slot) {
        if (!slot) return null;
        return { records: countWork(slot), at: slot.exportedAt || null };
    }

    // What the panel in Settings reports on. Read afresh each time: the whole
    // point is to say what is on the device now, not what it was at boot.
    function status() {
        return {
            kept: granted,
            current: describe(readSlot(CURRENT)),
            previous: describe(readSlot(PREVIOUS)),
            failedAt: (function () {
                try { return localStorage.getItem(FAILED); } catch (error) { return null; }
            })(),
            lastExport: lastExport()
        };
    }

    // A restore wipes and rewrites, so the copy must not be touched until it
    // has finished — and afterwards it is taken again, on purpose.
    function duringRestore(run) {
        suspended = true;
        if (timer) { clearTimeout(timer); timer = null; }
        return Promise.resolve()
            .then(run)
            .then(function (result) {
                suspended = false;
                snapshot({ allowEmpty: true });
                return result;
            })
            .catch(function (error) {
                suspended = false;
                snapshot({ allowEmpty: true });
                throw error;
            });
    }

    // The same four moments the reading position saves at, for the same reason:
    // iOS kills a backgrounded PWA without firing anything else.
    global.addEventListener('pagehide', flush);
    global.addEventListener('visibilitychange', function () {
        if (document.visibilityState === 'hidden') flush();
    });

    watchTheDoor();

    global.Safekeeping = {
        openingUp: openingUp,
        snapshot: snapshot,
        flush: flush,
        status: status,
        noteExport: noteExport,
        lastExport: lastExport,
        duringRestore: duringRestore,
        countWork: countWork,
        KEYS: { CURRENT: CURRENT, PREVIOUS: PREVIOUS, FAILED: FAILED,
                EXPORTED: EXPORTED, MARK: MARK }
    };
})(window);
