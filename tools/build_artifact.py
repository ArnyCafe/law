"""Make dist/artifact.html: index.html body+head content without the document skeleton
and PWA-only tags (for publishing as a claude.ai Artifact)."""
import os, re
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
s = open(os.path.join(ROOT, 'index.html'), encoding='utf-8').read()
s = re.sub(r'<!doctype html>\s*|</?html[^>]*>\s*|</?head>\s*|</?body>\s*', '', s, flags=re.I)
s = re.sub(r'\s*<meta (charset|name="viewport"|name="apple|name="mobile|name="theme-color")[^>]*>', '', s)
s = re.sub(r'\s*<link rel="(manifest|icon|apple-touch-icon)"[^>]*>', '', s)
os.makedirs(os.path.join(ROOT, 'dist'), exist_ok=True)
open(os.path.join(ROOT, 'dist/artifact.html'), 'w', encoding='utf-8').write(s.strip() + '\n')
print('ok')
