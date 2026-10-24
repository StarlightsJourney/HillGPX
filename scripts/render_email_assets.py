#!/usr/bin/env python3
"""Render the decorative topographic strip for the auth email templates.

Crops a band from the Bukit Timah hero terrain tint and draws the 10 m contour
lines over it. Writes public/email/topo-strip.png (2x resolution for retina
clients; templates display it at 520 px wide). Re-run if the hero assets or
the look change. Requires Pillow.
"""
import json
import re
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
TINT = ROOT / "public/hero/bukit-timah-tint.png"
CONTOURS = ROOT / "public/hero/bukit-timah-contours.json"
OUT = ROOT / "public/email/topo-strip.png"

# Output is displayed at 520x72; render at 2x.
OUT_W, OUT_H = 1040, 144

# Band to crop from the tint (image is 1121x589). Chosen to cross the dense
# contours around the summit area.
CROP_Y0, CROP_Y1 = 148, 305

LINE = (108, 125, 94, 190)      # muted olive, works over the greens and tans
LINE_W = 2                      # in the 2x crop space
INDEX_EVERY = 5                 # every 5th contour drawn heavier, topo-map style
INDEX_W = 3


def parse_path(d):
    """Turn an 'M..L..' SVG path (absolute moveto/lineto only) into polylines."""
    polys, cur = [], None
    for cmd, args in re.findall(r"([ML])([\d\s.-]+)", d):
        nums = [float(n) for n in args.split()]
        pts = list(zip(nums[0::2], nums[1::2]))
        if cmd == "M":
            cur = pts
            polys.append(cur)
        elif cur is not None:
            cur.extend(pts)
    return polys


def main():
    tint = Image.open(TINT).convert("RGB")
    tw, th = tint.size

    data = json.loads(CONTOURS.read_text())
    sx, sy = tw / data["width"], th / data["height"]

    crop = tint.crop((0, CROP_Y0, tw, CROP_Y1))
    ow = Image.new("RGBA", crop.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(ow)
    for i, line in enumerate(data["lines"]):
        w = INDEX_W if i % INDEX_EVERY == 0 else LINE_W
        for poly in parse_path(line["d"]):
            if len(poly) < 2:
                continue
            pts = [
                (x * sx - 0, (y * sy) - CROP_Y0) for x, y in poly
            ]
            draw.line(pts, fill=LINE, width=w, joint="curve")

    band = Image.alpha_composite(crop.convert("RGBA"), ow)
    band = band.resize((OUT_W, OUT_H), Image.LANCZOS)

    # Gentle vertical fade so the strip melts into the white card body.
    band = band.convert("RGB")
    grad = Image.new("L", (1, OUT_H))
    for y in range(OUT_H):
        t = y / (OUT_H - 1)
        grad.putpixel((0, y), 0 if t < 0.55 else int(255 * (t - 0.55) / 0.45))
    white = Image.new("RGB", band.size, (255, 255, 255))
    band = Image.composite(white, band, grad.resize(band.size))

    OUT.parent.mkdir(parents=True, exist_ok=True)
    band.save(OUT, optimize=True)
    print(f"wrote {OUT} ({OUT_W}x{OUT_H})")


if __name__ == "__main__":
    main()
