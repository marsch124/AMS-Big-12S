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
        ['home', 'reader', 'notes', 'search', 'settings'].forEach(function (screen) {
            $('screen-' + screen).classList.toggle('is-active', screen === name);
        });
        Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (tab) {
            tab.classList.toggle('is-active', tab.dataset.screen === name);
        });
        // The reader gets the whole screen; the tab bar would only steal room.
        $('tabbar').hidden = name === 'reader';
        current.screen = name;

        if (name === 'reader') requestWakeLock(); else releaseWakeLock();
        if (name === 'home') renderHome();
        if (name === 'notes') renderNotes();
        if (name === 'settings') renderSettings();
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
                html += '<span class="para-flag">✎ ' + escapeHtml(firstWords(notes[index].body, 12)) + '</span>';
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
        $('para-sheet-bookmark-label').textContent = bookmarked ? '🔖 Remove bookmark' : '🔖 Bookmark this passage';
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

    function openNoteSheet(sectionId, paraIndex, existing) {
        var section = Store.getSection(sectionId);
        $('note-sheet-quote').textContent = section ? section.paragraphs[paraIndex] : '';
        $('note-sheet-body').value = existing ? existing.body : '';
        $('note-delete').hidden = !existing;

        $('note-save').onclick = function () {
            var body = $('note-sheet-body').value.trim();
            if (!body) { toast('Write something first'); return; }
            var record = {
                sectionId: sectionId,
                paraIndex: paraIndex,
                body: body,
                anchor: Store.anchorFor(section.paragraphs[paraIndex])
            };
            if (existing) { record.id = existing.id; record.createdAt = existing.createdAt; }
            Store.saveNote(record).then(function () {
                closeSheets();
                toast('Note saved');
                if (current.screen === 'reader') {
                    renderReader(Store.getSection(current.sectionId), { paraIndex: paraIndex });
                } else { renderNotes(); }
            });
        };

        $('note-delete').onclick = function () {
            Store.deleteNote(existing.id).then(function () {
                closeSheets();
                toast('Note deleted');
                if (current.screen === 'reader') {
                    renderReader(Store.getSection(current.sectionId), { paraIndex: paraIndex });
                } else { renderNotes(); }
            });
        };

        openSheet('note-sheet');
        setTimeout(function () { $('note-sheet-body').focus(); }, 120);
    }

    /* -------------------------------------------------------------- notes */

    function renderNotes() {
        var query = $('notes-search').value.trim().toLowerCase();
        var list = $('notes-list');
        list.innerHTML = '';

        var notes = Store.state.notes.map(Store.resolveNote).filter(function (note) {
            if (!query) return true;
            var section = Store.getSection(note.sectionId);
            return note.body.toLowerCase().indexOf(query) !== -1 ||
                (section && section.title.toLowerCase().indexOf(query) !== -1);
        });

        $('notes-empty').hidden = notes.length > 0;
        if (query && !notes.length) {
            $('notes-empty').hidden = false;
            $('notes-empty').textContent = 'No notes match “' + query + '”.';
        } else if (!query) {
            $('notes-empty').innerHTML = 'No notes yet. While reading, tap any paragraph and choose <strong>Add note</strong>.';
        }

        notes.forEach(function (note) {
            var section = Store.getSection(note.sectionId);
            var quote = section && section.paragraphs[note.paraIndex]
                ? firstWords(section.paragraphs[note.paraIndex], 26) : '';

            var card = document.createElement('button');
            card.className = 'card';
            card.innerHTML =
                '<div class="card-where">' + escapeHtml(section ? section.title : 'Unknown section') + '</div>' +
                (quote ? '<p class="card-quote">' + escapeHtml(quote) + '</p>' : '') +
                '<p class="card-body">' + escapeHtml(note.body) + '</p>' +
                '<p class="card-date">' + formatDate(note.updatedAt) + '</p>' +
                (note.orphan ? '<p class="card-warn">The passage this note pointed at is no longer in the text.</p>' : '');
            card.addEventListener('click', function () {
                if (note.orphan) { openNoteSheet(note.sectionId, note.paraIndex, note); return; }
                openReader(note.sectionId, { paraIndex: note.paraIndex, highlight: true });
            });
            list.appendChild(card);
        });
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
        $('book-status').innerHTML = book.textIncluded
            ? 'Loaded: <strong>' + escapeHtml(book.edition || 'imported text') + '</strong> — ' +
              book.sections.filter(function (s) { return s.paragraphs.length; }).length +
              ' sections, ' + counts.toLocaleString() + ' paragraphs.' +
              (book.importedAt ? '<br>Imported ' + formatDate(book.importedAt) + '.' : '')
            : 'No book text loaded yet. The contents list is shown, but there is nothing to read.';
        $('btn-clear-text').hidden = !book.textIncluded;
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
        ['para-sheet', 'note-sheet', 'type-sheet', 'paste-sheet'].forEach(function (id) {
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

        $('reader-back').addEventListener('click', function () { showScreen('home'); });
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
            if (!confirm('Remove the imported book text? Your notes and bookmarks are kept.')) return;
            Store.clearImportedBook().then(function () {
                renderSettings();
                renderHome();
                toast('Book text removed');
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
        renderNotes: renderNotes,
        renderSettings: renderSettings,
        toast: toast
    };
})(window);
