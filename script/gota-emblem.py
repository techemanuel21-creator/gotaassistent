"""GotaAssistent emblem: the butler cat alone, on a transparent background. Used for every app icon (favicons, PWA, Electron, tray). (drop_emblem is the old cat-in-a-drop.)
The icons are generated, not drawn by hand: run this script after changing the cat art."""
import io, math, os
from pathlib import Path
from PIL import Image, ImageChops, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
CAT = Path(os.environ.get("GOTA_CAT", ROOT / "packages" / "ui" / "src" / "assets" / "gota-cat.png"))
TOP, BOTTOM = (111, 99, 242), (56, 189, 248)   # #6F63F2 -> #38BDF8
NAVY = (11, 14, 31)


def drop_mask(size):
    """A teardrop: a circle in the lower part and a soft point at the top (tangent lines from the tip to the circle)."""
    m = Image.new("L", (size, size), 0)
    d = ImageDraw.Draw(m)
    r = size * 0.36
    cx, cy = size / 2, size * 0.60
    tip = (cx, size * 0.07)
    d.ellipse((cx - r, cy - r, cx + r, cy + r), fill=255)
    theta = math.acos(r / (cy - tip[1]))
    left = (cx - r * math.sin(theta), cy - r * math.cos(theta))
    right = (cx + r * math.sin(theta), cy - r * math.cos(theta))
    d.polygon([tip, left, (cx, cy), right], fill=255)
    return m.filter(ImageFilter.GaussianBlur(size * 0.004))


def emblem(size, background=False):
    """Just the butler cat on a transparent background, filling the icon (no drop, no tile)."""
    cat = Image.open(CAT).convert("RGBA")
    cat = cat.crop(cat.split()[3].getbbox())
    inner = int(size * 0.94)
    cat.thumbnail((inner, inner), Image.LANCZOS)
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    canvas.alpha_composite(cat, ((size - cat.width) // 2, (size - cat.height) // 2))
    return canvas


def drop_emblem(size, background=True):
    big = size * 4
    canvas = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    if background:   # navy rounded tile behind the drop
        d = ImageDraw.Draw(canvas)
        d.rounded_rectangle((0, 0, big - 1, big - 1), int(big * 0.22), fill=NAVY + (255,))
    # gradient drop
    grad = Image.new("RGBA", (big, big))
    gd = ImageDraw.Draw(grad)
    for y in range(big):
        t = y / big
        gd.line([(0, y), (big, y)], fill=tuple(int(TOP[i] + (BOTTOM[i] - TOP[i]) * t) for i in range(3)) + (255,))
    mask = drop_mask(big)
    scale = 0.86
    small = int(big * scale)
    off = (big - small) // 2
    drop = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    drop.paste(grad.resize((small, small)), (off, off + int(big * 0.02)), mask.resize((small, small)))
    # soft highlight on the left
    hl = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    ImageDraw.Draw(hl).ellipse((big * 0.28, big * 0.40, big * 0.40, big * 0.62), fill=(255, 255, 255, 70))
    hl = hl.filter(ImageFilter.GaussianBlur(big * 0.02))
    drop = Image.alpha_composite(drop, hl)
    canvas.alpha_composite(drop)
    # the cat, inside the round part of the drop
    cat = Image.open(CAT).convert("RGBA")
    inner = int(big * 0.52)
    cat = cat.resize((inner, inner), Image.LANCZOS)
    canvas.alpha_composite(cat, ((big - inner) // 2, int(big * 0.36)))
    return canvas.resize((size, size), Image.LANCZOS)


if __name__ == "__main__":
    out = ROOT / "packages" / "ui" / "src" / "assets" / "favicon"
    for suffix in ("", "-v3"):
        emblem(96).save(out / f"favicon-96x96{suffix}.png")
        emblem(180).save(out / f"apple-touch-icon{suffix}.png")
        emblem(256).save(out / f"favicon{suffix}.ico", sizes=[(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
        buf = io.BytesIO()
        emblem(128).save(buf, "PNG")
        import base64
        (out / f"favicon{suffix}.svg").write_text(
            '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 128 128" width="128" height="128">'
            f'<image width="128" height="128" xlink:href="data:image/png;base64,{base64.b64encode(buf.getvalue()).decode()}"/></svg>\n', "utf-8")
    emblem(192).save(out / "web-app-manifest-192x192.png")
    emblem(512).save(out / "web-app-manifest-512x512.png")
    for channel in ("dev", "beta", "prod"):
        d = ROOT / "packages" / "desktop" / "icons" / channel
        d.mkdir(parents=True, exist_ok=True)
        for name, size in {"icon.png": 512, "dock.png": 512, "128x128@2x.png": 256, "128x128.png": 128, "64x64.png": 64, "32x32.png": 32, "StoreLogo.png": 50,
                           **{f"Square{n}x{n}Logo.png": n for n in (30, 44, 71, 89, 107, 142, 150, 284, 310)}}.items():
            emblem(size).save(d / name)
        emblem(256).save(d / "icon.ico", sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
    emblem(512).save(ROOT / "script" / "gota-emblem-preview.png")
    print("emblema do GotaAssistent gerado")
