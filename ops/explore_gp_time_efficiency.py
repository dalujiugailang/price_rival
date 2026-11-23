import json, pathlib, numpy as np
root=pathlib.Path.cwd();d=json.load(open(root/'data/competition-efficiency/latest.json'));p=d['periods'];x=np.array([v['score'] for v in p]);y=np.array([v['difference'] for v in p]);t=np.array([(np.datetime64(v['start'][:10])-np.datetime64(p[0]['start'][:10])).astype(int) for v in p],float)
def gp_predict(x,y,z,length,noise):
 if np.isinf(noise):return np.full(np.atleast_1d(z).shape,y.mean())
 k=np.exp(-.5*((x[:,None]-x[None,:])/length)**2)+noise*np.eye(len(x))
 a=np.linalg.solve(k,y-y.mean());return y.mean()+np.exp(-.5*((np.atleast_1d(z)[:,None]-x[None,:])/length)**2)@a
params=[(l,n) for l in [3,6,10,20,40] for n in [.1,1,10,100]]+[(10,float('inf'))]
def fit_gp(x,y):
 errors=[]
 for l,n in params:
  pred=np.array([gp_predict(np.delete(x,i),np.delete(y,i),x[i],l,n)[0] for i in range(len(x))]);errors.append(np.mean((pred-y)**2))
 return params[int(np.argmin(errors))]
def ridge_fit(x,t,y):
 def fixed(xx,tt,yy,lam):
  sx=max(np.std(xx),1);st=max(np.std(tt),1);mx=xx.mean();mt=tt.mean()
  a=np.column_stack([np.ones(len(xx)),(xx-mx)/sx,(tt-mt)/st])
  b=np.linalg.solve(a.T@a+np.diag([0,lam,lam]),a.T@yy)
  return lambda at,day: b[0]+b[1]*(at-mx)/sx+b[2]*(day-mt)/st, {'lambda':lam,'xSlope':b[1]/sx,'daySlope':b[2]/st}
 errors=[]
 for lam in [.1,1,10,100,1000]:
  err=[]
  for i in range(len(x)):
   m=np.arange(len(x))!=i;f,pa=fixed(x[m],t[m],y[m],lam);err.append((f(x[i],t[i])-y[i])**2)
  errors.append(np.mean(err))
 return fixed(x,t,y,[.1,1,10,100,1000][int(np.argmin(errors))])

out=[]
for kind in ['gaussian_process_nested','ridge_time_control']:
 errs=[];forward=[];fold=[]
 for i in range(len(x)):
  m=np.arange(len(x))!=i
  if kind.startswith('gaussian'):
   l,n=fit_gp(x[m],y[m]);v=gp_predict(x[m],y[m],x[i],l,n)[0];fold.append({'length':l,'noise':None if np.isinf(n) else n})
  else:
   f,pa=ridge_fit(x[m],t[m],y[m]);v=f(x[i],t[i]);fold.append(pa)
  errs.append(v-y[i])
 for i in range(8,len(x)):
  if kind.startswith('gaussian'):
   l,n=fit_gp(x[:i],y[:i]);v=gp_predict(x[:i],y[:i],x[i],l,n)[0]
  else:f,pa=ridge_fit(x[:i],t[:i],y[:i]);v=f(x[i],t[i])
  forward.append(v-y[i])
 if kind.startswith('gaussian'):
  l,n=fit_gp(x,y);pa={'length':l,'noise':None if np.isinf(n) else n};g=np.linspace(x.min(),x.max(),401);pred=gp_predict(x,y,g,l,n);sl=np.gradient(pred,g);pa['peak']=None if np.isinf(n) else float(g[np.argmax(sl)])
 else:f,pa=ridge_fit(x,t,y)
 out.append({'model':kind,'looRmse':float(np.mean(np.square(errs))**.5),'forwardRmse':float(np.mean(np.square(forward))**.5),'looMae':float(np.mean(np.abs(errs))),'parameters':pa,'folds':fold})
print(json.dumps(out,indent=2));(root/'data/competition-efficiency/alternative-models/gp-time.json').write_text(json.dumps({'sourceFingerprint':d['inputFingerprint'],'models':out},indent=2))
