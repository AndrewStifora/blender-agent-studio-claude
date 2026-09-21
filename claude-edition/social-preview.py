#!/usr/bin/env python3
"""Build the GitHub social preview card for this fork.

    python claude-edition/social-preview.py

Writes claude-edition/social-preview.png at 1280x640, the size GitHub asks for
under Settings > General > Social preview. Upload it there; GitHub does not read
it from the repository.

The hero is the validation crate from this repo's own test evidence, rendered in
Blender 5.2 through Cycles with a transparent background by
claude-edition/social-preview-hero.py, so the card shows something the skills
actually produced rather than stock art.

Needs Pillow. Inter and JetBrains Mono are fetched once into the system temp
directory; nothing is written to the repo except the PNG.
"""

from __future__ import annotations

import tempfile
import urllib.request
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageEnhance, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parent.parent
HERO = ROOT / "claude-edition/social-preview-hero.png"
OUT = ROOT / "claude-edition/social-preview.png"

FONTS = {
    "Inter.ttf": "https://raw.githubusercontent.com/google/fonts/main/ofl/inter/Inter%5Bopsz,wght%5D.ttf",
    "JetBrainsMono.ttf": "https://raw.githubusercontent.com/google/fonts/main/ofl/jetbrainsmono/JetBrainsMono%5Bwght%5D.ttf",
}

W, H = 1280, 640

BG_TOP = (10, 12, 15)
BG_BOTTOM = (19, 23, 28)
INK = (245, 247, 250)
CORAL = (217, 119, 87)      # Claude
ORANGE = (232, 125, 13)     # Blender
MUTED = (152, 162, 174)
FAINT = (112, 122, 133)
HAIRLINE = (36, 41, 48)

MARGIN = 72
COL_W = 600

EYEBROW = "FORK OF ifBars/blender-agent-studio"
TITLE_1 = "Blender Agent Studio"
TITLE_2 = "Claude Code edition"
PROMISE = [
    "Describe what you want to make.",
    "Keep the Blender file and the Python that built it.",
]
META = "12 skills  ·  12 MCP tools  ·  Blender 5.2 LTS  ·  MIT"


# ---------------------------------------------------------------- resources

def font_dir() -> Path:
    d = Path(tempfile.gettempdir()) / "bas-social-preview-fonts"
    d.mkdir(parents=True, exist_ok=True)
    for name, url in FONTS.items():
        if not (d / name).exists():
            urllib.request.urlretrieve(url, d / name)
    return d


FD = font_dir()


def inter(size: int, weight: float, opsz: float | None = None) -> ImageFont.FreeTypeFont:
    f = ImageFont.truetype(str(FD / "Inter.ttf"), size)
    f.set_variation_by_axes([opsz if opsz is not None else min(32.0, max(14.0, float(size))), weight])
    return f


def mono(size: int, weight: float) -> ImageFont.FreeTypeFont:
    f = ImageFont.truetype(str(FD / "JetBrainsMono.ttf"), size)
    f.set_variation_by_axes([weight])
    return f


# ---------------------------------------------------------------- primitives

def vertical_gradient(size, top, bottom) -> Image.Image:
    w, h = size
    strip = Image.new("RGB", (1, h))
    px = strip.load()
    for y in range(h):
        t = y / max(1, h - 1)
        px[0, y] = tuple(round(top[i] + (bottom[i] - top[i]) * t) for i in range(3))
    return strip.resize((w, h), Image.BILINEAR)


def radial_glow(size, center, radius, color, strength) -> Image.Image:
    """Soft additive pool of light, drawn small and upscaled so it stays smooth."""
    w, h = size
    scale = 8
    mask = Image.new("L", (w // scale, h // scale), 0)
    d = ImageDraw.Draw(mask)
    cx, cy, r = center[0] / scale, center[1] / scale, radius / scale
    steps = 40
    for i in range(steps, 0, -1):
        t = i / steps
        v = round(255 * (1 - t) ** 2 * strength)
        d.ellipse([cx - r * t, cy - r * t, cx + r * t, cy + r * t], fill=v)
    mask = mask.resize((w, h), Image.BICUBIC).filter(ImageFilter.GaussianBlur(24))
    return Image.composite(Image.new("RGB", (w, h), color),
                           Image.new("RGB", (w, h), (0, 0, 0)), mask)


def feather_border(size, inset: int) -> Image.Image:
    """Mask that is opaque in the middle and ramps to zero at the edges."""
    w, h = size
    m = Image.new("L", (w, h), 0)
    ImageDraw.Draw(m).rectangle([inset, inset, w - inset, h - inset], fill=255)
    return m.filter(ImageFilter.GaussianBlur(inset * 0.55))


def text_tracked(draw, xy, text, font, fill, tracking=0.0):
    x, y = xy
    for ch in text:
        draw.text((x, y), ch, font=font, fill=fill)
        x += draw.textlength(ch, font=font) + tracking


def tracked_width(draw, text, font, tracking=0.0) -> float:
    if not text:
        return 0.0
    return sum(draw.textlength(c, font=font) for c in text) + tracking * (len(text) - 1)


def grain(img: Image.Image, sigma: float = 2.0, floor: int = 128) -> Image.Image:
    """Fine additive noise. Keeps the dark gradient from banding and stops the
    card looking like flat vector fill."""
    noise = Image.effect_noise(img.size, sigma).point(lambda v: max(0, v - floor))
    return ImageChops.add(img, Image.merge("RGB", (noise, noise, noise)))


# ---------------------------------------------------------------- hero

def hero_layer(crate_height: int) -> tuple[Image.Image, tuple[int, int]]:
    """Scale, grade and feather the Blender render. Returns the layer and where
    to paste it so the crate lands on the card's optical right-hand third."""
    hero = Image.open(HERO).convert("RGBA")

    # The crate's own extent inside the render, ignoring the catcher shadow.
    opaque = hero.getchannel("A").point(lambda v: 255 if v > 245 else 0)
    box = opaque.getbbox()
    scale = crate_height / (box[3] - box[1])
    hero = hero.resize((round(hero.width * scale), round(hero.height * scale)), Image.LANCZOS)
    cx = (box[0] + box[2]) / 2 * scale
    cy = (box[1] + box[3]) / 2 * scale

    rgb = hero.convert("RGB")
    rgb = Image.blend(rgb, Image.new("RGB", hero.size, (14, 17, 22)), 0.15)
    rgb = ImageEnhance.Color(rgb).enhance(1.12)
    rgb = ImageEnhance.Contrast(rgb).enhance(1.05)
    alpha = ImageChops.darker(hero.getchannel("A"), feather_border(hero.size, 64))
    hero = Image.merge("RGBA", (*rgb.split(), alpha))

    # Crate centre target: right of the text column, a little above midline.
    return hero, (round(962 - cx), round(300 - cy))


# ---------------------------------------------------------------- the card

def build() -> Image.Image:
    card = vertical_gradient((W, H), BG_TOP, BG_BOTTOM)
    card = ImageChops.add(card, radial_glow((W, H), (955, 285), 520, (52, 40, 31), 0.5))
    card = card.convert("RGBA")

    hero, at = hero_layer(crate_height=404)
    card.alpha_composite(hero, at)

    draw = ImageDraw.Draw(card)

    # --- measure the text stack so it can be centred as one block ------
    f_eyebrow = inter(15, 620, opsz=16)
    f_body = inter(20, 420, opsz=20)
    f_meta = mono(15, 500)

    size = 62
    while size > 40:
        f_title = inter(size, 800, opsz=32)
        widest = max(tracked_width(draw, TITLE_1, f_title, -0.6),
                     tracked_width(draw, TITLE_2, f_title, -0.6))
        if widest <= COL_W:
            break
        size -= 1
    f_title = inter(size, 800, opsz=32)
    lead = round(size * 1.10)
    body_lines = PROMISE

    gap_eyebrow, gap_rule, gap_body, gap_meta = 44, 30, 32, 28
    stack = (20 + gap_eyebrow + lead * 2 + gap_rule + 3
             + gap_body + len(body_lines) * 31 + gap_meta + 1 + 26 + 20)
    y = round((H - stack) / 2)

    # --- eyebrow -------------------------------------------------------
    draw.rectangle([MARGIN, y + 6, MARGIN + 9, y + 15], fill=ORANGE)
    text_tracked(draw, (MARGIN + 23, y), EYEBROW, f_eyebrow, FAINT, tracking=1.35)
    y += 20 + gap_eyebrow

    # --- two-tone title ------------------------------------------------
    text_tracked(draw, (MARGIN, y - round(size * 0.20)), TITLE_1, f_title, INK, tracking=-0.6)
    text_tracked(draw, (MARGIN, y - round(size * 0.20) + lead), TITLE_2, f_title, CORAL, tracking=-0.6)
    y += lead * 2 + gap_rule

    # --- rule ----------------------------------------------------------
    draw.rectangle([MARGIN, y, MARGIN + 54, y + 3], fill=ORANGE)
    y += 3 + gap_body

    # --- promise -------------------------------------------------------
    for i, line in enumerate(body_lines):
        draw.text((MARGIN, y + i * 31), line, font=f_body, fill=MUTED)
    y += len(body_lines) * 31 + gap_meta

    # --- footer --------------------------------------------------------
    draw.rectangle([MARGIN, y, MARGIN + COL_W - 70, y + 1], fill=HAIRLINE)
    text_tracked(draw, (MARGIN, y + 26), META, f_meta, FAINT, tracking=0.2)

    return grain(card.convert("RGB"))


if __name__ == "__main__":
    img = build()
    img.save(OUT, "PNG", optimize=True)
    print(f"wrote {OUT}  {img.size[0]}x{img.size[1]}  {OUT.stat().st_size / 1024:.0f} KB")
