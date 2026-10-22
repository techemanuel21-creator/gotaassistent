"""Gota icons for the Electron desktop app (packages/desktop/icons/<channel>): the cat on the navy tile, in the sizes the app and electron-builder use."""
import os
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
CAT = Path(os.environ.get("GOTA_CAT", ROOT / "packages" / "ui" / "src" / "assets" / "gota-cat.png"))
NAVY, BORDER = (11, 14, 31, 255), (43, 50, 99, 255)


def tile(size, radius=0.22, pad=0.1):
    big = size * 4
    im = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.rounded_rectangle((0, 0, big - 1, big - 1), int(big * radius), fill=NAVY, outline=BORDER, width=max(2, big // 64))
    cat = Image.open(CAT).convert("RGBA")
    inner = int(big * (1 - 2 * pad))
    im.alpha_composite(cat.resize((inner, inner), Image.LANCZOS), ((big - inner) // 2, (big - inner) // 2))
    return im.resize((size, size), Image.LANCZOS)


for channel in ("dev", "beta", "prod"):
    out = ROOT / "packages" / "desktop" / "icons" / channel
    out.mkdir(parents=True, exist_ok=True)
    for name, size in {"icon.png": 512, "dock.png": 512, "128x128@2x.png": 256, "128x128.png": 128, "64x64.png": 64, "32x32.png": 32, "StoreLogo.png": 50,
                       **{f"Square{n}x{n}Logo.png": n for n in (30, 44, 71, 89, 107, 142, 150, 284, 310)}}.items():
        tile(size).save(out / name)
    tile(256).save(out / "icon.ico", sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
print("ícones do desktop gerados")
