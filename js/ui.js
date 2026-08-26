/*
 * ui.js — screens, rendering and every bit of wiring between them.
 */
(function (global) {
    'use strict';

    var $ = function (id) { return document.getElementById(id); };
    var current = { screen: 'home', sectionId: null, paraIndex: 0 };
    var scrollSaveTimer = null;
    var searchTimer = null;
    var wakeLock = null;
    var pasteHandler = null;
    var notesFilter = 'all';   // all | sponsor | sponsee | steps | own
    var noteTag = '';          // the chip currently lit in the note sheet
    var noteOnPassage = false; // whether that sheet has a passage behind it

    /* ------------------------------------------------------------ helpers */

    function escapeHtml(text) {
        return String(text)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function toast(message, ms) {
        var el = $('toast');
        el.textContent = message;
        el.hidden = false;
        clearTimeout(el._timer);
        el._timer = setTimeout(function () { el.hidden = true; }, ms || 2600);
    }

    function formatDate(iso) {
        if (!iso) return '';
        var date = new Date(iso);
        if (isNaN(date)) return '';
        return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) +
            ' · ' + date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    }

    function firstWords(text, count) {
        var words = String(text || '').split(/\s+/);
        return words.slice(0, count).join(' ') + (words.length > count ? '…' : '');
    }

    /* ------------------------------------------------------------ settings */

    function applySettings() {
        var settings = Store.state.settings;
        var theme = settings.theme;
        if (theme === 'auto') {
            theme = global.matchMedia && global.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
        }
        document.documentElement.setAttribute('data-theme', theme);
        document.documentElement.setAttribute('data-typeface', settings.typeface);
        document.documentElement.style.setProperty('--reader-size', settings.fontSize + 'px');
        document.documentElement.style.setProperty('--reader-leading', settings.lineHeight);

        var meta = document.querySelector('meta[name="theme-color"]');
        if (meta) {
            meta.setAttribute('content', getComputedStyle(document.documentElement)
                .getPropertyValue('--bg-raised').trim() || '#8c6d46');
        }
    }

    function requestWakeLock() {
        if (!Store.state.settings.keepAwake || !navigator.wakeLock || wakeLock) return;
        navigator.wakeLock.request('screen').then(function (lock) {
            wakeLock = lock;
            lock.addEventListener('release', function () { wakeLock = null; });
        }).catch(function () { /* denied or unsupported — not worth surfacing */ });
    }

    function releaseWakeLock() {
        if (wakeLock) { wakeLock.release().catch(function () {}); wakeLock = null; }
    }

    /* -------------------------------------------------------- navigation */

    function showScreen(name) {
        if (name !== 'reader') flushPosition();
        ['home', 'reader', 'steps', 'step', 'notes', 'search', 'settings'].forEach(function (screen) {
            $('screen-' + screen).classList.toggle('is-active', screen === name);
        });
        // A step page is pushed from the Steps tab, so that tab stays lit while
        // you are inside one.
        var litTab = name === 'step' ? 'steps' : name;
        Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (tab) {
            tab.classList.toggle('is-active', tab.dataset.screen === litTab);
        });
        // The reader gets the whole screen; the tab bar would only steal room.
        $('tabbar').hidden = name === 'reader';
        current.screen = name;

        if (name === 'reader') requestWakeLock(); else releaseWakeLock();
        if (name === 'home') renderHome();
        if (name === 'notes') renderNotes();
        if (name === 'settings') renderSettings();
        if (name === 'steps') renderSteps();
        if (name === 'search') setTimeout(function () { $('search-input').focus(); }, 60);
    }

    /* --------------------------------------------------------------- home */

    function renderHome() {
        var book = Store.state.book;
        $('home-title').textContent = book.title || 'Alcoholics Anonymous';
        $('home-edition').textContent = [book.edition, book.subtitle].filter(Boolean).join(' — ');
        $('import-notice').hidden = !!book.textIncluded;

        renderContinueCard();

        var toc = $('toc');
        toc.innerHTML = '';
        book.sections.forEach(function (section) {
            var hasText = section.paragraphs.length > 0;
            var noteCount = Store.notesForSection(section.id).length;

            var item = document.createElement('button');
            item.className = 'toc-item' + (hasText ? '' : ' is-empty') +
                (section.kind === 'part' ? ' toc-part' : '');
            item.disabled = !hasText;
            item.innerHTML =
                '<span class="toc-num">' + (section.number ? section.number : '') + '</span>' +
                '<span class="toc-title">' + escapeHtml(section.title) + '</span>' +
                '<span class="toc-badge">' + (noteCount ? '✎ ' + noteCount : '') + '</span>';
            item.addEventListener('click', function () { openReader(section.id, { paraIndex: 0 }); });
            toc.appendChild(item);
        });
    }

    function renderContinueCard() {
        var card = $('continue-card');
        var position = Store.state.position;
        if (!position || !Store.state.book.textIncluded) { card.hidden = true; return; }

        var section = Store.getSection(position.sectionId);
        if (!section || !section.paragraphs.length) { card.hidden = true; return; }

        var index = Math.min(position.paraIndex || 0, section.paragraphs.length - 1);
        card.hidden = false;
        $('continue-title').textContent = section.title;
        $('continue-excerpt').textContent = firstWords(section.paragraphs[index], 28);
        $('continue-progress').style.width = Store.progressPercent() + '%';
        $('continue-meta').textContent = Store.progressPercent() + '% through the book · ' +
            formatDate(position.updatedAt);
        card.onclick = function () {
            openReader(position.sectionId, { paraIndex: index, ratio: position.ratio });
        };
    }

    /* ------------------------------------------------------------- reader */

    function openReader(sectionId, options) {
        options = options || {};
        // Remember where the reader was opened from, so leaving it goes back
        // there rather than dumping you on the Read tab. Chapter-to-chapter
        // moves inside the reader must not overwrite it.
        if (current.screen !== 'reader') {
            current.readerFrom = current.screen;
            current.readerFromStep = current.stepId;
        }
        var section = Store.getSection(sectionId);
        if (!section || !section.paragraphs.length) {
            toast('That section has no text yet.');
            return;
        }
        current.sectionId = sectionId;
        renderReader(section, options);
        showScreen('reader');
    }

    function renderReader(section, options) {
        $('reader-title').textContent = section.title;

        var notes = {};
        Store.notesForSection(section.id).forEach(function (note) {
            var resolved = Store.resolveNote(note);
            if (!resolved.orphan) notes[resolved.paraIndex] = resolved;
        });
        var bookmarks = {};
        Store.state.bookmarks.forEach(function (bm) {
            if (bm.sectionId === section.id) bookmarks[bm.paraIndex] = bm;
        });

        var html = '';
        if (section.number) {
            html += '<p class="chapter-kicker">Chapter ' + section.number + '</p>';
        }
        html += '<h2 class="chapter-heading">' + escapeHtml(section.title) + '</h2>';
        html += '<hr class="chapter-rule">';

        section.paragraphs.forEach(function (paragraph, index) {
            var classes = ['para'];
            if (notes[index]) classes.push('has-note');
            if (bookmarks[index]) classes.push('has-bookmark');
            html += '<p class="' + classes.join(' ') + '" data-index="' + index + '">' +
                escapeHtml(paragraph);
            if (notes[index]) {
                // A note kept for a conversation says so on the page itself, so
                // you meet it again while reading rather than only in a list.
                var waiting = notes[index].tag ? TAG_SHORT[notes[index].tag] + ' · ' : '';
                html += '<span class="para-flag">✎ ' +
                    escapeHtml(waiting + firstWords(notes[index].body, 12)) + '</span>';
            }
            html += '</p>';
        });

        $('reader-content').innerHTML = html;

        var index = Store.sectionIndex(section.id);
        var sections = Store.state.book.sections;
        var previous = null, next = null;
        for (var i = index - 1; i >= 0; i--) { if (sections[i].paragraphs.length) { previous = sections[i]; break; } }
        for (var j = index + 1; j < sections.length; j++) { if (sections[j].paragraphs.length) { next = sections[j]; break; } }

        var prevBtn = $('prev-chapter');
        var nextBtn = $('next-chapter');
        prevBtn.disabled = !previous;
        nextBtn.disabled = !next;
        prevBtn.textContent = previous ? '‹ ' + previous.title : '‹ Previous';
        nextBtn.textContent = next ? next.title + ' ›' : 'Next ›';
        prevBtn.onclick = function () { if (previous) openReader(previous.id, { paraIndex: 0 }); };
        nextBtn.onclick = function () { if (next) openReader(next.id, { paraIndex: 0 }); };

        // Paint first, then jump — otherwise the layout is not settled and the
        // scroll lands in the wrong place.
        requestAnimationFrame(function () {
            $('reader-body').scrollTop = 0;
            if (options.paraIndex) scrollToParagraph(options.paraIndex, options.highlight);
            else if (options.highlight) scrollToParagraph(0, true);
            updateReaderProgress();
            // Opening a chapter is itself a reading position. Without this, a
            // chapter short enough to fit on one screen would never fire a
            // scroll event and would never be remembered.
            recordPosition();
        });
    }

    function scrollToParagraph(index, highlight) {
        var body = $('reader-body');
        var el = $('reader-content').querySelector('.para[data-index="' + index + '"]');
        if (!el) return;
        var offset = el.getBoundingClientRect().top - body.getBoundingClientRect().top;
        body.scrollTop += offset - 16;
        if (highlight) {
            el.classList.add('is-target');
            setTimeout(function () { el.classList.remove('is-target'); }, 2200);
        }
    }

    function firstVisibleParagraph() {
        var body = $('reader-body');
        var containerTop = body.getBoundingClientRect().top;
        var paras = $('reader-content').querySelectorAll('.para');
        for (var i = 0; i < paras.length; i++) {
            if (paras[i].getBoundingClientRect().bottom > containerTop + 8) {
                return parseInt(paras[i].dataset.index, 10);
            }
        }
        return paras.length ? parseInt(paras[paras.length - 1].dataset.index, 10) : 0;
    }

    function updateReaderProgress() {
        var body = $('reader-body');
        var scrollable = body.scrollHeight - body.clientHeight;
        var ratio = scrollable > 0 ? body.scrollTop / scrollable : 1;
        $('reader-progress-bar').style.width = Math.round(ratio * 100) + '%';
        return ratio;
    }

    function recordPosition() {
        if (!current.sectionId) return;
        var body = $('reader-body');
        var scrollable = body.scrollHeight - body.clientHeight;
        Store.savePosition({
            sectionId: current.sectionId,
            paraIndex: firstVisibleParagraph(),
            ratio: scrollable > 0 ? body.scrollTop / scrollable : 0
        });
    }

    function onReaderScroll() {
        if (current.screen !== 'reader' || !current.sectionId) return;
        updateReaderProgress();
        clearTimeout(scrollSaveTimer);
        scrollSaveTimer = setTimeout(recordPosition, 400);
    }

    // Leaving the reader — or the app — must not lose a position that is still
    // sitting in the scroll debounce.
    function flushPosition() {
        if (current.screen !== 'reader' || !current.sectionId) return;
        clearTimeout(scrollSaveTimer);
        recordPosition();
    }

    /* ------------------------------------------------- paragraph actions */

    function openParaSheet(index) {
        var section = Store.getSection(current.sectionId);
        if (!section) return;
        current.paraIndex = index;

        var existing = Store.notesForSection(section.id).map(Store.resolveNote)
            .filter(function (note) { return !note.orphan && note.paraIndex === index; })[0];
        var bookmarked = !!Store.findBookmark(section.id, index);

        $('para-sheet-quote').textContent = section.paragraphs[index];
        $('para-sheet-note-label').textContent = existing ? 'Edit note' : 'Add note';
        $('para-sheet-bookmark-label').textContent = bookmarked ? 'Remove bookmark' : 'Bookmark this passage';
        openSheet('para-sheet');
    }

    function handleParaAction(action) {
        var section = Store.getSection(current.sectionId);
        var index = current.paraIndex;
        var text = section ? section.paragraphs[index] : '';
        closeSheets();

        if (action === 'note') {
            var existing = Store.notesForSection(section.id).map(Store.resolveNote)
                .filter(function (note) { return !note.orphan && note.paraIndex === index; })[0];
            openNoteSheet(section.id, index, existing);
        } else if (action === 'bookmark') {
            Store.toggleBookmark(section.id, index).then(function (result) {
                toast(result.added ? 'Bookmarked' : 'Bookmark removed');
                renderReader(Store.getSection(current.sectionId), { paraIndex: index });
            });
        } else if (action === 'copy') {
            var quoted = text + '\n\n— ' + Store.state.book.title + ', ' + section.title;
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(quoted)
                    .then(function () { toast('Copied'); })
                    .catch(function () { toast('Could not copy'); });
            } else { toast('Copying is not available here'); }
        } else if (action === 'share') {
            if (navigator.share) {
                navigator.share({ text: text, title: section.title }).catch(function () {});
            } else { toast('Sharing is not available here'); }
        }
    }

    // Who a note is being kept for. Two people, named plainly: the labels are
    // what a reader would say out loud, not a schema.
    var TAG_SHORT = { sponsor: 'Sponsor', sponsee: 'Sponsee' };

    function setNoteTag(tag) {
        noteTag = tag || '';
        Array.prototype.forEach.call(document.querySelectorAll('#note-tags .chip'), function (chip) {
            chip.classList.toggle('is-active', chip.dataset.tag === noteTag);
        });
        $('note-tag-hint').textContent = noteTag
            ? 'It will wait on your ' + (noteTag === 'sponsor' ? 'sponsor' : 'sponsee') +
              ' list until you tick it off.'
            : (noteOnPassage
                ? 'Leave both off and it stays a note on this passage.'
                : 'Leave both off and it stays a thought of your own.');
    }

    // sectionId null means a note that belongs to no passage — written straight
    // onto the Notes tab, for the things that do not come out of a page.
    function openNoteSheet(sectionId, paraIndex, existing, options) {
        options = options || {};
        var section = sectionId ? Store.getSection(sectionId) : null;
        var quote = section && section.paragraphs[paraIndex] ? section.paragraphs[paraIndex] : '';

        var stepId = options.stepId || (existing && existing.stepId) || null;
        var step = stepId ? Store.getStep(stepId) : null;
        var questionId = options.questionId || (existing && existing.questionId) || null;
        var questionText = options.questionText || '';

        $('note-sheet-title').textContent = section
            ? 'Note on this passage'
            : questionId
                ? 'Step ' + step.number + ' — ' + (existing ? 'your answer' : 'answering')
                : step
                    ? 'Step ' + step.number + ' — ' + (existing ? 'your note' : 'a new note')
                    : (existing ? 'Your note' : 'Something on your mind');
        // The question stands where the passage would: what is being answered.
        var shown = quote || questionText;
        $('note-sheet-quote').textContent = shown;
        $('note-sheet-quote').hidden = !shown;
        $('note-sheet-body').placeholder = section
            ? 'Write your note…'
            : questionId
                ? 'Your answer today. Answering again later keeps this one — it does not replace it.'
                : step
                ? 'Where you are with this step today. Dated, and kept — a later note sits above this one rather than replacing it.'
                : 'A question for your sponsor, something to raise with your sponsee, or a thought of your own.';
        $('note-sheet-body').value = existing ? existing.body : '';
        $('note-delete').hidden = !existing;
        noteOnPassage = !!section;
        setNoteTag(existing ? existing.tag : options.tag);

        $('note-save').onclick = function () {
            var body = $('note-sheet-body').value.trim();
            if (!body) { toast('Write something first'); return; }
            var record = {
                sectionId: sectionId || null,
                paraIndex: section ? paraIndex : null,
                stepId: stepId,
                questionId: questionId,
                body: body,
                tag: noteTag,
                anchor: section ? Store.anchorFor(section.paragraphs[paraIndex]) : ''
            };
            if (existing) {
                record.id = existing.id;
                record.createdAt = existing.createdAt;
                record.discussedAt = existing.discussedAt || null;
                // Moving a point to somebody else's list makes it something not
                // yet said to that person, whoever it was settled with before.
                if (noteTag && noteTag !== (existing.tag || '')) record.discussedAt = null;
            }
            Store.saveNote(record).then(function () {
                closeSheets();
                toast('Note saved');
                refreshAfterNoteChange(paraIndex);
            });
        };

        $('note-delete').onclick = function () {
            Store.deleteNote(existing.id).then(function () {
                closeSheets();
                toast('Note deleted');
                refreshAfterNoteChange(paraIndex);
            });
        };

        openSheet('note-sheet');
        setTimeout(function () { $('note-sheet-body').focus(); }, 120);
    }

    // Whichever screen is showing when a note changes is the one to redraw.
    function refreshAfterNoteChange(paraIndex) {
        if (current.screen === 'reader') {
            renderReader(Store.getSection(current.sectionId), { paraIndex: paraIndex });
        } else if (current.screen === 'step') {
            var step = Store.getStep(current.stepId);
            if (step) renderStep(step);
        } else {
            renderNotes();
        }
    }

    /* --------------------------------------------------------------- steps */

    function renderSteps() {
        var data = Store.state.steps || {};
        $('steps-edition').textContent = data.edition || '';

        var list = $('steplist');
        list.innerHTML = '';

        Store.allSteps().forEach(function (step) {
            var written = Store.stepIsWritten(step);
            var entries = Store.notesForStep(step.id).length;
            var item = document.createElement('button');
            item.className = 'step-item' + (written || entries ? '' : ' is-stub');
            item.innerHTML =
                '<span class="step-num">' + step.number + '</span>' +
                '<span class="step-body">' +
                  '<span class="step-name">' + escapeHtml(step.shortTitle) + '</span>' +
                  '<span class="step-line">' + escapeHtml(firstWords(Store.stepText(step), 12)) + '</span>' +
                '</span>' +
                (entries ? '<span class="step-count" title="entries in your journal">' +
                    entries + '</span>' : '') +
                (written ? '<span class="step-go">›</span>' : '<span class="step-soon">soon</span>');
            item.addEventListener('click', function () { openStep(step.id); });
            list.appendChild(item);
        });

        $('steps-note').textContent = data.wordingNote || '';
    }

    function openStep(stepId) {
        var step = Store.getStep(stepId);
        if (!step) return;
        current.stepId = stepId;
        renderStep(step);
        showScreen('step');
        $('step-body').scrollTop = 0;
    }

    function renderStep(step) {
        var written = Store.stepIsWritten(step);
        $('step-title').textContent = 'Step ' + step.number;
        $('step-sub').textContent = step.shortTitle;
        $('step-quote').textContent = Store.stepText(step);

        renderStepJournal(step);

        $('step-stub').hidden = written;
        $('step-written').hidden = !written;
        if (!written) return;

        $('step-explanation').innerHTML = step.explanation.map(function (para) {
            return '<p>' + escapeHtml(para) + '</p>';
        }).join('');

        var refs = $('step-references');
        refs.innerHTML = '';
        step.references.forEach(function (ref) {
            var index = Store.resolveStepRef(ref);
            var section = Store.getSection(ref.sectionId);
            var row = document.createElement('button');

            if (index === null || !section) {
                // The passage is not in the copy of the text now loaded. Say so
                // rather than opening the wrong paragraph.
                row.className = 'ref-item is-missing';
                row.disabled = true;
                row.innerHTML =
                    '<span class="ref-label">' + escapeHtml(ref.label) + '</span>' +
                    '<span class="ref-why">Not found in the text now loaded.</span>';
            } else {
                row.className = 'ref-item';
                row.innerHTML =
                    '<span class="ref-label">' + escapeHtml(ref.label) + '</span>' +
                    '<span class="ref-where">' + escapeHtml(section.title) + '</span>' +
                    (ref.why ? '<span class="ref-why">' + escapeHtml(ref.why) + '</span>' : '') +
                    '<span class="ref-quote">' +
                        escapeHtml(firstWords(section.paragraphs[index], 20)) + '</span>';
                row.addEventListener('click', function () {
                    UI.openReader(ref.sectionId, { paraIndex: index, highlight: true });
                });
            }
            refs.appendChild(row);
        });

        renderStepQuestions(step);
        renderStepWork(step);
    }

    /* ---------------------------------------------------- the step's work */

    // Which view each table is showing, by table id. Filling and reading back
    // are different jobs: the first wants one entry at a time, the second wants
    // them side by side.
    var invView = {};

    function renderStepWork(step) {
        var work = Store.workFor(step);
        var holder = $('step-work');
        var body = $('step-work-body');

        // Only step four's tables are built. The other kinds are declared in the
        // data and still have no renderer, so their steps show no work section
        // rather than an empty one.
        if (!work || work.kind !== 'inventory-tables') {
            holder.hidden = true;
            body.innerHTML = '';
            return;
        }

        holder.hidden = false;
        $('step-work-intro').textContent = work.intro || '';
        body.innerHTML = '';

        (work.tables || []).forEach(function (table) {
            body.appendChild(renderInvTable(step, table));
        });
    }

    function renderInvTable(step, table) {
        var rows = Store.inventoryFor(step.id, table.id);
        var view = invView[table.id] || 'fill';

        var box = document.createElement('section');
        box.className = 'inv-table';

        var head = document.createElement('div');
        head.className = 'inv-head';
        head.innerHTML =
            '<h3 class="inv-title">' + escapeHtml(table.title) +
                '<span class="inv-count">' + rows.length + '</span></h3>' +
            '<p class="inv-prompt">' + escapeHtml(table.prompt || '') + '</p>';
        box.appendChild(head);

        // Nothing to review until something has been written.
        if (rows.length) {
            var toggle = document.createElement('div');
            toggle.className = 'inv-views';
            [['fill', 'Fill in'], ['review', 'Read back']].forEach(function (pair) {
                var b = document.createElement('button');
                b.className = 'inv-view' + (view === pair[0] ? ' is-on' : '');
                b.textContent = pair[1];
                b.addEventListener('click', function () {
                    invView[table.id] = pair[0];
                    renderStepWork(step);
                });
                toggle.appendChild(b);
            });
            box.appendChild(toggle);
        }

        box.appendChild(view === 'review' && rows.length
            ? invReview(step, table, rows)
            : invCards(step, table, rows));

        var actions = document.createElement('div');
        actions.className = 'btn-row';
        var add = document.createElement('button');
        add.className = 'btn btn-quiet btn-small';
        add.textContent = rows.length ? 'Add another' : 'Add the first';
        add.addEventListener('click', function () { openInvSheet(step, table, null); });
        actions.appendChild(add);

        if (rows.length) {
            var copy = document.createElement('button');
            copy.className = 'btn btn-quiet btn-small';
            copy.textContent = 'Copy this table';
            copy.addEventListener('click', function () {
                var text = Store.inventoryAsText(step, table.id);
                if (navigator.clipboard && navigator.clipboard.writeText) {
                    navigator.clipboard.writeText(text)
                        .then(function () { toast(table.title + ' copied'); })
                        .catch(function () { toast('Could not copy'); });
                } else { toast('Copying is not available here'); }
            });
            actions.appendChild(copy);
        }
        box.appendChild(actions);
        return box;
    }

    // One entry at a time, its fields stacked. This is the view you dictate into.
    function invCards(step, table, rows) {
        var list = document.createElement('div');
        list.className = 'inv-cards';

        if (!rows.length) {
            var empty = document.createElement('p');
            empty.className = 'empty';
            empty.textContent = 'Nothing here yet.';
            list.appendChild(empty);
            return list;
        }

        rows.forEach(function (row, index) {
            var card = document.createElement('button');
            card.className = 'inv-card';
            var parts = ['<span class="inv-n">' + (index + 1) + '</span>'];
            table.columns.forEach(function (col) {
                var value = (row.values && row.values[col.id]) || '';
                parts.push(
                    '<span class="inv-field' + (value ? '' : ' is-blank') + '">' +
                        '<span class="inv-label">' + escapeHtml(col.label) + '</span>' +
                        '<span class="inv-value">' +
                            (value ? escapeHtml(value) : 'Left blank') + '</span>' +
                    '</span>');
            });
            card.innerHTML = parts.join('');
            card.addEventListener('click', function () { openInvSheet(step, table, row); });
            list.appendChild(card);
        });
        return list;
    }

    // The same rows side by side, the way the book prints its example. Scrolls
    // sideways inside its own box so the page itself never does.
    function invReview(step, table, rows) {
        var wrap = document.createElement('div');
        wrap.className = 'inv-gridwrap';

        var grid = document.createElement('table');
        grid.className = 'inv-grid';

        var thead = document.createElement('thead');
        var hrow = document.createElement('tr');
        table.columns.forEach(function (col) {
            var th = document.createElement('th');
            th.textContent = col.label;
            hrow.appendChild(th);
        });
        thead.appendChild(hrow);
        grid.appendChild(thead);

        var tbody = document.createElement('tbody');
        rows.forEach(function (row) {
            var tr = document.createElement('tr');
            table.columns.forEach(function (col) {
                var td = document.createElement('td');
                td.textContent = (row.values && row.values[col.id]) || '—';
                tr.appendChild(td);
            });
            tr.addEventListener('click', function () { openInvSheet(step, table, row); });
            tbody.appendChild(tr);
        });
        grid.appendChild(tbody);
        wrap.appendChild(grid);

        // Say so only when a column is genuinely off-screen. Measured after
        // layout for the same reason the notes fold is measured: the number of
        // columns does not tell you whether they fit this phone.
        var hint = document.createElement('p');
        hint.className = 'hint inv-scrollhint';
        hint.textContent = 'Scroll sideways for the rest of the columns.';
        hint.hidden = true;
        requestAnimationFrame(function () {
            hint.hidden = wrap.scrollWidth - wrap.clientWidth <= 2;
        });

        var holder = document.createElement('div');
        holder.appendChild(wrap);
        holder.appendChild(hint);
        return holder;
    }

    function openInvSheet(step, table, existing) {
        $('inv-sheet-title').textContent =
            (existing ? 'Edit' : 'New') + ' — ' + table.title;
        $('inv-sheet-prompt').textContent = table.prompt || '';

        var fields = $('inv-sheet-fields');
        fields.innerHTML = '';
        var inputs = {};

        table.columns.forEach(function (col) {
            var wrap = document.createElement('label');
            wrap.className = 'inv-input';
            var label = document.createElement('span');
            label.className = 'sheet-label';
            label.textContent = col.label;
            wrap.appendChild(label);

            if (col.hint) {
                var hint = document.createElement('span');
                hint.className = 'hint';
                hint.textContent = col.hint;
                wrap.appendChild(hint);
            }

            var input = document.createElement('textarea');
            input.className = 'note-input';
            input.rows = 2;
            input.value = (existing && existing.values && existing.values[col.id]) || '';
            wrap.appendChild(input);
            inputs[col.id] = input;
            fields.appendChild(wrap);
        });

        var del = $('inv-delete');
        del.hidden = !existing;
        del.onclick = function () {
            if (!existing) return;
            Store.deleteInventoryRow(existing.id).then(function () {
                closeSheets();
                renderStepWork(step);
                toast('Entry deleted');
            });
        };

        $('inv-save').onclick = function () {
            var values = {};
            Object.keys(inputs).forEach(function (key) { values[key] = inputs[key].value; });

            if (Store.rowIsEmpty(values)) {
                // Nothing was typed. Saving would leave a blank card in a list
                // whose whole point is evidence.
                if (existing) { closeSheets(); return; }
                toast('Nothing to save yet');
                return;
            }

            Store.saveInventoryRow({
                id: existing ? existing.id : null,
                createdAt: existing ? existing.createdAt : null,
                stepId: step.id,
                tableId: table.id,
                values: values
            }).then(function () {
                closeSheets();
                renderStepWork(step);
                toast(existing ? 'Entry updated' : 'Entry added');
            });
        };

        $('inv-cancel').onclick = closeSheets;
        openSheet('inv-sheet');
        setTimeout(function () {
            var first = fields.querySelector('textarea');
            if (first) first.focus();
        }, 120);
    }

    function answerBlock(answer, isOlder) {
        var box = document.createElement('div');
        box.className = 'answer' + (isOlder ? ' is-older' : '');
        box.innerHTML =
            '<span class="answer-when">' + escapeHtml(formatDate(answer.createdAt)) +
                (isOlder ? ' · earlier' : '') + '</span>' +
            '<p class="answer-body">' + escapeHtml(answer.body) + '</p>';
        return box;
    }

    // Same measured fold as the step notes: only what genuinely overflows gets
    // a control.
    function clampAnswer(box) {
        var body = box.querySelector('.answer-body');
        box.classList.add('is-clamped');
        if (body.scrollHeight - body.clientHeight <= 2) {
            box.classList.remove('is-clamped');
            return;
        }
        var toggle = document.createElement('span');
        toggle.className = 'answer-toggle';
        toggle.textContent = 'Show all';
        box.appendChild(toggle);
        box.addEventListener('click', function () {
            var folded = box.classList.toggle('is-clamped');
            toggle.textContent = folded ? 'Show all' : 'Show less';
        });
    }

    function renderStepQuestions(step) {
        var holder = $('step-questions');
        holder.innerHTML = '';

        Store.questionsFor(step).forEach(function (q, index) {
            var answers = Store.answersFor(step.id, q.id);
            var block = document.createElement('div');
            block.className = 'question';

            var head = document.createElement('div');
            head.className = 'question-head';
            head.innerHTML =
                '<span class="question-n">' + (index + 1) + '</span>' +
                '<span class="question-text">' + escapeHtml(q.text) +
                (q.own ? '<span class="question-own">yours</span>' : '') + '</span>';
            block.appendChild(head);

            var pending = [];
            if (answers.length) {
                var latest = answerBlock(answers[0], false);
                block.appendChild(latest);
                pending.push(latest);
            }

            var older = answers.slice(1);
            var olderHolder = document.createElement('div');
            olderHolder.hidden = true;
            older.forEach(function (a) {
                var box = answerBlock(a, true);
                olderHolder.appendChild(box);
                pending.push(box);
            });
            block.appendChild(olderHolder);

            var actions = document.createElement('div');
            actions.className = 'question-actions';

            var answer = document.createElement('button');
            answer.className = 'chip';
            answer.textContent = answers.length ? 'Answer again' : 'Answer';
            answer.addEventListener('click', function () {
                openNoteSheet(null, null, null,
                    { stepId: step.id, questionId: q.id, questionText: q.text });
            });
            actions.appendChild(answer);

            if (answers.length) {
                var edit = document.createElement('button');
                edit.className = 'chip';
                edit.textContent = 'Edit latest';
                edit.addEventListener('click', function () {
                    openNoteSheet(null, null, answers[0],
                        { stepId: step.id, questionId: q.id, questionText: q.text });
                });
                actions.appendChild(edit);
            }

            if (older.length) {
                var history = document.createElement('button');
                history.className = 'chip';
                history.textContent = older.length + ' earlier';
                history.addEventListener('click', function () {
                    olderHolder.hidden = !olderHolder.hidden;
                    history.classList.toggle('is-active', !olderHolder.hidden);
                    history.textContent = olderHolder.hidden
                        ? older.length + ' earlier' : 'Hide earlier';
                });
                actions.appendChild(history);
            }

            var put = document.createElement('button');
            put.className = 'chip';
            put.textContent = q.own ? 'Delete' : 'Put away';
            put.addEventListener('click', function () {
                if (q.own) {
                    if (!confirm('Delete this question? Answers written against it are kept.')) return;
                    Store.deleteQuestion(step.id, q.id).then(function () {
                        toast('Question deleted');
                        renderStep(Store.getStep(step.id));
                    });
                } else {
                    Store.setQuestionHidden(q.id, true).then(function () {
                        toast('Put away — answers kept');
                        renderStep(Store.getStep(step.id));
                    });
                }
            });
            actions.appendChild(put);

            block.appendChild(actions);
            holder.appendChild(block);
            pending.forEach(clampAnswer);
        });

        renderHiddenQuestions(step);

        $('step-add-question').onclick = function () {
            openPaste({
                title: 'A question of your own',
                hint: 'However your sponsor puts it, or whatever you want to come back to on this step.',
                placeholder: 'What am I still not willing to look at?',
                onConfirm: function (value) {
                    if (!value.trim()) return;
                    Store.addQuestion(step.id, value).then(function () {
                        toast('Question added');
                        renderStep(Store.getStep(step.id));
                    });
                }
            });
        };
    }

    function renderHiddenQuestions(step) {
        var hidden = Store.hiddenQuestionsFor(step);
        var button = $('step-show-hidden');
        var list = $('step-hidden-questions');

        button.hidden = !hidden.length;
        if (!hidden.length) { list.hidden = true; list.innerHTML = ''; return; }

        button.textContent = list.hidden
            ? hidden.length + ' put away' : 'Hide those';
        button.onclick = function () {
            list.hidden = !list.hidden;
            button.textContent = list.hidden ? hidden.length + ' put away' : 'Hide those';
        };

        list.innerHTML = '';
        hidden.forEach(function (q) {
            var row = document.createElement('div');
            row.className = 'hidden-q';
            row.innerHTML = '<span>' + escapeHtml(q.text) + '</span>';
            var back = document.createElement('button');
            back.className = 'chip';
            back.textContent = 'Bring back';
            back.addEventListener('click', function () {
                Store.setQuestionHidden(q.id, false).then(function () {
                    toast('Back on the list');
                    renderStep(Store.getStep(step.id));
                });
            });
            row.appendChild(back);
            list.appendChild(row);
        });
    }

    function renderStepJournal(step) {
        var entries = Store.notesForStep(step.id).slice().sort(function (a, b) {
            return (b.createdAt || '').localeCompare(a.createdAt || '');
        });

        $('journal-hint').textContent = entries.length
            ? entries.length + (entries.length === 1 ? ' note' : ' notes') +
              ', newest first. Nothing here is overwritten.'
            : 'Nothing yet. Add a note each time you read or work this step — a later one sits above the last, not on top of it.';

        var list = $('step-entries');
        list.innerHTML = '';

        entries.forEach(function (entry) {
            var card = document.createElement('div');
            card.className = 'card note-card entry-card' + (entry.discussedAt ? ' is-done' : '');

            var main = document.createElement('button');
            main.className = 'card-main';
            main.innerHTML =
                '<div class="card-head">' +
                    '<span class="entry-when">' + escapeHtml(formatDate(entry.createdAt)) + '</span>' +
                    (entry.tag ? '<span class="tag-pill' + (entry.discussedAt ? ' is-done' : '') +
                        '">' + escapeHtml(TAG_SHORT[entry.tag]) + '</span>' : '') +
                '</div>' +
                '<p class="card-body">' + escapeHtml(entry.body) + '</p>' +
                (entry.updatedAt && entry.updatedAt.slice(0, 10) !== (entry.createdAt || '').slice(0, 10)
                    ? '<p class="card-date">Edited ' + formatDate(entry.updatedAt) + '</p>' : '') +
                (entry.discussedAt ? '<p class="card-done">Talked about ' +
                    formatDate(entry.discussedAt) + '</p>' : '');
            card.appendChild(main);

            var actions = document.createElement('div');
            actions.className = 'card-actions';

            if (entry.tag) {
                var done = document.createElement('button');
                done.className = 'chip' + (entry.discussedAt ? ' is-active' : '');
                done.textContent = entry.discussedAt ? 'Talked about ✓' : 'Mark as talked about';
                done.addEventListener('click', function () {
                    var settled = !entry.discussedAt;
                    Store.setNoteDiscussed(entry.id, settled).then(function () {
                        toast(settled ? 'Ticked off' : 'Back on the list');
                        renderStep(Store.getStep(step.id));
                    });
                });
                actions.appendChild(done);
            }

            var edit = document.createElement('button');
            edit.className = 'chip';
            edit.textContent = 'Edit';
            edit.addEventListener('click', function () {
                openNoteSheet(null, null, entry, { stepId: step.id });
            });
            actions.appendChild(edit);
            card.appendChild(actions);

            list.appendChild(card);
            applyClamp(card, main);
        });

        $('step-add-entry').onclick = function () {
            openNoteSheet(null, null, null, { stepId: step.id });
        };
    }

    /*
     * A dictated note can run to several hundred words, and a column of those
     * buries the rest of the step. Anything long enough to need it is folded to
     * a few lines and opens on a tap; anything short is left alone rather than
     * given a control that does nothing.
     */
    function applyClamp(card, main) {
        var body = main.querySelector('.card-body');
        if (!body) return;

        card.classList.add('is-clamped');
        var overflows = body.scrollHeight - body.clientHeight > 2;
        if (!overflows) { card.classList.remove('is-clamped'); return; }

        var toggle = document.createElement('span');
        toggle.className = 'entry-toggle';
        toggle.textContent = 'Show all';
        main.appendChild(toggle);

        main.addEventListener('click', function () {
            var open = card.classList.toggle('is-clamped');
            toggle.textContent = open ? 'Show all' : 'Show less';
        });
    }

    /* -------------------------------------------------------------- notes */

    var FILTER_LABELS = { all: 'All', sponsor: 'Sponsor', sponsee: 'Sponsee',
                          steps: 'Steps', own: 'Reflections' };

    var EMPTY_COPY = {
        all: 'No notes yet. While reading, tap any paragraph and choose <strong>Add note</strong> — ' +
             'or tap <strong>+</strong> above for something the book did not put there.',
        sponsor: 'Nothing waiting for your sponsor. Tap <strong>+</strong> to put something on the list, ' +
                 'or mark a note for them while you are reading.',
        sponsee: 'Nothing waiting for your sponsee. Tap <strong>+</strong> to put something on the list, ' +
                 'or mark a note for them while you are reading.',
        own: 'Nothing here yet. Tap <strong>+</strong> and write what is on your mind — it does not have to ' +
             'come from a page.',
        steps: 'Nothing written against a step yet. Open the <strong>Steps</strong> tab, choose one, and ' +
               'add a note — they gather here.'
    };

    function noteMatchesFilter(note) {
        if (notesFilter === 'all') return true;
        if (notesFilter === 'steps') return Store.isStepNote(note);
        // A step entry is standalone too, so Reflections has to rule it out or
        // the loose pile fills up with step work.
        if (notesFilter === 'own') return Store.isLooseNote(note);
        return note.tag === notesFilter;
    }

    // The counts are of points still waiting, not of everything ever written:
    // a list of forty settled matters is not forty things to raise.
    function renderNoteFilters() {
        // Each count must be of exactly what its filter shows. isStandalone is
        // true of step entries as well, so counting Reflections with it would
        // put a number on the chip that its own list does not contain.
        var counts = {
            sponsor: Store.waitingFor('sponsor'),
            sponsee: Store.waitingFor('sponsee'),
            steps: Store.state.notes.filter(Store.isStepNote).length,
            own: Store.state.notes.filter(Store.isLooseNote).length
        };
        Array.prototype.forEach.call(document.querySelectorAll('#notes-filters .chip'), function (chip) {
            var key = chip.dataset.filter;
            chip.classList.toggle('is-active', key === notesFilter);
            chip.innerHTML = escapeHtml(FILTER_LABELS[key]) +
                (counts[key] ? ' <span class="chip-count">' + counts[key] + '</span>' : '');
        });
    }

    // Before a meeting or a phone call, the list is more use out of the app than
    // in it. Only what is still waiting goes across.
    function copyTalkList(notes) {
        var heading = 'To talk about with my ' + (notesFilter === 'sponsor' ? 'sponsor' : 'sponsee');
        var lines = [heading, ''];
        notes.forEach(function (note) {
            lines.push('• ' + note.body);
            var section = Store.getSection(note.sectionId);
            var paragraph = section && section.paragraphs[note.paraIndex];
            if (paragraph) {
                lines.push('  ' + section.title + ' — “' + firstWords(paragraph, 14) + '”');
            }
        });

        var text = lines.join('\n');
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text)
                .then(function () { toast('List copied'); })
                .catch(function () { toast('Could not copy'); });
        } else { toast('Copying is not available here'); }
    }

    function renderNotesActions(notes) {
        var holder = $('notes-actions');
        holder.innerHTML = '';
        if (notesFilter !== 'sponsor' && notesFilter !== 'sponsee') return;

        var waiting = notes.filter(function (note) { return !note.discussedAt; });
        if (!waiting.length) return;

        var button = document.createElement('button');
        button.className = 'btn btn-quiet btn-block';
        button.id = 'notes-copy';
        button.textContent = 'Copy this list';
        button.addEventListener('click', function () { copyTalkList(waiting); });
        holder.appendChild(button);
    }

    function noteCard(note) {
        var section = Store.getSection(note.sectionId);
        var standalone = Store.isStandalone(note);
        var step = Store.isStepNote(note) ? Store.getStep(note.stepId) : null;
        // An answer quotes the question it answers, where a passage note quotes
        // its passage — both say what the note is a response to.
        var quote = section && section.paragraphs[note.paraIndex]
            ? firstWords(section.paragraphs[note.paraIndex], 26)
            : Store.isAnswer(note)
                ? firstWords(Store.questionText(note.stepId, note.questionId), 26)
                : '';
        var where = step ? 'Step ' + step.number + ' · ' + step.shortTitle
                         : standalone ? '' : (section ? section.title : 'Unknown section');
        var head = where || note.tag;   // nothing to head a plain thought with

        var card = document.createElement('div');
        card.className = 'card note-card' + (note.discussedAt ? ' is-done' : '');

        var main = document.createElement('button');
        main.className = 'card-main';
        main.innerHTML =
            (head ? '<div class="card-head">' +
                '<span class="card-where">' + escapeHtml(where) + '</span>' +
                (note.tag ? '<span class="tag-pill' + (note.discussedAt ? ' is-done' : '') + '">' +
                    escapeHtml(TAG_SHORT[note.tag]) + '</span>' : '') +
            '</div>' : '') +
            (quote ? '<p class="card-quote">' + escapeHtml(quote) + '</p>' : '') +
            '<p class="card-body">' + escapeHtml(note.body) + '</p>' +
            '<p class="card-date">' + formatDate(note.updatedAt) + '</p>' +
            (note.discussedAt ? '<p class="card-done">Talked about ' + formatDate(note.discussedAt) + '</p>' : '') +
            (note.orphan ? '<p class="card-warn">The passage this note pointed at is no longer in the text.</p>' : '');
        // A note written against a passage still leads back to it; one that was
        // never on a page has nowhere to go, so it opens for editing instead.
        main.addEventListener('click', function () {
            if (step) { openStep(step.id); return; }
            if (standalone || note.orphan) { openNoteSheet(note.sectionId, note.paraIndex, note); return; }
            openReader(note.sectionId, { paraIndex: note.paraIndex, highlight: true });
        });
        card.appendChild(main);

        var actions = document.createElement('div');
        actions.className = 'card-actions';

        if (note.tag) {
            var done = document.createElement('button');
            done.className = 'chip' + (note.discussedAt ? ' is-active' : '');
            done.textContent = note.discussedAt ? 'Talked about ✓' : 'Mark as talked about';
            done.addEventListener('click', function () {
                var settled = !note.discussedAt;
                Store.setNoteDiscussed(note.id, settled).then(function () {
                    toast(settled ? 'Ticked off' : 'Back on the list');
                    renderNotes();
                });
            });
            actions.appendChild(done);
        }

        var edit = document.createElement('button');
        edit.className = 'chip';
        edit.textContent = 'Edit';
        edit.addEventListener('click', function () {
            openNoteSheet(note.sectionId, note.paraIndex, note, { stepId: note.stepId || null });
        });
        actions.appendChild(edit);

        card.appendChild(actions);
        return card;
    }

    function renderNotes() {
        var query = $('notes-search').value.trim().toLowerCase();
        var list = $('notes-list');
        list.innerHTML = '';

        renderNoteFilters();

        var notes = Store.state.notes.map(Store.resolveNote)
            .filter(noteMatchesFilter)
            .filter(function (note) {
                if (!query) return true;
                var section = Store.getSection(note.sectionId);
                return note.body.toLowerCase().indexOf(query) !== -1 ||
                    (section && section.title.toLowerCase().indexOf(query) !== -1);
            });

        // Whatever has been talked about sinks below whatever has not. Within
        // each half the newest is still first, as the store returns them.
        notes.sort(function (a, b) {
            return (a.discussedAt ? 1 : 0) - (b.discussedAt ? 1 : 0);
        });

        renderNotesActions(notes);

        $('notes-empty').hidden = notes.length > 0;
        if (query && !notes.length) {
            $('notes-empty').textContent = 'No notes match “' + query + '”.';
        } else if (!query) {
            $('notes-empty').innerHTML = EMPTY_COPY[notesFilter];
        }

        notes.forEach(function (note) { list.appendChild(noteCard(note)); });
    }

    /* ------------------------------------------------------------- search */

    function renderSearch() {
        var query = $('search-input').value.trim();
        var results = $('search-results');
        results.innerHTML = '';

        if (!Store.state.book.textIncluded) {
            $('search-status').textContent = 'Import the book text first — see Settings.';
            return;
        }
        if (query.length < 2) {
            $('search-status').textContent = 'Type at least two letters.';
            return;
        }

        var hits = Store.search(query);
        $('search-status').textContent = hits.length
            ? hits.length + (hits.length === 200 ? '+ matches' : ' match' + (hits.length === 1 ? '' : 'es'))
            : 'Nothing found for “' + query + '”.';

        hits.forEach(function (hit) {
            var before = escapeHtml(hit.excerpt.slice(0, hit.matchAt));
            var match = escapeHtml(hit.excerpt.substr(hit.matchAt, hit.matchLength));
            var after = escapeHtml(hit.excerpt.slice(hit.matchAt + hit.matchLength));

            var card = document.createElement('button');
            card.className = 'card';
            card.innerHTML =
                '<div class="card-where">' + escapeHtml(hit.sectionTitle) + '</div>' +
                '<p class="card-quote" style="-webkit-line-clamp:3">' + before + '<mark>' + match + '</mark>' + after + '</p>';
            card.addEventListener('click', function () {
                openReader(hit.sectionId, { paraIndex: hit.paraIndex, highlight: true });
            });
            results.appendChild(card);
        });
    }

    /* ----------------------------------------------------------- settings */

    function renderSettings() {
        var settings = Store.state.settings;
        $('set-theme').value = settings.theme;
        $('set-typeface').value = settings.typeface;
        $('set-fontsize').value = settings.fontSize;
        $('set-fontsize-value').textContent = settings.fontSize + 'px';
        $('set-lineheight').value = Math.round(settings.lineHeight * 100);
        $('set-lineheight-value').textContent = settings.lineHeight.toFixed(2);
        $('set-keepawake').checked = !!settings.keepAwake;
        $('about-version').textContent = 'v' + (global.APP_VERSION || '1.0');

        var book = Store.state.book;
        var counts = book.sections.reduce(function (total, section) {
            return total + section.paragraphs.length;
        }, 0);
        var readable = book.sections.filter(function (s) { return s.paragraphs.length; }).length;
        if (!book.textIncluded) {
            $('book-status').innerHTML =
                'No book text loaded yet. The contents list is shown, but there is nothing to read.';
        } else if (book.isImported) {
            $('book-status').innerHTML =
                'Reading <strong>your own imported copy</strong> — ' + readable + ' sections, ' +
                counts.toLocaleString() + ' paragraphs.' +
                (book.importedAt ? '<br>Imported ' + formatDate(book.importedAt) + '.' : '') +
                '<br>The copy that came with the app is untouched underneath.';
        } else {
            $('book-status').innerHTML =
                'Reading the copy that came with the app: <strong>' +
                escapeHtml(book.edition || 'first edition') + '</strong> — ' + readable +
                ' sections, ' + counts.toLocaleString() + ' paragraphs.';
        }
        // Only offer to remove text the reader actually supplied.
        $('btn-clear-text').hidden = !book.isImported;
        $('backup-include-text').disabled = !book.textIncluded;
        if (!book.textIncluded) $('backup-include-text').checked = false;
    }

    /* -------------------------------------------------------------- sheets */

    function openSheet(id) {
        closeSheets();
        $('sheet-backdrop').hidden = false;
        $(id).hidden = false;
    }

    function closeSheets() {
        ['para-sheet', 'note-sheet', 'type-sheet', 'paste-sheet', 'inv-sheet'].forEach(function (id) {
            $(id).hidden = true;
        });
        $('sheet-backdrop').hidden = true;
    }

    function openPaste(config) {
        $('paste-title').textContent = config.title;
        $('paste-hint').textContent = config.hint || '';
        $('paste-body').value = '';
        $('paste-body').placeholder = config.placeholder || 'Paste here…';
        pasteHandler = config.onConfirm;
        openSheet('paste-sheet');
        setTimeout(function () { $('paste-body').focus(); }, 120);
    }

    /* ------------------------------------------------------- text import */

    function importBookText(rawText, sourceName) {
        var status = $('text-status');
        status.classList.remove('is-error');
        status.textContent = 'Parsing…';

        setTimeout(function () {
            var parsed;
            try {
                parsed = BookParser.parse(rawText);
            } catch (error) {
                status.classList.add('is-error');
                status.textContent = 'Could not parse that text: ' + error.message;
                return;
            }
            if (!parsed.sections.length) {
                status.classList.add('is-error');
                status.textContent = 'No chapters were recognised in that file. Is it a plain-text copy of the book?';
                return;
            }

            Store.saveImportedBook(parsed, { sourceName: sourceName, edition: 'First Edition (1939)' })
                .then(function () {
                    var words = BookParser.wordCount(parsed.sections);
                    var message = 'Imported ' + parsed.sections.length + ' sections (' +
                        words.toLocaleString() + ' words).';
                    if (parsed.warnings.length) message += ' ' + parsed.warnings.join(' ');
                    status.textContent = message;
                    renderSettings();
                    toast('Book text imported');
                })
                .catch(function (error) {
                    status.classList.add('is-error');
                    status.textContent = 'Could not save the text: ' + error.message;
                });
        }, 30);
    }

    /* ---------------------------------------------------------- restoring */

    function runRestore(text) {
        var status = $('restore-status');
        status.classList.remove('is-error');
        var payload;
        try {
            payload = Backup.parseBackup(text);
        } catch (error) {
            status.classList.add('is-error');
            status.textContent = error.message;
            return;
        }
        status.textContent = 'Restoring…';
        Backup.restoreBackup(payload, $('restore-mode').value)
            .then(function (summary) {
                applySettings();
                status.textContent = 'Restored ' + summary.notes + ' note' + (summary.notes === 1 ? '' : 's') +
                    ' and ' + summary.bookmarks + ' bookmark' + (summary.bookmarks === 1 ? '' : 's') +
                    (summary.bookText ? ', including the book text' : '') + '.';
                renderSettings();
                toast('Backup restored');
            })
            .catch(function (error) {
                status.classList.add('is-error');
                status.textContent = 'Restore failed: ' + error.message;
            });
    }

    /* ---------------------------------------------------------------- wire */

    function bind() {
        Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (tab) {
            tab.addEventListener('click', function () { showScreen(tab.dataset.screen); });
        });
        Array.prototype.forEach.call(document.querySelectorAll('[data-goto="settings-import"]'), function (btn) {
            btn.addEventListener('click', function () {
                showScreen('settings');
                setTimeout(function () {
                    $('settings-import').scrollIntoView({ behavior: 'smooth', block: 'start' });
                }, 80);
            });
        });

        $('reader-back').addEventListener('click', function () {
            var from = current.readerFrom;
            if (from === 'step' && current.readerFromStep) { openStep(current.readerFromStep); return; }
            showScreen(from && from !== 'reader' ? from : 'home');
        });
        $('step-back').addEventListener('click', function () { showScreen('steps'); });
        $('reader-type').addEventListener('click', function () {
            var settings = Store.state.settings;
            $('type-fontsize').value = settings.fontSize;
            $('type-lineheight').value = Math.round(settings.lineHeight * 100);
            Array.prototype.forEach.call(document.querySelectorAll('[data-theme-pick]'), function (btn) {
                btn.classList.toggle('is-active', btn.dataset.themePick === settings.theme);
            });
            openSheet('type-sheet');
        });
        $('reader-body').addEventListener('scroll', onReaderScroll, { passive: true });

        // A tap on a paragraph opens its actions — unless the reader is in the
        // middle of selecting text, where a sheet would be an interruption.
        $('reader-content').addEventListener('click', function (event) {
            var para = event.target.closest ? event.target.closest('.para') : null;
            if (!para) return;
            var selection = global.getSelection && global.getSelection().toString();
            if (selection && selection.length > 1) return;
            openParaSheet(parseInt(para.dataset.index, 10));
        });

        Array.prototype.forEach.call(document.querySelectorAll('#para-sheet .sheet-action'), function (btn) {
            btn.addEventListener('click', function () {
                if (btn.dataset.action === 'cancel') { closeSheets(); return; }
                handleParaAction(btn.dataset.action);
            });
        });

        $('note-cancel').addEventListener('click', closeSheets);
        $('sheet-backdrop').addEventListener('click', closeSheets);
        $('type-close').addEventListener('click', closeSheets);
        $('paste-cancel').addEventListener('click', closeSheets);
        $('paste-confirm').addEventListener('click', function () {
            var value = $('paste-body').value;
            var handler = pasteHandler;
            closeSheets();
            if (handler) handler(value);
        });

        // Text options inside the reader
        $('type-fontsize').addEventListener('input', function () {
            Store.saveSettings({ fontSize: parseInt(this.value, 10) }).then(applySettings);
        });
        $('type-lineheight').addEventListener('input', function () {
            Store.saveSettings({ lineHeight: parseInt(this.value, 10) / 100 }).then(applySettings);
        });
        Array.prototype.forEach.call(document.querySelectorAll('[data-theme-pick]'), function (btn) {
            btn.addEventListener('click', function () {
                Store.saveSettings({ theme: btn.dataset.themePick }).then(function () {
                    applySettings();
                    Array.prototype.forEach.call(document.querySelectorAll('[data-theme-pick]'), function (other) {
                        other.classList.toggle('is-active', other === btn);
                    });
                });
            });
        });

        // Settings — reading
        $('set-theme').addEventListener('change', function () {
            Store.saveSettings({ theme: this.value }).then(applySettings);
        });
        $('set-typeface').addEventListener('change', function () {
            Store.saveSettings({ typeface: this.value }).then(applySettings);
        });
        $('set-fontsize').addEventListener('input', function () {
            $('set-fontsize-value').textContent = this.value + 'px';
            Store.saveSettings({ fontSize: parseInt(this.value, 10) }).then(applySettings);
        });
        $('set-lineheight').addEventListener('input', function () {
            var value = parseInt(this.value, 10) / 100;
            $('set-lineheight-value').textContent = value.toFixed(2);
            Store.saveSettings({ lineHeight: value }).then(applySettings);
        });
        $('set-keepawake').addEventListener('change', function () {
            Store.saveSettings({ keepAwake: this.checked }).then(function () {
                if (!Store.state.settings.keepAwake) releaseWakeLock();
            });
        });

        // Settings — backup
        $('btn-export').addEventListener('click', function () {
            var status = $('backup-status');
            status.classList.remove('is-error');
            status.textContent = 'Preparing…';
            Backup.exportBackup({ includeBookText: $('backup-include-text').checked })
                .then(function (result) {
                    if (result.method === 'cancelled') { status.textContent = 'Cancelled.'; return; }
                    var kb = Math.max(1, Math.round(result.size / 1024));
                    status.textContent = result.method === 'share'
                        ? 'Backup shared (' + kb + ' KB). Save it to Files or iCloud Drive.'
                        : 'Saved ' + result.name + ' (' + kb + ' KB) to your downloads.';
                })
                .catch(function (error) {
                    status.classList.add('is-error');
                    status.textContent = 'Backup failed: ' + error.message;
                });
        });
        $('btn-copy-backup').addEventListener('click', function () {
            var status = $('backup-status');
            status.classList.remove('is-error');
            Backup.copyBackupToClipboard({ includeBookText: $('backup-include-text').checked })
                .then(function () { status.textContent = 'Backup copied to the clipboard. Paste it somewhere safe.'; })
                .catch(function (error) {
                    status.classList.add('is-error');
                    status.textContent = error.message;
                });
        });

        // Settings — restore
        $('btn-import-file').addEventListener('click', function () { $('import-file').click(); });
        $('import-file').addEventListener('change', function () {
            var file = this.files && this.files[0];
            this.value = '';
            if (!file) return;
            Backup.readFile(file).then(runRestore).catch(function (error) {
                $('restore-status').classList.add('is-error');
                $('restore-status').textContent = error.message;
            });
        });
        $('btn-import-paste').addEventListener('click', function () {
            openPaste({
                title: 'Paste backup text',
                hint: 'Paste the contents of a backup JSON file.',
                placeholder: '{ "app": "AMS Big 12S", … }',
                onConfirm: function (value) { if (value.trim()) runRestore(value); }
            });
        });

        // Settings — book text
        $('btn-text-file').addEventListener('click', function () { $('text-file').click(); });
        $('text-file').addEventListener('change', function () {
            var file = this.files && this.files[0];
            this.value = '';
            if (!file) return;
            Backup.readFile(file).then(function (text) {
                importBookText(text, file.name);
            }).catch(function (error) {
                $('text-status').classList.add('is-error');
                $('text-status').textContent = error.message;
            });
        });
        $('btn-text-paste').addEventListener('click', function () {
            openPaste({
                title: 'Paste book text',
                hint: 'Paste the whole plain-text book. Chapter headings on their own line are used to split it up.',
                placeholder: 'THE DOCTOR\'S OPINION\n\nWe of Alcoholics Anonymous…',
                onConfirm: function (value) { if (value.trim()) importBookText(value, 'pasted text'); }
            });
        });
        $('btn-clear-text').addEventListener('click', function () {
            if (!confirm('Go back to the copy that came with the app? Your notes and bookmarks are kept.')) return;
            Store.clearImportedBook().then(function () {
                renderSettings();
                renderHome();
                toast('Book text removed');
            });
        });

        // Notes tab — writing one from scratch, and the filters over the list
        $('notes-add-btn').addEventListener('click', function () {
            // Standing in front of the sponsor list, a new point is almost
            // always for the sponsor, so the chip comes up already lit.
            var preset = (notesFilter === 'sponsor' || notesFilter === 'sponsee') ? notesFilter : '';
            openNoteSheet(null, null, null, { tag: preset });
        });
        Array.prototype.forEach.call(document.querySelectorAll('#notes-filters .chip'), function (chip) {
            chip.addEventListener('click', function () {
                notesFilter = chip.dataset.filter;
                renderNotes();
            });
        });
        Array.prototype.forEach.call(document.querySelectorAll('#note-tags .chip'), function (chip) {
            // Tapping the lit chip clears it — a point can stop being someone
            // else's business without being deleted.
            chip.addEventListener('click', function () {
                setNoteTag(noteTag === chip.dataset.tag ? '' : chip.dataset.tag);
            });
        });

        // Notes & search inputs
        $('notes-search').addEventListener('input', renderNotes);
        $('search-input').addEventListener('input', function () {
            clearTimeout(searchTimer);
            searchTimer = setTimeout(renderSearch, 180);
        });

        // Android hardware back / browser back closes sheets and the reader.
        global.addEventListener('popstate', function () {
            if (!$('sheet-backdrop').hidden) { closeSheets(); return; }
            if (current.screen === 'reader') showScreen('home');
        });

        if (global.matchMedia) {
            global.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function () {
                if (Store.state.settings.theme === 'auto') applySettings();
            });
        }

        document.addEventListener('visibilitychange', function () {
            if (document.visibilityState === 'visible') {
                if (current.screen === 'reader') requestWakeLock();
            } else {
                flushPosition();
            }
        });
        // iOS often kills a backgrounded PWA without a visibilitychange, so save
        // on pagehide too.
        global.addEventListener('pagehide', flushPosition);
    }

    global.UI = {
        bind: bind,
        showScreen: showScreen,
        applySettings: applySettings,
        openReader: openReader,
        renderHome: renderHome,
        renderSteps: renderSteps,
        openStep: openStep,
        renderNotes: renderNotes,
        renderSettings: renderSettings,
        toast: toast
    };
})(window);
