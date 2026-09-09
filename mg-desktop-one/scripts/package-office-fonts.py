"""核验用户提供的字体并生成 Office 引擎安装包；字体二进制仅保存在发布产物中。"""
from pathlib import Path
from fontTools.ttLib import TTFont, TTCollection
import hashlib, io, json, sys, tarfile

source = Path(sys.argv[1])
output = Path(sys.argv[2])
files = {
    'fz-xiaobiaosong.ttf': source / '方正小标宋简.TTF',
    'fangsong-gb2312.ttf': source / '仿宋_GB2312.ttf',
    'kaiti-gb2312.ttf': source / '楷体_GB2312.TTF',
    'simhei.ttf': Path('C:/Windows/Fonts/simhei.ttf'),
    'simsun.ttc': Path('C:/Windows/Fonts/simsun.ttc'),
}
manifest = {'schemaVersion': 1, 'files': []}
output.parent.mkdir(parents=True, exist_ok=True)
with tarfile.open(output, 'x:gz') as archive:
    for name, path in files.items():
        fonts = TTCollection(path).fonts if path.suffix.lower() == '.ttc' else [TTFont(path)]
        families = sorted({entry.toUnicode() for font in fonts for entry in font['name'].names if entry.nameID == 1})
        assert all(all(ord(char) in font.getBestCmap() for char in '中文字体测试') for font in fonts)
        manifest['files'].append({'file': name, 'families': families, 'sha256': hashlib.sha256(path.read_bytes()).hexdigest()})
        archive.add(path, arcname=name)
        for font in fonts:
            font.close()
    data = (json.dumps(manifest, ensure_ascii=False, indent=2) + '\n').encode()
    entry = tarfile.TarInfo('manifest.json')
    entry.size = len(data)
    archive.addfile(entry, io.BytesIO(data))
output.with_suffix('.json').write_bytes(data)
print(json.dumps({'archive': str(output.resolve()), 'sha256': hashlib.sha256(output.read_bytes()).hexdigest(), **manifest}, ensure_ascii=False))
