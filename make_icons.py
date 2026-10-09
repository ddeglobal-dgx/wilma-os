#!/usr/bin/env python3
"""Erzeugt die App-Icons fuer Wilma (kleines Haus mit Herz auf Creme, Farben wie Betriebssystem Laura)."""
from PIL import Image, ImageDraw

BG = (250, 244, 236)        # warmes Creme
ROSE = (214, 158, 150)      # Altrosa
ROSE_DARK = (192, 128, 118)
GOLD = (201, 162, 122)
SHADOW = (232, 216, 200)
WHITE = (255, 253, 249)

def heart(d, cx, cy, size, fill):
    r = size * 0.25
    o = r * 0.18   # Kreise überlappen, damit das Herz oben keine Kerbe bis unten hat
    d.ellipse([cx - 2*r + o, cy - r*1.15, cx + o, cy + r*0.85], fill=fill)
    d.ellipse([cx - o, cy - r*1.15, cx + 2*r - o, cy + r*0.85], fill=fill)
    d.polygon([(cx - 2*r + r*0.2, cy + r*0.15), (cx + 2*r - r*0.2, cy + r*0.15), (cx, cy + 2.0*r)], fill=fill)

def house(d, ox, oy, roof, body, door):
    # Schornstein (hinter dem Dach)
    d.rectangle([ox + 670, oy + 250, ox + 740, oy + 400], fill=roof)
    # Dach
    d.polygon([(ox + 512, oy + 190), (ox + 830, oy + 470), (ox + 194, oy + 470)], fill=roof)
    # Hauskörper
    d.rounded_rectangle([ox + 262, oy + 440, ox + 762, oy + 830], radius=36, fill=body)

base = 1024
img = Image.new("RGB", (base, base), BG)
d = ImageDraw.Draw(img)
m = 56
d.rounded_rectangle([m, m, base-m, base-m], radius=90, outline=(226, 203, 176), width=10)
house(d, 10, 10, SHADOW, SHADOW, None)          # weicher Schatten
house(d, 0, 0, ROSE_DARK, ROSE, None)
heart(d, 512, 600, 230, WHITE)                    # Herz im Haus
d.rounded_rectangle([262, 812, 762, 830], radius=8, fill=GOLD)   # Sockel

out = "icons"
for s, name in [(512, "icon-512.png"), (192, "icon-192.png"),
                (180, "apple-touch-icon.png"), (32, "favicon-32.png")]:
    img.resize((s, s), Image.LANCZOS).save(f"{out}/{name}")
print("Icons erzeugt.")
