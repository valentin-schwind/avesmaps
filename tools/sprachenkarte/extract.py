"""Das eine JPEG aus dem PDF ziehen. Aufruf: python -I extract.py <pdf> <roh.jpg> <karte.png> <vorschau.png> (Vorschau: ein Viertel der Kantenlänge)"""
import re, sys
d = open(sys.argv[1], 'rb').read()
i = d.find(b'/Subtype/Image')
s = d.find(b'stream\r\n', i) + len(b'stream\r\n')
n = int(re.search(rb'/Length (\d+)', d[d.rfind(b'<<', 0, i):i + 50]).group(1))
open(sys.argv[2], 'wb').write(d[s:s + n])
from PIL import Image
im = Image.open(sys.argv[2]); print(im.mode, im.size, im.info.keys())
im.convert('RGB').save(sys.argv[3])
im.convert('RGB').resize((im.width // 4, im.height // 4)).save(sys.argv[4])
