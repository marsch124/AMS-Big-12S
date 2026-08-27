#!/usr/bin/env node
/*
 * build-steps.js — resolve the step material's book references into data/steps.json.
 *
 *   node tools/build-steps.js
 *   node tools/build-steps.js --check      # validate only, write nothing
 *
 * data/steps.source.json is written by hand and points at the book the way a
 * note does: a section id plus the opening words of a paragraph. This resolves
 * each of those to a paragraph index against data/book.json.
 *
 * It is deliberately unforgiving. An anchor that matches nothing, or matches
 * more than one paragraph, is an error — every failure is listed and the build
 * exits non-zero rather than shipping a link that opens the wrong passage. The
 * anchors are kept in the output as well as the indexes, so the app can
 * re-resolve at runtime if the reader ever imports a different copy of the text.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SOURCE = path.join(ROOT, 'data', 'steps.source.json');
const BOOK = path.join(ROOT, 'data', 'book.json');
const OUT = path.join(ROOT, 'data', 'steps.json');

/* Curly quotes, dashes and stray whitespace differ between what you type and
 * what the typesetter set. Compare on a flattened form of both. */
function flatten(text) {
    return String(text)
        .replace(/[‘’ʼ]/g, "'")
        .replace(/[“”]/g, '"')
        .replace(/[–—]/g, '-')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
}

function loadJson(file, label) {
    if (!fs.existsSync(file)) fail('missing ' + label + ': ' + path.relative(ROOT, file));
    try {
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (error) {
        fail('could not parse ' + label + ': ' + error.message);
    }
}

function fail(message) {
    console.error('Error: ' + message);
    process.exit(1);
}

function main(argv) {
    const checkOnly = argv.includes('--check');

    const source = loadJson(SOURCE, 'steps source');
    const book = loadJson(BOOK, 'book');

    const sections = {};
    book.sections.forEach((section) => {
        sections[section.id] = section.paragraphs.map(flatten);
    });

    const problems = [];
    let resolvedCount = 0;

    /* Returns the single paragraph index this anchor names, or records why not. */
    function resolve(ref, where) {
        const paragraphs = sections[ref.sectionId];
        if (!paragraphs) {
            problems.push(where + ': no section "' + ref.sectionId + '" in the book');
            return null;
        }
        const needle = flatten(ref.anchor);
        if (!needle) {
            problems.push(where + ': empty anchor');
            return null;
        }
        const hits = [];
        paragraphs.forEach((paragraph, index) => {
            if (paragraph.indexOf(needle) === 0) hits.push(index);
        });

        if (hits.length === 1) { resolvedCount++; return hits[0]; }
        if (hits.length === 0) {
            // A near miss is almost always a typo, so say which paragraph was close.
            const near = paragraphs.findIndex((p) => p.indexOf(needle.slice(0, 25)) === 0);
            problems.push(where + ': no paragraph in ' + ref.sectionId + ' starts with "' +
                ref.anchor.slice(0, 55) + '"' +
                (near >= 0 ? '\n      did you mean ¶' + near + '? it starts "' +
                    paragraphs[near].slice(0, 55) + '"' : ''));
        } else {
            problems.push(where + ': anchor "' + ref.anchor.slice(0, 45) +
                '" matches ' + hits.length + ' paragraphs in ' + ref.sectionId +
                ' (¶' + hits.join(', ¶') + ') — lengthen it');
        }
        return null;
    }

    const steps = source.steps.map((step) => {
        const label = 'step ' + step.number;
        const seen = {};

        (step.questions || []).forEach((q) => {
            if (!q.id) problems.push(label + ': a question has no id');
            else if (seen[q.id]) problems.push(label + ': duplicate question id "' + q.id + '"');
            seen[q.id] = true;
        });

        const text = Object.assign({}, step.text,
            { paraIndex: resolve(step.text, label + ' step text') });

        const references = (step.references || []).map((ref, i) =>
            Object.assign({}, ref, { paraIndex: resolve(ref, label + ' reference ' + (i + 1)) }));

        // A work module can point into the book too — step three and step seven
        // each show a passage. Left unresolved, a typo there would fail silently
        // at run time instead of here.
        let work = step.work;
        if (work && work.prayerRef) {
            work = Object.assign({}, work, {
                prayerRef: Object.assign({}, work.prayerRef,
                    { paraIndex: resolve(work.prayerRef, label + ' work passage') })
            });
        }

        return Object.assign({}, step, { text: text, references: references, work: work });
    });

    /* Two steps can write into one row — step nine records its progress onto the
     * entry step eight wrote. That only stays safe while their field ids are
     * distinct, so a collision is a build error rather than a silent overwrite
     * of somebody's amends list. */
    const byId = {};
    source.steps.forEach((step) => { byId[step.id] = step; });

    function fieldIds(work) {
        if (!work) return [];
        const out = [];
        (work.columns || []).forEach((c) => out.push(c.id));
        (work.fields || []).forEach((f) => out.push(f.id));
        (work.tables || []).forEach((t) => (t.columns || []).forEach((c) => out.push(c.id)));
        // step ten's watchwords and step eleven's parts are written into values
        // under their own ids, so they can collide just as a column can
        (work.watch || []).forEach((w) => out.push(w.id));
        (work.parts || []).forEach((part) => out.push(part.id));
        return out;
    }

    source.steps.forEach((step) => {
        const work = step.work;
        if (!work || !work.from || !work.from.work) return;
        const target = byId[work.from.stepId];
        if (!target) {
            problems.push('step ' + step.number + ': work reads from "' +
                work.from.stepId + '", which is not a step');
            return;
        }
        const mine = fieldIds(work);
        const theirs = fieldIds(target.work);
        const clash = mine.filter((id) => theirs.indexOf(id) !== -1);
        if (clash.length) {
            problems.push('step ' + step.number + ': writes into step ' + target.number +
                "'s rows, but both use the field id" + (clash.length === 1 ? ' ' : 's ') +
                clash.join(', ') + ' — one would overwrite the other');
        }
    });

    const numbers = steps.map((s) => s.number);
    numbers.forEach((n, i) => {
        if (numbers.indexOf(n) !== i) problems.push('duplicate step number ' + n);
    });

    if (problems.length) {
        console.error('\n' + problems.length + ' problem' + (problems.length === 1 ? '' : 's') +
            ' — nothing was written:\n');
        problems.forEach((p) => console.error('  ✗ ' + p));
        console.error('');
        process.exit(1);
    }

    const built = {
        schema: source.schema,
        title: source.title,
        edition: source.edition,
        wordingNote: source.wordingNote,
        authorNote: source.authorNote,
        builtAt: new Date().toISOString(),
        steps: steps
    };

    if (!checkOnly) {
        fs.writeFileSync(OUT, JSON.stringify(built, null, 1) + '\n', 'utf8');
    }

    // A stub carries its step text so the list can show it, but no explanation
    // yet. Counting those as "written" would flatter the build.
    const isWritten = (s) => (s.explanation || []).length > 0;
    const written = steps.filter(isWritten);

    console.log(checkOnly ? 'Checked ' + path.relative(ROOT, SOURCE)
                          : 'Wrote ' + path.relative(ROOT, OUT));
    console.log('  steps:      ' + steps.length + ' present, ' + written.length + ' written, ' +
        (steps.length - written.length) + ' still stubs');
    console.log('  references: ' + resolvedCount + ' resolved, all unambiguous');
    console.log('  questions:  ' + steps.reduce((n, s) => n + (s.questions || []).length, 0));
    console.log('');
    steps.forEach((step) => {
        console.log('   ' + String(step.number).padStart(2) + '. ' +
            step.shortTitle.padEnd(22) +
            (isWritten(step)
                ? step.references.length + ' refs, ' + (step.questions || []).length +
                  ' questions, work: ' + (step.work ? step.work.kind : 'none')
                : 'stub — text only'));
        step.references.forEach((ref) => {
            console.log('        → ' + (ref.sectionId + ' ¶' + ref.paraIndex).padEnd(16) + ref.label);
        });
    });

    const missing = [];
    for (let n = 1; n <= 12; n++) if (numbers.indexOf(n) === -1) missing.push(n);
    if (missing.length) console.log('\n  Absent entirely: step ' + missing.join(', '));
    const stubs = steps.filter((s) => !isWritten(s)).map((s) => s.number);
    if (stubs.length) console.log('\n  Awaiting content: step ' + stubs.join(', '));
}

main(process.argv);
