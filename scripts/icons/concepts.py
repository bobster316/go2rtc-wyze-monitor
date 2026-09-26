"""Three candidate marks for the Wyze Monitor icon, rendered for review.

    python go2rtc-wyze-monitor/scripts/icons/concepts.py <out-dir>

1 Cube cam   - the camera itself as one bold silhouette (UniFi Protect approach)
2 Live stack - stacked feeds, front screen carries a record/live dot, no lens
3 View cone  - a lens projecting a field-of-view beam: "watching", abstract

All share the helpers in generate-icons.py. Designed on a 208-unit box.
"""
import csv
import importlib.util
import sys
import tempfile
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("g", HERE / "generate-icons.py")
g = importlib.util.module_from_spec(spec)
spec.loader.exec_module(g)

WIN = {"a": "#62C6FF", "b": "#1A8CF0", "c": "#0050B8", "stand": "#0B3F8F", "light": "#CFEAFF",
       "ring": "#FFFFFF", "pupil": ("#1E4E96", "#051634"), "live": "#FF3B30", "shadow": "#002A66",
       "front2": None}
PI = {"a": "#F0457A", "b": "#D01E54", "c": "#9E0F3A", "stand": "#FFFFFF", "light": "#FFFFFF",
      "ring": "#FFFFFF", "pupil": ("#3A3A3A", "#050505"), "live": "#FFFFFF", "shadow": "#000000"}


def defs(uid, t, x0, y0, s, k):
    blur = max(1.0, 3 * k)
    return f"""<defs>
    <linearGradient id="{uid}g" gradientUnits="userSpaceOnUse" x1="{x0}" y1="{y0}" x2="{x0 + s}" y2="{y0 + s}">
      <stop offset="0" stop-color="{t['a']}"/><stop offset="0.5" stop-color="{t['b']}"/><stop offset="1" stop-color="{t['c']}"/>
    </linearGradient>
    <radialGradient id="{uid}p" cx="0.38" cy="0.34" r="0.75">
      <stop offset="0" stop-color="{t['pupil'][0]}"/><stop offset="1" stop-color="{t['pupil'][1]}"/>
    </radialGradient>
    <filter id="{uid}s" x="-25%" y="-25%" width="150%" height="160%">
      <feDropShadow dx="0" dy="{2 * k:.2f}" stdDeviation="{blur * 0.6:.2f}" flood-color="{t['shadow']}" flood-opacity="0.28"/>
      <feDropShadow dx="0" dy="{6 * k:.2f}" stdDeviation="{blur * 2:.2f}" flood-color="{t['shadow']}" flood-opacity="0.20"/>
    </filter>
  </defs>"""


def lens(uid, t, x, y, ring, small, k):
    pupil = ring * (0.66 if small else 0.72)
    glint = "" if small else (
        f'<circle cx="{x - pupil * 0.36:.2f}" cy="{y - pupil * 0.36:.2f}" r="{pupil * 0.26:.2f}" fill="#fff" fill-opacity="0.92"/>')
    return (f'<circle cx="{x:.2f}" cy="{y:.2f}" r="{ring:.2f}" fill="{t["ring"]}"/>'
            f'<circle cx="{x:.2f}" cy="{y:.2f}" r="{pupil:.2f}" fill="url(#{uid}p)"/>{glint}')


def cube_cam(uid, t, cx, cy, size, small=False):
    k = size / 208.0
    x0, y0 = cx - size / 2, cy - size / 2
    bw, bh, br = 172 * k, 150 * k, (46 if small else 42) * k
    bx, by = cx - bw / 2, y0
    neck_w, base_w, base_h = 40 * k, (124 if small else 116) * k, (28 if small else 24) * k
    base_y = y0 + size - base_h
    gap = (10 if small else 7) * k
    ring = (58 if small else 50) * k
    led = "" if small else f'<circle cx="{bx + bw - 30 * k:.2f}" cy="{by + 28 * k:.2f}" r="{8 * k:.2f}" fill="{t["live"]}"/>'
    return f"""{defs(uid, t, x0, y0, size, k)}
  <g filter="url(#{uid}s)">
    <rect x="{cx - neck_w / 2:.2f}" y="{by + bh + gap:.2f}" width="{neck_w:.2f}" height="{base_y - by - bh - 2 * gap:.2f}" fill="{t['stand']}"/>
    <rect x="{cx - base_w / 2:.2f}" y="{base_y:.2f}" width="{base_w:.2f}" height="{base_h:.2f}" rx="{base_h / 2:.2f}" fill="{t['stand']}"/>
    <rect x="{bx:.2f}" y="{by:.2f}" width="{bw:.2f}" height="{bh:.2f}" rx="{br:.2f}" fill="url(#{uid}g)"/>
  </g>
  {lens(uid, t, cx, by + bh / 2, ring, small, k)}
  {led}"""


def live_stack(uid, t, cx, cy, size, small=False):
    k = size / 208.0
    layers = 1 if small else 2
    w, h, sx, sy, gap = {2: (164, 144, 20, 22, 8), 1: (176, 152, 32, 34, 14)}[layers]
    w, h, sx, sy, gap = w * k, h * k, sx * k, sy * k, gap * k
    r = (34 if small else 30) * k
    x0 = cx - (w + sx * layers) / 2
    y0 = cy - (h + sy * layers) / 2 + sy * layers
    cards = [(x0 + sx * i, y0 - sy * i) for i in range(layers + 1)]
    masks, backs = [], []
    fills = [t["light"], t["stand"]] if t is WIN else ["#FFFFFF", "#8E8E95"]
    for i in range(layers, 0, -1):
        fx, fy = cards[i - 1]
        masks.append(f"""<mask id="{uid}c{i}" maskUnits="userSpaceOnUse">
      <rect x="{cx - size}" y="{cy - size}" width="{size * 2}" height="{size * 2}" fill="#fff"/>
      <rect x="{fx - gap:.2f}" y="{fy - gap:.2f}" width="{w + 2 * gap:.2f}" height="{h + 2 * gap:.2f}" rx="{r + gap:.2f}" fill="#000"/>
    </mask>""")
        x, y = cards[i]
        backs.append(f'<rect x="{x:.2f}" y="{y:.2f}" width="{w:.2f}" height="{h:.2f}" rx="{r:.2f}" fill="{fills[i - 1]}" mask="url(#{uid}c{i})"/>')
    fx, fy = cards[0]
    rec_ring = h * (0.30 if small else 0.26)
    dot = "#FF3B30" if t is WIN else "#111111"
    front_fill = f"url(#{uid}g)"
    return f"""{defs(uid, t, fx, fy, w, k)}
  <defs>{''.join(masks)}</defs>
  <g filter="url(#{uid}s)">
    {''.join(backs)}
    <rect x="{fx:.2f}" y="{fy:.2f}" width="{w:.2f}" height="{h:.2f}" rx="{r:.2f}" fill="{front_fill}"/>
  </g>
  <circle cx="{fx + w / 2:.2f}" cy="{fy + h / 2:.2f}" r="{rec_ring:.2f}" fill="#FFFFFF"/>
  <circle cx="{fx + w / 2:.2f}" cy="{fy + h / 2:.2f}" r="{rec_ring * 0.62:.2f}" fill="{dot}"/>"""


def view_cone(uid, t, cx, cy, size, small=False):
    import math
    k = size / 208.0
    ox, oy = cx - 62 * k, cy + 62 * k          # lens (apex), lower-left
    R = 158 * k                                # beam reach
    a1, a2 = math.radians(-78), math.radians(-12)   # beam spans up-right
    half = (a2 - a1) / 2
    ring = (54 if small else 46) * k

    def pt(a, rad):
        return ox + rad * math.cos(a), oy + rad * math.sin(a)

    # Beam: a wedge with a rounded outer edge, starting just outside the lens.
    r0 = ring * 0.6
    p1, p2, p3, p4 = pt(a1, r0), pt(a1, R), pt(a2, R), pt(a2, r0)
    beam = (f"M{p1[0]:.2f},{p1[1]:.2f} L{p2[0]:.2f},{p2[1]:.2f} "
            f"A{R:.2f},{R:.2f} 0 0 1 {p3[0]:.2f},{p3[1]:.2f} L{p4[0]:.2f},{p4[1]:.2f} Z")
    gap = (12 if small else 9) * k
    fade = "" if small else f"""<linearGradient id="{uid}f" gradientUnits="userSpaceOnUse" x1="{ox}" y1="{oy}" x2="{pt((a1 + a2) / 2, R)[0]:.2f}" y2="{pt((a1 + a2) / 2, R)[1]:.2f}">
      <stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#fff" stop-opacity="0.18"/>
    </linearGradient>"""
    x0, y0 = cx - size / 2, cy - size / 2
    return f"""{defs(uid, t, x0, y0, size, k)}
  <defs>
    <mask id="{uid}m" maskUnits="userSpaceOnUse">
      <rect x="{cx - size}" y="{cy - size}" width="{size * 2}" height="{size * 2}" fill="#fff"/>
      <circle cx="{ox:.2f}" cy="{oy:.2f}" r="{ring + gap:.2f}" fill="#000"/>
    </mask>
    {fade}
  </defs>
  <g filter="url(#{uid}s)">
    <path d="{beam}" fill="url(#{uid}g)" stroke="url(#{uid}g)" stroke-width="{16 * k:.2f}" stroke-linejoin="round" mask="url(#{uid}m)"/>
  </g>
  {'' if small else f'<path d="{beam}" fill="url(#{uid}f)" mask="url(#{uid}m)"/>'}
  <circle cx="{ox:.2f}" cy="{oy:.2f}" r="{ring + gap * 0.0:.2f}" fill="{t['c'] if t is WIN else '#111111'}" filter="url(#{uid}s)"/>
  {lens(uid, t, ox, oy, ring * 0.86, small, k)}"""


CONCEPTS = [("1 Cube cam", cube_cam), ("2 Live stack", live_stack), ("3 View cone", view_cone)]


def variants(fn, n, work):
    """Return {name: RGBA image} for one concept."""
    out = {}
    def r(name, svg, px=512):
        p = g.write_svg(work / f"c{n}-{name}.svg", svg)
        out[name] = g.rasterise(p, work, px)
    r("win", g.doc(256, 256, fn(f"w{n}", WIN, 128, 126, 212)))
    r("win_small", g.doc(256, 256, fn(f"v{n}", WIN, 128, 128, 228, small=True)))
    r("pi", g.doc(256, 256, g.plate_squircle(f"q{n}", g.PLATES["black"], 128, 128, 244)
                  + fn(f"p{n}", PI, 128, 128, 244 * 0.64)))
    r("pi_small", g.doc(256, 256, g.plate_squircle(f"r{n}", g.PLATES["black"], 128, 128, 244)
                        + fn(f"s{n}", PI, 128, 128, 244 * 0.70, small=True)))
    r("ios", g.doc(1024, 1024, g.full_bleed_bg(f"i{n}", g.PLATES["midnight"], 1024, 1024)
                   + fn(f"j{n}", WIN, 512, 512, 1024 * 0.60)), px=1024)
    return out


def main(out_dir):
    out_dir = Path(out_dir)
    work = Path(tempfile.mkdtemp())
    rendered = [(name, variants(fn, i, work)) for i, (name, fn) in enumerate(CONCEPTS, 1)]
    try:
        font = ImageFont.truetype("segoeuib.ttf", 22)
        small_font = ImageFont.truetype("segoeui.ttf", 15)
    except OSError:
        font = small_font = ImageFont.load_default()

    # Sheet 1: each concept across platforms and sizes.
    W, row_h = 1700, 300
    sheet = Image.new("RGBA", (W, row_h * 3 + 20), (245, 245, 247, 255))
    d = ImageDraw.Draw(sheet)
    for row, (name, v) in enumerate(rendered):
        y = 10 + row * row_h
        d.text((20, y), name, fill=(30, 30, 30), font=font)
        sheet.alpha_composite(v["win"].resize((220, 220), Image.LANCZOS), (20, y + 40))
        sheet.alpha_composite(v["pi"].resize((220, 220), Image.LANCZOS), (260, y + 40))
        ios = v["ios"].resize((220, 220), Image.LANCZOS)
        m = Image.new("L", (220, 220), 0)
        ImageDraw.Draw(m).rounded_rectangle((0, 0, 219, 219), radius=50, fill=255)
        ios.putalpha(m)
        sheet.alpha_composite(ios, (500, y + 40))
        for band, bg in enumerate([(243, 243, 243, 255), (32, 32, 32, 255)]):
            bx = 760 + band * 470
            d.rectangle((bx, y + 40, bx + 450, y + 260), fill=bg)
            x = bx + 16
            for fam in ("win", "pi"):
                yy = y + 60 if fam == "win" else y + 160
                xx = x
                for s in (64, 48, 32, 24, 16):
                    src = v[fam if s > 32 else fam + "_small"].resize((s, s), Image.LANCZOS)
                    sheet.alpha_composite(src, (xx, yy + (64 - s) // 2))
                    xx += s + 18
    sheet.save(out_dir / "icon-concepts.png")

    # Sheet 2: concepts dropped into the real competitor grid.
    comp_dir = out_dir / "competitors"
    rows = list(csv.DictReader(open(comp_dir / "final.csv", encoding="utf-8-sig")))
    slots = {5: 0, 19: 1, 30: 2}
    cols, cell, icon = 8, 190, 128
    items = []
    for i, r in enumerate(rows):
        if i in slots:
            n = slots[i]
            items.append((f"Concept {rendered[n][0]}", rendered[n][1]["ios"].convert("RGB")))
        items.append((r["name"].split(":")[0].split(" - ")[0][:22], Image.open(comp_dir / r["file"]).convert("RGB")))
    H = ((len(items) + cols - 1) // cols) * cell + 10
    grid = Image.new("RGB", (cols * cell, H), (245, 245, 247))
    d = ImageDraw.Draw(grid)
    mask = Image.new("L", (icon, icon), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, icon - 1, icon - 1), radius=29, fill=255)
    for i, (label, im) in enumerate(items):
        x = (i % cols) * cell + (cell - icon) // 2
        y = (i // cols) * cell + 12
        grid.paste(im.resize((icon, icon), Image.LANCZOS), (x, y), mask)
        w = d.textlength(label, font=small_font)
        d.text(((i % cols) * cell + (cell - w) / 2, y + icon + 8), label, fill=(40, 40, 40), font=small_font)
    grid.save(out_dir / "icon-concepts-in-market.png")
    print(out_dir / "icon-concepts.png")
    print(out_dir / "icon-concepts-in-market.png")


if __name__ == "__main__":
    main(sys.argv[1])
