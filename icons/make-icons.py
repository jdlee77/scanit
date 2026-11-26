# Draws scanit's home-screen icons: white barcode bars on the app's blue, with a red scan line.
# Run from the repo root: python3 icons/make-icons.py
from PIL import Image, ImageDraw

BLUE, WHITE, RED = (31, 78, 121), (255, 255, 255), (230, 72, 72)
# Bar widths (in units) and gaps, left to right: an ordinary-looking barcode.
BARS = [2, 1, 1, 3, 1, 2, 1, 1, 2, 3, 1, 1, 2, 1, 3, 1, 1, 2]


def draw(size, content_scale, rounded):
    img = Image.new("RGB", (size, size), BLUE)
    if rounded:  # transparent corners for the plain icon; launchers round the maskable one themselves
        img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        ImageDraw.Draw(img).rounded_rectangle([0, 0, size - 1, size - 1], radius=size * 0.22, fill=BLUE)
    d = ImageDraw.Draw(img)
    box = size * content_scale  # the square the barcode sits in, centred
    left, top = (size - box) / 2, (size - box) / 2 + box * 0.12
    units = sum(BARS) + len(BARS) - 1
    unit = box / units
    x = left
    for w in BARS:
        d.rectangle([x, top, x + w * unit - 1, top + box * 0.62], fill=WHITE)
        x += (w + 1) * unit
    y = top + box * 0.31
    d.rectangle([left - unit * 1.5, y - unit * 0.6, left + box + unit * 1.5, y + unit * 0.6], fill=RED)
    return img


draw(192, 0.62, True).save("icons/icon-192.png")
draw(512, 0.62, True).save("icons/icon-512.png")
draw(512, 0.5, False).save("icons/icon-maskable-512.png")  # content inside the 80% safe zone
draw(180, 0.62, False).save("icons/apple-touch-icon.png")  # iPhone rounds its own corners; no transparency
