"""Independent robustness exploration. Held-out errors always use original Y."""
import json,math,datetime
from pathlib import Path
import numpy as np
from scipy.optimize import least_squares, minimize
from scipy.special import expit
ROOT=Path(__file__).resolve().parents[1]
SOURCE=ROOT/'data/competition-efficiency/latest.json'
LAMBDAS=[.01,.1,1,10,100,1000]

def ridge_fit(x,y,degree,lam,robust=False):
 center=float(x.mean());scale=max(float(x.std()),1.)
 z=(x-center)/scale;A=np.column_stack([np.ones(len(x))]+[z**i for i in range(1,degree+1)])
 penalty=np.diag([0.]+[lam]*degree)
 b=np.linalg.solve(A.T@A+penalty,A.T@y)
 if robust:
  # Huber IRLS, threshold 2 pp; no observation is dropped.
  for _ in range(100):
   residual=y-A@b;weight=np.minimum(1.,2./np.maximum(np.abs(residual),1e-12))
   nb=np.linalg.solve(A.T@(weight[:,None]*A)+penalty,A.T@(weight*y))
   if np.max(abs(nb-b))<1e-8:b=nb;break
   b=nb
 return dict(center=center,scale=scale,coef=b,degree=degree,lambda_=lam)
def ridge_predict(f,x):
 z=(np.asarray(x)-f['center'])/f['scale']
 return sum(c*z**i for i,c in enumerate(f['coef']))
def tuned_ridge(x,y,degree,robust=False):
 errors=[]
 for lam in LAMBDAS:
  error=0.
  for i in range(len(y)):
   mask=np.arange(len(y))!=i
   f=ridge_fit(x[mask],y[mask],degree,lam,robust)
   error+=(y[i]-float(ridge_predict(f,x[i])))**2
  errors.append(error)
 return ridge_fit(x,y,degree,LAMBDAS[int(np.argmin(errors))],robust)
def sfit(x,y,loss,kmax=3.):
 lo,hi=float(x.min()),float(x.max())
 lower=np.array([-100.,0.,math.log(.005),lo-20]);upper=np.array([100.,100.,math.log(kmax),hi+20])
 scale=max(1.,float(np.median(np.abs(y-np.median(y)))*1.4826))
 def pred(v,at):return v[0]+v[1]*expit(np.exp(v[2])*(np.asarray(at)-v[3]))
 def residual(v):return pred(v,x)-y
 candidates=[]
 for k in sorted(set([.03,min(.3,kmax),kmax])):
  for m in [lo,float(x.mean()),hi]:
   init=[float(np.clip(np.median(y),-99,99)),max(1.,float(np.percentile(y,75)-np.percentile(y,25))),math.log(k),m]
   if loss=='huber':
    fitted=least_squares(residual,init,bounds=(lower,upper),loss='huber',f_scale=2.,max_nfev=500)
    score=float(fitted.cost);v=fitted.x
   else:
    def objective(v):return float(np.sum(2.5*np.log1p((residual(v)/scale)**2/4)))
    fitted=minimize(objective,init,bounds=list(zip(lower,upper)),method='L-BFGS-B',options={'maxiter':500,'ftol':1e-10})
    score=float(fitted.fun);v=fitted.x
   candidates.append((score,v))
 _,v=min(candidates,key=lambda t:t[0])
 return {'a':float(v[0]),'amplitude':float(v[1]),'k':float(np.exp(v[2])),'m':float(v[3]),'robustScale':scale,'parameterBoundary':bool(v[2]>math.log(kmax)-.001 or v[2]<math.log(.005)+.001 or v[3]<lo-19.99 or v[3]>hi+19.99)}
def spredict(f,x):return f['a']+f['amplitude']*expit(f['k']*(np.asarray(x)-f['m']))
def fit(x,y,kind):
 if kind=='mean':return {'mean':float(y.mean())}
 if kind=='median':return {'mean':float(np.median(y))}
 if kind.startswith('ridge'):return tuned_ridge(x,y,int(kind[-1]))
 if kind=='huber_ridge2':return tuned_ridge(x,y,2,True)
 if kind=='huber_logistic':return sfit(x,y,'huber')
 if kind=='student_t_logistic':return sfit(x,y,'student')
 raise ValueError(kind)
def predict(f,x,kind):
 if kind in ('mean','median'):return np.zeros_like(np.asarray(x),dtype=float)+f['mean']
 if 'ridge' in kind:return ridge_predict(f,x)
 return spredict(f,x)
def peak(f,grid,kind):
 pred=predict(f,grid,kind);der=np.gradient(pred,grid,edge_order=2);i=int(np.argmax(der))
 return {'peakX':float(grid[i]),'maxSlope':float(der[i]),'boundary':i in (0,len(grid)-1),'derivative':der,'prediction':pred}
def serialize(f):return {k:(v.tolist() if isinstance(v,np.ndarray) else v) for k,v in f.items()}
def main():
 data=json.loads(SOURCE.read_text());ps=data['periods'];x=np.array([p['score'] for p in ps]);y=np.array([p['difference'] for p in ps]);grid=np.linspace(x.min(),x.max(),401)
 output={'sourceFingerprint':data.get('inputFingerprint'),'generatedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'n':len(y),'methods':[],
  'methodNotes':['All held-out errors are measured on unmodified original Y. No period is removed.','Ridge lambda is selected within each training set by inner LOO; standardized X uses training only.','Huber threshold fixed at 2pp; Student-t df=4 and robust scale from training MAD, minimum1pp.','Robust weighting is a sensitivity model, not causal identification.']}
 for kind in ['mean','median','ridge1','ridge2','ridge3','huber_ridge2','huber_logistic','student_t_logistic']:
  f=fit(x,y,kind);full=peak(f,grid,kind);loo=[];peaks=[];folds=[]
  for i in range(len(y)):
   mask=np.arange(len(y))!=i;ff=fit(x[mask],y[mask],kind);pred=float(predict(ff,x[i],kind));loo.append((y[i]-pred)**2);peaks.append(peak(ff,grid,kind)['peakX']);folds.append({'holdout':ps[i]['start'],'actual':float(y[i]),'prediction':pred,'parameters':serialize(ff)})
  forward=[]
  for i in range(8,len(y)):
   ff=fit(x[:i],y[:i],kind);pred=float(predict(ff,x[i],kind));forward.append({'holdout':ps[i]['start'],'actual':float(y[i]),'prediction':pred})
  method={'id':kind,'looRmse':float(np.mean(loo)**.5),'forwardRmse':float(np.mean([(a['actual']-a['prediction'])**2 for a in forward])**.5),'peakX':full['peakX'],'maxSlope':full['maxSlope'],'boundary':full['boundary'],'leaveOnePeakRange':[min(peaks),max(peaks)],'parameters':serialize(f),'looFolds':folds,'forwardFolds':forward,'curve':[{'x':float(a),'y':float(b),'slope':float(c)} for a,b,c in zip(grid,full['prediction'],full['derivative'])]}
  method['looMae']=float(np.mean([abs(q['actual']-q['prediction']) for q in folds]));method['looMedianAe']=float(np.median([abs(q['actual']-q['prediction']) for q in folds]));method['forwardMae']=float(np.mean([abs(q['actual']-q['prediction']) for q in forward]));method['peakApplicable']=kind not in ('mean','median','ridge1')
  if kind in ('huber_logistic','student_t_logistic'):
   method['boundsSensitivity']=[dict(kmax=cap,**sfit(x,y,'huber' if kind=='huber_logistic' else 'student',cap)) for cap in [.3,1.,3.,10.]]
   method['pointResiduals']=[{'period':p['start'],'x':float(a),'actual':float(b),'prediction':float(c),'residual':float(b-c)} for p,a,b,c in zip(ps,x,y,predict(f,x,kind))]
  output['methods'].append(method);print(json.dumps({k:v for k,v in method.items() if k not in ('curve','looFolds','forwardFolds')},ensure_ascii=False),flush=True)
 folder=ROOT/'data/competition-efficiency/alternative-models';folder.mkdir(exist_ok=True)
 (folder/'robust-models.json').write_text(json.dumps(output,ensure_ascii=False,indent=2,allow_nan=False))
if __name__=='__main__':main()
