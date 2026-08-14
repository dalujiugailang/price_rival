const textValue = value => String(value ?? '').trim();

const BRAND_FIELDS = ['品牌名称', '品牌', 'brandName', 'brand'];

const canonicalBrandName = value => /^redmi$/i.test(value) ? '小米' : value;

const explicitBrandName = row => {
  for (const field of BRAND_FIELDS) {
    const brand = textValue(row?.[field]);
    if (brand) return canonicalBrandName(brand);
  }
  return '';
};

const INFERRED_BRANDS = [
  { name: 'OPPO', pattern: /OPPO/i },
  { name: '小米', pattern: /REDMI/i },
  { name: 'iQOO', pattern: /iQOO/i },
  { name: 'vivo', pattern: /vivo/i },
  { name: '摩托罗拉', pattern: /摩托罗拉|Motorola/i },
  { name: '三星', pattern: /三星|Samsung|Galaxy/i },
  { name: '一加', pattern: /一加|OnePlus/i },
  { name: '努比亚', pattern: /努比亚|红魔|Nubia/i },
  { name: '华为', pattern: /华为|HUAWEI/i },
  { name: '小米', pattern: /小米|Xiaomi/i },
  { name: '真我', pattern: /真我|realme/i },
  { name: '荣耀', pattern: /荣耀|HONOR/i }
];

export const resolveBrandName = row => {
  const explicitBrand = explicitBrandName(row);
  if (explicitBrand) return explicitBrand;

  const sourceText = [row?.['sku名称'], row?.ppv].map(textValue).filter(Boolean).join(' ');
  return INFERRED_BRANDS.find(item => item.pattern.test(sourceText))?.name || '';
};

export const enrichDailyPricePayload = (payload, brandPayload = undefined) => {
  const requireExplicitBrand = brandPayload !== undefined;
  const brandsByPpv = new Map(
    (Array.isArray(brandPayload?.rows) ? brandPayload.rows : [])
      .map(row => [textValue(row?.ppv), explicitBrandName(row)])
      .filter(([ppv, brand]) => ppv && brand)
  );

  return {
    ...(payload && typeof payload === 'object' ? payload : {}),
    rows: Array.isArray(payload?.rows)
      ? payload.rows.map(row => ({
        ...row,
        '品牌名称': brandsByPpv.get(textValue(row?.ppv))
          || explicitBrandName(row)
          || (requireExplicitBrand ? '' : resolveBrandName(row))
      }))
      : []
  };
};
