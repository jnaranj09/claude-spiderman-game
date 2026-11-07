# python3 compare.py <ref image> <render.png> <render_key.png> <out.png> <ref polygon json>
# Side by side (same height), plus the cel palette of each: pixels of him classified into lit red, shadow red,
# lit blue, shadow blue, lens white and ink, with each class's share of his pixels and its mean colour.
import sys, json, colorsys
from PIL import Image, ImageDraw
ref_p, ren_p, key_p, out_p, poly = sys.argv[1:6]
ref = Image.open(ref_p).convert('RGB'); ren = Image.open(ren_p).convert('RGB'); key = Image.open(key_p).convert('RGB')
ren = ren.resize(ref.size); key = key.resize(ref.size)
mref = Image.new('L', ref.size, 0); ImageDraw.Draw(mref).polygon([tuple(p) for p in json.loads(poly)], fill=255)
bg = key.getpixel((2, 2))
def isbg(c): return sum(abs(c[i] - bg[i]) for i in range(3)) < 60
CLASSES = ['red lit', 'red shadow', 'blue lit', 'blue shadow', 'lens', 'ink', 'other']
def cls(c):
    h, s, v = colorsys.rgb_to_hsv(*(x / 255 for x in c)); h *= 360
    if v < 0.17: return 'ink'
    if s < 0.3 and v > 0.55: return 'lens'
    if (h >= 335 or h <= 28) and s > 0.35: return 'red lit' if v > 0.55 else 'red shadow'
    if 185 <= h <= 255 and s > 0.35: return 'blue lit' if v > 0.5 else 'blue shadow'
    return 'other'
def stats(img, inside):
    acc = {k: [0, 0, 0, 0] for k in CLASSES}; n = 0
    w, h = img.size
    for y in range(0, h, 2):
        for x in range(0, w, 2):
            if not inside(x, y): continue
            c = img.getpixel((x, y)); k = cls(c); a = acc[k]
            a[0] += 1; a[1] += c[0]; a[2] += c[1]; a[3] += c[2]; n += 1
    return {k: (a[0] / max(n, 1), tuple(int(a[i] / max(a[0], 1)) for i in (1, 2, 3))) for k, a in acc.items()}
sr = stats(ref, lambda x, y: mref.getpixel((x, y)) > 0)
sn = stats(ren, lambda x, y: not isbg(key.getpixel((x, y))))
W, H = ref.size
out = Image.new('RGB', (W * 2, H + 40 + 30 * len(CLASSES)), (24, 24, 28))
out.paste(ref, (0, 0)); out.paste(ren, (W, 0))
d = ImageDraw.Draw(out)
d.text((10, H + 8), 'REFERENCE', fill=(255, 255, 255)); d.text((W + 10, H + 8), 'RENDER (game pipeline)', fill=(255, 255, 255))
print(f'{"class":12s} {"ref %":>6s} {"ref colour":>10s}   {"ren %":>6s} {"ren colour":>10s}')
for i, k in enumerate(CLASSES):
    y = H + 34 + i * 30
    for j, s in enumerate((sr, sn)):
        f, c = s[k]; x0 = j * W + 10
        d.rectangle([x0, y, x0 + 60, y + 24], fill=c); d.text((x0 + 70, y + 6), f'{k:12s} {f*100:5.1f}%  #{c[0]:02x}{c[1]:02x}{c[2]:02x}', fill=(230, 230, 230))
    print(f'{k:12s} {sr[k][0]*100:5.1f}%    #{"%02x%02x%02x" % sr[k][1]}   {sn[k][0]*100:5.1f}%    #{"%02x%02x%02x" % sn[k][1]}')
out.save(out_p)
