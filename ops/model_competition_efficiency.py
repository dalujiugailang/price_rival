"""Exploratory model selection; never force a finite optimum into weak period data."""
import datetime as dt
import json
import warnings
from pathlib import Path
import numpy as np
from scipy.optimize import curve_fit, OptimizeWarning

ROOT = Path(__file__).resolve().parents[1]

def saturation(z, a, amplitude, k):
    return a + amplitude * (1 - np.exp(-k * (z + 2)))

def fit_predict(name, x, y, target):
    if name == 'saturation':
        with warnings.catch_warnings():
            warnings.simplefilter('ignore', OptimizeWarning)
            pars, _ = curve_fit(saturation, x, y, p0=[0, 5, .5],
                                bounds=([-30, 0, .001], [30, 60, 10]), maxfev=10000)
        return saturation(target, *pars), pars
    degree = {'constant': 0, 'linear': 1, 'quadratic': 2}[name]
    coefficients = np.polynomial.polynomial.polyfit(x, y, degree)
    return np.polynomial.polynomial.polyval(target, coefficients), coefficients

def main():
    path = ROOT / 'data/competition-efficiency/latest.json'
    data = json.loads(path.read_text())
    periods = data['periods']
    x = np.array([p['score'] for p in periods]); y = np.array([p['difference'] for p in periods]); z = (x-80)/10
    models = []
    for name in ['constant', 'linear', 'quadratic', 'saturation']:
        prediction, coef = fit_predict(name, z, y, z)
        held_out = []
        failures = 0
        for i in range(len(y)):
            mask = np.arange(len(y)) != i
            try:
                pred, _ = fit_predict(name, z[mask], y[mask], z[i:i+1]); held_out.append(float(pred[0]))
            except (RuntimeError, ValueError):
                failures += 1; held_out.append(None)
        rmse = float(np.mean((y-np.array(held_out, dtype=float))**2)**.5) if not failures else None
        forward_errors = []
        for i in range(7, len(y)):
            try:
                pred, _ = fit_predict(name, z[:i], y[:i], z[i:i+1]);forward_errors.append(float((y[i]-pred[0])**2))
            except (RuntimeError, ValueError):
                pass
        models.append({'id': name, 'parameters': coef.tolist(), 'rSquared':float(1-np.sum((y-prediction)**2)/np.sum((y-y.mean())**2)),
                       'looRmse':rmse, 'looFailures':failures,
                       'forwardRmse':float(np.mean(forward_errors)**.5) if len(forward_errors)==len(y)-7 else None,
                       'forwardTestPeriods':len(forward_errors)})
    quad = next(m for m in models if m['id']=='quadratic')
    a,b,c = quad['parameters'];candidate=80-5*b/c if c<0 else None
    loo_peaks=[]
    for i in range(len(y)):
        mask=np.arange(len(y))!=i
        co=np.polynomial.polynomial.polyfit(z[mask],y[mask],2)
        loo_peaks.append(80-5*co[1]/co[2] if co[2]<0 else None)
    rng=np.random.default_rng(20261113); valid_peaks=[]; nonconcave=0; outside=0
    # Circular paired blocks of two adjacent periods: exploratory sensitivity,
    # not a calibrated confidence interval or a probability that the optimum exists.
    for _ in range(2000):
        starts=rng.integers(0,len(y),size=(len(y)+1)//2)
        index=np.array([i for start in starts for i in (start,(start+1)%len(y))])[:len(y)]
        if len(set(z[index]))<3:continue
        co=np.polynomial.polynomial.polyfit(z[index],y[index],2)
        if co[2]>=0:nonconcave+=1;continue
        peak=80-5*co[1]/co[2]
        if not x.min()<=peak<=x.max():outside+=1;continue
        valid_peaks.append(float(peak))
    grid=np.linspace(float(x.min()),float(x.max()),120)
    curve=np.polynomial.polynomial.polyval((grid-80)/10,[a,b,c])
    evaluation={'generatedAt':dt.datetime.now(dt.timezone.utc).isoformat(),'sourceVersion':data['version'],
      'periodCount':len(y),'xRange':[float(x.min()),float(x.max())],'models':models,
      'selectedModel':min((m for m in models if m['looRmse'] is not None),key=lambda m:m['looRmse'])['id'],
      'candidatePeak':float(candidate) if candidate is not None else None,
      'candidateInsideRange':bool(candidate is not None and x.min()<=candidate<=x.max()),
      'candidatePredictedY':float(np.polynomial.polynomial.polyval((candidate-80)/10,[a,b,c])) if candidate else None,
      'equation':{'center':80,'scale':10,'intercept':a,'linear':b,'quadratic':c},
      'leaveOneOutPeaks':loo_peaks,'leaveOneOutPeakRange':[min(v for v in loo_peaks if v is not None),max(v for v in loo_peaks if v is not None)],
      'blockResampling':{'draws':2000,'blockLength':2,'interiorConcavePeaks':len(valid_peaks),
                        'nonconcave':nonconcave,'outsideRange':outside,
                        'conditionalPeakPercentiles':np.percentile(valid_peaks,[5,50,95]).tolist() if valid_peaks else []},
      'curve':[{'score':float(xx),'difference':float(yy),'slope':float((b+2*c*(xx-80)/10)/10)} for xx,yy in zip(grid,curve)],
      'recommendationStatus':'not_validated','recommendedTarget':None,
      'reason':'Nonconstant models do not outperform the mean-only baseline in leave-one-period-out prediction; peak is unstable and not a cost optimum.',
      'sources':['https://itl.nist.gov/div898/handbook/pmd/section4/pmd44.htm',
                 'https://docs.scipy.org/doc/scipy/reference/generated/scipy.optimize.curve_fit.html']}
    # This data version has no held-out predictive support; never publish candidate as an execution target.
    if evaluation['selectedModel']!='constant':
        evaluation['reason']='Further model diagnostics and economic costs are required before an execution recommendation.'
    archive=path.parent/'.archive';archive.mkdir(exist_ok=True)
    path.rename(archive/f'latest-before-model-{dt.datetime.now().strftime("%Y%m%d-%H%M%S")}.json')
    data['modelEvaluation']=evaluation
    path.write_text(json.dumps(data,ensure_ascii=False,indent=2))
    print(json.dumps({k:v for k,v in evaluation.items() if k!='curve'},ensure_ascii=False,indent=2))

if __name__=='__main__':
    main()
