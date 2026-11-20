"""Collect independent model experiments without changing the active business target."""
import datetime
import json
import math
import statistics
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FOLDER = ROOT/'data/competition-efficiency/alternative-models'
data = json.loads((ROOT/'data/competition-efficiency/latest.json').read_text())
fingerprint = data['inputFingerprint']
rows = []
for source, key in [('monotone','models'), ('robust-models','methods'), ('precision','models'), ('gp-time','models')]:
    report = json.loads((FOLDER/f'{source}.json').read_text())
    assert report['sourceFingerprint'] == fingerprint, f'Stale input: {source}'
    for method in report[key]:
        name = method.get('id',method.get('model'))
        if name in ('mean','unweighted_mean'): continue
        rows.append({'source':source,'id':name,**method})
for method in data['marginalExploration']['methods']:
    row = {'source':'original','id':method['id'],**method}
    row['looMae'] = statistics.mean(abs(f['actual']-f['prediction']) for f in method['looFolds'])
    rows.append(row)
ys = [p['difference'] for p in data['periods']]
mean_errors = [ys[i]-statistics.mean(ys[:i]+ys[i+1:]) for i in range(len(ys))]
median_errors = [ys[i]-statistics.median(ys[:i]+ys[i+1:]) for i in range(len(ys))]
for name, errs in [('constant',mean_errors),('median',median_errors)]:
    measured = next(r for r in rows if r['id']==name)['looRmse']
    assert abs(math.sqrt(statistics.mean(e*e for e in errs))-measured) < 1e-10
rows.sort(key=lambda r:r['looRmse'])
result = {'generatedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),
    'sourceFingerprint':fingerprint,'periods':len(ys),'configurationCount':len(rows),
    'selectionCaveat':'Repeated model searches on the same 17 periods remain exploratory; ranking is not an independent validation of the selected winner.',
    'operatingDecision':'Compare approximately 70% and 82% as alternative trial levels; do not claim either is a validated optimum.',
    'models':rows}
target = FOLDER/'comparison.json'
if target.exists():
    archive = FOLDER/'.archive';archive.mkdir(exist_ok=True)
    target.rename(archive/f'comparison-{datetime.datetime.now().strftime("%Y%m%d%H%M%S%f")}.json')
target.write_text(json.dumps(result,ensure_ascii=False,indent=2,allow_nan=False))
latest = ROOT/'data/competition-efficiency/latest.json'
archive = latest.parent/'.archive'; archive.mkdir(exist_ok=True)
latest.rename(archive/f'latest-before-alternatives-{datetime.datetime.now().strftime("%Y%m%d%H%M%S%f")}.json')
data['alternativeComparison'] = result
latest.write_text(json.dumps(data,ensure_ascii=False,indent=2,allow_nan=False))
print(json.dumps({'models':len(rows),'bestLoo':{k:rows[0].get(k) for k in ('id','looRmse','forwardRmse')},
    'bestLooMae':{k:min(rows,key=lambda r:r.get('looMae',math.inf)).get(k) for k in ('id','looMae')}},ensure_ascii=False))
