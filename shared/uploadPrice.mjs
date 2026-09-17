export const roundUploadPrice = value => {
  if (!Number.isFinite(value) || value <= 0) return 0;
  const integerPrice = Math.floor(value);
  if (integerPrice < 5) return 2;
  if (integerPrice === 250) return 245;
  const unit = integerPrice % 10;
  const tens = integerPrice - unit;
  if (integerPrice <= 100) return unit < 5 ? tens : tens + 5;
  if (integerPrice <= 500) return tens;
  if (unit <= 4) return tens;
  if (unit === 5) return integerPrice;
  return tens + 10;
};
