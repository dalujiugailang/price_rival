"""Publish only the locally calculated analysis; never copy the operating database."""
import hashlib
import json
from pathlib import Path
import subprocess
import datetime

ROOT = Path(__file__).resolve().parents[1]


def main():
    source = ROOT / 'data/competition-efficiency/latest.json'
    raw = source.read_bytes()
    data = json.loads(raw)
    if not data.get('periods') or not data.get('analysisWindow'):
        raise ValueError('分析结果缺少完整覆盖期或分析窗口，停止发布')
    digest = hashlib.sha256(raw).hexdigest()
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    folder = '/home/ubuntu/price_rival/data/competition-efficiency'
    staging = f'{folder}/latest-{stamp}.pending'
    subprocess.run(['ssh', 'price-rival-cloud', f'mkdir -p {folder}/.archive'], check=True)
    subprocess.run(['scp', str(source), f'price-rival-cloud:{staging}'], check=True)
    # Validate before replacement, archive existing output, then atomically publish.
    program = f'''
import hashlib,json,pathlib
p=pathlib.Path({staging!r}); raw=p.read_bytes()
assert hashlib.sha256(raw).hexdigest()=={digest!r}
d=json.loads(raw); assert d.get('periods') and d.get('analysisWindow')
target=p.parent/'latest.json'
if target.exists(): target.rename(p.parent/'.archive'/'latest-{stamp}.json')
p.rename(target)
'''
    subprocess.run(['ssh', 'price-rival-cloud', 'python3 -'], input=program, text=True, check=True)
    # Read through the running container's mounted data path, not just the host file.
    result = subprocess.check_output(['ssh', 'price-rival-cloud',
        "docker exec price-rival node --input-type=module -e \"import fs from 'node:fs';import crypto from 'node:crypto';const b=fs.readFileSync('/app/data/competition-efficiency/latest.json');console.log(crypto.createHash('sha256').update(b).digest('hex'))\""], text=True).strip()
    if result != digest:
        raise RuntimeError('云端运行容器读取结果与本地不一致')
    print(json.dumps({'published': True, 'sha256': digest, 'analysisWindow': data['analysisWindow'],
        'periods': len(data['periods']), 'flowMaxDate': data.get('flowMaxDate')}, ensure_ascii=False))


if __name__ == '__main__':
    main()
