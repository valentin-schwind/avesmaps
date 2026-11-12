"""Ausschnitt eines Bildes zum Ansehen. Aufruf: python -I crop.py <bild> <ausgabe> <x0> <y0> <x1> <y1> [massstab]"""
import sys
from PIL import Image
Image.MAX_IMAGE_PIXELS = None
im = Image.open(sys.argv[1]); x0, y0, x1, y1 = map(int, sys.argv[3:7]); s = float(sys.argv[7]) if len(sys.argv) > 7 else 1
c = im.crop((x0, y0, x1, y1))
if s != 1: c = c.resize((int(c.width * s), int(c.height * s)), Image.NEAREST if s > 1 else Image.LANCZOS)
c.save(sys.argv[2])
