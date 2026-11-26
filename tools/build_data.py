"""Build data/lsa-data.js from the raw official sources + curated notes.

Inputs
  data/raw/versions.json   every historical version (tools/parse_moj.py)
  data/raw/meta.json       law meta, amendment history, article->interpretation map
  data/raw/interp.json     大法官解釋 (tools/parse_ex.py)
  data/curated/cases.json  hand-curated 判決 / 函釋 entries

Output
  data/lsa-data.js         window.LSA_DATA = {...}
"""
import json, os, re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
R = lambda *p: os.path.join(ROOT, *p)

versions = json.load(open(R('data/raw/versions.json'), encoding='utf-8'))
meta = json.load(open(R('data/raw/meta.json'), encoding='utf-8'))
interp = json.load(open(R('data/raw/interp.json'), encoding='utf-8'))
cases_path = R('data/curated/cases.json')
cases = json.load(open(cases_path, encoding='utf-8')) if os.path.exists(cases_path) else []

dates = sorted(versions)
hist = meta['meta']['histories']
assert len(hist) == len(dates), (len(hist), len(dates))

CN = '〇一二三四五六七八九'


def roc(d):
    y, m, dd = int(d[:4]) - 1911, int(d[4:6]), int(d[6:])
    return '%d.%02d.%02d' % (y, m, dd)


def listed_articles(h):
    """Article numbers named in an official amendment note."""
    nums = set()
    for seg in re.findall(r'第\s*([0-9０-９\-～、\s]+?)\s*條', h):
        for part in re.split(r'[、\s]+', seg):
            if not part:
                continue
            if '～' in part:
                a, b = part.split('～')
                for i in range(int(a), int(b) + 1):
                    nums.add(str(i))
            else:
                nums.add(part)
    return nums


def lines(a):
    return [{'i': l['i'], 't': l['t']} for l in a['lines']]


def text(a):
    return '\n'.join(l['t'] for l in a['lines'])


cur = versions[dates[-1]]
articles = []
for a in cur['articles']:
    articles.append({'no': a['no'], 'ch': a['ch'], 'lines': lines(a)})
chapters = cur['chapters']

amendments = []
for i, d in enumerate(dates):
    h = hist[i]
    entry = {'date': d, 'roc': roc(d), 'desc': h, 'changes': []}
    if i == 0:
        entry['desc'] = h
        amendments.append(entry)
        continue
    prev = {a['no']: a for a in versions[dates[i - 1]]['articles']}
    now = {a['no']: a for a in versions[d]['articles']}
    named = listed_articles(h)
    for no in sorted(named | (set(prev) - set(now)), key=lambda x: [int(p) for p in x.split('-')]):
        if no in ('86',) and no not in named:
            continue
        o, n = prev.get(no), now.get(no)
        if o and n and text(o) == text(n):
            continue  # named (e.g. effective-date note) but text unchanged
        if not o and not n:
            continue
        entry['changes'].append({
            'no': no,
            'type': 'add' if not o else ('del' if not n else 'mod'),
            'old': lines(o) if o else [],
            'new': lines(n) if n else [],
        })
    amendments.append(entry)

# 大法官解釋
rel = meta['rela']
by_cno = {x['cno']: x for x in interp}
interps = []
for x in interp:
    arts = sorted([k for k, v in rel.items() if x['cno'] in v], key=lambda s: [int(p) for p in s.split('-')])
    interps.append({'id': 'J' + x['cno'], 'title': x['title'], 'date': x['date'].replace(' ', ''),
                    'issue': x['issue'], 'holding': x['holding'], 'arts': arts,
                    'url': 'https://law.moj.gov.tw/LawClass/ExContent.aspx?ty=C&CC=D&CNO=' + x['cno']})

data = {
    'meta': {
        'name': meta['meta']['name'], 'en': meta['meta']['EngLawName'], 'pcode': meta['meta']['pcode'],
        'modified': meta['meta']['LawModifiedDate'], 'modifiedRoc': roc(meta['meta']['LawModifiedDate']),
        'source': 'https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=N0030001',
    },
    'app': {
        'id': 'lsa-codex', 'db': 'lsa-codex', 'short': '勞基法法典', 'annPos': 'i', 'refTap': 'jump',
        'enact': '民國 73 年 7 月 30 日制定公布',
        'flags': {'49': {'badge': '第1項經釋字807失效', 'cls': 'b-warn',
                         'note': '司法院釋字第807號解釋（110.08.20）：本條第1項規定違反憲法第7條保障性別平等之意旨，應自解釋公布之日起失其效力。'}},
        'others': [{'name': '團體協約法典', 'href': 'cba/'}],
    },
    'chapters': chapters,
    'articles': articles,
    'amendments': amendments,
    'interps': interps,
    'cases': cases,
}

out = R('data/lsa-data.js')
with open(out, 'w', encoding='utf-8') as f:
    f.write('/* 由 tools/build_data.py 產生，請勿手動修改 */\n')
    f.write('window.LSA_DATA = ')
    json.dump(data, f, ensure_ascii=False, separators=(',', ':'))
    f.write(';\n')
print('articles', len(articles), 'amendments', len(amendments),
      'changes', sum(len(a['changes']) for a in amendments), 'interps', len(interps),
      'cases', len(cases), 'bytes', os.path.getsize(out))
for a in amendments:
    print(a['roc'], [c['no'] + ':' + c['type'] for c in a['changes']])
