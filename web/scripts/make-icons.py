"""Fungu app icons (provisional: the progress-ring mark). Rerun after brand approval.
Usage (from web/): python scripts/make-icons.py [bg] [track] [fill]"""
import sys
from PIL import Image, ImageDraw

defaults = ["#12233d", "#33445e", "#d98e2b"]
args = sys.argv[1:4]
bg, track, fill = args + defaults[len(args):]


def ring(size, pad_frac):
    s = size * 4
    im = Image.new("RGBA", (s, s), bg)
    d = ImageDraw.Draw(im)
    pad = s * pad_frac
    w = int(s * 0.09)
    box = [pad, pad, s - pad, s - pad]
    d.arc(box, 0, 360, fill=track, width=w)
    d.arc(box, -90, -90 + 252, fill=fill, width=w)
    return im.resize((size, size), Image.LANCZOS)


for name, size, pad in [("icon-192", 192, .2), ("icon-512", 512, .2), ("maskable-512", 512, .3),
                        ("apple-touch-icon", 180, .2), ("favicon-32", 32, .12)]:
    ring(size, pad).convert("RGB").save(f"public/icons/{name}.png", optimize=True)
print("icons written")
