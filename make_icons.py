#!/usr/bin/env python3
"""Erzeugt die App-Icons fuer Betriebssystem Laura (Herz auf Creme)."""
from PIL import Image, ImageDraw

BG = (250, 244, 236)      # warmes Creme
HEART = (214, 158, 150)   # Altrosa
HEART_DARK = (196, 137, 128)

def draw_heart(d, cx, cy, size, fill):
    r = size * 0.25
    # zwei Kreise + Dreieck = Herz
    d.ellipse([cx - 2*r, cy - r*1.15, cx, cy + r*0.85], fill=fill)
    d.ellipse([cx, cy - r*1.15, cx + 2*r, cy + r*0.85], fill=fill)
    d.polygon([
        (cx - 2*r + r*0.08, cy + r*0.25),
        (cx + 2*r - r*0.08, cy + r*0.25),
        (cx, cy + 2.1*r),
    ], fill=fill)

base = 1024
img = Image.new("RGB", (base, base), BG)
d = ImageDraw.Draw(img)
# dezenter Rahmen
m = 56
d.rounded_rectangle([m, m, base-m, base-m], radius=90, outline=(226, 203, 176), width=10)
# Herz mit weichem Schatten
draw_heart(d, base/2 + 8, base/2 - 30 + 8, 460, (232, 216, 200))
draw_heart(d, base/2, base/2 - 30, 460, HEART)
# kleines Herz-Highlight
draw_heart(d, base/2 + 150, base/2 + 190, 120, HEART_DARK)

out = "icons"
for s, name in [(512, "icon-512.png"), (192, "icon-192.png"),
                (180, "apple-touch-icon.png"), (32, "favicon-32.png")]:
    img.resize((s, s), Image.LANCZOS).save(f"{out}/{name}")
print("Icons erzeugt.")
