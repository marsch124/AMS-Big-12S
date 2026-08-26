#!/usr/bin/env node
/*
 * smoke-test.js — end-to-end checks for AMS Big 12S.
 *
 * Drives a real browser against a locally served copy of the app and asserts
 * the things that actually matter: the bundled text is complete, notes and
 * bookmarks persist, the reading position survives a reload, backups round
 * trip, and the whole book is readable with the network switched off.
 *
 *   python3 -m http.server 7802 &     # serve the repo root
 *   npm install playwright            # once
 *   node tools/smoke-test.js
 *
 * Environment:
 *   BASE_URL        default http://127.0.0.1:7802/
 *   CHROMIUM_PATH   an existing Chromium binary, if Playwright cannot find one
 *   SHOT_DIR        write screenshots here (skipped when unset)
 *
 * Exit code 0 = all checks passed, 1 = a check failed, 2 = the harness broke.
 */
const { chromium, devices } = require('playwright');
const fs = require('fs');

const BASE = process.env.BASE_URL || 'http://127.0.0.1:7802/';
const SHOT_DIR = process.env.SHOT_DIR || '';

const results = [];
function check(name, ok, detail) {
    results.push({ name, ok, detail });
    console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (detail ? '  — ' + detail : ''));
}

async function shot(page, name) {
    if (!SHOT_DIR) return;
    fs.mkdirSync(SHOT_DIR, { recursive: true });
    await page.screenshot({ path: SHOT_DIR + '/' + name });
}

(async () => {
    const browser = await chromium.launch(
        process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
    const context = await browser.newContext({ ...devices['iPhone 13'], hasTouch: true, isMobile: true });
    const page = await context.newPage();

    const errors = [];
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.waitForSelector('#screen-home.is-active');

    // ── the book ships with the app ───────────────────────────────────────
    check('app boots to home screen', true);
    check('no "import the text" notice — text is bundled', !(await page.isVisible('#import-notice')));

    const readable = await page.$$eval('.toc-item:not([disabled])', (e) => e.length);
    check('contents lists every readable section', readable === 42, readable + ' readable of 43');

    const titles = await page.$$eval('.toc-title', (e) => e.map((x) => x.textContent));
    const wanted = ['Foreword', "The Doctor's Opinion", "Bill's Story", 'There Is A Solution',
        'More About Alcoholism', 'We Agnostics', 'How It Works', 'Into Action',
        'Working With Others', 'To Wives', 'The Family Afterward', 'To Employers',
        'A Vision For You', 'The Personal Stories'];
    const missing = wanted.filter((t) => !titles.includes(t));
    check('all 11 chapters + front matter present', missing.length === 0, missing.join(', ') || 'all found');
    check('all 29 personal stories present', titles.length === 43, titles.length + ' sections');

    // ── reader ────────────────────────────────────────────────────────────
    await page.click('.toc-item:not([disabled]) >> nth=2');   // Bill's Story
    await page.waitForSelector('#screen-reader.is-active');
    check('reader opens', (await page.textContent('#reader-title')) === "Bill's Story");
    const paraCount = await page.$$eval('#reader-content .para', (e) => e.length);
    check("Bill's Story has its full text", paraCount === 74, paraCount + ' paragraphs');

    const opening = await page.textContent('#reader-content .para[data-index="0"]');
    check('opening line reads correctly', opening.startsWith('War fever ran high in the New England town'),
        JSON.stringify(opening.slice(0, 46)));

    // ── note ──────────────────────────────────────────────────────────────
    await page.click('#reader-content .para[data-index="1"]');
    await page.waitForSelector('#para-sheet:not([hidden])');
    await page.click('#para-sheet [data-action="note"]');
    await page.waitForSelector('#note-sheet:not([hidden])');
    await page.fill('#note-sheet-body', 'Come back to this one.');
    await page.click('#note-save');
    await page.waitForSelector('#note-sheet', { state: 'hidden' });
    await page.waitForSelector('#reader-content .para[data-index="1"].has-note');
    check('note saves and marks the paragraph', true);

    await page.click('#reader-content .para[data-index="2"]');
    await page.waitForSelector('#para-sheet:not([hidden])');
    await page.click('#para-sheet [data-action="bookmark"]');
    await page.waitForSelector('#reader-content .para[data-index="2"].has-bookmark');
    check('bookmark toggles on', true);

    // ── resume where you stopped ──────────────────────────────────────────
    await page.click('#reader-back');
    await page.waitForSelector('#screen-home.is-active');
    await page.click('.toc-item:not([disabled]) >> nth=6');   // How It Works
    await page.waitForSelector('#screen-reader.is-active');
    check('How It Works opens', (await page.textContent('#reader-title')) === 'How It Works');

    await page.evaluate(() => {
        const b = document.getElementById('reader-body');
        b.scrollTop = Math.floor(b.scrollHeight * 0.45);
    });
    await page.waitForTimeout(900);
    const stoppedAt = await page.evaluate(() => Store.state.position.paraIndex);

    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForSelector('#screen-home.is-active');
    await page.waitForSelector('#continue-card:not([hidden])', { timeout: 5000 });
    check('resumes the right chapter', (await page.textContent('#continue-title')) === 'How It Works');
    check('progress percentage shown', /\d+% through the book/.test(await page.textContent('#continue-meta')));

    await page.click('#continue-card');
    await page.waitForSelector('#screen-reader.is-active');
    const resumedAt = await page.evaluate(() => UI ? Store.state.position.paraIndex : -1);
    check('resumes the right paragraph, not just the chapter',
        Math.abs(resumedAt - stoppedAt) <= 1, 'stopped at ¶' + stoppedAt + ', resumed at ¶' + resumedAt);
    await page.click('#reader-back');

    // ── notes screen ──────────────────────────────────────────────────────
    await page.click('.tab[data-screen="notes"]');
    await page.waitForSelector('#screen-notes.is-active');
    check('note listed after reload', (await page.$$eval('#notes-list .card', (e) => e.length)) === 1);
    check('note quotes the passage it belongs to',
        (await page.textContent('#notes-list .card')).includes("Bill's Story"));

    await page.fill('#notes-search', 'zzzznomatch');
    await page.waitForTimeout(120);
    check('notes filter works', (await page.$$eval('#notes-list .card', (e) => e.length)) === 0);
    await page.fill('#notes-search', '');
    await page.waitForTimeout(120);

    await page.click('#notes-list .card');
    await page.waitForSelector('#screen-reader.is-active');
    check('note jumps back to its passage', (await page.textContent('#reader-title')) === "Bill's Story");
    await page.click('#reader-back');

    // ── search the real text ──────────────────────────────────────────────
    await page.click('.tab[data-screen="search"]');
    await page.fill('#search-input', 'spiritual experience');
    await page.waitForTimeout(400);
    const hits = await page.$$eval('#search-results .card', (e) => e.length);
    check('full-text search finds a real phrase', hits >= 5, hits + ' hits for "spiritual experience"');
    await page.click('#search-results .card >> nth=0');
    await page.waitForSelector('#screen-reader.is-active');
    check('search result opens the passage', true);
    await page.click('#reader-back');

    // ── the twelve steps ──────────────────────────────────────────────────
    await page.click('.tab[data-screen="steps"]');
    await page.waitForSelector('#screen-steps.is-active');
    const stepRows = await page.$$eval('.step-item', (e) => e.length);
    check('all twelve steps listed', stepRows === 12, stepRows + ' rows');
    check('unwritten steps marked as such',
        (await page.$$eval('.step-item.is-stub', (e) => e.length)) === 7,
        (await page.$$eval('.step-item.is-stub', (e) => e.length)) + ' still stubs');
    check('every step shows its wording from the book',
        (await page.$$eval('.step-line', (e) => e.map((x) => x.textContent.trim())))
            .every((t) => t.length > 8));

    await page.click('.step-item >> nth=0');
    await page.waitForSelector('#screen-step.is-active');
    check('step page opens', (await page.textContent('#step-title')) === 'Step 1');
    const quote = await page.textContent('#step-quote');
    check('step quote drops the redundant numeral',
        quote.startsWith('We admitted we were powerless'), JSON.stringify(quote.slice(0, 34)));
    check('Steps tab stays lit inside a step',
        await page.$eval('.tab[data-screen="steps"]', (e) => e.classList.contains('is-active')));
    check('references and questions render',
        (await page.$$eval('.ref-item', (e) => e.length)) === 7 &&
        (await page.$$eval('.question', (e) => e.length)) === 8);
    check('no reference failed to resolve',
        (await page.$$eval('.ref-item.is-missing', (e) => e.length)) === 0);

    // a reference must open the reader on the paragraph it names
    await page.click('.ref-item >> nth=1');
    await page.waitForSelector('#screen-reader.is-active');
    check('a reference opens its chapter',
        (await page.textContent('#reader-title')) === 'More About Alcoholism');
    const targeted = await page.$eval('.para.is-target', (e) => e.textContent).catch(() => '');
    check('and lands on the right paragraph',
        targeted.startsWith('We learned that we had to fully concede'),
        JSON.stringify(targeted.slice(0, 40)));
    // Leaving the reader returns to the step it was opened from, not the Read tab.
    await page.click('#reader-back');
    check('leaving the reader goes back to the step it was opened from',
        await page.isVisible('#screen-step.is-active') ||
        (await page.$eval('#screen-step', (e) => e.classList.contains('is-active'))));
    await page.click('#step-back');
    await page.waitForSelector('#screen-steps.is-active');

    await page.click('.tab[data-screen="steps"]');
    await page.click('.step-item >> nth=5');
    await page.waitForSelector('#screen-step.is-active');
    check('a step awaiting content says so, but still shows its wording',
        await page.isVisible('#step-stub') &&
        (await page.textContent('#step-quote')).startsWith('Were entirely ready'));
    await page.click('#step-back');
    await page.waitForSelector('#screen-steps.is-active');

    // ── backup round trip ─────────────────────────────────────────────────
    const slim = JSON.parse(await page.evaluate(() => Backup.serialize({ includeBookText: false })));
    check('backup carries notes, bookmarks, position, settings',
        slim.notes.length === 1 && slim.bookmarks.length === 1 &&
        !!slim.position.sectionId && !!slim.settings);
    check('backup stays small when the text is not included',
        !slim.includesBookText && JSON.stringify(slim).length < 4000,
        JSON.stringify(slim).length + ' bytes');

    const full = await page.evaluate(() => Backup.serialize({ includeBookText: true }));
    check('backup can carry the whole book when asked',
        JSON.parse(full).book.sections.length === 43,
        Math.round(full.length / 1024) + ' KB');

    // the new-phone path: wipe what the user made, then restore it
    await page.evaluate(async () => {
        await DB.clear(DB.STORE_NOTES);
        await DB.clear(DB.STORE_BOOKMARKS);
        await DB.remove(DB.STORE_META, 'position');
        localStorage.clear();
    });
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForSelector('#screen-home.is-active');
    await page.click('.tab[data-screen="notes"]');
    check('wipe clears the notes', (await page.$$eval('#notes-list .card', (e) => e.length)) === 0);

    const summary = await page.evaluate(async (json) =>
        Backup.restoreBackup(Backup.parseBackup(json), 'replace'), JSON.stringify(slim));
    check('restore reports what it did', summary.notes === 1 && summary.bookmarks === 1,
        JSON.stringify(summary));

    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForSelector('#screen-home.is-active');
    await page.waitForSelector('#continue-card:not([hidden])', { timeout: 5000 });
    const expectedTitle = await page.evaluate(
        (id) => Store.getSection(id).title, slim.position.sectionId);
    const restoredTitle = await page.textContent('#continue-title');
    check('position restored', restoredTitle === expectedTitle,
        'expected ' + expectedTitle + ', got ' + restoredTitle);
    await page.click('.tab[data-screen="notes"]');
    check('notes restored', (await page.$$eval('#notes-list .card', (e) => e.length)) === 1);

    const rejected = await page.evaluate(() => {
        try { Backup.parseBackup('{"app":"something else"}'); return null; }
        catch (e) { return e.message; }
    });
    check('a foreign backup is rejected clearly', !!rejected, rejected);

    // ── things to talk about ──────────────────────────────────────────────
    // A point for the sponsor that came from nowhere in particular: written
    // straight onto the Notes tab, with no passage behind it.
    await page.click('.tab[data-screen="notes"]');
    await page.waitForSelector('#screen-notes.is-active');
    await page.click('#notes-add-btn');
    await page.waitForSelector('#note-sheet:not([hidden])');
    check('a note of your own opens with no passage quoted',
        !(await page.isVisible('#note-sheet-quote')));
    await page.fill('#note-sheet-body', 'Ask about step four — how much detail is enough.');
    await page.click('#note-tags .chip[data-tag="sponsor"]');
    await page.click('#note-save');
    await page.waitForSelector('#note-sheet', { state: 'hidden' });
    check('a note with no passage saves',
        (await page.$$eval('#notes-list .card', (e) => e.length)) === 2);

    // The same thing again, but starting from a passage — a note can be both a
    // note on the text and a point for a conversation.
    await page.click('.tab[data-screen="home"]');
    await page.click('.toc-item:not([disabled]) >> nth=6');
    await page.waitForSelector('#screen-reader.is-active');
    await page.click('#reader-content .para[data-index="3"]');
    await page.waitForSelector('#para-sheet:not([hidden])');
    await page.click('#para-sheet [data-action="note"]');
    await page.waitForSelector('#note-sheet:not([hidden])');
    await page.fill('#note-sheet-body', 'How does he read this one?');
    await page.click('#note-tags .chip[data-tag="sponsee"]');
    await page.click('#note-save');
    await page.waitForSelector('#note-sheet', { state: 'hidden' });
    const flag = await page.textContent('#reader-content .para[data-index="3"] .para-flag');
    check('the page says who a passage note is waiting for', flag.includes('Sponsee'), flag.trim());
    await page.click('#reader-back');

    await page.click('.tab[data-screen="notes"]');
    await page.waitForSelector('#screen-notes.is-active');
    const chips = await page.$$eval('#notes-filters .chip', (e) => e.map((c) => c.textContent.trim()));
    check('the filters count what is still waiting',
        chips.includes('Sponsor 1') && chips.includes('Sponsee 1'), chips.join(' / '));

    await page.click('#notes-filters .chip[data-filter="sponsor"]');
    await page.waitForTimeout(150);
    check('the sponsor list holds only the sponsor point',
        (await page.$$eval('#notes-list .card', (e) => e.length)) === 1);
    check('a list can be copied out before a conversation',
        await page.isVisible('#notes-copy'));

    await page.click('#notes-list .note-card .card-actions .chip >> nth=0');
    await page.waitForTimeout(250);
    check('ticking a point off stands it down, without deleting it',
        (await page.$$eval('#notes-list .note-card.is-done', (e) => e.length)) === 1 &&
        (await page.$$eval('#notes-list .card', (e) => e.length)) === 1);
    const afterTick = await page.$$eval('#notes-filters .chip[data-filter="sponsor"]',
        (e) => e[0].textContent.trim());
    check('a point talked about stops being counted as waiting', afterTick === 'Sponsor', afterTick);

    await page.click('#notes-filters .chip[data-filter="own"]');
    await page.waitForTimeout(150);
    check('reflections are the notes that came from no page',
        (await page.$$eval('#notes-list .card', (e) => e.length)) === 1);
    await page.click('#notes-filters .chip[data-filter="all"]');
    await page.waitForTimeout(150);

    // They are notes like any other, so they travel in a backup and come back
    // through a reload.
    const talkBackup = JSON.parse(await page.evaluate(
        () => Backup.serialize({ includeBookText: false })));
    const tagged = talkBackup.notes.filter((n) => n.tag);
    const loose = talkBackup.notes.filter((n) => !n.sectionId);
    check('backups carry who a note is for, and notes with no passage',
        tagged.length === 2 && loose.length === 1 && tagged.some((n) => n.discussedAt),
        tagged.length + ' tagged, ' + loose.length + ' loose');

    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForSelector('#screen-home.is-active');
    await page.click('.tab[data-screen="notes"]');
    await page.waitForTimeout(250);
    check('everything written is still there after a reload',
        (await page.$$eval('#notes-list .card', (e) => e.length)) === 3);

    // ── the step journal ──────────────────────────────────────────────────
    await page.click('.tab[data-screen="steps"]');
    await page.click('.step-item >> nth=0');
    await page.waitForSelector('#screen-step.is-active');

    await page.click('#step-add-entry');
    await page.waitForSelector('#note-sheet:not([hidden])');
    check('a step entry is offered as an entry, not a passage note',
        (await page.textContent('#note-sheet-title')).indexOf('Step 1') === 0 &&
        (await page.getAttribute('#note-sheet-quote', 'hidden')) !== null);
    await page.fill('#note-sheet-body', 'First read of step one.');
    await page.click('#note-save');
    await page.waitForSelector('#note-sheet', { state: 'hidden' });
    check('the entry is kept against the step',
        (await page.$$eval('.entry-card', (e) => e.length)) === 1);

    await page.click('#step-add-entry');
    await page.waitForSelector('#note-sheet:not([hidden])');
    await page.fill('#note-sheet-body', 'Second pass, later.');
    await page.click('#note-save');
    await page.waitForSelector('#note-sheet', { state: 'hidden' });
    const entryBodies = await page.$$eval('.entry-card .card-body', (e) => e.map((x) => x.textContent));
    check('a later pass sits above the earlier one, not on top of it',
        entryBodies.length === 2 && entryBodies[0].indexOf('Second pass') === 0,
        entryBodies.length + ' entries');

    // A dictated note runs long; a short one must not grow a control it does not need.
    await page.click('#step-add-entry');
    await page.waitForSelector('#note-sheet:not([hidden])');
    await page.fill('#note-sheet-body',
        'Dictated on the walk home, so it rambles somewhat. '.repeat(9));
    await page.click('#note-save');
    await page.waitForSelector('#note-sheet', { state: 'hidden' });
    await page.waitForTimeout(200);

    const folded = await page.$eval('.entry-card >> nth=0', (e) => ({
        clamped: e.classList.contains('is-clamped'),
        toggle: (e.querySelector('.entry-toggle') || {}).textContent || null,
        shown: e.querySelector('.card-body').clientHeight,
        full: e.querySelector('.card-body').scrollHeight
    }));
    check('a long note is folded down, with a way to open it',
        folded.clamped && folded.toggle === 'Show all' && folded.shown < folded.full,
        folded.shown + 'px of ' + folded.full + 'px');

    await page.click('.entry-card >> nth=0 >> .card-main');
    await page.waitForTimeout(200);
    const opened = await page.$eval('.entry-card >> nth=0', (e) => ({
        clamped: e.classList.contains('is-clamped'),
        toggle: e.querySelector('.entry-toggle').textContent,
        shown: e.querySelector('.card-body').clientHeight
    }));
    check('and opens in place on a tap',
        !opened.clamped && opened.toggle === 'Show less' && opened.shown === folded.full);

    check('a short note is left alone, with no control that does nothing',
        await page.$eval('.entry-card >> nth=2', (e) =>
            !e.classList.contains('is-clamped') && !e.querySelector('.entry-toggle')));

    check('editing a note is still reachable once tapping folds it',
        await page.$eval('.entry-card >> nth=0', (e) =>
            !!e.querySelector('.card-actions .chip')));

    await page.click('#step-back');
    await page.waitForSelector('#screen-steps.is-active');
    check('the steps list counts what you have written',
        (await page.$eval('.step-item >> nth=0', (e) => {
            const pill = e.querySelector('.step-count');
            return pill ? pill.textContent : '';
        })) === '3');

    await page.click('.step-item >> nth=5');
    check('a step awaiting content still takes a journal entry',
        await page.isVisible('#step-add-entry'));
    await page.click('#step-back');

    // step entries belong to their step, not to the loose pile
    await page.click('.tab[data-screen="notes"]');
    await page.waitForSelector('#screen-notes.is-active');
    await page.click('.chip[data-filter="steps"]');
    await page.waitForTimeout(150);
    check('step entries gather under their own filter',
        (await page.$$eval('#notes-list .card', (e) => e.length)) === 3);
    check('and are headed by the step they belong to',
        (await page.$eval('#notes-list .card-where', (e) => e.textContent)) === 'Step 1 · Powerless');

    await page.click('.chip[data-filter="own"]');
    await page.waitForTimeout(150);
    // The invariant that matters is that a chip's number is of exactly what its
    // list contains — a badge saying 3 over a list of 1 is worse than no badge.
    const looseShown = await page.$$eval('#notes-list .card', (e) => e.length);
    const reflectionsChip = await page.$eval('.chip[data-filter="own"]', (e) => e.textContent.trim());
    const reflectionsCount = parseInt((reflectionsChip.match(/\d+/) || [0])[0], 10);
    const headsUnderReflections = await page.$$eval('#notes-list .card-where',
        (e) => e.map((x) => x.textContent));
    check('Reflections excludes step work, and its count agrees with its list',
        reflectionsCount === looseShown &&
        !headsUnderReflections.some((h) => h.indexOf('Step ') === 0),
        looseShown + ' shown, chip reads "' + reflectionsChip + '"');

    await page.click('.chip[data-filter="steps"]');
    await page.waitForTimeout(150);
    await page.click('#notes-list .card-main >> nth=0');
    await page.waitForSelector('#screen-step.is-active');
    check('a step entry leads back to its step', (await page.textContent('#step-title')) === 'Step 1');
    await page.click('#step-back');
    // back to Notes before touching a chip — #step-back lands on the Steps list
    await page.click('.tab[data-screen="notes"]');
    await page.waitForSelector('#screen-notes.is-active');
    await page.click('.chip[data-filter="all"]');
    await page.waitForTimeout(120);

    // ── questions and their answers ───────────────────────────────────────
    await page.click('.tab[data-screen="steps"]');
    await page.click('.step-item >> nth=0');
    await page.waitForSelector('#screen-step.is-active');
    const q0 = page.locator('.question').nth(0);
    check('the step carries its questions',
        (await page.$$eval('.question', (e) => e.length)) === 8);

    await q0.locator('.chip').nth(0).click();
    await page.waitForSelector('#note-sheet:not([hidden])');
    check('answering quotes the question, as a passage note quotes its passage',
        (await page.textContent('#note-sheet-title')).indexOf('answering') > 0 &&
        (await page.textContent('#note-sheet-quote')).indexOf('once you take the first drink') > 0);
    await page.fill('#note-sheet-body', 'It goes further than I plan, every time.');
    await page.click('#note-save');
    await page.waitForSelector('#note-sheet', { state: 'hidden' });
    check('the answer is kept against its question',
        (await q0.locator('.answer').count()) === 1);

    await q0.locator('.chip', { hasText: 'Answer again' }).click();
    await page.waitForSelector('#note-sheet:not([hidden])');
    await page.fill('#note-sheet-body', 'Second time round: still true, less argument about it.');
    await page.click('#note-save');
    await page.waitForSelector('#note-sheet', { state: 'hidden' });

    const answerBoxes = await q0.locator('.answer').all();
    const answerVisible = [];
    for (const box of answerBoxes) answerVisible.push(await box.isVisible());
    check('answering again keeps the old one, showing only the latest',
        answerBoxes.length === 2 && answerVisible[0] === true && answerVisible[1] === false,
        answerBoxes.length + ' answers, visible: ' + answerVisible.join(', '));

    await q0.locator('.chip', { hasText: '1 earlier' }).click();
    await page.waitForTimeout(150);
    const answerOrder = await q0.locator('.answer .answer-body').allTextContents();
    check('earlier answers open, newest first',
        answerOrder.length === 2 && answerOrder[0].indexOf('Second time') === 0);

    // putting a question away must not touch what was written against it
    await page.locator('.question').nth(1).locator('.chip', { hasText: 'Put away' }).click();
    await page.waitForTimeout(200);
    check('a question can be put away',
        (await page.$$eval('.question', (e) => e.length)) === 7 &&
        (await page.textContent('#step-show-hidden')) === '1 put away');
    await page.click('#step-show-hidden');
    await page.waitForTimeout(150);
    await page.click('.hidden-q .chip');
    await page.waitForTimeout(200);
    check('and brought back again',
        (await page.$$eval('.question', (e) => e.length)) === 8);

    await page.click('#step-add-question');
    await page.waitForSelector('#paste-sheet:not([hidden])');
    await page.fill('#paste-body', 'What would my sponsor say I am still dodging?');
    await page.click('#paste-confirm');
    await page.waitForTimeout(250);
    check('a question of your own can be added',
        (await page.$$eval('.question', (e) => e.length)) === 9 &&
        (await page.$$eval('.question-own', (e) => e.length)) === 1);

    await page.reload({ waitUntil: 'networkidle' });
    await page.click('.tab[data-screen="steps"]');
    await page.click('.step-item >> nth=0');
    await page.waitForSelector('#screen-step.is-active');
    check('questions and answers survive a reload',
        (await page.$$eval('.question', (e) => e.length)) === 9 &&
        (await page.locator('.question').nth(0).locator('.answer').count()) === 2);

    const prefsBackup = JSON.parse(await page.evaluate(
        () => Backup.serialize({ includeBookText: false })));
    check('a backup carries answers and the questions you changed',
        prefsBackup.notes.filter((n) => n.questionId).length === 2 &&
        !!prefsBackup.stepPrefs &&
        Object.keys(prefsBackup.stepPrefs.custom.step01 || {}).length === 1,
        prefsBackup.notes.filter((n) => n.questionId).length + ' answers');

    // step entries are notes, so they must ride the backup like any other
    const stepBackup = JSON.parse(await page.evaluate(
        () => Backup.serialize({ includeBookText: false })));
    // A step's notes and its answers both carry stepId; only an answer carries a
    // questionId, and the two must not be counted as each other.
    const carried = stepBackup.notes.filter((n) => n.stepId === 'step01' && !n.questionId);
    const carriedAnswers = stepBackup.notes.filter((n) => n.stepId === 'step01' && n.questionId);
    check('a backup carries step notes and answers, told apart',
        carried.length === 3 && carriedAnswers.length === 2 &&
        carried.every((n) => !n.sectionId),
        carried.length + ' notes, ' + carriedAnswers.length + ' answers');

    // ── appearance ────────────────────────────────────────────────────────
    await page.click('.tab[data-screen="settings"]');
    await page.selectOption('#set-theme', 'dark');
    await page.waitForTimeout(150);
    check('theme switches', (await page.getAttribute('html', 'data-theme')) === 'dark');
    await page.selectOption('#set-theme', 'sepia');
    check('settings shows what text is loaded',
        (await page.textContent('#book-status')).includes('First Edition (1939)'));

    // ── offline ───────────────────────────────────────────────────────────
    await page.waitForTimeout(500);
    check('service worker registers',
        await page.evaluate(() => navigator.serviceWorker.ready.then(() => true).catch(() => false)));
    await context.setOffline(true);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#screen-home.is-active', { timeout: 10000 });
    const offlineReadable = await page.$$eval('.toc-item:not([disabled])', (e) => e.length);
    check('whole book readable with the network off', offlineReadable === 42,
        offlineReadable + ' sections offline');
    await page.click('.toc-item:not([disabled]) >> nth=6');
    await page.waitForSelector('#screen-reader.is-active');
    const offlinePara = await page.textContent('#reader-content .para[data-index="0"]');
    check('offline text is the real text',
        offlinePara.startsWith('Rarely have we seen a person fail'),
        JSON.stringify(offlinePara.slice(0, 42)));
    await context.setOffline(false);

    // ── screenshots ───────────────────────────────────────────────────────
    await page.waitForTimeout(300);
    await shot(page, 'shot-reader.png');
    await page.click('#reader-back');
    await page.waitForTimeout(250);
    await shot(page, 'shot-home.png');
    await page.click('.tab[data-screen="search"]');
    await page.fill('#search-input', 'gratitude');
    await page.waitForTimeout(400);
    await shot(page, 'shot-search.png');

    check('no uncaught page errors', errors.length === 0, errors.slice(0, 3).join(' | '));

    await browser.close();

    const failed = results.filter((r) => !r.ok);
    console.log('\n' + (results.length - failed.length) + '/' + results.length + ' checks passed');
    if (failed.length) {
        console.log('FAILURES:');
        failed.forEach((f) => console.log('  - ' + f.name + (f.detail ? ': ' + f.detail : '')));
        process.exit(1);
    }
})().catch((e) => { console.error('HARNESS ERROR:', e); process.exit(2); });
