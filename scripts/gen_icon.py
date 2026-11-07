"""Generate src-tauri/icons/icon.ico for OpenPyCharm (PyCharm-inspired mark)."""
from PIL import Image, ImageDraw, ImageFont
import os

SIZES = [16, 24, 32, 48, 64, 128, 256]
OUT_DIR = os.path.join(os.path.dirname(__file__), "..", "src-tauri", "icons")

def draw_mark(size: int) -> Image.Image:
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    # Rounded-rect gradient: blue → teal (PyCharm palette flavor)
    grad = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    gd = ImageDraw.Draw(grad)
    c1 = (56, 113, 225)   # --accent
    c2 = (33, 215, 137)   # jetbrains green
    for y in range(size):
        t = y / max(1, size - 1)
        r = int(c1[0] + (c2[0] - c1[0]) * t)
        g = int(c1[1] + (c2[1] - c1[1]) * t)
        b = int(c1[2] + (c2[2] - c1[2]) * t)
        gd.line([(0, y), (size, y)], fill=(r, g, b, 255))
    mask = Image.new("L", (size, size), 0)
    md = ImageDraw.Draw(mask)
    radius = max(2, size * 22 // 100)
    md.rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=255)
    img.paste(grad, (0, 0), mask)
    # Letter "P"
    try:
        font = ImageFont.truetype("segoeuib.ttf", int(size * 0.62))
    except Exception:
        font = ImageFont.load_default()
    text = "P"
    bbox = d.textbbox((0, 0), text, font=font)
    w = bbox[2] - bbox[0]
    h = bbox[3] - bbox[1]
    d.text(((size - w) / 2 - bbox[0], (size - h) / 2 - bbox[1]), text, font=font, fill=(255, 255, 255, 255))
    return img

def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    frames = []
    for s in SIZES:
        frames.append(draw_mark(s))
    ico_path = os.path.join(OUT_DIR, "icon.ico")
    frames[-1].save(ico_path, format="ICO", sizes=[(s, s) for s in SIZES], append_images=frames[:-1])
    # Also PNG master for other targets.
    frames[-1].save(os.path.join(OUT_DIR, "icon.png"), format="PNG")
    print("wrote", os.path.abspath(ico_path))

if __name__ == "__main__":
    main()
