"""按内容摘要去重静态资源，跨主机传输后还原不可变发布目录。"""
import hashlib,io,json,os,pathlib,sys,tarfile
mode,source,target=sys.argv[1:4]
source,target=pathlib.Path(source),pathlib.Path(target)
sha=lambda data:hashlib.sha256(data).hexdigest()
if mode=='pack':
    assert not target.exists()
    files={};blobs={}
    for p in sorted(source.rglob('*')):
        assert not p.is_symlink()
        if p.is_file():
            data=p.read_bytes();digest=sha(data);files[p.relative_to(source).as_posix()]=digest;blobs[digest]=data
    blobs['manifest.json']=json.dumps(files,ensure_ascii=False).encode()
    with tarfile.open(target,'w:gz') as out:
        for name,data in blobs.items():
            info=tarfile.TarInfo(name);info.size=len(data);info.mode=0o644;out.addfile(info,io.BytesIO(data))
    print(json.dumps({'files':len(files),'unique':len(blobs)-1,'bytes':target.stat().st_size,'sha256':sha(target.read_bytes())}))
elif mode=='unpack':
    assert not target.exists();assert sha(source.read_bytes())==sys.argv[4]
    with tarfile.open(source) as archive:
        members={m.name:m for m in archive.getmembers()}
        assert all(m.isfile() and '/' not in m.name and '\\' not in m.name for m in members.values())
        manifest=json.load(archive.extractfile('manifest.json'));target.mkdir(parents=True,mode=0o755)
        for name,digest in manifest.items():
            path=pathlib.PurePosixPath(name);assert not path.is_absolute() and '..' not in path.parts
            data=archive.extractfile(digest).read();assert sha(data)==digest
            destination=target/path;destination.parent.mkdir(parents=True,exist_ok=True,mode=0o755)
            destination.write_bytes(data);os.chmod(destination,0o644)
    print('发布包摘要、文件路径与全部内容校验通过。')
else:raise SystemExit('无效操作')
