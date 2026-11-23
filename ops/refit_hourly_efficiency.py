"""Reproducible hourly-data model comparison; select against a constant baseline."""
import datetime as dt
import json
import math
from pathlib import Path
import numpy as np
from scipy.optimize import minimize
from scipy.special import expit
from scipy.interpolate import make_smoothing_spline

ROOT = Path(__file__).resolve().parents[1]
TARGET = ROOT / 'data/competition-efficiency/latest.json'
H_VALUES = [4, 6, 8, 10, 15, 20, 30]


def shape(x, k, m, kind):
    t = k * (np.asarray(x) - m)
    return expit(t) if kind == 'logistic' else np.exp(-np.exp(np.clip(-t, -700, 700)))


def local(x, y, at, h):
    v = x - at
    w = np.exp(-0.5 * (v/h)**2)
    a = np.column_stack([np.ones(len(v)), v, v*v])
    return np.linalg.lstsq(a*np.sqrt(w)[:, None], y*np.sqrt(w), rcond=None)[0][0]


def fit(x, y, kind):
    if kind == 'constant':
        return {'mean': float(y.mean())}
    if kind == 'linear_increasing':
        denominator = np.sum((x-x.mean())**2)
        slope = max(0.0, float(np.sum((x-x.mean())*(y-y.mean()))/denominator)) if denominator else 0.0
        return {'a': float(y.mean()-slope*x.mean()), 'slope': slope}
    if kind == 'smoothing_spline_gcv':
        order = np.argsort(x)
        return {'spline': make_smoothing_spline((x[order]-80)/10, y[order], lam=None)}
    if kind == 'local_adaptive':
        # Bandwidth is reselected solely within each training fold, not on held-out Y.
        errors = []
        for h in H_VALUES:
            preds = [local(np.delete(x,i), np.delete(y,i), x[i], h) for i in range(len(y))]
            errors.append(np.mean((y-preds)**2))
        return {'x': x, 'y': y, 'bandwidth': H_VALUES[int(np.argmin(errors))]}
    def linear(s):
        denominator = np.sum((s-s.mean())**2)
        amplitude = float(np.clip(np.sum((s-s.mean())*(y-y.mean()))/denominator, 0, 200)) if denominator > 1e-20 else 0.0
        return float(y.mean()-amplitude*s.mean()), amplitude
    def objective(v):
        s = shape(x, np.exp(v[0]), v[1], kind)
        a, amplitude = linear(s)
        return np.sum((y-a-amplitude*s)**2)
    low, high = float(x.min()), float(x.max())
    solutions = [minimize(objective, [math.log(k), m], method='L-BFGS-B',
        bounds=[(math.log(.005), math.log(3)), (low-20, high+20)], options={'maxiter':350, 'ftol':1e-10})
        for k in [.03, .3, 3] for m in [low, float(x.mean()), high]]
    best = min(solutions, key=lambda s:s.fun)
    k, m = float(np.exp(best.x[0])), float(best.x[1])
    a, amplitude = linear(shape(x,k,m,kind))
    return {'a':a, 'amplitude':amplitude, 'k':k, 'm':m,
        'parameterBoundary': bool(k >= 2.999 or k <= .00501 or abs(m-(low-20)) < .01 or abs(m-(high+20)) < .01)}


def predict(f, x, kind):
    xx = np.asarray(x)
    if kind == 'constant': return np.zeros_like(xx,dtype=float)+f['mean']
    if kind == 'linear_increasing': return f['a']+f['slope']*xx
    if kind == 'smoothing_spline_gcv': return f['spline']((xx-80)/10)
    if kind == 'local_adaptive': return np.array([local(f['x'],f['y'],at,f['bandwidth']) for at in np.atleast_1d(xx)])
    return f['a']+f['amplitude']*shape(xx,f['k'],f['m'],kind)


def curve(f, grid, kind):
    prediction = predict(f,grid,kind)
    if kind == 'constant': slope = np.zeros(len(grid))
    elif kind == 'linear_increasing': slope = np.full(len(grid),f['slope'])
    elif kind == 'smoothing_spline_gcv': slope = f['spline']((grid-80)/10,nu=1)/10
    elif kind == 'local_adaptive': slope = np.gradient(prediction,grid,edge_order=2)
    else:
        s = shape(grid,f['k'],f['m'],kind)
        slope = f['amplitude']*f['k']*(s*(1-s) if kind=='logistic' else s*np.exp(np.clip(-f['k']*(grid-f['m']),-700,700)))
    return prediction, slope


def main():
    data = json.loads(TARGET.read_text())
    assert data.get('timeBasis') == 'ceil_snapshot_save_hour' and data.get('inputFingerprint'), 'Export hourly observations first'
    ps = data['periods']
    x = np.array([p['score'] for p in ps]); y = np.array([p['difference'] for p in ps])
    grid = np.linspace(x.min(),x.max(),401)
    names = {'constant':'均值基线','linear_increasing':'单调线性','logistic':'Logistic S型','gompertz':'Gompertz S型',
        'smoothing_spline_gcv':'GCV平滑样条','local_adaptive':'局部平滑（带宽内层验证）'}
    methods = []
    for kind, name in names.items():
        fitted = fit(x,y,kind)
        predictions, slopes = curve(fitted,grid,kind)
        loo_errors, loo_peaks, fold_records = [], [], []
        for i in range(len(y)):
            mask = np.arange(len(y)) != i
            f = fit(x[mask],y[mask],kind)
            prediction = float(np.asarray(predict(f,x[i],kind)).reshape(-1)[0])
            loo_errors.append((y[i]-prediction)**2)
            if kind not in ('constant','linear_increasing'):
                _, d = curve(f,grid,kind)
                peak = f['m'] if kind in ('logistic','gompertz') and grid[0] <= f['m'] <= grid[-1] else float(grid[np.argmax(d)])
                loo_peaks.append(peak)
            fold_records.append({'heldOut':ps[i]['batchId'],'actual':float(y[i]),'prediction':prediction})
        forward = []
        for i in range(8,len(y)):
            f = fit(x[:i],y[:i],kind)
            prediction = float(np.asarray(predict(f,x[i],kind)).reshape(-1)[0])
            forward.append({'heldOut':ps[i]['batchId'],'actual':float(y[i]),'prediction':prediction,'trainingPeriods':i})
        peak_index = int(np.argmax(slopes))
        peak = fitted['m'] if kind in ('logistic','gompertz') and grid[0] <= fitted['m'] <= grid[-1] else float(grid[peak_index])
        fitted_params = {k:v for k,v in fitted.items() if k not in ('spline','x','y')}
        methods.append({'id':kind,'name':name,'peakX':peak,'globalPeakX':fitted.get('m'),
            'boundary':peak_index in (0,len(grid)-1),'peakApplicable':kind not in ('constant','linear_increasing'),
            'looRmse':float(np.sqrt(np.mean(loo_errors))),
            'forwardRmse':float(np.sqrt(np.mean([(f['actual']-f['prediction'])**2 for f in forward]))),
            'rSquared':float(1-np.sum((y-predict(fitted,x,kind))**2)/np.sum((y-y.mean())**2)),
            'leaveOneRange':[float(min(loo_peaks)),float(max(loo_peaks))] if loo_peaks else None,
            'parameters':fitted_params,'looFolds':fold_records,'forwardFolds':forward,
            'note': '常数模型不识别竞争力斜率，也不证明竞争力没有作用' if kind=='constant' else ('斜率处处相同，不能识别内部边际峰值' if kind=='linear_increasing' else '最大斜率为探索位置，须同时检验预测表现、边界与删期稳定性'),
            'curve':[{'score':float(a),'difference':float(b),'slope':float(c)} for a,b,c in zip(grid,predictions,slopes)]})
        print(json.dumps({k:methods[-1][k] for k in ('name','looRmse','forwardRmse','peakX','parameters','leaveOneRange')},ensure_ascii=False),flush=True)
    methods.sort(key=lambda m:m['looRmse'])
    baseline = next(m for m in methods if m['id']=='constant')
    best, best_curve = methods[0], min((m for m in methods if m['peakApplicable']),key=lambda m:m['looRmse'])
    predictive_gain = best['looRmse'] < baseline['looRmse'] and best['forwardRmse'] < baseline['forwardRmse']
    eligible = predictive_gain and best['peakApplicable'] and not best['boundary'] and not best['parameters'].get('parameterBoundary')
    result = {'goal':'max dY/dX','generatedAt':dt.datetime.now(dt.timezone.utc).isoformat(),
        'sourceVersion':data['version'],'sourceFingerprint':data['inputFingerprint'],'modelVersion':'hourly-refit-v1',
        'status':'exploratory_no_execution_target','recommendedTarget':None,
        'xRange':[float(x.min()),float(x.max())],'periodCount':len(ps),'baselineRmse':baseline['looRmse'],
        'selectionRule':'按留一期RMSE排序，均值基线参与排名；时间顺序预测作为独立于LOO排序的交叉检查；最大斜率与参数稳定性另行检查',
        'bestCurve':{k:best_curve[k] for k in ('id','name','peakX','looRmse','forwardRmse','leaveOneRange','parameters')},
        'businessRecommendation':{'methodId':best['id'],'methodName':best['name'],'target':float(best['peakX']) if eligible else None,
            'trialRange':[math.floor(best['peakX']/5)*5,math.floor(best['peakX']/5)*5+5] if eligible else None,
            'looRmse':best['looRmse'],'forwardRmse':best['forwardRmse'],
            'baselineImprovement':100*(baseline['looRmse']-best['looRmse'])/baseline['looRmse'],
            'strength':'exploratory' if eligible else 'insufficient','action':'small_scope_validation' if eligible else 'retain_current_no_identified_target',
            'leaveOneRange':best['leaveOneRange'],
            'reason':'均值基线在留一期预测中最优，当前样本未识别可用的竞争力响应曲线' if best['id']=='constant' else ('单调线性的预测表现最好，但无法识别唯一的边际效用峰值' if best['id']=='linear_increasing' else ('曲线通过相对预测检查，位置仍需业务验证' if eligible else '相对首选仍未通过时间预测、边界或参数约束检查，不能据此指定日常目标'))},
        'methods':methods,'conflictingPeriods':sorted(ps,key=lambda p:p['difference'],reverse=True)[:2],
        'sources':['https://docs.scipy.org/doc/scipy/reference/generated/scipy.interpolate.make_smoothing_spline.html',
            'https://docs.scipy.org/doc/scipy/reference/generated/scipy.optimize.minimize.html']}
    # Business policy and predictive winner are distinct: never promote a weak curve
    # into a statistically validated optimum just because an operating number is needed.
    monotonic = min((m for m in methods if m['id'] in ('logistic','gompertz')),key=lambda m:m['looRmse'])
    peak = monotonic['peakX']
    result['operatingRecommendation'] = {
        'target': round(peak), 'trialRange':[math.floor(peak/5)*5,math.floor(peak/5)*5+5],
        'basisMethodId':monotonic['id'],'basisMethodName':monotonic['name'],
        'status':'provisional_business_target','statisticallyValidated':False,
        'reason':'按相对预测误差最低的单调S型模型，取最大斜率位置作为暂行日常目标；均值基线与参数敏感性仍约束结论强度',
        'curveLooRmse':monotonic['looRmse'],'baselineRmse':baseline['looRmse'],
        'leaveOneRange':monotonic['leaveOneRange'],'parameterBoundary':monotonic['parameters'].get('parameterBoundary',False)
    }
    data['marginalExploration'] = result
    archive = TARGET.parent/'.archive'; archive.mkdir(exist_ok=True)
    TARGET.rename(archive/f'latest-before-hourly-model-{dt.datetime.now().strftime("%Y%m%d-%H%M%S-%f")}.json')
    TARGET.write_text(json.dumps(data,ensure_ascii=False,indent=2,allow_nan=False))
    print(json.dumps(result['businessRecommendation'],ensure_ascii=False),flush=True)


if __name__ == '__main__':
    main()
