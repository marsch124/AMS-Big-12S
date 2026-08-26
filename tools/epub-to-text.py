#!/usr/bin/env python3
"""Convert an EPUB of the book into the plain text that the importer expects.

The output is deliberately plain text rather than JSON so that it goes through
exactly the same parser as an in-app import (js/parser.js), and so you can read
and correct it by hand before baking it in.

    python3 tools/epub-to-text.py book.epub -o alcoholics-anonymous-1939.txt
    node tools/build-book.js alcoholics-anonymous-1939.txt

Reprints often wrap a public-domain text in modern, still-copyrighted front and
back matter — a new introduction, editor's notes, author biographies. Those are
skipped by default (see SKIP_HEADINGS); --keep-all turns that off. Always check
the report this prints against the edition in your hands.
"""

import argparse
import html
import os
import posixpath
import re
import sys
import zipfile
from html.parser import HTMLParser
import xml.etree.ElementTree as ET

OPF_NS = '{http://www.idpf.org/2007/opf}'
CONTAINER_NS = '{urn:oasis:names:tc:opendocument:xmlns:container}'

BLOCK_TAGS = {'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'blockquote', 'div'}
HEADING_TAGS = {'h1', 'h2', 'h3', 'h4', 'h5', 'h6'}

# Headings that mark matter added by a modern publisher rather than the
# original text. Matched case-insensitively against the whole heading.
SKIP_HEADINGS = [
    r'^cover$',
    r'^title\s*page$',
    r'^copyright$',
    r'^contents$',
    r'^table\s+of\s+contents$',
    r'^introduction\s+to\s+the\s+.*edition$',
    r'^publisher.s\s+note$',
    r'^about\s+the\s+(author|editor)$',
    r'^about\s+[a-z]+\.?\s+[a-z]\.?$',        # "About Bill W.", "About Dick B."
]

# Whole spine documents to skip on filename alone, before any heading is read.
SKIP_FILES = [r'cover', r'_title', r'_copyright', r'_contents', r'/end\.x?html?$']


class BlockExtractor(HTMLParser):
    """Collect (tag, class, text) for each block-level element, in order."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.blocks = []
        self._spans = []          # one flag per open <span>: is it small-caps?
        self._buf = []
        self._tag = None
        self._class = ''

    def handle_starttag(self, tag, attrs):
        if tag in BLOCK_TAGS:
            # A nested block closes the one in progress; keeps <div><p> sane.
            self._flush()
            self._tag = tag
            self._class = dict(attrs).get('class', '') or ''
            self._buf = []
        elif tag in ('span', 'small'):
            # This EPUB spells small capitals two ways: <span class="smallcaps">
            # in most chapters, plain <small> in the Foreword.
            classes = (dict(attrs).get('class', '') or '').split()
            self._spans.append(tag == 'small' or 'smallcaps' in classes)
        elif tag == 'br' and self._tag:
            self._buf.append(' ')

    def handle_endtag(self, tag):
        if tag in ('span', 'small'):
            if self._spans:
                self._spans.pop()
        elif tag == self._tag:
            self._flush()

    def handle_data(self, data):
        if not self._tag:
            return
        # The print edition opens a chapter with a drop cap followed by small
        # capitals: "R" + "ARELY". Taken literally that yields "RARELY have we
        # seen", which reads as shouting. Lowering just the small-caps span
        # restores "Rarely have we seen" and leaves genuine capitals — the
        # "ALCOHOLICS ANONYMOUS" in chapter two, "S. S." — untouched.
        if any(self._spans):
            data = data.lower()
        self._buf.append(data)

    def _flush(self):
        if not self._tag:
            return
        text = re.sub(r'\s+', ' ', ''.join(self._buf)).strip()
        if text:
            self.blocks.append((self._tag, self._class, text))
        self._tag, self._class, self._buf = None, '', []

    def close(self):
        super().close()
        self._flush()


def read_spine(zf):
    """Return (spine paths in reading order, book title from the OPF metadata)."""
    container = ET.fromstring(zf.read('META-INF/container.xml'))
    rootfile = container.find(f'.//{CONTAINER_NS}rootfile')
    opf_path = rootfile.get('full-path')
    opf_dir = posixpath.dirname(opf_path)

    opf = ET.fromstring(zf.read(opf_path))
    manifest = {
        item.get('id'): item.get('href')
        for item in opf.iter(f'{OPF_NS}item')
    }
    spine = []
    for ref in opf.iter(f'{OPF_NS}itemref'):
        href = manifest.get(ref.get('idref'))
        if not href:
            continue
        spine.append(posixpath.normpath(posixpath.join(opf_dir, href)))

    title_el = opf.find('.//{http://purl.org/dc/elements/1.1/}title')
    title = (title_el.text or '') if title_el is not None else ''
    return spine, title


def word_for_number(text):
    """'Chapter One' -> 'CHAPTER 1' so the parser reads it as a chapter marker."""
    words = {'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5, 'six': 6,
             'seven': 7, 'eight': 8, 'nine': 9, 'ten': 10, 'eleven': 11, 'twelve': 12}
    m = re.match(r'^chapter\s+([a-z]+)$', text.strip(), re.I)
    if m and m.group(1).lower() in words:
        return 'CHAPTER %d' % words[m.group(1).lower()]
    return text


def should_skip_heading(heading):
    return any(re.match(p, heading.strip(), re.I) for p in SKIP_HEADINGS)


# Function words that can never be a proper noun, so lowering them is safe.
OPENING_FUNCTION_WORD = re.compile(
    r'^([A-Z][a-z’\']+,?\s+)((?:OF|THE|IN|AT|TO|AND|A|AN|FOR|WITH|ON|MY|HIS|HER)\s+)'
    r'(?=[A-Z][a-z])'
)


def fix_opening(text):
    """Lower a stray capitalised function word left in a chapter's first words.

    The small-caps run that opens a chapter is not always fully marked up: the
    Doctor's Opinion tags only the "E" of "WE OF", leaving "We OF Alcoholics".
    Only a following function word is touched, and only when the word after it
    is ordinary title case, so real capitals are never disturbed.
    """
    return OPENING_FUNCTION_WORD.sub(lambda m: m.group(1) + m.group(2).lower(), text)


def convert(epub_path, keep_all=False):
    out = []
    report = []

    def is_title_page(headings, paragraphs):
        """A half-title page: the book's own title, set as headings, no body.

        Distinguished from a genuine part divider like "PERSONAL STORIES",
        which also has no body but is not the book's title.
        """
        if paragraphs or not headings or not book_title:
            return False
        joined = re.sub(r'[^a-z]+', ' ', ' '.join(headings).lower()).strip()
        wanted = re.sub(r'[^a-z]+', ' ', book_title.lower()).strip()
        return bool(joined) and (joined == wanted or wanted.startswith(joined))

    with zipfile.ZipFile(epub_path) as zf:
        names = set(zf.namelist())
        spine, book_title = read_spine(zf)
        for path in spine:
            if path not in names:
                report.append(('missing', path, ''))
                continue
            if not keep_all and any(re.search(p, path, re.I) for p in SKIP_FILES):
                report.append(('skip-file', path, ''))
                continue

            parser = BlockExtractor()
            parser.feed(zf.read(path).decode('utf-8', errors='replace'))
            parser.close()
            blocks = parser.blocks
            if not blocks:
                report.append(('empty', path, ''))
                continue

            headings = [t for tag, _, t in blocks if tag in HEADING_TAGS]
            title = headings[-1] if headings else ''

            if not keep_all and any(should_skip_heading(h) for h in headings):
                report.append(('skip-heading', path, title))
                continue

            paragraphs = [t for tag, _, t in blocks if tag not in HEADING_TAGS]

            if not keep_all and is_title_page(headings, paragraphs):
                report.append(('skip-title', path, ' / '.join(headings)))
                continue
            if not paragraphs and not title:
                report.append(('empty', path, ''))
                continue

            # A part divider ("PERSONAL STORIES") has a heading and no body;
            # keep it, it becomes a section marker in the contents list.
            for tag, cls, text in blocks:
                if tag in HEADING_TAGS:
                    marked = word_for_number(text)
                    # "# " marks a heading unambiguously, so the parser never has
                    # to guess from capitalisation — this book sets whole lines of
                    # prose in capitals, and those must stay prose.
                    out.append('# ' + (marked if re.match(r'^CHAPTER \d+$', marked)
                                       else text.upper()))
                    out.append('')
                else:
                    # Only the first paragraph of a document opens with a drop
                    # cap, so that is the only place the repair is needed.
                    out.append(fix_opening(text) if text == paragraphs[0] else text)
                    out.append('')

            report.append(('keep', path, '%s (%d ¶)' % (title, len(paragraphs))))

    return '\n'.join(out).rstrip() + '\n', report


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('epub', help='path to the .epub file')
    ap.add_argument('-o', '--out', help='output .txt (default: alongside the epub)')
    ap.add_argument('--keep-all', action='store_true',
                    help='do not skip publisher front/back matter')
    args = ap.parse_args()

    if not os.path.exists(args.epub):
        sys.exit('No such file: ' + args.epub)

    text, report = convert(args.epub, args.keep_all)
    out = args.out or os.path.splitext(args.epub)[0] + '.txt'
    with open(out, 'w', encoding='utf-8') as handle:
        handle.write(text)

    kept = [r for r in report if r[0] == 'keep']
    skipped = [r for r in report if r[0].startswith('skip')]

    print('Wrote %s  (%d chars, %d words)' % (out, len(text), len(text.split())))
    print('\nKept %d documents:' % len(kept))
    for _, path, note in kept:
        print('   + %-44s %s' % (posixpath.basename(path), note))
    if skipped:
        print('\nSkipped %d documents (publisher matter, not the original text):' % len(skipped))
        for kind, path, note in skipped:
            print('   - %-44s %s' % (posixpath.basename(path), note or kind))
        print('\n   Re-run with --keep-all to include them.')


if __name__ == '__main__':
    main()
