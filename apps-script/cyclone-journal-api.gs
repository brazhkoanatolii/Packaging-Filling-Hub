/**
 * Add to the existing API executable project. Enable the advanced Sheets service.
 * Reads never mutate the workbook. Writes require explicit script-property opt-in.
 */
const PFH_CYCLONE_BOOK = '1jEpmScclwvmIhhiHnBi0EE5kRBGNLtfmP4zepkAMQDU';
const PFH_CYCLONE_TAB = 'Очистка циклонов';
const PFH_CYCLONE_RECEIPT = 'PFH_CYCLONE_V1:';

function listCycloneRecords() {
  const sheet = pfhCycloneSheet_();
  return { ok: true, records: pfhCycloneRows_(sheet) };
}

function createCycloneRecord(input) {
  if (PropertiesService.getScriptProperties().getProperty('PFH_CYCLONE_WRITES_ENABLED') !== 'true') {
    throw new Error('Запись очисток в Google выключена');
  }
  if (!input || ['manager', 'senior'].indexOf(input.role) < 0) throw new Error('Недостаточно прав');
  ['requestId', 'recordId'].forEach(function (key) {
    if (!/^[a-zA-Z0-9_-]{8,160}$/.test(String(input[key] || ''))) throw new Error('Некорректный идентификатор запроса');
  });
  const date = String(input.date || '');
  const value = new Date(date + 'T12:00:00Z');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || isNaN(value.getTime()) || value.toISOString().slice(0, 10) !== date ||
      date > Utilities.formatDate(new Date(), 'Europe/Vilnius', 'yyyy-MM-dd')) throw new Error('Некорректная дата очистки');
  const performer = String(input.performer || '').trim();
  if (!performer || /^[=+@-]/.test(performer)) throw new Error('Выберите исполнителя');

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sheet = pfhCycloneSheet_();
    const existing = pfhCycloneRows_(sheet).find(function (r) { return r.requestId === input.requestId || r.id === input.recordId; });
    if (existing) {
      if (existing.requestId !== input.requestId || existing.id !== input.recordId || existing.date !== date || existing.performer !== performer) {
        throw new Error('Повторный идентификатор относится к другой записи');
      }
      return { ok: true, record: existing };
    }
    // Canonical corporate personnel, not an untrusted browser-supplied name.
    const personnel = listPersonnel().personnel;
    if (!personnel.some(function (p) { return p.fullName === performer && p.active !== false; })) throw new Error('Исполнитель отсутствует в действующем персонале');
    const row = Math.max(4, sheet.getLastRow() + 1);
    const receipt = { id: input.recordId, requestId: input.requestId, createdAt: new Date().toISOString(), workstationId: String(input.workstationId || '') };
    const serial = Math.round((Date.parse(date + 'T00:00:00Z') - Date.UTC(1899, 11, 30)) / 86400000);
    const requests = [];
    if (row > sheet.getMaxRows()) requests.push({ appendDimension: { sheetId: sheet.getSheetId(), dimension: 'ROWS', length: row - sheet.getMaxRows() } });
    // A:B and the receipt commit atomically: a lost HTTP response can safely retry.
    requests.push({ updateCells: {
      start: { sheetId: sheet.getSheetId(), rowIndex: row - 1, columnIndex: 0 },
      rows: [{ values: [
        { userEnteredValue: { numberValue: serial }, note: PFH_CYCLONE_RECEIPT + JSON.stringify(receipt) },
        { userEnteredValue: { stringValue: performer } }
      ] }], fields: 'userEnteredValue,note'
    } });
    requests.push({ repeatCell: { range: { sheetId: sheet.getSheetId(), startRowIndex: row - 1, endRowIndex: row, startColumnIndex: 0, endColumnIndex: 1 },
      cell: { userEnteredFormat: { numberFormat: { type: 'DATE', pattern: 'dd.MM.yyyy' } } }, fields: 'userEnteredFormat.numberFormat' } });
    Sheets.Spreadsheets.batchUpdate({ requests: requests }, PFH_CYCLONE_BOOK);
    return { ok: true, record: Object.assign({}, receipt, { date: date, performer: performer }) };
  } finally { lock.releaseLock(); }
}

function pfhCycloneSheet_() {
  const sheet = SpreadsheetApp.openById(PFH_CYCLONE_BOOK).getSheetByName(PFH_CYCLONE_TAB);
  if (!sheet) throw new Error('Не найден лист очистки циклонов');
  const headers = sheet.getRange(3, 1, 1, 2).getDisplayValues()[0];
  if (headers[0] !== 'Дата' || headers[1] !== 'Имя, Фамилия') throw new Error('Изменилась структура журнала очистки циклонов');
  return sheet;
}

function pfhCycloneRows_(sheet) {
  const count = Math.max(0, sheet.getLastRow() - 3);
  if (!count) return [];
  const values = sheet.getRange(4, 1, count, 2).getValues();
  const notes = sheet.getRange(4, 1, count, 1).getNotes();
  return values.map(function (row, index) {
    if (!row[0] && !row[1]) return null;
    if (!(row[0] instanceof Date) || isNaN(row[0].getTime()) || !String(row[1]).trim()) throw new Error('Проверьте дату и исполнителя в строке ' + (index + 4));
    const note = notes[index][0] || '';
    const receipt = note.indexOf(PFH_CYCLONE_RECEIPT) === 0 ? JSON.parse(note.slice(PFH_CYCLONE_RECEIPT.length)) : {};
    return Object.assign({}, receipt, { id: receipt.id || 'cyclone-row-' + (index + 4),
      date: Utilities.formatDate(row[0], 'Europe/Vilnius', 'yyyy-MM-dd'), performer: String(row[1]).trim() });
  }).filter(function (row) { return row !== null; });
}
