import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { toPng } from 'html-to-image';
import CompetitivenessSummary from '../components/CompetitivenessSummary';
import { TrackingBatch, ChannelId } from '../types';
import { FeishuReport } from '../api';

// Render the existing tracker at a fixed desktop width, including Benchmark cards
// and the real Recharts timeline. Only its raw-data audit table is omitted.
export const captureCompetitivenessTracker = async (batches: TrackingBatch[], report: FeishuReport) => {
  const host=document.createElement('div');
  host.setAttribute('aria-hidden','true');
  Object.assign(host.style,{position:'fixed',left:'-15000px',top:'0',width:'1280px',background:'#fff',pointerEvents:'none'});
  document.body.appendChild(host);
  const root=createRoot(host);
  try {
    flushSync(()=>root.render(<CompetitivenessSummary exportMode exportState={{batchId:report.batchId,...report.scope}} historyBatches={batches} currentCalculatedItems={[]} activeSubsidyFileName="" channelId={report.channelId as ChannelId} channelName={report.channelName}/>));
    // Use locally available fonts in the capture tree. External web fonts are
    // not available inside a rasterized SVG and otherwise clip text/numbers.
    for (const node of Array.from(host.querySelectorAll<HTMLElement | SVGElement>('*'))) {
      node.style.fontFamily = node.classList.contains('font-mono')
        ? 'Menlo, Consolas, monospace' : 'Arial, "PingFang SC", "Microsoft YaHei", sans-serif';
    }
    await document.fonts.ready;
    const deadline=Date.now()+8000;
    while(!Array.from(host.querySelectorAll('svg.recharts-surface')).some(svg=>svg.getBoundingClientRect().width>=500)) {
      if(Date.now()>deadline) throw new Error('追踪器图表尚未完成渲染，请重试预览');
      await new Promise(resolve=>setTimeout(resolve,80));
    }
    await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));
    const panel=host.querySelector<HTMLElement>('#competitiveness-summary-panel')!;
    // html-to-image rasterizes the actual DOM and SVG; no separate chart template.
    return (await toPng(panel,{pixelRatio:1.5,backgroundColor:'#ffffff',cacheBust:false,skipFonts:true,style:{margin:'0',animation:'none'}})).split(',')[1];
  } finally { root.unmount();host.remove(); }
};
