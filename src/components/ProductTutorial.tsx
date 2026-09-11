import React, { useId, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { BookOpen, ChartNoAxesCombined, Coins, Database, FileText, GitCompareArrows, Info, ListChecks, Scale, Tags } from 'lucide-react';
import './ProductTutorial.css';

type RowGroup = { start: number; label: string };

const snapshotFields = [
  {
    title: '基础信息',
    rows: [
      ['新机系列', '基础竞争表「新机系列」；用于匹配补贴。'],
      ['旧机型号', '基础竞争表「旧机型号」。'],
      ['ppv', '基础竞争表「ppv」；用于匹配每日报价。'],
      ['商品SKUID', '基础竞争表「skuid」。'],
      ['等级id', '每日报价按ppv匹配；未匹配时取基础竞争表。'],
      ['ppv近30天报价量', '基础竞争表同名字段；用于竞争力加权。'],
      ['ppv近30天成交量', '基础竞争表同名字段；用于投入预估。旧表缺少30天字段时沿用14天成交量。'],
      ['品牌名称', '每日报价按ppv匹配；未匹配时取新机系列首段，系列为空时取旧机型号首段。']
    ]
  },
  {
    title: '追前价格与补贴',
    rowGroups: [
      { start: 0, label: '京东 · JD' },
      { start: 5, label: '天猫 · TM' },
      { start: 10, label: '转转 · ZZ' },
      { start: 12, label: '利润测算基准' }
    ],
    rows: [
      ['jd裸机价', '每日报价的「最终报价」；无有效匹配价时取基础竞争表。'],
      ['对应新品型号ahs投入', '按新机系列、jd裸机价匹配补贴表的AHS承担金额。'],
      ['含AHS补贴后报价', 'jd裸机价 ＋ 对应新品型号ahs投入。'],
      ['对应新品型号jd总投入', '按新机系列、jd裸机价匹配补贴表的京东总补贴。'],
      ['jd总到手价', 'jd裸机价 ＋ 对应新品型号jd总投入。'],
      ['tm裸机价', '基础竞争表「tm裸机价」。'],
      ['对应新品型号tm回收商投入', '按tm裸机价匹配系统内的天猫回收商补贴档位。'],
      ['含tm回收商补贴后报价', 'tm裸机价 ＋ 对应新品型号tm回收商投入；tm裸机价无效时为0。'],
      ['tm总补贴-人工', '基础竞争表「tm总补贴-人工」。'],
      ['tm总到手价', 'tm裸机价 ＋ tm总补贴-人工。'],
      ['zz裸机价', '每日报价的「ZZ券前价」；无有效匹配价时取基础竞争表。'],
      ['zz券后价', '优先取源表券后价；缺失时＝zz裸机价＋转转券，未提供券时按裸机价的18%计算券。'],
      ['基准价', '每日报价的「BI基准价」；无有效匹配价时取基础竞争表。']
    ]
  },
  {
    title: '追后价格与补贴',
    rowGroups: [{ start: 0, label: '京东 · JD' }],
    rows: [
      ['京东物品价-追价后', '按追价规则生成的建议价；有人工调整时取人工价。'],
      ['京东物品价-追价后调整金额', '京东物品价-追价后 － jd裸机价。'],
      ['小差额提醒', '根据剩余价差和小差额容忍规则生成的提示。'],
      ['ahs承担补贴-追价后', '按新机系列、京东物品价-追价后重新匹配AHS补贴。'],
      ['含AHS补贴后报价-追价后', '京东物品价-追价后 ＋ ahs承担补贴-追价后。'],
      ['jd总到手价-追价后', '京东物品价-追价后 ＋ 按追后价重新匹配的京东总补贴。']
    ]
  },
  {
    title: '价差与利润',
    rowGroups: [
      { start: 0, label: '京东 vs 天猫 · 价差' },
      { start: 4, label: '京东 · 边际利润率' }
    ],
    rows: [
      ['追前tm物品价差', 'jd裸机价 － tm裸机价。'],
      ['追前tm到手价差', 'jd总到手价 － tm总到手价。'],
      ['追后tm物品价差', '京东物品价-追价后 － tm裸机价。'],
      ['追后tm到手价差', 'jd总到手价-追价后 － tm总到手价。'],
      ['追前边际利润率', '1 －（含AHS补贴后报价 × 1.0466 ＋ 基准价 × 2.18% ＋ 81）÷ 基准价。'],
      ['追后边际利润率', '1 －（含AHS补贴后报价-追价后 × 1.0466 ＋ 基准价 × 2.18% ＋ 81）÷ 基准价。']
    ]
  },
  {
    title: '逐行竞争判断',
    rowGroups: [
      { start: 0, label: '京东 vs 天猫' },
      { start: 5, label: '京东 vs 转转' }
    ],
    rows: [
      ['裸机比tm', 'jd裸机价 ≥ tm裸机价。'],
      ['到手比tm', 'jd总到手价 ≥ tm总到手价。'],
      ['京东物品价-追价后 vs 天猫', '京东物品价-追价后 ≥ tm裸机价。'],
      ['京东物品价+ahs补贴-追价后 vs天猫', '含AHS补贴后报价-追价后 ≥ 含tm回收商补贴后报价。'],
      ['京东到手价-追价后 vs 天猫', 'jd总到手价-追价后 ≥ tm总到手价。'],
      ['裸机比zz', 'jd裸机价 ≥ zz裸机价。'],
      ['仅含ahs补贴+裸机 vs zz到手', '含AHS补贴后报价 ≥ zz券后价。'],
      ['京东物品价-追价后 vs 转转', '京东物品价-追价后 ≥ zz裸机价。'],
      ['京东物品价+ahs补贴-追价后 vs 转转', '含AHS补贴后报价-追价后 ≥ zz券后价。'],
      ['京东到手价-追价后vs转转', 'jd总到手价-追价后 ≥ zz券后价。']
    ]
  },
  {
    title: '导出附加字段',
    rows: [
      ['京东物品价-追价后理由', '记录采用目标价、利润上限或人工价等原因。'],
      ['追后边际利润率说明', '显示本次测算的目标价或利润底线允许的价格上限。']
    ]
  }
];
const metrics = [
  ['天猫物品价竞争力', '京东物品价-追价后 vs 天猫'],
  ['AHS补贴后 vs TM回收商补贴后', '京东物品价+ahs补贴-追价后 vs天猫'],
  ['天猫到手价竞争力', '京东到手价-追价后 vs 天猫'],
  ['转转物品价竞争力', '京东物品价-追价后 vs 转转'],
  ['物品价＋AHS补贴 vs 转转到手价', '京东物品价+ahs补贴-追价后 vs 转转'],
  ['京东到手价 vs 转转到手价', '京东到手价-追价后vs转转']
];

function Table({ headers, rows, rowGroups = [] }: { headers: string[]; rows: string[][]; rowGroups?: RowGroup[] }) {
  const groups = rowGroups.length ? rowGroups : [{ start: 0, label: '' }];
  return <div className="overflow-x-auto border border-[#141414]">
    <table className="w-full text-left text-[13px]">
      <thead className="bg-[#F0EFEC]"><tr>{headers.map(h => <th key={h} scope="col" className="border-b border-[#141414] border-r border-[#141414]/30 px-3 py-2.5 font-bold last:border-r-0">{h}</th>)}</tr></thead>
      {groups.map((group, groupIndex) => <tbody key={group.label}>
        {group.label && <tr><th scope="rowgroup" colSpan={headers.length} className={`bg-[#F0EFEC] px-3 py-2 text-xs font-bold tracking-wide border-b border-[#141414]/30 ${groupIndex > 0 ? 'border-t border-t-[#141414]' : ''}`}>
          <span className="border-l-2 border-[#141414] pl-2">{group.label}</span>
        </th></tr>}
        {rows.slice(group.start, groups[groupIndex + 1]?.start).map(row => <tr key={row[0]} className="tutorial-data-row border-b border-[#141414]/15 last:border-b-0">{row.map((cell, i) => <td key={i} className={`border-r border-[#141414]/15 px-3 py-2.5 align-top leading-6 last:border-r-0 ${i === 0 ? 'min-w-[120px] font-bold' : ''}`}>{cell}</td>)}</tr>)}
      </tbody>)}
    </table>
  </div>;
}



const sections = [
  ['overview', '看板使用说明'], ['fields', '指标与竞争力口径'],
  ['subsidy', '补贴诊断'], ['history', '历史快照']
] as const;
type SectionId = typeof sections[number][0];
const tourSections: Record<string, SectionId> = { 'guide-weighting': 'fields', 'guide-subsidy': 'subsidy', 'guide-history': 'history' };

const sectionIcons = {
  '看板阅读顺序': ListChecks,
  '竞争力计算口径': ChartNoAxesCombined,
  '看板指标对应哪些快照字段': GitCompareArrows,
  '快照字段说明': FileText,
  '基础信息': Tags,
  '追前价格与补贴': Coins,
  '追后价格与补贴': Coins,
  '价差与利润': Scale,
  '逐行竞争判断': GitCompareArrows,
  '导出附加字段': FileText,
  '看板投入测算': ChartNoAxesCombined,
  '补贴差异排查': Coins,
  '补贴匹配规则': ListChecks,
  '快照状态与正式落数': Database
};

function Highlight({ children }: { children: React.ReactNode }) {
  const reduceMotion = useReducedMotion();
  return <motion.mark className="relative isolate inline-block bg-transparent px-0.5 text-inherit"
    initial="hidden" whileInView="visible" viewport={{ once: true, amount: 1 }}>
    <motion.span aria-hidden="true" className="absolute inset-x-0 bottom-[0.12em] -z-10 h-[0.65em] origin-left bg-[#E4E3E0]"
      variants={{ hidden: { scaleX: reduceMotion ? 1 : 0 }, visible: { scaleX: 1 } }}
      transition={{ duration: reduceMotion ? 0 : 0.65, delay: reduceMotion ? 0 : 0.15, ease: 'easeOut' }} />
    {children}
  </motion.mark>;
}

function SectionHeading({ title, primary = false }: { title: string; primary?: boolean }) {
  const reduceMotion = useReducedMotion();
  const Heading = primary ? motion.h3 : motion.h4;
  const Icon = sectionIcons[title as keyof typeof sectionIcons] || FileText;
  return <Heading
    className={`relative pb-2 font-bold ${primary ? 'border-b border-[#141414]/30 text-base' : 'text-sm'}`}
    initial="hidden"
    whileInView="visible"
    viewport={{ once: true, amount: 1 }}
  >
    <motion.span className="inline-flex items-center gap-2" variants={{ hidden: { x: reduceMotion ? 0 : 6, opacity: reduceMotion ? 1 : 0.7 }, visible: { x: 0, opacity: 1 } }}
      transition={{ duration: reduceMotion ? 0 : 0.4, ease: 'easeOut' }}><Icon aria-hidden="true" size={primary ? 17 : 15} strokeWidth={1.6} className="shrink-0" />{title}</motion.span>
    <svg aria-hidden="true" width="40" height="2" viewBox="0 0 40 2" className="absolute bottom-0 left-0 text-[#141414]">
      <motion.path d="M0 1H40" fill="none" stroke="currentColor" strokeWidth="2"
        variants={{ hidden: { pathLength: reduceMotion ? 1 : 0 }, visible: { pathLength: 1 } }}
        transition={{ duration: reduceMotion ? 0 : 0.6, ease: 'easeOut' }} />
    </svg>
  </Heading>;
}
function InfoSection({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="border-t border-[#141414]/20 pt-6"><SectionHeading title={title} /><div className="mt-3 space-y-3 text-[13px] leading-6">{children}</div></section>;
}
function TextSection({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="space-y-4 text-[13px] leading-6"><SectionHeading title={title} primary />{children}</section>;
}
export default function ProductTutorial({ onStartTour, tourTarget }: { onStartTour: () => void; tourTarget?: string }) {
  const [selected, setSelected] = useState<SectionId>('overview');
  const reduceMotion = useReducedMotion();
  const navId = useId();
  const active = tourTarget ? tourSections[tourTarget] || 'overview' : selected;
  return <article className="product-tutorial bg-white rounded-none text-[#141414]" data-tour="product-tutorial">
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[#141414] bg-[#F0EFEC] px-5 py-4">
      <div><h2 className="flex items-center gap-2 text-base font-bold"><BookOpen aria-hidden="true" size={17} strokeWidth={1.6} />产品教程</h2><p className="mt-1 text-xs text-[#141414]/70">京东换新 · 看板说明与计算口径</p></div>
      <button type="button" onClick={onStartTour} className="tutorial-tour-button border border-[#141414] bg-[#141414] px-3 py-1.5 text-xs font-bold text-white hover:bg-white hover:text-[#141414] focus-visible:outline-2 focus-visible:outline-offset-2">开始使用导览<span aria-hidden="true" className="ml-2 inline-block">→</span></button>
    </header>
    <nav aria-label="教程分区" className="flex flex-wrap gap-2 border-b border-[#141414] bg-[#F9F9F8] px-5 py-3">
      {sections.map(([id, title]) => <button key={id} type="button" aria-pressed={active === id} disabled={!!tourTarget} onClick={() => setSelected(id)}
        className={`relative isolate border border-[#141414] px-3 py-1.5 text-xs font-bold focus-visible:outline-2 focus-visible:outline-offset-2 ${active === id ? 'bg-[#141414] text-white' : 'bg-white hover:bg-[#E4E3E0]'}`}>
        {active === id && <motion.span aria-hidden="true" layoutId={reduceMotion ? undefined : `${navId}-active`} className="absolute inset-0 -z-10 bg-[#141414]" transition={{ duration: 0.22, ease: 'easeOut' }} />}
        {title}
      </button>)}
    </nav>
    <motion.div key={active} className="p-5 md:p-6" initial={{ opacity: reduceMotion ? 1 : 0.8 }} animate={{ opacity: 1 }} transition={{ duration: 0.2 }}>
      {active === 'overview' && <TextSection title="看板阅读顺序">
        <ol className="tutorial-reading-steps">
          {[
            ['选择数据范围', '在「竞争力走势」选择历史批次、品牌和新机系列，核对日期及“正式落数 / 未确认快照”状态。'],
            ['查看竞争力指标', '依次查看物品价竞争力和到手价竞争力，分别评估基础回收报价与补贴后的价格表现。'],
            ['定位问题明细', '在下方明细展开品牌、系列，查看“物品价具备竞争力、到手价缺乏竞争力”的记录，优先核对报价量较高的PPV。'],
            ['核对历史变化', '在「历史」选择快照，可搜索型号、筛选和导出；比较两个批次时选择“两期对比”。']
          ].map(([title, description], index) => <motion.li key={title}
            initial={{ x: reduceMotion ? 0 : 8, opacity: reduceMotion ? 1 : 0.7 }} whileInView={{ x: 0, opacity: 1 }}
            viewport={{ once: true, amount: 0.5 }} transition={{ duration: 0.35, delay: reduceMotion ? 0 : index * 0.06 }}>
            <span aria-hidden="true" className="tutorial-step-number">{String(index + 1).padStart(2, '0')}</span>
            <div><strong>{title}</strong><p className="mt-1 text-[#141414]/80">{description}</p></div>
          </motion.li>)}
        </ol>
        <p className="border-t border-[#141414]/20 pt-4 text-[#141414]/70">报告中应注明批次日期、品牌 / 系列和正式状态。指标所属批次以卡片上方的数据来源标签为准。</p>
        <p>首次使用可选择“开始使用导览”，按页面控件逐步了解查询与复盘操作。</p>
      </TextSection>}

      {active === 'fields' && <TextSection title="竞争力计算口径">
        <p><strong>同一PPV下，<Highlight>我方价格 ≥ 竞品价格</Highlight>，判定为有竞争力。</strong>价格持平计入有竞争力范围；汇总时<Highlight>按近30天报价量加权</Highlight>。</p>
        <div data-tour="guide-weighting" className="border border-[#141414] p-5">
          <p className="mb-4 font-bold">计算示例：A有竞争力，报价量90次；B无竞争力，报价量10次</p>
          <Table headers={['记录', '近30天报价量', '价格比较']} rows={ [['A', '90次', '我方 ≥ 竞品，有竞争力'], ['B', '10次', '我方 < 竞品，无竞争力']] } />
          <div className="relative mt-5 flex h-10 overflow-hidden bg-[#D8D7D2] text-center text-sm font-bold" aria-label="有竞争力90次，无竞争力10次">
            <motion.div aria-hidden="true" className="absolute inset-y-0 left-0 w-[90%] origin-left bg-[#141414]"
              initial={{ scaleX: reduceMotion ? 1 : 0 }} whileInView={{ scaleX: 1 }} viewport={{ once: true, amount: 1 }}
              transition={{ duration: reduceMotion ? 0 : 0.8, ease: 'easeOut' }} />
            <div className="relative flex w-[90%] items-center justify-center"><span className="bg-[#141414] px-1 text-white">有竞争力：90次</span></div>
            <div className="relative flex w-[10%] items-center justify-center">10</div>
          </div>
          <p className="mt-4 font-mono text-xl font-bold">竞争力＝90 ÷（90＋10）＝<Highlight>90%</Highlight></p>
          <p className="mt-1 text-[#141414]/60">本例按报价量计算，结果为90%；按记录条数计算的50%不适用于本指标。示例数据仅用于说明口径。</p>
        </div>
        <ul className="list-disc space-y-2 pl-5">
          <li><strong>通用公式：</strong>有竞争力记录的报价量之和 ÷ 竞品价格有效记录的报价量之和。</li>
          <li>仅纳入对应竞品价格大于0的记录。若B的竞品价缺失，其10次报价不计入分母，结果为90÷90＝100%。</li>
          <li>品牌、系列汇总时，应<Highlight>先汇总报价量，再计算比例</Highlight>，不直接平均各组百分比。权重取所选批次保存的近30天报价量。</li>
        </ul>
        <InfoSection title="看板指标对应哪些快照字段">
          <Table headers={['看板指标', '用于加权的快照字段']} rows={metrics} rowGroups={[{ start: 0, label: '京东 vs 天猫' }, { start: 3, label: '京东 vs 转转' }]} />
          <p>各项分别按有效竞品价加权，分母可能不同。报价量≤0不贡献权重；结果保留1位小数，无有效权重时为0。</p>
        </InfoSection>
        <InfoSection title="快照字段说明">
          <p>以下名称与京东换新快照表头一致。数据取<Highlight>保存当时的值</Highlight>；历史缺失项显示“—”，不会随当前报价自动更新。</p>
        </InfoSection>
        {snapshotFields.map(group => <div key={group.title}><InfoSection title={group.title}>
          <Table headers={['快照字段', '来源 / 计算方式']} rows={group.rows} rowGroups={group.rowGroups} />
          {group.title === '追前价格与补贴' && <p className="text-[#141414]/80"><Info aria-hidden="true" size={14} className="mr-1 inline-block align-text-bottom" />京东与AHS补贴均取已达到的最高门槛档；未到最低门槛为0，无该系列规则时沿用基础表。<Highlight>京东总到手价不额外叠加AHS补贴</Highlight>。</p>}
          {group.title === '价差与利润' && <p className="text-[#141414]/70">价差为正表示京东高出，为负表示低于天猫；竞品价无效时显示“—”。基准价≤0时利润率记0，不能用于正常利润判断。</p>}
          {group.title === '逐行竞争判断' && <p className="text-[#141414]/70">竞品价&gt;0且比较条件成立记1，否则记0；历史未保存的结果显示“—”。</p>}
        </InfoSection></div>)}
        <InfoSection title="看板投入测算">
          <p>竞争预估投入费用＝Σ（正向物品价调整金额 × ppv近30天成交量）。投入费率＝预估费用 ÷ 对应范围的近30天回收预估销售额。</p>
        </InfoSection>
      </TextSection>}

      {active === 'subsidy' && <TextSection title="补贴差异排查">
        <div data-tour="guide-subsidy" className="space-y-4">
          <p>在竞争力走势下方展开品牌、新机系列，点击“补贴问题明细”，筛查<strong><Highlight>物品价具备竞争力、到手价缺乏竞争力</Highlight></strong>的记录。</p>
          <Table headers={['演示案例', '物品价', '总补贴', '到手价']} rows={ [['京东', '1030元', '100元', '1130元'], ['天猫', '1000元', '200元', '1200元']] } />
          <p>本例京东物品价高出30元，总补贴低于天猫100元，最终到手价低于天猫70元。<strong>调整前应核对补贴金额及适用档位。</strong></p>
        </div>
        <ul className="list-disc space-y-2 pl-5">
          <li>优先核对报价量较高的PPV，并检查同批次的双方物品价、总补贴与到手价。</li>
          <li>“天猫补贴承接缺口”＝物品价竞争力－到手价竞争力，单位是<strong><Highlight>百分点</Highlight></strong>，不代表应追加的补贴金额；两项有效分母也可能不同。</li>
          <li>「追后到手高出TM」展示到手价高于天猫的记录，高出金额不直接等于可削减的补贴。</li>
        </ul>
        <InfoSection title="补贴匹配规则"><p>按新机系列匹配，再取物品价达到的最高门槛档。有规则但未到最低门槛时补贴为0；没有该系列规则时沿用基础字段。追前、追后价格不同，补贴也可能不同。</p></InfoSection>
      </TextSection>}

      {active === 'history' && <TextSection title="快照状态与正式落数">
        <div data-tour="guide-history"><Table headers={['状态', '说明']} rows={[
          ['实时测算', '随当前数据和策略变化，尚未正式确认。只读账号以页面标注的共享快照来源为准。'],
          ['未确认快照', '保留当时的价格、补贴和结果，用于历史追溯；保存不等于正式确认。'],
          ['正式落数', '经运营确认，按落数日期进入正式趋势。保存快照时也可以同时确认。'],
          ['仅汇总历史', '只有竞争力汇总分数，没有PPV明细，不能按品牌或系列拆分。']
        ]} /></div>
        <p><strong>时间字段：</strong>追价时间是业务追价时点；保存时间是快照创建时点；落数日期是正式数据归属日期。</p>
        <p>同渠道、同落数日期重新确认时，新记录成为正式落数，旧记录变为未确认快照，历史记录继续保留。后续修改实时价格，不会自动更新旧快照。</p>
        <p>在「历史」选择批次，可搜索、筛选、导出和两期对比。只读账号无需保存或确认；正式落数由有权限的运营人员完成。</p>
      </TextSection>}
    </motion.div>
  </article>;
}
