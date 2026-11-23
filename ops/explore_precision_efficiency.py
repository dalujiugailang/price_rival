"""Period-block CV for count-precision weighting, without changing the user's Y."""
import json
from pathlib import Path
import numpy as np
from scipy.optimize import minimize
from scipy.special import expit

ROOT=Path(__file__).resolve().parents[1]
data=json.loads((ROOT/'data/competition-efficiency/latest.json').read_text())
periods=data['periods']; x=np.array([p['score'] for p in periods]);y=np.array([p['difference'] for p in periods])
def variance(p):
    total=0.
    for s in p['strata']:
        q1,q0=s['competitionQuotes'],s['controlQuotes']
        r1,r0=s['competitionSubmissions']/q1,s['controlSubmissions']/q0
        total+=s['weight']**2*(r1*(1-r1)/q1+r0*(1-r0)/q0)*10000
    return total
v=np.array([variance(p) for p in periods])

def fit(xx,yy,vv,kind):
    tau=max(0.,float(np.var(yy,ddof=1)-vv.mean())) if kind.startswith('random_') else 0.
    w=1/np.maximum(vv+tau,1e-6);w=w/w.sum()
    if kind=='unweighted_mean':w=np.ones(len(yy))/len(yy)
    a=float(w@yy)
    if kind.endswith('mean'):return dict(a=a,tau=tau)
    if kind.endswith('linear'):
        center=float(w@xx); slope=max(0.,float(np.sum(w*(xx-center)*(yy-a))/np.sum(w*(xx-center)**2)))
        return dict(a=a-slope*center,slope=slope,tau=tau)
    def profile(k,m):
        s=expit(k*(xx-m)); sm=w@s; den=np.sum(w*(s-sm)**2)
        amp=float(np.clip(np.sum(w*(s-sm)*(yy-a))/den,0,200)) if den>1e-20 else 0.
        return float(a-amp*sm),amp
    def loss(z):
        k=np.exp(z[0]); b,c=profile(k,z[1]);return float(np.sum(w*(yy-b-c*expit(k*(xx-z[1])))**2))
    sols=[minimize(loss,[np.log(k),m],method='L-BFGS-B',bounds=[(np.log(.005),np.log(3)),(xx.min()-20,xx.max()+20)]) for k in [.03,.3,3] for m in [xx.min(),xx.mean(),xx.max()]]
    best=min(sols,key=lambda z:z.fun);k=float(np.exp(best.x[0]));m=float(best.x[1]);b,c=profile(k,m)
    return dict(a=b,amplitude=c,k=k,m=m,tau=tau)
def predict(f,z):
    if 'm' in f:return f['a']+f['amplitude']*expit(f['k']*(z-f['m']))
    return f['a']+f.get('slope',0)*np.asarray(z)

out=[]
for kind in ['unweighted_mean','precision_mean','precision_linear','precision_logistic','random_mean','random_linear','random_logistic']:
    loo=[];peaks=[]
    for i in range(len(y)):
        mask=np.arange(len(y))!=i;f=fit(x[mask],y[mask],v[mask],kind)
        loo.append(float(predict(f,x[i])-y[i]))
        if 'm' in f:peaks.append(f['m'])
    forward=[]
    for i in range(8,len(y)):
        f=fit(x[:i],y[:i],v[:i],kind);forward.append(float(predict(f,x[i])-y[i]))
    f=fit(x,y,v,kind)
    out.append({'id':kind,'looRmse':float(np.mean(np.array(loo)**2)**.5),'looMae':float(np.mean(np.abs(loo))),'forwardRmse':float(np.mean(np.array(forward)**2)**.5),
        'parameters':f,'leaveOneInflectionRange':[min(peaks),max(peaks)] if peaks else None})
    print(json.dumps(out[-1]),flush=True)
report={'sourceFingerprint':data['inputFingerprint'],'models':out,'periodVariances':v.tolist(),
    'caveat':'Binomial sampling variances assume independent quoted observations. Repeated customers, selection, and period shocks violate this. Random-effects variance is estimated from training periods only; this weighting does not identify causal effects. All validation holds out complete periods, evaluates original unweighted Y, and never uses held-out counts for training weights.'}
(ROOT/'data/competition-efficiency/alternative-models/precision.json').write_text(json.dumps(report,indent=2))
