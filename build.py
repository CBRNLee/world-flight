#!/usr/bin/env python3
"""
build.py — 여러 파일로 나뉜 프로그램을 '파일 하나'로 묶습니다.

    python3 build.py

만들어지는 파일 (dist/ 안):
  · 세계여행비행기.html  — 어디에나 올리거나 그냥 더블클릭해도 되는 완전한 한 장짜리 파일
  · artifact.html        — claude.ai Artifact 로 올릴 때 쓰는 판 (겉껍데기 태그 없음)

CSS 와 JS 를 HTML 안에 그대로 넣기 때문에, 인터넷이 없어도·서버가 없어도 돌아갑니다.
"""

import io
import os
import re
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
DIST = os.path.join(ROOT, 'dist')


def read(*parts):
    with io.open(os.path.join(ROOT, *parts), encoding='utf-8') as f:
        return f.read()


def inline(html):
    """<link rel=stylesheet> 와 <script src=...> 를 실제 내용으로 바꿔 넣는다."""

    def css_sub(m):
        path = m.group(1)
        return '<style>\n/* ===== %s ===== */\n%s\n</style>' % (path, read(*path.split('/')))

    def js_sub(m):
        path = m.group(1)
        return '<script>\n/* ===== %s ===== */\n%s\n</script>' % (path, read(*path.split('/')))

    html = re.sub(r'<link rel="stylesheet" href="([^"]+)"\s*/?>', css_sub, html)
    html = re.sub(r'<script src="([^"]+)"></script>', js_sub, html)

    if 'href="css/' in html or 'src="js/' in html:
        sys.exit('오류: 아직 바깥 파일을 참조하고 있습니다.')
    return html


def to_artifact(html):
    """Artifact 는 <!doctype>·<html>·<head>·<body> 를 스스로 붙이므로 벗겨 낸다."""
    html = re.sub(r'(?is)^\s*<!DOCTYPE[^>]*>\s*', '', html)
    html = re.sub(r'(?is)<html[^>]*>\s*', '', html)
    html = re.sub(r'(?is)\s*</html>\s*$', '', html)
    html = re.sub(r'(?is)<head[^>]*>\s*', '', html)
    html = re.sub(r'(?is)\s*</head>\s*', '\n', html)
    html = re.sub(r'(?is)<body[^>]*>\s*', '', html)
    html = re.sub(r'(?is)\s*</body>\s*', '\n', html)
    # 파비콘은 Artifact 쪽 설정을 쓰므로 제거
    html = re.sub(r'(?is)<link rel="icon"[^>]*>\s*', '', html)
    # <meta charset> · <meta viewport> 도 Artifact 가 넣어 준다
    html = re.sub(r'(?is)<meta charset[^>]*>\s*', '', html)
    html = re.sub(r'(?is)<meta name="viewport"[^>]*>\s*', '', html)
    return html.strip() + '\n'


def main():
    src = read('index.html')
    full = inline(src)
    art = to_artifact(full)

    if not os.path.isdir(DIST):
        os.mkdir(DIST)

    out = [('세계여행비행기.html', full), ('artifact.html', art)]
    for name, text in out:
        with io.open(os.path.join(DIST, name), 'w', encoding='utf-8') as f:
            f.write(text)
        print('  dist/%-22s %7.1f KB' % (name, len(text.encode('utf-8')) / 1024.0))

    print('\n완성! dist/세계여행비행기.html 은 그대로 더블클릭해도 되고,')
    print('웹 서버 아무 곳에나 올려도 됩니다.')


if __name__ == '__main__':
    main()
