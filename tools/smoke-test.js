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

/* The app opens on the home screen, so anything that wants the table of
 * contents has to ask for the Read tab first. */
async function openContents(page) {
    await page.click('.tab[data-screen="library"]');
    await page.waitForSelector('#screen-library.is-active');
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

    // ── the home screen ───────────────────────────────────────────────────
    check('app boots to the home screen, not into the book', true);

    const clock = await page.textContent('#home-clock');
    check('the clock shows a 24-hour time, with no a.m. or p.m.',
        /^\d{2}:\d{2}$/.test(clock.trim()), JSON.stringify(clock));
    check('the running version is on the Settings tab',
        (await page.textContent('#tab-version')) ===
            'v' + (await page.evaluate(() => APP_VERSION)),
        await page.textContent('#tab-version'));
    check('the date is spelled out', (await page.textContent('#home-date')).length > 8,
        await page.textContent('#home-date'));
    check('there is a word for the hour', (await page.textContent('#home-greeting')).length > 3,
        await page.textContent('#home-greeting'));

    const passage = (await page.textContent('#passage-text')).trim();
    check('today\u2019s passage has text', passage.length > 40, JSON.stringify(passage.slice(0, 50)));

    // The passage must be the book's own words, not something typed from memory:
    // find it in the section it claims to come from.
    const passageIsInTheBook = await page.evaluate(() => {
        const flat = (t) => String(t).replace(/[\u2018\u2019\u02bc]/g, "'")
            .replace(/[\u201c\u201d]/g, '"').replace(/[\u2013\u2014]/g, '-')
            .replace(/\s+/g, ' ').trim().toLowerCase();
        const shown = flat(document.getElementById('passage-text').textContent);
        const today = Store.passageForDay();
        const section = Store.getSection(today.sectionId);
        return !!section && flat(section.paragraphs[today.paraIndex]).includes(shown);
    });
    check('the passage is in the book, word for word, where it says it is', passageIsInTheBook);

    const sameTwice = await page.evaluate(() => {
        const a = Store.passageForDay();
        const b = Store.passageForDay();
        return a.text === b.text;
    });
    check('the passage does not change while the day does not', sameTwice);

    const movesOn = await page.evaluate(() => {
        const today = Store.passageForDay();
        const later = Store.passageForDay(new Date(Date.now() + 86400000));
        return today.text !== later.text;
    });
    check('a different day brings a different passage', movesOn);

    check('six shortcuts, in the first person',
        (await page.$$eval('#shortcuts .shortcut', (e) => e.length)) === 6);
    // A craving is not one reason among six. It is its own row, above
    // everything the app might otherwise rather show him.
    check('and the craving row is above them, not one of them',
        (await page.$$eval('#shortcuts .shortcut[data-shortcut="craving"]', (e) => e.length)) === 0 &&
        (await page.isVisible('#home-craving')));
    check('every shortcut now goes somewhere',
        (await page.$$eval('#shortcuts .shortcut.is-soon', (e) => e.length)) === 0);

    // ── the look of it ────────────────────────────────────────────────────
    // A tile is coloured by where it takes you. The guard that matters is the
    // fallback: --tile unset silently paints a tile in the screen's own
    // colour, which is exactly how the "write" tile shipped coral for an
    // afternoon and looked deliberate.
    const tiles = await page.$$eval('#shortcuts .shortcut', (nodes) =>
        nodes.map((n) => ({
            id: n.dataset.shortcut,
            tile: getComputedStyle(n).getPropertyValue('--tile').trim(),
            chip: getComputedStyle(n.querySelector('.shortcut-icon')).color,
        })));
    check('every home tile names its own colour',
        tiles.every((t) => t.tile !== ''),
        tiles.filter((t) => t.tile === '').map((t) => t.id).join(', ') || 'all set');
    // Distinct values are not distinct colours: two of these shipped as
    // near-identical greens and passed a set-size check. Measured in Lab, so
    // the assertion is about what an eye can tell apart. ΔE 25 is roughly
    // "nobody would call these the same colour".
    const spread = (() => {
        const lab = (rgb) => {
            const [r, g, b] = rgb.match(/\d+/g).slice(0, 3).map((n) => {
                const c = n / 255;
                return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
            });
            const X = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047;
            const Y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
            const Z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
            const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
            return [116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))];
        };
        let worst = { d: Infinity, pair: '' };
        for (let i = 0; i < tiles.length; i += 1) {
            for (let j = i + 1; j < tiles.length; j += 1) {
                const a = lab(tiles[i].chip);
                const b = lab(tiles[j].chip);
                const d = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
                if (d < worst.d) worst = { d: d, pair: tiles[i].id + '/' + tiles[j].id };
            }
        }
        return worst;
    })();
    check('and no two of them look alike',
        spread.d >= 25,
        'closest ' + spread.pair + ' ΔE ' + spread.d.toFixed(1));
    // "Coloured by where it takes you" is a claim about hue, not about an
    // exact value: a chip is a bright fill and a tab label is type that has to
    // clear 4.5:1, so the two are the same colour at different lightnesses.
    // Compare the hue angle, which is the part that carries the meaning.
    const hueAngle = (rgb) => {
        const [r, g, b] = rgb.match(/\d+/g).slice(0, 3).map((n) => n / 255);
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        if (max === min) return 0;
        const d = max - min;
        let h;
        if (max === r) h = ((g - b) / d) % 6;
        else if (max === g) h = (b - r) / d + 2;
        else h = (r - g) / d + 4;
        return ((h * 60) + 360) % 360;
    };
    const readTabColour = await page.$eval('.tab[data-screen="library"]', (n) => {
        const was = n.className;
        const hue = document.documentElement.getAttribute('data-hue');
        n.className = was + ' is-active';
        document.documentElement.setAttribute('data-hue', 'library');
        const c = getComputedStyle(n).color;
        n.className = was;
        document.documentElement.setAttribute('data-hue', hue);
        return c;
    });
    const readGap = Math.abs(hueAngle(tiles.filter((t) => t.id === 'read')[0].chip) -
                             hueAngle(readTabColour));
    check('the read tile is the Read tab\'s colour, brightened',
        Math.min(readGap, 360 - readGap) < 15,
        readGap.toFixed(1) + '° apart');

    // The craving row is the loudest thing on the home screen. Its accent
    // border was claimed in a comment for three versions while .do-row-alone,
    // declared later at equal specificity, quietly won it.
    const urgent = await page.$eval('#home-craving', (n) => {
        const c = getComputedStyle(n);
        return { w: c.borderTopWidth, colour: c.borderTopColor };
    });
    const homeHue = await page.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue('--hue-home').trim());
    check('the craving row really draws its accent border',
        urgent.w === '2px' && urgent.colour !== 'rgba(0, 0, 0, 0)',
        urgent.w + ' ' + urgent.colour + ' vs --hue-home ' + homeHue);

    // Each tab colours the screen it opened, so --accent has to actually move.
    const hues = {};
    for (const tab of ['home', 'library', 'steps', 'notes', 'search', 'settings']) {
        await page.click(`.tab[data-screen="${tab}"]`);
        await page.waitForTimeout(120);
        hues[tab] = await page.evaluate(() => ({
            hue: document.documentElement.getAttribute('data-hue'),
            accent: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(),
        }));
    }
    check('every tab sets its own hue on the document',
        Object.keys(hues).every((t) => hues[t].hue === t),
        Object.keys(hues).map((t) => t + '→' + hues[t].hue).join(' '));
    check('and each one is a different colour',
        new Set(Object.keys(hues).map((t) => hues[t].accent)).size === 6,
        Object.keys(hues).map((t) => hues[t].accent).join(' '));
    await page.click('.tab[data-screen="home"]');
    await page.waitForTimeout(120);

    // Headings are ink, not the accent. They were the accent colour for one
    // release and it was too much: the colour on a screen belongs in the chips
    // and the counts, which are the things worth picking out of it.
    const headingColour = await page.$eval('#screen-home .section-heading',
        (n) => getComputedStyle(n).color);
    const inkColour = await page.$eval('body', (n) => getComputedStyle(n).color);
    check('section headings are the ink colour, not the accent',
        headingColour === inkColour, headingColour + ' vs ink ' + inkColour);

    // The craving screen: five rows that look identical are five things to
    // read at the worst possible moment.
    await page.click('#home-craving');
    await page.waitForSelector('#screen-craving.is-active');
    // Wait for the rows themselves: this block runs early and a fixed pause
    // reads an empty list on a slow first paint.
    await page.waitForSelector('#craving-moves .do-row');
    const moveChips = await page.$$eval('#craving-moves .do-row', (nodes) =>
        nodes.map((n) => ({
            id: n.dataset.move,
            chip: getComputedStyle(n.querySelector('.do-icon')).backgroundColor,
        })));
    check('every move on the craving screen names its own colour',
        moveChips.length === 5 && moveChips.every((m) => m.id),
        moveChips.map((m) => m.id).join(', '));
    check('and all five chips are different',
        new Set(moveChips.map((m) => m.chip)).size === 5,
        moveChips.map((m) => m.chip).join(' '));
    check('the ways to reach somebody are one colour, being one kind of thing',
        (await page.$$eval('#craving-rings .do-row, #craving-message, #craving-write',
            (nodes) => nodes.length > 0 &&
                       nodes.every((n) => n.dataset.move === 'reach'))));
    // Tone is not the same thing as colour. Nothing on this screen congratulates
    // anybody, and the first light behind the home screen does not reach it.
    check('and the craving screen carries no sunrise',
        (await page.$eval('#screen-craving .screen-body',
            (n) => getComputedStyle(n).backgroundImage)) === 'none');
    await page.click('#craving-back');
    await page.waitForTimeout(200);

    // The twelve wear the Steps tab's colour, and say which ones you have been
    // into. On a fresh install every circle is an open ring; none is filled.
    await page.click('.tab[data-screen="steps"]');
    await page.waitForSelector('#steplist .step-item');
    const rings = await page.$$eval('#steplist .step-item', (nodes) =>
        nodes.map((n) => ({
            worked: n.classList.contains('is-worked'),
            fill: getComputedStyle(n.querySelector('.step-num')).backgroundColor,
            edge: getComputedStyle(n.querySelector('.step-num')).borderTopColor,
        })));
    const stepsHue = await page.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue('--hue-steps').trim());
    check('all twelve step circles are drawn in the Steps colour',
        rings.length === 12 && rings.every((r) => r.edge !== 'rgba(0, 0, 0, 0)'),
        rings.length + ' rings, --hue-steps ' + stepsHue);
    check('a step with nothing in it is an open ring, not a filled one',
        rings.filter((r) => !r.worked)
             .every((r) => r.fill === 'rgba(0, 0, 0, 0)'));
    await page.click('.tab[data-screen="home"]');
    await page.waitForTimeout(120);
    check('four counts', (await page.$$eval('#stats .stat', (e) => e.length)) === 4);
    check('a fresh install counts nothing rather than flattering you',
        (await page.textContent('#stats .stat')).includes('0%'));

    // ── counting the days ─────────────────────────────────────────────────
    check('with no first day set, the counter is an invitation rather than a nought',
        (await page.$eval('#daycount', (e) => e.classList.contains('is-unset'))) &&
        (await page.textContent('#daycount-n')) === '');

    const dayOne = await page.evaluate(async () => {
        await Store.saveSettings({ soberSince: Store.todayISO() });
        UI.showScreen('home');
        return document.getElementById('daycount-n').textContent + ' ' +
            document.getElementById('daycount-label').textContent;
    });
    check('the day you set it reads day one, not day nought', dayOne === '1 day', dayOne);

    const counted = await page.evaluate(async () => {
        await Store.saveSettings({ soberSince: '2023-03-03' });
        UI.showScreen('home');
        const days = Store.daysAbstinent();
        return { days: days, shown: document.getElementById('daycount-n').textContent,
                 since: document.getElementById('daycount-since').textContent };
    });
    // Worked out here rather than asked of the app, and off today's real date so
    // it does not start failing tomorrow.
    const now = new Date();
    const expectedDays = Math.round(
        (Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) - Date.UTC(2023, 2, 3))
        / 86400000) + 1;
    check('and counts inclusively from a date years back',
        counted.days === expectedDays,
        counted.days + ' days, expected ' + expectedDays);
    check('shown with a separator, and the day it counts from',
        counted.shown.replace(/[.,\u202f\u00a0]/g, '') === String(counted.days) &&
        /2023/.test(counted.since),
        counted.shown + ' — ' + counted.since);

    const future = await page.evaluate(async () => {
        await Store.saveSettings({ soberSince: Store.shiftDay(Store.todayISO(), 5) });
        const days = Store.daysAbstinent();
        await Store.saveSettings({ soberSince: '2023-03-03' });
        UI.showScreen('home');
        return days;
    });
    check('a date in the future counts nothing rather than backwards', future === 0, String(future));

    await page.click('#daycount');
    await page.waitForSelector('#screen-settings.is-active');
    check('tapping it goes to the day it counts from',
        (await page.inputValue('#set-sober-since')) === '2023-03-03');

    // ── days running ──────────────────────────────────────────────────────
    const running = await page.evaluate(() => ({
        run: Store.daysRunning(),
        today: Store.state.visits.indexOf(Store.todayISO()) !== -1
    }));
    check('opening the app is recorded as a day of its own',
        running.today && running.run >= 1, JSON.stringify(running));

    const runs = await page.evaluate(async (today) => {
        async function set(days) {
            Store.state.visits = days;
            await DB.put(DB.STORE_META, days, 'visits');
        }
        const back = (n) => Store.shiftDay(today, -n);
        const out = {};
        await set([back(2), back(1), today]);
        out.three = Store.daysRunning();
        await set([back(9), back(8), back(7), back(1), today]);
        out.broken = Store.daysRunning();
        out.best = Store.bestRun();
        await set([back(1)]);
        out.yesterdayOnly = Store.daysRunning();
        return out;
    }, await page.evaluate(() => Store.todayISO()));
    check('three days in a row read as three', runs.three === 3, String(runs.three));
    check('a gap starts the run again', runs.broken === 2, String(runs.broken));
    check('but the longest run is remembered', runs.best === 3, String(runs.best));
    check('yesterday still counts before today is recorded',
        runs.yesterdayOnly === 1, String(runs.yesterdayOnly));

    // Seeding: a day something was written is a day the app was open.
    const seeded = await page.evaluate(async (today) => {
        await DB.remove(DB.STORE_META, 'visits');
        Store.state.visits = null;
        const back = (n) => Store.shiftDay(today, -n);
        await Store.saveMeeting({ on: back(1), where: 'Seeded', shared: false, what: '' });
        await Store.saveMeeting({ on: back(2), where: 'Seeded', shared: false, what: '' });
        await Store.recordVisit();
        const run = Store.daysRunning();
        // Clear up after the seed so the meeting counts elsewhere still hold.
        for (const row of Store.state.meetings.filter((m) => m.where === 'Seeded')) {
            await Store.deleteMeeting(row.id);
        }
        return run;
    }, await page.evaluate(() => Store.todayISO()));
    check('a first list is seeded from the days already written about',
        seeded === 3, String(seeded));

    await page.evaluate(() => { UI.showScreen('home'); });
    check('and the tile shows what the store says',
        (await page.textContent('#stats .stat:last-child')).indexOf(
            String(await page.evaluate(() => Store.daysRunning()))) === 0);
    check('with a plain line saying what it counts',
        (await page.textContent('#stats .stat:last-child')).includes('opened the app'));

    // ── the rules ─────────────────────────────────────────────────────────
    await page.click('.tab[data-screen="settings"]');
    await page.waitForSelector('#screen-settings.is-active');

    const sponsorRules = await page.$$eval('#rules-sponsor-list li', (e) => e.map((x) => x.textContent));
    check('the sponsor rules are there from the first run', sponsorRules.length === 4 &&
        sponsorRules.indexOf('No alcohol') !== -1, sponsorRules.join(' · '));
    check('and the sponsee list starts empty, and says so',
        (await page.$$eval('#rules-sponsee-list li', (e) => e.length)) === 0 &&
        await page.isVisible('#rules-sponsee-empty'));
    check('they are in Settings, not on the home screen',
        (await page.$$eval('#screen-home .rules-list', (e) => e.length)) === 0);

    await page.click('[data-rules="sponsee"]');
    await page.waitForSelector('#rules-sheet:not([hidden])');
    check('each list is edited on its own',
        (await page.textContent('#rules-sheet-title')).includes('sponsee') &&
        (await page.inputValue('#rules-sheet-text')) === '');
    await page.fill('#rules-sheet-text', 'Ring me before you drink\n\nOne meeting a week');
    await page.click('#rules-save');
    await page.waitForSelector('#rules-sheet', { state: 'hidden' });
    const sponseeRules = await page.$$eval('#rules-sponsee-list li', (e) => e.map((x) => x.textContent));
    check('editing keeps the order and drops the blank lines',
        sponseeRules.join('|') === 'Ring me before you drink|One meeting a week',
        sponseeRules.join(' · '));
    check('and the sponsor list is untouched by it',
        (await page.$$eval('#rules-sponsor-list li', (e) => e.length)) === 4);

    await page.click('[data-rules="sponsor"]');
    await page.waitForSelector('#rules-sheet:not([hidden])');
    check('the sponsor list opens on its own rules',
        (await page.inputValue('#rules-sheet-text')).split('\n').length === 4);
    await page.fill('#rules-sheet-text', '');
    await page.click('#rules-save');
    await page.waitForTimeout(150);
    check('emptying one keeps it empty rather than bringing the defaults back',
        (await page.$$eval('#rules-sponsor-list li', (e) => e.length)) === 0 &&
        await page.isVisible('#rules-sponsor-empty'));

    // A little emphasis, and nothing else.
    await page.click('[data-rules="sponsee"]');
    await page.waitForSelector('#rules-sheet:not([hidden])');
    await page.fill('#rules-sheet-text',
        'No **alcohol**, ever\nNothing that *triggers*\nBed by _eleven_\nPlain <b>text</b> stays plain');
    await page.click('#rules-save');
    await page.waitForSelector('#rules-sheet', { state: 'hidden' });

    const marked = await page.$$eval('#rules-sponsee-list li', (e) => e.map((x) => x.innerHTML));
    check('two stars make a phrase bold',
        marked[0] === 'No <strong>alcohol</strong>, ever', marked[0]);
    check('one star and an underscore make it italic',
        marked[1] === 'Nothing that <em>triggers</em>' && marked[2] === 'Bed by <em>eleven</em>',
        marked[1] + ' | ' + marked[2]);
    check('and anything that looks like a tag is left as text, not run as one',
        marked[3] === 'Plain &lt;b&gt;text&lt;/b&gt; stays plain', marked[3]);
    check('the stars themselves do not survive into the reading',
        (await page.textContent('#rules-sponsee-list')).indexOf('*') === -1);

    // A backup written under 2.8 carried one list. It belongs to the sponsor.
    const migrated = await page.evaluate(async () => {
        const settings = Object.assign({}, Store.state.settings);
        delete settings.sponsorRules;
        delete settings.sponseeRules;
        settings.rules = ['No white flour', 'No alcohol'];
        await DB.put(DB.STORE_META, settings, 'settings');
        await Store.loadSettings();
        return { sponsor: Store.state.settings.sponsorRules,
                 old: Store.state.settings.rules };
    });
    check('an older single list is carried onto the sponsor side',
        migrated.sponsor.join('|') === 'No white flour|No alcohol' && migrated.old === undefined,
        JSON.stringify(migrated));

    await page.evaluate(() => Store.saveSettings({
        sponsorRules: ['No white flour', 'No alcohol', 'No white sugar',
                       'No substances that trigger'] }));
    await page.click('.tab[data-screen="home"]');
    await page.waitForSelector('#screen-home.is-active');

    // ── whether you have been here ────────────────────────────────────────
    check('with nothing written, the line says exactly that',
        (await page.textContent('#lastuse')) === 'Nothing read or written yet.');

    // Back-dated straight into the store: savePosition stamps "now" by design.
    async function lastUseAfter(days) {
        return page.evaluate(async (back) => {
            const at = new Date(Date.now() - back * 86400000).toISOString();
            await DB.remove(DB.STORE_META, 'position');
            await Store.loadPosition();
            await DB.clear(DB.STORE_NOTES);
            await DB.put(DB.STORE_NOTES, { id: 'lastuse-seed', sectionId: null, paraIndex: null,
                anchor: '', body: 'x', tag: '', discussedAt: null, createdAt: at, updatedAt: at });
            await Store.loadNotes();
            UI.showScreen('home');
            const el = document.getElementById('lastuse');
            return { text: el.textContent, cls: el.className };
        }, days);
    }

    const today = await lastUseAfter(0);
    check('something written today reads as today',
        today.text.includes('today') && today.cls === 'lastuse', today.text);
    const yesterday = await lastUseAfter(1);
    check('yesterday reads as yesterday, and stays quiet',
        yesterday.text.includes('yesterday') && yesterday.cls === 'lastuse', yesterday.text);
    const fewDays = await lastUseAfter(3);
    check('a few days takes a colour', fewDays.text.includes('for 3 days') &&
        fewDays.cls.includes('is-warm'), fewDays.text + ' [' + fewDays.cls + ']');
    const longer = await lastUseAfter(9);
    check('past a week it says so louder', longer.text.includes('for 9 days') &&
        longer.cls.includes('is-cold'), longer.text + ' [' + longer.cls + ']');

    // Opening the app is not activity — only reading or writing is.
    const stillNine = await page.evaluate(() => {
        UI.showScreen('library');
        UI.showScreen('home');
        return document.getElementById('lastuse').textContent;
    });
    check('opening the app does not count as having been here',
        stillNine.includes('for 9 days'), stillNine);

    // Put the seed note back where the rest of the run expects nothing.
    await page.evaluate(async () => {
        await DB.clear(DB.STORE_NOTES);
        await Store.loadNotes();
    });

    // ── the book ships with the app ───────────────────────────────────────
    await openContents(page);
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
    await page.waitForSelector('#screen-library.is-active');
    check('leaving the reader goes back to the contents it was opened from', true);
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
    await page.waitForSelector('#home-continue:not([hidden])', { timeout: 5000 });
    check('the home screen offers the chapter you stopped in',
        (await page.textContent('#home-continue-title')) === 'How It Works');
    check('progress percentage shown',
        /\d+% through the book/.test(await page.textContent('#home-continue-meta')));
    check('the home screen names where you are in the book',
        (await page.textContent('#stats .stat')).includes('How It Works'));
    check('the read shortcut names the chapter it would open',
        (await page.textContent('#shortcut-read-note')) === 'How It Works');

    // The same card is drawn on the contents, from the same function.
    await openContents(page);
    await page.waitForSelector('#continue-card:not([hidden])', { timeout: 5000 });
    check('the contents offers it too',
        (await page.textContent('#continue-title')) === 'How It Works');

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

    // ── a craving ─────────────────────────────────────────────────────────
    await page.click('.tab[data-screen="home"]');
    await page.click('#home-craving');
    await page.waitForSelector('#screen-craving.is-active');
    check('the craving shortcut opens a screen of its own', true);
    check('the Home tab stays lit inside it',
        await page.$eval('.tab[data-screen="home"]', (e) => e.classList.contains('is-active')));

    // The same rule as the daily passage: the book's own words, where it says.
    const cravingIsInTheBook = await page.evaluate(() => {
        const flat = (t) => String(t).replace(/[\u2018\u2019\u02bc]/g, "'")
            .replace(/[\u201c\u201d]/g, '"').replace(/[\u2013\u2014]/g, '-')
            .replace(/\s+/g, ' ').trim().toLowerCase();
        const shown = flat(document.getElementById('craving-passage-text').textContent);
        const listed = (Store.state.daily.craving || []).filter((p) => flat(p.text) === shown)[0];
        if (!listed) return false;
        const section = Store.getSection(listed.sectionId);
        return !!section && flat(section.paragraphs[listed.paraIndex]).includes(shown);
    });
    check('its passage is one of the craving passages, and is in the book', cravingIsInTheBook);

    check('with no number saved, ringing your sponsor offers to fix that',
        (await page.textContent('#craving-ring-label')).includes('number'));
    await page.click('#craving-ring');
    await page.waitForSelector('#screen-settings.is-active');
    check('and takes you where the number goes', true);
    await page.fill('#set-sponsor-name', 'Karl');
    await page.fill('#set-sponsor-phone', '+43 660 123 4567');
    await page.dispatchEvent('#set-sponsor-phone', 'change');
    await page.waitForTimeout(120);

    await page.click('.tab[data-screen="home"]');
    await page.click('#home-craving');
    await page.waitForSelector('#screen-craving.is-active');
    check('with a number saved it offers to ring them by name',
        (await page.textContent('#craving-rings .do-row .do-label')) === 'Ring Karl');
    check('and the number is dialled without the spaces in it',
        (await page.getAttribute('#craving-rings .do-row', 'href')) === 'tel:+436601234567');

    // A sponsee and a spouse can be on that list too. Working with another
    // alcoholic is the book's own answer to a shaky evening, so the sponsee
    // belongs there as much as the sponsor does.
    await page.evaluate(() => Store.saveSettings({
        sponseeName: 'Tobias', sponseePhone: '+43 664 987 6543',
        spouseName: 'Anna', spousePhone: '+43 676 555 1212'
    }));
    await page.evaluate(() => UI.showScreen('craving'));
    await page.waitForTimeout(120);
    const ringing = await page.$$eval('#craving-rings .do-row', (rows) => rows.map((r) => ({
        label: r.querySelector('.do-label').textContent,
        href: r.getAttribute('href')
    })));
    check('everyone with a number is offered, sponsor first', ringing.length === 3 &&
        ringing[0].label === 'Ring Karl' && ringing[1].label === 'Ring Tobias' &&
        ringing[2].label === 'Ring Anna',
        ringing.map((r) => r.label).join(', '));
    check('and each dials their own number',
        ringing[1].href === 'tel:+436649876543' && ringing[2].href === 'tel:+436765551212');

    check('nothing recorded yet says so plainly',
        (await page.textContent('#craving-summary')).includes('Nothing written down yet'));

    await page.click('#craving-start');
    await page.waitForSelector('#craving-live:not([hidden])');
    check('starting one puts a clock on it', !(await page.isVisible('#craving-start')));
    check('and counts from the moment it started',
        (await page.textContent('#craving-elapsed')).includes('so far'));

    // Back-dated so there is a duration to record rather than nought minutes.
    await page.evaluate(async () => {
        const open = Store.openCraving();
        await Store.saveCraving(Object.assign({}, open,
            { startedAt: new Date(Date.now() - 22 * 60000).toISOString() }));
        UI.showScreen('craving');
    });
    await page.click('#craving-passed');
    await page.waitForTimeout(200);
    check('one tap closes it', await page.isVisible('#craving-start'));
    check('and it joins the list with how long it ran',
        (await page.textContent('.craving-card')).includes('22 minutes'),
        await page.textContent('.craving-card'));
    check('the count says what happened to it',
        (await page.textContent('#craving-summary')).includes('it passed'),
        await page.textContent('#craving-summary'));

    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForSelector('#screen-home.is-active');
    check('the home tile carries how the cravings stand',
        (await page.textContent('#shortcut-craving-note')).length > 0,
        await page.textContent('#shortcut-craving-note'));
    await page.click('#home-craving');
    await page.waitForSelector('#screen-craving.is-active');
    check('the record survives a reload',
        (await page.$$eval('.craving-card', (e) => e.length)) === 1);

    // The other outcome, which the list has to be able to hold.
    await page.click('#craving-start');
    await page.waitForSelector('#craving-live:not([hidden])');
    await page.click('#craving-how');
    await page.waitForSelector('#craving-sheet:not([hidden])');
    await page.click('#craving-outcome .chip[data-outcome="drank"]');
    await page.fill('#craving-sheet-what', 'Went to the shop.');
    await page.click('#craving-sheet-save');
    await page.waitForSelector('#craving-sheet', { state: 'hidden' });
    check('a craving that ended in a drink is recorded as one',
        (await page.textContent('.craving-card')).includes('Drank'),
        await page.textContent('.craving-card'));
    check('and the count stops claiming every one passed',
        (await page.textContent('#craving-summary')).includes('1 of them passed'),
        await page.textContent('#craving-summary'));
    check('what was going on is kept with it',
        (await page.textContent('.craving-card')).includes('Went to the shop.'));

    // The one place the two logs meet. Nobody wants to go hunting for the page
    // at that moment, so it is put in front of him — once, and it takes a no.
    await page.waitForSelector('#drank-sheet:not([hidden])');
    await shot(page, 'shot-drank-offer.png');
    check('an entry that ends in a drink offers the three days there and then',
        (await page.textContent('#drank-sheet .sheet-title')) === 'The three days');
    await page.click('#drank-sheet-later');
    await page.waitForSelector('#drank-sheet', { state: 'hidden' });
    check('not now is taken for an answer, and starts nothing',
        !(await page.evaluate(() => Store.openBreak())));
    check('but the offer stays on the screen rather than the door closing',
        await page.isVisible('#craving-offer') &&
        (await page.textContent('#craving-offer .do-label')) === 'The three days');
    await shot(page, 'shot-craving-offer.png');

    // ── before we talk ────────────────────────────────────────────────────
    await page.click('.tab[data-screen="home"]');
    await page.click('.shortcut[data-shortcut="sponsor"]');
    await page.waitForSelector('#screen-checkin.is-active');
    check('the sponsor tile opens the page for that conversation',
        (await page.textContent('#checkin-title')) === 'Talking to my sponsor' &&
        (await page.textContent('#checkin-sub')) === 'Today');
    check('the Home tab stays lit inside it',
        await page.$eval('.tab[data-screen="home"]', (e) => e.classList.contains('is-active')));

    const asked = await page.$$eval('#checkin-fields .checkin-label', (e) => e.map((x) => x.textContent));
    check('with the questions about me, and the meeting notes last',
        asked.length === 7 && asked[0] === 'Am I abstinent?' &&
        asked[6] === 'Notes from the meeting', asked.join(' · '));
    check('abstinence is yes or no, not a box to type in',
        (await page.$$eval('#checkin-fields .chip', (e) => e.map((x) => x.textContent)))
            .join('/') === 'Yes/No');

    await page.click('#checkin-fields .chip >> nth=0');
    await page.waitForTimeout(200);
    const areas = await page.$$('#checkin-fields textarea');
    await areas[0].fill('Swam before work.');
    await areas[0].dispatchEvent('change');
    await areas[5].fill('He said: the easy amends teach you the hard ones.');
    await areas[5].dispatchEvent('change');
    await page.waitForTimeout(250);

    const saved = await page.evaluate(() => Store.checkinFor('sponsor'));
    check('an answer and a note save as you go, with no Save button',
        saved.values.abstinent === 'yes' && saved.values.forMyself === 'Swam before work.' &&
        saved.notes.indexOf('easy amends') !== -1, JSON.stringify(saved.values));
    check('and all of it is one record for the day',
        (await page.evaluate(() => Store.checkinsFor('sponsor').length)) === 1);

    // Tapping the lit answer takes it back, without a third button for it.
    await page.click('#checkin-fields .chip >> nth=0');
    await page.waitForTimeout(250);
    check('tapping the lit answer clears it',
        !(await page.evaluate(() => Store.checkinFor('sponsor').values.abstinent)));
    await page.click('#checkin-fields .chip >> nth=0');
    await page.waitForTimeout(250);

    // The sponsee's page asks about him, and allows not knowing.
    await page.click('#checkin-back');
    await page.waitForSelector('#screen-home.is-active');
    await page.click('.shortcut[data-shortcut="sponsee"]');
    await page.waitForSelector('#screen-checkin.is-active');
    const askedOfHim = await page.$$eval('#checkin-fields .checkin-label', (e) => e.map((x) => x.textContent));
    check('the sponsee page asks about him instead',
        askedOfHim[0] === 'Is he abstinent?' && askedOfHim[1] === 'What has he done for himself?',
        askedOfHim.join(' · '));
    check('and lets you say you do not know',
        (await page.$$eval('#checkin-fields .chip', (e) => e.map((x) => x.textContent)))
            .join('/') === 'Yes/No/Don\u2019t know');
    check('the two pages keep their own records',
        (await page.evaluate(() => Store.checkinsFor('sponsee').length)) === 0);

    // What is waiting to be raised is on the page, and copies out.
    await page.click('#checkin-write');
    await page.waitForSelector('#note-sheet:not([hidden])');
    check('writing one down comes up marked for them',
        await page.$eval('#note-tags .chip[data-tag="sponsee"]',
            (e) => e.classList.contains('is-active')));
    await page.fill('#note-sheet-body', 'Ask how the first week went.');
    await page.click('#note-save');
    await page.waitForSelector('#note-sheet', { state: 'hidden' });
    check('and turns up on the page at once',
        (await page.$$eval('#checkin-raise .card', (e) => e.length)) === 1 &&
        await page.isVisible('#checkin-copy'));

    // Yesterday's page is behind today's, and the way back is a tap.
    await page.evaluate(async () => {
        await Store.saveCheckin('sponsee', Store.shiftDay(Store.todayISO(), -1),
            { values: { abstinent: 'yes' }, notes: 'He rang. Twenty minutes, mostly him.' });
        UI.showScreen('checkin');
    });
    await page.waitForTimeout(200);
    check('a day already written is listed under today',
        (await page.$$eval('.checkin-card', (e) => e.length)) === 1,
        await page.textContent('#checkin-history'));
    await page.click('.checkin-card');
    await page.waitForTimeout(250);
    check('opening it shows that day rather than today',
        (await page.textContent('#checkin-sub')) !== 'Today' &&
        await page.isVisible('#checkin-today'));
    await page.click('#checkin-today');
    await page.waitForTimeout(200);
    check('and the way back to today is one tap',
        (await page.textContent('#checkin-sub')) === 'Today');

    // Taking the day to the meeting.
    await page.click('#checkin-back');
    await page.waitForSelector('#screen-home.is-active');
    await page.click('.shortcut[data-shortcut="sponsor"]');
    await page.waitForSelector('#screen-checkin.is-active');
    await page.click('#checkin-share');
    await page.waitForSelector('#copy-sheet:not([hidden])');

    const outgoing = await page.inputValue('#copy-preview');
    check('the page copies out headed by the conversation and the day',
        outgoing.indexOf('Talking to my sponsor') === 0, outgoing.split('\n')[0]);
    check('with the questions answered, in their own words',
        outgoing.includes('Am I abstinent?\nYes') &&
        outgoing.includes('What have I done for myself today?\nSwam before work.'),
        JSON.stringify(outgoing.slice(0, 90)));
    check('and what is unanswered said plainly rather than left silent',
        /\d+ questions not answered yet\./.test(outgoing),
        (outgoing.match(/\d+ questions not answered yet\./) || [''])[0]);
    check('the size of it is shown before anything is copied',
        /About \d+ words\./.test(await page.textContent('#copy-size')),
        await page.textContent('#copy-size'));

    check('the notes from the meeting go by default, and can be left out',
        outgoing.includes('easy amends') &&
        (await page.$$eval('#copy-options input', (e) => e.length)) === 1);
    await page.click('#copy-options input');
    await page.waitForTimeout(150);
    check('and leaving them out is a choice you can see you made',
        !(await page.inputValue('#copy-preview')).includes('easy amends'));
    await page.click('#copy-cancel');
    await page.waitForSelector('#copy-sheet', { state: 'hidden' });

    // A day with nothing on it says so rather than pretending.
    const emptyDay = await page.evaluate(() => {
        const day = Store.shiftDay(Store.todayISO(), -30);
        return { text: Store.checkinAsText('sponsee', day), empty: Store.checkinIsEmpty(
            Store.checkinFor('sponsee', day)) };
    });
    check('an untouched day copies out as the questions and nothing else',
        emptyDay.empty && emptyDay.text.includes('not answered yet'),
        emptyDay.text.split('\n').slice(-3).join(' / '));

    // Clear up: later checks count notes.
    await page.evaluate(async () => {
        for (const note of Store.state.notes.filter((n) => n.tag === 'sponsee')) {
            await Store.deleteNote(note.id);
        }
    });
    await page.click('#checkin-back');

    // ── a meeting ─────────────────────────────────────────────────────────
    await page.click('.tab[data-screen="home"]');
    await page.click('.shortcut[data-shortcut="meeting"]');
    await page.waitForSelector('#screen-meeting.is-active');
    check('the meeting shortcut opens a screen of its own', true);
    check('nothing recorded yet says so plainly',
        (await page.textContent('#meeting-summary')).includes('Nothing written down yet'));
    check('and nothing is waiting to be brought up',
        await page.isVisible('#meeting-raise-empty'));

    await page.click('#meeting-add');
    await page.waitForSelector('#meeting-sheet:not([hidden])');
    check('a new one is dated today',
        (await page.inputValue('#meeting-sheet-on')) ===
        (await page.evaluate(() => Store.todayISO())));
    await page.fill('#meeting-sheet-where', 'Tuesday, Kolpinghaus');
    await page.click('#meeting-sheet-shared');
    await page.fill('#meeting-sheet-what', 'The fear goes before the willingness does.');
    await page.click('#meeting-sheet-save');
    await page.waitForSelector('#meeting-sheet', { state: 'hidden' });

    const meetingCard = (await page.textContent('.meeting-card')).replace(/\s+/g, ' ');
    check('it joins the list with where it was and that you spoke',
        meetingCard.includes('Tuesday, Kolpinghaus') && meetingCard.includes('Shared'),
        meetingCard);
    check('the count says how many and how recently',
        (await page.textContent('#meeting-summary')).includes('in the last thirty days'),
        await page.textContent('#meeting-summary'));

    // A point to raise there — the third thing a note can be waiting for.
    await page.click('#meeting-write');
    await page.waitForSelector('#note-sheet:not([hidden])');
    check('writing one down comes up already marked for a meeting',
        await page.$eval('#note-tags .chip[data-tag="meeting"]',
            (e) => e.classList.contains('is-active')));
    await page.fill('#note-sheet-body', 'Ask how people handle the hour after work.');
    await page.click('#note-save');
    await page.waitForSelector('#note-sheet', { state: 'hidden' });
    check('and turns up on the meeting screen at once',
        (await page.$$eval('#meeting-raise .card', (e) => e.length)) === 1);
    check('with the list ready to copy out', await page.isVisible('#meeting-copy'));

    await page.click('.tab[data-screen="notes"]');
    await page.click('#notes-filters .chip[data-filter="meeting"]');
    await page.waitForTimeout(150);
    check('the Notes tab has a filter for them too',
        (await page.$$eval('#notes-list .card', (e) => e.length)) === 1);
    check('and the chip counts what its own list shows',
        (await page.textContent('#notes-filters .chip[data-filter="meeting"]')).includes('1'));

    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForSelector('#screen-home.is-active');
    check('the home tile says when you were last at one',
        (await page.textContent('#shortcut-meeting-note')).length > 0,
        await page.textContent('#shortcut-meeting-note'));
    await page.click('.shortcut[data-shortcut="meeting"]');
    await page.waitForSelector('#screen-meeting.is-active');
    check('the record survives a reload',
        (await page.$$eval('.meeting-card', (e) => e.length)) === 1);

    // The places you already go are offered rather than typed again.
    await page.click('#meeting-add');
    await page.waitForSelector('#meeting-sheet:not([hidden])');
    check('the meetings you go to are offered as chips',
        (await page.$$eval('#meeting-places .chip', (e) => e.map((x) => x.textContent)))
            .includes('Tuesday, Kolpinghaus'));
    await page.click('#meeting-places .chip');
    check('and tapping one fills it in',
        (await page.inputValue('#meeting-sheet-where')) === 'Tuesday, Kolpinghaus');
    await page.click('#meeting-sheet-cancel');
    await page.waitForSelector('#meeting-sheet', { state: 'hidden' });

    // Taking the meetings out, in the same sheet the conversation pages use.
    await page.click('#meeting-share');
    await page.waitForSelector('#copy-sheet:not([hidden])');
    const meetingsOut = await page.inputValue('#copy-preview');
    check('the meetings copy out with the count that leads the screen',
        meetingsOut.indexOf('Meetings') === 0 && meetingsOut.includes('in the last thirty days'),
        meetingsOut.split('\n')[2]);
    check('and each one with its day, where it was and whether you spoke',
        /Tuesday, Kolpinghaus/.test(meetingsOut) && /shared/.test(meetingsOut),
        (meetingsOut.split('\n').filter((l) => l.includes('Kolpinghaus'))[0] || ''));
    check('the last thirty days is the default, and can be widened',
        (await page.$$eval('#copy-options label', (e) =>
            e.map((x) => x.querySelector('span').textContent)))[0] ===
        'Only the last thirty days');
    check('what is worth keeping goes, and can be left out',
        meetingsOut.includes('The fear goes before the willingness does.'));
    await page.click('#copy-options input >> nth=1');
    await page.waitForTimeout(150);
    check('leaving it out is a choice you can see you made',
        !(await page.inputValue('#copy-preview')).includes('The fear goes before'));
    check('and the size of it is shown before anything is copied',
        /About \d+ words\./.test(await page.textContent('#copy-size')),
        await page.textContent('#copy-size'));
    await page.click('#copy-cancel');
    await page.waitForSelector('#copy-sheet', { state: 'hidden' });

    // Take the point back off the list. Everything below counts notes, and a
    // test that leaves one behind turns every later count into a puzzle.
    await page.evaluate(async () => {
        const mine = Store.state.notes.filter((n) => n.tag === 'meeting');
        for (const note of mine) await Store.deleteNote(note.id);
        UI.showScreen('meeting');
    });
    check('the point comes off the list when it is deleted',
        (await page.$$eval('#meeting-raise .card', (e) => e.length)) === 0);

    // ── starting again ────────────────────────────────────────────────────
    await page.click('.tab[data-screen="home"]');
    await page.waitForSelector('#screen-home.is-active');
    check('there is a way in from the home screen, and it is not shouted',
        (await page.textContent('#broken .do-label')) === 'I have broken my abstinence');
    await page.click('#broken');
    await page.waitForSelector('#screen-bounce.is-active');
    check('with nothing open it offers to start, and nothing else',
        await page.isVisible('#bounce-start') && !(await page.isVisible('#bounce-open')));

    const soberBefore = await page.evaluate(() => Store.state.settings.soberSince);
    await page.click('#bounce-start');
    await page.waitForSelector('#bounce-sheet:not([hidden])');
    check('the date is asked for rather than assumed',
        (await page.inputValue('#bounce-sheet-on')) ===
            (await page.evaluate(() => Store.todayISO())));
    check('and so is whether to count the days again',
        (await page.$eval('#bounce-sheet-reset', (e) => e.dataset.reset)) === 'yes');

    // Left off: it is his count, not the app's.
    await page.click('#bounce-sheet-reset');
    await page.click('#bounce-sheet-save');
    await page.waitForTimeout(400);
    check('leaving that off leaves the day count alone',
        (await page.evaluate(() => Store.state.settings.soberSince)) === soberBefore,
        soberBefore + ' -> ' + (await page.evaluate(() => Store.state.settings.soberSince)));
    check('the three days are open, and it is day one',
        (await page.textContent('#bounce-sub')) === 'Day 1 of three' &&
        (await page.$$eval('.bounce-day', (e) => e.length)) === 3);
    check('day one leads with the doctor, the one line that is not advice',
        (await page.textContent('.bounce-day >> nth=0 >> .bounce-task'))
            .includes('ring a doctor first'));

    await page.click('.bounce-day >> nth=0 >> .bounce-task >> nth=1');
    await page.waitForTimeout(250);
    check('a task ticks off and stays ticked',
        await page.evaluate(() => !!Store.openBreak().days['1'].done.tell));
    await page.fill('#bounce-what', 'Wine at a work dinner.');
    await page.dispatchEvent('#bounce-what', 'change');
    await page.waitForTimeout(250);
    check('and what happened is written down without a Save button',
        (await page.evaluate(() => Store.openBreak().what)) === 'Wine at a work dinner.');

    // The book's own titles, straight apostrophe and all.
    check('the book is on the page, the Doctor\'s Opinion first',
        (await page.$$eval('#bounce-reading .do-label', (e) => e.map((x) => x.textContent)))
            .join('|') === "The Doctor's Opinion|More About Alcoholism|How It Works",
        (await page.$$eval('#bounce-reading .do-label', (e) => e.map((x) => x.textContent))).join(' | '));

    await page.click('#bounce-copy');
    await page.waitForSelector('#copy-sheet:not([hidden])');
    const bounceOut = await page.inputValue('#copy-preview');
    check('it copies out showing what is done and what is not',
        bounceOut.includes('[x] Tell your sponsor') &&
        bounceOut.includes('[ ] Get to a meeting') &&
        bounceOut.includes('Wine at a work dinner.'),
        (bounceOut.match(/\[x\][^\n]*/) || [''])[0]);
    await page.click('#copy-cancel');
    await page.waitForSelector('#copy-sheet', { state: 'hidden' });

    // Day one is the day it happened, counted inclusively like everything else.
    check('a break two days back reads as day three',
        (await page.evaluate(() =>
            Store.breakDay({ on: Store.shiftDay(Store.todayISO(), -2) }))) === 3);

    await page.click('.tab[data-screen="home"]');
    check('while it is open the home row says which day it is',
        (await page.textContent('#broken-note')).indexOf('Day 1') === 0,
        await page.textContent('#broken-note'));

    page.once('dialog', (d) => d.accept());
    await page.click('#broken');
    await page.waitForSelector('#screen-bounce.is-active');
    await page.click('#bounce-close');
    await page.waitForTimeout(400);
    check('closing it puts it behind you, and keeps what you wrote',
        !(await page.evaluate(() => Store.openBreak())) &&
        (await page.$$eval('#bounce-history .card', (e) => e.length)) === 1);
    await page.click('.tab[data-screen="home"]');
    check('and the home row goes back to how it was',
        (await page.textContent('#broken-note')) === 'Three days, and what to do with them');

    // ── the craving log and the three days ────────────────────────────────
    await page.click('#home-craving');
    await page.waitForSelector('#screen-craving.is-active');
    check('the offer is still there days later, and says which entry it is for',
        await page.isVisible('#craving-offer') &&
        (await page.textContent('#craving-offer-note')).indexOf('For the one on ') === 0,
        await page.textContent('#craving-offer-note'));

    const drank = await page.evaluate(() => {
        const row = Store.cravingNeedingPlan();
        return { id: row.id, day: Store.dayISO(new Date(row.startedAt)) };
    });
    await page.click('#craving-offer');
    await page.waitForSelector('#bounce-sheet:not([hidden])');
    await shot(page, 'shot-bounce-carried.png');
    check('taking it up carries the date over rather than asking twice',
        (await page.inputValue('#bounce-sheet-on')) === drank.day &&
        await page.isVisible('#bounce-sheet-from'),
        (await page.inputValue('#bounce-sheet-on')) + ' vs ' + drank.day);

    await page.click('#bounce-sheet-reset');   // his count, not the app's
    await page.click('#bounce-sheet-save');
    await page.waitForTimeout(400);
    check('and the three days remember which entry they came from',
        (await page.evaluate(() => Store.openBreak().cravingId)) === drank.id,
        await page.evaluate(() => String(Store.openBreak().cravingId)));
    await shot(page, 'shot-bounce-linked.png');
    check('the page links back to it, with what was written at the time',
        await page.isVisible('#bounce-from') &&
        (await page.textContent('#bounce-from-note')).includes('Went to the shop.'),
        await page.textContent('#bounce-from-note'));

    await page.click('#bounce-copy');
    await page.waitForSelector('#copy-sheet:not([hidden])');
    const linkedOut = await page.inputValue('#copy-preview');
    check('and what led to it can go to the sponsor with the rest',
        linkedOut.includes('What led to it') && linkedOut.includes('Went to the shop.'),
        (linkedOut.match(/What led to it[^]{0,30}/) || [''])[0]);
    await page.click('#copy-cancel');
    await page.waitForSelector('#copy-sheet', { state: 'hidden' });

    page.once('dialog', (d) => d.accept());
    await page.click('#bounce-close');
    await page.waitForTimeout(400);
    await page.click('.tab[data-screen="home"]');
    await page.click('#home-craving');
    await page.waitForSelector('#screen-craving.is-active');
    check('once an entry has its three days it is never offered them again',
        !(await page.isVisible('#craving-offer')) &&
        !(await page.evaluate(() => Store.cravingNeedingPlan())),
        'offer shown: ' + (await page.isVisible('#craving-offer')));
    await page.click('.tab[data-screen="home"]');

    // ── the disclaimer ────────────────────────────────────────────────────
    // Somebody looking for who is answerable for this app should find the
    // answer in the app, not only in a README they will never open.
    await page.click('.tab[data-screen="settings"]');
    await page.waitForSelector('#screen-settings.is-active');
    const disclaimer = await page.evaluate(() => {
        const h = document.getElementById('settings-disclaimer');
        return h ? h.nextElementSibling.textContent.replace(/\s+/g, ' ') : '';
    });
    check('Settings carries a disclaimer of its own', disclaimer.length > 200);
    check('it says the responsibility taken is none',
        /no responsibility is taken/i.test(disclaimer));
    check('it says what is his and what is the book\u2019s',
        /public domain/i.test(disclaimer) && /own experience/i.test(disclaimer) &&
        /not official a\.a\. material/i.test(disclaimer));
    check('it says copyrighted material is left out rather than reproduced',
        /left out rather than reproduced/i.test(disclaimer));
    check('and it keeps the one line that is a fact rather than advice',
        /ring a doctor first/i.test(disclaimer));
    check('the affiliation is stated once, not twice',
        (await page.evaluate(() => (document.getElementById('screen-settings').textContent
            .match(/Not affiliated with/g) || []).length)) === 1);

    // ── the Twelve Traditions ─────────────────────────────────────────────
    await page.click('.tab[data-screen="steps"]');
    await page.waitForSelector('#screen-steps.is-active');
    check('the Steps tab carries both twelves rather than a seventh tab appearing',
        (await page.isVisible('#twelves-switch')) &&
        (await page.$$eval('.tabbar .tab', (e) => e.length)) === 6,
        (await page.$$eval('.tabbar .tab', (e) => e.length)) + ' tabs');
    check('and opens on the steps', (await page.textContent('#twelves-title')) === 'The Twelve Steps');

    await page.click('#twelves-switch .switch-opt[data-twelve="traditions"]');
    await page.waitForTimeout(150);
    check('the switch shows the other twelve',
        (await page.textContent('#twelves-title')) === 'The Twelve Traditions' &&
        (await page.isVisible('#tradlist')) && !(await page.isVisible('#steplist')));

    const topics = await page.$$eval('#tradlist .step-name', (e) => e.map((x) => x.textContent));
    check('all twelve are there, named by topic', topics.length === 12 &&
        topics[2] === 'Membership' && topics[11] === 'Anonymity', topics.join(', '));

    /*
     * The bar this whole section is built around. The Traditions were written in
     * 1946 and first printed in the book at the second edition, which is under
     * copyright; the 1939 text this app carries does not contain them. Nothing
     * shipped may carry their wording, and this is the check that says so.
     */
    check('no Tradition carries the wording — that is the point, not an omission',
        await page.evaluate(() => Store.allTraditions().every((t) => !t.text && !!t.topic)));
    check('and the 1939 text does not contain them either',
        await page.evaluate(() => {
            const words = ['singleness of purpose', 'group conscience', 'common welfare',
                'self-supporting', 'outside issues'];
            return Store.state.book.sections.every((s) => s.paragraphs.every((p) =>
                words.every((w) => p.toLowerCase().indexOf(w) === -1)));
        }));

    // Every reference is resolved again at runtime, trusting the anchor over the
    // stored index, so an imported copy of the text keeps the links.
    const ground = await page.evaluate(() => Store.allTraditions().map((t) => ({
        n: t.number,
        live: t.references.filter((r) => Store.resolveStepRef(r) !== null).length,
        refs: t.references.length
    })));
    check('every reference resolves against the bundled text',
        ground.every((g) => g.live === g.refs) && ground.reduce((n, g) => n + g.refs, 0) === 33,
        ground.reduce((n, g) => n + g.live, 0) + ' of ' + ground.reduce((n, g) => n + g.refs, 0));
    check('and every one of the twelve has some 1939 ground to stand on',
        ground.every((g) => g.live > 0),
        ground.map((g) => g.n + ':' + g.live).join(' '));

    await page.click('#tradlist .step-item >> nth=2');
    await page.waitForSelector('#screen-tradition.is-active');
    check('a Tradition page opens with the topic, not a quotation',
        (await page.textContent('#tradition-title')) === 'Tradition 3' &&
        (await page.textContent('#tradition-sub')) === 'Membership');
    check('and says on the page why the wording is not there',
        (await page.textContent('#tradition-wording')).includes('1946'),
        await page.textContent('#tradition-wording'));
    check('the Steps tab stays lit while you are inside one',
        await page.evaluate(() => document.querySelector('.tab[data-screen="steps"]')
            .classList.contains('is-active')));
    check('it carries the 1939 ground, and says how much of it there is',
        (await page.$$eval('#tradition-references .ref-item', (e) => e.length)) === 3 &&
        (await page.$$eval('#tradition-references .is-missing', (e) => e.length)) === 0 &&
        (await page.textContent('#tradition-ground')).includes('3 passages'),
        await page.textContent('#tradition-ground'));
    check('and six questions of our own', (await page.$$eval('#tradition-questions .question',
        (e) => e.length)) === 6);

    // The questions are the same machinery as a step's, not a second copy.
    await page.click('#tradition-questions .question >> nth=0 >> .chip >> nth=0');
    await page.waitForSelector('#note-sheet:not([hidden])');
    check('answering one names the Tradition rather than a step',
        (await page.textContent('#note-sheet-title')) === 'Tradition 3 — answering',
        await page.textContent('#note-sheet-title'));
    await page.fill('#note-sheet-body', 'The man who comes back drunk. I had written him off.');
    await page.click('#note-save');
    await page.waitForTimeout(400);
    check('and the answer is filed against the Tradition, not against a step',
        await page.evaluate(() => {
            const a = Store.state.notes.filter((n) => n.traditionId === 'trad03' && n.questionId);
            return a.length === 1 && !a[0].stepId;
        }));
    check('answering again keeps the first answer rather than replacing it',
        await page.evaluate(async () => {
            await Store.saveNote({ traditionId: 'trad03', questionId: 't3-q1', body: 'Again, later.' });
            return Store.tradAnswersFor('trad03', 't3-q1').length === 2;
        }));

    // A note with no page and no step used to fall straight into Reflections.
    await page.evaluate(() => Store.saveNote({ traditionId: 'trad03', body: 'A note on this one.' }));
    check('a Tradition note is not swept into Reflections',
        await page.evaluate(() => {
            const note = Store.state.notes.filter((n) =>
                n.traditionId === 'trad03' && !n.questionId)[0];
            return !Store.isLooseNote(note) && Store.isTraditionNote(note);
        }));
    await page.click('.tab[data-screen="notes"]');
    await page.click('#notes-filters .chip[data-filter="own"]');
    await page.waitForTimeout(150);
    check('and the Reflections count matches the list it is over',
        (await page.$$eval('#notes-list .card', (e) => e.length)) ===
        (await page.evaluate(() => Store.state.notes.filter(Store.isLooseNote).length)),
        (await page.$$eval('#notes-list .card', (e) => e.length)) + ' shown');
    await page.click('#notes-filters .chip[data-filter="all"]');

    // The log, which is the third thing that counts as having worked one.
    await page.click('.tab[data-screen="steps"]');
    await page.click('#tradlist .step-item >> nth=2');
    await page.waitForSelector('#screen-tradition.is-active');
    await page.click('#tradition-log-add');
    await page.waitForSelector('#tradlog-sheet:not([hidden])');
    check('the log arrives already set to the Tradition you were reading',
        (await page.inputValue('#tradlog-sheet-which')) === 'trad03');
    await page.click('#tradlog-held .chip[data-held="no"]');
    await page.fill('#tradlog-sheet-what', 'The business meeting voted a difficult man out. Nobody said the only requirement out loud.');
    await page.fill('#tradlog-sheet-learned', 'Say it next time, even badly.');
    await page.click('#tradlog-sheet-save');
    await page.waitForSelector('#tradlog-sheet', { state: 'hidden' });
    check('an entry is kept, and one that did not hold is kept as that',
        await page.evaluate(() => Store.state.tradlog.length === 1 &&
            Store.state.tradlog[0].held === false));
    check('and it shows on the Tradition it belongs to',
        (await page.$$eval('#tradition-log .tradlog-card', (e) => e.length)) === 1 &&
        (await page.$$eval('#tradition-log .is-missed', (e) => e.length)) === 1);

    await page.click('#tradition-back');
    await page.waitForSelector('#screen-steps.is-active');
    check('coming back lands on the Traditions rather than the Steps',
        (await page.textContent('#twelves-title')) === 'The Twelve Traditions');
    check('the shared log shows it too, naming which one it was',
        (await page.textContent('#tradlog-list .tradlog-which')).includes('Membership'),
        await page.textContent('#tradlog-list .tradlog-which'));
    check('and the summary says how it stands without scoring it',
        (await page.textContent('#tradlog-summary')).includes('One entry') &&
        (await page.textContent('#tradlog-summary')).includes('the other way'),
        await page.textContent('#tradlog-summary'));
    check('the list row counts all three things, not one of them',
        (await page.textContent('#tradlist .step-item >> nth=2')).includes('1 of 6 answered') &&
        (await page.textContent('#tradlist .step-item >> nth=2')).includes('1 note') &&
        (await page.textContent('#tradlist .step-item >> nth=2')).includes('1 seen'),
        await page.textContent('#tradlist .step-item >> nth=2'));

    // Which twelve you were last on is remembered: somebody working the
    // Traditions this month should not have to switch every time.
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForSelector('#screen-home.is-active');
    await page.click('.tab[data-screen="steps"]');
    await page.waitForTimeout(150);
    check('the tab remembers which twelve you were working',
        (await page.textContent('#twelves-title')) === 'The Twelve Traditions');
    await page.click('#twelves-switch .switch-opt[data-twelve="steps"]');
    await page.waitForTimeout(150);
    check('and the steps still work exactly as they did',
        (await page.$$eval('#steplist .step-item', (e) => e.length)) === 12);

    // The three notes above were written to prove the plumbing; the note store
    // is shared, and what is left in it is counted by the rest of the suite.
    // The log entry stays — the backup round trip asserts it.
    await page.evaluate(async () => {
        const mine = Store.state.notes.filter((n) => n.traditionId);
        for (const note of mine) await Store.deleteNote(note.id);
    });
    check('and the Traditions tests leave the note store as they found it',
        (await page.evaluate(() => Store.state.notes.filter((n) => n.traditionId).length)) === 0);

    // ── the emergency page ────────────────────────────────────────────────
    await page.click('.tab[data-screen="home"]');
    await page.click('#home-craving');
    await page.waitForSelector('#screen-craving.is-active');

    const moves = await page.$$eval('#craving-moves .move-row .do-label', (e) => e.map((x) => x.textContent));
    check('five things to do, the body first because it answers quickest',
        moves.length === 5 && moves[0] === 'Breathe' && moves[1] === 'Meet it head on' &&
        moves[4] === 'Something else that works', moves.join(' / '));

    // Navigation is the last thing anybody wants in the middle of one, so
    // every row on this page opens where it stands.
    check('nothing on the page is open when you arrive',
        (await page.$$eval('#craving-moves .move-body:not([hidden])', (e) => e.length)) === 0);
    await page.click('#craving-moves .move-row >> nth=1');
    check('a move opens where it stands rather than moving you elsewhere',
        (await page.evaluate(() => document.querySelector('#screen-craving').classList.contains('is-active'))) &&
        (await page.$$eval('#craving-moves .move-body:not([hidden])', (e) => e.length)) === 1);
    check('and says what it means rather than only naming itself',
        (await page.textContent('#craving-moves .move-body:not([hidden]) .move-text')).length > 120);
    await page.click('#craving-moves .move-row >> nth=1');
    check('and closes again', (await page.$$eval('#craving-moves .move-body:not([hidden])', (e) => e.length)) === 0);

    // His own list, which is the whole reason it is editable rather than fixed.
    await page.click('#craving-moves .move-row >> nth=4');
    check('his own things are on the list, from Settings',
        (await page.$$eval('#craving-moves .move-body:not([hidden]) li', (e) => e.map((x) => x.textContent)))
            .join(', ') === 'Tapping, A workout, Meditation',
        await page.$$eval('#craving-moves .move-body:not([hidden]) li', (e) => e.map((x) => x.textContent).join(', ')));

    await page.evaluate(() => Store.saveSettings({ helpsList: ['Walk the dog', '**Ring anyone**'] }));
    await page.evaluate(() => UI.showScreen('home'));
    await page.click('#home-craving');
    await page.click('#craving-moves .move-row >> nth=4');
    check('changing them in Settings changes what this page offers',
        (await page.$$eval('#craving-moves .move-body:not([hidden]) li', (e) => e.map((x) => x.textContent)))
            .join(', ') === 'Walk the dog, Ring anyone');
    check('and the same bold works here as in the rules',
        (await page.$$eval('#craving-moves .move-body:not([hidden]) li strong', (e) => e.length)) === 1);

    // An empty list would be a row that opens onto nothing.
    await page.evaluate(() => Store.saveSettings({ helpsList: [] }));
    await page.evaluate(() => UI.showScreen('home'));
    await page.click('#home-craving');
    check('with none written down the row says so rather than opening onto nothing',
        (await page.textContent('#craving-moves .move-row >> nth=4')).includes('Nothing written down yet'),
        await page.textContent('#craving-moves .move-row >> nth=4'));
    await page.evaluate(() => Store.saveSettings({ helpsList: ['Tapping', 'A workout', 'Meditation'] }));

    // The prayers are the book's, resolved at runtime through the steps that
    // carry them — never written out a second time in this app.
    await page.evaluate(() => UI.showScreen('home'));
    await page.click('#home-craving');
    const prayers = await page.$$eval('#craving-prayers .move-row .do-label', (e) => e.map((x) => x.textContent));
    check('both prayers the book prints are offered', prayers.length === 2 &&
        prayers[0] === 'The third-step prayer' && prayers[1] === 'The seventh-step prayer',
        prayers.join(' / '));
    await page.click('#craving-prayers .move-row >> nth=0');
    const said = await page.textContent('#craving-prayers .move-body:not([hidden]) .move-prayer');
    check('and it is the book’s own words, not a version of them',
        said.includes('God, I offer myself to Thee'), JSON.stringify(said.slice(0, 60)));
    check('taken from the paragraph the step points at, resolved at runtime',
        await page.evaluate((text) => {
            const ref = Store.getStep('step03').work.prayerRef;
            const i = Store.resolveStepRef(ref);
            return Store.getSection(ref.sectionId).paragraphs[i] === text;
        }, said));

    // The breathing timer: one clock, and it must not outlive its sheet.
    await page.click('#craving-moves .move-row >> nth=0');
    await page.waitForSelector('#breathe-sheet:not([hidden])');
    check('breathing opens its own sheet, ready rather than already running',
        (await page.textContent('#breathe-phase')) === 'Ready' &&
        (await page.textContent('#breathe-start')) === 'Start');
    // The tones are generated rather than bundled, so there is nothing to ship
    // and nothing to fetch. Count the oscillators actually started.
    await page.evaluate(() => {
        window.__tones = [];
        const C = window.AudioContext || window.webkitAudioContext;
        const real = C.prototype.createOscillator;
        C.prototype.createOscillator = function () {
            const osc = real.call(this);
            const start = osc.start.bind(osc);
            osc.start = function (t) { window.__tones.push(osc.frequency.value); return start(t); };
            return osc;
        };
    });
    check('the sound is on to begin with, and says so',
        (await page.textContent('#breathe-sound')) === 'Sound on');

    await page.click('#breathe-start');
    await page.waitForTimeout(1100);
    check('it counts down the phase it is in',
        (await page.textContent('#breathe-phase')) === 'In' &&
        Number(await page.textContent('#breathe-count')) < 4,
        (await page.textContent('#breathe-phase')) + ' ' + (await page.textContent('#breathe-count')));
    check('and the ring is told which phase it is showing',
        (await page.getAttribute('#breathe-ring', 'class')).indexOf('is-in') !== -1);

    // A headless browser may keep the context suspended, in which case there is
    // nothing to hear. The count still has to be at most one: a tone sounds on
    // the turn of the breath, never once a second.
    const heard = await page.evaluate(() => window.__tones.slice());
    check('a tone sounds on the turn of the breath, not every second',
        heard.length <= 1, heard.join(', ') || 'context suspended, nothing sounded');

    // Silence is the check that holds whatever the browser does about autoplay:
    // with the sound off, nothing may be started at all.
    await page.click('#breathe-sound');
    await page.waitForTimeout(150);
    check('turning it off says so, and is remembered in settings',
        (await page.textContent('#breathe-sound')) === 'Sound off' &&
        (await page.evaluate(() => Store.state.settings.breathSound)) === false);
    const quietFrom = await page.evaluate(() => window.__tones.length);
    await page.waitForTimeout(4300);
    check('and nothing sounds while it is off, whatever the ring is doing',
        (await page.evaluate(() => window.__tones.length)) === quietFrom);
    await page.click('#breathe-sound');
    check('turning it back on is remembered too',
        (await page.evaluate(() => Store.state.settings.breathSound)) === true);
    await page.click('#breathe-start');
    check('stopping stops it', (await page.textContent('#breathe-phase')) === 'Stopped');

    // A clock behind a closed sheet goes on counting into an empty room.
    await page.click('#breathe-start');
    await page.waitForTimeout(300);
    await page.click('#breathe-close');
    await page.waitForSelector('#breathe-sheet', { state: 'hidden' });
    const frozenAt = await page.textContent('#breathe-count');
    await page.waitForTimeout(1600);
    check('and closing the sheet stops it too, rather than leaving it running',
        (await page.textContent('#breathe-count')) === frozenAt,
        'was ' + frozenAt + ', now ' + (await page.textContent('#breathe-count')));

    // Coming back is a fresh arrival: what you left open last time is not
    // what you want open in the middle of the next one.
    await page.click('#craving-moves .move-row >> nth=1');
    await page.evaluate(() => UI.showScreen('home'));
    await page.click('#home-craving');
    check('coming back to it finds everything closed again',
        (await page.$$eval('#craving-moves .move-body:not([hidden])', (e) => e.length)) === 0 &&
        (await page.$$eval('#craving-prayers .move-body:not([hidden])', (e) => e.length)) === 0);

    // The book is still on the page, just no longer ahead of the doing.
    check('the passage and the chapter are below the things to do',
        await page.evaluate(() => {
            const body = document.querySelector('#screen-craving .screen-body');
            const kids = Array.prototype.slice.call(body.children);
            return kids.indexOf(document.getElementById('craving-passage')) >
                   kids.indexOf(document.getElementById('craving-moves'));
        }));

    // ── saying something to them ──────────────────────────────────────────
    await page.click('.tab[data-screen="home"]');
    await page.click('.shortcut[data-shortcut="message"]');
    await page.waitForSelector('#screen-message.is-active');
    check('the message shortcut opens a screen of its own', true);
    check('the home tab stays lit while you are on it',
        await page.evaluate(() => document.querySelector('.tab[data-screen="home"]')
            .classList.contains('is-active')));

    const writeTo = await page.$$eval('#message-who .chip', (c) => c.map((x) => x.textContent));
    check('everyone you could write to is offered, sponsor first',
        writeTo.length === 3 && writeTo[0] === 'Karl' && writeTo[1] === 'Tobias' &&
        writeTo[2] === 'Anna', writeTo.join(', '));

    check('nothing is recorded before anything has been sent',
        (await page.textContent('#message-summary')).includes('Nothing sent'),
        await page.textContent('#message-summary'));

    // The box is the whole point of the screen, so it is tall before a word is
    // in it rather than a three-line window onto a dictated paragraph.
    check('the box is big enough to talk into',
        (await page.$eval('#message-text', (el) => el.getBoundingClientRect().height)) >= 150);

    const opener = await page.textContent('#message-openers .chip >> nth=0');
    await page.click('#message-openers .chip >> nth=0');
    check('an opener goes into the box rather than being sent as it stands',
        (await page.inputValue('#message-text')).trim() === opener.trim(),
        await page.inputValue('#message-text'));

    await page.fill('#message-text', 'Rough night. Can we talk in the morning?');
    await page.waitForTimeout(600);
    check('the count follows what is in the box',
        (await page.textContent('#message-hint')).startsWith('8 words'),
        await page.textContent('#message-hint'));
    check('a text message carries the words, and dials without the spaces in it',
        (await page.getAttribute('#message-sms', 'href')) ===
        'sms:+436601234567?body=' + encodeURIComponent('Rough night. Can we talk in the morning?'),
        await page.getAttribute('#message-sms', 'href'));

    // Changing your mind about who to tell is not a reason to lose what you said.
    await page.click('#message-who .chip >> nth=1');
    check('changing who it is for keeps the words',
        (await page.inputValue('#message-text')) === 'Rough night. Can we talk in the morning?');
    const forTobias = await page.$$eval('#message-send .do-row',
        (rows) => rows.map((r) => r.querySelector('.do-label').textContent));
    check('and the ways out follow the person, not the last one looked at',
        forTobias.some((label) => label.includes('Tobias')),
        forTobias.join(' / '));
    await page.click('#message-who .chip >> nth=0');

    // A message half worked out at eleven at night must survive the phone
    // locking, so the draft is written as it is typed rather than on leaving.
    const draft = await page.evaluate(() => localStorage.getItem('ams-big-12s:message-draft'));
    check('what is in the box is saved as it is typed', !!draft && JSON.parse(draft).text ===
        'Rough night. Can we talk in the morning?', String(draft));
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForSelector('#screen-home.is-active');
    await page.click('.shortcut[data-shortcut="message"]');
    await page.waitForSelector('#screen-message.is-active');
    check('and is still there after the app has been shut',
        (await page.inputValue('#message-text')) === 'Rough night. Can we talk in the morning?',
        await page.inputValue('#message-text'));

    // Copying is one of the three doors out, and the only one a headless
    // browser can be walked through: there is no share sheet and no Messages.
    await page.evaluate(() => {
        navigator.clipboard.writeText = () => Promise.resolve();
    });
    const copyRow = (await page.$$eval('#message-send .do-row',
        (rows) => rows.map((r) => r.querySelector('.do-label').textContent)))
        .findIndex((label) => label === 'Copy it');
    await page.click('#message-send .do-row >> nth=' + copyRow);
    await page.waitForTimeout(400);
    check('sending it empties the box', (await page.inputValue('#message-text')) === '');
    check('and clears the draft, which is not a record of anything',
        (await page.evaluate(() => localStorage.getItem('ams-big-12s:message-draft'))) === null);

    const sent = await page.evaluate(() => Store.state.messages.map((m) => ({
        who: m.who, how: m.how, text: m.text })));
    check('what was sent is kept, with who to and which way it went',
        sent.length === 1 && sent[0].who === 'sponsor' && sent[0].how === 'copied' &&
        sent[0].text === 'Rough night. Can we talk in the morning?', JSON.stringify(sent));
    check('the record says how it left rather than that it arrived',
        (await page.textContent('.message-card .message-how')) === 'Copied',
        await page.textContent('.message-card .message-how'));
    check('and the summary counts it',
        (await page.textContent('#message-summary')).includes('One sent from here'),
        await page.textContent('#message-summary'));

    // An empty box has nothing to send, and must not write an empty record.
    await page.click('#message-send .do-row >> nth=' + copyRow);
    await page.waitForTimeout(300);
    check('an empty box is not recorded as a message',
        (await page.evaluate(() => Store.state.messages.length)) === 1);

    await page.click('.message-card >> nth=0');
    await page.waitForSelector('#message-past-sheet:not([hidden])');
    check('one already sent opens whole, however long it was',
        (await page.inputValue('#message-past-text')) === 'Rough night. Can we talk in the morning?');
    await page.click('#message-past-again');
    await page.waitForTimeout(200);
    check('and can be said again', (await page.inputValue('#message-text'))
        .includes('Rough night.'), await page.inputValue('#message-text'));
    await page.fill('#message-text', '');
    await page.waitForTimeout(500);

    await page.click('.tab[data-screen="home"]');
    check('the home tile carries when you last wrote to somebody',
        (await page.textContent('#shortcut-message-note')).length > 0,
        await page.textContent('#shortcut-message-note'));

    // Ringing is not always in you; the row sits beside the numbers for exactly
    // the evening when it is not.
    await page.click('#home-craving');
    await page.waitForSelector('#screen-craving.is-active');
    await page.click('#craving-message');
    await page.waitForSelector('#screen-message.is-active');
    check('the craving screen offers it beside the numbers to ring', true);

    // With nobody in Settings there is nobody to write to, and a box addressed
    // to no one is worse than saying so.
    const savedPeople = await page.evaluate(() => ({
        sponsorName: Store.state.settings.sponsorName,
        sponseeName: Store.state.settings.sponseeName,
        spouseName: Store.state.settings.spouseName,
        sponsorPhone: Store.state.settings.sponsorPhone,
        sponseePhone: Store.state.settings.sponseePhone,
        spousePhone: Store.state.settings.spousePhone
    }));
    await page.evaluate(() => Store.saveSettings({
        sponsorName: '', sponsorPhone: '', sponseeName: '', sponseePhone: '',
        spouseName: '', spousePhone: '' }));
    await page.evaluate(() => UI.showScreen('home'));
    await page.evaluate(() => UI.showScreen('message'));
    await page.waitForTimeout(120);
    check('with nobody set up it offers Settings rather than a box to nowhere',
        (await page.isVisible('#message-nobody')) && !(await page.isVisible('#message-compose')));
    check('and what has already been sent is still shown',
        (await page.$$eval('.message-card', (e) => e.length)) === 1);
    await page.evaluate((saved) => Store.saveSettings(saved), savedPeople);
    await page.evaluate(() => UI.showScreen('home'));

    // ── backup round trip ─────────────────────────────────────────────────
    const slim = JSON.parse(await page.evaluate(() => Backup.serialize({ includeBookText: false })));
    check('backup carries notes, bookmarks, position, settings',
        slim.notes.length === 1 && slim.bookmarks.length === 1 &&
        !!slim.position.sectionId && !!slim.settings);
    check('backup carries the cravings and the sponsor', slim.cravings.length === 2 &&
        slim.settings.sponsorPhone === '+43 660 123 4567',
        (slim.cravings || []).length + ' cravings');
    check('and the meetings', slim.meetings.length === 1,
        (slim.meetings || []).length + ' meetings');
    check('and what was worked out before a conversation',
        slim.checkins.length === 2, (slim.checkins || []).length + ' check-ins');
    check('and the times abstinence broke', slim.breaks.length === 2,
        (slim.breaks || []).length + ' breaks');
    check('and where the Traditions were seen holding or not',
        slim.tradlog.length === 1 && slim.tradlog[0].traditionId === 'trad03',
        (slim.tradlog || []).length + ' log entries');
    check('and what has been said to a sponsor, a sponsee or a spouse',
        slim.messages.length === 1 && slim.messages[0].who === 'sponsor',
        (slim.messages || []).length + ' messages');
    // A draft has been said to nobody. It is not a record, and it does not
    // belong in a file that moves to a new phone.
    check('but not an unsent draft', slim.messageDraft === undefined);
    check('including which craving entry one of them came from',
        slim.breaks.filter((row) => row.cravingId === drank.id).length === 1);

    // A backup written before the craving screen existed has no such key, and
    // must restore without emptying a list that is only worth anything whole.
    const older = JSON.parse(JSON.stringify(slim));
    delete older.cravings;
    delete older.meetings;
    delete older.checkins;
    delete older.breaks;
    delete older.messages;
    delete older.tradlog;
    const keptThrough = await page.evaluate(async (json) => {
        await Backup.restoreBackup(Backup.parseBackup(json), 'merge');
        return { cravings: Store.state.cravings.length, meetings: Store.state.meetings.length,
                 checkins: Store.state.checkins.length, breaks: Store.state.breaks.length,
                 messages: Store.state.messages.length,
                 tradlog: Store.state.tradlog.length };
    }, JSON.stringify(older));
    check('an older backup restores without wiping any of them',
        keptThrough.cravings === 2 && keptThrough.meetings === 1 &&
        keptThrough.checkins === 2 && keptThrough.breaks === 2 &&
        keptThrough.messages === 1 && keptThrough.tradlog === 1,
        JSON.stringify(keptThrough));
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
    check('and brings the cravings, meetings and messages back with everything else',
        await page.evaluate(() => Store.state.cravings.length === 2 &&
            Store.state.meetings.length === 1 && Store.state.messages.length === 1),
        JSON.stringify(summary));

    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForSelector('#screen-home.is-active');
    await page.waitForSelector('#home-continue:not([hidden])', { timeout: 5000 });
    const expectedTitle = await page.evaluate(
        (id) => Store.getSection(id).title, slim.position.sectionId);
    const restoredTitle = await page.textContent('#home-continue-title');
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

    /*
     * Every declared kind now has a renderer, so this can no longer be tested by
     * pointing at an unbuilt step. It asks the dispatcher directly instead: a
     * kind this build does not know must hide its section rather than show an
     * empty one. The kind is put back afterwards.
     */
    const hidesUnknown = await page.evaluate(() => {
        const step = Store.getStep('step12');
        const real = step.work.kind;
        step.work.kind = 'not-a-real-kind';
        UI.openStep('step12');
        const hidden = document.getElementById('step-work').hidden;
        step.work.kind = real;
        UI.openStep('step12');
        return hidden;
    });
    check('a work kind this build does not know hides its section', hidesUnknown);
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
    await openContents(page);
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

    // ── the page carries the same colours as the lists ────────────────────
    // One colour per person, including in the middle of a chapter: the edge on
    // the paragraph is the same green as the card on the Notes tab and the
    // tile on the home screen.
    const paraEdge = await page.$eval('#reader-content .para[data-index="3"]',
        (n) => ({ tag: n.dataset.tag, edge: getComputedStyle(n).borderLeftColor }));
    const sponseeTile = await page.evaluate(() => {
        const probe = document.createElement('span');
        document.body.appendChild(probe);
        probe.style.color = 'var(--tile-sponsee)';
        const c = getComputedStyle(probe).color;
        probe.remove();
        return c;
    });
    check('a passage note wears the colour of the person it is for',
        paraEdge.tag === 'sponsee' && paraEdge.edge === sponseeTile,
        paraEdge.tag + ' ' + paraEdge.edge + ' vs tile ' + sponseeTile);

    // A distinctive word out of that same paragraph, so the search below is
    // guaranteed to turn up a passage this reader has already written on.
    const notedWords = await page.$eval('#reader-content .para[data-index="3"]',
        (n) => n.firstChild.textContent.split(/\s+/)
            .map((w) => w.replace(/[^A-Za-z]/g, ''))
            .filter((w) => w.length > 7));
    await page.click('#reader-back');

    // ── the contents says where you left off ──────────────────────────────
    await openContents(page);
    await page.waitForSelector('#toc .toc-item');
    const here = await page.$$eval('#toc .toc-item.is-here',
        (nodes) => nodes.map((n) => n.querySelector('.toc-title').textContent.trim()));
    const openAt = await page.evaluate(() => {
        const p = Store.state.position;
        return p ? Store.getSection(p.sectionId).title : '';
    });
    check('the contents marks the one chapter you left off in',
        here.length === 1 && here[0] === openAt, here.join(', ') + ' / at ' + openAt);

    // ── a search that turns up your own paragraph says so ─────────────────
    if (notedWords.length) {
        await page.click('.tab[data-screen="search"]');
        await page.waitForSelector('#screen-search.is-active');
        await page.fill('#search-input', notedWords[0]);
        await page.waitForTimeout(400);
        const mine = await page.$$eval('#search-results .hit-card.is-mine',
            (nodes) => nodes.map((n) => (n.querySelector('.hit-mine') || {}).textContent || ''));
        check('a search hit on a passage you have written on says so',
            mine.length >= 1 && mine[0].indexOf('your note') > -1,
            'searched "' + notedWords[0] + '", marked ' + mine.length);
        // No focus styles existed at all before this, so the search box drew
        // whatever ring the browser fancied — an orange one, on a teal screen.
        const ring = await page.$eval('#search-input', (n) => {
            n.focus();
            const cs = getComputedStyle(n);
            return cs.outlineColor + ' ' + cs.outlineWidth;
        });
        const searchHue = await page.evaluate(() => {
            const probe = document.createElement('span');
            document.body.appendChild(probe);
            probe.style.color = 'var(--hue-search)';
            const c = getComputedStyle(probe).color;
            probe.remove();
            return c;
        });
        check('a focused field draws the screen\'s own colour, not the browser\'s',
            ring.indexOf(searchHue) === 0, ring + ' vs ' + searchHue);
        await page.fill('#search-input', '');
    }
    await openContents(page);

    await page.click('.tab[data-screen="notes"]');
    await page.waitForSelector('#screen-notes.is-active');
    const chips = await page.$$eval('#notes-filters .chip', (e) => e.map((c) => c.textContent.trim()));
    check('the filters count what is still waiting',
        chips.includes('Sponsor 1') && chips.includes('Sponsee 1'), chips.join(' / '));

    // ── who a note is for, in colour ──────────────────────────────────────
    const noteEdges = await page.$$eval('#notes-list .note-card', (cards) =>
        cards.map((c) => ({
            tag: c.dataset.tag || '',
            edge: getComputedStyle(c).borderLeftColor,
            width: getComputedStyle(c).borderLeftWidth,
            pill: (() => {
                const p = c.querySelector('.tag-pill');
                return p ? getComputedStyle(p).color : '';
            })(),
        })));
    const forSponsor = noteEdges.filter((n) => n.tag === 'sponsor')[0];
    const forSponsee = noteEdges.filter((n) => n.tag === 'sponsee')[0];
    const forNobody = noteEdges.filter((n) => n.tag === '')[0];
    check('a note for your sponsor and one for your sponsee are different colours',
        !!forSponsor && !!forSponsee && forSponsor.edge !== forSponsee.edge,
        (forSponsor || {}).edge + ' vs ' + (forSponsee || {}).edge);
    check('and the pill on each agrees with its edge',
        forSponsor.pill === forSponsor.edge && forSponsee.pill === forSponsee.edge);
    check('a note for nobody but you takes no edge at all',
        !!forNobody && forNobody.width === '1px',
        forNobody ? forNobody.width + ' ' + forNobody.edge : 'no untagged note');

    // The invariant worth having: a note for your sponsor is the colour of the
    // tile you would tap to go and meet them. One colour per person, app-wide.
    const tileColours = await page.evaluate(() => {
        const probe = document.createElement('span');
        document.body.appendChild(probe);
        const read = (v) => {
            probe.style.color = 'var(' + v + ')';
            return getComputedStyle(probe).color;
        };
        const out = { sponsor: read('--tile-sponsor'), sponsee: read('--tile-sponsee') };
        probe.remove();
        return out;
    });
    check('a sponsor note is the colour of the sponsor tile on the home screen',
        forSponsor.edge === tileColours.sponsor,
        forSponsor.edge + ' vs tile ' + tileColours.sponsor);
    check('and the same holds for the sponsee',
        forSponsee.edge === tileColours.sponsee,
        forSponsee.edge + ' vs tile ' + tileColours.sponsee);

    // Settings tells the two conversations apart the same way.
    await page.click('.tab[data-screen="settings"]');
    await page.waitForSelector('#screen-settings.is-active');
    const ruleTitles = await page.$$eval('.ruleset[data-who]', (sets) =>
        sets.map((n) => ({
            who: n.dataset.who,
            title: getComputedStyle(n.querySelector('.ruleset-title')).color,
        })));
    check('the two rule lists in Settings wear the same two colours',
        ruleTitles.length === 2 &&
        ruleTitles.filter((r) => r.who === 'sponsor')[0].title === tileColours.sponsor &&
        ruleTitles.filter((r) => r.who === 'sponsee')[0].title === tileColours.sponsee,
        ruleTitles.map((r) => r.who + '=' + r.title).join(' '));
    await page.click('.tab[data-screen="notes"]');
    await page.waitForSelector('#screen-notes.is-active');

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
            const line = e.querySelector('.step-progress');
            return line ? line.textContent : '';
        })) === '3 notes');

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

    // ── step twelve: who you have sat with ────────────────────────────────
    await page.click('.tab[data-screen="steps"]');
    await page.click('.step-item >> nth=11');
    await page.waitForSelector('#screen-step.is-active');
    check('step twelve now has its work section', await page.isVisible('#step-work'));

    await page.click('#step-work-body .btn');
    await page.waitForSelector('#inv-sheet:not([hidden])');
    check('it is dated by when you first sat down',
        (await page.$eval('#inv-sheet-fields .sheet-label', (e) => e.textContent)) === 'First sat down');
    await page.fill('#inv-sheet-fields input[type=date]', '2024-06-11');
    let people = await page.$$('#inv-sheet-fields textarea');
    await people[0].fill('D.');
    await people[1].fill('Asked after a meeting.');
    await people[2].fill('Went back out after a month. Rang me at Christmas.');
    await page.click('#inv-save');
    await page.waitForTimeout(300);
    check('the first person is counted in words, not left at 1',
        (await page.textContent('#step-work-body .hint')) === 'One person.');

    await page.click('#step-work-body .btn');
    await page.waitForSelector('#inv-sheet:not([hidden])');
    await page.fill('#inv-sheet-fields input[type=date]', '2026-02-03');
    people = await page.$$('#inv-sheet-fields textarea');
    await people[0].fill('K.');
    await people[1].fill('His wife phoned mine.');
    await page.click('#inv-save');
    await page.waitForTimeout(300);
    check('a second is added, newest first, and the count follows',
        JSON.stringify(await page.$$eval('.person-who', (e) => e.map((x) => x.textContent))) ===
            JSON.stringify(['K.', 'D.']) &&
        (await page.textContent('#step-work-body .hint')) === '2 people.');
    check('someone can be recorded before you know what happened',
        (await page.locator('.person', { hasText: 'K.' }).first()
            .locator('.person-what').count()) === 0);

    const person = page.locator('.person', { hasText: 'D.' }).first();
    await person.locator('.chip', { hasText: 'Do not know' }).click();
    await page.waitForTimeout(250);
    check('not knowing how it went is offered, and not treated as a failure',
        (await person.locator('.person-hint').textContent()).indexOf('not a failure') !== -1);
    await person.locator('.chip', { hasText: 'Still in touch' }).click();
    await page.waitForTimeout(250);
    check('the outcome can be changed later',
        (await person.locator('.person-hint').count()) === 0);

    await page.reload({ waitUntil: 'networkidle' });
    await page.click('.tab[data-screen="steps"]');
    await page.click('.step-item >> nth=11');
    await page.waitForSelector('#screen-step.is-active');
    check('the people survive a reload',
        (await page.$$eval('.person', (e) => e.length)) === 2);
    await page.click('#step-back');

    // the whole point of the phase: nothing declared is left unbuilt
    const everyStepHasWork = [];
    for (let i = 0; i < 12; i++) {
        await page.click('.step-item >> nth=' + i);
        await page.waitForSelector('#screen-step.is-active');
        everyStepHasWork.push(await page.isVisible('#step-work'));
        await page.click('#step-back');
    }
    check('all twelve steps show their own work',
        everyStepHasWork.every(Boolean),
        everyStepHasWork.filter(Boolean).length + '/12');

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

    // ── progress on the list ──────────────────────────────────────────────

    /*
     * The list counted journal entries and nothing else, so a step with eight
     * questions answered and an inventory filled in still read as untouched.
     * All three count now, and each kind of work names its own rows — "2
     * sittings", not "2 entries", which is true of everything and says nothing.
     */
    await page.click('.tab[data-screen="steps"]');
    await page.waitForSelector('#screen-steps.is-active');
    const rows = await page.$$eval('.step-item', (items) => items.map((item) => ({
        line: (item.querySelector('.step-progress') || {}).textContent || '',
        when: (item.querySelector('.step-when') || {}).textContent || ''
    })));

    check('the list counts answers, notes and work together',
        /1 of 9 answered/.test(rows[0].line) && /3 notes/.test(rows[0].line) &&
        /1 item/.test(rows[0].line), rows[0].line);

    check('each kind of work names its own rows',
        /2 sittings/.test(rows[4].line) && /2 names/.test(rows[7].line),
        rows[4].line + '  |  ' + rows[7].line);

    // Step nine owns no rows: it writes onto step eight's. Counting those as its
    // own would show it finished the moment step eight had names in it.
    check('a step that annotates another’s rows counts only what it wrote on',
        /1 amend recorded/.test(rows[8].line), rows[8].line);

    check('a step with nothing written says nothing, rather than three zeros',
        rows[1].line === '' && rows[1].when === '');

    check('and a worked step carries the day it was last worked',
        /\w/.test(rows[0].when), rows[0].when);
    await shot(page, 'shot-steps.png');

    // ── taking a step out of the app ──────────────────────────────────────
    await page.click('.step-item >> nth=0');
    await page.waitForSelector('#screen-step.is-active');
    await page.click('#step-copy');
    await page.waitForSelector('#share-sheet:not([hidden])');

    const preview = () => page.inputValue('#share-preview');
    let out = await preview();
    check('a step comes out headed by its number and its own wording',
        out.indexOf('Step 1 · Powerless') === 0 && /powerless over alcohol/i.test(out));
    check('carrying the latest answer, the notes and the work',
        /Questions and answers/.test(out) && /Second time round/.test(out) &&
        /First read of step one/.test(out) && /The work of this step/.test(out));
    check('the earlier answers stay behind unless they are asked for',
        !/It goes further than I plan/.test(out));
    check('what is unanswered is said plainly rather than left to be guessed',
        /8 questions not answered yet/.test(out), (out.match(/\d+ questions? not answered yet/) || [])[0]);
    check('and the size of it is shown before anything is copied',
        /^About \d+ words\.$/.test(await page.textContent('#share-size')));

    await page.click('#share-options input[data-key="everyAnswer"]');
    await page.waitForTimeout(150);
    out = await preview();
    check('asking for the history brings every answer back',
        /It goes further than I plan/.test(out) && /Second time round/.test(out));

    await page.click('#share-options input[data-key="notes"]');
    await page.waitForTimeout(150);
    out = await preview();
    check('a section turned off leaves no empty heading behind',
        !/Notes on this step/.test(out) && !/First read of step one/.test(out));

    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.click('#share-copy');
    await page.waitForSelector('#share-sheet', { state: 'hidden' });
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    check('copying puts on the clipboard exactly what was previewed',
        clip.indexOf('Step 1 · Powerless') === 0 && !/Notes on this step/.test(clip) &&
        /Copied from AMS Big 12S/.test(clip));

    // Step five holds the most private line in the app, and the page folds it
    // away. It must not leave the phone because a copy button was pressed.
    await page.click('#step-back');
    await page.click('.step-item >> nth=4');
    await page.waitForSelector('#screen-step.is-active');
    await page.click('#step-copy');
    await page.waitForSelector('#share-sheet:not([hidden])');
    out = await preview();
    check('a sitting copies out with its date and who it was with',
        /Nov 2, 2025/.test(out) && /kitchen table/.test(out));
    check('but what was held back does not go by default',
        !/money I skated over/.test(out));
    check('and leaving it out is a choice the reader can see they made',
        (await page.textContent('#share-options .row:last-child'))
            .indexOf('What I held back') === 0);

    await page.click('#share-options input[data-key="held"]');
    await page.waitForTimeout(150);
    check('ticking it puts it in', /money I skated over/.test(await preview()));
    await shot(page, 'shot-share.png');
    await page.click('#share-cancel');
    await page.waitForSelector('#share-sheet', { state: 'hidden' });

    // ── appearance ────────────────────────────────────────────────────────
    await page.click('.tab[data-screen="settings"]');
    await page.selectOption('#set-theme', 'dark');
    await page.waitForTimeout(150);
    check('theme switches', (await page.getAttribute('html', 'data-theme')) === 'dark');
    await page.selectOption('#set-theme', 'sepia');
    check('settings shows what text is loaded',
        (await page.textContent('#book-status')).includes('First Edition (1939)'));

    // ── adjusting where you are in the book ───────────────────────────────
    await page.click('.tab[data-screen="home"]');
    await page.waitForSelector('#home-continue:not([hidden])');
    await page.click('#home-continue [data-adjust]');
    await page.waitForSelector('#continue-sheet:not([hidden])');
    check('the card can be adjusted, and says where it thinks you are',
        /through the book/.test(await page.textContent('#continue-sheet-where')),
        await page.textContent('#continue-sheet-where'));

    await page.click('#continue-restart');
    await page.waitForSelector('#continue-sheet', { state: 'hidden' });
    check('starting the chapter again puts it at the top',
        (await page.evaluate(() => Store.state.position.paraIndex)) === 0);

    await page.click('#home-continue [data-adjust]');
    await page.waitForSelector('#continue-sheet:not([hidden])');
    await page.click('#continue-forget');
    await page.waitForTimeout(250);
    check('forgetting it clears the position', await page.evaluate(() => !Store.state.position));
    check('and takes the card away', await page.$eval('#home-continue', (e) => e.hasAttribute('hidden')));
    check('so the read shortcut offers the beginning again',
        (await page.textContent('#shortcut-read-note')) === 'From the beginning');
    check('and the notes are untouched by it',
        (await page.evaluate(() => Store.state.notes.length)) > 0);

    // Put a place back, so what follows sees the app as it normally is.
    await page.evaluate(() => Store.savePosition({ sectionId: 'ch05', paraIndex: 12, ratio: 0.2 }));

    // ── reading without keeping your place ────────────────────────────────
    await page.click('.tab[data-screen="home"]');
    await page.click('#home-continue [data-adjust]');
    await page.waitForSelector('#continue-sheet:not([hidden])');
    check('the card offers reading without keeping your place',
        (await page.textContent('#continue-browse')) === 'Read without keeping my place');
    await page.click('#continue-browse');
    await page.waitForSelector('#screen-library.is-active');
    check('and puts you in the contents, since somewhere is the point of it', true);

    const before = await page.evaluate(() => JSON.stringify(Store.state.position));
    await page.click('.toc-item:not([disabled]) >> nth=2');   // Bill's Story
    await page.waitForSelector('#screen-reader.is-active');
    check('the reader says so, the whole time it is on', await page.isVisible('#browsing'));
    await page.evaluate(() => {
        const b = document.getElementById('reader-body');
        b.scrollTop = Math.floor(b.scrollHeight * 0.6);
    });
    await page.waitForTimeout(900);
    await page.click('#reader-back');
    await page.waitForTimeout(300);
    const after = JSON.parse(await page.evaluate(() => JSON.stringify(Store.state.position)));
    const was = JSON.parse(before);
    check('a chapter opened, scrolled and left changes nothing',
        after.sectionId === was.sectionId && after.paraIndex === was.paraIndex,
        after.sectionId + ' ¶' + after.paraIndex + ', was ' + was.sectionId + ' ¶' + was.paraIndex);

    // Leaving the reader lands back on the contents it was opened from.
    await page.click('.tab[data-screen="home"]');
    await page.waitForSelector('#screen-home.is-active');
    await page.click('#home-continue [data-adjust]');
    await page.waitForSelector('#continue-sheet:not([hidden])');
    check('and the sheet offers the way back out',
        (await page.textContent('#continue-browse')) === 'Keep my place again');
    await page.click('#continue-sheet-cancel');

    // Turning it off standing on a page keeps that page, not the one you left.
    await page.click('.tab[data-screen="library"]');
    await page.click('.toc-item:not([disabled]) >> nth=3');   // There Is A Solution
    await page.waitForSelector('#screen-reader.is-active');
    await page.evaluate(() => {
        const b = document.getElementById('reader-body');
        b.scrollTop = Math.floor(b.scrollHeight * 0.5);
    });
    await page.waitForTimeout(400);
    await page.click('#browsing-off');
    await page.waitForTimeout(400);
    check('keeping it again keeps where you have actually got to',
        (await page.evaluate(() => Store.state.position.sectionId)) === 'ch02',
        await page.evaluate(() => Store.state.position.sectionId + ' ¶' + Store.state.position.paraIndex));
    check('and the reader stops saying it', await page.$eval('#browsing', (e) => e.hasAttribute('hidden')));

    await page.click('#reader-back');
    await page.evaluate(() => Store.savePosition({ sectionId: 'ch05', paraIndex: 12, ratio: 0.2 }));
    await page.click('.tab[data-screen="settings"]');

    // ── a passing look does not move where you are up to ──────────────────
    await page.click('.tab[data-screen="library"]');
    await page.click('.toc-item:not([disabled]) >> nth=6');   // How It Works
    await page.waitForSelector('#screen-reader.is-active');
    await page.evaluate(() => {
        const b = document.getElementById('reader-body');
        b.scrollTop = Math.floor(b.scrollHeight * 0.5);
    });
    await page.waitForTimeout(900);
    await page.click('#reader-back');
    await page.waitForTimeout(300);
    const place = await page.evaluate(() =>
        Store.state.position.sectionId + ' ¶' + Store.state.position.paraIndex);

    await page.click('.tab[data-screen="home"]');
    await page.click('#passage-card');
    await page.waitForSelector('#screen-reader.is-active');
    check('a look at today\u2019s passage says it is not keeping your place',
        await page.isVisible('#browsing'));
    await page.evaluate(() => { document.getElementById('reader-body').scrollTop += 900; });
    await page.waitForTimeout(900);
    await page.click('#reader-back');
    await page.waitForTimeout(300);
    const afterLook = await page.evaluate(() =>
        Store.state.position.sectionId + ' ¶' + Store.state.position.paraIndex);
    check('and reading it leaves the percentage exactly where it was',
        afterLook === place, place + ' → ' + afterLook);

    // A search hit is the same kind of thing.
    await page.click('.tab[data-screen="search"]');
    await page.fill('#search-input', 'resentment');
    await page.waitForTimeout(500);
    await page.click('#search-results .card');
    await page.waitForSelector('#screen-reader.is-active');
    await page.waitForTimeout(600);
    await page.click('#reader-back');
    await page.waitForTimeout(300);
    check('so does jumping to a search hit',
        (await page.evaluate(() =>
            Store.state.position.sectionId + ' ¶' + Store.state.position.paraIndex)) === place);

    // But the look is over the moment you leave, and reading counts again.
    await page.click('.tab[data-screen="library"]');
    await page.click('.toc-item:not([disabled]) >> nth=3');   // There Is A Solution
    await page.waitForSelector('#screen-reader.is-active');
    check('opening a chapter afterwards is reading again, and says nothing',
        !(await page.isVisible('#browsing')));
    await page.waitForTimeout(400);
    check('and is remembered as usual',
        (await page.evaluate(() => Store.state.position.sectionId)) === 'ch02');
    await page.click('#reader-back');
    await page.evaluate(() => Store.savePosition({ sectionId: 'ch05', paraIndex: 12, ratio: 0.2 }));
    await page.click('.tab[data-screen="settings"]');

    // A morning time reads the same either way, so prove it on an evening one.
    const evening = await page.evaluate(async () => {
        const at = new Date();
        at.setHours(18, 35, 0, 0);
        const row = await Store.saveCraving({ startedAt: at.toISOString() });
        UI.showScreen('craving');
        const shown = document.getElementById('craving-since').textContent;
        await Store.deleteCraving(row.id);
        UI.showScreen('settings');
        return shown;
    });
    check('half past six in the evening reads 18:35', evening === '18:35', evening);

    // ── how this works ────────────────────────────────────────────────────
    // This section is read by somebody who may not be at their best, so its
    // shape is part of the feature: the way in comes first, the crisis page
    // next, and the housekeeping last. Order is asserted, not left to whoever
    // appends the next panel to the bottom.
    const howPanels = await page.$$eval(
        '#screen-settings .panel-flush > .disclosure > summary',
        (nodes) => nodes.map((n) => n.textContent.trim()));
    check('How this works opens with the way in', howPanels[0] === 'Start here',
        howPanels[0]);
    check('and the craving page is second, not buried',
        howPanels[1] === 'When a craving comes', howPanels[1]);
    check('and the housekeeping sits at the bottom',
        howPanels[howPanels.length - 1] === 'Nothing leaves this phone',
        howPanels[howPanels.length - 1]);
    check('every panel folds away shut', !(await page.$$eval(
        '#screen-settings .panel-flush > .disclosure',
        (nodes) => nodes.some((n) => n.hasAttribute('open')))));

    // Start here has to answer three questions to be worth its place: why the
    // app exists, what happens to what you write, and what a normal week is.
    await page.click('#screen-settings .panel-flush > .disclosure:first-child > summary');
    await page.waitForTimeout(150);
    const startHere = await page.$eval(
        '#screen-settings .panel-flush > .disclosure:first-child .disclosure-body',
        (e) => e.innerText);
    check('it points at the craving page before anything else',
        startHere.indexOf('I have a craving') > -1 &&
        startHere.indexOf('I have a craving') < startHere.indexOf('Why this exists'));
    check('it says why the app exists', /Why this exists/.test(startHere));
    check('it says nothing written leaves the phone',
        /leaves this phone unless you send it yourself/.test(startHere));
    check('it says how the rest of the section is arranged',
        /What is below/.test(startHere));
    check('and walks through an ordinary week',
        /An ordinary week/.test(startHere) &&
        (await page.$$eval(
            '#screen-settings .panel-flush > .disclosure:first-child li',
            (e) => e.length)) === 6);
    await page.click('#screen-settings .panel-flush > .disclosure:first-child > summary');

    // No sentence in the section may run past 40 words. The long ones were
    // the actual fault here: fifty-two words of subordinate clauses is not
    // readable by somebody white-knuckling it.
    // textContent, not innerText: these panels are shut, and innerText reads
    // as empty on anything hidden — which would pass this check by measuring
    // nothing at all.
    const longest = await page.$$eval('#screen-settings .panel-flush .disclosure-body',
        (bodies) => {
            let worst = 0;
            let text = '';
            let seen = 0;
            bodies.forEach((b) => {
                const flat = b.textContent.replace(/\s+/g, ' ').trim();
                seen += flat.split(' ').length;
                flat.split(/(?<=[.!?])\s+/).forEach((sentence) => {
                    const words = sentence.trim().split(/\s+/).length;
                    if (words > worst) { worst = words; text = sentence; }
                });
            });
            return { worst: worst, text: text, seen: seen };
        });
    check('the whole section is actually being read to check it',
        longest.seen > 1500, longest.seen + ' words');
    check('no sentence in it runs past 40 words', longest.worst <= 40,
        longest.worst + 'w: ' + longest.text.slice(0, 70));

    // The whole version history is one row until it is asked for, and carries
    // the version actually running rather than a number typed into the markup.
    check('the version history is folded away, in one row',
        !(await page.$eval('#version-history', (e) => e.hasAttribute('open'))) &&
        (await page.textContent('#version-history-tag')) ===
            (await page.evaluate(() => APP_VERSION)),
        await page.textContent('#version-history-tag'));
    await page.click('#version-history > summary');
    await page.waitForTimeout(150);
    check('and opens on the whole stack',
        (await page.$$eval('#version-history .disclosure-list > .disclosure', (e) => e.length)) > 20);
    await page.click('#version-history > summary');

    // ── offline ───────────────────────────────────────────────────────────
    await page.waitForTimeout(500);
    check('service worker registers',
        await page.evaluate(() => navigator.serviceWorker.ready.then(() => true).catch(() => false)));
    await context.setOffline(true);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#screen-home.is-active', { timeout: 10000 });
    // Wait for it rather than reading it the instant the screen appears: the
    // first load after a cache name changes can still be settling.
    await page.waitForFunction(
        () => (document.getElementById('passage-text').textContent || '').trim().length > 40,
        null, { timeout: 5000 });
    check('today\u2019s passage is there with the network off', true);
    await openContents(page);
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
    await shot(page, 'shot-contents.png');
    await page.click('.tab[data-screen="home"]');
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
