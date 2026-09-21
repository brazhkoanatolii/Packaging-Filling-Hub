/**
 * Read-only API for the Product Specifications workbook.
 * The source workbook remains the owner of product data.
 */
const PRODUCT_SPECIFICATION_BOOK = '1BCfwR8P2UqjlbnDyrEp95n2AmbQpx0N4SDZV540GpA8';
const PRODUCT_SPECIFICATION_SHEET = 'Для фасовки 24.07.2026';

function listProductSpecifications() {
  const sheet = SpreadsheetApp.openById(PRODUCT_SPECIFICATION_BOOK)
    .getSheetByName(PRODUCT_SPECIFICATION_SHEET);
  if (!sheet) throw new Error('В Google отсутствует вкладка спецификации продуктов');

  const rows = sheet.getRange(3, 2, Math.max(0, sheet.getLastRow() - 2), 10).getValues();
  let currentLine = '';

  return rows.map((row, index) => {
    const line = productSpecText_(row[0]);
    if (line) currentLine = line;

    return {
      id: `spec:${index + 3}`,
      line: currentLine,
      product: productSpecText_(row[1]),
      variant: productSpecNumber_(row[2]),
      dryMass: productSpecNumber_(row[3]),
      wetMass: productSpecNumber_(row[4]),
      liquidVolume: productSpecNumber_(row[5]),
      processType: productSpecText_(row[6]),
      pouchCount: productSpecNumber_(row[7]),
      lidColor: productSpecText_(row[8]),
      canType: productSpecText_(row[9])
    };
  }).filter((item) => item.line && item.product && item.variant !== null);
}

function productSpecText_(value) {
  return String(value == null ? '' : value).trim();
}

function productSpecNumber_(value) {
  const number = Number(String(value == null ? '' : value).replace(',', '.'));
  return Number.isFinite(number) ? number : null;
}
