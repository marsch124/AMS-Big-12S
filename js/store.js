/*
 * store.js — the app's state layer.
 *
 * Owns the book text, reading position, notes, bookmarks and settings, and is
 * the only module that talks to DB directly.
 */
(function (global) {
    'use strict';

    var DEFAULT_SETTINGS = {
        theme: 'sepia',          // sepia | light | dark | auto
        fontSize: 19,            // px
        lineHeight: 1.65,
        typeface: 'serif',       // serif | sans
        keepAwake: false
    };

    var POSITION_MIRROR_KEY = 'ams-big-12s:position';

    var state = {
        book: null,              // { title, subtitle, edition, sections: [] }
        settings: Object.assign({}, DEFAULT_SETTINGS),
        position: null,          // { sectionId, paraIndex, ratio, updatedAt }
        notes: [],
        bookmarks: [],
        steps: null,           // { title, edition, steps: [] } from data/steps.json
        stepPrefs: { hidden: {}, custom: {} },  // questions hidden, questions added
        inventory: []            // step four's rows: { id, stepId, tableId, values, ... }
    };

    function uid(prefix) {
        return prefix + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
    }

    function anchorFor(text) {
        return String(text || '').replace(/\s+/g, ' ').trim().slice(0, 80);
    }

    /* ---------------------------------------------------------------- book */

    // The shipped data/book.json carries the table of contents. If the reader has
    // imported the text it lives in IndexedDB and wins, because it is the copy
    // that actually has words in it.
    function loadBook() {
        var shipped = fetch('data/book.json', { cache: 'no-cache' })
            .then(function (response) {
                if (!response.ok) throw new Error('book.json: HTTP ' + response.status);
                return response.json();
            })
            .catch(function (error) {
                console.warn('Could not load data/book.json', error);
                return null;
            });

        return Promise.all([shipped, DB.get(DB.STORE_BOOK, 'current')])
            .then(function (results) {
                var base = results[0];
                var imported = results[1];

                if (imported && imported.sections && imported.sections.length) {
                    state.book = {
                        title: imported.title || (base && base.title) || 'Alcoholics Anonymous',
                        subtitle: imported.subtitle || (base && base.subtitle) || '',
                        edition: imported.edition || (base && base.edition) || '',
                        sections: imported.sections,
                        textIncluded: true,
                        // The reader supplied this copy themselves, so it is theirs
                        // to remove; the bundled copy is not.
                        isImported: true,
                        importedAt: imported.importedAt,
                        sourceName: imported.sourceName || ''
                    };
                } else if (base) {
                    state.book = {
                        title: base.title,
                        subtitle: base.subtitle,
                        edition: base.edition,
                        sections: base.sections || [],
                        textIncluded: !!base.textIncluded,
                        isImported: false,
                        importNotice: base.importNotice
                    };
                } else {
                    state.book = { title: 'Alcoholics Anonymous', subtitle: '', edition: '', sections: [], textIncluded: false };
                }

                indexBook();
                return state.book;
            });
    }

    // Cumulative paragraph offsets let us turn a position into a percentage
    // without walking the whole book on every scroll event.
    function indexBook() {
        var running = 0;
        state.book.sections.forEach(function (section) {
            section._offset = running;
            section._count = section.paragraphs.length;
            running += section._count;
        });
        state.book.totalParagraphs = running;
    }

    function saveImportedBook(parsed, meta) {
        var record = {
            title: (state.book && state.book.title) || 'Alcoholics Anonymous',
            subtitle: (state.book && state.book.subtitle) || '',
            edition: (meta && meta.edition) || (state.book && state.book.edition) || '',
            sections: parsed.sections,
            importedAt: new Date().toISOString(),
            sourceName: (meta && meta.sourceName) || ''
        };
        return DB.put(DB.STORE_BOOK, record, 'current').then(function () {
            state.book = Object.assign({}, record, { textIncluded: true, isImported: true });
            indexBook();
            return state.book;
        });
    }

    function clearImportedBook() {
        return DB.remove(DB.STORE_BOOK, 'current').then(loadBook);
    }

    function getSection(sectionId) {
        return state.book.sections.filter(function (s) { return s.id === sectionId; })[0] || null;
    }

    function sectionIndex(sectionId) {
        for (var i = 0; i < state.book.sections.length; i++) {
            if (state.book.sections[i].id === sectionId) return i;
        }
        return -1;
    }

    function readableSections() {
        return state.book.sections.filter(function (s) { return s.paragraphs.length > 0; });
    }

    /* --------------------------------------------------------------- steps */

    // Must match flatten() in tools/build-steps.js — the build resolves anchors
    // one way and the app re-resolves them the other, so they have to agree.
    function flattenAnchor(text) {
        return String(text || '')
            .replace(/[‘’ʼ]/g, "'")
            .replace(/[“”]/g, '"')
            .replace(/[–—]/g, '-')
            .replace(/\s+/g, ' ')
            .trim()
            .toLowerCase();
    }

    function loadSteps() {
        return fetch('data/steps.json', { cache: 'no-cache' })
            .then(function (response) {
                if (!response.ok) throw new Error('steps.json: HTTP ' + response.status);
                return response.json();
            })
            .then(function (data) { state.steps = data; return data; })
            .catch(function (error) {
                console.warn('Could not load data/steps.json', error);
                state.steps = { steps: [] };
                return state.steps;
            });
    }

    function allSteps() {
        return (state.steps && state.steps.steps) || [];
    }

    function getStep(id) {
        return allSteps().filter(function (s) { return s.id === id; })[0] || null;
    }

    function stepIsWritten(step) {
        return !!(step && step.explanation && step.explanation.length);
    }

    /* ------------------------------------------------------ the step's work */

    // The shape a step's own work takes, declared in steps.source.json and
    // built into steps.json. A step without one simply has no work section.
    function workFor(step) {
        return (step && step.work) || null;
    }

    function tableIn(work, tableId) {
        if (!work || !work.tables) return null;
        return work.tables.filter(function (t) { return t.id === tableId; })[0] || null;
    }

    function loadInventory() {
        return DB.getAll(DB.STORE_INVENTORY).then(function (rows) {
            state.inventory = (rows || []).sort(function (a, b) {
                return (a.createdAt || '').localeCompare(b.createdAt || '');
            });
            return state.inventory;
        }).catch(function (error) {
            console.warn('Could not load the inventory', error);
            state.inventory = [];
            return state.inventory;
        });
    }

    // Oldest first: an inventory is read as a list that grew, not as a feed.
    function inventoryFor(stepId, tableId) {
        return state.inventory.filter(function (row) {
            return row.stepId === stepId && (!tableId || row.tableId === tableId);
        });
    }

    function inventoryCount(stepId, tableId) {
        return inventoryFor(stepId, tableId).length;
    }

    // A row is empty when every column of it is. Saving one would put a blank
    // card in a list whose whole purpose is evidence.
    function rowIsEmpty(values) {
        return !Object.keys(values || {}).some(function (key) {
            return String(values[key] || '').trim().length > 0;
        });
    }

    function saveInventoryRow(row) {
        var now = new Date().toISOString();
        var values = {};
        Object.keys(row.values || {}).forEach(function (key) {
            values[key] = String(row.values[key] || '').trim();
        });

        var record = {
            id: row.id || uid('inv'),
            stepId: row.stepId,
            tableId: row.tableId,
            values: values,
            // Keyed by the step that owns the state, because one row can carry
            // more than one: step eight's willingness and step nine's progress
            // sit on the same amends entry and are different questions.
            states: Object.assign({}, row.states || {}),
            // A date the reader chose, which is not createdAt — an amend made
            // last week can be recorded today.
            on: row.on || null,
            createdAt: row.createdAt || now,
            updatedAt: now
        };

        return DB.put(DB.STORE_INVENTORY, record).then(function () {
            var existing = state.inventory.filter(function (r) { return r.id === record.id; })[0];
            if (existing) Object.assign(existing, record);
            else state.inventory.push(record);
            return record;
        });
    }

    function deleteInventoryRow(id) {
        return DB.remove(DB.STORE_INVENTORY, id).then(function () {
            state.inventory = state.inventory.filter(function (row) { return row.id !== id; });
        });
    }

    function rowState(row, stepId) {
        return (row && row.states && row.states[stepId]) || null;
    }

    // Setting a state is its own operation: step nine changes the progress on a
    // row without touching the words step eight wrote into it.
    function setRowState(id, stepId, stateId) {
        var row = state.inventory.filter(function (r) { return r.id === id; })[0];
        if (!row) return Promise.resolve(null);
        var next = Object.assign({}, row.states || {});
        if (stateId) next[stepId] = stateId; else delete next[stepId];
        return saveInventoryRow(Object.assign({}, row, { states: next }));
    }

    // Where a step's work reads its rows from. A step with no `from` owns its
    // rows; one with a `from` annotates another step's.
    function rowsForWork(step) {
        var work = workFor(step);
        if (!work) return [];
        if (work.from && work.from.stepId && work.from.work) {
            var source = getStep(work.from.stepId);
            var sourceWork = workFor(source);
            if (!sourceWork) return [];
            return inventoryFor(work.from.stepId, sourceWork.tableId || work.from.work);
        }
        return inventoryFor(step.id, work.tableId || work.kind);
    }

    // Plain text of a whole table, for taking to the person who will hear it.
    function inventoryAsText(step, tableId) {
        var work = workFor(step);
        var table = tableIn(work, tableId);
        if (!table) return '';
        var rows = inventoryFor(step.id, tableId);
        var out = [table.title, ''];
        rows.forEach(function (row, i) {
            out.push(String(i + 1) + '.');
            table.columns.forEach(function (col) {
                var value = (row.values && row.values[col.id]) || '';
                if (value) out.push('   ' + col.label + ': ' + value);
            });
            out.push('');
        });
        return out.join('\n').trim();
    }

    /*
     * The build resolved every reference against the bundled text, but the
     * reader may have imported their own copy since. Trust the anchor over the
     * stored index, exactly as notes do, and report an unfindable passage
     * rather than opening the wrong one.
     */
    function resolveStepRef(ref) {
        if (!ref) return null;
        var section = getSection(ref.sectionId);
        if (!section) return null;

        var needle = flattenAnchor(ref.anchor);
        if (!needle) return null;

        var atIndex = section.paragraphs[ref.paraIndex];
        if (atIndex && flattenAnchor(atIndex).indexOf(needle) === 0) return ref.paraIndex;

        for (var i = 0; i < section.paragraphs.length; i++) {
            if (flattenAnchor(section.paragraphs[i]).indexOf(needle) === 0) return i;
        }
        return null;
    }

    /*
     * The step's own wording, taken from the book rather than stored twice.
     *
     * The book runs the numeral into the first word — "1.We admitted" — which is
     * faithful in the reader but wrong on a page already headed "Step 1", so the
     * leading numeral is dropped here. Only for display; the reader still shows
     * the paragraph exactly as printed.
     */
    function stepText(step) {
        var index = resolveStepRef(step && step.text);
        if (index === null) return '';
        var section = getSection(step.text.sectionId);
        var text = (section && section.paragraphs[index]) || '';
        return text.replace(/^\s*\d{1,2}\s*\.\s*/, '');
    }

    /* --------------------------------------------------- step questions */

    function loadStepPrefs() {
        return DB.get(DB.STORE_META, 'stepPrefs').then(function (saved) {
            state.stepPrefs = Object.assign({ hidden: {}, custom: {} }, saved || {});
            state.stepPrefs.hidden = state.stepPrefs.hidden || {};
            state.stepPrefs.custom = state.stepPrefs.custom || {};
            return state.stepPrefs;
        }).catch(function () {
            state.stepPrefs = { hidden: {}, custom: {} };
            return state.stepPrefs;
        });
    }

    function saveStepPrefs() {
        return DB.put(DB.STORE_META, state.stepPrefs, 'stepPrefs');
    }

    // The questions that came with the step, plus any of the reader's own,
    // minus anything they have put away.
    function questionsFor(step) {
        if (!step) return [];
        var prefs = state.stepPrefs;
        var own = (prefs.custom[step.id] || []).map(function (q) {
            return { id: q.id, text: q.text, own: true };
        });
        return (step.questions || []).concat(own).filter(function (q) {
            return !prefs.hidden[q.id];
        });
    }

    // Works for a question that has since been put away, so an answer on the
    // Notes tab never loses the question it was answering.
    function questionText(stepId, questionId) {
        var step = getStep(stepId);
        if (!step) return '';
        var own = (state.stepPrefs.custom[stepId] || []);
        var all = (step.questions || []).concat(own);
        var found = all.filter(function (q) { return q.id === questionId; })[0];
        return found ? found.text : '';
    }

    function hiddenQuestionsFor(step) {
        if (!step) return [];
        var prefs = state.stepPrefs;
        var own = (prefs.custom[step.id] || []).map(function (q) {
            return { id: q.id, text: q.text, own: true };
        });
        return (step.questions || []).concat(own).filter(function (q) {
            return prefs.hidden[q.id];
        });
    }

    // Putting a question away never touches what was written against it; bring
    // it back and the answers are still there.
    function setQuestionHidden(questionId, hidden) {
        if (hidden) state.stepPrefs.hidden[questionId] = true;
        else delete state.stepPrefs.hidden[questionId];
        return saveStepPrefs();
    }

    function addQuestion(stepId, text) {
        var question = { id: uid('q'), text: String(text || '').trim() };
        if (!question.text) return Promise.resolve(null);
        if (!state.stepPrefs.custom[stepId]) state.stepPrefs.custom[stepId] = [];
        state.stepPrefs.custom[stepId].push(question);
        return saveStepPrefs().then(function () { return question; });
    }

    function deleteQuestion(stepId, questionId) {
        var own = state.stepPrefs.custom[stepId] || [];
        state.stepPrefs.custom[stepId] = own.filter(function (q) { return q.id !== questionId; });
        delete state.stepPrefs.hidden[questionId];
        return saveStepPrefs();
    }

    /* ------------------------------------------------------------ settings */

    function loadSettings() {
        return DB.get(DB.STORE_META, 'settings').then(function (saved) {
            state.settings = Object.assign({}, DEFAULT_SETTINGS, saved || {});
            return state.settings;
        });
    }

    function saveSettings(patch) {
        state.settings = Object.assign({}, state.settings, patch || {});
        return DB.put(DB.STORE_META, state.settings, 'settings').then(function () {
            return state.settings;
        });
    }

    /* ------------------------------------------------------------ position */

    function loadPosition() {
        // The localStorage mirror is read synchronously at boot so the reader can
        // paint at the right place before IndexedDB has opened.
        var mirrored = null;
        try {
            var raw = localStorage.getItem(POSITION_MIRROR_KEY);
            if (raw) mirrored = JSON.parse(raw);
        } catch (error) { /* private mode, or corrupt value — fall through */ }

        return DB.get(DB.STORE_META, 'position').then(function (saved) {
            var best = saved || mirrored;
            if (saved && mirrored && mirrored.updatedAt > saved.updatedAt) best = mirrored;
            state.position = best || null;
            return state.position;
        }).catch(function () {
            state.position = mirrored;
            return state.position;
        });
    }

    function savePosition(position) {
        position.updatedAt = new Date().toISOString();
        state.position = position;
        try {
            localStorage.setItem(POSITION_MIRROR_KEY, JSON.stringify(position));
        } catch (error) { /* nothing we can do; IndexedDB is the real store */ }
        return DB.put(DB.STORE_META, position, 'position');
    }

    function progressPercent() {
        if (!state.position || !state.book || !state.book.totalParagraphs) return 0;
        var section = getSection(state.position.sectionId);
        if (!section) return 0;
        var read = section._offset + Math.min(state.position.paraIndex, section._count);
        return Math.max(0, Math.min(100, Math.round((read / state.book.totalParagraphs) * 100)));
    }

    /* --------------------------------------------------------------- notes */

    function loadNotes() {
        return DB.getAll(DB.STORE_NOTES).then(function (notes) {
            state.notes = (notes || []).sort(function (a, b) {
                return (b.updatedAt || '').localeCompare(a.updatedAt || '');
            });
            return state.notes;
        });
    }

    function notesForSection(sectionId) {
        return state.notes.filter(function (note) { return note.sectionId === sectionId; });
    }

    // A note written on the Notes tab rather than against a paragraph. It has
    // no section, no anchor and nothing to re-find, so the resolver leaves it
    // alone rather than declaring it an orphan.
    // Not written against a passage. True of a loose reflection and of a step
    // journal entry alike — both of which resolveNote must leave alone.
    function isStandalone(note) {
        return !note.sectionId;
    }

    // Written against a step rather than a page. Still standalone by the test
    // above, which is why the Reflections list has to exclude these explicitly:
    // a journal entry belongs to its step, not to the loose pile.
    function isStepNote(note) {
        return !!note.stepId;
    }

    function isLooseNote(note) {
        return isStandalone(note) && !isStepNote(note);
    }

    // An answer to one of the step's questions, rather than a note about the
    // step at large. Both carry a stepId; only an answer carries a questionId.
    function isAnswer(note) {
        return !!(note.stepId && note.questionId);
    }

    // The step's own notes — deliberately not its answers, which belong under
    // the questions that prompted them.
    function notesForStep(stepId) {
        return state.notes.filter(function (note) {
            return note.stepId === stepId && !note.questionId;
        });
    }

    // Newest first: the latest answer is the one shown, the rest are history.
    function answersFor(stepId, questionId) {
        return state.notes.filter(function (note) {
            return note.stepId === stepId && note.questionId === questionId;
        }).sort(function (a, b) {
            return (b.createdAt || '').localeCompare(a.createdAt || '');
        });
    }

    function answeredCount(step) {
        var prefs = state.stepPrefs;
        return questionsFor(step).filter(function (q) {
            return answersFor(step.id, q.id).length > 0;
        }).length;
    }

    function lastWorkedOn(stepId) {
        var entries = notesForStep(stepId);
        if (!entries.length) return null;
        return entries.reduce(function (latest, note) {
            var at = note.createdAt || note.updatedAt || '';
            return at > latest ? at : latest;
        }, '');
    }

    // Paragraph numbering can shift if the reader re-imports a differently
    // formatted copy of the text. Each note keeps the opening of the paragraph
    // it was written against, so it can find its way home again.
    function resolveNote(note) {
        if (isStandalone(note)) return note;

        var section = getSection(note.sectionId);
        if (!section) return Object.assign({}, note, { orphan: true });

        var atIndex = section.paragraphs[note.paraIndex];
        if (atIndex && anchorFor(atIndex).indexOf(note.anchor) === 0) return note;

        if (note.anchor) {
            for (var i = 0; i < section.paragraphs.length; i++) {
                if (anchorFor(section.paragraphs[i]).indexOf(note.anchor) === 0) {
                    return Object.assign({}, note, { paraIndex: i, reanchored: true });
                }
            }
        }
        return Object.assign({}, note, { orphan: true });
    }

    function saveNote(note) {
        var now = new Date().toISOString();
        var record = Object.assign({
            id: uid('note'),
            createdAt: now,
            sectionId: null,     // a note of one's own, until a passage says otherwise
            paraIndex: null,
            anchor: '',
            stepId: null,        // set when written against a step
            questionId: null,    // set when it answers one of that step's questions
            tag: '',             // '' | 'sponsor' | 'sponsee'
            discussedAt: null
        }, note, { updatedAt: now });

        if (!record.anchor && record.sectionId) {
            var section = getSection(record.sectionId);
            if (section) record.anchor = anchorFor(section.paragraphs[record.paraIndex]);
        }

        return DB.put(DB.STORE_NOTES, record).then(loadNotes).then(function () { return record; });
    }

    // Ticking something off after a conversation, and putting it back if it
    // turns out there is more to say. The note itself is left untouched.
    function setNoteDiscussed(id, discussed) {
        var existing = state.notes.filter(function (note) { return note.id === id; })[0];
        if (!existing) return Promise.resolve(null);

        var record = Object.assign({}, existing, {
            discussedAt: discussed ? new Date().toISOString() : null,
            updatedAt: new Date().toISOString()
        });
        return DB.put(DB.STORE_NOTES, record).then(loadNotes).then(function () { return record; });
    }

    // How many points are still waiting for each conversation. Drives the
    // counts on the Notes tab filters, so the number is of things not yet
    // talked about — a list of forty settled matters is not four unread ones.
    function waitingFor(tag) {
        return state.notes.filter(function (note) {
            return note.tag === tag && !note.discussedAt;
        }).length;
    }

    function deleteNote(id) {
        return DB.remove(DB.STORE_NOTES, id).then(loadNotes);
    }

    /* ----------------------------------------------------------- bookmarks */

    function loadBookmarks() {
        return DB.getAll(DB.STORE_BOOKMARKS).then(function (bookmarks) {
            state.bookmarks = (bookmarks || []).sort(function (a, b) {
                return (b.createdAt || '').localeCompare(a.createdAt || '');
            });
            return state.bookmarks;
        });
    }

    function findBookmark(sectionId, paraIndex) {
        return state.bookmarks.filter(function (b) {
            return b.sectionId === sectionId && b.paraIndex === paraIndex;
        })[0] || null;
    }

    function toggleBookmark(sectionId, paraIndex) {
        var existing = findBookmark(sectionId, paraIndex);
        if (existing) {
            return DB.remove(DB.STORE_BOOKMARKS, existing.id).then(loadBookmarks).then(function () {
                return { added: false };
            });
        }
        var section = getSection(sectionId);
        var record = {
            id: uid('bm'),
            sectionId: sectionId,
            paraIndex: paraIndex,
            anchor: section ? anchorFor(section.paragraphs[paraIndex]) : '',
            createdAt: new Date().toISOString()
        };
        return DB.put(DB.STORE_BOOKMARKS, record).then(loadBookmarks).then(function () {
            return { added: true, bookmark: record };
        });
    }

    function deleteBookmark(id) {
        return DB.remove(DB.STORE_BOOKMARKS, id).then(loadBookmarks);
    }

    /* -------------------------------------------------------------- search */

    function search(query, limit) {
        var needle = String(query || '').trim().toLowerCase();
        if (needle.length < 2) return [];
        limit = limit || 200;

        var results = [];
        var sections = state.book.sections;
        for (var s = 0; s < sections.length && results.length < limit; s++) {
            var section = sections[s];
            for (var p = 0; p < section.paragraphs.length && results.length < limit; p++) {
                var paragraph = section.paragraphs[p];
                var at = paragraph.toLowerCase().indexOf(needle);
                if (at === -1) continue;
                var from = Math.max(0, at - 60);
                results.push({
                    sectionId: section.id,
                    sectionTitle: section.title,
                    paraIndex: p,
                    excerpt: (from > 0 ? '…' : '') + paragraph.slice(from, at + needle.length + 90).trim() + '…',
                    matchAt: at - from + (from > 0 ? 1 : 0),
                    matchLength: needle.length
                });
            }
        }
        return results;
    }

    /* --------------------------------------------------------------- boot */

    function init() {
        return loadSettings()
            .then(loadBook)
            .then(loadSteps)
            .then(loadStepPrefs)
            .then(loadInventory)
            .then(loadNotes)
            .then(loadBookmarks)
            .then(loadPosition)
            .then(function () { return state; });
    }

    global.Store = {
        state: state,
        DEFAULT_SETTINGS: DEFAULT_SETTINGS,
        init: init,
        uid: uid,
        anchorFor: anchorFor,

        loadBook: loadBook,
        indexBook: indexBook,
        saveImportedBook: saveImportedBook,
        clearImportedBook: clearImportedBook,
        getSection: getSection,
        sectionIndex: sectionIndex,
        readableSections: readableSections,

        loadSteps: loadSteps,
        allSteps: allSteps,
        getStep: getStep,
        stepIsWritten: stepIsWritten,
        resolveStepRef: resolveStepRef,
        stepText: stepText,

        loadSettings: loadSettings,
        saveSettings: saveSettings,

        loadPosition: loadPosition,
        savePosition: savePosition,
        progressPercent: progressPercent,

        loadNotes: loadNotes,
        notesForSection: notesForSection,
        isStandalone: isStandalone,
        isStepNote: isStepNote,
        isAnswer: isAnswer,
        answersFor: answersFor,
        answeredCount: answeredCount,
        loadStepPrefs: loadStepPrefs,
        saveStepPrefs: saveStepPrefs,
        workFor: workFor,
        tableIn: tableIn,
        loadInventory: loadInventory,
        inventoryFor: inventoryFor,
        inventoryCount: inventoryCount,
        rowIsEmpty: rowIsEmpty,
        rowState: rowState,
        setRowState: setRowState,
        rowsForWork: rowsForWork,
        saveInventoryRow: saveInventoryRow,
        deleteInventoryRow: deleteInventoryRow,
        inventoryAsText: inventoryAsText,
        questionsFor: questionsFor,
        questionText: questionText,
        hiddenQuestionsFor: hiddenQuestionsFor,
        setQuestionHidden: setQuestionHidden,
        addQuestion: addQuestion,
        deleteQuestion: deleteQuestion,
        isLooseNote: isLooseNote,
        notesForStep: notesForStep,
        lastWorkedOn: lastWorkedOn,
        resolveNote: resolveNote,
        saveNote: saveNote,
        setNoteDiscussed: setNoteDiscussed,
        waitingFor: waitingFor,
        deleteNote: deleteNote,

        loadBookmarks: loadBookmarks,
        findBookmark: findBookmark,
        toggleBookmark: toggleBookmark,
        deleteBookmark: deleteBookmark,

        search: search
    };
})(window);
