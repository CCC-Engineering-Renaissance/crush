"""Turn a logo into the class map behind the site's ASCII art (portal/js/art/).

Only needed if a logo changes. From this folder:

    python3 ascii-logo.py ../../logo.png ../js/art/bull-map.js
    python3 ascii-logo.py ../../crushdepth.png ../js/art/crush-map.js --width 200
    python3 ascii-logo.py ../../logo.png ../js/art/bull-map.js --preview /tmp/bull

--width sets the map's width in samples (default 240). --preview also writes ASCII previews
(text and PNG) at a few widths, using the same sampling as the browser (portal/js/art/engine.js).
Needs Pillow.
"""
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

# 0 empty, 2 light grey (steam), 3 grey (head, horns), 4 black (gear, outlines), 5 green, 6 blue
EMPTY, LIGHT, GREY, BLACK, GREEN, BLUE = 0, 2, 3, 4, 5, 6
TONE = {EMPTY: 0.0, LIGHT: 0.34, GREY: 0.58, BLACK: 1.0, GREEN: 0.86, BLUE: 0.86}
RAMP = " .:-=+*#%@"
MAP_W = 240


def classify(r, g, b, a):
    if a < 110:
        return EMPTY
    mx, mn = max(r, g, b), min(r, g, b)
    if mx - mn > 55:
        if g >= b and g >= r:
            return GREEN
        if b >= g and b >= r:
            return BLUE
    lum = (r + g + b) / 3
    if lum < 72:
        return BLACK
    if lum < 172:
        return GREY
    return LIGHT


def class_map(path, map_w=MAP_W):
    im = Image.open(path).convert('RGBA')
    box = im.getbbox()
    im = im.crop(box)
    w, h = im.size
    MAP_W = map_w
    map_h = round(MAP_W * h / w)
    px = im.load()
    grid = []
    for my in range(map_h):
        row = []
        y0, y1 = int(my * h / map_h), max(int((my + 1) * h / map_h), int(my * h / map_h) + 1)
        for mx in range(MAP_W):
            x0, x1 = int(mx * w / MAP_W), max(int((mx + 1) * w / MAP_W), int(mx * w / MAP_W) + 1)
            counts = {}
            for yy in range(y0, y1):
                for xx in range(x0, x1):
                    k = classify(*px[xx, yy])
                    counts[k] = counts.get(k, 0) + 1
            row.append(max(counts, key=counts.get))
        grid.append(row)
    return grid


def rle(grid):
    flat = [c for row in grid for c in row]
    out, i = [], 0
    while i < len(flat):
        j = i
        while j < len(flat) and flat[j] == flat[i] and j - i < 1295:
            j += 1
        n = j - i
        # class digit, then the run length in base 36 when longer than 1, then a separator
        out.append(f"{flat[i]}{'' if n == 1 else base36(n)}")
        i = j
    return ','.join(out)


def base36(n):
    s = ''
    while n:
        n, r = divmod(n, 36)
        s = '0123456789abcdefghijklmnopqrstuvwxyz'[r] + s
    return s


def render(grid, cols, cell_aspect=2.0):
    """Same sampling the browser does: each character cell averages the classes it covers."""
    mh, mw = len(grid), len(grid[0])
    rows = max(1, round(cols * (mh / mw) / cell_aspect))
    lines, classes = [], []
    for cy in range(rows):
        line, cls_row = '', []
        y0, y1 = int(cy * mh / rows), max(int((cy + 1) * mh / rows), int(cy * mh / rows) + 1)
        for cx in range(cols):
            x0, x1 = int(cx * mw / cols), max(int((cx + 1) * mw / cols), int(cx * mw / cols) + 1)
            counts, n, tone = {}, 0, 0.0
            for yy in range(y0, y1):
                for xx in range(x0, x1):
                    k = grid[yy][xx]
                    n += 1
                    tone += TONE[k]
                    if k:
                        counts[k] = counts.get(k, 0) + 1
            tone /= n
            if not counts or tone < 0.06:
                line += ' '
                cls_row.append(0)
                continue
            # A thin black line inside grey should still read as a line.
            dom = max(counts, key=lambda k: counts[k] * (1.6 if k in (BLACK, GREEN, BLUE) else 1))
            idx = min(len(RAMP) - 1, max(1, round(tone * (len(RAMP) - 1))))
            line += RAMP[idx]
            cls_row.append(dom)
        lines.append(line)
        classes.append(cls_row)
    return lines, classes


COLORS = {0: '#ffffff', 2: '#b9c0ca', 3: '#7d8794', 4: '#1b1f27', 5: '#6fa02a', 6: '#1e9ac2'}


def preview_png(lines, classes, out):
    font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf', 12)
    cw, ch = 7.2, 14.4
    img = Image.new('RGB', (int(cw * len(lines[0]) + 24), int(ch * len(lines) + 24)), '#f6f7f9')
    d = ImageDraw.Draw(img)
    for y, (line, cls) in enumerate(zip(lines, classes)):
        for x, (c, k) in enumerate(zip(line, cls)):
            if c != ' ':
                d.text((12 + x * cw, 12 + y * ch), c, font=font, fill=COLORS[k])
    img.save(out)


HEADER = """// {name} as a grid of colour classes, run-length encoded.
// Made from /{src} by portal/tools/ascii-logo.py. Classes: 0 empty, 2 light (white and pale grey),
// 3 grey, 4 black, 5 green, 6 blue.
// Each run is the class digit followed by its length in base 36 (no length means 1).
"""


def main():
    args = sys.argv[1:]
    preview = None
    width = MAP_W
    if '--preview' in args:
        i = args.index('--preview')
        preview = Path(args[i + 1])
        del args[i:i + 2]
    if '--width' in args:
        i = args.index('--width')
        width = int(args[i + 1])
        del args[i:i + 2]
    src, out_js = Path(args[0]), Path(args[1])
    grid = class_map(src, width)
    data = {'w': len(grid[0]), 'h': len(grid), 'rle': rle(grid)}
    name = 'The Crush Depth logo' if 'crush' in src.name.lower() else "The club's bull logo"
    out_js.write_text(HEADER.format(name=name, src=src.name) + f"export default {{ w: {data['w']}, h: {data['h']}, rle: '{data['rle']}' }};\n")
    print('map', data['w'], 'x', data['h'], '->', out_js)
    if preview:
        preview.mkdir(parents=True, exist_ok=True)
        for cols in (48, 64, 80, 96):
            lines, classes = render(grid, cols)
            (preview / f'preview-{cols}.txt').write_text('\n'.join(lines) + '\n')
            preview_png(lines, classes, preview / f'preview-{cols}.png')


if __name__ == '__main__':
    main()
