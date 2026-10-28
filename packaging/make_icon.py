"""Рисует иконку приложения (градиентный квадрат со звуковой волной) в assets/icon.ico."""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parent.parent
S = 1024


def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


def render():
    c1, c2, c3 = (139, 92, 246), (99, 102, 241), (34, 211, 238)
    grad = Image.new("RGB", (S, S))
    px = grad.load()
    for y in range(S):
        for x in range(S):
            t = (x + y) / (2 * S)
            px[x, y] = lerp(c1, c2, t / 0.55) if t < 0.55 else lerp(c2, c3, (t - 0.55) / 0.45)
    mask = Image.new("L", (S, S), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, S - 1, S - 1), radius=int(S * 0.27), fill=255)
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    img.paste(grad, (0, 0), mask)
    d = ImageDraw.Draw(img)
    # Те же полосы, что и в логотипе интерфейса (viewBox 40x40)
    k = S / 40
    for x, y, h in ((9, 16, 8), (14.6, 11, 18), (20.2, 14, 12), (25.8, 9, 22)):
        d.rounded_rectangle((x * k, y * k, (x + 3.2) * k, (y + h) * k), radius=1.6 * k, fill=(255, 255, 255, 255))
    return img


def wizard_side(w, h, icon):
    """Боковая картинка мастера установки: тёмный градиент, иконка и подпись."""
    img = Image.new("RGB", (w, h))
    px = img.load()
    top, bottom = (24, 20, 48), (14, 15, 19)
    for y in range(h):
        for x in range(w):
            px[x, y] = lerp(top, bottom, y / h)
    glow = Image.new("L", (w, h), 0)
    ImageDraw.Draw(glow).ellipse((-w * 0.6, -h * 0.25, w * 1.2, h * 0.45), fill=70)
    img.paste(Image.new("RGB", (w, h), (124, 92, 255)), (0, 0), glow.filter(ImageFilter.GaussianBlur(w // 4)))
    size = int(w * 0.5)
    img.paste(icon.resize((size, size), Image.LANCZOS), ((w - size) // 2, int(h * 0.2)), icon.resize((size, size), Image.LANCZOS))
    d = ImageDraw.Draw(img)
    try:
        f1 = ImageFont.truetype("C:/Windows/Fonts/segoeuib.ttf", int(w * 0.15))
        f2 = ImageFont.truetype("C:/Windows/Fonts/segoeui.ttf", int(w * 0.075))
    except OSError:
        f1 = f2 = ImageFont.load_default()
    y = int(h * 0.2) + size + int(h * 0.04)
    for text, font, color in (("AveSTT", f1, (236, 237, 243)), ("Речь в текст", f2, (150, 155, 180))):
        tw = d.textlength(text, font=font)
        d.text(((w - tw) / 2, y), text, font=font, fill=color)
        y += int(font.size * 1.35)
    return img


if __name__ == "__main__":
    out = ROOT / "assets"
    out.mkdir(exist_ok=True)
    img = render()
    img.save(out / "icon.ico", sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
    img.resize((256, 256), Image.LANCZOS).save(out / "icon.png")
    # Картинки мастера установки Inno Setup (100% и 200% масштаб)
    for scale in (1, 2):
        wizard_side(164 * scale, 314 * scale, img).save(out / f"wizard-{scale * 100}.bmp")
        small = Image.new("RGB", (55 * scale, 55 * scale), (255, 255, 255))
        ic = img.resize((48 * scale, 48 * scale), Image.LANCZOS)
        small.paste(ic, (int(3.5 * scale), int(3.5 * scale)), ic)
        small.save(out / f"wizard-small-{scale * 100}.bmp")
    print("icon saved")
