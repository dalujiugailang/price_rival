import json,numpy as np
from scipy.special import expit
from scipy.optimize import minimize
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
j=json.loads((ROOT/'data/competition-efficiency/latest.json').read_text());x=np.array([p['score'] for p in j['periods']]);y=np.array([p['difference'] for p in j['periods']]);lo,hi=x.min(),x.max()
def shape(x,k,m,kind):
 t=k*(x-m)
 return expit(t) if kind=='logistic' else np.exp(-np.exp(np.clip(-t,-700,700)))
def get_linear(s,y,cap):
 den=np.sum((s-s.mean())**2)
 b=np.clip(np.sum((s-s.mean())*(y-y.mean()))/den,0,cap) if den>1e-20 else 0
 return y.mean()-b*s.mean(),b
def fit(x,y,kind,kmax=3,cap=50,seed=None):
 def objective(v):
  k=np.exp(v[0]);m=v[1];s=shape(x,k,m,kind);a,b=get_linear(s,y,cap)
  return np.sum((y-a-b*s)**2)
 starts=[(np.log(k),m) for k in [.03,.1,.3,1,kmax] if k<=kmax for m in [lo,70,80,85,hi]]
 if seed is not None:starts=[seed]+starts
 sols=[minimize(objective,v,method='L-BFGS-B',bounds=[(np.log(.005),np.log(kmax)),(lo-20,hi+20)],options={'ftol':1e-11,'maxiter':500}) for v in starts]
 best=min(sols,key=lambda z:z.fun);k=np.exp(best.x[0]);m=best.x[1];s=shape(x,k,m,kind);a,b=get_linear(s,y,cap)
 return dict(kind=kind,a=float(a),amplitude=float(b),k=float(k),m=float(m),sse=float(best.fun),maxSlope=float(b*k/(4 if kind=='logistic' else np.e)),seed=best.x.tolist())
def predict(f,x):return f['a']+f['amplitude']*shape(x,f['k'],f['m'],f['kind'])
results=[]
for kind in ['logistic','gompertz']:
 f=fit(x,y,kind);f['r2']=1-f['sse']/np.sum((y-y.mean())**2);fold=[];err=[]
 for i in range(len(y)):
  mask=np.arange(len(y))!=i;ff=fit(x[mask],y[mask],kind,seed=f['seed']);err.append((y[i]-predict(ff,x[i]))**2);fold.append({'omit':j['periods'][i]['start'],'peak':ff['m'],'slope':ff['maxSlope'],'k':ff['k']})
 f['looRmse']=float(np.mean(err)**.5);f['loo']=fold
 f['boundsSensitivity']=[dict(kmax=k,cap=cap,**{p:v for p,v in fit(x,y,kind,kmax=k,cap=cap).items() if p!='seed'}) for k,cap in [(.5,20),(1,50),(10,50),(3,200)]]
 results.append(f);print(json.dumps(f,ensure_ascii=False),flush=True)
Path(str(Path(__file__).resolve().parents[2]/'data/competition-efficiency/marginal-exploration'/ 's-curves.json')).write_text(json.dumps(results,ensure_ascii=False,indent=2))
