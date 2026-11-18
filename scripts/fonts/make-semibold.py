#!/usr/bin/env python3
"""
Build the bundled "Lumen Sans Semibold" face (src/renderer/src/assets/fonts/selawik/lumensans-semibold.woff2).

Why: Power BI's "Segoe UI Semibold" (the default face of visual titles, slicer headers, selected navigator items…)
is visibly between Segoe UI Regular and Bold. Selawik, the open metric-compatible stand-in Lumen bundles, has a
Semibold whose stems (0.129 em) are 84% of the way from Regular (0.080 em) to Bold (0.154 em), so semibold text
reads as bold next to real bold text. This script derives a lighter semibold:

  - outlines: Selawik Regular emboldened by STRENGTH_X / STRENGTH_Y font units (FreeType's FT_Outline_EmboldenXY
    algorithm: every point moves along the bisector of its two edge normals), giving stems of ~0.102 em;
  - advance widths and kerning (GPOS): Selawik Semibold's, so text measures like the semibold face (Segoe UI
    Semibold's advances match Selawik Semibold's to within a few px on a 60-character title measured on a Power BI
    render); each glyph is centred in the wider advance;
  - baseline, cap height and x-height kept: the glyph is raised by STRENGTH_Y / 2 and scaled vertically by
    CAP / (CAP + STRENGTH_Y) about the baseline.

Approximation: the target stem weight is a perceptual match to Power BI renders, not a measured Segoe UI value.

License: Selawik is © Microsoft, SIL OFL 1.1 with Reserved Font Name "Selawik", so the modified font carries
another name ("Lumen Sans"), keeps the copyright notice and stays under the OFL (see OFL.txt next to it).

Usage: python3 scripts/fonts/make-semibold.py   (needs fontTools + brotli; the output is committed)
"""
import math
import os
import sys

from fontTools.ttLib import TTFont

HERE = os.path.dirname(os.path.abspath(__file__))
FONTS = os.path.normpath(os.path.join(HERE, '..', '..', 'src', 'renderer', 'src', 'assets', 'fonts', 'selawik'))
STRENGTH_X = 44  # font units (2048 / em): Regular stem 164 → ~208 (0.102 em)
STRENGTH_Y = 26  # horizontal strokes are thinner than vertical stems in Segoe-style designs
CAP = 1434  # Selawik cap height (font units)
FAMILY = 'Lumen Sans'
STYLE = 'Semibold'


def embolden_contour(pts, sx, sy):
    """FT_Outline_EmboldenXY for one closed contour (TrueType orientation: filled area on the right)."""
    n = len(pts)
    if n < 3:
        return pts
    out = []
    for i in range(n):
        cx, cy = pts[i]
        # previous / next distinct points (skip coincident ones)
        j = (i - 1) % n
        while j != i and pts[j] == pts[i]:
            j = (j - 1) % n
        k = (i + 1) % n
        while k != i and pts[k] == pts[i]:
            k = (k + 1) % n
        if j == i or k == i:
            out.append((cx, cy))
            continue
        ix, iy = cx - pts[j][0], cy - pts[j][1]
        ox, oy = pts[k][0] - cx, pts[k][1] - cy
        li, lo = math.hypot(ix, iy), math.hypot(ox, oy)
        ix, iy, ox, oy = ix / li, iy / li, ox / lo, oy / lo
        # outward normals of a clockwise (y-up) contour: (-dy, dx)
        nix, niy = -iy, ix
        nox, noy = -oy, ox
        d = 1 + nix * nox + niy * noy
        if d < 0.15:  # very sharp corner: limit the miter like FreeType does
            d = 0.15
        shx = (nix + nox) / d
        shy = (niy + noy) / d
        out.append((cx + shx * sx / 2, cy + shy * sy / 2))
    return out


def main() -> int:
    reg = TTFont(os.path.join(FONTS, 'selawk.woff2'))
    sb = TTFont(os.path.join(FONTS, 'selawksb.woff2'))
    if reg.getGlyphOrder() != sb.getGlyphOrder():
        print('glyph orders differ', file=sys.stderr)
        return 1
    glyf = reg['glyf']
    hmtx_r, hmtx_s = reg['hmtx'].metrics, sb['hmtx'].metrics
    order = reg.getGlyphOrder()
    # centring shift per glyph (applied to simple glyphs; composites inherit it through their base components)
    shift = {}
    for g in order:
        adv_r = hmtx_r[g][0]
        adv_s = hmtx_s[g][0]
        shift[g] = STRENGTH_X / 2 + (adv_s - adv_r - STRENGTH_X) / 2
    for g in order:
        gl = glyf[g]
        if gl.isComposite() or gl.numberOfContours <= 0:
            continue
        coords = gl.coordinates
        ends = gl.endPtsOfContours
        start = 0
        new = []
        for end in ends:
            contour = [tuple(coords[i]) for i in range(start, end + 1)]
            new.extend(embolden_contour(contour, STRENGTH_X, STRENGTH_Y))
            start = end + 1
        dx, dy = shift[g], STRENGTH_Y / 2
        for i, (x, y) in enumerate(new):
            coords[i] = (round(x + dx), round((y + dy) * CAP / (CAP + STRENGTH_Y)))
    for g in order:
        gl = glyf[g]
        if gl.isComposite():
            # each component already carries its own centring shift: move it to this glyph's shift instead
            for c in gl.components:
                c.x = round(c.x + shift[g] - shift[c.glyphName])
    for g in order:
        glyf[g].recalcBounds(glyf)
        lsb = glyf[g].xMin if hasattr(glyf[g], 'xMin') else 0
        reg['hmtx'].metrics[g] = (hmtx_s[g][0], lsb)
    reg['GPOS'] = sb['GPOS']
    if 'GDEF' in sb:
        reg['GDEF'] = sb['GDEF']
    reg['hhea'].advanceWidthMax = max(w for w, _ in reg['hmtx'].metrics.values())
    reg['OS/2'].usWeightClass = 600
    reg['OS/2'].xAvgCharWidth = sb['OS/2'].xAvgCharWidth
    reg['OS/2'].fsSelection = (reg['OS/2'].fsSelection & ~0x40) | 0x0  # not REGULAR
    name = reg['name']
    copyright = name.getDebugName(0) or ''
    for rec in list(name.names):
        if rec.nameID in (1, 2, 3, 4, 6, 7, 8, 9, 11, 12, 16, 17):
            name.removeNames(nameID=rec.nameID)
    entries = {
        0: copyright + ' Modified by the Lumen authors (emboldened Regular outlines, Semibold metrics).',
        1: FAMILY,
        2: STYLE,
        3: f'{FAMILY} {STYLE}; derived from Selawik 1.01',
        4: f'{FAMILY} {STYLE}',
        6: f'{FAMILY.replace(" ", "")}-{STYLE}',
    }
    for nid, text in entries.items():
        name.setName(text, nid, 3, 1, 0x409)
        name.setName(text, nid, 1, 0, 0)
    reg.flavor = 'woff2'
    out = os.path.join(FONTS, 'lumensans-semibold.woff2')
    reg.save(out)
    print('wrote', out)
    return 0


if __name__ == '__main__':
    sys.exit(main())
