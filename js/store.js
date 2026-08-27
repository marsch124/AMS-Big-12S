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
        keepAwake: false,
        // Who to ring when it is bad. Kept in settings rather than a store of
        // its own because it is one person and one number, and settings already
        // ride the backup.
        sponsorName: '',
        sponsorPhone: '',
        sponseeName: '',
        sponseePhone: '',
        spouseName: '',
        spousePhone: '',
        // The first day. Empty until it is set, and the counter stays off the
        // home screen until then rather than showing a nought.
        soberSince: '',
        // The rules as they stand, kept apart because they are two different
        // conversations. Seeded with Martin's four on the sponsor side; an
        // empty list is a choice and is kept, so clearing one does not bring
        // the defaults back.
        sponsorRules: [
            'No white flour',
            'No alcohol',
            'No white sugar',
            'No substances that trigger'
        ],
        sponseeRules: []
    };

    var POSITION_MIRROR_KEY = 'ams-big-12s:position';

    var state = {
        book: null,              // { title, subtitle, edition, sections: [] }
        settings: Object.assign({}, DEFAULT_SETTINGS),
        position: null,          // { sectionId, paraIndex, ratio, updatedAt }
        notes: [],
        bookmarks: [],
        steps: null,           // { title, edition, steps: [] } from data/steps.json
        daily: null,             // { passages: [] } from data/daily.json
        stepPrefs: { hidden: {}, custom: {} },  // questions hidden, questions added
        inventory: [],           // step four's rows: { id, stepId, tableId, values, ... }
        cravings: [],            // { id, startedAt, endedAt, outcome, what }
        meetings: [],            // { id, on, where, shared, what }
        checkins: [],            // { id, who, on, values, notes }
        visits: null             // the days the app has been opened, ascending
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

    /*
     * Step six asks about the defects named in step four, so it reads two of
     * step four's columns — the part you played in a resentment, and the fault
     * behind a piece of conduct.
     *
     * Unlike step nine, it cannot annotate step four's rows: the same defect
     * turns up in several of them, and it deserves one answer rather than one
     * per row. So identical entries are grouped, and step six keeps rows of its
     * own carrying the answer and where it got to. Nothing is written until the
     * reader touches a defect.
     *
     * Cell values are carried whole and never split on punctuation. "Selfish,
     * frightened" is one thing somebody wrote, and guessing where to cut it
     * would put words in their mouth.
     */
    function defectKey(text) {
        return String(text || '').replace(/\s+/g, ' ').trim().toLowerCase();
    }

    function carriedDefects(step) {
        var work = workFor(step);
        if (!work || !work.from || !work.from.columns) return [];

        var fromStep = getStep(work.from.stepId);
        var fromWork = workFor(fromStep);
        var mine = inventoryFor(step.id, work.tableId || work.kind);

        var order = [];
        var byKey = {};

        work.from.columns.forEach(function (spec) {
            var table = tableIn(fromWork, spec.tableId);
            inventoryFor(work.from.stepId, spec.tableId).forEach(function (row) {
                var text = ((row.values || {})[spec.columnId] || '').trim();
                if (!text) return;
                var key = defectKey(text);
                if (!byKey[key]) {
                    byKey[key] = {
                        key: key,
                        text: text,                 // the first spelling written
                        from: [],
                        row: mine.filter(function (r) {
                            return defectKey((r.values || {}).key || '') === key;
                        })[0] || null
                    };
                    order.push(byKey[key]);
                }
                var where = (table && table.title) || spec.tableId;
                if (byKey[key].from.indexOf(where) === -1) byKey[key].from.push(where);
                byKey[key].count = (byKey[key].count || 0) + 1;
            });
        });

        return order;
    }

    // Lazily creates step six's own row the first time a defect is answered or
    // marked, so an untouched step four leaves nothing behind.
    function saveDefect(step, defect, patch) {
        var work = workFor(step);
        var tableId = work.tableId || work.kind;
        var row = defect.row || {
            stepId: step.id,
            tableId: tableId,
            values: { key: defect.key, defect: defect.text }
        };
        var values = Object.assign({}, row.values, { key: defect.key, defect: defect.text });
        if (patch && typeof patch.answer === 'string') values.answer = patch.answer.trim();

        var states = Object.assign({}, row.states || {});
        if (patch && 'state' in patch) {
            if (patch.state) states[step.id] = patch.state; else delete states[step.id];
        }
        return saveInventoryRow(Object.assign({}, row, { values: values, states: states }));
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

    /* ------------------------------------ taking a step out of the app */

    /*
     * A whole step as plain text, to send to a sponsor before a call.
     *
     * Composed here rather than scraped off the page, because the page folds
     * things away, shows the last five of a log and hides what was held back —
     * all right for reading and wrong for a copy someone is going to rely on.
     * What goes in is the reader's choosing, and what they have not written
     * simply does not appear: an empty heading would suggest a gap where there
     * is none.
     */

    // Matches formatDay() in ui.js. The two must agree, or a step copied out
    // would date itself differently from the page it was copied from.
    function dayText(iso) {
        if (!iso) return '';
        var date = new Date(String(iso).slice(0, 10) + 'T00:00:00');
        if (isNaN(date)) return String(iso);
        return date.toLocaleDateString(undefined,
            { year: 'numeric', month: 'short', day: 'numeric' });
    }

    // Local date, not UTC: at 23:00 in London a UTC date would already be
    // tomorrow, and "today" has to mean the reader's today.
    function dayISO(date) {
        var d = date || new Date();
        return d.getFullYear() + '-' +
            String(d.getMonth() + 1).padStart(2, '0') + '-' +
            String(d.getDate()).padStart(2, '0');
    }

    function shiftDay(iso, days) {
        var d = new Date(iso + 'T00:00:00');
        d.setDate(d.getDate() + days);
        return dayISO(d);
    }

    function todayISO() {
        return dayISO();
    }

    // Every place a work block can declare an input, in the order it declares
    // them, so a copied row reads in the order the page shows it.
    function fieldSpecs(work) {
        var out = [];
        var seen = {};
        function add(list) {
            (list || []).forEach(function (field) {
                if (!field || !field.id || seen[field.id]) return;
                seen[field.id] = true;
                out.push(field);
            });
        }
        add(work.columns);
        add(work.fields);
        add(work.parts);
        (work.tables || []).forEach(function (table) { add(table.columns); });
        if ((work.lists || []).length) add([{ id: 'text', label: '' }]);
        return out;
    }

    // Values a page writes without declaring a field for them: a two-list item,
    // a note against a date, the defect step six carried through. `key` is step
    // six's grouping key and is machinery, never shown.
    var LOOSE_LABELS = { text: '', note: 'Note', defect: 'Defect', answer: 'What I wrote' };

    function groupTitles(work) {
        var titles = {};
        (work.tables || []).forEach(function (table) { titles[table.id] = table.title; });
        (work.lists || []).forEach(function (list) { titles[list.id] = list.title; });
        return titles;
    }

    function stateLabel(work, id) {
        if (!id) return '';
        var found = (work.states || work.statuses || []).filter(function (option) {
            return option.id === id;
        })[0];
        return found ? found.label : '';
    }

    // A field a step deliberately keeps folded away — step five's "what I held
    // back". It is never copied out unless the reader asks for it by name.
    function privateFields(step) {
        var work = workFor(step);
        if (!work) return [];
        return fieldSpecs(work).filter(function (field) { return field.private; });
    }

    // Dictated text arrives with line breaks in it. Keep them, and keep the
    // indent, so a long answer does not fall out of the column it belongs to.
    function pushValue(lines, indent, label, value) {
        var parts = String(value).split(/\n/);
        lines.push(indent + (label ? label + ': ' : '') + parts[0]);
        parts.slice(1).forEach(function (part) { lines.push(indent + part); });
    }

    function rowAsText(step, work, specs, row, position, opts) {
        var lines = [];
        var values = row.values || {};
        var chosen = stateLabel(work, rowState(row, step.id));

        // A dated row is headed by its date; an undated one by its place in the
        // list, so a row is always addressable when talking it through.
        lines.push((row.on ? dayText(row.on) : String(position) + '.') +
            (chosen ? ' — ' + chosen : ''));

        // Step ten's watchwords: several can be true at once, so they read as
        // one line rather than as fields.
        var flags = (work.watch || []).filter(function (watch) { return values[watch.id]; });
        if (flags.length) {
            lines.push('   ' + flags.map(function (watch) { return watch.label; }).join(', '));
        }

        var printed = { key: true };
        (work.watch || []).forEach(function (watch) { printed[watch.id] = true; });

        specs.forEach(function (field) {
            printed[field.id] = true;
            if (field.private && !opts.held) return;
            var value = String(values[field.id] || '').trim();
            if (value) pushValue(lines, '   ', field.label, value);
        });

        Object.keys(values).forEach(function (id) {
            if (printed[id]) return;
            var value = String(values[id] || '').trim();
            if (value) pushValue(lines, '   ', LOOSE_LABELS[id] || '', value);
        });

        lines.push('');
        return lines;
    }

    function workAsText(step, opts) {
        var work = workFor(step);
        if (!work) return [];

        var specs = fieldSpecs(work);
        var titles = groupTitles(work);
        var rows;

        if (work.from && work.from.work) {
            // Step nine's rows are step eight's, and reading one back needs
            // both steps' labels: the name from eight, the outcome from nine.
            var source = workFor(getStep(work.from.stepId));
            if (source) {
                specs = fieldSpecs(source).concat(specs).filter(function (field, i, all) {
                    return all.findIndex(function (other) { return other.id === field.id; }) === i;
                });
                titles = Object.assign(groupTitles(source), titles);
            }
            rows = rowsForWork(step).filter(function (row) {
                if (rowState(row, step.id)) return true;
                return (work.fields || []).some(function (field) {
                    return String((row.values || {})[field.id] || '').trim().length > 0;
                });
            });
        } else {
            rows = state.inventory.filter(function (row) { return row.stepId === step.id; });
        }
        if (!rows.length) return [];

        var order = [];
        var groups = {};
        rows.forEach(function (row) {
            var key = row.tableId || '';
            if (!groups[key]) { groups[key] = []; order.push(key); }
            groups[key].push(row);
        });

        var lines = [];
        order.forEach(function (key) {
            var title = titles[key] || '';
            // One group needs no name — the heading above it already said what
            // this is. Three tables of an inventory need theirs.
            if (order.length > 1 && title) { lines.push(title); lines.push(''); }
            groups[key].forEach(function (row, index) {
                lines = lines.concat(rowAsText(step, work, specs, row, index + 1, opts));
            });
        });
        return lines;
    }

    function stepAsText(step, options) {
        var opts = options || {};
        var lines = [];

        // A rule of fixed length rather than one matched to the heading: this
        // is read in a message app, in whatever font that app uses, and a rule
        // measured in characters comes out ragged in all of them.
        function heading(text) {
            lines.push('');
            lines.push(text);
            lines.push('\u2014\u2014\u2014');
        }

        lines.push('Step ' + step.number + ' \u00b7 ' + step.shortTitle);
        var wording = stepText(step);
        if (wording) lines.push('\u201c' + wording + '\u201d');

        if (opts.answers) {
            var questions = questionsFor(step);
            var answered = [];
            questions.forEach(function (question) {
                var all = answersFor(step.id, question.id);
                if (!all.length) return;
                answered.push({
                    question: question,
                    // The latest answer is the current one; the rest are the
                    // history, and only go if they are asked for.
                    answers: opts.everyAnswer ? all : all.slice(0, 1)
                });
            });
            if (answered.length) {
                heading('Questions and answers');
                answered.forEach(function (item, index) {
                    lines.push(String(index + 1) + '. ' + item.question.text);
                    item.answers.forEach(function (answer) {
                        lines.push('   ' + dayText(answer.createdAt));
                        pushValue(lines, '   ', '', answer.body);
                    });
                    lines.push('');
                });
                var left = questions.length - answered.length;
                if (left) {
                    lines.push(left + (left === 1 ? ' question' : ' questions') +
                        ' not answered yet.');
                }
            }
        }

        if (opts.notes) {
            var notes = notesForStep(step.id).slice().sort(function (a, b) {
                return (b.createdAt || '').localeCompare(a.createdAt || '');
            });
            if (notes.length) {
                heading('Notes on this step');
                notes.forEach(function (note) {
                    lines.push(dayText(note.createdAt));
                    pushValue(lines, '', '', note.body);
                    lines.push('');
                });
            }
        }

        if (opts.work) {
            var work = workAsText(step, opts);
            if (work.length) {
                heading('The work of this step');
                lines = lines.concat(work);
            }
        }

        lines.push('');
        lines.push('Copied from AMS Big 12S on ' + dayText(todayISO()) + '.');

        return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
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

            // 2.8 kept one list of rules; 2.9 keeps two. Anything written under
            // the old key belongs to the sponsor list, and is moved there rather
            // than being quietly replaced by the defaults. It is written back on
            // the next save of anything.
            if (Array.isArray(state.settings.rules)) {
                if (!(saved && Array.isArray(saved.sponsorRules))) {
                    state.settings.sponsorRules = state.settings.rules;
                }
                delete state.settings.rules;
            }
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

    /*
     * Forget where you were. The card goes, and the app offers the book from the
     * beginning again — which is what somebody starting a fresh read wants, and
     * there was no way to say it before.
     */
    function clearPosition() {
        state.position = null;
        try {
            localStorage.removeItem(POSITION_MIRROR_KEY);
        } catch (error) { /* nothing we can do; IndexedDB is the real store */ }
        return DB.remove(DB.STORE_META, 'position');
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

    /*
     * How much of a step has actually been done.
     *
     * Three separate things count and the list used to show only the first:
     * notes on the step, questions answered, and the rows of the step's own
     * work. Answering eight questions and filling in an inventory left the row
     * reading as untouched, which is the app telling the reader they have not
     * done something they have.
     */
    function workCount(step) {
        var work = workFor(step);
        if (!work) return 0;

        // A step that writes onto another step's rows owns none of its own, so
        // what counts is the rows it has written on. Otherwise step nine would
        // look finished the moment step eight had names in it.
        if (work.from && work.from.work) {
            var mine = (work.fields || []).map(function (field) { return field.id; });
            return rowsForWork(step).filter(function (row) {
                if (rowState(row, step.id)) return true;
                return mine.some(function (id) {
                    return String((row.values || {})[id] || '').trim().length > 0;
                });
            }).length;
        }

        // Every other kind owns its rows, whatever it calls its tables — two
        // lists, three inventories or one log all belong to the step itself.
        return state.inventory.filter(function (row) {
            return row.stepId === step.id;
        }).length;
    }

    // "3 sittings", "1 person" — each kind names its own rows, because "3
    // entries" is true of all of them and tells the reader nothing. The build
    // refuses a work block that has not declared one.
    function workNoun(step, count) {
        var work = workFor(step);
        var names = (work && work.count) || { one: 'entry', many: 'entries' };
        return count === 1 ? names.one : names.many;
    }

    function stepProgress(stepId) {
        var step = getStep(stepId);
        if (!step) return { notes: 0, answered: 0, questions: 0, work: 0, total: 0, noun: '' };

        var questions = questionsFor(step);
        var answered = questions.filter(function (question) {
            return answersFor(stepId, question.id).length > 0;
        }).length;
        var notes = notesForStep(stepId).length;
        var rows = workCount(step);

        return {
            notes: notes,
            answered: answered,
            questions: questions.length,
            work: rows,
            noun: workNoun(step, rows),
            total: notes + answered + rows,
            lastAt: lastWorkedOn(stepId)
        };
    }

    /*
     * The last time anything was written for this step — a note, an answer, or
     * a row of its work. Counting only notes would date step four from the last
     * time it was written *about* rather than the last time it was worked.
     */
    function lastWorkedOn(stepId) {
        var latest = '';
        function consider(at) { if (at && at > latest) latest = at; }

        state.notes.forEach(function (note) {
            if (note.stepId === stepId) consider(note.createdAt || note.updatedAt);
        });
        state.inventory.forEach(function (row) {
            if (row.stepId === stepId) consider(row.updatedAt || row.createdAt);
        });

        // A step that annotates another's rows is worked when it writes on one.
        var step = getStep(stepId);
        var work = workFor(step);
        if (work && work.from && work.from.work) {
            rowsForWork(step).forEach(function (row) {
                if (rowState(row, stepId)) consider(row.updatedAt || row.createdAt);
            });
        }

        return latest || null;
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

    /* ------------------------------------------------------ a passage a day */

    /*
     * data/daily.json is built by tools/build-daily.js: passages verified word
     * for word against the book, each carrying the section, the paragraph and
     * the anchor that finds it again.
     */
    function loadDaily() {
        return fetch('data/daily.json', { cache: 'no-cache' })
            .then(function (response) {
                if (!response.ok) throw new Error('daily.json: HTTP ' + response.status);
                return response.json();
            })
            .then(function (data) { state.daily = data; return data; })
            .catch(function (error) {
                console.warn('Could not load data/daily.json', error);
                state.daily = { passages: [] };
                return state.daily;
            });
    }

    // Whole days since the epoch, counted off the reader's own calendar date.
    // Built from Date.UTC so the arithmetic is in exact days and a clock going
    // back an hour in October cannot hand back yesterday's number.
    function dayNumber(date) {
        var d = date || new Date();
        return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000);
    }

    /*
     * The passage for a given day. The same for everyone reading on the same
     * date, settled at midnight and unchanged until the next one — a passage
     * you can think about all day is worth more than a fresh one every time the
     * app opens.
     */
    function resolvePassage(passage) {
        var section = getSection(passage.sectionId);
        return {
            text: passage.text,
            sectionId: passage.sectionId,
            // The live section's title, not the one recorded at build time: the
            // reader may be on their own copy of the text.
            sectionTitle: (section && section.title) || passage.sectionTitle,
            // Resolved the way a note or a step reference is, so the link lands
            // on the right words rather than a remembered paragraph number.
            // Null means this copy of the text has not got it.
            paraIndex: resolveStepRef(passage)
        };
    }

    function passageForDay(date) {
        var passages = (state.daily && state.daily.passages) || [];
        if (!passages.length) return null;
        return resolvePassage(passages[dayNumber(date) % passages.length]);
    }

    /*
     * A passage for the craving screen — drawn at random rather than by the
     * day, because this one is not read once a day at a set time, and the same
     * words on the third bad evening running would be wallpaper. Never the one
     * shown last.
     */
    var lastCraving = '';

    function passageForCraving() {
        var list = (state.daily && state.daily.craving) || [];
        if (!list.length) return null;

        var choices = list.filter(function (p) { return p.text !== lastCraving; });
        if (!choices.length) choices = list;

        var passage = choices[Math.floor(Math.random() * choices.length)];
        lastCraving = passage.text;
        return resolvePassage(passage);
    }

    /*
     * How many days in a row a daily step has been written, counted back from
     * today — or from yesterday when today is not written yet, because
     * otherwise every run would read zero each morning until you had done it,
     * which turns a record of practice into a reprimand.
     */
    function stepStreak(step) {
        var work = workFor(step);
        if (!work || String(work.kind).indexOf('daily') !== 0) return 0;

        var byDay = {};
        rowsForWork(step).forEach(function (row) { if (row.on) byDay[row.on] = true; });

        var cursor = byDay[todayISO()] ? todayISO() : shiftDay(todayISO(), -1);
        var run = 0;
        while (byDay[cursor]) { run++; cursor = shiftDay(cursor, -1); }
        return run;
    }

    /* ------------------------------------------------------- the check-ins */

    var CHECKIN_SPECS = {
        sponsor: {
            title: 'Talking to my sponsor',
            heading: 'Before we talk',
            empty: 'Nothing waiting for your sponsor. Mark a note for them and it turns up here.',
            fields: [
                { id: 'abstinent', label: 'Am I abstinent?', type: 'choice',
                  choices: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }] },
                { id: 'forMyself', label: 'What have I done for myself today?' },
                { id: 'forOthers', label: 'What have I done for others today?' },
                { id: 'hiding', label: 'Do I hide anything?' },
                { id: 'feeling', label: 'How do I feel?' },
                { id: 'questions', label: 'Do I have any questions?' }
            ]
        },
        sponsee: {
            title: 'Talking to my sponsee',
            heading: 'Before we talk',
            empty: 'Nothing waiting for your sponsee. Mark a note for them and it turns up here.',
            fields: [
                { id: 'abstinent', label: 'Is he abstinent?', type: 'choice',
                  choices: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' },
                            { value: 'unknown', label: 'Don’t know' }] },
                { id: 'forHimself', label: 'What has he done for himself?' },
                { id: 'forOthers', label: 'What has he done for others?' },
                { id: 'okay', label: 'Is he okay?' },
                { id: 'questions', label: 'Any questions?' }
            ]
        }
    };

    var CHECKIN_NOTES = { id: 'notes', label: 'Notes from the meeting', rows: 4 };

    /*
     * What you worked out before a conversation, and what came of it. One
     * record a day for each of the two people, found by the day rather than
     * created afresh — coming back to it in the evening should add to the
     * morning's answers, not start a second copy of them.
     */
    function loadCheckins() {
        return DB.getAll(DB.STORE_CHECKINS).then(function (rows) {
            state.checkins = (rows || []).sort(function (a, b) {
                return String(b.on || '').localeCompare(String(a.on || ''));
            });
            return state.checkins;
        }).catch(function () {
            state.checkins = [];
            return state.checkins;
        });
    }

    function checkinFor(who, on) {
        var day = on || todayISO();
        return state.checkins.filter(function (row) {
            return row.who === who && row.on === day;
        })[0] || null;
    }

    function checkinsFor(who) {
        return state.checkins.filter(function (row) { return row.who === who; });
    }

    // Only what is passed is changed; everything else on the day stands.
    function saveCheckin(who, on, patch) {
        var day = on || todayISO();
        var existing = checkinFor(who, day);
        var now = new Date().toISOString();
        var record = {
            id: (existing && existing.id) || uid('chk'),
            who: who,
            on: day,
            values: Object.assign({}, existing && existing.values, patch && patch.values),
            notes: patch && patch.notes !== undefined
                ? String(patch.notes).trim()
                : (existing ? existing.notes : ''),
            createdAt: (existing && existing.createdAt) || now,
            updatedAt: now
        };
        return DB.put(DB.STORE_CHECKINS, record).then(loadCheckins).then(function () {
            return record;
        });
    }

    function deleteCheckin(id) {
        return DB.remove(DB.STORE_CHECKINS, id).then(loadCheckins);
    }

    function checkinSpec(who) {
        return CHECKIN_SPECS[who] || CHECKIN_SPECS.sponsor;
    }

    /*
     * The day's page as plain text, for pasting into a message before a call or
     * after one.
     *
     * Composed here rather than scraped off the screen, for the same reason a
     * step is: the page is arranged for filling in, and a copy somebody will
     * rely on has to be arranged for reading. What has not been answered is
     * counted and said at the end rather than left as a silence.
     */
    function checkinAsText(who, on, options) {
        options = options || {};
        var spec = checkinSpec(who);
        var day = on || todayISO();
        var row = checkinFor(who, day) || { values: {}, notes: '' };
        var values = row.values || {};
        var lines = [spec.title + ' \u2014 ' + dayText(day), ''];
        var missing = 0;

        spec.fields.forEach(function (field) {
            var value = String(values[field.id] || '').trim();
            if (!value) { missing++; return; }
            if (field.type === 'choice') {
                var chosen = (field.choices || []).filter(function (choice) {
                    return choice.value === value;
                })[0];
                if (chosen) value = chosen.label;
            }
            lines.push(field.label);
            lines.push(value);
            lines.push('');
        });

        var notes = String(row.notes || '').trim();
        if (notes && options.notes !== false) {
            lines.push(CHECKIN_NOTES.label);
            lines.push(notes);
            lines.push('');
        }

        if (missing) {
            lines.push(missing + (missing === 1 ? ' question' : ' questions') +
                ' not answered yet.');
            lines.push('');
        }

        lines.push('Copied from AMS Big 12S on ' + dayText(todayISO()) + '.');
        return lines.join('\n');
    }

    // A day with nothing written on it is not a day you prepared. Used to keep
    // empty records out of the history rather than to stop them being saved.
    function checkinIsEmpty(row) {
        if (!row) return true;
        if (String(row.notes || '').trim()) return false;
        var values = row.values || {};
        return !Object.keys(values).some(function (key) {
            return String(values[key] || '').trim().length > 0;
        });
    }

    // One sentence, used by the screen and by the copy, so the two cannot come
    // to different conclusions about the same list.
    function meetingSummaryLine() {
        var summary = meetingSummary();
        if (!summary.total) {
            return 'Nothing written down yet. Nobody remembers in March how many they got to in January.';
        }
        var line = summary.total === 1 ? 'One written down' : summary.total + ' written down';
        line += ', ' + summary.recent + ' in the last thirty days.';
        if (summary.shared) {
            line += ' You spoke at ' + (summary.shared === 1 ? 'one of them.' : summary.shared + ' of them.');
        }
        return line;
    }

    /*
     * The meetings as plain text. Composed here rather than read off the screen,
     * which shows the last twelve and folds nothing else in.
     */
    function meetingsAsText(options) {
        options = options || {};
        var cutoff = options.recent === false ? '' : shiftDay(todayISO(), -29);
        var rows = state.meetings.filter(function (row) {
            return !cutoff || String(row.on || '') >= cutoff;
        });

        var lines = ['Meetings', '', meetingSummaryLine(), ''];
        if (cutoff) lines.push('The last thirty days:');
        else if (rows.length) lines.push('All of them:');
        if (cutoff || rows.length) lines.push('');

        rows.forEach(function (row) {
            var head = meetingDayText(row.on);
            if (row.where) head += ' \u00b7 ' + row.where;
            if (row.shared) head += ' \u00b7 shared';
            lines.push(head);
            if (row.what && options.what !== false) lines.push('    ' + row.what);
        });
        if (!rows.length) lines.push('Nothing in that stretch.');
        lines.push('');

        if (options.raise) {
            var waiting = state.notes.filter(function (note) {
                return note.tag === 'meeting' && !note.discussedAt;
            });
            if (waiting.length) {
                lines.push('To bring up:');
                waiting.forEach(function (note) { lines.push('\u2022 ' + note.body); });
                lines.push('');
            }
        }

        lines.push('Copied from AMS Big 12S on ' + dayText(todayISO()) + '.');
        return lines.join('\n');
    }

    /* ------------------------------------------------------- showing up */

    /*
     * The days the app has been opened. Kept as a plain list of local dates,
     * rather than a running total, so anything about them can be worked out
     * later — a run, a best run, how many in a month — without having had the
     * foresight to count it at the time.
     */
    function loadVisits() {
        return DB.get(DB.STORE_META, 'visits').then(function (saved) {
            state.visits = Array.isArray(saved) ? saved.slice() : null;
            return state.visits;
        }).catch(function () {
            state.visits = null;
            return null;
        });
    }

    /*
     * The first time this runs there is no list, but there is a year of work
     * with dates on it — and a day something was written is a day the app was
     * open. Seeding from that means the run does not start at one for somebody
     * who has been here every morning since March.
     */
    function seedVisits() {
        var days = {};
        function consider(at) {
            if (!at) return;
            var d = new Date(at);
            if (!isNaN(d)) days[dayISO(d)] = true;
        }
        function stamps(row) { consider(row.updatedAt || row.createdAt); }

        if (state.position) consider(state.position.updatedAt);
        state.notes.forEach(stamps);
        state.bookmarks.forEach(stamps);
        state.inventory.forEach(function (row) { stamps(row); if (row.on) days[row.on] = true; });
        state.cravings.forEach(function (row) { stamps(row); consider(row.startedAt); });
        state.meetings.forEach(function (row) { stamps(row); if (row.on) days[row.on] = true; });

        return Object.keys(days).sort();
    }

    function recordVisit(date) {
        var today = dayISO(date);
        var had = Array.isArray(state.visits);
        if (!had) state.visits = seedVisits();

        var known = state.visits.indexOf(today) !== -1;
        if (!known) {
            state.visits.push(today);
            state.visits.sort();
        }
        // Nothing new to write: the list existed and today was already in it.
        if (had && known) return Promise.resolve(state.visits);

        return DB.put(DB.STORE_META, state.visits, 'visits').then(function () {
            return state.visits;
        });
    }

    // Counted back from today — or from yesterday, if today has not been
    // recorded yet, so a run does not read zero for the moment before the app
    // has finished starting up.
    function daysRunning(date) {
        var days = {};
        (state.visits || []).forEach(function (day) { days[day] = true; });

        var cursor = dayISO(date);
        if (!days[cursor]) cursor = shiftDay(cursor, -1);
        var run = 0;
        while (days[cursor]) { run++; cursor = shiftDay(cursor, -1); }
        return run;
    }

    function bestRun() {
        var days = (state.visits || []).slice().sort();
        var best = 0;
        var run = 0;
        var previous = null;
        days.forEach(function (day) {
            run = (previous && shiftDay(previous, 1) === day) ? run + 1 : 1;
            previous = day;
            if (run > best) best = run;
        });
        return best;
    }

    /* ------------------------------------------------------------ cravings */

    /*
     * A craving, from the moment it is named to the moment it is over.
     *
     * The record is the point of the thing. In the middle of one it is not
     * obvious that it will end, and the only convincing argument that it will
     * is a list of the other ones that did. So a row is written when it starts,
     * not when it is safely over, and it can be closed with one tap.
     *
     * `outcome` is 'passed' or 'drank'. The second is there on purpose: a list
     * that can only record victories is not a record, and step ten asks for
     * the other kind too.
     */
    function loadCravings() {
        return DB.getAll(DB.STORE_CRAVINGS).then(function (rows) {
            state.cravings = (rows || []).sort(function (a, b) {
                return String(b.startedAt || '').localeCompare(String(a.startedAt || ''));
            });
            return state.cravings;
        }).catch(function () {
            state.cravings = [];
            return state.cravings;
        });
    }

    // At most one is open at a time. If two ever were — two tabs, a restore —
    // the newest is the one being lived through.
    function openCraving() {
        return state.cravings.filter(function (row) { return !row.endedAt; })[0] || null;
    }

    function saveCraving(row) {
        var now = new Date().toISOString();
        var record = {
            id: row.id || uid('crav'),
            startedAt: row.startedAt || now,
            endedAt: row.endedAt || null,
            outcome: row.outcome || null,
            what: String(row.what || '').trim(),
            createdAt: row.createdAt || now,
            updatedAt: now
        };
        return DB.put(DB.STORE_CRAVINGS, record).then(loadCravings).then(function () {
            return record;
        });
    }

    // Starting one twice by accident would break the run of records, so an open
    // one is handed back rather than a second one being written.
    function startCraving() {
        var already = openCraving();
        if (already) return Promise.resolve(already);
        return saveCraving({ startedAt: new Date().toISOString() });
    }

    function endCraving(id, patch) {
        var existing = state.cravings.filter(function (row) { return row.id === id; })[0];
        if (!existing) return Promise.resolve(null);
        patch = patch || {};
        return saveCraving(Object.assign({}, existing, {
            endedAt: patch.endedAt || existing.endedAt || new Date().toISOString(),
            outcome: patch.outcome || existing.outcome || 'passed',
            what: patch.what !== undefined ? patch.what : existing.what
        }));
    }

    function deleteCraving(id) {
        return DB.remove(DB.STORE_CRAVINGS, id).then(loadCravings);
    }

    function cravingMinutes(row) {
        if (!row || !row.startedAt || !row.endedAt) return null;
        var minutes = (new Date(row.endedAt) - new Date(row.startedAt)) / 60000;
        return minutes >= 0 ? Math.round(minutes) : null;
    }

    /*
     * What the list adds up to. `passed` counts only what is closed and did
     * pass, so the screen can say "every one of them passed" and be telling the
     * truth — and stop saying it the moment one did not.
     */
    function cravingSummary() {
        var closed = state.cravings.filter(function (row) { return !!row.endedAt; });
        var passed = closed.filter(function (row) { return row.outcome !== 'drank'; });
        var longest = 0;
        closed.forEach(function (row) {
            var minutes = cravingMinutes(row);
            if (minutes !== null && minutes > longest) longest = minutes;
        });
        return {
            total: state.cravings.length,
            closed: closed.length,
            passed: passed.length,
            longest: longest,
            open: openCraving(),
            lastEndedAt: closed.length ? closed[0].endedAt : null
        };
    }

    /* ------------------------------------------------------------ the count */

    /*
     * Days counted inclusively from the first day, so the day you set it reads
     * one rather than nought — which is how anybody says it, and day one is the
     * one worth counting most.
     *
     * Null when there is no date to count from. A date in the future counts as
     * nothing yet rather than as a negative number.
     */
    function daysAbstinent(date) {
        var since = String(state.settings.soberSince || '').trim();
        if (!since) return null;
        var start = new Date(since + 'T00:00:00');
        if (isNaN(start)) return null;
        return Math.max(0, dayNumber(date) - dayNumber(start) + 1);
    }

    /*
     * The last time anything was actually done in here — a page read, a note, a
     * step row, a craving, a meeting. Opening the app does not count: the
     * question is whether the practice is still happening, and standing in the
     * doorway is not the practice.
     */
    function lastActivity() {
        var latest = '';
        function consider(at) { if (at && at > latest) latest = at; }

        if (state.position) consider(state.position.updatedAt);
        state.notes.forEach(function (row) { consider(row.updatedAt || row.createdAt); });
        state.bookmarks.forEach(function (row) { consider(row.updatedAt || row.createdAt); });
        state.inventory.forEach(function (row) { consider(row.updatedAt || row.createdAt); });
        state.cravings.forEach(function (row) { consider(row.updatedAt || row.createdAt); });
        state.meetings.forEach(function (row) { consider(row.updatedAt || row.createdAt); });

        return latest || null;
    }

    // Whole days, so "today" means today whatever the hour. Null when nothing
    // has ever been written.
    function daysSinceActivity(date) {
        var last = lastActivity();
        if (!last) return null;
        return Math.max(0, dayNumber(date) - dayNumber(new Date(last)));
    }

    /* ------------------------------------------------------------ meetings */

    /*
     * A meeting you were at: the day, where it was, whether you spoke, and
     * anything worth keeping. Dated by the day rather than the minute — a
     * meeting happened on a Tuesday, and writing it up on Wednesday morning
     * does not make it Wednesday's.
     */
    function loadMeetings() {
        return DB.getAll(DB.STORE_MEETINGS).then(function (rows) {
            state.meetings = (rows || []).sort(function (a, b) {
                var byDay = String(b.on || '').localeCompare(String(a.on || ''));
                return byDay || String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
            });
            return state.meetings;
        }).catch(function () {
            state.meetings = [];
            return state.meetings;
        });
    }

    function saveMeeting(row) {
        var now = new Date().toISOString();
        var record = {
            id: row.id || uid('meet'),
            on: row.on || todayISO(),
            where: String(row.where || '').trim(),
            shared: !!row.shared,
            what: String(row.what || '').trim(),
            createdAt: row.createdAt || now,
            updatedAt: now
        };
        return DB.put(DB.STORE_MEETINGS, record).then(loadMeetings).then(function () {
            return record;
        });
    }

    function deleteMeeting(id) {
        return DB.remove(DB.STORE_MEETINGS, id).then(loadMeetings);
    }

    /*
     * The places you actually go, newest first. Offered as chips in the sheet so
     * the usual meeting is one tap rather than typed out again every week — and
     * so the same meeting keeps the same name, which is what makes the list
     * countable later.
     */
    function usualPlaces(limit) {
        var seen = {};
        var places = [];
        state.meetings.forEach(function (row) {
            var name = String(row.where || '').trim();
            var key = name.toLowerCase();
            if (!name || seen[key]) return;
            seen[key] = true;
            places.push(name);
        });
        return places.slice(0, limit || 6);
    }

    // Weekday and date. Meetings are weekly things, so "Tuesday, Kolpinghaus"
    // only reads right against a Tuesday — on the screen and in a copy alike.
    function meetingDayText(iso) {
        var d = new Date(String(iso).slice(0, 10) + 'T00:00:00');
        if (isNaN(d)) return String(iso);
        var format = { weekday: 'short', month: 'short', day: 'numeric' };
        if (d.getFullYear() !== new Date().getFullYear()) format.year = 'numeric';
        return d.toLocaleDateString(undefined, format);
    }

    function meetingSummary() {
        var cutoff = shiftDay(todayISO(), -29);
        var recent = state.meetings.filter(function (row) {
            return String(row.on || '') >= cutoff;
        });
        return {
            total: state.meetings.length,
            recent: recent.length,
            shared: state.meetings.filter(function (row) { return row.shared; }).length,
            last: state.meetings[0] || null
        };
    }

    /* --------------------------------------------------------------- boot */

    function init() {
        return loadSettings()
            .then(loadBook)
            .then(loadSteps)
            .then(loadDaily)
            .then(loadStepPrefs)
            .then(loadInventory)
            .then(loadCravings)
            .then(loadMeetings)
            .then(loadCheckins)
            .then(loadVisits)
            .then(loadNotes)
            .then(loadBookmarks)
            .then(loadPosition)
            // Last, because seeding a first list reads everything above it.
            .then(function () { return recordVisit(); })
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

        loadDaily: loadDaily,
        passageForDay: passageForDay,
        passageForCraving: passageForCraving,
        dayNumber: dayNumber,
        stepStreak: stepStreak,

        loadVisits: loadVisits,
        recordVisit: recordVisit,
        daysRunning: daysRunning,
        bestRun: bestRun,
        dayISO: dayISO,
        shiftDay: shiftDay,
        todayISO: todayISO,
        getStep: getStep,
        stepIsWritten: stepIsWritten,
        resolveStepRef: resolveStepRef,
        stepText: stepText,

        loadSettings: loadSettings,
        saveSettings: saveSettings,

        loadPosition: loadPosition,
        savePosition: savePosition,
        clearPosition: clearPosition,
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
        carriedDefects: carriedDefects,
        saveDefect: saveDefect,
        rowState: rowState,
        setRowState: setRowState,
        rowsForWork: rowsForWork,
        saveInventoryRow: saveInventoryRow,
        deleteInventoryRow: deleteInventoryRow,
        inventoryAsText: inventoryAsText,
        stepAsText: stepAsText,
        privateFields: privateFields,
        questionsFor: questionsFor,
        questionText: questionText,
        hiddenQuestionsFor: hiddenQuestionsFor,
        setQuestionHidden: setQuestionHidden,
        addQuestion: addQuestion,
        deleteQuestion: deleteQuestion,
        isLooseNote: isLooseNote,
        notesForStep: notesForStep,
        workCount: workCount,
        stepProgress: stepProgress,
        lastWorkedOn: lastWorkedOn,
        resolveNote: resolveNote,
        saveNote: saveNote,
        setNoteDiscussed: setNoteDiscussed,
        waitingFor: waitingFor,
        deleteNote: deleteNote,

        loadCravings: loadCravings,
        openCraving: openCraving,
        saveCraving: saveCraving,
        startCraving: startCraving,
        endCraving: endCraving,
        deleteCraving: deleteCraving,
        cravingMinutes: cravingMinutes,
        cravingSummary: cravingSummary,

        daysAbstinent: daysAbstinent,
        lastActivity: lastActivity,
        daysSinceActivity: daysSinceActivity,

        loadCheckins: loadCheckins,
        checkinFor: checkinFor,
        checkinsFor: checkinsFor,
        saveCheckin: saveCheckin,
        deleteCheckin: deleteCheckin,
        checkinIsEmpty: checkinIsEmpty,
        checkinSpec: checkinSpec,
        checkinAsText: checkinAsText,
        CHECKIN_NOTES: CHECKIN_NOTES,

        loadMeetings: loadMeetings,
        saveMeeting: saveMeeting,
        deleteMeeting: deleteMeeting,
        usualPlaces: usualPlaces,
        meetingSummary: meetingSummary,
        meetingSummaryLine: meetingSummaryLine,
        meetingDayText: meetingDayText,
        meetingsAsText: meetingsAsText,

        loadBookmarks: loadBookmarks,
        findBookmark: findBookmark,
        toggleBookmark: toggleBookmark,
        deleteBookmark: deleteBookmark,

        search: search
    };
})(window);
