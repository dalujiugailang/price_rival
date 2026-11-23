"""Assemble independently explored curves; goal is argmax dY/dX, not argmax Y."""
import datetime as dt
import json
import math
from pathlib import Path

ROOT=Path(__file__).resolve().parents[2]
FOLDER=ROOT/'data/competition-efficiency/marginal-exploration'
target=ROOT/'data/competition-efficiency/latest.json'
data=json.loads(target.read_text())
smooth=json.loads((FOLDER/'smooth-curves.json').read_text())
scurves=json.loads((FOLDER/'s-curves.json').read_text())
assert sorted((p['start'],p['score'],p['difference']) for p in data['periods'])==sorted(tuple(p) for p in smooth['sorted_periods'])
lo=min(p['score'] for p in data['periods']);hi=max(p['score'] for p in data['periods'])
methods=[]
for f in scurves:
    curve=[]
    for i in range(201):
        x=lo+(hi-lo)*i/200;t=f['k']*(x-f['m'])
        s=1/(1+math.exp(-t)) if f['kind']=='logistic' else math.exp(-math.exp(-t))
        slope=f['amplitude']*f['k']*(s*(1-s) if f['kind']=='logistic' else s*math.exp(-t))
        curve.append({'score':x,'difference':f['a']+f['amplitude']*s,'slope':slope})
    methods.append({'id':f['kind'],'name':'Logistic S型' if f['kind']=='logistic' else 'Gompertz S型',
                    'looRmse':f['looRmse'],'peakX':f['m'] if lo<=f['m']<=hi else max(curve,key=lambda r:r['slope'])['score'],
                    'globalPeakX':f['m'],'boundary':max(curve,key=lambda r:r['slope'])['score'] in (lo,hi),'note':'S型参数及最大斜率位置需结合留期检验，不自动作为执行建议',
                    'curve':curve})
for f in smooth['curves']:
    derivative=f.get('predictionCurveDerivative',f['derivative'])
    curve=[{'score':x,'difference':y,'slope':s} for x,y,s in zip(f['x'],f['prediction'],derivative)]
    peak=max(curve,key=lambda r:r['slope'])['score']
    is_gcv=f['id']=='smoothing_spline_gcv';is_overfit=f['id']=='spline_overfit_1e-5'
    info=next(r for r in smooth['spline'] if r['lambda']==(None if is_gcv else 1e-5)) if is_gcv or is_overfit else next(r for r in smooth['local_quadratic'] if r['bandwidth']==int(f['id'].split('_h')[1]))
    methods.append({'id':f['id'],'name': 'GCV平滑样条' if is_gcv else ('过拟合对照（勿采用）' if is_overfit else f"局部平滑 h={f['id'].split('_h')[1]}"),
                    'looRmse':info['loo_rmse'],'peakX':peak,'globalPeakX':None,
                    'boundary':peak in (lo,hi),'note':'低平滑方法，仅作过拟合敏感性对照' if is_overfit else ('观测范围内最大斜率在边界' if peak in (lo,hi) else '存在探索性内部斜率峰值，仍须检查位置稳定性'),
                    'curve':curve})
result={'goal':'max dY/dX','generatedAt':dt.datetime.now(dt.timezone.utc).isoformat(),'sourceVersion':data['version'],
        'status':'exploratory_no_execution_target','recommendedTarget':None,'xRange':[lo,hi],'periodCount':len(data['periods']),
        'baselineRmse':(sum((p['difference'] - (sum(q['difference'] for q in data['periods'])-p['difference'])/(len(data['periods'])-1))**2 for p in data['periods'])/len(data['periods']))**.5,
        'methods':methods,'conflictingPeriods':[p for p in data['periods'] if p['start'] in ('2026-10-08','2026-10-14')],
        'sources':['https://docs.scipy.org/doc/scipy/reference/generated/scipy.interpolate.make_smoothing_spline.html',
                   'https://docs.scipy.org/doc/scipy/reference/generated/scipy.special.expit.html']}
best = min((m for m in methods if 'overfit' not in m['id']), key=lambda m:m['looRmse'])
result['businessRecommendation'] = {
    'methodId':best['id'], 'methodName':best['name'], 'target':best['peakX'] if not best['boundary'] else None,
    'trialRange':[math.floor(best['peakX']/5)*5, math.floor(best['peakX']/5)*5+5] if not best['boundary'] else None,
    'looRmse':best['looRmse'], 'baselineImprovement':100*(result['baselineRmse']-best['looRmse'])/result['baselineRmse'],
    'strength':'limited', 'action':'small_scope_validation',
    'leaveOneRange':next((r.get('predictionDerivativeLeaveOneRange') for r in smooth['local_quadratic'] if best['id']==f"local_quadratic_h{r['bandwidth']}"),None) if best['id'].startswith('local_') else next(([min(q['peak'] for q in f['loo']),max(q['peak'] for q in f['loo'])] for f in scurves if f['kind']==best['id']),None),
}
data['marginalExploration']=result
archive=target.parent/'.archive';archive.mkdir(exist_ok=True)
target.rename(archive/f'latest-before-marginal-{dt.datetime.now().strftime("%Y%m%d-%H%M%S")}.json')
target.write_text(json.dumps(data,ensure_ascii=False,indent=2))
print(json.dumps([{k:v for k,v in m.items() if k!='curve'} for m in methods],ensure_ascii=False,indent=2))
