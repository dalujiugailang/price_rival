import json
from pathlib import Path
import numpy as np
from scipy.optimize import nnls
from scipy.optimize import isotonic_regression
R=Path(__file__).resolve().parents[1]
d=json.loads((R/'data/competition-efficiency/latest.json').read_text());x=np.array([p['score'] for p in d['periods']]);y=np.array([p['difference'] for p in d['periods']])
def fit(x,y,k):
 if k=='mean':return lambda z:np.zeros_like(np.asarray(z))+y.mean()
 if k=='isotonic':
  o=np.argsort(x);xx=x[o];v=isotonic_regression(y[o],increasing=True).x
  return lambda z:np.interp(z,xx,v)
 if k=='increasing_step':
  candidates=[]
  for cut in (np.unique(x)[:-1]+np.unique(x)[1:])/2:
   a=y[x<=cut].mean();b=max(a,y[x>cut].mean()); candidates.append((sum((y-np.where(x<=cut,a,b))**2),cut,a,b))
  _,c,a,b=min(candidates);return lambda z:np.where(np.asarray(z)<=c,a,b)
 # nonnegative slope increasing hinge models; cut selected by training SSE
 candidates=[]
 for cut in np.quantile(x,[.2,.3,.4,.5,.6,.7,.8]):
  A=np.column_stack([np.minimum(x,cut)-x.min(),np.maximum(x-cut,0)])
  if k=='saturating_hinge':A=A[:,:1]
  center=A.mean(0);coef=nnls(A-center,y-y.mean())[0];a=y.mean()-center@coef
  err=sum((y-a-A@coef)**2);candidates.append((err,cut,a,coef,x.min()))
 _,c,a,b,low=min(candidates,key=lambda q:q[0])
 def predict(z):
  z=np.atleast_1d(z);A=np.column_stack([np.minimum(z,c)-low,np.maximum(z-c,0)])
  return a+A[:,:len(b)]@b
 return predict
out=[]
grid=np.linspace(x.min(),x.max(),500)
for k in ['mean','isotonic','increasing_step','saturating_hinge','increasing_hinge']:
 errors=[];peaks=[];loo_folds=[]
 for i in range(len(y)):
  m=np.arange(len(y))!=i;f=fit(x[m],y[m],k);prediction=float(np.asarray(f(x[i])).reshape(-1)[0]);errors.append(prediction-y[i]);loo_folds.append(dict(heldOut=d['periods'][i]['batchId'],actual=float(y[i]),prediction=prediction));sl=np.gradient(f(grid),grid);peaks.append(float(grid[np.argmax(sl)]))
 forward=[];forward_folds=[]
 for i in range(8,len(y)):
  f=fit(x[:i],y[:i],k);prediction=float(np.asarray(f(x[i])).reshape(-1)[0]);forward.append(prediction-y[i]);forward_folds.append(dict(heldOut=d['periods'][i]['batchId'],actual=float(y[i]),prediction=prediction,trainingPeriods=i))
 f=fit(x,y,k);sl=np.gradient(f(grid),grid)
 note = 'Isotonic拟合值采用np.interp分段线性插值；内部斜率存在，结点处不可微；斜率峰集中于极窄X间隙，对插值方式敏感' if k=='isotonic' else ('阶跃跳变处不可微；数值梯度峰随网格变化' if k=='increasing_step' else '分段线性斜率可在一整段相同，不识别唯一边际峰值')
 out.append(dict(model=k,note=note,looFolds=loo_folds,forwardFolds=forward_folds,looMae=float(np.mean(np.abs(errors))),forwardMae=float(np.mean(np.abs(forward))),looRmse=float(np.mean(np.array(errors)**2)**.5),forwardRmse=float(np.mean(np.array(forward)**2)**.5),peakX=None if k=='mean' or max(sl)<1e-10 else float(grid[np.argmax(sl)]),maxSlope=float(max(sl)),leaveOnePeakRange=None if k=='mean' else [min(peaks),max(peaks)]))
print(json.dumps(out,indent=2));(R/'data/competition-efficiency/alternative-models/monotone.json').write_text(json.dumps({'sourceFingerprint':d['inputFingerprint'],'models':out},indent=2))
