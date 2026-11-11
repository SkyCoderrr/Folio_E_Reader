# Build a small EPUB3 from the public-domain Xiyouji TXT fixture (chapters 1-3) for CJK rendering checks.
import re, zipfile, html, os
src = os.path.join('tests', 'fixtures', 'xiyouji-ch1-5-utf8.txt')
t = open(src, encoding='utf-8').read()
parts = re.split(r'(?m)^\s*(\u7b2c[\u4e00-\u9fff0-9]+\u56de.*)$', t)
chapters = []
for i in range(1, len(parts) - 1, 2):
    chapters.append((parts[i].strip(), parts[i + 1]))
chapters = chapters[:3]
def xhtml(title, body):
    paras = ''.join('<p>%s</p>\n' % html.escape(''.join(l.strip() for l in p.splitlines())) for p in re.split(r'\n\s*\n', body) if p.strip())
    return ('<?xml version="1.0" encoding="utf-8"?>\n<!DOCTYPE html>\n<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="zh-Hant" lang="zh-Hant">'
            '<head><title>%s</title></head><body><h2>%s</h2>\n%s</body></html>' % (html.escape(title), html.escape(title), paras))
out = os.path.join('tests', 'fixtures', 'xiyouji-ch1-3.epub')
with zipfile.ZipFile(out, 'w') as z:
    z.writestr(zipfile.ZipInfo('mimetype'), 'application/epub+zip', compress_type=zipfile.ZIP_STORED)
    z.writestr('META-INF/container.xml', '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>', compress_type=zipfile.ZIP_DEFLATED)
    items, spine, nav = '', '', ''
    for n, (title, body) in enumerate(chapters, 1):
        z.writestr('OEBPS/c%d.xhtml' % n, xhtml(title, body), compress_type=zipfile.ZIP_DEFLATED)
        items += '<item id="c%d" href="c%d.xhtml" media-type="application/xhtml+xml"/>' % (n, n)
        spine += '<itemref idref="c%d"/>' % n
        nav += '<li><a href="c%d.xhtml">%s</a></li>' % (n, html.escape(title))
    z.writestr('OEBPS/nav.xhtml', '<?xml version="1.0" encoding="utf-8"?><!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>\u76ee\u9304</title></head><body><nav epub:type="toc"><ol>%s</ol></nav></body></html>' % nav, compress_type=zipfile.ZIP_DEFLATED)
    z.writestr('OEBPS/content.opf', '<?xml version="1.0" encoding="utf-8"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">urn:e-reader-fixture:xiyouji-ch1-3</dc:identifier><dc:title>\u897f\u904a\u8a18 (\u7b2c\u4e00\u81f3\u4e09\u56de)</dc:title><dc:creator>\u5433\u627f\u6069</dc:creator><dc:language>zh-Hant</dc:language><meta property="dcterms:modified">2026-11-09T00:00:00Z</meta></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>%s</manifest><spine>%s</spine></package>' % (items, spine), compress_type=zipfile.ZIP_DEFLATED)
print('chapters', len(chapters), 'size', os.path.getsize(out))

