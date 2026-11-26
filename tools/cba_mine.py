"""Mine 司法院裁判書系統 for judgments applying 團體協約法 articles.

Usage: python3 -I cba_mine.py out.json ART [ART ...]
For each article N, search 「團體協約法第N條」, fetch up to 20 result judgments and record
  - the judgment's own passages mentioning the article (for 最高法院 / 最高行政法院 results)
  - citations of 最高法院 / 最高行政法院 judgments, 主管機關函釋 and 不當勞動行為裁決決定,
    each with the sentence(s) preceding it.
Results are merged into out.json (resumable).
"""
import json, os, re, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
exec(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'fjud.py'), encoding='utf-8').read().split('def main')[0])

SUPC = re.compile(r'最高法院(?:民事大法庭)?(\d{2,3})年度?(台上|臺上|台上大|臺上大|台抗|臺抗)字第(\d+)號')
SUPA = re.compile(r'最高行政法院(\d{2,3})年度?(判|裁|上|抗|大)字第(\d+)號')
ADM2 = re.compile(r'((?:行政院勞工委員會|勞委會|勞動部|內政部|行政院)[^，。；（）()]{0,25}?\d{2,3}年\d{1,2}月\d{1,2}日[^，。；（）()]{0,25}?字第[0-9０-９]+號(?:函|令|函釋|解釋))')
AWD = re.compile(r'(\d{2,3})年勞裁字第(\d+)號')
CN = '〇一二三四五六七八九'

def cn(n):
    n = int(n)
    if n < 10: return CN[n]
    if n < 20: return '十' + (CN[n % 10] if n % 10 else '')
    return CN[n // 10] + '十' + (CN[n % 10] if n % 10 else '')

def ctx_before(t, i, n=420):
    s = t[max(0, i - n):i]
    k = max(s.rfind('。', 0, len(s) - 30), s.rfind('按', 0, len(s) - 30))
    return s[k + 1:] if k >= 0 else s

def around(t, i, pre=160, post=700):
    s = max(0, i - pre)
    k = t.rfind('。', s, i)
    s = k + 1 if k >= 0 else s
    e = t.find('。', i + post)
    return t[s:(e + 1 if e > 0 else i + post)]

def main():
    out_p = sys.argv[1]
    res = json.load(open(out_p, encoding='utf-8')) if os.path.exists(out_p) else {}
    for art in sys.argv[2:]:
        if art in res: continue
        kw = '團體協約法第%s條' % art
        try:
            links, total = search(kw)
        except Exception as e:
            print('search fail', art, e, flush=True); continue
        pats = [kw, '團體協約法第%s條' % cn(art)]
        entry = {'total': total, 'own': [], 'cites': {}}
        for url, name in links[:20]:
            try:
                t = text_of(get(BASE + url))
            except Exception as e:
                print('  skip', name, e, flush=True); continue
            full = BASE + url
            if name.startswith('最高'):
                for p in pats:
                    i = t.find(p)
                    if i >= 0:
                        entry['own'].append({'name': name, 'url': full, 'text': around(t, i)})
                        break
            seen = set()
            for rx, kind in ((SUPC, 'S'), (SUPA, 'SA'), (ADM2, 'A'), (AWD, 'W')):
                for m in rx.finditer(t):
                    if kind == 'S': key = '最高法院%s年度%s字第%s號' % (m.group(1), m.group(2).replace('臺', '台'), m.group(3))
                    elif kind == 'SA': key = '最高行政法院%s年度%s字第%s號' % m.groups()
                    elif kind == 'W': key = '%s年勞裁字第%s號' % m.groups()
                    else: key = re.sub(r'\s', '', m.group(1))
                    if key in seen: continue
                    seen.add(key)
                    c = entry['cites'].setdefault(key, {'kind': kind, 'n': 0, 'ctx': []})
                    c['n'] += 1
                    if len(c['ctx']) < 3:
                        c['ctx'].append({'src': name, 'url': full, 'text': ctx_before(t, m.start())})
            time.sleep(0.2)
        res[art] = entry
        top = sorted(entry['cites'].items(), key=lambda kv: -kv[1]['n'])[:8]
        print(art, total, 'own', len(entry['own']), [(k, v['n']) for k, v in top], flush=True)
        json.dump(res, open(out_p, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)

main()
