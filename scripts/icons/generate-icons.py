"""Generate the Wyze Monitor icon system.

The mark ("live stack"): a front screen carrying a record/live dot, with more
screens stacked behind it - "your live camera feeds" with no fixed camera
count. One metaphor, no typography, legible at 16 px. Chosen over a cube-camera
and a view-cone concept after comparison against 44 real CCTV app icons.

Families (same mark, different colourway / container per platform):
  windows  - Windows 11 Fluent blue, unplated with soft shadow (.ico + PNGs)
  pi       - Raspberry Pi red / white / black, same unplated geometry as
             windows so the two taskbar pins match in size (.ico + SVG + PNGs)
  apple    - macOS 1024 icon on the Big Sur grid (.icns) and iOS 1024 full bleed
  android  - adaptive icon layers (108 dp), monochrome themed layer, Play 512

Small sizes (<= 32 px) use a simplified mark: one back screen, wider gaps,
smaller record ring.

SVGs are rasterised by headless Chrome, then downscaled with Lanczos.

    python go2rtc-wyze-monitor/scripts/icons/generate-icons.py
"""
import io
import math
import shutil
import struct
import subprocess
import sys
import tempfile
from pathlib import Path

from PIL import Image

OUT = Path(__file__).resolve().parents[2] / "assets" / "icons"
MASTER = 1024
ICO_SIZES = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256]
PNG_SIZES = [16, 24, 32, 48, 64, 128, 256, 512, 1024]
SMALL_MAX = 32

BLUE = {
    "pane": ("#62C6FF", "#1A8CF0", "#0050B8"),   # front screen, top-left -> bottom-right
    "back": ("#CFEAFF", "#0B3F8F"),              # nearer -> farther screen
    "rec_ring": "#FFFFFF",
    "rec_dot": ("#FF6A5E", "#E0261B"),
    "shadow": "#002A66",
}
RASPBERRY = {
    "pane": ("#F0457A", "#D01E54", "#9E0F3A"),
    "back": ("#FFFFFF", "#8E8E95"),
    "rec_ring": "#FFFFFF",
    "rec_dot": ("#3A3A3A", "#0A0A0A"),
    "shadow": "#000000",
}
PLATES = {
    "black": ("#2B2B2E", "#0B0B0C"),
    "midnight": ("#16294A", "#060D1C"),
}


def squircle(cx, cy, size, n=5.0, steps=180):
    """Superellipse outline (continuous-curvature corners, like iOS/macOS)."""
    a = size / 2
    pts = []
    for i in range(steps):
        t = 2 * math.pi * i / steps
        c, s = math.cos(t), math.sin(t)
        x = a * math.copysign(abs(c) ** (2 / n), c)
        y = a * math.copysign(abs(s) ** (2 / n), s)
        pts.append(f"{cx + x:.2f},{cy + y:.2f}")
    return "M" + " L".join(pts) + " Z"


def rounded_rect(x, y, w, h, radii):
    """Rect path with per-corner radii (tl, tr, br, bl)."""
    tl, tr, br, bl = radii
    return (f"M{x + tl},{y} H{x + w - tr} A{tr},{tr} 0 0 1 {x + w},{y + tr} "
            f"V{y + h - br} A{br},{br} 0 0 1 {x + w - br},{y + h} "
            f"H{x + bl} A{bl},{bl} 0 0 1 {x},{y + h - bl} "
            f"V{y + tl} A{tl},{tl} 0 0 1 {x + tl},{y} Z")


def mark(uid, theme, cx, cy, size, small=False, mono=None):
    """Live-stack mark centred at (cx, cy), `size` wide (designed at 208 units).

    A front screen carrying a record/live dot, with further screens stacked
    behind it: "your live camera feeds" with no fixed camera count. Each back
    screen is cut away around the one in front, so the layers separate on any
    background without relying on shadow.
    """
    k = size / 208.0
    layers = 1 if small else 2
    w, h, sx, sy, gap = {2: (164, 144, 20, 22, 8), 1: (176, 152, 32, 34, 14)}[layers]
    w, h, sx, sy, gap = w * k, h * k, sx * k, sy * k, gap * k
    r = (34 if small else 30) * k
    x0 = cx - (w + sx * layers) / 2
    y0 = cy - (h + sy * layers) / 2 + sy * layers
    cards = [(x0 + sx * i, y0 - sy * i) for i in range(layers + 1)]  # 0 = front
    fx, fy = cards[0]
    rx, ry = fx + w / 2, fy + h / 2
    ring = h * (0.30 if small else 0.26)
    dot = ring * 0.62

    masks = []
    for i in range(1, layers + 1):
        px, py = cards[i - 1]
        masks.append(f"""<mask id="{uid}c{i}" maskUnits="userSpaceOnUse">
      <rect x="{cx - size}" y="{cy - size}" width="{size * 2}" height="{size * 2}" fill="#fff"/>
      <rect x="{px - gap:.2f}" y="{py - gap:.2f}" width="{w + 2 * gap:.2f}" height="{h + 2 * gap:.2f}" rx="{r + gap:.2f}" fill="#000"/>
    </mask>""")
    masks = "\n    ".join(masks)

    def card(i, fill, extra=""):
        x, y = cards[i]
        m = f' mask="url(#{uid}c{i})"' if i else ""
        return f'<rect x="{x:.2f}" y="{y:.2f}" width="{w:.2f}" height="{h:.2f}" rx="{r:.2f}" fill="{fill}"{m}{extra}/>'

    if mono:
        # Themed-icon silhouette: backs at reduced alpha, ring knocked out of the front.
        backs = "\n  ".join(card(i, mono, f' fill-opacity="{0.7 - 0.25 * (i - 1):.2f}"') for i in range(layers, 0, -1))
        return f"""<defs>
    {masks}
    <mask id="{uid}r" maskUnits="userSpaceOnUse">
      <rect x="{cx - size}" y="{cy - size}" width="{size * 2}" height="{size * 2}" fill="#fff"/>
      <circle cx="{rx:.2f}" cy="{ry:.2f}" r="{ring:.2f}" fill="#000"/>
      <circle cx="{rx:.2f}" cy="{ry:.2f}" r="{dot:.2f}" fill="#fff"/>
    </mask>
  </defs>
  {backs}
  <g mask="url(#{uid}r)">{card(0, mono)}</g>"""

    p1, p2, p3 = theme["pane"]
    backs = "\n    ".join(card(i, theme["back"][i - 1]) for i in range(layers, 0, -1))
    blur = max(1.0, 3 * k)
    return f"""<defs>
    <linearGradient id="{uid}g" gradientUnits="userSpaceOnUse" x1="{fx:.2f}" y1="{fy:.2f}" x2="{fx + w:.2f}" y2="{fy + h:.2f}">
      <stop offset="0" stop-color="{p1}"/><stop offset="0.5" stop-color="{p2}"/><stop offset="1" stop-color="{p3}"/>
    </linearGradient>
    <linearGradient id="{uid}h" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#fff" stop-opacity="0.18"/><stop offset="0.5" stop-color="#fff" stop-opacity="0"/>
    </linearGradient>
    <radialGradient id="{uid}d" cx="0.4" cy="0.36" r="0.7">
      <stop offset="0" stop-color="{theme['rec_dot'][0]}"/><stop offset="1" stop-color="{theme['rec_dot'][1]}"/>
    </radialGradient>
    {masks}
    <filter id="{uid}s" x="-25%" y="-25%" width="150%" height="160%">
      <feDropShadow dx="0" dy="{2 * k:.2f}" stdDeviation="{blur * 0.6:.2f}" flood-color="{theme['shadow']}" flood-opacity="0.28"/>
      <feDropShadow dx="0" dy="{6 * k:.2f}" stdDeviation="{blur * 2:.2f}" flood-color="{theme['shadow']}" flood-opacity="0.20"/>
    </filter>
    <filter id="{uid}l" x="-30%" y="-30%" width="160%" height="170%">
      <feDropShadow dx="0" dy="{1.5 * k:.2f}" stdDeviation="{blur * 0.8:.2f}" flood-color="#000" flood-opacity="0.25"/>
    </filter>
  </defs>
  <g filter="url(#{uid}s)">
    {backs}
    {card(0, f"url(#{uid}g)")}
  </g>
  {card(0, f"url(#{uid}h)")}
  <circle cx="{rx:.2f}" cy="{ry:.2f}" r="{ring:.2f}" fill="{theme['rec_ring']}" filter="url(#{uid}l)"/>
  <circle cx="{rx:.2f}" cy="{ry:.2f}" r="{dot:.2f}" fill="url(#{uid}d)"/>"""


def plate_squircle(uid, colours, cx, cy, size):
    c1, c2 = colours
    return f"""<defs>
    <linearGradient id="{uid}b" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="{c1}"/><stop offset="1" stop-color="{c2}"/>
    </linearGradient>
    <filter id="{uid}d" x="-10%" y="-10%" width="120%" height="125%">
      <feDropShadow dx="0" dy="{size * 0.012:.2f}" stdDeviation="{size * 0.014:.2f}" flood-color="#000" flood-opacity="0.35"/>
    </filter>
  </defs>
  <path d="{squircle(cx, cy, size)}" fill="url(#{uid}b)" filter="url(#{uid}d)"/>
  <path d="{squircle(cx, cy, size - size * 0.006)}" fill="none" stroke="#fff" stroke-opacity="0.08" stroke-width="{size * 0.004:.2f}"/>"""


def doc(w, h, body, background=None):
    bg = f'<rect width="{w}" height="{h}" fill="{background}"/>' if background else ""
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" width="{w}" height="{h}">\n  {bg}\n  {body}\n</svg>\n'


def full_bleed_bg(uid, colours, w, h):
    c1, c2 = colours
    return f"""<defs><linearGradient id="{uid}f" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="{c1}"/><stop offset="1" stop-color="{c2}"/></linearGradient></defs>
  <rect width="{w}" height="{h}" fill="url(#{uid}f)"/>"""


# ---- per-platform artwork -------------------------------------------------

def windows_svg(small):
    # Unplated, like Windows 11 inbox icons; mark fills the 256 grid with shadow room.
    return doc(256, 256, mark("w", BLUE, 128, 128 if small else 126, 250 if small else 238, small=small))


def pi_svg(small):
    # Same unplated geometry as Windows so the two pins are the same size on
    # the taskbar (a black plate vanished on dark taskbars and read smaller).
    return doc(256, 256, mark("p", RASPBERRY, 128, 128 if small else 126, 250 if small else 238, small=small))


def macos_svg():
    # Big Sur grid: 824 plate centred on a 1024 canvas.
    return doc(1024, 1024, plate_squircle("mp", PLATES["midnight"], 512, 500, 824)
               + mark("m", BLUE, 512, 500, 824 * 0.62))


def ios_svg():
    # Opaque, square, full bleed. iOS applies its own mask.
    return doc(1024, 1024, full_bleed_bg("i", PLATES["midnight"], 1024, 1024)
               + mark("i", BLUE, 512, 512, 1024 * 0.60))


def android_foreground_svg():
    # 108 dp canvas (x4 = 432); keep the mark inside the 66 dp safe circle.
    return doc(432, 432, mark("af", BLUE, 216, 216, 432 * 0.42))


def android_background_svg():
    return doc(432, 432, full_bleed_bg("ab", PLATES["midnight"], 432, 432))


def android_mono_svg():
    return doc(432, 432, mark("am", BLUE, 216, 216, 432 * 0.42, mono="#FFFFFF"))


def play_svg():
    return doc(512, 512, full_bleed_bg("pl", PLATES["midnight"], 512, 512)
               + mark("pl", BLUE, 256, 256, 512 * 0.58))


# ---- rendering ----------------------------------------------------------------

def find_chrome():
    for p in (r"C:\Program Files\Google\Chrome\Application\chrome.exe",
              r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"):
        if Path(p).exists():
            return p
    sys.exit("Chrome or Edge is required to rasterise the SVGs")


def rasterise(svg_path, work, px=MASTER):
    html = work / (svg_path.stem + ".html")
    html.write_text(
        f'<html><body style="margin:0;background:transparent">'
        f'<img src="{svg_path.as_uri()}" width="{px}" height="{px}" style="display:block">'
        f"</body></html>", encoding="utf-8")
    png = work / (svg_path.stem + ".png")
    subprocess.run([find_chrome(), "--headless=new", "--disable-gpu", "--hide-scrollbars",
                    "--allow-file-access-from-files", "--default-background-color=00000000",
                    f"--window-size={px},{px}", f"--screenshot={png}", html.as_uri()],
                   check=True, capture_output=True, timeout=60)
    return Image.open(png).convert("RGBA").crop((0, 0, px, px))


def write_svg(path, text):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")
    return path


def write_ico(path, full, small):
    frames = []
    for s in ICO_SIZES:
        img = (small if s <= SMALL_MAX else full).resize((s, s), Image.LANCZOS)
        buf = io.BytesIO()
        img.save(buf, "PNG")
        frames.append((s, buf.getvalue()))
    header = struct.pack("<HHH", 0, 1, len(frames))
    offset = 6 + 16 * len(frames)
    entries, data = b"", b""
    for s, png in frames:
        dim = 0 if s >= 256 else s
        entries += struct.pack("<BBBBHHII", dim, dim, 0, 0, 1, 32, len(png), offset)
        offset += len(png)
        data += png
    path.write_bytes(header + entries + data)


def size_set(folder, full, small, sizes=PNG_SIZES):
    (folder / "png").mkdir(parents=True, exist_ok=True)
    for s in sizes:
        (small if s <= SMALL_MAX else full).resize((s, s), Image.LANCZOS).save(
            folder / "png" / f"wyze-monitor-{s}.png")


def main():
    work = Path(tempfile.mkdtemp(prefix="wyze-icons-"))
    try:
        # Windows
        d = OUT / "windows"
        full = rasterise(write_svg(d / "wyze-monitor.svg", windows_svg(False)), work)
        small = rasterise(write_svg(d / "wyze-monitor-small.svg", windows_svg(True)), work)
        size_set(d, full, small)
        write_ico(d / "wyze-monitor.ico", full, small)

        # Raspberry Pi
        d = OUT / "pi"
        full = rasterise(write_svg(d / "wyze-monitor.svg", pi_svg(False)), work)
        small = rasterise(write_svg(d / "wyze-monitor-small.svg", pi_svg(True)), work)
        size_set(d, full, small)
        write_ico(d / "wyze-monitor.ico", full, small)   # Windows shortcut for the Pi viewer

        # Apple
        d = OUT / "apple"
        mac = rasterise(write_svg(d / "macos-1024.svg", macos_svg()), work)
        mac.save(d / "macos-1024.png")
        mac.save(d / "wyze-monitor.icns", sizes=[(16, 16), (32, 32), (64, 64), (128, 128),
                                                  (256, 256), (512, 512), (1024, 1024)])
        ios = rasterise(write_svg(d / "ios-1024.svg", ios_svg()), work)
        ios.convert("RGB").save(d / "ios-1024.png")   # App Store: opaque, no alpha

        # Android
        d = OUT / "android"
        for name, fn in (("ic_launcher_foreground", android_foreground_svg),
                         ("ic_launcher_background", android_background_svg),
                         ("ic_launcher_monochrome", android_mono_svg)):
            rasterise(write_svg(d / f"{name}.svg", fn()), work, px=432).save(d / f"{name}.png")
        rasterise(write_svg(d / "play-store-512.svg", play_svg()), work, px=512).convert("RGB").save(
            d / "play-store-512.png")

        print(f"Icons written to {OUT}")
    finally:
        shutil.rmtree(work, ignore_errors=True)


if __name__ == "__main__":
    main()
