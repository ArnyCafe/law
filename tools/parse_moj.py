"""Parse law.moj.gov.tw LawAll / LawOldVer HTML into JSON.

Usage: python3 -I parse_moj.py OUT.json FILE1.html [FILE2.html ...]
Each file name (without extension) is used as the version key (yyyymmdd).
"""
import html, json, os, re, sys

ROW = re.compile(r'<div class="h3 char-2">(.*?)</div>|<div class="row"><div class="col-no">(.*?)</div><div class="col-data(?:"><div class="law-article">(.*?)</div>\s*</div></div>| text-pre">(.*?)</div></div>)', re.S)
ITEM = re.compile(r'^[一二三四五六七八九十]+(?:、|\u3000|\s{2})')
ITEM_FIX = re.compile(r'^([一二三四五六七八九十]+)(?:\u3000|\s{2,})')
SUB = re.compile(r'^（[一二三四五六七八九十]+）')

def width(s):
    return sum(1 if ord(c) < 0x2E80 else 2 for c in s)

def unwrap(raw):
    """Old pages are pre-formatted with hard wraps; rebuild logical lines."""
    rows = html.unescape(re.sub(r'<[^>]+>', '', raw)).split('\n')
    rows = [r.rstrip() for r in rows if r.strip()]
    W = max(width(r) for r in rows) if rows else 0
    out, prevfull = [], False
    for r in rows:
        if out and (r.startswith(' ') or r.startswith('\u3000') or (prevfull and not ITEM.match(r) and not SUB.match(r) and not out[-1]['t'].endswith(('。', '：')))):
            out[-1]['t'] += r.strip()
        else:
            it = bool(ITEM.match(r))
            sub = bool(SUB.match(r))
            out.append({'i': 4 if it else (6 if sub else 0), 'p': not (it or sub), 't': r.strip()})
        prevfull = width(r) >= W - 2
    for o in out:  # some old gazettes write 「一　」 instead of 「一、」
        o['t'] = ITEM_FIX.sub(r'\1、', o['t'])
    return out
LINE = re.compile(r'<div class="(line-\d+)( show-number)?">(.*?)</div>', re.S)

def clean(s):
    return html.unescape(re.sub(r'<[^>]+>', '', s)).strip()

def parse(path):
    s = open(path, encoding='utf-8').read()
    chapters, arts, cur = [], [], None
    for m in ROW.finditer(s):
        if m.group(1) is not None:
            cur = re.sub(r'\s+', ' ', clean(m.group(1)))
            chapters.append(cur)
            continue
        no = clean(m.group(2)).replace('第', '').replace('條', '').strip()
        if m.group(3) is None:
            arts.append({'no': no, 'ch': cur, 'lines': unwrap(m.group(4))})
            continue
        lines = []
        for lm in LINE.finditer(m.group(3)):
            lines.append({'i': int(lm.group(1)[5:]), 'p': bool(lm.group(2)), 't': clean(lm.group(3))})
        arts.append({'no': no, 'ch': cur, 'lines': lines})
    return {'chapters': chapters, 'articles': arts}

out = {}
for f in sys.argv[2:]:
    out[os.path.splitext(os.path.basename(f))[0]] = parse(f)
json.dump(out, open(sys.argv[1], 'w', encoding='utf-8'), ensure_ascii=False)
for k, v in out.items():
    print(k, len(v['articles']), len(v['chapters']))
