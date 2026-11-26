"""Generate app icons (book with 勞 character)."""
import os
from PIL import Image, ImageDraw, ImageFont
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FONT = '/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc'

def icon(size, path, pad=0.0):
    im = Image.new('RGB', (size, size), '#1f3a5f')
    d = ImageDraw.Draw(im)
    s = size
    # page
    m = int(s * (0.16 + pad))
    d.rounded_rectangle([m, int(s * 0.14 + pad * s), s - m, s - int(s * 0.14 + pad * s)], radius=int(s * 0.05), fill='#fffdf8')
    d.rectangle([m, int(s * 0.14 + pad * s), m + int(s * 0.06), s - int(s * 0.14 + pad * s)], fill='#c9a24a')
    f = ImageFont.truetype(FONT, int(s * (0.42 - pad * 0.8)))
    t = '勞'
    bb = d.textbbox((0, 0), t, font=f)
    d.text(((s - (bb[2] - bb[0])) / 2 - bb[0] + s * 0.03, (s - (bb[3] - bb[1])) / 2 - bb[1] - s * 0.04), t, font=f, fill='#1f3a5f')
    f2 = ImageFont.truetype(FONT, int(s * (0.09 - pad * 0.1)))
    t2 = '基準法'
    bb = d.textbbox((0, 0), t2, font=f2)
    d.text(((s - (bb[2] - bb[0])) / 2 - bb[0] + s * 0.03, s * (0.70 - pad * 0.3)), t2, font=f2, fill='#57606a')
    im.save(path)

icon(512, os.path.join(ROOT, 'icons/icon-512.png'), pad=0.04)
icon(192, os.path.join(ROOT, 'icons/icon-192.png'))
icon(180, os.path.join(ROOT, 'icons/apple-touch-icon.png'))
print('ok')
