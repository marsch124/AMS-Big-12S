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
    var browsing = false;      // reading without keeping your place, until told otherwise
    var looking = false;       // a passing look at one passage; ends on leaving the reader

    /* ------------------------------------------------------------ helpers */

    function escapeHtml(text) {
        return String(text)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    /*
     * A little emphasis, and nothing else. **bold**, *italics*, _italics_.
     *
     * Escaped first and formatted second, always in that order: nothing typed
     * can become a tag, because the only < in the result is one this function
     * put there. A real rich-text editor was the other way to do this — a
     * contenteditable box and a toolbar — and it is a great deal of fragile
     * machinery on a phone for the sake of making one word bold.
     */
    function richText(text) {
        return escapeHtml(text)
            .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
            .replace(/\*([^*\n]+)\*/g, '<em>$1</em>')
            .replace(/(^|\s)_([^_\n]+)_(?=$|\s|[.,;:!?])/g, '$1<em>$2</em>');
    }

    function toast(message, ms) {
        var el = $('toast');
        el.textContent = message;
        el.hidden = false;
        clearTimeout(el._timer);
        el._timer = setTimeout(function () { el.hidden = true; }, ms || 2600);
    }

    /*
     * Twenty-four hours, everywhere a time appears. Built by hand rather than
     * left to the device's locale: toLocaleTimeString with hour12 off still
     * says "24:00" at midnight in some locales, and the point of this is that
     * there is no a.m. or p.m. anywhere in the app.
     */
    function clockTime(date) {
        var d = date instanceof Date ? date : new Date(date);
        if (isNaN(d)) return '';
        return String(d.getHours()).padStart(2, '0') + ':' +
            String(d.getMinutes()).padStart(2, '0');
    }

    function formatDate(iso) {
        if (!iso) return '';
        var date = new Date(iso);
        if (isNaN(date)) return '';
        return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) +
            ' · ' + clockTime(date);
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
        // A passing look is over the moment you leave the reader. Browsing, set
        // by hand, is not.
        if (name !== 'reader' && looking) { looking = false; showBrowsingStrip(); }
        ['home', 'library', 'reader', 'steps', 'step', 'notes', 'search', 'settings',
         'craving', 'meeting']
            .forEach(function (screen) {
                $('screen-' + screen).classList.toggle('is-active', screen === name);
            });
        // A step page is pushed from the Steps tab, and the craving and meeting
        // screens from the home screen, so those tabs stay lit while you are
        // inside one.
        var litTab = name === 'step' ? 'steps'
            : (name === 'craving' || name === 'meeting') ? 'home' : name;
        Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (tab) {
            tab.classList.toggle('is-active', tab.dataset.screen === litTab);
        });
        // The reader gets the whole screen; the tab bar would only steal room.
        $('tabbar').hidden = name === 'reader';
        current.screen = name;

        if (name === 'reader') requestWakeLock(); else releaseWakeLock();
        // The clock ticks only while it is on screen. Nothing else on the home
        // screen has to keep time, and a timer running behind the reader is a
        // wake-up a minute for a screen nobody is looking at.
        if (name === 'home') renderHome();
        else if (name === 'craving') renderCraving();
        else { stopClock(); if (name === 'meeting') renderMeeting(); }
        if (name === 'library') renderLibrary();
        if (name === 'notes') renderNotes();
        if (name === 'settings') renderSettings();
        if (name === 'steps') renderSteps();
        if (name === 'search') setTimeout(function () { $('search-input').focus(); }, 60);
    }

    function showSettingsAt(anchorId) {
        showScreen('settings');
        setTimeout(function () {
            $(anchorId).scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 80);
    }

    /* --------------------------------------------------------------- home */

    var clockTimer = null;

    function greetingFor(hour) {
        if (hour < 5) return 'Still up';
        if (hour < 12) return 'Good morning';
        if (hour < 18) return 'Good afternoon';
        return 'Good evening';
    }

    function paintClock() {
        var now = new Date();
        $('home-clock').textContent = clockTime(now);
        $('home-greeting').textContent = greetingFor(now.getHours());
        $('home-date').textContent = now.toLocaleDateString(undefined,
            { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    }

    /*
     * On the minute, not on the second. Both things that keep time here — the
     * clock on the home screen and how long a craving has been going — are
     * measured in minutes, so a timer sixty times as busy would spend sixty
     * times the battery drawing the same digits. The first wait is short —
     * however much is left of this minute — so the change lands when the minute
     * actually turns.
     */
    function tickOnTheMinute(paint) {
        stopClock();
        paint();
        var now = new Date();
        clockTimer = setTimeout(function () {
            paint();
            clockTimer = setInterval(paint, 60000);
        }, (60 - now.getSeconds()) * 1000 - now.getMilliseconds());
    }

    function startClock() {
        tickOnTheMinute(paintClock);
    }

    function stopClock() {
        if (!clockTimer) return;
        clearTimeout(clockTimer);
        clearInterval(clockTimer);
        clockTimer = null;
    }

    function renderHome() {
        startClock();
        renderDayCount();
        renderPassage();
        renderContinueCard('home-continue');
        renderShortcuts();
        renderStats();
    }

    /*
     * The day count. Tapping it goes to the date it counts from, which is the
     * only thing there is to do with it.
     */
    function renderDayCount() {
        var card = $('daycount');
        var days = Store.daysAbstinent();
        var since = String(Store.state.settings.soberSince || '').trim();

        renderLastUse();
        card.classList.toggle('is-unset', days === null);
        if (days === null) {
            $('daycount-n').textContent = '';
            $('daycount-label').textContent = 'Count the days — set the first one';
            $('daycount-since').textContent = '';
        } else {
            $('daycount-n').textContent = days.toLocaleString();
            $('daycount-label').textContent = days === 1 ? 'day' : 'days';
            $('daycount-since').textContent = 'since ' + formatDay(since);
        }
    }

    /*
     * How long since anything was actually done in here. Coloured because it has
     * a direction — quiet at a day or two, accent when it has been most of a
     * week, and the danger colour past that. The abstinence count above it is
     * deliberately not coloured: a low number there is not a warning, and an app
     * that turns somebody's third day red is scolding them.
     */
    function renderLastUse() {
        var line = $('lastuse');
        var days = Store.daysSinceActivity();

        line.classList.remove('is-warm', 'is-cold');
        if (days === null) {
            line.textContent = 'Nothing read or written yet.';
            return;
        }
        if (days === 0) { line.textContent = 'You read or wrote something today.'; return; }
        if (days === 1) { line.textContent = 'You read or wrote something yesterday.'; return; }

        line.textContent = 'Nothing read or written for ' + days + ' days.';
        line.classList.add(days >= 7 ? 'is-cold' : 'is-warm');
    }

    /*
     * The passage for today, and a way into the page it came from. The text is
     * the book's own, verified at build time; if the reader has imported a copy
     * that does not contain it, the card says so rather than opening the reader
     * at a guessed paragraph.
     */
    function renderPassage() {
        var card = $('passage-card');
        var passage = Store.passageForDay();
        if (!passage) { card.hidden = true; return; }

        card.hidden = false;
        $('passage-text').textContent = passage.text;
        card.disabled = passage.paraIndex === null;
        $('passage-where').textContent = passage.paraIndex === null
            ? passage.sectionTitle + ' — not in the text now loaded'
            : passage.sectionTitle + ' · tap to read it in place';

        card.onclick = function () {
            if (passage.paraIndex === null) return;
            openReader(passage.sectionId,
                { paraIndex: passage.paraIndex, highlight: true, justLooking: true });
        };
    }

    /*
     * Six ways in, written in the first person, because that is how the reason
     * arrives: not "notes" but "I want to write something down". Two of them
     * have nothing behind them yet and say so when tapped — a place held open
     * is more honest than a button that quietly does nothing.
     */
    function renderShortcuts() {
        var position = Store.state.position;
        var section = position && Store.getSection(position.sectionId);
        $('shortcut-read-note').textContent = section ? section.title : 'From the beginning';

        $('shortcut-craving-note').textContent = cravingStateLine();
        $('shortcut-meeting-note').textContent = meetingStateLine();

        [['sponsor', 'shortcut-sponsor-note'], ['sponsee', 'shortcut-sponsee-note']].forEach(function (pair) {
            var waiting = Store.waitingFor(pair[0]);
            var note = $(pair[1]);
            note.textContent = waiting ? waiting + ' still to raise' : 'Nothing waiting';
            note.classList.toggle('is-waiting', waiting > 0);
        });
    }

    function openNotesWith(filter) {
        notesFilter = filter;
        showScreen('notes');
    }

    function runShortcut(name) {
        if (name === 'read') {
            var position = Store.state.position;
            if (position && Store.getSection(position.sectionId)) {
                openReader(position.sectionId,
                    { paraIndex: position.paraIndex, ratio: position.ratio });
            } else {
                showScreen('library');
            }
            return;
        }
        if (name === 'craving') { showScreen('craving'); return; }
        if (name === 'meeting') { showScreen('meeting'); return; }
        if (name === 'sponsor') { openNotesWith('sponsor'); return; }
        if (name === 'sponsee') { openNotesWith('sponsee'); return; }
        if (name === 'write') { openNoteSheet(null, null, null, { tag: '' }); return; }
        toast('Not built yet — this one is a place held open.');
    }

    /*
     * Four counts, each of exactly what its own screen shows. Nothing here is
     * an estimate and nothing is flattered: a morning with nothing written says
     * so, because a number that only ever goes up stops being a number.
     */
    function renderStats() {
        var box = $('stats');
        box.innerHTML = '';

        var position = Store.state.position;
        var section = position && Store.getSection(position.sectionId);

        var touched = Store.allSteps().filter(function (step) {
            return Store.stepProgress(step.id).total > 0;
        }).length;

        var run = Store.daysRunning();
        var best = Store.bestRun();
        var bookmarks = Store.state.bookmarks.length;

        [{
            value: String(Store.progressPercent()), unit: '%',
            label: 'Through the book',
            note: section ? section.title : 'Not opened yet',
            go: function () { runShortcut('read'); }
        }, {
            value: String(Store.state.notes.length),
            label: 'Notes written',
            note: bookmarks ? bookmarks + (bookmarks === 1 ? ' bookmark' : ' bookmarks') : '',
            go: function () { openNotesWith('all'); }
        }, {
            value: String(touched), unit: ' of 12',
            label: 'Steps worked on',
            note: touched === 12 ? 'all of them' : 'notes, answers, work',
            go: function () { showScreen('steps'); }
        }, {
            // Days you have opened the app, not days you have done a particular
            // piece of work. Showing up is the thing being counted.
            value: String(run),
            label: run === 1 ? 'Day running' : 'Days running',
            note: 'opened the app',
            go: function () {
                toast(run === 1
                    ? 'Days in a row you have opened the app. This is the first.'
                    : 'Days in a row you have opened the app. Your longest run is ' +
                      best + '.', 4000);
            }
        }].forEach(function (stat) {
            var tile = document.createElement('button');
            tile.className = 'stat';
            tile.innerHTML =
                '<span class="stat-value">' + escapeHtml(stat.value) +
                    (stat.unit ? '<span class="stat-unit">' + escapeHtml(stat.unit) + '</span>' : '') +
                '</span>' +
                '<span class="stat-label">' + escapeHtml(stat.label) + '</span>' +
                '<span class="stat-note">' + escapeHtml(stat.note || '') + '</span>';
            tile.addEventListener('click', stat.go);
            box.appendChild(tile);
        });
    }

    /* ------------------------------------------------------------ craving */

    var cravingEditing = null;   // the record the sheet is open on

    function timeOfDay(iso) {
        return clockTime(iso);
    }

    function lengthOfTime(minutes) {
        if (minutes < 1) return 'under a minute';
        if (minutes === 1) return 'one minute';
        if (minutes < 60) return minutes + ' minutes';
        var hours = Math.floor(minutes / 60);
        var rest = minutes % 60;
        return (hours === 1 ? 'an hour' : hours + ' hours') +
            (rest ? ' and ' + lengthOfTime(rest) : '');
    }

    function daysSince(iso) {
        return Store.dayNumber(new Date()) - Store.dayNumber(new Date(iso));
    }

    /*
     * Where the cravings stand, in one line — on the home tile and at the top of
     * the screen itself. "None for six days" is the number worth having in front
     * of you; it is the one that grows while nothing is happening.
     */
    function cravingStateLine() {
        var summary = Store.cravingSummary();
        if (summary.open) return 'One open, since ' + timeOfDay(summary.open.startedAt);
        if (!summary.lastEndedAt) return '';
        var days = daysSince(summary.lastEndedAt);
        if (days < 1) return 'One earlier today';
        if (days === 1) return 'None since yesterday';
        return 'None for ' + days + ' days';
    }

    function cravingSummaryLine() {
        var summary = Store.cravingSummary();
        if (!summary.total) {
            return 'Nothing written down yet. The first one you sit through is worth having on this list.';
        }
        if (!summary.closed) return 'This is the first one written down.';

        var line;
        if (summary.closed === 1) {
            line = summary.passed === 1 ? 'One written down, and it passed.' : 'One written down.';
        } else if (summary.passed === summary.closed) {
            line = summary.closed + ' written down, and every one of them passed.';
        } else {
            line = summary.closed + ' written down, ' + summary.passed + ' of them passed.';
        }
        if (summary.longest >= 1) line += ' The longest ran ' + lengthOfTime(summary.longest) + '.';
        return line;
    }

    function paintCravingElapsed() {
        var open = Store.openCraving();
        if (!open) return;
        var minutes = Math.max(0, Math.round((Date.now() - new Date(open.startedAt)) / 60000));
        $('craving-elapsed').textContent = lengthOfTime(minutes) + ' so far';
    }

    function renderCraving() {
        var open = Store.openCraving();

        $('craving-live').hidden = !open;
        $('craving-start').hidden = !!open;
        $('craving-start-hint').hidden = !!open;
        $('craving-sub').textContent = cravingStateLine();

        if (open) {
            $('craving-since').textContent = timeOfDay(open.startedAt);
            // Keeps counting while the screen is open, so sitting through it has
            // something to watch that is not the craving.
            tickOnTheMinute(paintCravingElapsed);
        } else {
            stopClock();
        }

        renderCravingPassage();
        renderCravingActions();
        renderCravingList();
    }

    function renderCravingPassage() {
        var card = $('craving-passage');
        var passage = Store.passageForCraving();
        if (!passage) { card.hidden = true; return; }

        card.hidden = false;
        $('craving-passage-text').textContent = passage.text;
        card.disabled = passage.paraIndex === null;
        $('craving-passage-where').textContent = passage.paraIndex === null
            ? passage.sectionTitle + ' — not in the text now loaded'
            : passage.sectionTitle + ' · tap to read it in place';
        card.onclick = function () {
            if (passage.paraIndex === null) return;
            openReader(passage.sectionId,
                { paraIndex: passage.paraIndex, highlight: true, justLooking: true });
        };
    }

    var PHONE_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true">' +
        '<path d="M8.1 3.9c.9 1.3 1.7 2.6 2.4 4l-1.9 2c.7 1.9 2 3.4 3.7 4.4l2.1-1.7c1.4.8 ' +
        '2.7 1.7 3.9 2.7-.5 1.6-1.6 2.7-3.2 3.1-5.3-.5-9.7-4.9-10.2-10.2.4-1.7 1.5-2.8 ' +
        '3.2-4.3z"/></svg>';

    // Sponsor first, because that is who you are supposed to ring. Then the
    // sponsee — the book's own answer to a shaky evening is to work with another
    // alcoholic — and then the person you live with.
    var RING_PEOPLE = [
        { role: 'sponsor', label: 'Your sponsor' },
        { role: 'sponsee', label: 'Your sponsee' },
        { role: 'spouse', label: 'Your spouse' }
    ];

    function renderCravingActions() {
        var settings = Store.state.settings;
        var box = $('craving-rings');
        box.innerHTML = '';

        var anyone = false;
        RING_PEOPLE.forEach(function (person) {
            var phone = String(settings[person.role + 'Phone'] || '').trim();
            if (!phone) return;
            anyone = true;

            var name = String(settings[person.role + 'Name'] || '').trim();
            var row = document.createElement('a');
            row.className = 'do-row';
            // Spaces and brackets are for reading, not for dialling.
            row.href = 'tel:' + phone.replace(/[^+0-9]/g, '');
            row.innerHTML =
                '<span class="do-icon">' + PHONE_ICON + '</span>' +
                '<span class="do-text">' +
                    '<span class="do-label">Ring ' + escapeHtml(name || person.label.toLowerCase()) +
                        '</span>' +
                    '<span class="do-note">' + escapeHtml(person.label + ' · ' + phone) + '</span>' +
                '</span>' +
                '<span class="do-go">›</span>';
            box.appendChild(row);
        });

        if (!anyone) {
            var add = document.createElement('button');
            add.className = 'do-row';
            add.id = 'craving-ring';
            add.innerHTML =
                '<span class="do-icon">' + PHONE_ICON + '</span>' +
                '<span class="do-text">' +
                    '<span class="do-label" id="craving-ring-label">Add a number to ring</span>' +
                    '<span class="do-note">Sponsor, sponsee or spouse — it stays on this device</span>' +
                '</span>' +
                '<span class="do-go">›</span>';
            add.addEventListener('click', function () { showSettingsAt('settings-people'); });
            box.appendChild(add);
        }

        // The chapter is only offered if this copy of the text has it.
        var chapter = Store.getSection('ch03');
        $('craving-chapter').hidden = !chapter || !chapter.paragraphs.length;
    }

    function renderCravingList() {
        var box = $('craving-list');
        box.innerHTML = '';
        $('craving-summary').textContent = cravingSummaryLine();

        // Newest first, and only the last ten: this is a list you glance at for
        // its length, not one you read through.
        var closed = Store.state.cravings.filter(function (row) { return !!row.endedAt; });
        closed.slice(0, 10).forEach(function (row) {
            var minutes = Store.cravingMinutes(row);
            var drank = row.outcome === 'drank';

            var card = document.createElement('button');
            card.className = 'card craving-card' + (drank ? ' is-drank' : '');
            card.innerHTML =
                '<span class="craving-when">' +
                    '<span class="craving-date">' + escapeHtml(shortDate(row.startedAt)) + '</span>' +
                    '<span class="craving-lasted">' + escapeHtml(timeOfDay(row.startedAt) +
                        (minutes === null ? '' : ' · ' + lengthOfTime(minutes))) + '</span>' +
                    '<span class="craving-outcome">' + (drank ? 'Drank' : 'Passed') + '</span>' +
                '</span>' +
                (row.what ? '<p class="craving-what">' + escapeHtml(row.what) + '</p>' : '');
            card.addEventListener('click', function () { openCravingSheet(row); });
            box.appendChild(card);
        });

        if (closed.length > 10) {
            var more = document.createElement('p');
            more.className = 'hint';
            more.textContent = 'Showing the last 10 of ' + closed.length + '.';
            box.appendChild(more);
        }
    }

    function setCravingOutcome(outcome) {
        Array.prototype.forEach.call(document.querySelectorAll('#craving-outcome .chip'), function (chip) {
            chip.classList.toggle('is-active', chip.dataset.outcome === outcome);
        });
    }

    function openCravingSheet(row) {
        cravingEditing = row;
        $('craving-sheet-title').textContent = row.endedAt ? 'This one' : 'How did it end?';
        $('craving-sheet-when').textContent = 'Started ' + shortDate(row.startedAt) + ', ' +
            timeOfDay(row.startedAt) +
            (row.endedAt ? ' · ended ' + timeOfDay(row.endedAt) : '');
        setCravingOutcome(row.outcome || 'passed');
        $('craving-sheet-what').value = row.what || '';
        openSheet('craving-sheet');
    }

    function saveCravingSheet() {
        if (!cravingEditing) return;
        var lit = document.querySelector('#craving-outcome .chip.is-active');
        Store.endCraving(cravingEditing.id, {
            outcome: lit ? lit.dataset.outcome : 'passed',
            what: $('craving-sheet-what').value
        }).then(function () {
            cravingEditing = null;
            closeSheets();
            renderCraving();
        });
    }

    /* ------------------------------------------------------------ meeting */

    var meetingEditing = null;   // the record the sheet is open on

    // Meetings are weekly things, so the day of the week is worth as much as the
    // date — "Tuesday, Kolpinghaus" only reads right against a Tuesday.
    function meetingDay(iso) {
        var d = new Date(iso + 'T00:00:00');
        if (isNaN(d)) return iso;
        var format = { weekday: 'short', month: 'short', day: 'numeric' };
        if (d.getFullYear() !== new Date().getFullYear()) format.year = 'numeric';
        return d.toLocaleDateString(undefined, format);
    }

    function meetingStateLine() {
        var summary = Store.meetingSummary();
        if (!summary.last) return '';
        var days = daysSince(summary.last.on + 'T00:00:00');
        if (days < 1) return 'One today';
        if (days === 1) return 'The last was yesterday';
        return 'The last was ' + days + ' days ago';
    }

    function meetingSummaryLine() {
        var summary = Store.meetingSummary();
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

    function renderMeeting() {
        $('meeting-sub').textContent = meetingStateLine();
        renderMeetingRaise();
        renderMeetingList();
    }

    /*
     * The points marked for a meeting, still waiting. The same card as on the
     * Notes tab — so it can be ticked off from here, and so there is one card
     * to keep right rather than two.
     */
    function renderMeetingRaise() {
        var box = $('meeting-raise');
        box.innerHTML = '';

        var waiting = Store.state.notes
            .filter(function (note) { return note.tag === 'meeting' && !note.discussedAt; })
            .map(Store.resolveNote);

        waiting.forEach(function (note) { box.appendChild(noteCard(note)); });
        $('meeting-raise-empty').hidden = waiting.length > 0;
        $('meeting-copy').hidden = !waiting.length;
        $('meeting-copy').onclick = function () { copyTalkList(waiting, 'meeting'); };
    }

    function renderMeetingList() {
        var box = $('meeting-list');
        box.innerHTML = '';
        $('meeting-summary').textContent = meetingSummaryLine();

        Store.state.meetings.slice(0, 12).forEach(function (row) {
            var card = document.createElement('button');
            card.className = 'card meeting-card';
            card.innerHTML =
                '<span class="meeting-head">' +
                    '<span class="meeting-date">' + escapeHtml(meetingDay(row.on)) + '</span>' +
                    (row.where ? '<span class="meeting-where">' + escapeHtml(row.where) + '</span>' : '') +
                    (row.shared ? '<span class="meeting-shared">Shared</span>' : '') +
                '</span>' +
                (row.what ? '<p class="meeting-what">' + escapeHtml(row.what) + '</p>' : '');
            card.addEventListener('click', function () { openMeetingSheet(row); });
            box.appendChild(card);
        });

        if (Store.state.meetings.length > 12) {
            var more = document.createElement('p');
            more.className = 'hint';
            more.textContent = 'Showing the last 12 of ' + Store.state.meetings.length + '.';
            box.appendChild(more);
        }
    }

    function setMeetingShared(shared) {
        var chip = $('meeting-sheet-shared');
        chip.dataset.shared = shared ? 'yes' : 'no';
        chip.classList.toggle('is-active', !!shared);
    }

    function openMeetingSheet(row) {
        meetingEditing = row || null;
        $('meeting-sheet-title').textContent = row ? 'This meeting' : 'A meeting';
        $('meeting-sheet-on').value = (row && row.on) || Store.todayISO();
        $('meeting-sheet-on').max = Store.todayISO();
        $('meeting-sheet-where').value = (row && row.where) || '';
        $('meeting-sheet-what').value = (row && row.what) || '';
        setMeetingShared(row && row.shared);
        $('meeting-sheet-delete').hidden = !row;

        // The places you already go, so the usual one is a tap and keeps the
        // name it had last time — which is what makes the list countable.
        var places = $('meeting-places');
        places.innerHTML = '';
        Store.usualPlaces().forEach(function (name) {
            var chip = document.createElement('button');
            chip.className = 'chip';
            chip.textContent = name;
            chip.addEventListener('click', function () {
                $('meeting-sheet-where').value = name;
            });
            places.appendChild(chip);
        });

        openSheet('meeting-sheet');
    }

    function saveMeetingSheet() {
        var record = Object.assign({}, meetingEditing || {}, {
            on: $('meeting-sheet-on').value || Store.todayISO(),
            where: $('meeting-sheet-where').value,
            shared: $('meeting-sheet-shared').dataset.shared === 'yes',
            what: $('meeting-sheet-what').value
        });
        Store.saveMeeting(record).then(function () {
            meetingEditing = null;
            closeSheets();
            renderMeeting();
        });
    }

    /* ------------------------------------------------------------ library */

    function renderLibrary() {
        var book = Store.state.book;
        $('library-title').textContent = book.title || 'Alcoholics Anonymous';
        $('library-edition').textContent = [book.edition, book.subtitle].filter(Boolean).join(' — ');
        $('import-notice').hidden = !!book.textIncluded;

        renderContinueCard('continue');

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

    /*
     * The same card, drawn into either the home screen or the contents. One
     * function rather than two: the second copy is the one that would quietly
     * fall behind. The id prefix names which set of elements to fill.
     */
    function renderContinueCard(prefix) {
        var card = $(prefix === 'continue' ? 'continue-card' : prefix);
        var main = $(prefix + '-main');
        var position = Store.state.position;
        if (!position || !Store.state.book.textIncluded) { card.hidden = true; return; }

        var section = Store.getSection(position.sectionId);
        if (!section || !section.paragraphs.length) { card.hidden = true; return; }

        var index = Math.min(position.paraIndex || 0, section.paragraphs.length - 1);
        card.hidden = false;
        $(prefix + '-title').textContent = section.title;
        $(prefix + '-excerpt').textContent = firstWords(section.paragraphs[index], 28);
        $(prefix + '-progress').style.width = Store.progressPercent() + '%';
        $(prefix + '-meta').textContent = Store.progressPercent() + '% through the book · ' +
            formatDate(position.updatedAt);
        main.onclick = function () {
            openReader(position.sectionId, { paraIndex: index, ratio: position.ratio });
        };
    }

    /*
     * Adjusting what the card points at. Three things are wanted and none was
     * possible before: taking a chapter from the top again, saying that you are
     * not anywhere in the book just now, and reading somewhere without that
     * counting as where you are up to. Moving it somewhere else entirely is
     * already a matter of opening that chapter from the contents.
     */
    function openContinueSheet() {
        var position = Store.state.position;
        var section = position && Store.getSection(position.sectionId);
        $('continue-sheet-where').textContent = section
            ? section.title + ' · ' + Store.progressPercent() + '% through the book'
            : '';
        $('continue-browse').textContent = browsing
            ? 'Keep my place again'
            : 'Read without keeping my place';
        openSheet('continue-sheet');
    }

    /*
     * Turning it off from inside the reader keeps the place you have actually
     * reached, not the one you left an hour ago — that is what "keep it again"
     * means standing on a page.
     */
    function setBrowsing(on, keepHere) {
        browsing = !!on;
        if (!browsing) looking = false;
        showBrowsingStrip();
        if (!browsing && keepHere) recordPosition();
    }

    function showBrowsingStrip() {
        $('browsing').hidden = !(browsing || looking);
    }

    function refreshContinueCards() {
        renderContinueCard('home-continue');
        renderContinueCard('continue');
        if (current.screen === 'home') renderHome();
    }

    /* ------------------------------------------------------------- reader */

    /*
     * options.justLooking — going to one passage rather than reading on: today's
     * passage, a step's reference, the passage behind a note, a search hit.
     * Those are an extra reading in the middle of the day and must not move
     * where you are up to; the percentage on the card belongs to the read you
     * are actually doing. Opening a whole chapter is the other thing, and
     * counts.
     *
     * A look ends when you leave the reader, so the next chapter opened from
     * the contents is remembered as usual. Browsing, switched on by hand,
     * outlasts it.
     */
    function openReader(sectionId, options) {
        options = options || {};
        looking = !!options.justLooking;
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
        showBrowsingStrip();
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
        // Every save of a reading position comes through here — on opening a
        // chapter, on scroll, on leaving the reader, on pagehide. One guard, so
        // neither browsing nor a passing look can leave a trail through some
        // other door.
        if (browsing || looking || !current.sectionId) return;
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
    var TAG_SHORT = { sponsor: 'Sponsor', sponsee: 'Sponsee', meeting: 'Meeting' };

    function setNoteTag(tag) {
        noteTag = tag || '';
        Array.prototype.forEach.call(document.querySelectorAll('#note-tags .chip'), function (chip) {
            chip.classList.toggle('is-active', chip.dataset.tag === noteTag);
        });
        $('note-tag-hint').textContent = noteTag === 'meeting'
            ? 'It will wait with the things to bring up at a meeting until you tick it off.'
            : noteTag
                ? 'It will wait on your ' + noteTag + ' list until you tick it off.'
                : (noteOnPassage
                    ? 'Leave them all off and it stays a note on this passage.'
                    : 'Leave them all off and it stays a thought of your own.');
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
            if (current.screen === 'craving') renderCraving();
            if (current.screen === 'meeting') renderMeeting();
            renderNotes();
        }
    }

    /* --------------------------------------------------------------- steps */

    /*
     * What has been done to a step, in the terms the step itself uses. Only
     * what is actually there goes in the line: a step with nothing written says
     * nothing, rather than three zeros.
     *
     * This used to be a single badge counting journal entries, which meant
     * answering eight questions and filling in an inventory left the row
     * reading as untouched — the app telling the reader they had not done
     * something they had.
     */
    function progressLine(done) {
        var parts = [];
        if (done.answered) parts.push(done.answered + ' of ' + done.questions + ' answered');
        if (done.notes) parts.push(done.notes + (done.notes === 1 ? ' note' : ' notes'));
        if (done.work) parts.push(done.work + ' ' + done.noun);
        return parts.join(' · ');
    }

    // A year only when it is not this one. On a list of twelve, the useful
    // thing is how long ago — and most of it will be this year.
    function shortDate(iso) {
        var date = new Date(iso);
        if (isNaN(date)) return '';
        var format = { month: 'short', day: 'numeric' };
        if (date.getFullYear() !== new Date().getFullYear()) format.year = 'numeric';
        return date.toLocaleDateString(undefined, format);
    }

    function renderSteps() {
        var data = Store.state.steps || {};
        $('steps-edition').textContent = data.edition || '';

        var list = $('steplist');
        list.innerHTML = '';

        Store.allSteps().forEach(function (step) {
            var written = Store.stepIsWritten(step);
            var done = Store.stepProgress(step.id);
            var item = document.createElement('button');
            item.className = 'step-item' + (written || done.total ? '' : ' is-stub');
            item.innerHTML =
                '<span class="step-num">' + step.number + '</span>' +
                '<span class="step-body">' +
                  '<span class="step-name">' + escapeHtml(step.shortTitle) + '</span>' +
                  '<span class="step-line">' + escapeHtml(firstWords(Store.stepText(step), 12)) + '</span>' +
                  (done.total ? '<span class="step-progress">' +
                      escapeHtml(progressLine(done)) + '</span>' : '') +
                '</span>' +
                (done.lastAt ? '<span class="step-when">' +
                    escapeHtml(shortDate(done.lastAt)) + '</span>' : '') +
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
                    UI.openReader(ref.sectionId,
                        { paraIndex: index, highlight: true, justLooking: true });
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

        // Every declared kind now has a renderer. The fallback stays: a kind this
        // build does not know hides its section rather than showing an empty one.
        var kinds = ['inventory-tables', 'amends-list', 'amends-progress',
            'daily-entries', 'daily-practice', 'prayer', 'two-lists', 'sittings',
            'carried-defects', 'people-worked-with'];
        if (!work || kinds.indexOf(work.kind) === -1) {
            holder.hidden = true;
            body.innerHTML = '';
            return;
        }

        holder.hidden = false;
        $('step-work-intro').textContent = work.intro || '';
        body.innerHTML = '';

        if (work.kind === 'inventory-tables') {
            (work.tables || []).forEach(function (table) {
                body.appendChild(renderInvTable(step, table));
            });
        } else if (work.kind === 'amends-list') {
            body.appendChild(renderAmendsList(step, work));
        } else if (work.kind === 'amends-progress') {
            body.appendChild(renderAmendsProgress(step, work));
        } else if (work.kind === 'prayer') {
            body.appendChild(renderPrayer(step, work));
        } else if (work.kind === 'two-lists') {
            body.appendChild(renderTwoLists(step, work));
        } else if (work.kind === 'sittings') {
            body.appendChild(renderSittings(step, work));
        } else if (work.kind === 'carried-defects') {
            body.appendChild(renderCarriedDefects(step, work));
        } else if (work.kind === 'people-worked-with') {
            body.appendChild(renderPeopleWorkedWith(step, work));
        } else {
            body.appendChild(renderDaily(step, work));
        }
    }

    /* ------------------------------------------------------------ step twelve */

    /*
     * Who you have sat with, and what came of it. The intro says why it is
     * worth keeping: it is easy to forget how many there have been, and easy to
     * remember only the ones that went badly. So the page leads with the count,
     * and the outcome is recorded without ever being scored.
     */
    function renderPeopleWorkedWith(step, work) {
        var wrap = document.createElement('div');
        var tableId = work.tableId || work.kind;
        var spec = {
            id: tableId,
            title: 'Someone you sat with',
            prompt: 'A first name or initials is enough.',
            columns: work.columns || [],
            dated: true,
            dateLabel: work.promptLabel || 'First sat down'
        };

        var people = Store.inventoryFor(step.id, tableId).slice().sort(function (a, b) {
            return (b.on || '').localeCompare(a.on || '');
        });

        var add = document.createElement('button');
        add.className = 'btn btn-primary btn-block';
        add.textContent = people.length ? 'Add someone else' : 'Add the first';
        add.addEventListener('click', function () { openInvSheet(step, spec, null); });
        wrap.appendChild(add);

        if (!people.length) {
            var none = document.createElement('p');
            none.className = 'hint';
            none.textContent = 'Nobody written down yet.';
            wrap.appendChild(none);
            return wrap;
        }

        var tally = document.createElement('p');
        tally.className = 'hint';
        tally.textContent = people.length === 1
            ? 'One person.'
            : people.length + ' people.';
        wrap.appendChild(tally);

        var list = document.createElement('div');
        list.className = 'people-list';

        people.forEach(function (row) {
            var values = row.values || {};
            var current = Store.rowState(row, step.id);

            var card = document.createElement('div');
            card.className = 'person';
            card.innerHTML =
                '<div class="person-head">' +
                    '<span class="person-who">' + escapeHtml(values.who || 'Someone') + '</span>' +
                    '<span class="person-when">' + escapeHtml(formatDay(row.on)) + '</span>' +
                '</div>' +
                (values.how ? '<p class="person-line">' + escapeHtml(values.how) + '</p>' : '') +
                (values.what ? '<p class="person-line person-what">' + escapeHtml(values.what) + '</p>' : '');

            var states = document.createElement('div');
            states.className = 'person-states';
            (work.states || []).forEach(function (option) {
                var on = current === option.id;
                var b = document.createElement('button');
                b.className = 'chip' + (on ? ' is-active' : '');
                b.textContent = option.label;
                b.addEventListener('click', function () {
                    Store.setRowState(row.id, step.id, on ? '' : option.id)
                        .then(function () { renderStepWork(step); });
                });
                states.appendChild(b);
            });
            card.appendChild(states);

            var chosen = (work.states || []).filter(function (o) { return o.id === current; })[0];
            if (chosen && chosen.hint) {
                var hint = document.createElement('p');
                hint.className = 'person-hint';
                hint.textContent = chosen.hint;
                card.appendChild(hint);
            }

            var actions = document.createElement('div');
            actions.className = 'card-actions';
            var edit = document.createElement('button');
            edit.className = 'chip';
            edit.textContent = 'Edit';
            edit.addEventListener('click', function () { openInvSheet(step, spec, row); });
            actions.appendChild(edit);
            card.appendChild(actions);

            list.appendChild(card);
        });

        wrap.appendChild(list);
        return wrap;
    }

    /* --------------------------------------------------------------- step six */

    /*
     * The defects named in step four, each asked about once however many times
     * it was written down. A defect nobody has touched shows no state at all —
     * "not yet answered" is different from "ready", and the page should not
     * flatter you by defaulting to either.
     */
    function renderCarriedDefects(step, work) {
        var wrap = document.createElement('div');
        var defects = Store.carriedDefects(step);

        if (!defects.length) {
            var empty = document.createElement('div');
            empty.className = 'notice';
            empty.innerHTML =
                '<h2>Nothing carried through yet</h2>' +
                '<p>This page lists the defects you named in step four — the part you played in a ' +
                'resentment, and the fault behind a piece of conduct. Write those and they appear ' +
                'here.</p>';
            var go = document.createElement('button');
            go.className = 'btn btn-primary';
            go.textContent = 'Open step four';
            go.addEventListener('click', function () { openStep(work.from.stepId); });
            empty.appendChild(go);
            wrap.appendChild(empty);
            return wrap;
        }

        var answered = defects.filter(function (d) {
            return d.row && Store.rowState(d.row, step.id);
        }).length;
        var tally = document.createElement('p');
        tally.className = 'hint';
        tally.textContent = answered + ' of ' + defects.length + ' answered.';
        wrap.appendChild(tally);

        var list = document.createElement('div');
        list.className = 'defect-list';

        defects.forEach(function (defect) {
            var current = defect.row ? Store.rowState(defect.row, step.id) : null;
            var answer = (defect.row && defect.row.values && defect.row.values.answer) || '';

            var card = document.createElement('div');
            card.className = 'defect' + (current ? ' is-answered' : '');

            card.innerHTML =
                '<p class="defect-text">' + escapeHtml(defect.text) + '</p>' +
                '<p class="defect-from">' + escapeHtml(defect.from.join(' · ')) +
                    (defect.count > 1 ? ' · written ' + defect.count + ' times' : '') + '</p>';

            var states = document.createElement('div');
            states.className = 'defect-states';
            (work.states || []).forEach(function (option) {
                var on = current === option.id;
                var b = document.createElement('button');
                b.className = 'chip' + (on ? ' is-active' : '');
                b.textContent = option.label;
                b.addEventListener('click', function () {
                    // Tapping the one already chosen clears it, so a defect can
                    // go back to unanswered rather than being stuck.
                    Store.saveDefect(step, defect, { state: on ? '' : option.id })
                        .then(function () { renderStepWork(step); });
                });
                states.appendChild(b);
            });
            card.appendChild(states);

            var chosen = (work.states || []).filter(function (o) { return o.id === current; })[0];
            if (chosen && chosen.hint) {
                var hint = document.createElement('p');
                hint.className = 'defect-hint';
                hint.textContent = chosen.hint;
                card.appendChild(hint);
            }

            if (answer) {
                var written = document.createElement('p');
                written.className = 'defect-answer';
                written.textContent = answer;
                card.appendChild(written);
            }

            var actions = document.createElement('div');
            actions.className = 'card-actions';
            var write = document.createElement('button');
            write.className = 'chip';
            write.textContent = answer ? 'Edit answer' : 'Answer honestly';
            write.addEventListener('click', function () {
                openPaste({
                    title: defect.text,
                    hint: 'An honest answer, not a tick. What would it cost you to be without this?',
                    value: answer,
                    onConfirm: function (value) {
                        Store.saveDefect(step, defect, { answer: String(value || '') })
                            .then(function () { renderStepWork(step); });
                    }
                });
            });
            actions.appendChild(write);
            card.appendChild(actions);

            list.appendChild(card);
        });

        wrap.appendChild(list);
        return wrap;
    }

    /* -------------------------------------------------------------- step five */

    // Which sittings have their held-back field showing. Deliberately not
    // remembered: it starts closed again every time the page is opened.
    var sittingOpen = {};

    /*
     * A record that the telling happened, kept with the date it happened on
     * rather than the date it was typed up. Going back later to say the thing
     * you left out is a second sitting, not an edit of the first.
     *
     * What was held back is folded away by default. That is discretion, not
     * security — anyone holding an unlocked phone can open it — but it keeps
     * the most private line in the app off the screen at a glance.
     */
    function renderSittings(step, work) {
        var wrap = document.createElement('div');
        var tableId = work.tableId || work.kind;
        var spec = {
            id: tableId,
            title: 'A sitting',
            prompt: 'A record that it happened. Not a second inventory.',
            fields: work.fields || [],
            dated: true,
            dateLabel: work.promptLabel || 'On'
        };

        var sittings = Store.inventoryFor(step.id, tableId).slice().sort(function (a, b) {
            return (b.on || '').localeCompare(a.on || '');
        });

        var add = document.createElement('button');
        add.className = 'btn btn-primary btn-block';
        add.textContent = sittings.length ? 'Record another sitting' : 'Record a sitting';
        add.addEventListener('click', function () { openInvSheet(step, spec, null); });
        wrap.appendChild(add);

        if (!sittings.length) {
            var none = document.createElement('p');
            none.className = 'hint';
            none.textContent = 'Nothing recorded yet.';
            wrap.appendChild(none);
            return wrap;
        }

        var list = document.createElement('div');
        list.className = 'sitting-list';

        sittings.forEach(function (row, index) {
            var values = row.values || {};
            var card = document.createElement('div');
            card.className = 'sitting' + (index === 0 ? ' is-latest' : '');

            var head = document.createElement('div');
            head.className = 'sitting-head';
            head.innerHTML =
                '<span class="sitting-when">' + escapeHtml(formatDay(row.on)) + '</span>' +
                (values.who ? '<span class="sitting-who">' + escapeHtml(values.who) + '</span>' : '');
            card.appendChild(head);

            if (values.covered) {
                var covered = document.createElement('p');
                covered.className = 'sitting-covered';
                covered.textContent = values.covered;
                card.appendChild(covered);
            }

            if (values.heldBack) {
                var open = !!sittingOpen[row.id];
                var held = document.createElement('div');
                held.className = 'sitting-held' + (open ? ' is-open' : '');

                var toggle = document.createElement('button');
                toggle.className = 'sitting-held-toggle';
                toggle.textContent = open ? 'Hide what you held back' : 'What you held back';
                toggle.addEventListener('click', function () {
                    sittingOpen[row.id] = !sittingOpen[row.id];
                    renderStepWork(step);
                });
                held.appendChild(toggle);

                if (open) {
                    var text = document.createElement('p');
                    text.className = 'sitting-held-text';
                    text.textContent = values.heldBack;
                    held.appendChild(text);
                }
                card.appendChild(held);
            }

            var actions = document.createElement('div');
            actions.className = 'card-actions';
            var edit = document.createElement('button');
            edit.className = 'chip';
            edit.textContent = 'Edit';
            edit.addEventListener('click', function () { openInvSheet(step, spec, row); });
            actions.appendChild(edit);
            card.appendChild(actions);

            list.appendChild(card);
        });

        wrap.appendChild(list);
        return wrap;
    }

    /* -------------------------------------------------- steps one and two */

    /*
     * Two lists kept side by side, added to over time rather than filled in
     * once. Each list is its own table, so an item simply belongs to the list
     * it was written into.
     *
     * Items can be moved across. Step two asks for exactly that — what you
     * cannot accept today may be what has shifted a year from now, and the
     * point of the page is being able to see that it moved.
     */
    function renderTwoLists(step, work) {
        var wrap = document.createElement('div');
        wrap.className = 'twolists';
        var lists = work.lists || [];

        lists.forEach(function (list, listIndex) {
            var other = lists[listIndex === 0 ? 1 : 0];
            var items = Store.inventoryFor(step.id, list.id);

            var panel = document.createElement('section');
            panel.className = 'listpanel';
            panel.innerHTML =
                '<h3 class="listpanel-title">' + escapeHtml(list.title) +
                    (items.length ? ' <span class="listpanel-count">' + items.length + '</span>' : '') +
                '</h3>' +
                '<p class="listpanel-prompt">' + escapeHtml(list.prompt || '') + '</p>';

            var rows = document.createElement('div');
            rows.className = 'listpanel-items';

            items.forEach(function (row) {
                var text = (row.values && row.values.text) || '';
                var item = document.createElement('div');
                item.className = 'listitem';
                item.innerHTML =
                    '<p class="listitem-text">' + escapeHtml(text) + '</p>' +
                    '<p class="listitem-when">' + escapeHtml(formatDay(
                        (row.createdAt || '').slice(0, 10))) + '</p>';

                var actions = document.createElement('div');
                actions.className = 'card-actions';

                var edit = document.createElement('button');
                edit.className = 'chip';
                edit.textContent = 'Edit';
                edit.addEventListener('click', function () {
                    openPaste({
                        title: list.title,
                        hint: list.prompt || '',
                        value: text,
                        onConfirm: function (value) {
                            var next = String(value || '').trim();
                            if (!next) { toast('Nothing written — left as it was'); return; }
                            Store.saveInventoryRow(Object.assign({}, row, { values: { text: next } }))
                                .then(function () { renderStep(Store.getStep(step.id)); });
                        }
                    });
                });
                actions.appendChild(edit);

                if (other) {
                    var move = document.createElement('button');
                    move.className = 'chip';
                    move.textContent = 'Move across';
                    move.title = 'Move to ' + other.title;
                    move.addEventListener('click', function () {
                        // Keeps its id and the date it was first written, so
                        // moving records a change of mind rather than looking
                        // like something written today.
                        Store.saveInventoryRow(Object.assign({}, row, { tableId: other.id }))
                            .then(function () {
                                toast('Moved to ' + other.title);
                                renderStep(Store.getStep(step.id));
                            });
                    });
                    actions.appendChild(move);
                }

                var del = document.createElement('button');
                del.className = 'chip';
                del.textContent = 'Remove';
                del.addEventListener('click', function () {
                    if (!confirm('Remove this from ' + list.title + '?')) return;
                    Store.deleteInventoryRow(row.id).then(function () {
                        toast('Removed');
                        renderStep(Store.getStep(step.id));
                    });
                });
                actions.appendChild(del);

                item.appendChild(actions);
                rows.appendChild(item);
            });

            if (!items.length) {
                var none = document.createElement('p');
                none.className = 'hint';
                none.textContent = 'Nothing here yet.';
                rows.appendChild(none);
            }
            panel.appendChild(rows);

            var add = document.createElement('button');
            add.className = 'btn btn-quiet btn-small listpanel-add';
            add.textContent = 'Add to this list';
            add.addEventListener('click', function () {
                openPaste({
                    title: list.title,
                    hint: list.prompt || '',
                    placeholder: 'One thing. Add another afterwards.',
                    onConfirm: function (value) {
                        var values = { text: String(value || '').trim() };
                        if (Store.rowIsEmpty(values)) { toast('Nothing written'); return; }
                        Store.saveInventoryRow({
                            stepId: step.id, tableId: list.id, values: values
                        }).then(function () {
                            toast('Added');
                            renderStep(Store.getStep(step.id));
                        });
                    }
                });
            });
            panel.appendChild(add);

            wrap.appendChild(panel);
        });

        return wrap;
    }

    /* ------------------------------------------------ steps three and seven */

    /*
     * A decision taken more than once. Every taking is kept with its date, so
     * the page shows the years rather than only the latest.
     *
     * The passage itself is not stored here — it is pulled from the bundled
     * text through the same anchor the book references use, so it stays right
     * if a different copy of the book is ever imported.
     */
    function renderPrayer(step, work) {
        var wrap = document.createElement('div');
        var tableId = work.tableId || work.kind;

        var index = Store.resolveStepRef(work.prayerRef);
        var section = index === null ? null : Store.getSection(work.prayerRef.sectionId);

        if (section) {
            var passage = document.createElement('div');
            passage.className = 'prayer-passage';
            passage.innerHTML = '<p class="prayer-text">' +
                escapeHtml(section.paragraphs[index]) + '</p>';
            var read = document.createElement('button');
            read.className = 'chip';
            read.textContent = 'Read it in ' + section.title;
            read.addEventListener('click', function () {
                UI.openReader(work.prayerRef.sectionId,
                    { paraIndex: index, highlight: true, justLooking: true });
            });
            passage.appendChild(read);
            wrap.appendChild(passage);
        }

        var records = Store.inventoryFor(step.id, tableId).slice().sort(function (a, b) {
            return (b.on || '').localeCompare(a.on || '');
        });

        var take = document.createElement('div');
        take.className = 'prayer-take';
        var when = document.createElement('input');
        when.type = 'date';
        when.className = 'field prayer-date';
        when.value = dayISO();
        when.max = dayISO();
        var mark = document.createElement('button');
        mark.className = 'btn btn-primary';
        mark.textContent = work.promptLabel || 'Today';
        mark.addEventListener('click', function () {
            var on = when.value || dayISO();
            if (records.some(function (r) { return r.on === on; })) {
                toast('Already recorded for that day');
                return;
            }
            Store.saveInventoryRow({ stepId: step.id, tableId: tableId, on: on, values: {} })
                .then(function () {
                    toast('Recorded');
                    renderStep(Store.getStep(step.id));
                });
        });
        take.appendChild(when);
        take.appendChild(mark);
        wrap.appendChild(take);

        var list = document.createElement('div');
        list.className = 'prayer-list';

        if (!records.length) {
            var none = document.createElement('p');
            none.className = 'hint';
            none.textContent = 'No dates yet.';
            list.appendChild(none);
        }

        records.forEach(function (row, i) {
            var note = (row.values && row.values.note) || '';
            var card = document.createElement('div');
            card.className = 'prayer-record' + (i === 0 ? ' is-latest' : '');
            card.innerHTML =
                '<div class="prayer-when">' + escapeHtml(formatDay(row.on)) +
                    (i === 0 && records.length > 1 ? ' <span class="prayer-latest">most recent</span>' : '') +
                '</div>' +
                (note ? '<p class="prayer-note">' + escapeHtml(note) + '</p>' : '');

            var actions = document.createElement('div');
            actions.className = 'card-actions';

            var noteBtn = document.createElement('button');
            noteBtn.className = 'chip';
            noteBtn.textContent = note ? 'Edit note' : 'Add a note';
            noteBtn.addEventListener('click', function () {
                openPaste({
                    title: formatDay(row.on),
                    hint: 'What it was like, what you were deciding, who was there. Optional.',
                    placeholder: 'Said it out loud with J. on the phone.',
                    value: note,
                    onConfirm: function (value) {
                        Store.saveInventoryRow(Object.assign({}, row,
                            { values: { note: String(value || '').trim() } }))
                            .then(function () { renderStep(Store.getStep(step.id)); });
                    }
                });
            });
            actions.appendChild(noteBtn);

            var del = document.createElement('button');
            del.className = 'chip';
            del.textContent = 'Remove';
            del.addEventListener('click', function () {
                if (!confirm('Remove ' + formatDay(row.on) + ' from this list?')) return;
                Store.deleteInventoryRow(row.id).then(function () {
                    toast('Removed');
                    renderStep(Store.getStep(step.id));
                });
            });
            actions.appendChild(del);

            card.appendChild(actions);
            list.appendChild(card);
        });

        wrap.appendChild(list);
        return wrap;
    }

    /* --------------------------------------------------- steps ten and eleven */

    // The day helpers live in the store, where the streak is worked out. Two
    // implementations of "what day is it" would eventually disagree, and the
    // home screen and the step page would then be counting different runs.
    function dayISO(date) { return Store.dayISO(date); }

    function shiftDay(iso, days) { return Store.shiftDay(iso, days); }

    function renderDaily(step, work) {
        var rows = Store.rowsForWork(step);
        var byDay = {};
        rows.forEach(function (r) { if (r.on) byDay[r.on] = r; });

        var box = document.createElement('div');
        var today = dayISO();
        var run = Store.stepStreak(step);

        var line = document.createElement('p');
        line.className = 'inv-prompt';
        line.textContent = rows.length
            ? (run ? run + ' day' + (run === 1 ? '' : 's') + ' running \u00b7 ' : '') +
              rows.length + ' entr' + (rows.length === 1 ? 'y' : 'ies') + ' in all'
            : 'Nothing written yet.';
        box.appendChild(line);

        // The last fourteen days at a glance. A day you did not write is left
        // plain rather than marked missed.
        var strip = document.createElement('div');
        strip.className = 'day-strip';
        for (var i = 13; i >= 0; i--) {
            var iso = shiftDay(today, -i);
            var cell = document.createElement('button');
            cell.className = 'day-cell' + (byDay[iso] ? ' is-done' : '') +
                (iso === today ? ' is-today' : '');
            cell.title = iso;
            cell.textContent = new Date(iso + 'T00:00:00')
                .toLocaleDateString(undefined, { weekday: 'narrow' });
            (function (dayIso) {
                cell.addEventListener('click', function () {
                    openDailySheet(step, work, byDay[dayIso] || null, dayIso);
                });
            })(iso);
            strip.appendChild(cell);
        }
        box.appendChild(strip);

        var actions = document.createElement('div');
        actions.className = 'btn-row';
        var todayBtn = document.createElement('button');
        todayBtn.className = 'btn btn-quiet btn-small';
        todayBtn.textContent = byDay[today] ? 'Edit today' : (work.promptLabel || 'Today');
        todayBtn.addEventListener('click', function () {
            openDailySheet(step, work, byDay[today] || null, today);
        });
        actions.appendChild(todayBtn);
        box.appendChild(actions);

        // Most recent first here: a practice log is read backwards from now.
        var recent = rows.slice().sort(function (a, b) {
            return String(b.on || '').localeCompare(String(a.on || ''));
        }).slice(0, 5);

        var list = document.createElement('div');
        list.className = 'inv-cards';
        recent.forEach(function (row) {
            var card = document.createElement('button');
            card.className = 'inv-card day-card';
            var parts = ['<span class="inv-label">' +
                escapeHtml(row.on ? formatDay(row.on) : 'Undated') + '</span>'];

            var flags = (work.watch || []).filter(function (w) {
                return row.values && row.values[w.id];
            });
            if (flags.length) {
                parts.push('<span class="flag-row">' + flags.map(function (f) {
                    return '<span class="flag">' + escapeHtml(f.label) + '</span>';
                }).join('') + '</span>');
            }

            (work.fields || work.parts || []).forEach(function (f) {
                var value = (row.values && row.values[f.id]) || '';
                if (!value) return;
                parts.push(
                    '<span class="inv-field">' +
                        '<span class="inv-label">' + escapeHtml(f.label) + '</span>' +
                        '<span class="inv-value">' + escapeHtml(value) + '</span>' +
                    '</span>');
            });
            card.innerHTML = parts.join('');
            card.addEventListener('click', function () {
                openDailySheet(step, work, row, row.on);
            });
            list.appendChild(card);
        });
        box.appendChild(list);

        if (rows.length > recent.length) {
            var more = document.createElement('p');
            more.className = 'hint';
            more.textContent = 'Showing the last ' + recent.length + ' of ' + rows.length + '.';
            box.appendChild(more);
        }
        return box;
    }

    function openDailySheet(step, work, existing, dayIso) {
        $('inv-sheet-title').textContent = formatDay(dayIso);
        $('inv-sheet-prompt').textContent = work.intro || '';

        var fields = $('inv-sheet-fields');
        fields.innerHTML = '';
        var flags = {};

        // Step ten's four watchwords. More than one can be true at once, so
        // these are not a state — a state holds a single answer.
        if (work.watch && work.watch.length) {
            var wl = document.createElement('span');
            wl.className = 'sheet-label';
            wl.textContent = 'Any of these today?';
            fields.appendChild(wl);
            var row = document.createElement('div');
            row.className = 'chip-row';
            work.watch.forEach(function (w) {
                var on = !!(existing && existing.values && existing.values[w.id]);
                flags[w.id] = on;
                var chip = document.createElement('button');
                chip.className = 'chip' + (on ? ' is-on' : '');
                chip.textContent = w.label;
                chip.addEventListener('click', function () {
                    flags[w.id] = !flags[w.id];
                    chip.classList.toggle('is-on', flags[w.id]);
                });
                row.appendChild(chip);
            });
            fields.appendChild(row);
        }

        var inputs = {};
        (work.fields || work.parts || []).forEach(function (f) {
            var wrap = document.createElement('label');
            wrap.className = 'inv-input';
            wrap.innerHTML = '<span class="sheet-label">' + escapeHtml(f.label) + '</span>';
            if (f.prompt) {
                var h = document.createElement('span');
                h.className = 'hint';
                h.textContent = f.prompt;
                wrap.appendChild(h);
            }
            var input = document.createElement('textarea');
            input.className = 'note-input';
            input.rows = 2;
            input.value = (existing && existing.values && existing.values[f.id]) || '';
            wrap.appendChild(input);
            inputs[f.id] = input;
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
            Object.keys(flags).forEach(function (k) { if (flags[k]) values[k] = '1'; });
            Object.keys(inputs).forEach(function (k) { values[k] = inputs[k].value; });

            if (Store.rowIsEmpty(values)) {
                if (existing) { closeSheets(); return; }
                toast('Nothing to save yet');
                return;
            }
            Store.saveInventoryRow({
                id: existing ? existing.id : null,
                createdAt: existing ? existing.createdAt : null,
                stepId: step.id,
                tableId: work.tableId || work.kind,
                values: values,
                states: existing ? existing.states : {},
                on: dayIso
            }).then(function () {
                closeSheets();
                renderStepWork(step);
                toast('Saved');
            });
        };
        $('inv-cancel').onclick = closeSheets;
        openSheet('inv-sheet');
    }

    /* ------------------------------------------------ steps eight and nine */

    function stateById(list, id) {
        return (list || []).filter(function (s) { return s.id === id; })[0] || null;
    }

    // Step eight: the names and the harm, each with where your willingness
    // actually stands. Rows live under step eight and step nine writes onto them.
    function renderAmendsList(step, work) {
        var rows = Store.rowsForWork(step);
        var box = document.createElement('div');

        var counts = document.createElement('p');
        counts.className = 'inv-prompt';
        var willing = rows.filter(function (r) {
            return Store.rowState(r, step.id) === 'willing';
        }).length;
        counts.textContent = rows.length
            ? rows.length + ' on the list, ' + willing + ' willing'
            : 'Nobody on the list yet.';
        box.appendChild(counts);

        var list = document.createElement('div');
        list.className = 'inv-cards';
        rows.forEach(function (row, index) {
            list.appendChild(amendCard(step, work, row, index, work.states, step.id));
        });
        box.appendChild(list);

        var actions = document.createElement('div');
        actions.className = 'btn-row';
        var add = document.createElement('button');
        add.className = 'btn btn-quiet btn-small';
        add.textContent = rows.length ? 'Add another' : 'Add the first';
        add.addEventListener('click', function () { openAmendSheet(step, work, null); });
        actions.appendChild(add);

        // Names already written into step four's conduct table, not yet here.
        var carried = carryableNames(work, rows);
        if (carried.length) {
            var carry = document.createElement('button');
            carry.className = 'btn btn-quiet btn-small';
            carry.textContent = 'Carry over ' + carried.length + ' from step four';
            carry.addEventListener('click', function () {
                Promise.all(carried.map(function (name) {
                    return Store.saveInventoryRow({
                        stepId: step.id,
                        tableId: work.tableId || work.kind,
                        values: { who: name }
                    });
                })).then(function () {
                    renderStepWork(step);
                    toast(carried.length + ' carried over');
                });
            });
            actions.appendChild(carry);
        }
        box.appendChild(actions);
        return box;
    }

    // Whom you named in step four's conduct pass but have not put on this list.
    function carryableNames(work, rows) {
        if (!work.from || !work.from.columns) return [];
        var have = {};
        rows.forEach(function (r) {
            have[String((r.values && r.values.who) || '').trim().toLowerCase()] = true;
        });
        var found = [];
        work.from.columns.forEach(function (source) {
            Store.inventoryFor(work.from.stepId, source.tableId).forEach(function (r) {
                var name = String((r.values && r.values[source.columnId]) || '').trim();
                if (!name) return;
                var key = name.toLowerCase();
                if (have[key]) return;
                have[key] = true;
                found.push(name);
            });
        });
        return found;
    }

    function amendCard(step, work, row, index, states, stateStepId) {
        var card = document.createElement('button');
        card.className = 'inv-card';
        var chosen = stateById(states, Store.rowState(row, stateStepId));
        var parts = ['<span class="inv-n">' + (index + 1) + '</span>'];

        ['who', 'harm'].forEach(function (id) {
            var value = (row.values && row.values[id]) || '';
            if (!value && id === 'harm') return;
            parts.push(
                '<span class="inv-field">' +
                    '<span class="inv-label">' + (id === 'who' ? 'Who' : 'What the harm was') + '</span>' +
                    '<span class="inv-value">' + escapeHtml(value || 'Not said yet') + '</span>' +
                '</span>');
        });
        if (chosen) {
            parts.push('<span class="inv-state is-' + escapeHtml(chosen.id) + '">' +
                escapeHtml(chosen.label) + '</span>');
        }
        card.innerHTML = parts.join('');
        card.addEventListener('click', function () { openAmendSheet(step, work, row); });
        return card;
    }

    // Step nine: step eight's list again, with what happened. It never creates
    // a row of its own — it writes onto the entry step eight made.
    function renderAmendsProgress(step, work) {
        var rows = Store.rowsForWork(step);
        var box = document.createElement('div');

        if (!rows.length) {
            var empty = document.createElement('p');
            empty.className = 'empty';
            empty.textContent = 'Step eight\u2019s list is empty, so there is nothing here yet. ' +
                'The names are made there and worked through here.';
            box.appendChild(empty);
            return box;
        }

        var done = rows.filter(function (r) {
            var st = Store.rowState(r, step.id);
            return st === 'made' || st === 'letter';
        }).length;
        var counts = document.createElement('p');
        counts.className = 'inv-prompt';
        counts.textContent = done + ' of ' + rows.length + ' made or written to.';
        box.appendChild(counts);

        var list = document.createElement('div');
        list.className = 'inv-cards';
        rows.forEach(function (row, index) {
            var card = document.createElement('button');
            card.className = 'inv-card';
            var chosen = stateById(work.statuses, Store.rowState(row, step.id));
            var parts = ['<span class="inv-n">' + (index + 1) + '</span>'];
            parts.push(
                '<span class="inv-field">' +
                    '<span class="inv-label">Who</span>' +
                    '<span class="inv-value">' +
                        escapeHtml((row.values && row.values.who) || 'Unnamed') + '</span>' +
                '</span>');
            var outcome = (row.values && row.values.outcome) || '';
            if (outcome) {
                parts.push(
                    '<span class="inv-field">' +
                        '<span class="inv-label">What happened' +
                            (row.on ? ' \u00b7 ' + escapeHtml(formatDay(row.on)) : '') + '</span>' +
                        '<span class="inv-value">' + escapeHtml(outcome) + '</span>' +
                    '</span>');
            }
            parts.push('<span class="inv-state is-' +
                escapeHtml(chosen ? chosen.id : 'not-yet') + '">' +
                escapeHtml(chosen ? chosen.label : 'Not yet') + '</span>');
            card.innerHTML = parts.join('');
            card.addEventListener('click', function () { openProgressSheet(step, work, row); });
            list.appendChild(card);
        });
        box.appendChild(list);
        return box;
    }

    function formatDay(iso) {
        var d = new Date(iso + 'T00:00:00');
        if (isNaN(d)) return iso;
        return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
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

    // A chip row for the states a step declares, returning what is chosen.
    function stateChooser(states, current) {
        var wrap = document.createElement('div');
        wrap.className = 'inv-states';
        var chosen = { id: current };
        var hint = document.createElement('p');
        hint.className = 'hint';

        var row = document.createElement('div');
        row.className = 'chip-row';
        (states || []).forEach(function (st) {
            var chip = document.createElement('button');
            chip.className = 'chip' + (current === st.id ? ' is-on' : '');
            chip.textContent = st.label;
            chip.addEventListener('click', function () {
                // Tapping the lit one clears it: "no answer yet" is a real answer.
                chosen.id = (chosen.id === st.id) ? null : st.id;
                row.querySelectorAll('.chip').forEach(function (c) { c.classList.remove('is-on'); });
                if (chosen.id) chip.classList.add('is-on');
                var picked = stateById(states, chosen.id);
                hint.textContent = (picked && picked.hint) || '';
            });
            row.appendChild(chip);
        });
        var picked = stateById(states, current);
        hint.textContent = (picked && picked.hint) || '';
        wrap.appendChild(row);
        wrap.appendChild(hint);
        wrap.chosen = chosen;
        return wrap;
    }

    function openAmendSheet(step, work, existing) {
        $('inv-sheet-title').textContent = (existing ? 'Edit' : 'New') + ' \u2014 amends list';
        $('inv-sheet-prompt').textContent = 'Who, and what the harm was. Step nine works through this list.';

        var fields = $('inv-sheet-fields');
        fields.innerHTML = '';
        var inputs = {};
        (work.columns || []).forEach(function (col) {
            var wrap = document.createElement('label');
            wrap.className = 'inv-input';
            wrap.innerHTML = '<span class="sheet-label">' + escapeHtml(col.label) + '</span>';
            if (col.hint) {
                var h = document.createElement('span');
                h.className = 'hint';
                h.textContent = col.hint;
                wrap.appendChild(h);
            }
            var input = document.createElement('textarea');
            input.className = 'note-input';
            input.rows = 2;
            input.value = (existing && existing.values && existing.values[col.id]) || '';
            wrap.appendChild(input);
            inputs[col.id] = input;
            fields.appendChild(wrap);
        });

        var willLabel = document.createElement('span');
        willLabel.className = 'sheet-label';
        willLabel.textContent = 'Willingness';
        fields.appendChild(willLabel);
        var chooser = stateChooser(work.states, existing ? Store.rowState(existing, step.id) : null);
        fields.appendChild(chooser);

        var del = $('inv-delete');
        del.hidden = !existing;
        del.onclick = function () {
            if (!existing) return;
            // Deleting the name takes step nine's record of it too, so say so.
            var hasProgress = !!(existing.states && existing.states.step09) ||
                !!(existing.values && existing.values.outcome);
            if (hasProgress && !confirm('This name carries what step nine recorded against it. Delete both?')) return;
            Store.deleteInventoryRow(existing.id).then(function () {
                closeSheets();
                renderStepWork(step);
                toast('Removed from the list');
            });
        };

        $('inv-save').onclick = function () {
            var values = {};
            Object.keys(inputs).forEach(function (k) { values[k] = inputs[k].value; });
            if (Store.rowIsEmpty(values) && !chooser.chosen.id) {
                if (existing) { closeSheets(); return; }
                toast('Nothing to save yet');
                return;
            }
            var states = Object.assign({}, existing ? existing.states : {});
            if (chooser.chosen.id) states[step.id] = chooser.chosen.id;
            else delete states[step.id];

            Store.saveInventoryRow({
                id: existing ? existing.id : null,
                createdAt: existing ? existing.createdAt : null,
                stepId: existing ? existing.stepId : step.id,
                tableId: existing ? existing.tableId : (work.tableId || work.kind),
                // Never drop what step nine wrote while saving step eight's half.
                values: Object.assign({}, existing ? existing.values : {}, values),
                states: states,
                on: existing ? existing.on : null
            }).then(function () {
                closeSheets();
                renderStepWork(step);
                toast(existing ? 'Updated' : 'Added to the list');
            });
        };
        $('inv-cancel').onclick = closeSheets;
        openSheet('inv-sheet');
    }

    function openProgressSheet(step, work, row) {
        $('inv-sheet-title').textContent = (row.values && row.values.who) || 'Amend';
        $('inv-sheet-prompt').textContent = (row.values && row.values.harm) || '';

        var fields = $('inv-sheet-fields');
        fields.innerHTML = '';

        var statusLabel = document.createElement('span');
        statusLabel.className = 'sheet-label';
        statusLabel.textContent = 'Where this stands';
        fields.appendChild(statusLabel);
        var chooser = stateChooser(work.statuses, Store.rowState(row, step.id));
        fields.appendChild(chooser);

        var inputs = {};
        (work.fields || []).forEach(function (f) {
            var wrap = document.createElement('label');
            wrap.className = 'inv-input';
            wrap.innerHTML = '<span class="sheet-label">' + escapeHtml(f.label) + '</span>';
            if (f.prompt) {
                var h = document.createElement('span');
                h.className = 'hint';
                h.textContent = f.prompt;
                wrap.appendChild(h);
            }
            var input = document.createElement('textarea');
            input.className = 'note-input';
            input.rows = 3;
            input.value = (row.values && row.values[f.id]) || '';
            wrap.appendChild(input);
            inputs[f.id] = input;
            fields.appendChild(wrap);
        });

        var dateWrap = document.createElement('label');
        dateWrap.className = 'inv-input';
        dateWrap.innerHTML = '<span class="sheet-label">' +
            escapeHtml(work.promptLabel || 'On') + '</span>';
        var date = document.createElement('input');
        date.type = 'date';
        date.className = 'note-input';
        date.id = 'inv-date';
        date.value = row.on || '';
        dateWrap.appendChild(date);
        fields.appendChild(dateWrap);

        // Step nine never removes a name; that is step eight's list.
        $('inv-delete').hidden = true;

        $('inv-save').onclick = function () {
            var values = Object.assign({}, row.values);
            Object.keys(inputs).forEach(function (k) { values[k] = inputs[k].value.trim(); });
            var states = Object.assign({}, row.states);
            if (chooser.chosen.id) states[step.id] = chooser.chosen.id;
            else delete states[step.id];

            Store.saveInventoryRow(Object.assign({}, row, {
                values: values,
                states: states,
                on: date.value || null
            })).then(function () {
                closeSheets();
                renderStepWork(step);
                toast('Saved');
            });
        };
        $('inv-cancel').onclick = closeSheets;
        openSheet('inv-sheet');
    }

    /*
     * The row editor for every table-shaped work module. A spec may name its
     * inputs `columns` (step four's tables) or `fields` (step five's sittings),
     * and may ask for a date of its own — a sitting happened on a day, and that
     * day is not the day it was typed up.
     */
    function openInvSheet(step, table, existing) {
        $('inv-sheet-title').textContent =
            (existing ? 'Edit' : 'New') + ' — ' + table.title;
        $('inv-sheet-prompt').textContent = table.prompt || '';

        var fields = $('inv-sheet-fields');
        fields.innerHTML = '';
        var inputs = {};
        var dateInput = null;

        if (table.dated) {
            var dateWrap = document.createElement('label');
            dateWrap.className = 'inv-input';
            var dateLabel = document.createElement('span');
            dateLabel.className = 'sheet-label';
            dateLabel.textContent = table.dateLabel || 'On';
            dateWrap.appendChild(dateLabel);
            dateInput = document.createElement('input');
            dateInput.type = 'date';
            dateInput.className = 'field';
            dateInput.value = (existing && existing.on) || dayISO();
            dateInput.max = dayISO();
            dateWrap.appendChild(dateInput);
            fields.appendChild(dateWrap);
        }

        (table.columns || table.fields || []).forEach(function (col) {
            var wrap = document.createElement('label');
            wrap.className = 'inv-input';
            var label = document.createElement('span');
            label.className = 'sheet-label';
            label.textContent = col.label;
            wrap.appendChild(label);

            if (col.hint || col.prompt) {
                var hint = document.createElement('span');
                hint.className = 'hint';
                hint.textContent = col.hint || col.prompt;
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
                on: dateInput ? (dateInput.value || dayISO()) : (existing ? existing.on : null),
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

    /* ------------------------------------------- taking a step out of the app */

    /*
     * A step, as text, for the person who is going to hear it.
     *
     * What goes is ticked here rather than decided for the reader, because the
     * right answer differs by step and by who is being sent it. The text is
     * shown in full before anything is copied — this is the one place in the
     * app where what is written can leave the phone, and it should never be a
     * surprise what went.
     *
     * The choices persist while the app is open, except the private one, which
     * starts off every single time.
     */
    var shareOpts = { answers: true, notes: true, work: true, everyAnswer: false, held: false };

    function openStepShare(step) {
        shareOpts.held = false;

        $('share-title').textContent = 'Step ' + step.number + ' · ' + step.shortTitle;

        var options = [
            { key: 'answers', label: 'Your answers to the questions' },
            { key: 'notes', label: 'Your notes on this step' },
            { key: 'work', label: 'The work of this step' },
            { key: 'everyAnswer', label: 'Earlier answers as well as the latest' }
        ];

        // A field the page itself keeps folded away — step five's "what I held
        // back". It is named rather than hidden, so leaving it out is a choice
        // the reader makes and can see they have made.
        var priv = Store.privateFields(step);
        if (priv.length) {
            options.push({
                key: 'held',
                label: priv.map(function (field) { return field.label; }).join(' and ') +
                    ' — folded away on the page'
            });
        }

        var holder = $('share-options');
        holder.innerHTML = '';
        options.forEach(function (option) {
            var row = document.createElement('label');
            row.className = 'row';
            var text = document.createElement('span');
            text.textContent = option.label;
            var box = document.createElement('input');
            box.type = 'checkbox';
            box.checked = !!shareOpts[option.key];
            box.dataset.key = option.key;
            box.addEventListener('change', function () {
                shareOpts[option.key] = box.checked;
                refreshShare(step);
            });
            row.appendChild(text);
            row.appendChild(box);
            holder.appendChild(row);
        });

        var send = $('share-send');
        send.hidden = !navigator.share;
        send.onclick = function () {
            navigator.share({ title: 'Step ' + step.number, text: $('share-preview').value })
                .then(function () { closeSheets(); })
                .catch(function () {});
        };

        $('share-copy').onclick = function () {
            var text = $('share-preview').value;
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(text)
                    .then(function () { closeSheets(); toast('Step ' + step.number + ' copied'); })
                    .catch(function () { toast('Could not copy'); });
            } else {
                // The preview is a real text box, so there is still a way out.
                toast('Select the text above and copy it');
            }
        };

        refreshShare(step);
        openSheet('share-sheet');
    }

    function refreshShare(step) {
        var text = Store.stepAsText(step, shareOpts);
        $('share-preview').value = text;

        var done = Store.stepProgress(step.id);
        var words = text.trim().split(/\s+/).length;
        $('share-size').textContent = done.total
            ? 'About ' + words + ' words.'
            : 'Nothing has been written on this step yet — only its wording would go.';
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
                          meeting: 'Meeting', steps: 'Steps', own: 'Reflections' };

    var EMPTY_COPY = {
        all: 'No notes yet. While reading, tap any paragraph and choose <strong>Add note</strong> — ' +
             'or tap <strong>+</strong> above for something the book did not put there.',
        sponsor: 'Nothing waiting for your sponsor. Tap <strong>+</strong> to put something on the list, ' +
                 'or mark a note for them while you are reading.',
        sponsee: 'Nothing waiting for your sponsee. Tap <strong>+</strong> to put something on the list, ' +
                 'or mark a note for them while you are reading.',
        meeting: 'Nothing waiting for a meeting. Tap <strong>+</strong> to put something on the list, ' +
                 'or mark a note for one while you are reading.',
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
            meeting: Store.waitingFor('meeting'),
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
    function copyTalkList(notes, tag) {
        var heading = tag === 'meeting'
            ? 'To bring up at a meeting'
            : 'To talk about with my ' + (tag === 'sponsor' ? 'sponsor' : 'sponsee');
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
        if (['sponsor', 'sponsee', 'meeting'].indexOf(notesFilter) === -1) return;

        var waiting = notes.filter(function (note) { return !note.discussedAt; });
        if (!waiting.length) return;

        var button = document.createElement('button');
        button.className = 'btn btn-quiet btn-block';
        button.id = 'notes-copy';
        button.textContent = 'Copy this list';
        var tag = notesFilter;
        button.addEventListener('click', function () { copyTalkList(waiting, tag); });
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
            openReader(note.sectionId,
                { paraIndex: note.paraIndex, highlight: true, justLooking: true });
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
                    // The same card is used on the Notes tab and on the meeting
                    // screen, so both have to be told.
                    if (current.screen === 'meeting') renderMeeting();
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
                openReader(hit.sectionId,
                    { paraIndex: hit.paraIndex, highlight: true, justLooking: true });
            });
            results.appendChild(card);
        });
    }

    /* -------------------------------------------------------------- rules */

    /*
     * Two lists, because they are two different conversations: what you keep,
     * and what you have asked of a sponsee. Edited as text, one to a line —
     * four short lines do not need a row editor, and a textarea is quicker on a
     * phone than any number of little plus buttons.
     */
    var RULE_LISTS = {
        sponsor: { key: 'sponsorRules', title: 'Rules with my sponsor',
                   note: 'What you have agreed to keep.' },
        sponsee: { key: 'sponseeRules', title: 'Rules with my sponsee',
                   note: 'What you have asked of them.' }
    };

    var rulesEditing = 'sponsor';

    function rulesFor(which) {
        return (Store.state.settings[RULE_LISTS[which].key] || []).filter(function (rule) {
            return String(rule).trim().length > 0;
        });
    }

    function renderRules() {
        Object.keys(RULE_LISTS).forEach(function (which) {
            var rules = rulesFor(which);
            var list = $('rules-' + which + '-list');
            list.innerHTML = '';
            rules.forEach(function (rule) {
                var item = document.createElement('li');
                item.innerHTML = richText(rule);
                list.appendChild(item);
            });
            $('rules-' + which + '-empty').hidden = rules.length > 0;
        });
    }

    function openRulesSheet(which) {
        rulesEditing = which;
        $('rules-sheet-title').textContent = RULE_LISTS[which].title;
        $('rules-sheet-note').textContent = RULE_LISTS[which].note;
        $('rules-sheet-text').value = rulesFor(which).join('\n');
        openSheet('rules-sheet');
    }

    function saveRulesSheet() {
        var rules = $('rules-sheet-text').value.split('\n')
            .map(function (line) { return line.trim(); })
            .filter(function (line) { return line.length > 0; });

        var patch = {};
        patch[RULE_LISTS[rulesEditing].key] = rules;
        Store.saveSettings(patch).then(function () {
            closeSheets();
            renderRules();
        });
    }

    /* ----------------------------------------------------------- settings */

    function renderSettings() {
        var settings = Store.state.settings;
        renderRules();
        $('set-theme').value = settings.theme;
        $('set-typeface').value = settings.typeface;
        $('set-fontsize').value = settings.fontSize;
        $('set-fontsize-value').textContent = settings.fontSize + 'px';
        $('set-lineheight').value = Math.round(settings.lineHeight * 100);
        $('set-lineheight-value').textContent = settings.lineHeight.toFixed(2);
        $('set-keepawake').checked = !!settings.keepAwake;
        $('set-sober-since').value = settings.soberSince || '';
        $('set-sober-since').max = Store.todayISO();
        ['sponsor', 'sponsee', 'spouse'].forEach(function (role) {
            $('set-' + role + '-name').value = settings[role + 'Name'] || '';
            $('set-' + role + '-phone').value = settings[role + 'Phone'] || '';
        });
        $('about-version').textContent = 'v' + (global.APP_VERSION || '1.0');
        // On the folded row, so the version you are running shows without
        // opening anything — and cannot drift from what is actually running.
        $('version-history-tag').textContent = global.APP_VERSION || '1.0';

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

    // Every sheet there is, rather than a list of them. The list was a sheet
    // added later waiting to be forgotten — and a forgotten one does not close
    // behind the next, it sits open underneath it.
    function closeSheets() {
        Array.prototype.forEach.call(document.querySelectorAll('.sheet'), function (sheet) {
            sheet.hidden = true;
        });
        $('sheet-backdrop').hidden = true;
    }

    function openPaste(config) {
        $('paste-title').textContent = config.title;
        $('paste-hint').textContent = config.hint || '';
        // Editing something already written has to arrive with it in the box;
        // without this an "edit" would quietly start from blank.
        $('paste-body').value = config.value || '';
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
        $('tab-version').textContent = 'v' + (global.APP_VERSION || '1.0');

        Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (tab) {
            tab.addEventListener('click', function () { showScreen(tab.dataset.screen); });
        });
        Array.prototype.forEach.call(document.querySelectorAll('#shortcuts .shortcut'), function (tile) {
            tile.addEventListener('click', function () { runShortcut(tile.dataset.shortcut); });
        });
        Array.prototype.forEach.call(document.querySelectorAll('[data-goto="settings-import"]'), function (btn) {
            btn.addEventListener('click', function () { showSettingsAt('settings-import'); });
        });

        // ── the rules, and where you are in the book ───────────────────────
        Array.prototype.forEach.call(document.querySelectorAll('[data-rules]'), function (btn) {
            btn.addEventListener('click', function () { openRulesSheet(btn.dataset.rules); });
        });
        $('rules-save').addEventListener('click', saveRulesSheet);
        $('rules-cancel').addEventListener('click', closeSheets);

        Array.prototype.forEach.call(document.querySelectorAll('[data-adjust]'), function (btn) {
            btn.addEventListener('click', openContinueSheet);
        });
        $('continue-sheet-cancel').addEventListener('click', closeSheets);
        $('continue-restart').addEventListener('click', function () {
            var position = Store.state.position;
            if (!position) { closeSheets(); return; }
            Store.savePosition({ sectionId: position.sectionId, paraIndex: 0, ratio: 0 })
                .then(function () {
                    closeSheets();
                    refreshContinueCards();
                    toast('Back to the top of the chapter');
                });
        });
        $('continue-browse').addEventListener('click', function () {
            if (browsing) {
                setBrowsing(false, current.screen === 'reader');
                closeSheets();
                refreshContinueCards();
                toast('Keeping your place again.');
                return;
            }
            setBrowsing(true);
            closeSheets();
            // Somewhere is the point of it, so the contents is where this goes.
            if (current.screen !== 'reader') showScreen('library');
            toast('Nothing will be saved while you read.');
        });
        $('browsing-off').addEventListener('click', function () {
            setBrowsing(false, true);
            refreshContinueCards();
            toast('Keeping your place again.');
        });
        $('continue-forget').addEventListener('click', function () {
            Store.clearPosition().then(function () {
                closeSheets();
                refreshContinueCards();
                toast('Forgotten. The book starts from the beginning again.');
            });
        });

        // ── a meeting ──────────────────────────────────────────────────────
        $('meeting-back').addEventListener('click', function () { showScreen('home'); });
        $('meeting-write').addEventListener('click', function () {
            openNoteSheet(null, null, null, { tag: 'meeting' });
        });
        $('meeting-add').addEventListener('click', function () { openMeetingSheet(null); });
        $('meeting-sheet-shared').addEventListener('click', function () {
            setMeetingShared(this.dataset.shared !== 'yes');
        });
        $('meeting-sheet-save').addEventListener('click', saveMeetingSheet);
        $('meeting-sheet-cancel').addEventListener('click', function () {
            meetingEditing = null;
            closeSheets();
        });
        $('meeting-sheet-delete').addEventListener('click', function () {
            if (!meetingEditing) return;
            if (!confirm('Delete this one? It comes off the count as well.')) return;
            Store.deleteMeeting(meetingEditing.id).then(function () {
                meetingEditing = null;
                closeSheets();
                renderMeeting();
            });
        });

        // ── a craving ──────────────────────────────────────────────────────
        $('craving-back').addEventListener('click', function () { showScreen('home'); });

        $('craving-start').addEventListener('click', function () {
            Store.startCraving().then(renderCraving);
        });

        // One tap for the usual ending, because in the middle of one nobody
        // wants a form. The sheet is there for when there is more to say.
        $('craving-passed').addEventListener('click', function () {
            var open = Store.openCraving();
            if (!open) return;
            Store.endCraving(open.id, { outcome: 'passed' }).then(function () {
                renderCraving();
                toast('That is one more that passed.');
            });
        });

        $('craving-how').addEventListener('click', function () {
            var open = Store.openCraving();
            if (open) openCravingSheet(open);
        });

        $('craving-write').addEventListener('click', function () {
            openNoteSheet(null, null, null, { tag: 'sponsor' });
        });

        $('craving-chapter').addEventListener('click', function () {
            openReader('ch03', { paraIndex: 0 });
        });

        Array.prototype.forEach.call(document.querySelectorAll('#craving-outcome .chip'), function (chip) {
            chip.addEventListener('click', function () { setCravingOutcome(chip.dataset.outcome); });
        });
        $('craving-sheet-save').addEventListener('click', saveCravingSheet);
        $('craving-sheet-cancel').addEventListener('click', function () {
            cravingEditing = null;
            closeSheets();
        });
        $('craving-sheet-delete').addEventListener('click', function () {
            if (!cravingEditing) return;
            if (!confirm('Delete this record? The list is worth more whole than tidy.')) return;
            Store.deleteCraving(cravingEditing.id).then(function () {
                cravingEditing = null;
                closeSheets();
                renderCraving();
            });
        });

        $('reader-back').addEventListener('click', function () {
            var from = current.readerFrom;
            if (from === 'step' && current.readerFromStep) { openStep(current.readerFromStep); return; }
            showScreen(from && from !== 'reader' ? from : 'library');
        });
        $('step-back').addEventListener('click', function () { showScreen('steps'); });
        $('step-copy').addEventListener('click', function () {
            var step = Store.getStep(current.stepId);
            if (step) openStepShare(step);
        });
        $('share-cancel').addEventListener('click', closeSheets);
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
        $('daycount').addEventListener('click', function () {
            showSettingsAt('settings-abstinence');
        });
        $('set-sober-since').addEventListener('change', function () {
            Store.saveSettings({ soberSince: this.value });
        });
        ['sponsor', 'sponsee', 'spouse'].forEach(function (role) {
            $('set-' + role + '-name').addEventListener('change', function () {
                var patch = {};
                patch[role + 'Name'] = this.value.trim();
                Store.saveSettings(patch);
            });
            $('set-' + role + '-phone').addEventListener('change', function () {
                var patch = {};
                patch[role + 'Phone'] = this.value.trim();
                Store.saveSettings(patch);
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
                renderLibrary();
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
            if (current.screen === 'reader') showScreen(current.readerFrom || 'library');
        });

        if (global.matchMedia) {
            global.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function () {
                if (Store.state.settings.theme === 'auto') applySettings();
            });
        }

        document.addEventListener('visibilitychange', function () {
            if (document.visibilityState === 'visible') {
                if (current.screen === 'reader') requestWakeLock();
                // A phone left open overnight would otherwise wake up showing
                // yesterday — the wrong time, the passage for a day that has
                // been and gone, and a day of its own not counted.
                Store.recordVisit().then(function () {
                    if (current.screen === 'home') renderHome();
                });
            } else {
                stopClock();
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
