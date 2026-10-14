import hashlib,json,urllib.request
from pathlib import Path
for file in Path('/wheels').glob('*.whl'):
 name,version=file.name.split('-')[:2]
 info=json.load(urllib.request.urlopen(f'https://pypi.org/pypi/{name}/{version}/json',timeout=30))
 expected=next(x['digests']['sha256'] for x in info['urls'] if x['filename']==file.name)
 assert hashlib.sha256(file.read_bytes()).hexdigest()==expected, file.name
 print('Official PyPI hash verified:',file.name,flush=True)
