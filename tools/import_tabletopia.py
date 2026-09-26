"""Extract game front faces from a user-supplied Tabletopia bundle.

The game atlas is an encoded JPEG TextAsset, not a Texture2D.
Usage: python tools/import_tabletopia.py path/to/game-bundle.unity3d
Dependencies: UnityPy, Pillow (only required for asset extraction).
"""
import sys, json, io, re
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / '.tools/python'))
import UnityPy
from PIL import Image

def raw_text(data):
    script = data.m_Script
    return script.encode('utf-8', 'surrogateescape') if isinstance(script, str) else script

env = UnityPy.load(sys.argv[1])
objects = {obj.path_id: obj for obj in env.objects}
containers, atlases = {}, {}
manifest = None
for obj in env.objects:
    if obj.type.name == 'AssetBundle':
        containers.update({name.lower(): info.asset.path_id for name, info in obj.read().m_Container})
    elif obj.type.name == 'TextAsset':
        data = obj.read()
        if 'manifest' in data.m_Name.lower(): manifest = json.loads(raw_text(data))
for name, pid in containers.items():
    if 'atlas' not in name: continue
    obj = objects[pid]
    if obj.type.name == 'TextAsset': atlases[name] = Image.open(io.BytesIO(raw_text(obj.read())))
    elif obj.type.name == 'Texture2D': atlases[name] = obj.read().image
if manifest is None: raise RuntimeError('Bundle has no sprite manifest')
out = ROOT / 'assets/game'
out.mkdir(parents=True, exist_ok=True)
records = []
for element in manifest:
    if not element.get('elementName', '').startswith(('Factory Funner', 'FF ')): continue
    name = re.sub(r'[^A-Za-z0-9 _-]', '', element['elementName']).strip().replace(' ', '_')
    for ai, atlas in enumerate(element.get('atlases') or []):
        im = atlases.get(atlas['resource']['id'].lower())
        if im is None: continue
        for si, sp in enumerate(atlas.get('sprites', [])):
            if ai != 0 or si != 0: continue
            filename = f"{element['elementType'][:4]}_{name}_a{ai}s{si}.png"
            box = (sp['x'], sp['y'], sp['x']+sp['width'], sp['y']+sp['height'])
            im.crop(box).save(out / filename)
            records.append({'name': element['elementName'], 'file': filename, 'sprite': sp})
(ROOT/'assets/provenance.json').write_text(json.dumps({'source':Path(sys.argv[1]).name,'assets':records},ensure_ascii=False,indent=2),encoding='utf-8')
print(f'Extracted {len(records)} front-face assets. Source bundle unchanged.')
