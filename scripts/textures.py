#!/usr/bin/env python3
"""Download and prepare the PBR textures in public/textures.

All sources are CC0 (Poly Haven and ambientCG). Each material gets a colour,
normal (OpenGL convention) and roughness map, written as WebP at two sizes:
1k for the High quality setting and 512 for Fast.

"Detail" materials (furniture wood, fabric, rug) are made neutral grey with an
average close to white, so the item's own colour tints them in the app.

Usage: python3 scripts/textures.py   (needs Pillow and network access)
"""
import io
import json
import os
import sys
import urllib.request
import zipfile

from PIL import Image, ImageOps, ImageStat

OUT = os.path.join(os.path.dirname(__file__), '..', 'public', 'textures')
SIZES = {'1k': 1024, '512': 512}

# name: (source, asset id, maps, detail)
MATERIALS = {
    'floor_oak': ('ph', 'laminate_floor_02', 'cnr', False),
    'floor_walnut': ('ph', 'wood_floor', 'cnr', False),
    'floor_tile': ('acg', 'Tiles107', 'cnr', False),
    'floor_marble': ('acg', 'Marble012', 'cnr', False),
    'floor_carpet': ('acg', 'Carpet016', 'cnr', False),
    'floor_concrete': ('acg', 'Concrete034', 'cnr', False),
    'wall_plaster': ('ph', 'white_plaster_02', 'nr', False),
    'ground_grass': ('acg', 'Grass004', 'c', False),
    'roof_clay': ('ph', 'clay_roof_tiles_02', 'cnr', False),
    'roof_slate': ('ph', 'roof_slates_02', 'cnr', False),
    'roof_metal': ('ph', 'corrugated_iron', 'cnr', False),
    'wood': ('ph', 'oak_veneer_01', 'cnr', True),
    'fabric': ('acg', 'Fabric086', 'cnr', True),
    'rug': ('acg', 'Carpet016', 'c', True),
}


def get(url: str) -> bytes:
    req = urllib.request.Request(url, headers={'User-Agent': 'walkable-house-textures'})
    with urllib.request.urlopen(req) as r:
        return r.read()


def polyhaven(asset: str) -> dict:
    files = json.loads(get(f'https://api.polyhaven.com/files/{asset}'))
    def pick(*keys):
        for k in keys:
            if k in files:
                return Image.open(io.BytesIO(get(files[k]['1k']['jpg']['url'])))
        return None
    return {'c': pick('Diffuse'), 'n': pick('nor_gl'), 'r': pick('Rough')}


def ambientcg(asset: str) -> dict:
    z = zipfile.ZipFile(io.BytesIO(get(f'https://ambientcg.com/get?file={asset}_1K-JPG.zip')))
    def pick(suffix):
        name = next((n for n in z.namelist() if n.endswith(f'_{suffix}.jpg')), None)
        return Image.open(io.BytesIO(z.read(name))) if name else None
    return {'c': pick('Color'), 'n': pick('NormalGL'), 'r': pick('Roughness')}


def detail(img: Image.Image) -> Image.Image:
    """Grey version whose average is ~0.92, so `colour × map` keeps the colour."""
    g = ImageOps.grayscale(img)
    mean = ImageStat.Stat(g).mean[0] or 1
    g = g.point(lambda v: max(0, min(255, round(v * 235 / mean))))
    return g.convert('RGB')


def resize_tiled(img: Image.Image, size: int) -> Image.Image:
    """Resize a tileable image without seams: filter a 3×3 tiling, keep the middle."""
    w, h = img.size
    big = Image.new(img.mode, (w * 3, h * 3))
    for i in range(3):
        for j in range(3):
            big.paste(img, (i * w, j * h))
    big = big.resize((size * 3, size * 3), Image.LANCZOS)
    return big.crop((size, size, size * 2, size * 2))


def save(img: Image.Image, name: str, kind: str):
    mode = 'L' if kind == 'rough' else 'RGB'
    for folder, size in SIZES.items():
        os.makedirs(os.path.join(OUT, folder), exist_ok=True)
        out = resize_tiled(img.convert(mode), size)
        quality = 90 if kind == 'nor' else 82
        out.save(os.path.join(OUT, folder, f'{name}_{kind}.webp'), 'WEBP', quality=quality, method=6)


def main():
    only = set(sys.argv[1:])
    for name, (src, asset, maps, is_detail) in MATERIALS.items():
        if only and name not in only:
            continue
        print(name, '<-', src, asset)
        imgs = polyhaven(asset) if src == 'ph' else ambientcg(asset)
        if 'c' in maps:
            save(detail(imgs['c']) if is_detail else imgs['c'], name, 'col')
        if 'n' in maps:
            save(imgs['n'], name, 'nor')
        if 'r' in maps:
            save(imgs['r'], name, 'rough')


if __name__ == '__main__':
    main()
