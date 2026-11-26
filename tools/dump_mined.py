"""Print mined citations with context for manual curation."""
import json, sys
d = json.load(open(sys.argv[1], encoding='utf-8'))
for t in d:
    print('=' * 30, t['topic']['id'], t['topic']['art'], t['topic']['kw'], t['total'])
    for x in t['sup'][:int(sys.argv[2]) if len(sys.argv) > 2 else 4]:
        print('--', x['cite'], x['count'])
        for c, s in zip(x['ctx'], x['src']):
            print('   [%s] %s' % (s, c[-260:]))
    for x in t['adm'][:4]:
        print('-- ADM', x['cite'], x['count'])
        for c, s in zip(x['ctx'][:1], x['src'][:1]):
            print('   [%s] %s' % (s, c[-200:]))
