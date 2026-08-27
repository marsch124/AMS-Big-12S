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
    check('all twelve are written, none left as a stub',
        (await page.$$eval('.step-item.is-stub', (e) => e.length)) === 0,
        (await page.$$eval('.step-item.is-stub', (e) => e.length)) + ' stubs');
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
    await page.click('.step-item >> nth=11');
    await page.waitForSelector('#screen-step.is-active');
    check('the last step is written, not a stub',
        !(await page.isVisible('#step-stub')) &&
        (await page.textContent('#step-quote')).startsWith('Having had a spiritual experience') &&
        (await page.$$eval('.ref-item', (e) => e.length)) === 7);

    // step twelve is the only one pointing outside How It Works and Into
    // Action, so it is what proves a cross-chapter reference still lands
    await page.click('.ref-item >> nth=6');
    await page.waitForSelector('#screen-reader.is-active');
    check('a reference into another chapter still lands on its paragraph',
        (await page.textContent('#reader-title')) === 'A Vision For You' &&
        (await page.$eval('.para.is-target', (e) => e.textContent))
            .startsWith('Abandon yourself to God'),
        await page.textContent('#reader-title'));
    await page.click('#reader-back');
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

    // ── step four's inventory ─────────────────────────────────────────────
    await page.click('.tab[data-screen="steps"]');
    await page.click('.step-item >> nth=3');
    await page.waitForSelector('#screen-step.is-active');
    check('step four carries its three tables',
        (await page.isVisible('#step-work')) &&
        (await page.$$eval('.inv-table', (e) => e.length)) === 3,
        (await page.$$eval('.inv-title', (e) =>
            e.map((x) => x.textContent.replace(/\d+$/, '').trim()))).join(' / '));

    // A step whose work module has no renderer yet shows no work section at all,
    // rather than an empty one. Step twelve (people-worked-with) is the last one
    // unbuilt; when it is built this check has nowhere left to point, and only
    // then should it go.
    await page.click('#step-back');
    await page.click('.step-item >> nth=11');
    await page.waitForSelector('#screen-step.is-active');
    check('a step whose work is not built yet shows no work section',
        (await page.textContent('#step-title')) === 'Step 12' &&
        !(await page.isVisible('#step-work')),
        await page.textContent('#step-title'));
    await page.click('#step-back');
    await page.click('.step-item >> nth=3');
    await page.waitForSelector('#screen-step.is-active');

    await page.click('.inv-table >> nth=0 >> .btn:has-text("Add the first")');
    await page.waitForSelector('#inv-sheet:not([hidden])');
    check('the editor offers the columns the book names',
        (await page.$$eval('#inv-sheet-fields .sheet-label', (e) =>
            e.map((x) => x.textContent))).join('|') ===
        "I'm resentful at|The cause|Affects my|Where I was to blame");

    // an entry with nothing in it is refused: a blank card in a list whose
    // point is evidence is worse than no card
    await page.click('#inv-save');
    check('an empty entry is refused', await page.isVisible('#inv-sheet'));

    const cells = await page.$$('#inv-sheet-fields textarea');
    await cells[0].fill('My employer');
    await cells[1].fill('Threatens to fire me for drinking and padding my expense account.');
    await cells[2].fill('Self-esteem, security.');
    await cells[3].fill('I was dishonest about the expenses, and frightened of being found out.');
    await page.click('#inv-save');
    await page.waitForSelector('#inv-sheet', { state: 'hidden' });

    check('the entry is kept, and counted on its table',
        (await page.$$eval('.inv-card', (e) => e.length)) === 1 &&
        (await page.$eval('.inv-count', (e) => e.textContent)) === '1');

    await page.click('.inv-table >> nth=0 >> .inv-view:has-text("Read back")');
    await page.waitForSelector('.inv-grid');
    check('reading back lays the same row out in columns',
        (await page.$$eval('.inv-grid th', (e) => e.length)) === 4 &&
        (await page.$$eval('.inv-grid tbody tr', (e) => e.length)) === 1);

    // four columns cannot fit a phone: the grid scrolls, the page must not
    const box = await page.$eval('.inv-gridwrap', (e) =>
        ({ scroll: e.scrollWidth, client: e.clientWidth }));
    check('the grid scrolls inside its own box', box.scroll > box.client,
        box.scroll + ' > ' + box.client);
    check('and the page itself never scrolls sideways',
        await page.evaluate(() =>
            document.documentElement.scrollWidth <= document.documentElement.clientWidth));
    check('with the off-screen columns admitted to',
        await page.isVisible('.inv-scrollhint'));

    await page.reload({ waitUntil: 'networkidle' });
    await page.click('.tab[data-screen="steps"]');
    await page.click('.step-item >> nth=3');
    await page.waitForSelector('#screen-step.is-active');
    check('the inventory survives a reload',
        (await page.$$eval('.inv-card', (e) => e.length)) === 1);

    const withRows = JSON.parse(await page.evaluate(() =>
        Backup.serialize({ includeBookText: false })));
    check('a backup carries the inventory',
        withRows.inventory.length === 1 &&
        withRows.inventory[0].values.who === 'My employer',
        JSON.stringify(withRows.inventory[0].values.cause).slice(0, 40));

    // the new-phone path again, this time for the tables
    await page.evaluate(async () => { await DB.clear(DB.STORE_INVENTORY); });
    await page.reload({ waitUntil: 'networkidle' });
    await page.click('.tab[data-screen="steps"]');
    await page.click('.step-item >> nth=3');
    check('wiping clears the inventory',
        (await page.$$eval('.inv-card', (e) => e.length)) === 0);

    const invSummary = await page.evaluate(async (json) =>
        Backup.restoreBackup(Backup.parseBackup(json), 'replace'),
        JSON.stringify(withRows));
    check('restore reports the rows it brought back', invSummary.inventory === 1,
        JSON.stringify(invSummary));
    await page.reload({ waitUntil: 'networkidle' });
    await page.click('.tab[data-screen="steps"]');
    await page.click('.step-item >> nth=3');
    await page.waitForSelector('#screen-step.is-active');
    check('and the row is back, with every column intact',
        (await page.$$eval('.inv-card .inv-value', (e) =>
            e.map((x) => x.textContent))).length === 4);

    // a backup written before the tables existed must not empty them
    const legacy = Object.assign({}, withRows);
    delete legacy.inventory;
    const legacySummary = await page.evaluate(async (json) =>
        Backup.restoreBackup(Backup.parseBackup(json), 'merge'), JSON.stringify(legacy));
    check('an older backup with no inventory restores without wiping one',
        legacySummary.inventory === 0);
    await page.reload({ waitUntil: 'networkidle' });
    await page.click('.tab[data-screen="steps"]');
    await page.click('.step-item >> nth=3');
    await page.waitForSelector('#screen-step.is-active');
    check('the rows already on the device survived that',
        (await page.$$eval('.inv-card', (e) => e.length)) === 1);
    await page.click('#step-back');
    await page.waitForSelector('#screen-steps.is-active');

    // ── steps eight and nine: one list, seen twice ────────────────────────
    const toStep = async (i) => {
        await page.click('.tab[data-screen="steps"]');
        await page.waitForSelector('#screen-steps.is-active');
        await page.click('.step-item >> nth=' + i);
        await page.waitForSelector('#screen-step.is-active');
    };

    await toStep(8);
    check('step nine says so when step eight has no list yet',
        (await page.textContent('#step-work-body')).indexOf('Step eight') !== -1);

    // a name in step four's conduct pass should be offered to step eight
    await toStep(3);
    await page.click('.inv-table >> nth=2 >> .btn:has-text("Add the first")');
    await page.waitForSelector('#inv-sheet:not([hidden])');
    let boxes = await page.$$('#inv-sheet-fields textarea');
    await boxes[0].fill('Took money from the till');
    await boxes[1].fill('Robert at the shop');
    await boxes[2].fill('Dishonesty');
    await boxes[3].fill('Owned up, years late');
    await page.click('#inv-save');
    await page.waitForSelector('#inv-sheet', { state: 'hidden' });

    await toStep(7);
    check('step eight offers the names step four already knows',
        !!(await page.$('button:has-text("Carry over")')));
    await page.click('button:has-text("Carry over")');
    await page.waitForTimeout(300);
    check('and carries them onto the list',
        (await page.$$eval('.inv-card', (e) => e.length)) === 1 &&
        (await page.textContent('.inv-cards')).indexOf('Robert at the shop') !== -1);

    await page.click('.btn:has-text("Add another")');
    await page.waitForSelector('#inv-sheet:not([hidden])');
    boxes = await page.$$('#inv-sheet-fields textarea');
    await boxes[0].fill('Anna');
    await boxes[1].fill('Years of broken promises, and the money.');
    await page.click('.chip:has-text("Willing")');
    await page.click('#inv-save');
    await page.waitForSelector('#inv-sheet', { state: 'hidden' });
    check('a name is kept with where the willingness stands',
        (await page.$$eval('.inv-card', (e) => e.length)) === 2 &&
        (await page.textContent('.inv-state')) === 'Willing');

    await toStep(8);
    check('step nine reads step eight\u2019s list rather than a list of its own',
        (await page.$$eval('.inv-card', (e) => e.length)) === 2);

    await page.click('.inv-card >> nth=1');
    await page.waitForSelector('#inv-sheet:not([hidden])');
    check('and opens the entry under the name step eight gave it',
        (await page.textContent('#inv-sheet-title')) === 'Anna');
    // the list belongs to step eight; step nine records against it, never removes
    check('step nine cannot delete a name off the list',
        await page.$eval('#inv-delete', (e) => e.hidden));

    await page.click('.chip:has-text("Made")');
    const outcome = await page.$$('#inv-sheet-fields textarea');
    await outcome[0].fill('Sat down on the Sunday. Not resolved, but said.');
    await page.fill('#inv-date', '2026-08-16');
    await page.click('#inv-save');
    await page.waitForSelector('#inv-sheet', { state: 'hidden' });
    check('step nine records what happened, and counts it',
        (await page.textContent('#step-work-body')).indexOf('1 of 2') !== -1);
    check('with the date the reader chose, not the day they typed it',
        /2026/.test(await page.textContent('.inv-cards')));

    // the whole point of the design: two steps, two states, one row
    const shared = await page.evaluate(() =>
        Store.state.inventory.filter((r) => r.stepId === 'step08' && r.values.who === 'Anna')[0]);
    check('both steps\u2019 states sit on one row, neither overwriting the other',
        shared.states.step08 === 'willing' && shared.states.step09 === 'made' &&
        shared.on === '2026-08-16' && !!shared.values.harm && !!shared.values.outcome,
        JSON.stringify(shared.states));
    check('and step nine did not create a second row',
        (await page.evaluate(() =>
            Store.state.inventory.filter((r) => r.stepId === 'step09').length)) === 0);

    await toStep(7);
    check('step eight\u2019s willingness survived step nine writing to the row',
        (await page.textContent('.inv-state')) === 'Willing');

    await page.reload({ waitUntil: 'networkidle' });
    await toStep(8);
    check('the amends list survives a reload with its progress',
        (await page.$$eval('.inv-card', (e) => e.length)) === 2 &&
        (await page.textContent('#step-work-body')).indexOf('1 of 2') !== -1);

    const amendsBackup = JSON.parse(await page.evaluate(() =>
        Backup.serialize({ includeBookText: false })));
    const amendRow = amendsBackup.inventory.filter((r) => r.states && r.states.step09)[0];
    check('a backup carries the states and the chosen date',
        !!amendRow && amendRow.states.step08 === 'willing' && amendRow.on === '2026-08-16');

    await page.evaluate(async () => { await DB.clear(DB.STORE_INVENTORY); });
    await page.evaluate(async (json) =>
        Backup.restoreBackup(Backup.parseBackup(json), 'replace'), JSON.stringify(amendsBackup));
    await page.reload({ waitUntil: 'networkidle' });
    await toStep(8);
    check('and a restore brings the progress back, not just the names',
        (await page.textContent('#step-work-body')).indexOf('1 of 2') !== -1 &&
        (await page.$$eval('.inv-card', (e) => e.length)) === 2);
    await page.click('#step-back');
    await page.waitForSelector('#screen-steps.is-active');

    // ── steps ten and eleven: a practice, not a list ──────────────────────
    const dayBack = (n) => {
        const d = new Date();
        d.setDate(d.getDate() - n);
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') +
            '-' + String(d.getDate()).padStart(2, '0');
    };

    await toStep(9);
    check('step ten shows the last fortnight',
        (await page.$$eval('.day-cell', (e) => e.length)) === 14 &&
        (await page.textContent('#step-work-body')).indexOf('Nothing written yet') !== -1);

    await page.click('.btn:has-text("Today")');
    await page.waitForSelector('#inv-sheet:not([hidden])');
    check('the four watchwords are offered',
        (await page.$$eval('#inv-sheet-fields .chip', (e) => e.map((x) => x.textContent)))
            .join('/') === 'Selfish/Dishonest/Resentful/Afraid');

    // more than one can be true on the same day, which is why these are not a
    // state — a state holds one answer
    await page.click('.chip:has-text("Resentful")');
    await page.click('.chip:has-text("Afraid")');
    let dayBoxes = await page.$$('#inv-sheet-fields textarea');
    await dayBoxes[0].fill('Snapped at the man in the car park.');
    await page.click('#inv-save');
    await page.waitForSelector('#inv-sheet', { state: 'hidden' });
    check('a day keeps more than one watchword at once',
        (await page.$$eval('.flag', (e) => e.map((x) => x.textContent))).join('+') ===
        'Resentful+Afraid');
    check('and the day is marked done in the strip',
        (await page.$$eval('.day-cell.is-done', (e) => e.length)) === 1);
    check('a run of one reads as one',
        (await page.textContent('.inv-prompt')).indexOf('1 day running') !== -1,
        await page.textContent('.inv-prompt'));

    // writing a past day through the strip
    await page.click('.day-cell[title="' + dayBack(1) + '"]');
    await page.waitForSelector('#inv-sheet:not([hidden])');
    dayBoxes = await page.$$('#inv-sheet-fields textarea');
    await dayBoxes[0].fill('Quiet one.');
    await page.click('#inv-save');
    await page.waitForSelector('#inv-sheet', { state: 'hidden' });
    check('a past day can be filled in from the strip, and extends the run',
        (await page.textContent('.inv-prompt')).indexOf('2 days running') !== -1,
        await page.textContent('.inv-prompt'));

    // the run must not collapse to nothing simply because today is not written
    // yet — that would make the record a reprimand every morning
    await page.evaluate(async (today) => {
        const row = Store.state.inventory.filter((r) => r.stepId === 'step10' && r.on === today)[0];
        if (row) await Store.deleteInventoryRow(row.id);
    }, dayBack(0));
    await toStep(9);
    check('yesterday still counts as a run before today is written',
        (await page.textContent('.inv-prompt')).indexOf('1 day running') !== -1,
        await page.textContent('.inv-prompt'));

    await toStep(10);
    await page.click('.btn:has-text("Today")');
    await page.waitForSelector('#inv-sheet:not([hidden])');
    check('step eleven offers its three parts, and no watchwords',
        (await page.$$eval('#inv-sheet-fields .sheet-label', (e) => e.map((x) => x.textContent)))
            .join('/') === 'Morning/The pause/Evening' &&
        (await page.$$eval('#inv-sheet-fields .chip', (e) => e.length)) === 0);

    const parts = await page.$$('#inv-sheet-fields textarea');
    await parts[0].fill('Asked to be free of the meeting at eleven.');
    await parts[2].fill('Resentful about it. Could have listened.');
    await page.click('#inv-save');
    await page.waitForSelector('#inv-sheet', { state: 'hidden' });
    check('a part-filled day saves, without demanding all three',
        (await page.$$eval('.day-card', (e) => e.length)) === 1);

    check('ten and eleven keep their own days apart',
        await page.evaluate(() =>
            Store.state.inventory.filter((r) => r.stepId === 'step10').length === 1 &&
            Store.state.inventory.filter((r) => r.stepId === 'step11').length === 1));

    const dailyBackup = JSON.parse(await page.evaluate(() =>
        Backup.serialize({ includeBookText: false })));
    check('a backup carries the daily entries with their dates',
        dailyBackup.inventory.filter((r) => r.stepId === 'step11' && r.on).length === 1);

    await page.reload({ waitUntil: 'networkidle' });
    await toStep(10);
    check('the practice survives a reload',
        (await page.$$eval('.day-card', (e) => e.length)) === 1);
    await page.click('#step-back');
    await page.waitForSelector('#screen-steps.is-active');

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

    await page.click('.step-item >> nth=9');
    check('every step takes a journal entry, written or not',
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

    // ── step six: the defects step four named ─────────────────────────────
    // Seeded through the store: the same fault written twice, and once written
    // into two different tables. Counts are asserted per defect rather than as
    // a total, because step four's own tests put rows in first.
    await page.evaluate(async () => {
        const rows = [
            { tableId: 'resentments', values: { who: 'My brother', cause: 'The house',
                affects: 'Pride', part: 'Impatience' } },
            { tableId: 'resentments', values: { who: 'Old boss', cause: 'Passed over',
                affects: 'Security', part: 'impatience' } },
            { tableId: 'conduct', values: { what: 'Snapped at her', whom: 'My wife',
                fault: 'Impatience', instead: 'Waited' } },
            // A fears row, whose columns step six is not told to read.
            { tableId: 'fears', values: { fear: 'ZZQ-FEAR-MARKER', why: 'ZZQ-WHY-MARKER' } }
        ];
        for (const r of rows) await Store.saveInventoryRow(Object.assign({ stepId: 'step04' }, r));
    });

    await page.click('.tab[data-screen="steps"]');
    await page.click('.step-item >> nth=5');
    await page.waitForSelector('#screen-step.is-active');
    check('step six now has its work section', await page.isVisible('#step-work'));

    const defects = await page.$$eval('.defect', (els) => els.map((e) => ({
        text: e.querySelector('.defect-text').textContent,
        from: e.querySelector('.defect-from').textContent
    })));
    const impatience = defects.filter((d) => d.text.toLowerCase() === 'impatience');
    check('the same defect written several times is asked about once',
        impatience.length === 1, impatience.length + ' entries for it');
    check('and says where it came from, across both tables',
        impatience[0].from.indexOf('Resentments') !== -1 &&
        impatience[0].from.indexOf('Conduct') !== -1 &&
        impatience[0].from.indexOf('written 3 times') !== -1,
        impatience[0].from);
    // Named with markers rather than a phrase: step four's own tests legitimately
    // write "frightened of being found out" into the part column, which step six
    // is right to carry, and a looser assertion caught that instead.
    check('a table step six is not told to read is left out',
        !defects.some((d) => d.text.indexOf('ZZQ-') !== -1),
        defects.length + ' defects carried');

    const card = page.locator('.defect', { hasText: 'Impatience' }).first();
    await card.locator('.chip', { hasText: 'Still holding on' }).click();
    await page.waitForTimeout(250);
    check('choosing to hold on shows what the book says about it',
        (await card.locator('.defect-hint').textContent()).indexOf('not to force it') !== -1);

    await card.locator('.chip', { hasText: 'Ready' }).click();
    await page.waitForTimeout(250);
    check('a defect can move to ready',
        await card.evaluate((e) => e.classList.contains('is-answered')));
    await card.locator('.chip', { hasText: 'Ready' }).click();
    await page.waitForTimeout(250);
    check('and back to unanswered, which is not the same as ready',
        !(await card.evaluate((e) => e.classList.contains('is-answered'))));

    await card.locator('.chip', { hasText: 'Answer honestly' }).click();
    await page.waitForSelector('#paste-sheet:not([hidden])');
    check('answering is titled with the defect itself',
        (await page.textContent('#paste-title')).toLowerCase() === 'impatience');
    await page.fill('#paste-body', 'It gets me out of waiting for anyone.');
    await page.click('#paste-confirm');
    await page.waitForTimeout(300);
    check('the answer is kept against that defect',
        (await card.locator('.defect-answer').textContent()) === 'It gets me out of waiting for anyone.');

    await page.reload({ waitUntil: 'networkidle' });
    await page.click('.tab[data-screen="steps"]');
    await page.click('.step-item >> nth=5');
    await page.waitForSelector('#screen-step.is-active');
    check('the answer survives a reload',
        (await page.locator('.defect', { hasText: 'Impatience' }).first()
            .locator('.defect-answer').textContent()) === 'It gets me out of waiting for anyone.');
    await page.click('#step-back');

    // ── step five: a record of the telling ────────────────────────────────
    await page.click('.tab[data-screen="steps"]');
    await page.click('.step-item >> nth=4');
    await page.waitForSelector('#screen-step.is-active');
    check('step five now has its work section', await page.isVisible('#step-work'));

    await page.click('#step-work-body .btn');
    await page.waitForSelector('#inv-sheet:not([hidden])');
    check('a sitting is dated by when it happened, not when it was typed up',
        (await page.$$eval('#inv-sheet-fields input[type=date]', (e) => e.length)) === 1 &&
        (await page.$eval('#inv-sheet-fields .sheet-label', (e) => e.textContent)) === 'Sat down on');
    await page.fill('#inv-sheet-fields input[type=date]', '2025-11-02');
    let sitFields = await page.$$('#inv-sheet-fields textarea');
    await sitFields[0].fill('My sponsor, at his kitchen table.');
    await sitFields[1].fill('The whole resentment column, then the fears.');
    await sitFields[2].fill('One thing about money I skated over.');
    await page.click('#inv-save');
    await page.waitForTimeout(300);
    check('the sitting is kept', (await page.$$eval('.sitting', (e) => e.length)) === 1 &&
        (await page.textContent('.sitting-when')) === 'Nov 2, 2025');

    check('what was held back is folded away, not on screen at a glance',
        !(await page.isVisible('.sitting-held-text')) &&
        (await page.textContent('.sitting-held-toggle')) === 'What you held back');
    await page.click('.sitting-held-toggle');
    await page.waitForTimeout(200);
    check('and opens when asked for', await page.isVisible('.sitting-held-text'));

    // going back later is a second sitting, not an edit of the first
    await page.click('#step-work-body .btn');
    await page.waitForSelector('#inv-sheet:not([hidden])');
    await page.fill('#inv-sheet-fields input[type=date]', '2026-01-20');
    sitFields = await page.$$('#inv-sheet-fields textarea');
    await sitFields[0].fill('Same sponsor, went back.');
    await sitFields[1].fill('The bit I left out.');
    await page.click('#inv-save');
    await page.waitForTimeout(300);
    check('a later sitting is a second entry, ordered by the day it happened',
        JSON.stringify(await page.$$eval('.sitting-when', (e) => e.map((x) => x.textContent))) ===
        JSON.stringify(['Jan 20, 2026', 'Nov 2, 2025']));
    check('a sitting with nothing held back grows no toggle',
        (await page.$$eval('.sitting-held-toggle', (e) => e.length)) === 1);

    await page.reload({ waitUntil: 'networkidle' });
    await page.click('.tab[data-screen="steps"]');
    await page.click('.step-item >> nth=4');
    await page.waitForSelector('#screen-step.is-active');
    check('sittings survive a reload, with the held-back field closed again',
        (await page.$$eval('.sitting', (e) => e.length)) === 2 &&
        !(await page.isVisible('.sitting-held-text')));
    await page.click('#step-back');

    // ── steps one and two: two lists side by side ─────────────────────────
    await page.click('.tab[data-screen="steps"]');
    await page.click('.step-item >> nth=0');           // step 1
    await page.waitForSelector('#screen-step.is-active');
    check('step one now has its work section', await page.isVisible('#step-work'));
    check('both lists are offered, with their own titles',
        JSON.stringify(await page.$$eval('.listpanel-title', (e) =>
            e.map((x) => x.textContent.trim().replace(/\s*\d+$/, '')))) ===
        JSON.stringify(['Powerless over alcohol', 'Life unmanageable']));

    await page.click('.listpanel >> nth=0 >> .listpanel-add');
    await page.waitForSelector('#paste-sheet:not([hidden])');
    await page.fill('#paste-body', 'Meant to have two, woke up on the sofa.');
    await page.click('#paste-confirm');
    await page.waitForTimeout(250);
    check('an item can be added to a list',
        (await page.$$eval('.listpanel >> nth=0 >> .listitem', (e) => e.length)) === 1);

    await page.click('.listpanel >> nth=0 >> .listpanel-add');
    await page.waitForSelector('#paste-sheet:not([hidden])');
    await page.fill('#paste-body', '   ');
    await page.click('#paste-confirm');
    await page.waitForTimeout(250);
    check('a blank item is refused, in a list whose point is evidence',
        (await page.$$eval('.listpanel >> nth=0 >> .listitem', (e) => e.length)) === 1);

    const whenBefore = await page.textContent('.listpanel >> nth=0 >> .listitem-when');
    await page.click('.listpanel >> nth=0 >> .listitem >> nth=0 >> .chip:has-text("Move across")');
    await page.waitForTimeout(300);
    check('an item can move across, which is what step two is for',
        (await page.$$eval('.listpanel >> nth=0 >> .listitem', (e) => e.length)) === 0 &&
        (await page.$$eval('.listpanel >> nth=1 >> .listitem', (e) => e.length)) === 1);
    check('and keeps the date it was first written, not the date it moved',
        (await page.textContent('.listpanel >> nth=1 >> .listitem-when')) === whenBefore,
        whenBefore);

    await page.click('.listpanel >> nth=1 >> .listitem >> nth=0 >> .chip:has-text("Edit")');
    await page.waitForSelector('#paste-sheet:not([hidden])');
    check('editing an item opens with it in the box',
        (await page.inputValue('#paste-body')).indexOf('Meant to have two') === 0);
    await page.click('#paste-cancel');

    await page.click('#step-back');
    await page.click('.step-item >> nth=1');           // step 2
    await page.waitForSelector('#screen-step.is-active');
    check('step two has its own two lists, and its own items',
        JSON.stringify(await page.$$eval('.listpanel-title', (e) =>
            e.map((x) => x.textContent.trim().replace(/\s*\d+$/, '')))) ===
        JSON.stringify(['What I cannot accept yet', 'What has shifted']) &&
        (await page.$$eval('.listitem', (e) => e.length)) === 0);
    await page.click('#step-back');

    // ── steps three and seven: a dated decision ───────────────────────────
    await page.click('.tab[data-screen="steps"]');
    await page.click('.step-item >> nth=2');           // step 3
    await page.waitForSelector('#screen-step.is-active');
    check('step three now has its work section', await page.isVisible('#step-work'));
    check('the passage is shown from the book, not stored twice',
        (await page.textContent('.prayer-text')).indexOf('We were now at step three') === 0);
    check('the button says what this step does',
        (await page.textContent('.prayer-take .btn')) === 'Taken today');

    await page.click('.prayer-passage .chip');
    await page.waitForSelector('#screen-reader.is-active');
    check('and it opens at that passage in the right chapter',
        (await page.textContent('#reader-title')) === 'How It Works' &&
        (await page.$eval('.para.is-target', (e) => e.textContent).catch(() => ''))
            .indexOf('We were now at step three') === 0);
    await page.click('#reader-back');
    await page.waitForSelector('#screen-step.is-active');

    await page.click('.prayer-take .btn');
    await page.waitForTimeout(250);
    check('a taking is recorded', (await page.$$eval('.prayer-record', (e) => e.length)) === 1);
    await page.click('.prayer-take .btn');
    await page.waitForTimeout(250);
    check('the same day twice is refused, not duplicated',
        (await page.$$eval('.prayer-record', (e) => e.length)) === 1);

    // an earlier taking can be recorded, and sorts under the recent one
    await page.fill('.prayer-date', '2024-03-05');
    await page.click('.prayer-take .btn');
    await page.waitForTimeout(250);
    const takings = await page.$$eval('.prayer-when', (e) => e.map((x) => x.textContent.trim()));
    check('an earlier date can be added and sorts newest first',
        takings.length === 2 && takings[0].indexOf('most recent') > 0 &&
        takings[1].indexOf('Mar 5, 2024') === 0,
        JSON.stringify(takings));

    await page.click('.prayer-record >> nth=1 >> .chip:has-text("Add a note")');
    await page.waitForSelector('#paste-sheet:not([hidden])');
    await page.fill('#paste-body', 'Said it out loud with J.');
    await page.click('#paste-confirm');
    await page.waitForTimeout(250);
    check('a note can be kept against a taking',
        (await page.textContent('.prayer-record >> nth=1 >> .prayer-note')) === 'Said it out loud with J.');

    await page.click('.prayer-record >> nth=1 >> .chip:has-text("Edit note")');
    await page.waitForSelector('#paste-sheet:not([hidden])');
    check('editing a note opens with the note in it, not blank',
        (await page.inputValue('#paste-body')) === 'Said it out loud with J.');
    await page.click('#paste-cancel');

    // step seven is the same module with its own wording and its own dates
    await page.click('#step-back');
    await page.click('.step-item >> nth=6');
    await page.waitForSelector('#screen-step.is-active');
    check('step seven has its own passage and wording',
        (await page.textContent('.prayer-take .btn')) === 'Asked today' &&
        (await page.textContent('.prayer-text')).indexOf('When ready, we say') === 0);
    check('and keeps its own dates, separate from step three',
        (await page.$$eval('.prayer-record', (e) => e.length)) === 0);

    const prayerBackup = JSON.parse(await page.evaluate(
        () => Backup.serialize({ includeBookText: false })));
    const takenRows = (prayerBackup.inventory || []).filter((r) => r.tableId === 'prayer');
    check('a backup carries the dates',
        takenRows.length === 2 && takenRows.every((r) => !!r.on),
        takenRows.length + ' rows');

    await page.reload({ waitUntil: 'networkidle' });
    await page.click('.tab[data-screen="steps"]');
    await page.click('.step-item >> nth=2');
    await page.waitForSelector('#screen-step.is-active');
    check('the record survives a reload',
        (await page.$$eval('.prayer-record', (e) => e.length)) === 2);
    await page.click('#step-back');

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
