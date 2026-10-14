export type OcrLine={text:string;confidence:number;box:number[][]};
export function ocrText(lines:OcrLine[],safe=false){
 const rows:{y:number;h:number;lines:OcrLine[]}[]=[];
 for(const line of [...lines].sort((a,b)=>a.box[0][1]-b.box[0][1])){
  const y=line.box.reduce((n,p)=>n+p[1],0)/4;
  const h=Math.max(...line.box.map(p=>p[1]))-Math.min(...line.box.map(p=>p[1]));
  const row=rows.find(r=>Math.abs(r.y-y)<=Math.max(4,Math.min(r.h,h)*.45));
  if(row)row.lines.push(line);else rows.push({y,h,lines:[line]});
 }
 const keys=['策略名称','策略分组','类别','策略范围','类型','策略标识','价位段','A级价位段','适用范围','适用型号','SKU属性','等级','策略','策略金额','备注','有效时间','开始时间','结束时间'];
 return rows.map(r=>{const cells=r.lines.sort((a,b)=>a.box[0][0]-b.box[0][0]).map(x=>safe&&x.confidence<.85?'【待核对】':x.text.trim());const key=cells[0]?.replace(/[:：]$/,'');if(keys.includes(key)&&cells.length>1)return key+':\n'+cells.slice(1).join('\n');return cells.join('\t');}).join('\n');
}
