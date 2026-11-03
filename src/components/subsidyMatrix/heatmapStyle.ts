// Shared by the webpage and Excel export so amount bands cannot drift.
export const amountColors = ['#DCE8F4', '#B2DBF6', '#FFE6A7', '#F8BD8E', '#EB927E', '#BB4E5A'];
export const amountLabels = ['0–99', '100–199', '200–349', '350–499', '500–699', '≥700'];
export const amountBand = (value: number) => value < 100 ? 0 : value < 200 ? 1 : value < 350 ? 2 : value < 500 ? 3 : value < 700 ? 4 : 5;
