export function parseStrategyText(text: string) {
  const lines = text.split(/\r?\n/).map(x => x.trim()).filter(Boolean);
  const labels = ['策略名称','策略分组','类别','策略范围','类型','策略标识','价位段','A级价位段','适用范围','适用型号','SKU属性','等级','策略','策略金额','备注','开始时间','结束时间','生效开始时间','生效结束时间','后台策略链接','有效时间'];
  const sections: Record<string,string[]> = {};
  let current = '';
  for (const line of lines) {
    if (current === '适用型号' && ['类别','品牌','型号','操作'].includes(line)) continue;
    const match = line.match(/^([^:：]+)[:：](.*)$/);
    if (match && labels.includes(match[1].trim())) {
      current = match[1].trim(); sections[current] = [];
      if (match[2].trim()) sections[current].push(match[2].trim());
    } else if (labels.includes(line)) {
      current = line; sections[current] = [];
    } else if (current) sections[current].push(line);
  }
  const single = (key: string) => {
    const values = (sections[key] || []).filter(x => !/请选择|待核对|添加一行|^%$/.test(x));
    if (key === '策略范围' && values.join(' ').includes('非全局') && values.join(' ').replaceAll('非全局','').includes('全局')) return undefined;
    if (key === '适用范围' && values.join(' ').includes('品牌') && values.join(' ').includes('型号')) return undefined;
    return values.length === 1 ? values[0] : undefined;
  };
  const models: string[] = [], ids: string[] = [], brands: string[] = [];
  for (const row of sections['适用型号'] || []) {
    const cells = row.split(/\t+/).map(x => x.trim()).filter(Boolean);
    const line = cells.length >= 3 ? cells[2] : row;
    const m = line.match(/^(.+?)\s*[（(](\d+)[）)]\s*$/);
    if (!m || /^(手机|华为|小米|荣耀|三星|华硕|努比亚|vivo|OPPO)$/.test(m[1].trim())) continue;
    const name = m[1].trim();
    if (!models.includes(name)) { models.push(name); ids.push(`${name}：${m[2]}`); }
    const brand = name.match(/^(华为|小米|荣耀|三星|华硕|努比亚|vivo|OPPO)/i)?.[1];
    if (brand && !brands.includes(brand)) brands.push(brand);
  }
  const value = single('策略');
  const ratio = value && /^-?\d+(?:\.\d+)?\s*%?$/.test(value) ? Number(value.replace('%','').trim()) : undefined;
  const fields: Record<string,string> = {};
  const warnings: string[] = [];
  for (const key of ['策略分组','类别','策略范围','类型','策略标识','价位段','A级价位段','适用范围','等级','策略金额']) {
    const v = single(key);
    if (v) fields[key] = v;
    else if ((sections[key] || []).some(x => !/请选择/.test(x))) warnings.push(`${key}包含多个选项或未确认内容，未自动填入`);
  }
  if (ids.length) fields['后台型号编号'] = ids.join('\n');
  if ((sections['SKU属性'] || []).some(x => x !== '添加一行')) warnings.push('SKU属性需人工核对，未自动填入');
  const time = (keys: string[]) => {
    for (const key of keys) {
      const match = single(key)?.match(/(\d{4}-\d{2}-\d{2})[ T]?(\d{2}:\d{2}:\d{2})/);
      const v = match ? match[1]+' '+match[2] : undefined;
      if (v && Number.isFinite(Date.parse(v.replace(' ','T')+'+08:00'))) return v.replace('T',' ');
    }
    return undefined;
  };
  if (!models.length) warnings.push('未找到带编号的具体型号，请核对适用型号');
  if (ratio === undefined) warnings.push('未找到明确压价比例');
  const validTimes = (sections['有效时间'] || []).map(x => x.replace(/^(\d{4}-\d{2}-\d{2})(\d{2}:\d{2}:\d{2})$/, '$1 $2')).filter(x => /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}$/.test(x) && Number.isFinite(Date.parse(x.replace(' ','T')+'+08:00')));
  if ((sections['有效时间'] || []).length && validTimes.length !== 2) warnings.push('有效时间未找到明确的两行日期，请人工核对');
  const name = single('策略名称');
  return {name, models, brand:brands.join('；'), ratio, note:single('备注'), start:time(['开始时间','生效开始时间']) || (validTimes.length === 2 ? validTimes[0].replace('T',' ') : undefined), end:time(['结束时间','生效结束时间']) || (validTimes.length === 2 ? validTimes[1].replace('T',' ') : undefined), fields, warnings};
}
