# -*- coding: utf-8 -*-
"""Build the approved model-level observational comparison from inspectable extracts."""
import collections
import calendar
import datetime as dt
import gzip
import json
import re
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FOLDER = ROOT / 'data/competition-efficiency/20261113'
TZ = dt.timezone(dt.timedelta(hours=8))

def normalize(value):
    return re.sub(r'\s+', '', unicodedata.normalize('NFKC', value or '')).casefold()

def day(timestamp):
    return dt.datetime.fromisoformat(timestamp.replace('Z', '+00:00')).astimezone(TZ).date().isoformat()

def recent_two_month_window(end):
    index = end.year*12 + end.month-1-2
    year, month0 = divmod(index,12)
    anchor = dt.date(year,month0+1,min(end.day,calendar.monthrange(year,month0+1)[1]))
    return (anchor+dt.timedelta(days=1)).isoformat(), end.isoformat()

def involved(batch):
    selected = batch.get('restorePayload', {}).get('selectedCompetitionPpvs')
    if selected is None:
        selected = [p['ppv'] for p in batch.get('products', [])]
        if not selected:
            return None
    selected = set(selected)
    return {normalize(p['oldModel']) for p in batch.get('products', []) if p['ppv'] in selected}

def overlapping_launch_models(activities, start, end):
    """Exclude a model only in regular periods intersecting its three-full-day launch window."""
    models = set()
    matched = []
    for activity in activities:
        if activity['start'] <= end and activity['end'] >= start:
            models.update(activity['models'])
            matched.append(activity['batchId'])
    return models, matched

def standardize(periods):
    """Compare each period using its actual treated quote distribution."""
    supported_strata = set()
    for period in periods:
        cells = period.pop('cells')
        common = {h for h, groups in cells.items() if groups['competition'][0] > 0 and groups['control'][0] > 0}
        supported_strata.update(common)
        denominator = sum(cells[h]['competition'][0] for h in common)
        weights = {h: cells[h]['competition'][0] / denominator for h in sorted(common)} if denominator else {}
        cq = sum(g['competition'][0] for g in cells.values())
        cs = sum(g['competition'][1] for g in cells.values())
        nq = sum(g['control'][0] for g in cells.values())
        ns = sum(g['control'][1] for g in cells.values())
        details = []
        for h, weight in weights.items():
            q1, s1 = cells[h]['competition']; q0, s0 = cells[h]['control']
            details.append({'band': h[-1], 'sourceType': h[0], 'sourceChannel': h[1], 'recycleType': h[2],
                            'weight': weight, 'competitionQuotes': q1, 'competitionSubmissions': s1,
                            'controlQuotes': q0, 'controlSubmissions': s0, 'difference': 100 * (s1/q1-s0/q0)})
        period.update({'difference': sum(d['weight'] * d['difference'] for d in details) if weights else None,
                       'competitionQuotes': cq, 'competitionSubmissions': cs, 'controlQuotes': nq, 'controlSubmissions': ns,
                       'competitionRate': 100*cs/cq if cq else None, 'controlRate': 100*ns/nq if nq else None,
                       'comparisonCoverage': 100*sum(cells[h]['competition'][0] for h in common)/cq if cq else None,
                       'strata': details})
    return supported_strata

def main():
    cloud = json.loads(gzip.decompress((FOLDER/'cloud-tracking-batches.json.gz').read_bytes()))
    query = json.loads((FOLDER/'flow-query-result.json').read_text())
    flow = query['rows']
    if len(flow) >= 1000000:
        raise RuntimeError('Query row limit reached')
    window_start, window_end = recent_two_month_window(dt.date.fromisoformat(max(row['day'] for row in flow)))
    flow = [row for row in flow if window_start <= row['day'] <= window_end]
    by_day = collections.defaultdict(list)
    for row in flow:
        if row['quotes'] < 0 or row['submissions'] < 0 or row['submissions'] > row['quotes']:
            raise RuntimeError('Invalid quote/submission counts; inspect source before calculating')
        by_day[row['day']].append(row)
    active = []
    for row in cloud:
        if row['deleted_at'] or row['channel_id'] != 'tradeIn':
            continue
        b = json.loads(row['payload_json']); b['serverCreatedAt'] = row['created_at']; active.append(b)
    # User rule: three complete Shanghai calendar days after a launch snapshot save.
    launch_models = set()
    launch_activities = []
    unknown_launch = []
    for b in active:
        if b.get('batchType') == 'launch':
            models = involved(b)
            if models is None:
                # Product rows are only used to exclude potential contamination, never to assign treatment.
                models = {normalize(p['oldModel']) for p in b.get('products', [])}
                unknown_launch.append(b['id'])
            launch_models.update(models)
            saved = dt.date.fromisoformat(day(b['serverCreatedAt']))
            launch_activities.append({'batchId': b['id'], 'start': (saved+dt.timedelta(days=1)).isoformat(),
                                      'end': (saved+dt.timedelta(days=3)).isoformat(), 'models': sorted(models)})
    regular = [b for b in active if b.get('batchType') == 'regular' and not b.get('isSummaryOnly')
               and b.get('products')]
    chosen = {}
    for b in sorted(regular, key=lambda b: (b['serverCreatedAt'], b['id'])):
        effective_day = b['pricingTimestamp'][:10] if b['id'].startswith('RECOVERED-') and b.get('pricingTimestamp') else day(b['serverCreatedAt'])
        b['analysisEffectiveDay'] = effective_day
        b['coverageBasis'] = 'explicit_selection' if b.get('restorePayload', {}).get('selectedCompetitionPpvs') is not None else 'legacy_snapshot_pricing_rows'
        chosen[effective_day] = b
    ordered = sorted(chosen.items())
    flow_models = collections.defaultdict(set)
    for row in flow:
        flow_models[normalize(row['model'])].add(row['model'])
    result = []
    excluded = []
    mapping = []
    max_day = max(by_day)
    missing_quotes = 0
    for index, (saved, b) in enumerate(ordered):
        start = (dt.date.fromisoformat(saved) + dt.timedelta(days=1)).isoformat()
        end = ordered[index+1][0] if index+1 < len(ordered) else None
        if start < window_start:
            excluded.append({'batchId':b['id'],'reason':'不在近两个月完整覆盖窗口内','start':start,'end':end});continue
        if not end or end > max_day:
            excluded.append({'batchId': b['id'], 'reason': '开放期或经营数据未覆盖完整期', 'start': start, 'end': end}); continue
        required_days = [(dt.date.fromisoformat(start)+dt.timedelta(days=i)).isoformat()
                         for i in range((dt.date.fromisoformat(end)-dt.date.fromisoformat(start)).days+1)]
        if not all(d in by_day for d in required_days):
            raise RuntimeError(f'Missing flow dates in {b["id"]}')
        models = involved(b)
        if models is None:
            excluded.append({'batchId': b['id'], 'reason': '缺少覆盖名单'}); continue
        absent = models - set(flow_models)
        if absent:
            raise RuntimeError(f'Unmapped covered models: {absent}')
        selected = set(b.get('restorePayload', {}).get('selectedCompetitionPpvs', [p['ppv'] for p in b['products']]))
        period_launch_models, overlapping_activity_ids = overlapping_launch_models(launch_activities, start, end)
        products = [p for p in b['products'] if p['ppv'] in selected and normalize(p['oldModel']) not in period_launch_models]
        duplicate_ppv_rows = len(products) - len({p['ppv'] for p in products})
        effective = models - period_launch_models
        qvalid = sum(max(0,p.get('quoteVolume',0)) for p in products if p.get('tmHandPrice',0)>0)
        qwin = sum(max(0,p.get('quoteVolume',0)) for p in products if p.get('tmHandPrice',0)>0 and p.get('postJdHandPrice',0)>=p['tmHandPrice'])
        qall = sum(max(0,p.get('quoteVolume',0)) for p in products)
        cells = collections.defaultdict(lambda: {'competition':[0,0], 'control':[0,0]})
        excluded_activity_quotes = 0; excluded_band_quotes = 0
        for d in required_days:
            for row in by_day[d]:
                model = normalize(row['model'])
                if model in period_launch_models:
                    excluded_activity_quotes += row['quotes']; continue
                if not row['model'] or not model:
                    missing_quotes += row['quotes']; continue
                if row['band'] in (None, '', '(NULL)', '无价位段'):
                    excluded_band_quotes += row['quotes']; continue
                h = (row['source_type'],row['source_channel'],row['recycle_type'],row['band'])
                group = 'competition' if model in effective else 'control'
                cells[h][group][0] += row['quotes']; cells[h][group][1] += row['submissions']
        if not effective or not qvalid:
            excluded.append({'batchId':b['id'],'reason':'活动排除后无有效竞争样本'});continue
        result.append({'batchId':b['id'],'start':start,'end':end,'days':len(required_days),
                       'score':100*qwin/qvalid,'snapshotScore':100*sum(max(0,p.get('quoteVolume',0)) for p in b['products'] if p['ppv'] in selected and p.get('tmHandPrice',0)>0 and p.get('postJdHandPrice',0)>=p['tmHandPrice']) / sum(max(0,p.get('quoteVolume',0)) for p in b['products'] if p['ppv'] in selected and p.get('tmHandPrice',0)>0), 'winningQuotes':qwin,'eligibleQuotes':qvalid,
                       'priceCoverage':100*qvalid/qall if qall else None,'involvedModels':len(models),
                       'analysisModels':len(effective),'excludedActivityModels':len(models & period_launch_models),
                       'overlappingActivityIds': overlapping_activity_ids,
                       'overlappingActivityModelCount':len(period_launch_models),
                       'excludedActivityQuotes':excluded_activity_quotes,'excludedBandQuotes':excluded_band_quotes,
                       'modelMatchRate':100,'duplicatePpvRows':duplicate_ppv_rows,'coverageBasis':b['coverageBasis'],'effectiveDayBasis':'recovered_original_pricing_date' if b['id'].startswith('RECOVERED-') else 'snapshot_save_date','cells':dict(cells)})
        for model in sorted(models):
            mapping.append({'batchId':b['id'],'normalizedModel':model,'flowModels':sorted(flow_models[model]),
                            'excludedActivity':model in period_launch_models})
    weights = standardize(result)
    if not weights:
        raise RuntimeError('No common strata across the complete periods')
    included_ids = {p['batchId'] for p in result}
    excluded_reason = {p['batchId']:p['reason'] for p in excluded}
    inventory = [{'id':b['id'],'type':b.get('batchType'),'summaryOnly':bool(b.get('isSummaryOnly')),
                  'included':b['id'] in included_ids,'createdAt':b['serverCreatedAt'],
                  'originalPricingTime':b.get('pricingTimestamp'),
                  'effectiveDay':b.get('analysisEffectiveDay'),
                  'reason':'已纳入' if b['id'] in included_ids else ('只有汇总、无覆盖明细' if b.get('isSummaryOnly') else ('新品活动，单独用于三天排除' if b.get('batchType')=='launch' else excluded_reason.get(b['id'],'同日较早版本已由后版替代')))} for b in active]
    output = {'version':'2026-11-13-recent-two-months-period-quote-weights-v5','generatedAt':dt.datetime.now(dt.timezone.utc).isoformat(),
              'analysisWindow':{'start':window_start,'end':window_end,'mode':'rolling_two_calendar_months','completePeriodsOnly':True},
              'flowMinDate':min(by_day),'flowMaxDate':max_day,'latestSnapshotSavedAt':max(b['serverCreatedAt'] for b in active),
              'scope':'手机 / BD / 京东 / 一站换新', 'grouping':'当期追价涉及型号（用户确认）',
              'bandField':'提交A等级价位段（统一）',
              'bandBasis':'流量表提交A等级价位段（统一），未证明为追价前固定档位',
              'weightBasis':'每期当期可比分层内竞争组实际报价量占比；分层与权重逐期计算',
              'launchExclusion':'新品保存次日起连续3个自然日；只在与该活动窗相交的常规覆盖期，从两组及X排除对应型号，其他期保留',
              'launchActivities':launch_activities,
              'launchModelCount':len(launch_models),'unknownLaunchCoverageIds':unknown_launch,
              'sourceRowCount':len(flow),'sourceQuotes':sum(r['quotes'] for r in flow),
              'sourceSubmissions':sum(r['submissions'] for r in flow),'missingModelQuotes':missing_quotes,
              'commonStrataCount':len(weights),'periods':result,'excludedPeriods':excluded,
              'snapshotAudit':inventory,
              'caveats':['型号层面同期观察差值，不是精确SKU曝光效果或因果增量',
                         '切换日归上一期，可能混入新策略；报价到跨日提交归属未经上游确认',
                         'X使用各快照近30天报价权重，Y使用各期实际竞争组报价量权重',
                         '型号、品牌及策略切换后的延续影响仍可能混杂']}
    target = ROOT/'data/competition-efficiency/latest.json'
    if target.exists():
        archive = target.parent/'.archive';archive.mkdir(exist_ok=True)
        target.rename(archive/f'latest-{dt.datetime.now().strftime("%Y%m%d-%H%M%S")}.json')
    target.write_text(json.dumps(output,ensure_ascii=False,indent=2))
    mapping_path = FOLDER/'model-mapping.json'
    if mapping_path.exists():
        archive=FOLDER/'.archive';archive.mkdir(exist_ok=True)
        mapping_path.rename(archive/f'model-mapping-{dt.datetime.now().strftime("%Y%m%d-%H%M%S")}.json')
    mapping_path.write_text(json.dumps(mapping,ensure_ascii=False,indent=2))
    print(json.dumps({'periods':len(result),'strata':len(weights),'launchModelsExcluded':len(launch_models),
                      'results':[{k:p[k] for k in ('start','end','score','difference','competitionQuotes','comparisonCoverage')} for p in result]},ensure_ascii=False))

if __name__ == '__main__':
    main()
