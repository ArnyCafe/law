"""Make dist/artifact.html (勞基法法典) and dist/cba-artifact.html (團體協約法典): index.html body+head
content without the document skeleton and PWA-only tags (for publishing as a claude.ai Artifact).
Publish together with app.css, app.js and the data file at the artifact root."""
import os, re
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
def build(src, out):
    s = open(os.path.join(ROOT, src), encoding='utf-8').read()
    s = s.replace('../app.', 'app.')
    s = re.sub(r'<!doctype html>\s*|</?html[^>]*>\s*|</?head>\s*|</?body>\s*', '', s, flags=re.I)
    s = re.sub(r'\s*<meta (charset|name="viewport"|name="apple|name="mobile|name="theme-color")[^>]*>', '', s)
    s = re.sub(r'\s*<link rel="(manifest|icon|apple-touch-icon)"[^>]*>', '', s)
    os.makedirs(os.path.join(ROOT, 'dist'), exist_ok=True)
    open(os.path.join(ROOT, out), 'w', encoding='utf-8').write(s.strip() + '\n')


build('index.html', 'dist/artifact.html')
build('cba/index.html', 'dist/cba-artifact.html')
print('ok')
