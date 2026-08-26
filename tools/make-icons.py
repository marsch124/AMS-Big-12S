#!/usr/bin/env python3
"""Generate the PWA icon set for AMS Big 12S.

No third-party dependencies: PNGs are encoded directly with zlib. Shapes are
drawn from signed-distance functions so the edges come out smooth at every size.

Usage:  python3 tools/make-icons.py
"""

import math
import os
import struct
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))
ICON_DIR = os.path.join(os.path.dirname(HERE), "icons")

ACCENT = (0x8C, 0x6D, 0x46)
INK = (0x3A, 0x32, 0x26)
CREAM = (0xF4, 0xEC, 0xD8)
PAGE = (0xFB, 0xF6, 0xEA)


def rounded_rect_sdf(px, py, cx, cy, half_w, half_h, radius):
    """Signed distance from (px, py) to a rounded rectangle. Negative = inside."""
    dx = abs(px - cx) - (half_w - radius)
    dy = abs(py - cy) - (half_h - radius)
    outside = math.hypot(max(dx, 0.0), max(dy, 0.0))
    inside = min(max(dx, dy), 0.0)
    return outside + inside - radius


def coverage(sdf):
    """Turn a distance in pixels into an alpha value, giving a 1px soft edge."""
    return min(1.0, max(0.0, 0.5 - sdf))


def blend(dst, src, alpha):
    return tuple(int(round(dst[i] + (src[i] - dst[i]) * alpha)) for i in range(3))


def render(size, full_bleed):
    """Draw the icon: a book standing on a warm background.

    full_bleed keeps the background square (for maskable and Apple icons, where
    the platform applies its own mask); otherwise the corners are rounded.
    """
    s = float(size)
    bg_radius = 0.0 if full_bleed else s * 0.22

    # Book geometry, all proportional so every size looks identical.
    book_w, book_h = s * 0.54, s * 0.62
    book_cx, book_cy = s * 0.5, s * 0.5
    book_r = s * 0.045
    spine_w = s * 0.032
    ribbon_w = s * 0.075
    ribbon_top = book_cy - book_h / 2
    ribbon_h = s * 0.30
    ribbon_cx = book_cx + book_w * 0.28

    pixels = []
    for y in range(size):
        row = bytearray()
        py = y + 0.5
        for x in range(size):
            px = x + 0.5

            bg_alpha = coverage(rounded_rect_sdf(px, py, s / 2, s / 2, s / 2, s / 2, bg_radius))
            if bg_alpha <= 0.0:
                row += b"\x00\x00\x00\x00"
                continue

            colour = ACCENT

            # Page block, offset slightly right so the closed book reads as pages.
            pages_alpha = coverage(rounded_rect_sdf(
                px, py, book_cx + s * 0.02, book_cy, book_w / 2, book_h / 2 - s * 0.012, book_r))
            if pages_alpha > 0:
                colour = blend(colour, PAGE, pages_alpha)

            # Cover.
            cover_alpha = coverage(rounded_rect_sdf(
                px, py, book_cx - s * 0.015, book_cy, book_w / 2, book_h / 2, book_r))
            if cover_alpha > 0:
                colour = blend(colour, CREAM, cover_alpha)

            # Spine.
            spine_alpha = coverage(rounded_rect_sdf(
                px, py, book_cx - book_w * 0.30, book_cy,
                spine_w / 2, book_h / 2 - s * 0.03, spine_w / 2))
            if spine_alpha > 0:
                colour = blend(colour, INK, spine_alpha * 0.55)

            # Ribbon bookmark hanging over the top edge.
            ribbon_alpha = coverage(rounded_rect_sdf(
                px, py, ribbon_cx, ribbon_top + ribbon_h / 2,
                ribbon_w / 2, ribbon_h / 2, s * 0.012))
            if ribbon_alpha > 0:
                colour = blend(colour, INK, ribbon_alpha)

            alpha = int(round(bg_alpha * 255))
            row += bytes((colour[0], colour[1], colour[2], alpha))
        pixels.append(row)
    return pixels


def write_png(path, size, rows):
    raw = b"".join(b"\x00" + bytes(row) for row in rows)

    def chunk(tag, data):
        body = tag + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)

    header = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    png = (b"\x89PNG\r\n\x1a\n"
           + chunk(b"IHDR", header)
           + chunk(b"IDAT", zlib.compress(raw, 9))
           + chunk(b"IEND", b""))
    with open(path, "wb") as handle:
        handle.write(png)
    return len(png)


TARGETS = [
    ("icon-192.png", 192, False),
    ("icon-512.png", 512, False),
    ("icon-512-maskable.png", 512, True),
    ("apple-touch-icon.png", 180, True),
    ("favicon-64.png", 64, False),
]


def main():
    os.makedirs(ICON_DIR, exist_ok=True)
    for name, size, full_bleed in TARGETS:
        path = os.path.join(ICON_DIR, name)
        written = write_png(path, size, render(size, full_bleed))
        print("wrote %-24s %4dpx  %6d bytes" % (name, size, written))


if __name__ == "__main__":
    main()
