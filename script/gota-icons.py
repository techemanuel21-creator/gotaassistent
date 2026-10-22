"""Gota icon set for the web/desktop interface: the Gota cat on the navy tile, in the sizes opencode's app expects (favicons, apple-touch, PWA, social share)."""
import base64, io, os
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
CAT = Path(os.environ.get("GOTA_CAT", ROOT.parent / "desktop" / "gota" / "assets" / "cat" / "logo.png"))
OUT = ROOT / "packages" / "ui" / "src" / "assets" / "favicon"
NAVY, BORDER = (11, 14, 31, 255), (43, 50, 99, 255)


def tile(size, radius=0.22, pad=0.1):
    big = size * 4
    im = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.rounded_rectangle((0, 0, big - 1, big - 1), int(big * radius), fill=NAVY, outline=BORDER, width=max(2, big // 64))
    cat = Image.open(CAT).convert("RGBA")
    inner = int(big * (1 - 2 * pad))
    cat = cat.resize((inner, inner), Image.LANCZOS)
    im.alpha_composite(cat, ((big - inner) // 2, (big - inner) // 2))
    return im.resize((size, size), Image.LANCZOS)


def save(name, size, **kw):
    tile(size, **kw).save(OUT / name)


for suffix in ("", "-v3"):
    save(f"favicon-96x96{suffix}.png", 96)
    save(f"apple-touch-icon{suffix}.png", 180, radius=0.0, pad=0.12)
    big = tile(256)
    big.save(OUT / f"favicon{suffix}.ico", sizes=[(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
    buf = io.BytesIO()
    tile(128).save(buf, "PNG")
    (OUT / f"favicon{suffix}.svg").write_text(
        '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 128 128" width="128" height="128">'
        f'<image width="128" height="128" xlink:href="data:image/png;base64,{base64.b64encode(buf.getvalue()).decode()}"/></svg>\n', "utf-8")
save("web-app-manifest-192x192.png", 192)
save("web-app-manifest-512x512.png", 512)
print("ícones do Gota gerados em", OUT)
