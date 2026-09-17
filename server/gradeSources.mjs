import * as XLSX from 'xlsx';

const text = v => String(v ?? '').trim();
const norm = v => text(v).replace(/\s+/g, '').toLowerCase();
const invalid = message => { throw Object.assign(new Error(message), { statusCode: 400 }); };
const numeric = (v, label) => {
  if (v === null || v === undefined || text(v) === '') return null;
  const n = typeof v === 'number' ? v : Number(text(v).replace(/,/g, ''));
  if (!Number.isFinite(n) || n < 0) invalid(`${label}必须是非负数，收到“${text(v)}”`);
  return n;
};
const records = (wb, name, required) => {
  const sheetNames = name ? [name] : wb.SheetNames;
  for (const sheetName of sheetNames) {
    if (!wb.Sheets[sheetName]) continue;
    const sheet = wb.Sheets[sheetName];
    const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1');
    if (range.e.r > 300000 || range.e.c > 250) invalid('底表范围过大，请移除多余空行列后上传');
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: true });
    const header = rows.slice(0, 30).findIndex(row => required.every(key => row.some(v => norm(v) === norm(key))));
    if (header < 0) continue;
    const keys = rows[header].map(text);
    return rows.slice(header + 1).map((row, i) => ({ row: i + header + 2, values: Object.fromEntries(keys.map((k, j) => [norm(k), row[j] ?? null])) }))
      .filter(item => Object.values(item.values).some(v => text(v)));
  }
  invalid(`没有找到字段：${required.join('、')}${name ? `（${name}）` : ''}`);
};
export const validatePeriod = (start, end) => {
  const date = s => /^\d{4}-\d{2}-\d{2}$/.test(s || '') && new Date(s).toISOString().slice(0, 10) === s;
  if (!date(start) || !date(end) || Date.parse(end) - Date.parse(start) !== 29 * 86400000) invalid('请选择完整近30天数据周期（含首尾共30天）');
};
export const parseGradeVolume = buffer => {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const source = records(wb, null, ['商品型号', '商品SKUID', '商品SKU', '商品LEVEL', '报价量', '成交量']);
  if (!source.length) invalid('底表没有明细');
  const grouped = new Map();
  const skuIdentity = new Map();
  for (const item of source) {
    const v = item.values;
    const model = text(v['商品型号']), sku = text(v['商品sku']), skuId = text(v['商品skuid']), level = text(v['商品level']);
    if (!model || !sku || !skuId || !level) invalid(`第 ${item.row} 行缺少型号、SKU、SKU ID 或等级（请移除合计行）`);
    const identity = JSON.stringify([model, sku]);
    if (skuIdentity.has(skuId) && skuIdentity.get(skuId) !== identity) invalid(`SKU ID ${skuId} 对应多个型号或规格`);
    skuIdentity.set(skuId, identity);
    const ppv = `${level}${sku}`, key = JSON.stringify([skuId, norm(level)]);
    const quoteVolume = numeric(v['报价量'], `第 ${item.row} 行报价量`) ?? 0;
    const soldVolume = numeric(v['成交量'], `第 ${item.row} 行成交量`) ?? 0;
    if ((quoteVolume !== null && !Number.isInteger(quoteVolume)) || (soldVolume !== null && !Number.isInteger(soldVolume))) invalid(`第 ${item.row} 行报价量/成交量必须为整数`);
    const row = grouped.get(key);
    if (row) {
      row.quoteVolume += quoteVolume;
      row.soldVolume += soldVolume;
      row.sourceRows.push(item.row);
    } else grouped.set(key, { model, sku, skuId, level, ppv, quoteVolume, soldVolume, sourceRows: [item.row] });
  }
  return { rows: [...grouped.values()], sourceRowCount: source.length };
};
export const parseGradeTemplate = buffer => {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const mapping = records(wb, '型号对应等级模板', ['型号名称', '等级模板名称']);
  const input = records(wb, '等级模板对应等级降序', ['等级模板名称', '等级顺位', '等级', '等级比']);
  const models = Object.create(null), templates = new Map();
  for (const { row, values: v } of mapping) {
    const model = text(v['型号名称']), template = text(v['等级模板名称']);
    if (!model || !template) invalid(`型号映射第 ${row} 行不完整`);
    if (Object.hasOwn(models, model) && models[model] !== template) invalid(`型号 ${model} 对应多个模板`);
    models[model] = template;
  }
  for (const { row, values: v } of input) {
    const template = text(v['等级模板名称']), level = text(v['等级']);
    const rank = numeric(v['等级顺位'], `第 ${row} 行等级顺位`);
    const raw = v['等级比'];
    const ratio = typeof raw === 'string' && raw.endsWith('%') ? numeric(raw.slice(0, -1), '等级比') / 100 : numeric(raw, '等级比');
    if (!template || !level || !Number.isInteger(rank) || rank < 1 || !(ratio > 0) || ratio > 2) invalid(`等级配置第 ${row} 行无效；等级比请用百分比格式，例如 98%（数值 0.98）`);
    const list = templates.get(template) || [];
    if (list.some(r => r.rank === rank || norm(r.level) === norm(level))) invalid(`${template} 中顺位或等级重复`);
    list.push({ template, rank, level, ratio }); templates.set(template, list);
  }
  for (const [name, list] of templates) {
    list.sort((a, b) => a.rank - b.rank);
    if (list.some((r, i) => r.rank !== i + 1 || (i > 0 && r.ratio > list[i - 1].ratio + 1e-9))) invalid(`${name} 的等级顺位须连续，比例不可向下回升`);
  }
  if (!mapping.length || !templates.size) invalid('模板文件没有有效数据');
  for (const [model, template] of Object.entries(models)) if (!templates.has(template)) invalid(`型号 ${model} 的模板 ${template} 没有等级规则`);
  return { models, rules: [...templates.values()].flat() };
};
