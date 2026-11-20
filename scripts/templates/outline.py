#!/usr/bin/env python3
"""Outline the glyphs the template lettering uses into scripts/templates/lettering.json.

    python3 scripts/templates/outline.py

The gallery templates draw a few display words (e.g. Blacktop's graffiti title) as vector art, so the
pictures need no font and look the same in Lumen and Power BI. The outlines come from Barlow (SIL Open
Font License 1.1, bundled with Lumen via @fontsource/barlow); the OFL allows embedding outlines in artwork.
Paths are in a 1000-unit em, y pointing down, baseline at 0. Needs fontTools.
"""
import json
import os
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen

HERE = os.path.dirname(os.path.abspath(__file__))
FONTS = os.path.join(HERE, '..', '..', 'node_modules', '@fontsource', 'barlow', 'files')
FACES = {
    'barlow-black-italic': 'barlow-latin-900-italic.woff',
    'barlow-black': 'barlow-latin-900-normal.woff',
}
CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!&-.'


def outline(path):
    font = TTFont(path)
    upm = font['head'].unitsPerEm
    s = 1000 / upm
    cmap = font.getBestCmap()
    gs = font.getGlyphSet()
    out = {}
    for ch in CHARS:
        name = cmap.get(ord(ch))
        if not name:
            continue
        pen = SVGPathPen(gs)
        gs[name].draw(TransformPen(pen, (s, 0, 0, -s, 0, 0)))
        d = pen.getCommands()
        out[ch] = {'d': d, 'adv': round(gs[name].width * s, 1)}
    out[' '] = {'d': '', 'adv': round(gs[cmap[32]].width * s, 1)}
    return out


if __name__ == '__main__':
    data = {face: outline(os.path.join(FONTS, f)) for face, f in FACES.items()}
    with open(os.path.join(HERE, 'lettering.json'), 'w') as fh:
        json.dump(data, fh, separators=(',', ':'))
    print('wrote lettering.json')
