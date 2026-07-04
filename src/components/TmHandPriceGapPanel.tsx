/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Download, Share2 } from 'lucide-react';
import { CalculatedProduct, ChannelId } from '../types';
import { formatRMB } from '../utils/formulas';

interface Props {
  products: CalculatedProduct[];
  channelName: string;
  channelId: ChannelId;
}

type GapRow = {
  newSeries: string;
  brand: string;
  oldModel: string;
  ppv: string;
  ownPrice: number;
  competitorPrice: number;
  highPrice: number;
};

type PreviewImage = {
  url: string;
  blob: Blob;
  fileName: string;
};

const buildGapRows = (products: CalculatedProduct[], channelId: ChannelId): GapRow[] => {
  const isSelfOperated = channelId === 'selfOperated';
  return products
    .filter(product => isSelfOperated ? product.postAhsZzHandWin : product.postTmHandWin)
    .map(product => ({
      newSeries: product.newSeries || '未分组',
      brand: product.brand || product.oldModel.split(/\s+/)[0] || '未分组',
      oldModel: product.oldModel,
      ppv: product.ppv,
      ownPrice: isSelfOperated ? product.postAhsPrice : product.postJdHandPrice,
      competitorPrice: isSelfOperated ? product.zzHandPrice : product.tmHandPrice,
      highPrice: (isSelfOperated ? product.postAhsPrice : product.postJdHandPrice) - (isSelfOperated ? product.zzHandPrice : product.tmHandPrice)
    }))
    .sort((left, right) => (
      (isSelfOperated ? left.brand.localeCompare(right.brand, 'zh-Hans-u-kn-true') : left.newSeries.localeCompare(right.newSeries, 'zh-Hans-u-kn-true'))
      || right.highPrice - left.highPrice
      || left.oldModel.localeCompare(right.oldModel, 'zh-Hans-u-kn-true')
      || left.ppv.localeCompare(right.ppv, 'zh-Hans-u-kn-true')
    ));
};

const getCopy = (channelId: ChannelId) => {
  const isSelfOperated = channelId === 'selfOperated';
  return {
    title: isSelfOperated ? '自营渠道竞争优势型号' : '换新渠道竞争优势型号',
    countLabel: isSelfOperated ? '追后AHS补贴后比ZZ券后价=1' : '追后到手比TM=1',
    ownPriceLabel: isSelfOperated ? '追后物品价+AHS补贴' : '追后jd总到手价',
    competitorPriceLabel: isSelfOperated ? 'zz券后价' : 'tm总到手价',
    highPriceLabel: isSelfOperated ? '我方高出价格' : 'jd高出价格',
    emptyText: isSelfOperated ? '当前工作台没有“追后AHS补贴后比ZZ券后价=1”的行。' : '当前工作台没有“追后到手比tm=1”的行。',
    footnote: isSelfOperated
      ? '数据口径：追价工作台当前实时测算行，筛选“追后AHS补贴后比ZZ券后价=1”，我方高出价格=追后物品价+AHS补贴-zz券后价。'
      : '数据口径：追价工作台当前实时测算行，筛选“追后到手比tm=1”，jd高出价格=追后jd总到手价-tm总到手价。',
    fileSuffix: isSelfOperated ? '追后AHS补贴后比ZZ高出清单' : '追后到手比TM高出清单'
  };
};

const groupedRows = (rows: GapRow[], channelId: ChannelId) => {
  const isSelfOperated = channelId === 'selfOperated';
  return rows.reduce<{ series: string; rows: GapRow[] }[]>((groups, row) => {
    const groupName = isSelfOperated ? row.brand : row.newSeries;
    const latest = groups[groups.length - 1];
    if (latest && latest.series === groupName) {
      latest.rows.push(row);
      return groups;
    }
    groups.push({ series: groupName, rows: [row] });
    return groups;
  }, []);
};

const downloadBlob = (blob: Blob, fileName: string) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
};

const drawText = (
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  align: CanvasTextAlign = 'left'
) => {
  const value = String(text || '');
  if (ctx.measureText(value).width <= maxWidth) {
    ctx.textAlign = align;
    ctx.fillText(value, x, y);
    return;
  }

  let clipped = value;
  while (clipped.length > 0 && ctx.measureText(`${clipped}...`).width > maxWidth) {
    clipped = clipped.slice(0, -1);
  }
  ctx.textAlign = align;
  ctx.fillText(`${clipped}...`, x, y);
};

const toPngBlob = (canvas: HTMLCanvasElement) => {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(blob => {
      if (blob) resolve(blob);
      else reject(new Error('图片生成失败'));
    }, 'image/png', 1);
  });
};

export default function TmHandPriceGapPanel({ products, channelName, channelId }: Props) {
  const [sharing, setSharing] = useState(false);
  const [previewImage, setPreviewImage] = useState<PreviewImage | null>(null);
  const isSelfOperated = channelId === 'selfOperated';
  const copy = getCopy(channelId);
  const rows = useMemo(() => buildGapRows(products, channelId), [products, channelId]);
  const groups = useMemo(() => groupedRows(rows, channelId), [rows, channelId]);

  const totalHighPrice = rows.reduce((sum, row) => sum + row.highPrice, 0);
  const maxHighPrice = rows[0]?.highPrice || 0;

  useEffect(() => {
    return () => {
      if (previewImage) URL.revokeObjectURL(previewImage.url);
    };
  }, [previewImage]);

  const handleShareImage = async () => {
    setSharing(true);
    try {
      const width = 1440;
      const padding = 44;
      const headerHeight = 196;
      const titleBarHeight = 92;
      const summaryTop = 124;
      const summaryHeight = 44;
      const tableHeaderHeight = 36;
      const groupHeight = 38;
      const rowHeight = 54;
      const footerHeight = 84;
      const height = headerHeight + tableHeaderHeight + groups.length * groupHeight + rows.length * rowHeight + footerHeight;
      const canvas = document.createElement('canvas');
      const scale = Math.max(2, window.devicePixelRatio || 1);
      canvas.width = width * scale;
      canvas.height = height * scale;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;

      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('图片生成失败');
      ctx.scale(scale, scale);
      ctx.fillStyle = '#F0EFEC';
      ctx.fillRect(0, 0, width, height);
      ctx.strokeStyle = '#141414';
      ctx.lineWidth = 2;
      ctx.strokeRect(18, 18, width - 36, height - 36);

      ctx.fillStyle = '#141414';
      ctx.fillRect(18, 18, width - 36, titleBarHeight);
      ctx.fillStyle = '#FFFFFF';
      ctx.font = '700 38px Arial, "PingFang SC", "Microsoft YaHei", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(copy.title, width / 2, 72);
      ctx.font = '700 14px Arial, "PingFang SC", "Microsoft YaHei", sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText(new Date().toISOString().slice(0, 10), width - padding, 72);

      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(padding, summaryTop, width - padding * 2, summaryHeight);
      ctx.strokeStyle = '#141414';
      ctx.lineWidth = 1;
      ctx.strokeRect(padding, summaryTop, width - padding * 2, summaryHeight);
      const summary = `${copy.countLabel}：${rows.length} 条    合计高出：${formatRMB(totalHighPrice)}    单条最高：${formatRMB(maxHighPrice)}`;
      ctx.fillStyle = '#141414';
      ctx.font = '700 17px Arial, "PingFang SC", "Microsoft YaHei", sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(summary, padding + 16, summaryTop + 28);

      const columns = isSelfOperated
        ? [
            { key: 'oldModel', label: '旧机型号', x: padding, width: 240 },
            { key: 'ppv', label: 'ppv', x: padding + 240, width: 620 },
            { key: 'ownPrice', label: copy.ownPriceLabel, x: padding + 860, width: 170 },
            { key: 'competitorPrice', label: copy.competitorPriceLabel, x: padding + 1030, width: 150 },
            { key: 'highPrice', label: copy.highPriceLabel, x: padding + 1180, width: 170 }
          ]
        : [
            { key: 'newSeries', label: '新机系列', x: padding, width: 190 },
            { key: 'oldModel', label: '旧机型号', x: padding + 190, width: 190 },
            { key: 'ppv', label: 'ppv', x: padding + 380, width: 500 },
            { key: 'ownPrice', label: copy.ownPriceLabel, x: padding + 880, width: 150 },
            { key: 'competitorPrice', label: copy.competitorPriceLabel, x: padding + 1030, width: 150 },
            { key: 'highPrice', label: copy.highPriceLabel, x: padding + 1180, width: 170 }
          ];

      let y = headerHeight;
      ctx.fillStyle = '#D8D7D2';
      ctx.fillRect(padding, y, width - padding * 2, tableHeaderHeight);
      ctx.strokeStyle = '#141414';
      ctx.strokeRect(padding, y, width - padding * 2, tableHeaderHeight);
      ctx.fillStyle = '#141414';
      ctx.font = '700 14px Arial, "PingFang SC", "Microsoft YaHei", sans-serif';
      columns.forEach(column => drawText(ctx, column.label, column.x + 12, y + 23, column.width - 20));
      y += tableHeaderHeight;

      groups.forEach(group => {
        ctx.fillStyle = '#141414';
        ctx.fillRect(padding, y, width - padding * 2, groupHeight);
        ctx.fillStyle = '#FFFFFF';
        ctx.font = '700 15px Arial, "PingFang SC", "Microsoft YaHei", sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText(`${group.series} (${group.rows.length}条)`, padding + 12, y + 25);
        y += groupHeight;

        group.rows.forEach((row, index) => {
          ctx.fillStyle = index % 2 === 0 ? '#FFFFFF' : '#F9F9F8';
          ctx.fillRect(padding, y, width - padding * 2, rowHeight);
          ctx.strokeStyle = '#D8D7D2';
          ctx.beginPath();
          ctx.moveTo(padding, y + rowHeight);
          ctx.lineTo(width - padding, y + rowHeight);
          ctx.stroke();

          ctx.fillStyle = '#141414';
          ctx.font = '600 13px Arial, "PingFang SC", "Microsoft YaHei", sans-serif';
          columns.forEach(column => {
            if (column.key === 'newSeries') drawText(ctx, row.newSeries, column.x + 12, y + 33, column.width - 20);
            if (column.key === 'oldModel') drawText(ctx, row.oldModel, column.x + 12, y + 33, column.width - 20);
            if (column.key === 'ppv') drawText(ctx, row.ppv, column.x + 12, y + 33, column.width - 20);
          });
          ctx.font = '700 13px "SFMono-Regular", Menlo, Consolas, monospace';
          columns.forEach(column => {
            if (column.key === 'ownPrice') drawText(ctx, formatRMB(row.ownPrice), column.x + column.width - 12, y + 33, column.width - 20, 'right');
            if (column.key === 'competitorPrice') drawText(ctx, formatRMB(row.competitorPrice), column.x + column.width - 12, y + 33, column.width - 20, 'right');
          });
          ctx.fillStyle = '#166534';
          const highPriceColumn = columns.find(column => column.key === 'highPrice');
          if (highPriceColumn) drawText(ctx, formatRMB(row.highPrice), highPriceColumn.x + highPriceColumn.width - 12, y + 33, highPriceColumn.width - 20, 'right');
          y += rowHeight;
        });
      });

      y += 30;
      ctx.fillStyle = '#F0EFEC';
      ctx.fillRect(padding, y - 18, width - padding * 2, 38);
      ctx.fillStyle = '#141414';
      ctx.font = '600 12px Arial, "PingFang SC", "Microsoft YaHei", sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(copy.footnote, padding, y + 6);

      const blob = await toPngBlob(canvas);
      const fileName = `${channelName}_${copy.fileSuffix}_${new Date().toISOString().slice(0, 10)}.png`;
      const url = URL.createObjectURL(blob);
      setPreviewImage(previous => {
        if (previous) URL.revokeObjectURL(previous.url);
        return { url, blob, fileName };
      });
    } catch (err) {
      alert(err instanceof Error ? err.message : '图片生成失败');
    } finally {
      setSharing(false);
    }
  };

  const handleClosePreview = () => {
    if (previewImage) URL.revokeObjectURL(previewImage.url);
    setPreviewImage(null);
  };

  const handleDownloadPreview = () => {
    if (!previewImage) return;
    downloadBlob(previewImage.blob, previewImage.fileName);
  };

  const handleNativeSharePreview = async () => {
    if (!previewImage) return;
    const file = new File([previewImage.blob], previewImage.fileName, { type: 'image/png' });
    if (!navigator.canShare?.({ files: [file] })) return;
    await navigator.share({ files: [file], title: copy.title });
  };

  const canNativeSharePreview = previewImage
    ? navigator.canShare?.({ files: [new File([previewImage.blob], previewImage.fileName, { type: 'image/png' })] }) ?? false
    : false;

  return (
    <>
    <div data-tour="tm-hand-gap-list" className="bg-white border border-[#141414]">
      <div className="flex flex-col gap-3 border-b border-[#141414] bg-[#F0EFEC] p-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h3 className="text-sm font-black">{copy.title}</h3>
          <div className="mt-1 flex flex-wrap gap-2 text-[11px] font-bold text-[#141414]/70">
            <span>{copy.countLabel}：{rows.length} 条</span>
            <span>合计高出：{formatRMB(totalHighPrice)}</span>
            <span>单条最高：{formatRMB(maxHighPrice)}</span>
          </div>
        </div>
        <button
          type="button"
          onClick={handleShareImage}
          disabled={sharing || rows.length === 0}
          className="inline-flex items-center justify-center gap-2 border border-[#141414] bg-[#141414] px-3 py-2 text-xs font-bold text-white hover:bg-[#2A2A2B] disabled:cursor-not-allowed disabled:bg-[#141414]/40"
        >
          {navigator.share ? <Share2 className="h-4 w-4" /> : <Download className="h-4 w-4" />}
          {sharing ? '生成中' : '生成分享预览'}
        </button>
      </div>

      {rows.length === 0 ? (
        <div className="p-8 text-center text-sm font-bold text-[#141414]/55">
          {copy.emptyText}
        </div>
      ) : (
        <div className="max-h-[720px] overflow-auto">
          <table className={`w-full table-fixed border-collapse text-xs ${isSelfOperated ? 'min-w-[1030px]' : 'min-w-[1180px]'}`}>
            <thead className="sticky top-0 z-10 bg-[#D8D7D2]">
              <tr className="border-b border-[#141414]">
                {!isSelfOperated && <th className="w-[150px] border-r border-[#141414] px-2 py-2 text-left font-black">新机系列</th>}
                <th className="w-[160px] border-r border-[#141414] px-2 py-2 text-left font-black">旧机型号</th>
                <th className={isSelfOperated ? 'w-[480px] border-r border-[#141414] px-2 py-2 text-left font-black' : 'w-[430px] border-r border-[#141414] px-2 py-2 text-left font-black'}>ppv</th>
                <th className="w-[130px] border-r border-[#141414] px-2 py-2 text-right font-black">{copy.ownPriceLabel}</th>
                <th className="w-[130px] border-r border-[#141414] px-2 py-2 text-right font-black">{copy.competitorPriceLabel}</th>
                <th className="w-[130px] px-2 py-2 text-right font-black">{copy.highPriceLabel}</th>
              </tr>
            </thead>
            <tbody>
              {groups.map(group => (
                <React.Fragment key={group.series}>
                  <tr className="border-b border-[#141414] bg-[#141414] text-white">
                    <td colSpan={isSelfOperated ? 5 : 6} className="px-2 py-2 text-left text-xs font-black">
                      {group.series} / {group.rows.length} 条
                    </td>
                  </tr>
                  {group.rows.map(row => (
                    <tr key={row.ppv} className="border-b border-[#141414]/15 hover:bg-[#F9F9F8]">
                      {!isSelfOperated && <td className="border-r border-[#141414]/20 px-2 py-2 font-bold">{row.newSeries}</td>}
                      <td className="border-r border-[#141414]/20 px-2 py-2 font-bold">{row.oldModel}</td>
                      <td className="border-r border-[#141414]/20 px-2 py-2">
                        <div className="truncate font-mono text-[11px]" title={row.ppv}>{row.ppv}</div>
                      </td>
                      <td className="border-r border-[#141414]/20 px-2 py-2 text-right font-mono">{formatRMB(row.ownPrice)}</td>
                      <td className="border-r border-[#141414]/20 px-2 py-2 text-right font-mono">{formatRMB(row.competitorPrice)}</td>
                      <td className="px-2 py-2 text-right font-mono font-black text-green-700">{formatRMB(row.highPrice)}</td>
                    </tr>
                  ))}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
    {previewImage && (
      <div className="fixed inset-0 z-[11000] flex items-center justify-center bg-black/60 p-5">
        <div className="flex max-h-[92vh] w-full max-w-5xl flex-col border-2 border-[#141414] bg-white shadow-[6px_6px_0_#141414]">
          <div className="flex items-center justify-between border-b-2 border-[#141414] bg-[#F0EFEC] px-4 py-3">
            <div>
              <h3 className="text-sm font-black">分享图预览</h3>
              <p className="mt-0.5 text-[11px] font-bold text-[#141414]/60">{previewImage.fileName}</p>
            </div>
            <button
              type="button"
              onClick={handleClosePreview}
              className="border border-[#141414] bg-white px-3 py-1.5 text-xs font-black hover:bg-[#141414] hover:text-white"
            >
              关闭
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-auto bg-[#D8D7D2] p-4">
            <img
              src={previewImage.url}
              alt="分享图预览"
              className="mx-auto block max-w-full border border-[#141414] bg-white"
            />
          </div>
          <div className="flex flex-wrap justify-end gap-2 border-t-2 border-[#141414] bg-white px-4 py-3">
            <button
              type="button"
              onClick={handleDownloadPreview}
              className="inline-flex items-center gap-2 border border-[#141414] bg-white px-3 py-2 text-xs font-black hover:bg-[#F0EFEC]"
            >
              <Download className="h-4 w-4" />
              下载图片
            </button>
            {canNativeSharePreview && (
              <button
                type="button"
                onClick={handleNativeSharePreview}
                className="inline-flex items-center gap-2 border border-[#141414] bg-[#141414] px-3 py-2 text-xs font-black text-white hover:bg-[#2A2A2B]"
              >
                <Share2 className="h-4 w-4" />
                系统分享
              </button>
            )}
          </div>
        </div>
      </div>
    )}
    </>
  );
}
