"""Fetch full texts of selected judgments (for verifying which passages are the court's own reasoning)
and search 裁判書系統 for 函釋 on 團體協約法.

Usage: python3 -I cba_fetch.py out.json
"""
import json, os, re, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
exec(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'fjud.py'), encoding='utf-8').read().split('def main')[0])

OUT = sys.argv[1]
res = json.load(open(OUT, encoding='utf-8')) if os.path.exists(OUT) else {'docs': {}, 'adm': {}}
mined = json.load(open(os.path.join(os.path.dirname(OUT), 'mined.json'), encoding='utf-8'))

# full text of every 最高法院 / 最高行政法院 judgment found applying the Act
for art, e in mined.items():
    for o in e['own']:
        if o['name'] in res['docs']:
            continue
        try:
            res['docs'][o['name']] = {'url': o['url'], 'text': text_of(get(o['url']))}
            print('doc', o['name'], flush=True)
        except Exception as ex:
            print('fail', o['name'], ex, flush=True)
        time.sleep(0.3)
        json.dump(res, open(OUT, 'w', encoding='utf-8'), ensure_ascii=False)

# 函釋 cited together with 團體協約法
ADM = re.compile(r'((?:行政院勞工委員會|勞委會|勞動部|改制前行政院勞工委員會)[^，。；（）()]{0,25}?\d{2,3}年\d{1,2}月\d{1,2}日[^，。；（）()]{0,25}?字第[0-9０-９]+號(?:函|令|函釋|解釋)?)')
for kw in ['團體協約法 勞動關2字', '團體協約法 勞資2字', '團體協約 函釋 協商資格', '團體協約法第13條 函', '團體協約 備查 函釋', '禁搭便車 函釋']:
    if kw in res['adm']:
        continue
    links, total = search(kw)
    hits = []
    for url, name in links[:15]:
        try:
            t = text_of(get(BASE + url))
        except Exception:
            continue
        for m in ADM.finditer(t):
            win = t[max(0, m.start() - 300): m.end() + 500]
            if '團體協約' in win:
                hits.append({'cite': m.group(1), 'src': name, 'url': BASE + url, 'text': win})
        time.sleep(0.3)
    res['adm'][kw] = hits
    print('adm', kw, total, len(hits), flush=True)
    json.dump(res, open(OUT, 'w', encoding='utf-8'), ensure_ascii=False)
