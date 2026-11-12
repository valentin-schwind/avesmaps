"""Diagnose: Bilder und Zeichenbefehle im PDF zählen (die Referenzkarte trägt ein einziges JPEG, keine Vektoren). Aufruf: python -I pdfscan.py <pdf>"""
import re, sys, zlib, collections
data = open(sys.argv[1], 'rb').read()
print('size', len(data))
print('images', len(re.findall(rb'/Subtype\s*/Image', data)))
for m in re.finditer(rb'/Subtype\s*/Image(.{0,300})', data, re.S):
    seg = m.group(0)
    w = re.search(rb'/Width\s+(\d+)', seg); h = re.search(rb'/Height\s+(\d+)', seg)
    print(' image', w and w.group(1), h and h.group(1))
ops = collections.Counter(); colors = collections.Counter(); total = 0
for m in re.finditer(rb'stream\r?\n', data):
    start = m.end(); end = data.find(b'endstream', start)
    raw = data[start:end]
    try: dec = zlib.decompress(raw)
    except Exception: continue
    total += len(dec)
    for tok in re.findall(rb'(?<![A-Za-z])(m|l|c|re|f\*?|S|s|B|W|rg|k|cs|sc|scn|Do|BT)(?![A-Za-z])', dec):
        ops[tok] += 1
    for c in re.findall(rb'([\d.]+ [\d.]+ [\d.]+ [\d.]+) k', dec): colors[c] += 1
    for c in re.findall(rb'([\d.]+ [\d.]+ [\d.]+) rg', dec): colors[c] += 1
print('decoded bytes', total)
print(ops.most_common())
print('distinct fill colors', len(colors)); print(colors.most_common(40))
