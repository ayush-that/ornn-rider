# Usage: python3 chromakey.py in.png out.png [max_width]
# Removes magenta (#FF00FF-ish) background -> alpha, trims, optionally downscales.
import sys
from PIL import Image

inp, out = sys.argv[1], sys.argv[2]
max_w = int(sys.argv[3]) if len(sys.argv) > 3 else 0

im = Image.open(inp).convert('RGBA')
px = im.load()
w, h = im.size
for y in range(h):
    for x in range(w):
        r, g, b, a = px[x, y]
        # magenta-ness: high R and B, low G
        m = min(r, b) - g
        if m > 90:
            px[x, y] = (r, g, b, 0)
        elif m > 30:  # feather edge, desaturate magenta fringe
            k = (m - 30) / 60
            px[x, y] = (int(r * (1 - k)), g, int(b * (1 - k)), int(a * (1 - k)))

bbox = im.getbbox()
if bbox:
    im = im.crop(bbox)
if max_w and im.width > max_w:
    im = im.resize((max_w, int(im.height * max_w / im.width)), Image.LANCZOS)
im.save(out)
print(out, im.size)
