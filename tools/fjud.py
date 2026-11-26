"""Query 司法院裁判書系統 (judgment.judicial.gov.tw) by keyword and mine citations.

Usage: python3 -I fjud.py topics.json out.json
topics.json: [{"id": ..., "art": "11", "kw": "能為而不為", "n": 15}, ...]
For every topic, fetch up to n result judgments, extract
  - Supreme Court citations  (最高法院xx年度台上字第xxx號)
  - administrative interpretation citations (…字第xxx號函)
with the sentence that precedes each citation, then rank by frequency.
"""
import html, http.cookiejar, json, re, sys, time, urllib.parse, urllib.request
from collections import Counter, defaultdict

BASE = 'https://judgment.judicial.gov.tw/FJUD/'
cj = http.cookiejar.CookieJar()
op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))
op.addheaders = [('User-Agent', 'Mozilla/5.0 (research script)')]

def get(url, data=None, tries=4):
    for i in range(tries):
        try:
            with op.open(url, data=data, timeout=40) as r:
                return r.read().decode('utf-8', 'replace')
        except Exception as e:
            err = e
            time.sleep(2 + 3 * i)
    raise err

def text_of(page):
    t = re.sub(r'<script.*?</script>|<style.*?</style>', '', page, flags=re.S)
    t = re.sub(r'<br\s*/?>', '\n', t)
    t = html.unescape(re.sub(r'<[^>]+>', '', t))
    t = re.sub(r'[ \t　]+', '', t)
    return re.sub(r'\n+', '', t)

def search(kw):
    d = get(BASE + 'default.aspx')
    f = {k: (re.search(r'id="%s" value="([^"]*)' % k, d) or [None, ''])[1]
         for k in ('__VIEWSTATE', '__VIEWSTATEGENERATOR', '__EVENTVALIDATION')}
    f.update({'__VIEWSTATEENCRYPTED': '', 'txtKW': kw, 'judtype': 'JUDBOOK', 'whosub': '0',
              'ctl00$cp_content$btnSimpleQry': '送出查詢'})
    r = get(BASE + 'default.aspx', urllib.parse.urlencode(f).encode())
    m = re.search(r'qryresultlst\.aspx\?ty=JUDBOOK&amp;q=([0-9a-f]+)', r)
    if not m:
        return [], 0
    l = get(BASE + 'qryresultlst.aspx?ty=JUDBOOK&q=' + m.group(1))
    tot = re.search(r'共\s*([\d,]+)\s*筆', l)
    links = re.findall(r'href="(data\.aspx\?ty=JD&amp;id=[^"]+)"[^>]*>([^<]+)', l)
    return [(html.unescape(u), re.sub(r'\s+', ' ', n).strip()) for u, n in links], int(tot.group(1).replace(',', '')) if tot else 0

SUP = re.compile(r'最高法院(?:民事大法庭)?(\d{2,3})年度?(台上|臺上|台上大|臺上大|台抗|臺抗)字第(\d+)號(?:民事)?(?:判決|裁定|判例)?')
ADM = re.compile(r'((?:行政院勞工委員會|勞委會|勞動部|內政部|行政院)[^，。；（）()]{0,25}?\d{2,3}年\d{1,2}月\d{1,2}日[^，。；（）()]{0,25}?字第[0-9０-９]+號(?:函|令|函釋|解釋))')

def before(text, idx, n=260):
    s = text[max(0, idx - n):idx]
    # start at a sentence boundary
    cut = max(s.rfind('。'), s.rfind('；'))
    return s[cut + 1:] if cut >= 0 and cut < len(s) - 20 else s

def main():
    topics = json.load(open(sys.argv[1], encoding='utf-8'))
    out = []
    for tp in topics:
        links, total = search(tp['kw'])
        sup, adm = Counter(), Counter()
        ctx, src = defaultdict(list), defaultdict(list)
        for url, name in links[:tp.get('n', 15)]:
            try:
                t = text_of(get(BASE + url))
            except Exception as e:
                print('  skip', name, e, file=sys.stderr); continue
            seen = set()
            for m in SUP.finditer(t):
                key = '最高法院%s年度%s字第%s號' % (m.group(1), m.group(2).replace('臺', '台'), m.group(3))
                if key in seen: continue
                seen.add(key); sup[key] += 1
                ctx[key].append(before(t, m.start())); src[key].append(name)
            for m in ADM.finditer(t):
                key = re.sub(r'\s', '', m.group(1))
                if key in seen: continue
                seen.add(key); adm[key] += 1
                ctx[key].append(before(t, m.start())); src[key].append(name)
            time.sleep(0.4)
        res = {'topic': tp, 'total': total,
               'sup': [{'cite': k, 'count': c, 'ctx': ctx[k][:3], 'src': src[k][:3]} for k, c in sup.most_common(8)],
               'adm': [{'cite': k, 'count': c, 'ctx': ctx[k][:3], 'src': src[k][:3]} for k, c in adm.most_common(8)]}
        out.append(res)
        print(tp['id'], total, [(x['cite'], x['count']) for x in res['sup'][:5]], [(x['cite'][:40], x['count']) for x in res['adm'][:3]], flush=True)
        json.dump(out, open(sys.argv[2], 'w', encoding='utf-8'), ensure_ascii=False, indent=1)

if __name__ == '__main__':
    main()
