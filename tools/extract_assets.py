"""Extract locally cached Tabletopia textures; never modifies the source cache."""
import sys, json, re
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / '.tools/python'))
import UnityPy
from PIL import Image, ImageDraw
cache = Path(sys.argv[1])
out = ROOT / 'assets' / 'tabletopia'
out.mkdir(parents=True, exist_ok=True)
records = []
for bundle in ([cache] if cache.is_file() else cache.rglob('__data')):
    env = UnityPy.load(str(bundle))
    for obj in env.objects:
        if obj.type.name != 'Texture2D':
            continue
        data = obj.read()
        name = re.sub(r'[^\w.-]', '_', data.m_Name)
        dest = out / f'{bundle.parent.parent.name}_{obj.path_id}_{name}.png'
        try:
            im = data.image
            im.save(dest)
            records.append({'name': data.m_Name, 'file': dest.name, 'size': im.size, 'bundle': bundle.parent.parent.name})
        except Exception as exc:
            print(type(exc).__name__, name)
(out / 'manifest.json').write_text(json.dumps(records, ensure_ascii=False, indent=2), encoding='utf-8')
thumbs = Image.new('RGB', (1000, ((len(records)+4)//5)*180), '#eee')
draw = ImageDraw.Draw(thumbs)
for i, row in enumerate(records):
    im = Image.open(out / row['file']).convert('RGBA'); im.thumbnail((190,150))
    x,y=(i%5)*200,(i//5)*180
    thumbs.paste(im,(x,y), im)
    draw.text((x,y+150), f"{i}: {row['name'][:23]}", fill='black')
thumbs.save(ROOT/'assets/contact-sheet.jpg')
print(json.dumps(records, ensure_ascii=True))
