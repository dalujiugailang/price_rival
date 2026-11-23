from pathlib import Path
exec(open(str(Path(__file__).with_name('s_curves.py'))).read().split('results=[]')[0])
base=json.load(open(str(Path(__file__).resolve().parents[2]/'data/competition-efficiency/marginal-exploration'/ 's-curves.json')))
for f in base:
 kind=f['kind'];s=shape(np.array([lo]),f['k'],f['m'],kind)[0]
 d=f['amplitude']*f['k']*(s*(1-s) if kind=='logistic' else s*np.exp(-f['k']*(lo-f['m'])))
 print(kind,'observed_max_location',lo,'max_slope',d,'loo_inside',sum(lo<=z['peak']<=hi for z in f['loo']),'omit_highY',f['loo'][4])
# Restrict maximum-slope center to observed support, without treating the boundary as optimum.
exec(open(str(Path(__file__).with_name('s_curves.py'))).read().split('results=[]')[0].replace('(lo-20,hi+20)','(lo,hi)'))
out=[]
for kind in ['logistic','gompertz']:
 f=fit(x,y,kind);err=[]
 for i in range(len(y)):
  mask=np.arange(len(y))!=i;ff=fit(x[mask],y[mask],kind,seed=f['seed']);err.append((y[i]-predict(ff,x[i]))**2)
 f['looRmse']=float(np.mean(err)**.5);out.append(f);print('restricted',json.dumps(f))
Path(str(Path(__file__).resolve().parents[2]/'data/competition-efficiency/marginal-exploration'/ 'support-restricted.json')).write_text(json.dumps(out,indent=2))
