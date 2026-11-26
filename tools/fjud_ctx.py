"""For each citation string, search 裁判書系統 and pull longer passages that quote it.

Usage: python3 -I fjud_ctx.py cites.txt out.json [per=2]
"""
import json, re, sys, time
sys.path.insert(0, __import__('os').path.dirname(__file__))
from fjud import search, get, text_of, BASE

def window(t, cite_core):
    # find citation (allow 臺/台 and optional spaces already removed by text_of)
    pat = re.escape(cite_core).replace('台', '[台臺]')
    out = []
    for m in re.finditer(pat, t):
        s = t[max(0, m.start() - 700):m.start()]
        # start after the last "按" / "次按" / heading-ish boundary if present
        k = max(s.rfind('按'), s.rfind('。', 0, len(s) - 80))
        out.append(s[k + 1:] if k > 0 else s)
        if len(out) >= 1:
            break
    return out

def main():
    cites = [l.strip() for l in open(sys.argv[1], encoding='utf-8') if l.strip() and not l.startswith('#')]
    per = int(sys.argv[3]) if len(sys.argv) > 3 else 2
    res = {}
    try:
        res = json.load(open(sys.argv[2], encoding='utf-8'))
    except Exception:
        pass
    for c in cites:
        if c in res:
            continue
        core = re.sub(r'^最高法院', '', c)
        links, total = search(c)
        ps = []
        for url, name in links[:6]:
            try:
                t = text_of(get(BASE + url))
            except Exception:
                continue
            w = window(t, core)
            if w:
                ps.append({'src': name, 'url': BASE + url, 'text': w[0]})
            if len(ps) >= per:
                break
            time.sleep(0.3)
        res[c] = {'total': total, 'passages': ps}
        print(c, total, len(ps), flush=True)
        json.dump(res, open(sys.argv[2], 'w', encoding='utf-8'), ensure_ascii=False, indent=1)

main()
