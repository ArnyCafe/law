"""Parse law.moj.gov.tw ExContent (大法官解釋) pages -> JSON list."""
import html, json, re, sys, os

def lines(path):
    s = open(path, encoding='utf-8').read()
    t = re.sub(r'<script.*?</script>|<style.*?</style>', '', s, flags=re.S)
    t = re.sub(r'<br\s*/?>', '\n', t)
    t = re.sub(r'<[^>]+>', '\n', t)
    return [l.strip() for l in html.unescape(t).split('\n') if l.strip()]

def section(L, head, stops):
    if head not in L:
        return ''
    i = L.index(head) + 1
    out = []
    while i < len(L) and L[i] not in stops:
        out.append(L[i]); i += 1
    return ''.join(out)

STOPS = {'理由書：', '解釋爭點：', '解釋文：', '相關附件：', '意見書：', '抄本：', '回上方', '相關法條：', '資料來源：'}
def raw_field(path, head):
    s = open(path, encoding='utf-8').read()
    m = re.search(head + r'</div>\s*<div class="col-td text-pre">(.*?)</div>', s, re.S)
    if not m:
        return ''
    t = html.unescape(re.sub(r'<[^>]+>', '', m.group(1)))
    paras = re.split(r'\n?\s{4,}', t)
    return '\n'.join(re.sub(r'\s*\n\s*', '', x).strip() for x in paras if x.strip()).replace('﹐', '，')

res = []
for f in sys.argv[2:]:
    L = lines(f)
    no = section(L, '解釋字號：', STOPS | {'解釋日期：'})
    date = section(L, '解釋日期：', STOPS)
    res.append({
        'cno': os.path.splitext(os.path.basename(f))[0],
        'title': no.replace(' ', ''),
        'date': date,
        'issue': raw_field(f, '解釋爭點：'),
        'holding': raw_field(f, '解釋文：'),
    })
json.dump(res, open(sys.argv[1], 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
for r in res:
    print(r['title'], r['date'], len(r['holding']), r['issue'][:40])
