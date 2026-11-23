import json,numpy as np
from scipy.interpolate import make_smoothing_spline
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2];j=json.load(open(ROOT/'data/competition-efficiency/latest.json'));ps=j['periods'];x=np.array([p['score'] for p in ps]);y=np.array([p['difference'] for p in ps]);order=np.argsort(x);x=x[order];y=y[order];labels=np.array([p['start'] for p in ps])[order];z=(x-80)/10;g=np.linspace(x.min(),x.max(),2001);zg=(g-80)/10

def spline(x,y,lam):
 o=np.argsort(x);return make_smoothing_spline((x[o]-80)/10,y[o],lam=lam)
def summarize(d):
 k=np.argmax(d);inner=(g>=g.min()+2)&(g<=g.max()-2);ig=np.where(inner)[0][np.argmax(d[inner])]
 return dict(peak=float(g[k]),slope=float(d[k]),boundary=bool(k in (0,len(g)-1)),interior_peak=float(g[ig]),interior_slope=float(d[ig]))
results=[]
for lam in [1e-5,1e-4,.001,.01,.1,1,10,100,1000,None]:
 s=spline(x,y,lam);cv=[]
 for i in range(len(y)):
  mask=np.arange(len(y))!=i;ss=spline(x[mask],y[mask],lam);cv.append(float(ss(z[i])))
 d=s(zg,nu=1)/10
 r={'lambda':lam,'loo_rmse':float(np.sqrt(np.mean((y-cv)**2))),**summarize(d)}
 if lam in [.01,.1,1,10,None]:
  peak=[]
  for i in range(len(y)):
   mask=np.arange(len(y))!=i;ss=spline(x[mask],y[mask],lam);dd=ss(zg,nu=1)/10;peak.append(float(g[np.argmax(dd)]))
  r['leave_one_peak_range']=[min(peak),max(peak)];r['leave_one_peaks']=peak
 results.append(r)

def local(x,y,at,h):
 v=np.array(x)-at;w=np.exp(-.5*(v/h)**2);A=np.column_stack([np.ones(len(v)),v,v*v]);co=np.linalg.lstsq(A*np.sqrt(w)[:,None],np.array(y)*np.sqrt(w),rcond=None)[0];return co[0],co[1]
loc=[]
for h in [2,3,4,5,6,7,8,10,12,15,20,30]:
 cv=[]
 for i in range(len(y)):
  mask=np.arange(len(y))!=i;cv.append(local(x[mask],y[mask],x[i],h)[0])
 d=np.array([local(x,y,at,h)[1] for at in g]);r={'bandwidth':h,'loo_rmse':float(np.sqrt(np.mean((y-cv)**2))),**summarize(d)}
 if h in [4,6,8,10,20]:
  peaks=[]
  for i in range(len(y)):
   mask=np.arange(len(y))!=i;dd=np.array([local(x[mask],y[mask],at,h)[1] for at in g]);peaks.append(float(g[np.argmax(dd)]))
  r['leave_one_peak_range']=[min(peaks),max(peaks)];r['leave_one_peaks']=peaks
 loc.append(r)
# Explicit influential-period sensitivity, never silently delete it in production.
out=int(np.argmax(y));sensitivity=[]
for name,mask in [('all',np.ones(len(y),dtype=bool)),('without_'+labels[out].replace('-',''),np.arange(len(y))!=out)]:
 for lam in [.01,.1,1,10,None]:
  s=spline(x[mask],y[mask],lam);sensitivity.append({'sample':name,'lambda':lam,**summarize(s(zg,nu=1)/10)})
output={'sorted_periods':list(zip(labels.tolist(),x.tolist(),y.tolist())),'spline':results,'local_quadratic':loc,'outlier_sensitivity':sensitivity}
output['curves']=[]
curve_grid=np.linspace(x.min(),x.max(),401)
s=spline(x,y,None)
output['curves'].append({'id':'smoothing_spline_gcv','label':'Natural smoothing spline (GCV)','x':curve_grid.tolist(),'prediction':s((curve_grid-80)/10).tolist(),'derivative':(s((curve_grid-80)/10,nu=1)/10).tolist(),'slopePeakX':float(curve_grid[np.argmax(s((curve_grid-80)/10,nu=1)/10)])})
for h in [6,7,10,30]:
    pred=[];der=[]
    for t in curve_grid:
        value,slope=local(x,y,t,h);pred.append(float(value));der.append(float(slope))
    numeric=np.gradient(pred,curve_grid,edge_order=2)
    output['curves'].append({'id':f'local_quadratic_h{h}','label':f'Local quadratic bandwidth {h} pp','x':curve_grid.tolist(),'prediction':pred,'derivative':der,'predictionCurveDerivative':numeric.tolist(),'slopePeakX':float(curve_grid[np.argmax(der)]),'predictionCurveSlopePeakX':float(curve_grid[np.argmax(numeric)])})
# Explicit overfit comparator, not a production recommendation.
s=spline(x,y,1e-5);der=s((curve_grid-80)/10,nu=1)/10
output['curves'].append({'id':'spline_overfit_1e-5','label':'Overfit comparator lambda=1e-5','x':curve_grid.tolist(),'prediction':s((curve_grid-80)/10).tolist(),'derivative':der.tolist(),'slopePeakX':float(curve_grid[np.argmax(der)])})
Path(str(Path(__file__).resolve().parents[2]/'data/competition-efficiency/marginal-exploration'/ 'smooth-curves.json')).write_text(json.dumps(output,indent=2))
for name in ['spline','local_quadratic','outlier_sensitivity']:
 print(name)
 for r in output[name]:print({k:v for k,v in r.items() if k!='leave_one_peaks'})
