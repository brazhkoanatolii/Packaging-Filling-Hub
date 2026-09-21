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

function saveProductSpecification(input) {
  requireProductManager_(input);
  const sheet = productSpecificationSheet_();
  const item = normalizeProductSpecification_(input);
  const rowNumber = productSpecificationRow_(item.id);
  const values = [[item.line, item.product, item.variant, item.dryMass, item.wetMass, item.liquidVolume,
    item.processType, item.pouchCount, item.lidColor, item.canType]];

  if (rowNumber) sheet.getRange(rowNumber, 2, 1, 10).setValues(values);
  else sheet.getRange(sheet.getLastRow() + 1, 2, 1, 10).setValues(values);
  return listProductSpecifications().find((specification) => specification.id === `spec:${rowNumber || sheet.getLastRow()}`);
}

function deleteProductSpecification(input) {
  requireProductManager_(input);
  const rowNumber = productSpecificationRow_(input && input.id);
  if (!rowNumber) throw new Error('Не выбрана спецификация для удаления');
  const sheet = productSpecificationSheet_();
  sheet.getRange(rowNumber, 2, 1, 10).clearContent();
  return { ok: true, id: `spec:${rowNumber}` };
}

function productSpecificationSheet_() {
  const sheet = SpreadsheetApp.openById(PRODUCT_SPECIFICATION_BOOK).getSheetByName(PRODUCT_SPECIFICATION_SHEET);
  if (!sheet) throw new Error('В Google отсутствует вкладка спецификации продуктов');
  return sheet;
}

function requireProductManager_(input) {
  if (input && input.role === 'manager') return;
  throw new Error('Редактировать спецификации может только начальник участка');
}

function productSpecificationRow_(id) {
  const match = /^spec:(\d+)$/.exec(String(id || ''));
  return match ? Number(match[1]) : null;
}

function normalizeProductSpecification_(input) {
  const text = (value) => String(value == null ? '' : value).trim();
  const number = (value, label, required) => {
    if (value === '' || value == null) {
      if (required) throw new Error(`Заполните поле «${label}»`);
      return '';
    }
    const result = Number(String(value).replace(',', '.'));
    if (!Number.isFinite(result)) throw new Error(`Поле «${label}» должно быть числом`);
    return result;
  };
  const item = {
    id: text(input && input.id), line: text(input && input.line), product: text(input && input.product),
    variant: number(input && input.variant, 'mg/g', true), dryMass: number(input && input.dryMass, 'Вес сухого продукта', false),
    wetMass: number(input && input.wetMass, 'Вес мокрого продукта', false), liquidVolume: number(input && input.liquidVolume, 'Жидкость', false),
    processType: text(input && input.processType), pouchCount: number(input && input.pouchCount, 'Количество подушек', false),
    lidColor: text(input && input.lidColor), canType: text(input && input.canType)
  };
  if (!item.line || !item.product) throw new Error('Заполните линейку и название продукта');
  return item;
}

function productSpecText_(value) {
  return String(value == null ? '' : value).trim();
}

function productSpecNumber_(value) {
  const number = Number(String(value == null ? '' : value).replace(',', '.'));
  return Number.isFinite(number) ? number : null;
}
