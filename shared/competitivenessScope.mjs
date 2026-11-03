export const ALL_BRANDS = 'ALL';
export const ALL_SERIES = 'ALL_SERIES';
const BRAND_ALIASES = new Map([
  ['iqoo', 'iQOO'],
  ['oppo', 'OPPO'],
  ['redmi', '小米'],
  ['vivo', 'vivo'],
  ['华为', '华为'],
  ['huawei', '华为'],
  ['摩托罗拉', '摩托罗拉'],
  ['motorola', '摩托罗拉'],
  ['moto', '摩托罗拉'],
  ['努比亚', '努比亚'],
  ['nubia', '努比亚'],
  ['荣耀', '荣耀'],
  ['honor', '荣耀'],
  ['三星', '三星'],
  ['samsung', '三星'],
  ['小米', '小米'],
  ['xiaomi', '小米'],
  ['一加', '一加'],
  ['oneplus', '一加'],
  ['真我', '真我'],
  ['realme', '真我']
]);

const normalizeBrandAlias = (value) => {
  const brand = String(value || '').trim();
  return BRAND_ALIASES.get(brand.toLocaleLowerCase()) || '';
};

const rawBrandOf = (product) => {
  const entry = Object.entries(product.rawFields || {}).find(([key]) => {
    const fieldName = key.replace(/^[A-Z]+_/, '').trim().replace(/\s+/g, '').toLocaleLowerCase();
    return ['品牌名称', '品牌', 'brandname', 'brand'].includes(fieldName);
  });
  const explicitBrand = String(entry?.[1] || '').trim();
  return explicitBrand ? normalizeBrandAlias(explicitBrand) || explicitBrand : '';
};

// Legacy imports used the first word of newSeries as brand (e.g. Mate/Find).
// Recover only from an explicit brand prefix on the saved old model; never
// guess from a new-series name or borrow a later snapshot's prices/weights.
const oldModelBrandOf = (product) => {
  const model = String(product.oldModel || '').trim();
  const prefix = model.match(/^(华为|荣耀|摩托罗拉|努比亚|红魔|三星|小米|一加|真我|iQOO|OPPO|vivo|Redmi|Huawei|Honor|Motorola|Nubia|Samsung|Xiaomi|OnePlus|realme)(?=\s|\d|[^a-zA-Z]|$)/i)?.[1];
  return prefix === '红魔' ? '努比亚' : normalizeBrandAlias(prefix);
};

export const resolveCompetitivenessBrand = (product) => (
  rawBrandOf(product) || normalizeBrandAlias(product.brand) || oldModelBrandOf(product)
);

export const resolveCompetitivenessSeries = (product) => String(product.newSeries || '').trim();

const brandOf = resolveCompetitivenessBrand;
const seriesOf = resolveCompetitivenessSeries;

export const filterCompetitivenessProducts = (
  products,
  selectedBrand,
  selectedSeries = ALL_SERIES
) => {
  if (selectedBrand === ALL_BRANDS && selectedSeries === ALL_SERIES) return products;
  return products.filter(product => (
    (selectedBrand === ALL_BRANDS || brandOf(product) === selectedBrand)
    && (selectedSeries === ALL_SERIES || seriesOf(product) === selectedSeries)
  ));
};
