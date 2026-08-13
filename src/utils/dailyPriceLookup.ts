import { Product } from '../types';

export const getDailyPriceLookupPpvs = (currentProducts: Product[]) => Array.from(new Set(
  currentProducts.map(product => String(product.ppv || '').trim()).filter(Boolean)
));
