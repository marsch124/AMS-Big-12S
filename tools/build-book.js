#!/usr/bin/env node
/*
 * build-book.js — bake a plain-text copy of the book into data/book.json.
 *
 * This is the same parser the app uses for in-app imports (js/parser.js), so
 * the two routes cannot drift apart.
 *
 *   node tools/build-book.js path/to/alcoholics-anonymous-1939.txt
 *   node tools/build-book.js source.txt --edition "First Edition (1939)"
 *
 * Baking the text in means a fresh install can read immediately with nothing to
 * import. Only do this with a text you have the right to redistribute — the
 * 1939 first edition is public domain in the United States; later editions are
 * not.
 */

const fs = require('fs');
const path = require('path');

const BookParser = require(path.join(__dirname, '..', 'js', 'parser.js'));

function usage(message) {
    if (message) console.error('Error: ' + message + '\n');
    console.error('Usage: node tools/build-book.js <source.txt> [--edition "..."] [--out data/book.json]');
    process.exit(message ? 1 : 0);
}

function main(argv) {
    const args = argv.slice(2);
    if (!args.length || args[0] === '--help' || args[0] === '-h') usage();

    const source = args[0];
    let edition = 'First Edition (1939)';
    let out = path.join(__dirname, '..', 'data', 'book.json');

    for (let i = 1; i < args.length; i++) {
        if (args[i] === '--edition') edition = args[++i];
        else if (args[i] === '--out') out = args[++i];
        else usage('unknown option ' + args[i]);
    }

    if (!fs.existsSync(source)) usage('no such file: ' + source);

    const raw = fs.readFileSync(source, 'utf8');
    const parsed = BookParser.parse(raw);

    if (!parsed.sections.length) usage('no sections were recognised in ' + source);

    const book = {
        schema: 1,
        id: 'aa-1e',
        title: 'Alcoholics Anonymous',
        subtitle: 'The Story of How More Than One Hundred Men Have Recovered From Alcoholism',
        edition: edition,
        textIncluded: true,
        builtAt: new Date().toISOString(),
        sourceName: path.basename(source),
        sections: parsed.sections
    };

    fs.writeFileSync(out, JSON.stringify(book, null, 1) + '\n', 'utf8');

    const words = BookParser.wordCount(parsed.sections);
    console.log('Wrote ' + path.relative(process.cwd(), out));
    console.log('  sections:  ' + parsed.sections.length);
    console.log('  words:     ' + words.toLocaleString());
    console.log('  size:      ' + Math.round(fs.statSync(out).size / 1024) + ' KB');
    parsed.sections.forEach((section) => {
        console.log('   - ' + section.id.padEnd(14) + section.paragraphs.length.toString().padStart(4) +
            ' ¶  ' + section.title);
    });
    if (parsed.warnings.length) {
        console.log('\nWarnings:');
        parsed.warnings.forEach((warning) => console.log('  ! ' + warning));
    }
}

main(process.argv);
