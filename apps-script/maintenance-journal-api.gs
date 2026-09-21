// Existing journal only. Reading never changes cells or dates.
const PFH_TO_BOOK = '1SRirurDOMqyGEXj2oo_V81CQ5jKnnvg9nN8G21QAFAY';
const PFH_TO_RECEIPT = 'PFH_TO_V1:';

function listMaintenanceRecords() {
  const sheets = pfhToSheets_();
  return { ok: true, performers: pfhToPerformers_(), machines: sheets.map(function(s) { return { id: s.getName().slice(-2), title: s.getName() }; }),
    records: sheets.reduce(function(rows, s) { return rows.concat(pfhToRows_(s)); }, []) };
}

function createMaintenanceRecord(input) {
  if (PropertiesService.getScriptProperties().getProperty('PFH_TO_WRITES_ENABLED') !== 'true') throw new Error('Запись ТО в Google выключена');
  if (!input || ['manager', 'senior'].indexOf(input.role) < 0) throw new Error('Недостаточно прав');
  ['requestId', 'recordId'].forEach(function(k) { if (!/^[a-zA-Z0-9_-]{8,160}$/.test(String(input[k] || ''))) throw new Error('Некорректный идентификатор'); });
  const date = String(input.date || ''), value = new Date(date + 'T12:00:00Z');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || isNaN(value.getTime()) || value.toISOString().slice(0,10) !== date || date > Utilities.formatDate(new Date(), 'Europe/Vilnius', 'yyyy-MM-dd')) throw new Error('Некорректная дата ТО');
  const machine = String(input.machine || ''), performer = String(input.performer || '').trim(), note = String(input.note || '').trim();
  if (!/^\d{2}$/.test(machine) || !performer || note.length > 5000) throw new Error('Проверьте станок, исполнителя и примечание');
  const lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    const sheets = pfhToSheets_(), sheet = sheets.find(function(s) { return s.getName() === 'ТО ' + machine; });
    if (!sheet) throw new Error('Станок отсутствует в журнале');
    const existing = sheets.reduce(function(rows,s) { return rows.concat(pfhToRows_(s)); }, []).find(function(r) { return r.requestId === input.requestId || r.id === input.recordId; });
    if (existing) {
      if (existing.requestId !== input.requestId || existing.id !== input.recordId || existing.machine !== machine || existing.date !== date || existing.performer !== performer || existing.note !== note) throw new Error('Идентификатор уже использован для другой записи');
      return { ok: true, record: existing };
    }
    if (!listPersonnel().personnel.some(function(p) { return p.fullName === performer && p.active !== false; })) throw new Error('Исполнитель отсутствует в действующем персонале');
    if (pfhToPerformers_().indexOf(performer) < 0) throw new Error('Исполнитель отсутствует в справочнике журнала ТО');
    const row = Math.max(5, sheet.getLastRow()+1), sid = sheet.getSheetId();
    const receipt = { id: input.recordId, requestId: input.requestId, createdAt: new Date().toISOString(), workstationId: String(input.workstationId || '') };
    const serial = Math.round((Date.parse(date + 'T00:00:00Z') - Date.UTC(1899,11,30))/86400000);
    const requests = [];
    if (row > sheet.getMaxRows()) requests.push({ appendDimension: { sheetId: sid, dimension: 'ROWS', length: row-sheet.getMaxRows() } });
    // Copy only format and validation from a known data row, then atomically write the new row and receipt.
    ['PASTE_FORMAT', 'PASTE_DATA_VALIDATION'].forEach(function(type) {
      requests.push({ copyPaste: { source: { sheetId: sid, startRowIndex:4,endRowIndex:5,startColumnIndex:0,endColumnIndex:3 }, destination: { sheetId:sid,startRowIndex:row-1,endRowIndex:row,startColumnIndex:0,endColumnIndex:3 }, pasteType:type, pasteOrientation:'NORMAL' } });
    });
    requests.push({ updateCells: { start: { sheetId:sid,rowIndex:row-1,columnIndex:0 }, rows:[{values:[
      {userEnteredValue:{numberValue:serial},note:PFH_TO_RECEIPT+JSON.stringify(receipt)},
      {userEnteredValue:{stringValue:performer}}, {userEnteredValue:{stringValue:note}}
    ]}],fields:'userEnteredValue,note' } });
    requests.push({ repeatCell: { range:{sheetId:sid,startRowIndex:row-1,endRowIndex:row,startColumnIndex:0,endColumnIndex:1},cell:{userEnteredFormat:{numberFormat:{type:'DATE',pattern:'dd.MM.yyyy'}}},fields:'userEnteredFormat.numberFormat' } });
    Sheets.Spreadsheets.batchUpdate({requests:requests},PFH_TO_BOOK);
    return {ok:true,record:Object.assign({},receipt,{machine:machine,date:date,performer:performer,note:note})};
  } finally { lock.releaseLock(); }
}

function pfhToSheets_() {
  const sheets = SpreadsheetApp.openById(PFH_TO_BOOK).getSheets().filter(function(s) { return /^ТО \d{2}$/.test(s.getName()); });
  if (!sheets.length) throw new Error('В журнале не найдены листы ТО');
  sheets.forEach(function(s) {
    const h=s.getRange(4,1,1,3).getDisplayValues()[0];
    if (h[0]!=='Дата'||h[1]!=='Имя, Фамилия'||h[2]!=='Примечания') throw new Error('Изменилась структура листа '+s.getName());
  });
  return sheets.sort(function(a,b) { return a.getName().localeCompare(b.getName()); });
}
function pfhToPerformers_() {
  const sheet=SpreadsheetApp.openById(PFH_TO_BOOK).getSheetByName('Справочники');
  if (!sheet) throw new Error('Не найден справочник исполнителей ТО');
  return sheet.getRange(2,1,Math.min(999,sheet.getMaxRows()-1),1).getDisplayValues().map(function(r) { return String(r[0]).trim(); }).filter(Boolean);
}
function pfhToRows_(sheet) {
  const count = Math.max(0,sheet.getLastRow()-4); if (!count) return [];
  const values=sheet.getRange(5,1,count,3).getValues(), notes=sheet.getRange(5,1,count,1).getNotes();
  return values.map(function(row,i) {
    if (!row[0]&&!row[1]&&!row[2]) return null;
    if (!(row[0] instanceof Date)||isNaN(row[0].getTime())||!String(row[1]).trim()) throw new Error('Проверьте дату и исполнителя: '+sheet.getName()+', строка '+(i+5));
    const note=notes[i][0]||'',receipt=note.indexOf(PFH_TO_RECEIPT)===0?JSON.parse(note.slice(PFH_TO_RECEIPT.length)):{};
    return Object.assign({},receipt,{id:receipt.id||'to-'+sheet.getSheetId()+'-row-'+(i+5),machine:sheet.getName().slice(-2),date:Utilities.formatDate(row[0],'Europe/Vilnius','yyyy-MM-dd'),performer:String(row[1]).trim(),note:String(row[2]||'').trim()});
  }).filter(function(r) { return r!==null; });
}
