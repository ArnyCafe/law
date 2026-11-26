"""Build cba/cba-data.js (團體協約法典) from official sources + curated notes.

Inputs
  data/cba/raw/versions.json    every historical version (tools/parse_moj.py on LawOldVer / LawAll pages)
  data/cba/raw/meta.json        law meta and official amendment history (LawHistory.aspx)
  data/cba/raw/refs.json        texts of related laws (工會法、勞資爭議處理法、勞基法、民法 — LawAll pages)
  data/cba/curated/annot.json   97年全文修正條次對應、詞句連結、相關法條、內建編按
  data/cba/curated/cases.json   判決、裁決、函釋（tools/build_cba_cases.py）

Output
  cba/cba-data.js               window.LSA_DATA = {...}  (same shape as data/lsa-data.js + app/refLaws/links/related)
"""
import json, os, re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
R = lambda *p: os.path.join(ROOT, *p)
L = lambda p: json.load(open(R(p), encoding='utf-8'))

versions = L('data/cba/raw/versions.json')
meta = L('data/cba/raw/meta.json')
refs = L('data/cba/raw/refs.json')
ann = L('data/cba/curated/annot.json')
cases = L('data/cba/curated/cases.json') if os.path.exists(R('data/cba/curated/cases.json')) else []

dates = sorted(versions)
assert dates == sorted(meta['histories']), (dates, sorted(meta['histories']))
key_no = lambda x: [int(p) for p in x.split('-')]


def roc(d):
    return '%d.%02d.%02d' % (int(d[:4]) - 1911, int(d[4:6]), int(d[6:]))


ITEM_SPLIT = re.compile(r'(?<=[：。；])(?=[一二三四五六七八九十]{1,2}　)')


def lines(a):
    out = []
    for l in a['lines']:
        if l['i'] == 0 and l['t'].startswith('但') and out and out[-1]['i'] == 0:
            out[-1]['t'] += l['t']  # 舊版頁面硬斷行：但書不會另起一項
            continue
        parts = ITEM_SPLIT.split(l['t']) if l['i'] == 0 else [l['t']]
        out.append({'i': l['i'], 't': parts[0]})
        for p in parts[1:]:  # 19年舊法把各款寫在同一行：「左列各款…：一　…。二　…」
            out.append({'i': 4, 't': re.sub(r'^([一二三四五六七八九十]{1,2})　', r'\1、', p)})
    return out


def text(a):
    return '\n'.join(l['t'] for l in lines(a))


cur = versions[dates[-1]]
articles = [{'no': a['no'], 'ch': a['ch'], 'lines': lines(a)} for a in cur['articles']]
ART = {a['no']: a for a in articles}

# ---------------- amendments ----------------
amendments = []
for i, d in enumerate(dates):
    entry = {'date': d, 'roc': roc(d), 'desc': meta['histories'][d], 'title': meta['titles'][d], 'changes': []}
    if i == 0:
        amendments.append(entry)
        continue
    prev = {a['no']: a for a in versions[dates[i - 1]]['articles']}
    now = {a['no']: a for a in versions[d]['articles']}
    if d == '20080109':  # 全文修正：條次重編，依 annot.json map97 對應
        entry['full'] = True
        entry['note'] = '本次為全文修正（31 條→34 條），條次全部重新編排。下列「原第○條」係依條文內容所作之新舊條次對應，僅供比較參考；未列對應者為新增條文。'
        used = set()
        for no in sorted(now, key=key_no):
            olds = ann['map97'][no]
            used.update(olds)
            c = {'no': no, 'type': 'mod' if olds else 'add', 'old': [l for o in olds for l in lines(prev[o])], 'new': lines(now[no])}
            if olds:
                c['oldNos'] = olds
            entry['changes'].append(c)
        for o in sorted(set(prev) - used, key=key_no):
            entry['changes'].append({'no': None, 'oldNos': [o], 'type': 'del', 'old': lines(prev[o]), 'new': []})
    else:
        for no in sorted(set(prev) | set(now), key=key_no):
            o, n = prev.get(no), now.get(no)
            if o and n and text(o) == text(n):
                continue
            entry['changes'].append({'no': no, 'type': 'add' if not o else ('del' if not n else 'mod'),
                                     'old': lines(o) if o else [], 'new': lines(n) if n else []})
    amendments.append(entry)


# ---------------- phrase links / built-in notes ----------------
def find(no, q, nth=0):
    hits = []
    for li, l in enumerate(ART[no]['lines']):
        s = 0
        while (s := l['t'].find(q, s)) >= 0:
            hits.append((li, s, s + len(q)))
            s += len(q)
    assert len(hits) > nth, ('phrase not found', no, q)
    return hits[nth]


links = {}
for no, items in ann['links'].items():
    for it in items:
        for r in it['refs']:
            assert r[1] in refs[r[0]]['arts'], ('missing ref article', r)
        li, s, e = find(no, it['q'], it.get('nth', 0))
        links.setdefault(no, []).append({'l': li, 's': s, 'e': e, 'refs': it['refs']})
for no, items in ann['related'].items():
    for r in items:
        assert r['no'] in refs[r['law']]['arts'], ('missing related article', r)
notes = {}
for no, items in ann['notes'].items():
    for it in items:
        li, s, e = find(no, it['q'], it.get('nth', 0))
        notes.setdefault(no, []).append({'r': [{'l': li, 's': s, 'e': e}], 't': it['t'], 'p': it.get('p', 'a'), 'c': it.get('c', 'r'), 'src': it.get('src', '')})

for c in cases:
    for n in c['arts']:
        assert n in ART, ('case article', c['id'], n)

data = {
    'meta': {
        'name': meta['name'], 'en': meta['en'], 'pcode': meta['pcode'],
        'modified': meta['modified'], 'modifiedRoc': roc(meta['modified']),
        'source': 'https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=' + meta['pcode'],
    },
    'app': {
        'id': 'cba-codex', 'db': 'cba-codex', 'short': '團體協約法典',
        'annPos': 'b', 'refTap': 'peek',
        'enact': '民國 19 年 10 月 28 日制定公布',
        'flags': {}, 'notes': notes,
        'intro': '藍字為本法條號、綠字為其他法律（工會法、勞資爭議處理法、民法…）：點一下即以小字顯示該條文字。紅色小字為註記，用手指或 Apple Pencil 點一下即可隱藏／顯示。',
        'disclaimer': '條文、歷次修正條文及工會法、勞資爭議處理法、勞動基準法、民法等相關條文取自法務部全國法規資料庫；97 年全文修正之新舊條次對應係依條文內容整理，僅供比較參考。判決、裁決要旨係摘錄自司法院裁判書系統之判決原文（附原文連結），函釋為法院判決中引用之主管機關函號與內容摘錄。本工具僅供學習參考，實際引用請以原文為準。個人註記僅儲存在本裝置，請定期於「設定」匯出備份。',
        'others': [{'name': '勞基法法典', 'href': '../'}],
    },
    'chapters': cur['chapters'],
    'articles': articles,
    'amendments': amendments,
    'interps': [],
    'cases': cases,
    'refLaws': refs,
    'links': links,
    'related': ann['related'],
}

out = R('cba/cba-data.js')
os.makedirs(os.path.dirname(out), exist_ok=True)
with open(out, 'w', encoding='utf-8') as f:
    f.write('/* 由 tools/build_cba.py 產生，請勿手動修改 */\n')
    f.write('window.LSA_DATA = ')
    json.dump(data, f, ensure_ascii=False, separators=(',', ':'))
    f.write(';\n')
print('articles', len(articles), 'amendments', len(amendments), 'changes', sum(len(a['changes']) for a in amendments),
      'cases', len(cases), 'links', sum(len(v) for v in links.values()), 'notes', sum(len(v) for v in notes.values()),
      'bytes', os.path.getsize(out))
for a in amendments:
    print(a['roc'], [(c['no'] or '-') + ':' + c['type'] + ('<' + ','.join(c['oldNos']) if c.get('oldNos') else '') for c in a['changes']])
