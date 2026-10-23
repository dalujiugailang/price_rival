import React from 'react';
import ProfitRateComparison from './ProfitRateComparison';
// PPV margins are decimal ratios; the supplied UI consumes percentage values.
const toPercent=(n:number|null)=>n===null||!Number.isFinite(n)?null:n*100;
export default function ProfitComparison({current,target,floor,ceiling}:{current:number|null;target:number|null;floor:number|null;ceiling:number|null}) {
  return <ProfitRateComparison currentRate={toPercent(current)} afterRate={toPercent(target)} floorRate={toPercent(floor)} ceiling={ceiling}/>;
}
