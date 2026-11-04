import {addWorksheet, createWorkbook} from '@office-kit/xlsx/workbook';
import {freezePanes, mergeCells, setCell, setColumnWidth, setRowHeight} from '@office-kit/xlsx/worksheet';
import {setCellStyle} from '@office-kit/xlsx/styles';
import type {CellValue} from '@office-kit/xlsx/cell';
import type {MatrixGroup, MatrixRow, MatrixWorkspace} from './types';
import {amountColors, amountLabels, ratioLabels, heatmapCell, ratioSpread, type HeatmapMode} from './heatmapStyle';

export function createMatrixWorkbook({workspace, rows, groups, columnWidth = 88, mode = 'amount', spreadRows = rows}: {
  workspace: MatrixWorkspace;
  rows: MatrixRow[];
  groups: MatrixGroup[];
  columnWidth?: number;
  mode?: HeatmapMode;
  spreadRows?: MatrixRow[];
}) {
  const book = createWorkbook();
  const sheet = addWorksheet(book, '补贴承担热力图');
  sheet.views = [{workbookViewId: 0, showGridLines: false}];
  const lastCol = groups.length + 1;
  const color = (rgb: string) => ({rgb: `FF${rgb.replace('#', '')}`});
  const line = {style: 'thin' as const, color: color('#DEDEDE')};
  const write = (r: number, c: number, value: CellValue, bg = '#FFFFFF', fg = '#141414', bold = false, size = 8.25, left = false, border = true) => {
    const cell = setCell(sheet, r, c, value);
    setCellStyle(book, cell, {
      font: {name: 'Arial', size, bold, color: color(fg)},
      fill: {kind: 'pattern', patternType: 'solid', fgColor: color(bg)},
      alignment: {horizontal: left ? 'left' : 'center', vertical: 'center', wrapText: true, indent: left ? 1 : 0},
      ...(border ? {border: {left: line, right: line, top: line, bottom: line}} : {}),
      numberFormat: '#,##0'
    });
    return cell;
  };
  const across = (row: number, text: string, size = 9, bold = false) => {
    write(row, 1, text, '#FFFFFF', '#141414', bold, size, true, false);
    if (lastCol > 1) mergeCells(sheet, {minRow: row, maxRow: row, minCol: 1, maxCol: lastCol});
  };
  // CSS pixels to Excel points / character widths (96 dpi).
  setColumnWidth(sheet, 1, (185 - 5) / 7);
  groups.forEach((_, i) => setColumnWidth(sheet, i + 2, (columnWidth - 5) / 7));
  across(1, `所有新机系列—爱回收承担补贴热力图${mode === 'ratio' ? ' · 承担比例' : ''}`, 13.5, true);
  setRowHeight(sheet, 1, 30);
  across(2, `补贴来源：${workspace.fileName} · ${workspace.label}${workspace.uploadedAt ? ` · ${workspace.uploadedAt}` : ''}`, 8.25);
  setRowHeight(sheet, 2, 22);
  across(3, `显示 ${rows.length} 个系列 · ${groups.length} 档门槛   行：新机系列 ｜ 列：合并门槛 ｜ ${mode === 'ratio' ? '承担比例＝承担额 ÷ 原始门槛' : '金额单位：元'}`, 8.25);
  setRowHeight(sheet, 3, 22);
  write(4, 1, '品牌 / 新机系列', '#F0EFEC', '#141414', true, 8.25, true);
  groups.forEach((g, i) => write(4, i + 2, {kind: 'rich-text', runs: [
    {text: `${g.label}\n`, font: {b: true, sz: 8.25}},
    {text: `最大差额 Δ ${mode === 'ratio' ? ratioSpread(spreadRows, g.key) : g.delta.toLocaleString('en-US')}`, font: {b: false, sz: 7.5, color: color('#555555')}}
  ]}, '#F0EFEC', '#141414', true));
  setRowHeight(sheet, 4, 51 * .75);
  rows.forEach((row, i) => {
    const r = i + 5;
    write(r, 1, {kind: 'rich-text', runs: [
      {text: `${row.brand}${row.activeCount ? ` · ${row.activeCount} 条报价` : ' · 未使用'}\n`, font: {b: false, sz: 7.5, color: color('#555555')}},
      {text: `${row.activeCount ? '【目标】' : ''}${row.series}`, font: {b: true, sz: 8.25}}
    ]}, row.activeCount ? '#F9F9F8' : '#FFFFFF', row.activeCount ? '#141414' : '#777777', true, 8.25, true);
    setRowHeight(sheet, r, 37 * .75);
    groups.forEach((group, j) => {
      const rules = row.cells[group.key];
      if (!rules?.length) {write(r, j + 2, '—', '#F9F9F8', '#999999'); return;}
      const info = heatmapCell(rules, mode);
      const value = info.max === null ? info.text : info.min === info.max ? info.max : info.text;
      const cell = write(r, j + 2, value, info.background, info.foreground, true);
      const numberFormat = mode === 'ratio' ? '0.00%' : '#,##0';
      setCellStyle(book, cell, {numberFormat: numberFormat + (rules.length > 1 ? '" ◈"' : '')});
      if (rules.length > 1 && typeof value === 'string') cell.value = `${value} ◈`;

    });
  });
  let legendRow = rows.length + 6;
  // Keep the complete six-band legend, even when only one threshold is visible.
  for (let i = 0; i < amountColors.length; i++) {
    const r = legendRow + Math.floor(i / lastCol), c = i % lastCol + 1;
    write(r, c, mode === 'ratio' ? ratioLabels[i] : `${amountLabels[i]} 元`, amountColors[i], i === 5 ? '#FFFFFF' : '#141414');
    setRowHeight(sheet, r, 20);
  }
  legendRow += Math.ceil(amountColors.length / lastCol);
  across(legendRow, mode === 'ratio' ? '承担比例＝爱回收承担额 ÷ 原始门槛；◈ 多规则保留比例范围，颜色取最高比例；Δ 单位 pp 为百分点，门槛为0时待核验。' : '◈ 多条原始规则；单元格范围保留不同承担额，颜色以最大承担额为准。', 8.25);
  setRowHeight(sheet, legendRow, 28);
  across(legendRow + 1, '合并门槛仅用于展示。实际追价利润测算必须以原始触发门槛和适用补贴规则为准。', 8.25);
  setRowHeight(sheet, legendRow + 1, 32);
  freezePanes(sheet, 4, 1);
  return book;
}
