/** ТО и ремонт: чтение и добавление в два существующих рабочих журнала. */
const PFH_MAINTENANCE_BOOKS = Object.freeze({ service: '1SRirurDOMqyGEXj2oo_V81CQ5jKnnvg9nN8G21QAFAY', repair: '1pg2Y9Hnc-5BCU3QaF3k9VwOJjqNwdkXbE3qFAnY6Qw8' });
const PFH_MAINTENANCE_TZ = 'Europe/Vilnius';

function getMaintenanceSnapshot() {
  const serviceBook = SpreadsheetApp.openById(PFH_MAINTENANCE_BOOKS.service);
  const repairBook = SpreadsheetApp.openById(PFH_MAINTENANCE_BOOKS.repair);
  const service = pfhMaintenanceReadBook_(serviceBook, 'ТО', 16, 3);
  const repair = pfhMaintenanceReadBook_(repairBook, 'Ремонт', 16, 5);
  const options = pfhRepairOptions_(repairBook);
  service.machines = pfhMachineOptions_(16);
  service.performers = pfhUnique_(pfhPersonnelNames_().concat(service.records.map(function (r) { return r.performer; })));
  repair.machines = pfhMachineOptions_(16);
  repair.performers = pfhUnique_(options.performers.concat(pfhPersonnelNames_()).concat(repair.records.map(function (r) { return r.performer; })));
  repair.categories = options.categories;
  repair.workByCategory = options.workByCategory;
  return { ok: true, service: service, repair: repair };
}

function createMaintenanceRecord(input) { return pfhCreateMaintenanceRecord_(input, 'service'); }
function createRepairRecord(input) { return pfhCreateMaintenanceRecord_(input, 'repair'); }

function pfhCreateMaintenanceRecord_(input, journal) {
  const data = input || {};
  if (['manager', 'senior'].indexOf(String(data.role || '')) < 0) throw new Error('Добавлять записи могут начальник участка и старший механик.');
  const requestId = pfhText_(data.requestId, 120, 'Идентификатор запроса');
  const machine = Number(data.machine);
  if (!Number.isInteger(machine) || machine < 1 || machine > 16) throw new Error('Выберите станок из списка.');
  const date = pfhDate_(data.date);
  const performer = pfhText_(data.performer, 160, 'Исполнитель');
  const note = String(data.note || '').trim();
  if (note.length > 5000) throw new Error('Примечание не должно превышать 5000 символов.');
  const book = SpreadsheetApp.openById(PFH_MAINTENANCE_BOOKS[journal]);
  const prefix = journal === 'service' ? 'ТО' : 'Ремонт';
  const sheet = book.getSheetByName(prefix + ' ' + ('0' + machine).slice(-2));
  if (!sheet) throw new Error('Не найден журнал для выбранного станка.');
  const receipt = 'PFH_' + (journal === 'service' ? 'SERVICE' : 'REPAIR') + '_V1:' + requestId;
  const previous = pfhFindReceipt_(sheet, receipt);
  if (previous) return { ok: true, record: pfhMaintenanceRow_(sheet, previous, journal === 'service' ? 3 : 5) };
  let category = 'ТО'; let work = 'Техническое обслуживание';
  if (journal === 'repair') {
    category = pfhText_(data.category, 160, 'Категория работ');
    work = pfhText_(data.work, 240, 'Вид работ');
    const options = pfhRepairOptions_(book);
    if (options.categories.indexOf(category) < 0) throw new Error('Выберите категорию работ из списка.');
    if ((options.workByCategory[category] || []).indexOf(work) < 0) throw new Error('Выберите вид работ из списка.');
  }
  const lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    const duplicate = pfhFindReceipt_(sheet, receipt);
    if (duplicate) return { ok: true, record: pfhMaintenanceRow_(sheet, duplicate, journal === 'service' ? 3 : 5) };
    if (journal === 'service') pfhEnsureServicePerformer_(book, performer);
    const row = Math.max(5, sheet.getLastRow() + 1);
    const width = journal === 'service' ? 3 : 5;
    sheet.getRange(5, 1, 1, width).copyTo(sheet.getRange(row, 1), SpreadsheetApp.CopyPasteType.PASTE_NORMAL, false);
    sheet.getRange(row, 1, 1, width).setValues([journal === 'service' ? [date, performer, note] : [date, category, work, performer, note]]);
    sheet.getRange(row, 1).setNote(receipt);
    SpreadsheetApp.flush();
    return { ok: true, record: pfhMaintenanceRow_(sheet, row, width) };
  } finally { lock.releaseLock(); }
}

function pfhMaintenanceReadBook_(book, prefix, machineCount, width) {
  const records = [];
  for (let number = 1; number <= machineCount; number += 1) {
    const sheet = book.getSheetByName(prefix + ' ' + ('0' + number).slice(-2));
    if (!sheet) continue;
    const count = Math.max(0, sheet.getLastRow() - 4); if (!count) continue;
    const values = sheet.getRange(5, 1, count, width).getValues();
    const notes = sheet.getRange(5, 1, count, 1).getNotes();
    values.forEach(function (row, index) { if (row[0] instanceof Date && !isNaN(row[0].getTime())) records.push(pfhMaintenanceRowFromValues_(row, number, index + 5, width, notes[index][0])); });
  }
  records.sort(function (a, b) { return b.date.localeCompare(a.date) || b.id.localeCompare(a.id); });
  return { records: records, statistics: pfhMaintenanceStats_(records) };
}

function pfhMaintenanceRow_(sheet, row, width) { const values = sheet.getRange(row, 1, 1, width).getValues()[0]; const machine = Number(String(sheet.getName()).match(/(\d+)$/)[1]); return pfhMaintenanceRowFromValues_(values, machine, row, width, sheet.getRange(row, 1).getNote()); }
function pfhMaintenanceRowFromValues_(row, machine, sheetRow, width, receipt) { const repair = width === 5; const matched = String(receipt || '').match(/PFH_(?:SERVICE|REPAIR)_V1:(.+)$/); return { id: matched ? matched[1] : (repair ? 'repair' : 'service') + '-' + machine + '-' + sheetRow, machine: machine, date: Utilities.formatDate(row[0], PFH_MAINTENANCE_TZ, 'yyyy-MM-dd'), category: repair ? String(row[1] || '').trim() : 'ТО', work: repair ? String(row[2] || '').trim() : 'Техническое обслуживание', performer: String(row[repair ? 3 : 1] || '').trim(), note: String(row[repair ? 4 : 2] || '').trim() }; }
function pfhRepairOptions_(book) { const sheet = book.getSheetByName('Справочники'); if (!sheet) throw new Error('Не найден лист «Справочники» журнала ремонта.'); const categories = pfhColumnValues_(sheet, 4); return { performers: pfhColumnValues_(sheet, 1), categories: categories, workByCategory: { 'Настройка': pfhColumnValues_(sheet, 2), 'Ремонт': pfhColumnValues_(sheet, 3) } }; }
function pfhColumnValues_(sheet, column) { const last = Math.max(2, sheet.getLastRow()); return pfhUnique_(sheet.getRange(2, column, last - 1, 1).getDisplayValues().map(function (row) { return row[0]; })); }
function pfhMachineOptions_(count) { return Array.from({ length: count }, function (_, index) { return index + 1; }); }
function pfhEnsureServicePerformer_(book, performer) { const sheet = book.getSheetByName('Справочники'); if (!sheet) throw new Error('Не найден лист «Справочники» журнала ТО.'); if (pfhColumnValues_(sheet, 1).indexOf(performer) >= 0) return; sheet.getRange(Math.max(2, sheet.getLastRow() + 1), 1).setValue(performer); SpreadsheetApp.flush(); }
function pfhPersonnelNames_() { try { return typeof listPersonnel === 'function' ? pfhUnique_(listPersonnel({}).filter(function (p) { return p.active !== false; }).map(function (p) { return p.fullName; })) : []; } catch (error) { return []; } }
function pfhFindReceipt_(sheet, receipt) { const last = sheet.getLastRow(); if (last < 5) return 0; const notes = sheet.getRange(5, 1, last - 4, 1).getNotes(); for (let index = 0; index < notes.length; index += 1) if (notes[index][0] === receipt) return index + 5; return 0; }
function pfhDate_(value) { if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) throw new Error('Укажите дату записи.'); const date = new Date(String(value) + 'T12:00:00'); if (isNaN(date.getTime()) || date.getTime() > new Date().getTime() + 86400000) throw new Error('Дата не может быть в будущем.'); return date; }
function pfhText_(value, maxLength, label) { const text = String(value || '').trim(); if (!text) throw new Error(label + ': заполните поле.'); if (text.length > maxLength) throw new Error(label + ': слишком длинное значение.'); return text; }
function pfhUnique_(values) { const seen = {}; return values.map(function (value) { return String(value || '').trim(); }).filter(function (value) { if (!value || seen[value]) return false; seen[value] = true; return true; }); }
function pfhMaintenanceStats_(records) { const byMachine = {}; records.forEach(function (record) { byMachine[record.machine] = (byMachine[record.machine] || 0) + 1; }); return { total: records.length, machinesWithRecords: Object.keys(byMachine).length, byMachine: byMachine }; }

