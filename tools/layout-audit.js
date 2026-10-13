#!/usr/bin/env node
/*
 * layout-audit.js — the geometry gate for AMS Big 12S.
 *
 * smoke-test.js asks whether the app does the right thing. This asks whether
 * you can see it. Every bug Martin has actually reported from his phone has
 * been of the second kind and none of them had a failing check behind it:
 *
 *   2.38  the day count moved and left "Continue reading" flush against
 *         "Today's passage" — a card that had never needed a bottom margin,
 *         because until then a heading had always supplied the gap
 *   2.39  a step's review grid told you to scroll sideways in landscape,
 *         where the four columns fit, because the line was drawn once and
 *         never asked again
 *
 * Neither is a logic error. Both are two boxes in the wrong relationship, and
 * both would have been caught by walking every screen and looking. That is all
 * this does — but it does it on every screen, in every theme, at every size,
 * with the app both empty and full, which is the part a person cannot do.
 *
 *   python3 -m http.server 7802 &
 *   node tools/layout-audit.js
 *
 * Environment:
 *   BASE_URL        default http://127.0.0.1:7802/
 *   CHROMIUM_PATH   an existing Chromium binary, if Playwright cannot find one
 *   SHOT_DIR        write a screenshot of every failing state here
 *   ONLY            run only states whose label contains this string
 *
 * Exit code 0 = clean, 1 = something is wrong on a screen, 2 = the harness broke.
 */
const { chromium } = require('playwright');
const fs = require('fs');

const BASE = process.env.BASE_URL || 'http://127.0.0.1:7802/';
const SHOT_DIR = process.env.SHOT_DIR || '';
const ONLY = process.env.ONLY || '';

/* ────────────────────────────────────────────────────────────── reporting ── */

const findings = [];
let statesRun = 0;
let assertionsRun = 0;

function report(state, rule, detail) {
    findings.push({ state, rule, detail });
    console.log('  FAIL  [' + state + '] ' + rule + '\n          ' + detail);
}

/* ──────────────────────────────────────────────────────────────── the app ── */

/*
 * The sizes that matter. The landscape one is not padding: it is the shape the
 * scroll-hint bug lived in, and a phone rotates whether or not anyone planned
 * for it. The small one is an SE, which is the narrowest thing anybody still
 * reads on and the first place a two-column grid gives up.
 */
const VIEWPORTS = [
    { name: 'se', width: 375, height: 667 },
    { name: 'phone', width: 393, height: 852 },
    { name: 'landscape', width: 852, height: 393 },
];

const THEMES = ['morning', 'light', 'dark'];

/*
 * Every screen, and how to stand on it. Some are a tab; some have to be opened
 * from something else and carry an argument. `needs` marks the ones that are
 * only worth looking at once there is something in them.
 */
const SCREENS = [
    { name: 'home', open: () => UI.showScreen('home') },
    { name: 'library', open: () => UI.showScreen('library') },
    { name: 'reader', open: () => UI.openReader(Store.state.book.sections[6].id, { paraIndex: 4 }) },
    { name: 'steps', open: () => UI.showScreen('steps') },
    { name: 'step', open: () => UI.openStep('step04') },
    { name: 'step-twelve', open: () => UI.openStep('step12') },
    { name: 'tradition', open: () => { UI.showTwelves('traditions'); UI.openTradition('trad03'); } },
    { name: 'notes', open: () => UI.showScreen('notes') },
    { name: 'search', open: () => UI.showScreen('search') },
    { name: 'settings', open: () => UI.showScreen('settings') },
    { name: 'settings-open', open: () => {
        UI.showScreen('settings');
        document.querySelectorAll('#screen-settings .disclosure-section')
            .forEach((n) => { n.open = true; });
    } },
    { name: 'craving', open: () => UI.showScreen('craving') },
    { name: 'meeting', open: () => UI.showScreen('meeting') },
    { name: 'checkin', open: () => UI.showScreen('checkin') },
    { name: 'bounce', open: () => UI.showScreen('bounce') },
    { name: 'message', open: () => UI.showScreen('message') },
];

/*
 * Two data states, because a screen with nothing in it and a screen with a
 * year in it are different screens. Empty states hide overflow bugs; full
 * states hide the "we never styled the nothing case" ones.
 */
async function seedEmpty(page) {
    await page.evaluate(async () => {
        for (const store of [DB.STORE_NOTES, DB.STORE_CRAVINGS, DB.STORE_MEETINGS,
                             DB.STORE_MESSAGES, DB.STORE_CHECKINS]) {
            if (store) await DB.clear(store);
        }
        await Store.loadNotes();
        await Store.saveSettings({ soberSince: '', sponsorName: '', sponsorPhone: '',
                                   sponseeName: '', sponseePhone: '', spouseName: '',
                                   spousePhone: '' });
    });
}

/*
 * Long, awkward, real. A note the length people actually write, a name with no
 * spaces in it to break on, and a number set on everybody so the craving
 * screen shows its full stack of rows rather than its apology.
 */
async function seedFull(page) {
    await page.evaluate(async () => {
        const long = 'What I keep coming back to is that I said I would ring him and then '
            + 'did not, and the reason I did not is the same reason I did not the time '
            + 'before, which I have still not written down anywhere I will read it again.';
        const sections = Store.state.book.sections;
        for (let i = 0; i < 6; i += 1) {
            await DB.put(DB.STORE_NOTES, {
                id: 'audit-note-' + i,
                sectionId: sections[4 + i].id,
                paraIndex: i,
                anchor: 'We admitted we were powerless',
                body: i % 2 ? long : 'Short one.',
                tag: ['sponsor', 'sponsee', 'meeting', ''][i % 4],
                discussedAt: null,
                createdAt: new Date(Date.now() - i * 86400000).toISOString(),
                updatedAt: new Date(Date.now() - i * 86400000).toISOString(),
            });
        }
        await Store.loadNotes();
        await Store.savePosition({ sectionId: sections[6].id, paraIndex: 12 });
        await Store.saveSettings({
            soberSince: '2023-03-03',
            sponsorName: 'Bartholomew-Fitzwilliam',
            sponsorPhone: '+46 70 123 45 67',
            sponseeName: 'Jo',
            sponseePhone: '+46 70 765 43 21',
            spouseName: 'Kristina',
            spousePhone: '+46 70 111 22 33',
        });
    });
}

const DATA_STATES = [
    { name: 'empty', seed: seedEmpty },
    { name: 'full', seed: seedFull },
];

/* ─────────────────────────────────────────────────────────────── the rules ── */

/*
 * All of these run in the page. They return a list of complaints, each a plain
 * string, so a rule that finds three things reports three things rather than
 * "something is wrong somewhere on this screen".
 *
 * The whole file's usefulness rests on these being quiet when the app is right.
 * A rule that cries wolf gets ignored and then it is not a gate, so each one
 * carries its own exclusions and each exclusion says why.
 */
const RULES = {

    /* The page itself must never scroll sideways. Individual boxes may; the
       document may not. This is the cheapest true statement about a phone. */
    'the page never scrolls sideways': function (screen) {
        const d = document.documentElement;
        if (d.scrollWidth > d.clientWidth + 1) {
            return ['document is ' + d.scrollWidth + 'px wide in a '
                + d.clientWidth + 'px window'];
        }
        return [];
    },

    /* Nothing sticks out past the edge of the screen it lives on. Anything
       inside a box that is allowed to scroll sideways is exempt — that is what
       those boxes are for. */
    'nothing spills out of the screen': function (screen) {
        const root = document.querySelector('#screen-' + screen + '.is-active');
        if (!root) return ['screen-' + screen + ' is not the active screen'];
        const bounds = root.getBoundingClientRect();
        const out = [];
        root.querySelectorAll('*').forEach((el) => {
            if (!isShown(el)) return;
            if (insideAScroller(el, root)) return;
            const r = el.getBoundingClientRect();
            if (r.width === 0) return;
            if (r.right > bounds.right + 1) {
                out.push(describe(el) + ' reaches ' + Math.round(r.right - bounds.right)
                    + 'px past the right edge');
            }
            if (r.left < bounds.left - 1) {
                out.push(describe(el) + ' starts ' + Math.round(bounds.left - r.left)
                    + 'px past the left edge');
            }
        });
        return dedupe(out);
    },

    /* Two cards stacked on each other must have air between them. This is the
       2.38 bug stated as a rule: it went unnoticed because the gap had always
       been supplied by whatever happened to be next, and nothing said it had
       to be. Six pixels, because below that it reads as a mistake. */
    'stacked cards do not touch': function (screen) {
        const root = document.querySelector('#screen-' + screen + '.is-active');
        if (!root) return [];
        const body = root.querySelector('.screen-body') || root;
        /* .step-item is deliberately not here: the twelve are a list of rows
           separated by hairline borders, the way a table is, not a stack of
           cards that each need air. Flush is the design there. */
        const CARD = '.card, .passage-card, .continue-card, .shortcut, .stat, .daycount,'
            + ' .do-row-alone, .note-card, .entry-card, .checkin-card, .craving-live,'
            + ' .prayer-record';
        const cards = [...body.querySelectorAll(CARD)].filter(isShown);
        const out = [];
        for (let i = 0; i < cards.length; i += 1) {
            for (let j = i + 1; j < cards.length; j += 1) {
                const a = cards[i], b = cards[j];
                if (a.contains(b) || b.contains(a)) continue;
                const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
                // only cards in the same column, one above the other
                const sameColumn = Math.abs(ra.left - rb.left) < 2
                    && Math.abs(ra.width - rb.width) < 2;
                if (!sameColumn) continue;
                const gap = rb.top - ra.bottom;
                if (gap < -1) continue;           // overlapping is a different rule
                if (gap >= 0 && gap < 6) {
                    out.push(describe(a) + ' and ' + describe(b) + ' are '
                        + Math.round(gap) + 'px apart');
                }
            }
        }
        return dedupe(out);
    },

    /* Two things you can press must not sit on top of each other: whichever is
       on top silently eats the other one's taps. */
    'tappable things do not overlap': function (screen) {
        const root = document.querySelector('#screen-' + screen + '.is-active');
        if (!root) return [];
        const hits = [...root.querySelectorAll('button, a[href], input, select, textarea')]
            .filter(isShown)
            .filter((el) => !el.closest('.continue-card'));   // the adjust dot sits on
                                                             // the card on purpose
        const out = [];
        for (let i = 0; i < hits.length; i += 1) {
            for (let j = i + 1; j < hits.length; j += 1) {
                const a = hits[i], b = hits[j];
                if (a.contains(b) || b.contains(a)) continue;
                const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
                const overlapX = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
                const overlapY = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
                if (overlapX > 2 && overlapY > 2) {
                    out.push(describe(a) + ' overlaps ' + describe(b) + ' by '
                        + Math.round(overlapX) + '×' + Math.round(overlapY) + 'px');
                }
            }
        }
        return dedupe(out);
    },

    /* What makes a control hard to hit is not falling short of 44px in one
       direction — an 816×42 bar is trivial to land on, and this app's chips are
       a deliberate 32px compact control that Martin has never once mis-tapped.
       It is being small in BOTH directions, or being a sliver in one. The first
       version of this rule used a flat 44px height and produced 372 findings,
       which is another way of producing none: a gate nobody reads is not a gate.
       (The 44px row rule in Settings is real and has its own check in
       smoke-test.js — it is about a list of identical rows, which is a different
       problem from a button.) */
    'anything you tap is big enough to hit': function (screen) {
        const root = document.querySelector('#screen-' + screen + '.is-active');
        if (!root) return [];
        const out = [];
        root.querySelectorAll('button, a[href], select, input[type="checkbox"]')
            .forEach((el) => {
                if (!isShown(el)) return;
                if (el.closest('p, .disclosure-body, .panel-note')) return;
                /* A checkbox inside a row label is not the target — the row is,
                   and Settings' rows are 44px by a rule of their own with a
                   check behind it. Tapping the words works, which is what
                   anybody actually does. */
                if (el.type === 'checkbox' && el.closest('label.row')) return;
                /* Chips are a deliberate compact control at 32px, wide, and
                   spaced. They are not a fixed row a thumb slides down, and
                   Martin has never mis-hit one. Flagging all of them was how
                   this rule first produced 372 findings and said nothing. */
                if (el.classList.contains('chip')) return;
                const r = el.getBoundingClientRect();
                const small = r.width < 44 && r.height < 44;
                const sliver = Math.min(r.width, r.height) < 28;
                if (small || sliver) {
                    out.push(describe(el) + ' is ' + Math.round(r.width) + '×'
                        + Math.round(r.height) + 'px');
                }
            });
        return dedupe(out);
    },

    /* Text that has been cut off without anybody saying so. A deliberate clamp
       (-webkit-line-clamp) or an ellipsis is a decision; hidden overflow with
       neither is an accident, and it is how a long chapter title or a Swedish
       compound noun disappears. */
    'no text is silently cut off': function (screen) {
        const root = document.querySelector('#screen-' + screen + '.is-active');
        if (!root) return [];
        const out = [];
        root.querySelectorAll('*').forEach((el) => {
            if (!isShown(el)) return;
            if (!el.textContent.trim()) return;
            if (el.children.length) return;                  // leaf text only
            const s = getComputedStyle(el);
            if (s.overflow === 'visible' && s.overflowX === 'visible') return;
            if (s.textOverflow === 'ellipsis') return;
            if (s.webkitLineClamp && s.webkitLineClamp !== 'none') return;
            if (insideAScroller(el, root)) return;
            if (el.scrollWidth > el.clientWidth + 1) {
                out.push(describe(el) + ' is cut off sideways ('
                    + el.scrollWidth + ' in ' + el.clientWidth + 'px): "'
                    + el.textContent.trim().slice(0, 40) + '"');
            }
            if (el.scrollHeight > el.clientHeight + 1) {
                out.push(describe(el) + ' is cut off vertically ('
                    + el.scrollHeight + ' in ' + el.clientHeight + 'px): "'
                    + el.textContent.trim().slice(0, 40) + '"');
            }
        });
        return dedupe(out);
    },

    /* The tab bar is fixed over the bottom of every screen but the reader. If
       the scrollable area does not end above it, the last row of the page is
       unreachable — you can see it and never touch it. */
    'nothing hides under the tab bar': function (screen) {
        if (screen === 'reader') return [];
        const bar = document.getElementById('tabbar');
        if (!bar || bar.hidden) return [];
        const barTop = bar.getBoundingClientRect().top;
        const root = document.querySelector('#screen-' + screen + '.is-active');
        const body = root && root.querySelector('.screen-body');
        if (!body) return [];
        // scroll to the very bottom and see what the last thing is
        body.scrollTop = body.scrollHeight;
        const out = [];
        [...body.querySelectorAll('button, a[href], input, select, textarea')]
            .filter(isShown)
            .forEach((el) => {
                const r = el.getBoundingClientRect();
                if (r.top < barTop && r.bottom > barTop + 2) {
                    out.push(describe(el) + ' is half under the tab bar');
                }
            });
        return dedupe(out);
    },

    /* Everything drawn must be readable against what is behind it. The smoke
       test audits the palette's declared colours; this catches the pairing that
       only happens once a particular element lands on a particular ground. */
    'text is readable on what is behind it': function (screen) {
        const root = document.querySelector('#screen-' + screen + '.is-active');
        if (!root) return [];
        const out = [];
        root.querySelectorAll('*').forEach((el) => {
            if (!isShown(el)) return;
            if (el.children.length) return;
            const text = el.textContent.trim();
            if (!text) return;
            const s = getComputedStyle(el);
            const fg = parseColour(s.color);
            const bg = behind(el);
            if (!fg || !bg) return;
            const size = parseFloat(s.fontSize);
            const bold = parseInt(s.fontWeight, 10) >= 600;
            const large = size >= 24 || (size >= 18.66 && bold);
            const need = large ? 3 : 4.5;
            const got = contrast(fg, bg);
            if (got < need - 0.05) {
                out.push(describe(el) + ' is ' + got.toFixed(2) + ':1 (needs '
                    + need + ') — "' + text.slice(0, 30) + '"');
            }
        });
        return dedupe(out);
    },
};

/* ─────────────────────────────────────────── helpers, injected in the page ── */

const HELPERS = function () {
    window.__audit = {};

    window.isShown = function (el) {
        if (!el || el.nodeType !== 1) return false;
        if (el.hasAttribute('hidden')) return false;
        const s = getComputedStyle(el);
        if (s.display === 'none' || s.visibility === 'hidden' || s.opacity === '0') return false;
        const r = el.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) return false;
        /* Inside a folded <details>. Chrome still lays these out — real
           coordinates, display:block, visibility:visible — so every field in
           Settings' ten shut sections stacks up at the same place and reads as
           a pile of overlapping inputs. Nothing can actually reach them:
           elementFromPoint over one returns the <summary>, and Tab walks past
           them. Verified before excluding them, because "the test is wrong" is
           the most expensive thing to assume and be mistaken about. */
        const details = el.closest('details');
        if (details && !details.hasAttribute('open') && !el.closest('summary')) return false;
        return true;
    };

    /* Inside something that is allowed to scroll sideways — a review grid, a
       code block, a row of chips. Overflow there is the design. */
    window.insideAScroller = function (el, stopAt) {
        let n = el.parentElement;
        while (n && n !== stopAt) {
            const s = getComputedStyle(n);
            if (s.overflowX === 'auto' || s.overflowX === 'scroll'
                || s.overflow === 'auto' || s.overflow === 'scroll') return true;
            n = n.parentElement;
        }
        return false;
    };

    window.describe = function (el) {
        const id = el.id ? '#' + el.id : '';
        const cls = typeof el.className === 'string' && el.className
            ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.')
            : '';
        return el.tagName.toLowerCase() + id + cls;
    };

    window.dedupe = function (list) {
        return [...new Set(list)].slice(0, 8);
    };

    window.parseColour = function (value) {
        const n = (value || '').match(/[\d.]+/g);
        if (!n) return null;
        if (n.length >= 4 && parseFloat(n[3]) === 0) return null;
        return [+n[0], +n[1], +n[2]];
    };

    /* The nearest ancestor that actually paints something. A transparent
       background is not a background; walking up until one is found is what
       the eye does. */
    window.behind = function (el) {
        let n = el;
        while (n && n.nodeType === 1) {
            const c = window.parseColour(getComputedStyle(n).backgroundColor);
            if (c) return c;
            n = n.parentElement;
        }
        return [255, 255, 255];
    };

    window.contrast = function (a, b) {
        const lum = (c) => {
            const [r, g, bl] = c.map((v) => {
                const x = v / 255;
                return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
            });
            return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
        };
        const la = lum(a), lb = lum(b);
        return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
    };
};

/* ────────────────────────────────────────────────────────────────── driver ── */

async function auditState(page, label, screen, rules) {
    statesRun += 1;
    let failedHere = false;
    for (const rule of rules) {
        assertionsRun += 1;
        const complaints = await page.evaluate(
            ([name, scr]) => window.__rules[name](scr), [rule, screen]);
        for (const complaint of complaints) {
            report(label, rule, complaint);
            failedHere = true;
        }
    }
    if (failedHere && SHOT_DIR) {
        fs.mkdirSync(SHOT_DIR, { recursive: true });
        await page.screenshot({ path: SHOT_DIR + '/' + label.replace(/[^\w.-]/g, '_') + '.png' });
    }
}

async function main() {
    const launch = {};
    if (process.env.CHROMIUM_PATH) launch.executablePath = process.env.CHROMIUM_PATH;
    const browser = await chromium.launch(launch);

    // Geometry does not depend on the theme, and colour does not depend on the
    // window. Running the full cross-product would be four times the work for
    // the same findings, so each axis is walked against the rules it can break.
    const GEOMETRY = ['the page never scrolls sideways', 'nothing spills out of the screen',
        'stacked cards do not touch', 'tappable things do not overlap',
        'anything you tap is big enough to hit', 'no text is silently cut off',
        'nothing hides under the tab bar'];
    const COLOUR = ['text is readable on what is behind it'];

    for (const viewport of VIEWPORTS) {
        const context = await browser.newContext({
            viewport: { width: viewport.width, height: viewport.height },
            deviceScaleFactor: 2,
        });
        const page = await context.newPage();
        page.on('pageerror', (e) => report('page', 'no script errors', e.message));
        await page.goto(BASE, { waitUntil: 'networkidle' });
        await page.waitForFunction(() => window.Store && Store.state && Store.state.book
            && Store.state.book.sections && Store.state.book.sections.length > 6);
        await page.evaluate(HELPERS);
        await page.evaluate(`window.__rules = {${Object.entries(RULES)
            .map(([k, fn]) => JSON.stringify(k) + ':' + fn.toString()).join(',')}}`);

        for (const data of DATA_STATES) {
            await data.seed(page);
            for (const screen of SCREENS) {
                const label = [viewport.name, data.name, screen.name].join('/');
                if (ONLY && label.indexOf(ONLY) === -1) continue;
                try {
                    await page.evaluate(`(${screen.open.toString()})()`);
                } catch (error) {
                    report(label, 'the screen opens at all', error.message);
                    continue;
                }
                /* Back to the top before measuring. The tab-bar rule scrolls a
                   screen to its end to see what lands there, and showScreen()
                   does not reset scroll when you return — so the second data
                   state inherited the first one's scroll position and every
                   sticky topbar read as overlapping the content beneath it.
                   Nine findings, all of them the harness's own footprint. */
                await page.evaluate(() => {
                    document.querySelectorAll('.screen-body')
                        .forEach((b) => { b.scrollTop = 0; });
                });
                await page.waitForTimeout(160);
                const real = screen.name.replace(/-.*$/, '');
                await auditState(page, label, real, GEOMETRY);

                // themes, once per screen, at the phone size only
                if (viewport.name === 'phone' && data.name === 'full') {
                    for (const theme of THEMES) {
                        await page.evaluate(async (t) => {
                            await Store.saveSettings({ theme: t });
                            UI.applySettings();
                        }, theme);
                        await page.waitForTimeout(90);
                        await auditState(page, label + '/' + theme, real, COLOUR);
                    }
                    await page.evaluate(async () => {
                        await Store.saveSettings({ theme: 'morning' });
                        UI.applySettings();
                    });
                }
            }
        }
        await context.close();
    }
    await browser.close();

    console.log('\n' + statesRun + ' page states, ' + assertionsRun + ' rule runs');
    if (!findings.length) {
        console.log('No layout faults found.');
        return 0;
    }
    const byRule = {};
    findings.forEach((f) => { byRule[f.rule] = (byRule[f.rule] || 0) + 1; });
    console.log('\n' + findings.length + ' findings:');
    Object.entries(byRule).sort((a, b) => b[1] - a[1])
        .forEach(([rule, n]) => console.log('  ' + String(n).padStart(4) + '  ' + rule));
    return 1;
}

main().then((code) => process.exit(code)).catch((error) => {
    console.error('HARNESS ERROR:', error);
    process.exit(2);
});
