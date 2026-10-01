/** Add this file to the SAME Apps Script project as scale-journal-api-v2.gs.
 * Requires https://www.googleapis.com/auth/spreadsheets (not currentonly).
 * Google Sheets owns the data. This API serializes program writers with one script lock.
 */
const WF_BOOKS = Object.freeze({
  personnel: '1r1opRywv4upVl4oMrUlOqmRsjAuETUu3-JFMUqjRu04',
  attendance: '1eJphWAgaxNb5N--tDrwv4uTzmiAs19NOLSAQlSn3dk0',
  vacations: '1zenc0sBGtD8KHQdrBxULsoA9jSaUcZeW83XIiz5YxSo'
});
// Дневные журналы, в которых месяц — самостоятельный видимый блок. Не
// включаем сюда обычные журналы событий: одна колонка даты сама по себе не
// означает, что пользователю нужно сворачивать историю по месяцам.
const WF_MONTHLY_JOURNALS = Object.freeze([
  {
    spreadsheetId: '1n7OfVi8__XWRJhj5jtlRUbrU6O9wGLmlDDf0e9-UKoI',
    sheets: [{ name: 'Лист', firstDataRow: 6, dateColumn: 1, columnCount: 12 }]
  },
  {
    spreadsheetId: '1zHYsa1pO7xLuSbBC43J_IPChlVfZaxt4L_rI9MtKwqA',
    sheets: [
      { name: 'Учет продукции 1', firstDataRow: 5, dateColumn: 2, columnCount: 18 },
      { name: 'Учет продукции 2', firstDataRow: 2, dateColumn: 1, columnCount: 18 }
    ]
  }
]);
const WF_YEARS = [2025, 2026, 2027, 2028, 2029];
const WF_ROLES = { 'head-of-area':'Администрация', 'production-manager':'Начальник производства', administrator:'Администратор', 'warehouse-manager':'Начальник склада', 'senior-mechanic':'Старший механик', mechanic:'Механик', 'mechanic-operator':'Механик-оператор', packer:'Упаковщик' };
const WF_STATUSES = ['Не запланирован','Запланирован','Согласован','Использован','Аннулирован'];
const WF_ABSENCE_CODES = ['A','L','NS','N','MA','NA','PA','G','AV','PV','M','TN','D','SK','VV','PB','ND','NP','NN'];
const WF_ATTENDANCE_CODES = ['K'].concat(WF_ABSENCE_CODES);

/**
 * Запускается один раз владельцем скрипта после публикации новой версии.
 * Устанавливает только триггер открытия табеля и динамическое оформление
 * текущего дня. Данные, формулы и существующие правила таблицы не меняет.
 */
function wfInstallTimesheetOpenTrigger() {
  const book = SpreadsheetApp.openById(WF_BOOKS.attendance);
  ScriptApp.getProjectTriggers()
    .filter(trigger => trigger.getHandlerFunction() === 'wfOnTimesheetOpen')
    .forEach(trigger => ScriptApp.deleteTrigger(trigger));
  ScriptApp.newTrigger('wfOnTimesheetOpen').forSpreadsheet(book).onOpen().create();
  wfSetCurrentAttendanceView_(book);
  return { ok: true, message: 'Триггер табеля установлен. При открытии будет показан текущий месяц и день.' };
}

/** Установочный триггер Google Sheets: показываем актуальный месяц и день. */
function wfOnTimesheetOpen(event) {
  const book = event && event.source;
  if (!book || book.getId() !== WF_BOOKS.attendance) return;
  wfSetCurrentAttendanceView_(book);
}

/** Ручная проверка того же поведения без изменения записей табеля. */
function wfRefreshTimesheetView() {
  return wfSetCurrentAttendanceView_(SpreadsheetApp.openById(WF_BOOKS.attendance));
}

// Имя сохранено для уже созданного триггера Google Apps Script.
function wfRefreshTimesheetViewV2() {
  return wfRefreshTimesheetView();
}

function wfSetCurrentAttendanceViewV2_(book) {
  return wfSetCurrentAttendanceView_(book);
}

// Имя сохранено для уже созданного триггера Google Apps Script.
function wfRefreshTimesheetViewV3() {
  return wfRefreshTimesheetView();
}

function wfSetCurrentAttendanceViewV3_(book) {
  return wfSetCurrentAttendanceView_(book);
}

// Имя сохранено для уже созданного триггера Google Apps Script.
function wfRefreshTimesheetViewV4() {
  return wfRefreshTimesheetView();
}

function wfSetCurrentAttendanceViewV4_(book) {
  return wfSetCurrentAttendanceView_(book);
}

// Имя сохранено для уже созданного триггера Google Apps Script.
function wfRefreshTimesheetViewV5() {
  return wfRefreshTimesheetView();
}

function wfSetCurrentAttendanceViewV5_(book) {
  return wfSetCurrentAttendanceView_(book);
}

// Открываем текущий месяц, но оставляем экран в начале листа: так видны
// компактные строки всех месяцев и раскрытый блок текущего месяца.
function wfRefreshTimesheetViewV6() {
  return wfSetCurrentAttendanceViewV6_(SpreadsheetApp.openById(WF_BOOKS.attendance));
}

function wfSetCurrentAttendanceViewV6_(book) {
  const result = wfSetCurrentAttendanceView_(book);
  if (!result || !result.ok) return result;
  const sheet = book.getSheetByName(String(wfTodayParts_().year));
  if (!sheet) return result;
  book.setActiveSheet(sheet);
  book.setActiveRange(sheet.getRange(1, 1));
  return result;
}

function wfSetCurrentAttendanceView_(book) {
  const now = wfTodayParts_();
  const sheet = book.getSheetByName(String(now.year));
  if (!sheet) return { ok: false, message: 'Лист текущего года не найден.' };
  const monthRows = wfEnsureTimesheetMonthGroups_(sheet, now.year);
  const row = monthRows.get(now.month) || 6;
  monthRows.forEach((groupRow, month) => {
    const group = sheet.getRowGroup(groupRow, 1);
    if (group) month === now.month ? group.expand() : group.collapse();
  });
  const monthNames = wfTimesheetMonthNames_();
  sheet.getRange(4, 1).setValue(`${monthNames[now.month - 1]} ${now.year}`);
  wfApplyTimesheetTodayFormatting_(book);
  book.setActiveSheet(sheet);
  book.setActiveRange(sheet.getRange(1, 1));
  return { ok: true, month: now.month, day: now.day, row };
}

/**
 * Создаёт именно такую структуру, как в производственном образце:
 * отдельная строка «Месяц Год» всегда видна, а строки сотрудников
 * находятся непосредственно под ней в сворачиваемой группе.
 *
 * Процедура рассчитана на уже заполненный табель и идемпотентна:
 * после первого запуска она лишь управляет состоянием существующих групп.
 */
function wfEnsureTimesheetMonthGroups_(sheet, year) {
  // V8 — идентификатор уже созданной в рабочем табеле структуры.
  // Благодаря этому повторное открытие не добавляет строки-разделители заново.
  const propertyKey = `wf-timesheet-month-groups-v8-${year}`;
  const properties = PropertiesService.getScriptProperties();
  if (properties.getProperty(propertyKey) !== 'ready') {
    wfRemoveTimesheetRowGroups_(sheet);
    const initialBlocks = wfTimesheetMonthBlocks_(sheet);
    const monthNames = wfTimesheetMonthNames_();

    // Вставляем снизу вверх, чтобы номера ещё не обработанных строк не менялись.
    initialBlocks.slice().reverse().forEach(block => {
      const preceding = sheet.getRange(block.start - 1, 1, 1, 2).getDisplayValues()[0];
      const expectedTitle = `${monthNames[block.month - 1]} ${year}`;
      const alreadyHasHeader = !String(preceding[0] || '').trim() && String(preceding[1] || '').trim() === expectedTitle;
      if (!alreadyHasHeader) {
        sheet.insertRowsBefore(block.start, 1);
        wfFormatTimesheetMonthHeader_(sheet, block.start, expectedTitle);
      } else {
        wfFormatTimesheetMonthHeader_(sheet, block.start - 1, expectedTitle);
      }
    });

    // После вставки строк повторно находим фактические блоки сотрудников.
    wfTimesheetMonthBlocks_(sheet).forEach(block => {
      const headerRow = block.start - 1;
      wfFormatTimesheetMonthHeader_(sheet, headerRow, `${monthNames[block.month - 1]} ${year}`);
      sheet.getRange(block.start, 1, block.end - block.start + 1, 1).shiftRowGroupDepth(1);
    });
    properties.setProperty(propertyKey, 'ready');
  }

  const rows = new Map();
  wfTimesheetMonthBlocks_(sheet).forEach(block => rows.set(block.month, block.start));
  return rows;
}

function wfTimesheetMonthBlocks_(sheet) {
  const firstRow = 6;
  const values = sheet.getRange(firstRow, 1, Math.max(1, sheet.getLastRow() - firstRow + 1), 1).getValues().flat();
  const blocks = [];
  let active = null;
  values.forEach((value, index) => {
    const row = firstRow + index;
    const month = Number(value);
    if (month < 1 || month > 12) {
      if (active) { active.end = row - 1; blocks.push(active); active = null; }
      return;
    }
    if (!active || active.month !== month) {
      if (active) { active.end = row - 1; blocks.push(active); }
      active = { month, start: row, end: row };
    } else {
      active.end = row;
    }
  });
  if (active) blocks.push(active);
  return blocks;
}

function wfRemoveTimesheetRowGroups_(sheet) {
  // Старые попытки могли оставить вложенные группы. Удаляем только контуры
  // строк этого листа, не трогая данные, формулы и формат ячеек.
  for (let pass = 0; pass < 12; pass += 1) {
    let removed = false;
    for (let row = sheet.getLastRow(); row >= 6; row -= 1) {
      const depth = sheet.getRowGroupDepth(row);
      if (!depth) continue;
      const group = sheet.getRowGroup(row, depth);
      if (group) { group.remove(); removed = true; }
    }
    if (!removed) return;
  }
}

function wfFormatTimesheetMonthHeader_(sheet, row, title) {
  const range = sheet.getRange(row, 1, 1, 34);
  sheet.getRange(row, 1).clearContent();
  sheet.getRange(row, 2).setValue(title);
  range.setBackground('#D9EAF7').setFontColor('#174A73').setFontWeight('bold');
  sheet.setRowHeight(row, 28);
}

function wfTimesheetMonthNames_() {
  return ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
}

function wfApplyTimesheetTodayFormatting_(book) {
  const now = wfTodayParts_();
  const sheet = book.getSheetByName(String(now.year));
  if (!sheet) return;
  const firstDayColumn = 4, lastDayColumn = 34;
  const dataRange = sheet.getRange(6, firstDayColumn, Math.max(1, sheet.getMaxRows() - 5), lastDayColumn - firstDayColumn + 1);
  const headerRange = sheet.getRange(5, firstDayColumn, 1, lastDayColumn - firstDayColumn + 1);
  const dataFormula = '=AND(VALUE($A6)=MONTH(TODAY()),VALUE(D$5)=DAY(TODAY()))';
  const headerFormula = '=VALUE(D$5)=DAY(TODAY())';
  const isTimesheetTodayRule = rule => {
    const condition = rule.getBooleanCondition();
    if (!condition || condition.getCriteriaType() !== SpreadsheetApp.BooleanCriteria.CUSTOM_FORMULA) return false;
    const formula = String(condition.getCriteriaValues()[0] || '');
    return [
      '=AND($A6=MONTH(TODAY()),D$5=DAY(TODAY()))',
       '=AND($A6=MONTH(TODAY()),VALUE(D$5)=DAY(TODAY()))',
      '=D$5=DAY(TODAY())',
      dataFormula,
      headerFormula
    ].includes(formula);
  };
  const rules = sheet.getConditionalFormatRules().filter(rule => !isTimesheetTodayRule(rule));
  rules.push(
    SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied(dataFormula)
      .setBackground('#E6F7ED')
      .setFontColor('#075B32')
      .setBold(true)
      .setRanges([dataRange])
      .build(),
    SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied(headerFormula)
      .setBackground('#00A86B')
      .setFontColor('#FFFFFF')
      .setBold(true)
      .setRanges([headerRange])
      .build()
  );
  sheet.setConditionalFormatRules(rules);
}

/**
 * Один раз устанавливает обработчики открытия для дневных журналов.
 * При следующем открытии журнала открыт только актуальный месяц; прошлые
 * месяцы остаются видимыми одной строкой-заголовком с кнопкой «+» слева.
 */
function wfInstallMonthlyJournalOpenTriggers() {
  const ids = new Set(WF_MONTHLY_JOURNALS.map(journal => journal.spreadsheetId));
  ScriptApp.getProjectTriggers()
    .filter(trigger => trigger.getHandlerFunction() === 'wfOnMonthlyJournalOpen')
    .forEach(trigger => ScriptApp.deleteTrigger(trigger));
  ids.forEach(id => {
    const book = SpreadsheetApp.openById(id);
    ScriptApp.newTrigger('wfOnMonthlyJournalOpen').forSpreadsheet(book).onOpen().create();
    wfRefreshMonthlyJournalView_(book);
  });
  return { ok: true, journals: ids.size, message: 'Для дневных журналов установлено сворачивание по месяцам.' };
}

/** Установочный обработчик: не меняет записи, только структуру показа. */
function wfOnMonthlyJournalOpen(event) {
  const book = event && event.source;
  if (!book || !WF_MONTHLY_JOURNALS.some(journal => journal.spreadsheetId === book.getId())) return;
  wfRefreshMonthlyJournalView_(book);
}

/** Ручной запуск для проверки после сохранения скрипта. */
function wfRefreshMonthlyJournalViews() {
  return WF_MONTHLY_JOURNALS.map(journal => wfRefreshMonthlyJournalView_(SpreadsheetApp.openById(journal.spreadsheetId)));
}

function wfRefreshMonthlyJournalView_(book) {
  const journal = WF_MONTHLY_JOURNALS.find(item => item.spreadsheetId === book.getId());
  if (!journal) return { ok: false, message: 'Журнал не настроен для месячного представления.' };
  const currentKey = Utilities.formatDate(new Date(), 'Europe/Vilnius', 'yyyy-MM');
  const results = journal.sheets.map(config => {
    const sheet = book.getSheetByName(config.name);
    if (!sheet) return { sheet: config.name, ok: false, message: 'Лист не найден.' };
    const blocks = wfEnsureMonthlyJournalGroups_(sheet, config);
    blocks.forEach(block => {
      const group = sheet.getRowGroup(block.start, 1);
      if (group) block.key === currentKey ? group.expand() : group.collapse();
    });
    return { sheet: config.name, ok: true, months: blocks.length, currentMonth: currentKey };
  });
  return { ok: true, results };
}

/**
 * Ставит перед каждым непрерывным блоком дат отдельную синюю строку месяца
 * и группирует только следующие строки данных. Заголовки не объединяются,
 * поэтому чтение и запись программы по датам продолжают работать.
 */
function wfEnsureMonthlyJournalGroups_(sheet, config) {
  // Каждый запуск проверяет и новые месяцы. Поэтому первая запись октября
  // получает свой заголовок автоматически, а не ждёт ручной настройки.
  wfMonthlyJournalBlocks_(sheet, config).slice().reverse().forEach(block => {
    const existingHeaderRow = wfExistingMonthHeaderRow_(sheet, block.start, block.key, config.dateColumn);
    if (existingHeaderRow) return;
    sheet.insertRowsBefore(block.start, 1);
    wfFormatJournalMonthHeader_(sheet, block.start, wfJournalMonthTitle_(block.key), config);
  });

  // После вставки находим реальные строки ещё раз и создаём только
  // отсутствующие группы. Уже существующие группы не вкладываются повторно.
  wfMonthlyJournalBlocks_(sheet, config).forEach(block => {
    const headerRow = wfExistingMonthHeaderRow_(sheet, block.start, block.key, config.dateColumn) || block.start - 1;
    wfFormatJournalMonthHeader_(sheet, headerRow, wfJournalMonthTitle_(block.key), config);
    if (!sheet.getRowGroup(block.start, 1)) sheet.getRange(block.start, 1, block.end - block.start + 1, 1).shiftRowGroupDepth(1);
  });
  return wfMonthlyJournalBlocks_(sheet, config);
}

function wfMonthlyJournalBlocks_(sheet, config) {
  const lastRow = sheet.getLastRow();
  if (lastRow < config.firstDataRow) return [];
  const values = sheet.getRange(config.firstDataRow, config.dateColumn, lastRow - config.firstDataRow + 1, 1).getValues().flat();
  const blocks = [];
  let current = null;
  values.forEach((value, index) => {
    const row = config.firstDataRow + index;
    const key = wfJournalMonthKey_(value);
    if (!key) return;
    if (!current || current.key !== key) {
      if (current) blocks.push(current);
      current = { key, start: row, end: row };
    } else {
      current.end = row;
    }
  });
  if (current) blocks.push(current);
  return blocks;
}

function wfExistingMonthHeaderRow_(sheet, dataRow, key, dateColumn) {
  // В старых журналах уже есть строка «Месяц: ...» прямо над первой
  // записью или через один пустой разделитель. Используем её, не создавая
  // дубликат и не сдвигая исторические расчёты.
  for (let row = Math.max(1, dataRow - 2); row < dataRow; row += 1) {
    const label = String(sheet.getRange(row, dateColumn).getDisplayValue() || '').trim();
    if (wfJournalMonthKeyFromLabel_(label) === key) return row;
  }
  return 0;
}

function wfFormatJournalMonthHeader_(sheet, row, title, config) {
  const range = sheet.getRange(row, 1, 1, config.columnCount);
  range.setBackground('#D9EAF7').setFontColor('#174A73').setFontWeight('bold');
  sheet.getRange(row, config.dateColumn).setValue(title);
  sheet.setRowHeight(row, 28);
}

function wfJournalMonthKey_(value) {
  if (value instanceof Date && !isNaN(value.getTime())) return Utilities.formatDate(value, 'Europe/Vilnius', 'yyyy-MM');
  const source = String(value || '').trim();
  let match = source.match(/^(\d{4})-(\d{1,2})-\d{1,2}$/);
  if (match) return `${match[1]}-${String(Number(match[2])).padStart(2, '0')}`;
  match = source.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  return match ? `${match[3]}-${String(Number(match[2])).padStart(2, '0')}` : '';
}

function wfJournalMonthKeyFromLabel_(label) {
  const source = String(label || '').trim();
  const match = source.match(/(?:Месяц:\s*)?([А-Яа-яЁё]+)\s+(\d{4})$/);
  if (!match) return '';
  const month = wfJournalMonthNames_().map(name => name.toLowerCase()).indexOf(match[1].toLowerCase()) + 1;
  return month ? `${match[2]}-${String(month).padStart(2, '0')}` : '';
}

function wfJournalMonthTitle_(key) {
  const [year, month] = String(key).split('-').map(Number);
  return `${wfJournalMonthNames_()[month - 1]} ${year}`;
}

function wfJournalMonthNames_() {
  return ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
}

function wfAttendanceMonthFirstRow_(sheet, month) {
  const count = Math.max(0, sheet.getLastRow() - 5);
  if (!count) return 0;
  return sheet.getRange(6, 1, count, 1).getValues()
    .findIndex(row => Number(row[0]) === month) + 6;
}

function wfTodayParts_() {
  const parts = Utilities.formatDate(new Date(), 'Europe/Vilnius', 'yyyy-MM-dd').split('-').map(Number);
  return { year: parts[0], month: parts[1], day: parts[2] };
}

function getWorkforceSnapshot(options) {
  const master = SpreadsheetApp.openById(WF_BOOKS.personnel);
  const teams = wfRows_(master.getSheetByName('Смены'), 8).filter(r=>r.values[6]).map(r=>wfTeam_(r.values));
  const personnel = wfRows_(master.getSheetByName('Персонал'), 16).filter(r=>r.values[7]).map(r=>wfPerson_(r.values, teams));
  const attendance = [], vacations = [];
  const timeBook = SpreadsheetApp.openById(WF_BOOKS.attendance);
  WF_YEARS.forEach(year => wfRows_(timeBook.getSheetByName(String(year)),44).forEach(row => {
    const v=row.values, employee=personnel.find(p=>p.id===String(v[38]));
    if (!employee || !Number(v[0])) return;
    const team=teams.find(t=>t.name===String(v[2])), shiftTeamId=team?team.id:(String(v[43]||'')||employee.shiftTeamId);
    for(let day=1;day<=new Date(year,Number(v[0]),0).getDate();day++) {
      const value=String(v[day+2]===null?'':v[day+2]);
      if(!value || value==='—') continue;
      const date=year+'-'+('0'+v[0]).slice(-2)+'-'+('0'+day).slice(-2);
      const overtime=String(v[42]).split(',').includes(String(day));
      const substitute=wfSubstituteForDay_(v[37],day);
      attendance.push({id:date+':'+shiftTeamId+':'+employee.id,date,employeeId:employee.id,shiftTeamId,value,overtime,substitutionReason:substitute?.reason||'',homeShiftTeamId:substitute?.homeShiftTeamId||'',revision:wfToken_([value,overtime,substitute?.reason||'',substitute?.homeShiftTeamId||'']),updatedAt:wfIso_(v[40]),updatedBy:String(v[41]||'')});
    }
  }));
  const book=SpreadsheetApp.openById(WF_BOOKS.vacations);
  WF_YEARS.forEach(year=>wfRows_(book.getSheetByName(String(year)),13).filter(r=>r.values[8]||r.values[7]).forEach(r=>vacations.push(wfVacation_(r.values,year,people))));
  return {ok:true,ready:true,personnel,shiftTeams:teams.filter(t=>t.id!=='office'),officeSchedule:teams.find(t=>t.id==='office'),attendance,vacations,years:WF_YEARS,timeZone:'Europe/Vilnius'};
}

function writeWorkforceOperation(operation) {
  const op=operation||{}, kind=op.kind, record=op.record||{}, actor=op.actor||{};
  if(!['personnel','shiftTeams','attendance','vacations'].includes(kind)) return {ok:false,status:400,message:'Неизвестный журнал'};
  if(!/^[a-zA-Z0-9-]{16,80}$/.test(String(op.requestId||''))) return {ok:false,status:400,message:'Некорректный номер операции'};
  if(op.role!=='manager' && !(op.role==='senior'&&kind==='attendance')) return {ok:false,status:403,message:'Недостаточно прав для этого журнала'};
  const lock=LockService.getScriptLock();
  if(!lock.tryLock(30000)) return {ok:false,status:409,conflict:true,message:'Другой сотрудник сохраняет запись. Обновите журнал и повторите.'};
  try {
    const master=SpreadsheetApp.openById(WF_BOOKS.personnel);
    const log=wfLog_(master), prior=log.getRange(1,1,Math.max(1,log.getLastRow()),1).createTextFinder(op.requestId).matchEntireCell(true).findNext();
    const fingerprint=wfToken_([kind,record,actor,op.expectedRevision]);
    if(prior) {
      const saved=log.getRange(prior.getRow(),1,1,4).getValues()[0];
      if(saved[1]!==fingerprint) return {ok:false,status:400,message:'Номер операции уже использован для другой записи'};
      return JSON.parse(saved[2]);
    }
    const teams=wfRows_(master.getSheetByName('Смены'),8).filter(r=>r.values[6]).map(r=>wfTeam_(r.values));
    const people=wfRows_(master.getSheetByName('Персонал'),16).filter(r=>r.values[7]).map(r=>wfPerson_(r.values,teams));
    if(!people.some(p=>p.active&&p.fullName===String(actor.performer||''))) throw new Error('Выберите исполнителя из действующего персонала');
    let result;
    if(kind==='personnel') result=wfSavePerson_(master,teams,op);
    if(kind==='shiftTeams') result=wfSaveTeam_(master,op);
    if(kind==='attendance') result=wfSaveAttendance_(people,teams,op);
    if(kind==='vacations') result=wfSaveVacation_(people,teams,op);
    if(result.conflict) return result;
    SpreadsheetApp.flush();
    log.appendRow([op.requestId,fingerprint,JSON.stringify(result),new Date()]);
    return result;
  } catch(error) {
    return {ok:false,status:400,message:String(error.message||error)};
  } finally { lock.releaseLock(); }
}

function wfSavePerson_(master,teams,op) {
 const s=master.getSheetByName('Персонал'), p=op.record;
 if(!WF_ROLES[p.role] || !teams.some(t=>t.id===p.shiftTeamId) || String(p.fullName||'').trim().length<2) throw new Error('Проверьте ФИО, должность и смену');
 const found=wfRows_(s,16).find(r=>String(r.values[7])===p.id), current=found?wfPerson_(found.values,teams):null;
 if(!wfMatches_(current,op)) return wfConflict_();
 const row=found?found.row:Math.max(6,s.getLastRow()+1), team=teams.find(t=>t.id===p.shiftTeamId);
 const isPacker=p.role==='packer', vals=[wfText_(p.fullName),WF_ROLES[p.role],team.name,isPacker?wfText_(p.pakNumber??current?.pakNumber??''):'',isPacker?wfText_(p.pakCode??current?.pakCode??''):'',p.active===false?'Не работает':'Работает',wfText_(p.note||current?.note||''),String(p.id),(Number(found?.values[8])||0)+1,new Date(),op.actor.performer,p.shiftTeamId,wfDateOrEmpty_(p.birthday||current?.birthday||''),wfDateOrEmpty_(p.hireDate||current?.hireDate||''),wfText_(p.phone||current?.phone||''),wfText_(p.email||current?.email||'')];
  s.getRange(row,1,1,16).setValues([vals]);
  s.getRange(row,13,1,2).setNumberFormat('dd.MM.yyyy');
  s.getRange(row,17,1,2).setFormulas([[
    '=IF(M'+row+'="","",DATEDIF(M'+row+',TODAY(),"Y"))',
    '=IF(N'+row+'="","",DATEDIF(N'+row+',TODAY(),"Y")&" г. "&DATEDIF(N'+row+',TODAY(),"YM")&" мес.")'
  ]]);
  return {ok:true,record:wfPerson_(vals,teams)};
}
function wfSaveTeam_(master,op) {
 const s=master.getSheetByName('Смены'), t=op.record, found=wfRows_(s,8).find(r=>String(r.values[6])===t.id);
 if(!found) throw new Error('Смена не найдена');
 const current=wfTeam_(found.values);if(!wfMatches_(current,op)) return wfConflict_();
 if(!Number.isFinite(Number(t.accountingHours))||Number(t.accountingHours)<=0||Number(t.shiftDurationHours)<Number(t.accountingHours)||Number(t.shiftDurationHours)>24)throw new Error('Проверьте часы смены');
 const values=[wfText_(t.name),wfDate_(t.anchorDate),current.cycleLengthDays,current.workDayOffsets.join(','),Number(t.shiftDurationHours),Number(t.accountingHours),current.id,(Number(found.values[7])||0)+1];
 s.getRange(found.row,1,1,8).setValues([values]);s.getRange(found.row,2).setNumberFormat('dd.MM.yyyy');
 return {ok:true,record:wfTeam_(values)};
}
function wfSaveAttendance_(people,teams,op) {
 const p=op.record, date=String(p.date||''), parsed=wfDate_(date),year=Number(date.slice(0,4)),month=Number(date.slice(5,7)),day=Number(date.slice(8,10));
 if(!WF_YEARS.includes(year)) throw new Error('Табель подготовлен на 2025–2029 годы');
  if(op.role==='senior'&&date!==Utilities.formatDate(new Date(),'Europe/Vilnius','yyyy-MM-dd')) throw new Error('Старший механик может исправлять табель только за текущий день смены. Прошлые даты исправляет Администрация.');
 const employee=people.find(e=>e.id===p.employeeId);if(!employee)throw new Error('Сотрудник не найден');
 if(employee.shiftTeamId==='office')throw new Error('В табель фасовочного участка можно вносить только сотрудников смен.');
 if(!teams.some(t=>t.id===p.shiftTeamId))throw new Error('Смена не найдена');
 if(p.id!==date+':'+p.shiftTeamId+':'+p.employeeId)throw new Error('Некорректный ID табеля');
 const value=wfAttendanceValue_(p.value);if(!value)throw new Error('Недопустимое значение табеля');
 const s=SpreadsheetApp.openById(WF_BOOKS.attendance).getSheetByName(String(year));
 const found=wfRows_(s,44).find(r=>String(r.values[38])===p.employeeId&&Number(r.values[0])===month&&(String(r.values[43]||'')===p.shiftTeamId||String(r.values[2]||'')===teams.find(t=>t.id===p.shiftTeamId)?.name));
 const currentValue=found?String(found.values[day+2]||''):'', currentOvertime=found?String(found.values[42]).split(',').includes(String(day)):false;
 const currentSubstitute=found?wfSubstituteForDay_(found.values[37],day):null;
 const revision=currentValue&&currentValue!=='—'?wfToken_([currentValue,currentOvertime,currentSubstitute?.reason||'',currentSubstitute?.homeShiftTeamId||'']):'empty';
 if(currentValue===value&&currentOvertime===Boolean(p.overtime)&&String(currentSubstitute?.reason||'')===String(p.substitutionReason||'')&&String(currentSubstitute?.homeShiftTeamId||'')===String(p.homeShiftTeamId||''))return {ok:true,record:{...p,value,overtime:p.overtime===true,substitutionReason:String(p.substitutionReason||''),homeShiftTeamId:String(p.homeShiftTeamId||''),revision,updatedBy:String(found?.values[41]||''),updatedAt:wfIso_(found?.values[40])}};
 if(revision!==op.expectedRevision)return wfConflict_();
 const row=found?found.row:Math.max(6,s.getLastRow()+1);
 if(!found){
   const vals=Array(44).fill('');vals[0]=month;vals[1]=employee.fullName;vals[2]=teams.find(t=>t.id===p.shiftTeamId).name;vals[37]=wfMergeSubstituteNote_('',day,p.substitutionReason,p.homeShiftTeamId);vals[38]=employee.id;vals[43]=p.shiftTeamId;
   for(let d=new Date(year,month,0).getDate()+1;d<=31;d++)vals[d+2]='—';
   s.getRange(row,1,1,44).setValues([vals]);
   s.getRange(row,35,1,3).setFormulas([['=SUM(D'+row+':AH'+row+')','=COUNTIF(D'+row+':AH'+row+',">0")',WF_ABSENCE_CODES.map(c=>'COUNTIF(D'+row+':AH'+row+',"'+c+'")').join('+').replace(/^/,'=')]]);
 }
 s.getRange(row,day+3).setValue(/^\d+$/.test(value)?Number(value):value);
 if(found&&p.substitutionReason)s.getRange(row,38).setValue(wfMergeSubstituteNote_(found.values[37],day,p.substitutionReason,p.homeShiftTeamId));
 const days=new Set(String(found?.values[42]||'').split(',').filter(Boolean));if(p.overtime===true)days.add(String(day));else days.delete(String(day));
 s.getRange(row,40,1,4).setValues([[(Number(found?.values[39])||0)+1,new Date(),op.actor.performer,Array.from(days).join(',')]]);
 return {ok:true,record:{...p,value,overtime:p.overtime===true,substitutionReason:String(p.substitutionReason||''),homeShiftTeamId:String(p.homeShiftTeamId||''),revision:wfToken_([value,p.overtime===true,String(p.substitutionReason||''),String(p.homeShiftTeamId||'')]),updatedBy:op.actor.performer,updatedAt:new Date().toISOString()}};
}
function wfSaveVacation_(people,teams,op) {
 const p=op.record,year=Number(p.year),person=people.find(e=>e.id===p.employeeId);
 const status=p.status==='Аннулирован'?'Аннулирован':'Запланирован';
 if(!WF_YEARS.includes(year)||!person)throw new Error('Проверьте сотрудника и год');
 if(person.shiftTeamId==='office')throw new Error('Для графика отпусков можно выбрать только сотрудника участка.');
 const start=p.startDate?wfDate_(p.startDate):'',end=p.endDate?wfDate_(p.endDate):'';
 if((start&&!end)||(!start&&end)||start>end)throw new Error('Укажите корректное начало и окончание отпуска');
 if(start&&(String(p.startDate).slice(0,4)!==String(year)||String(p.endDate).slice(0,4)!==String(year)))throw new Error('Период должен находиться в выбранном году. Переходящий отпуск разделите на две записи.');
 if(!start)throw new Error('Укажите даты отпуска');
 const s=SpreadsheetApp.openById(WF_BOOKS.vacations).getSheetByName(String(year)),found=wfRows_(s,13).find(r=>String(r.values[8])===p.id||String(r.values[7])===p.id);
 const current=found?wfVacation_(found.values,year,people):null;if(!wfMatches_(current,op))return wfConflict_();
 if(p.deleted){if(!found)throw new Error('Период отпуска не найден в Google');s.deleteRow(found.row);return {ok:true,record:{id:p.id,deleted:true}};}
 const row=found?found.row:Math.max(6,s.getLastRow()+1),days=start&&end?Math.round((end-start)/86400000)+1:'';
 const values=[person.fullName,WF_ROLES[person.role]||'',teams.find(t=>t.id===person.shiftTeamId)?.name||'',start,end,days,status,p.id];
 s.getRange(row,1,1,8).setValues([values]);s.getRange(row,4,1,2).setNumberFormat('dd.MM.yyyy');
 s.getRange(row,6).setFormula('=IF(AND(ISNUMBER(D'+row+'),ISNUMBER(E'+row+')),IF(E'+row+'>=D'+row+',E'+row+'-D'+row+'+1,"Проверьте даты"),"")');
 wfApplyVacationToAttendance_(person,teams.find(t=>t.id===person.shiftTeamId),p.startDate,p.endDate);
 return {ok:true,record:wfVacation_(values,year,people)};
}
function wfAttendanceValue_(value){const text=String(value||'').trim();if(WF_ATTENDANCE_CODES.indexOf(text)>=0)return text;const hours=Number(text.replace(',','.'));return isFinite(hours)&&hours>=0.5&&hours<=24&&Math.round(hours*2)===hours*2?String(hours):'';}
function wfApplyVacationToAttendance_(person,team,startDate,endDate){
 const book=SpreadsheetApp.openById(WF_BOOKS.attendance),from=new Date(String(startDate)+'T12:00:00Z'),to=new Date(String(endDate)+'T12:00:00Z');
 for(let cursor=new Date(from);cursor<=to;cursor.setUTCDate(cursor.getUTCDate()+1)){
  const year=cursor.getUTCFullYear(),month=cursor.getUTCMonth()+1,day=cursor.getUTCDate(),sheet=book.getSheetByName(String(year));if(!sheet)continue;
  const found=wfRows_(sheet,44).find(r=>String(r.values[38])===person.id&&Number(r.values[0])===month&&(String(r.values[43]||'')===team.id||String(r.values[2]||'')===team.name));
  const row=found?found.row:Math.max(6,sheet.getLastRow()+1),current=found?String(found.values[day+2]||''):'';
  if(!found){const values=Array(44).fill('');values[0]=month;values[1]=person.fullName;values[2]=team.name;values[38]=person.id;values[43]=team.id;for(let index=new Date(year,month,0).getDate()+1;index<=31;index++)values[index+2]='—';values[day+2]='A';sheet.getRange(row,1,1,44).setValues([values]);}
  else if(!current||current==='—')sheet.getRange(row,day+3).setValue('A');
 }
}
function wfSubstituteForDay_(note,day){
 const match=String(note||'').match(/Подменный выход \(штатная смена ([AB])\):\s*([^\n]+)/);
 if(!match)return null;
 const item=match[2].split(';').map(v=>v.trim()).find(v=>v.indexOf(String(day)+' — ')===0);
 if(!item)return null;
 return {homeShiftTeamId:'shift-team-'+match[1].toLowerCase(),reason:item.slice((String(day)+' — ').length).trim()};
}
function wfMergeSubstituteNote_(note,day,reason,homeShiftTeamId){
 if(!reason)return String(note||'');
 const homeCode=String(homeShiftTeamId||'').replace('shift-team-','').toUpperCase();
 if(!['A','B'].includes(homeCode))throw new Error('Для подменного выхода укажите штатную смену сотрудника');
 const current=String(note||'');
 const match=current.match(/Подменный выход \(штатная смена ([AB])\):\s*([^\n]+)/);
 const entries=match&&match[1]===homeCode?match[2].split(';').map(v=>v.trim()).filter(Boolean):[];
 const withoutDay=entries.filter(v=>v.indexOf(String(day)+' — ')!==0);
 withoutDay.push(String(day)+' — '+String(reason));
 withoutDay.sort((a,b)=>Number(a.split(' ')[0])-Number(b.split(' ')[0]));
 const label='Подменный выход (штатная смена '+homeCode+'): '+withoutDay.join('; ');
 return match?current.replace(match[0],label):(current?current+'\n':'')+label;
}
function wfRows_(sheet,width){if(!sheet)throw new Error('В Google отсутствует нужная вкладка');return sheet.getLastRow()<6?[]:sheet.getRange(6,1,sheet.getLastRow()-5,width).getValues().map((values,i)=>({row:i+6,values}));}
function wfPerson_(v,teams){return {id:String(v[7]),fullName:String(v[0]),role:Object.keys(WF_ROLES).find(k=>WF_ROLES[k]===v[1])||'',shiftTeamId:teams.find(t=>t.name===v[2])?.id||String(v[11]||''),active:v[5]==='Работает',note:String(v[6]||''),pakNumber:String(v[3]||''),pakCode:String(v[4]||''),birthday:wfDay_(v[12]),hireDate:wfDay_(v[13]),phone:String(v[14]||''),email:String(v[15]||''),revision:wfToken_(v),updatedAt:wfIso_(v[9])};}
function wfTeam_(v){return {id:String(v[6]),name:String(v[0]),code:v[6]==='shift-team-a'?'A':v[6]==='shift-team-b'?'B':'5/2',anchorDate:wfDay_(v[1]),cycleLengthDays:Number(v[2]),workDayOffsets:String(v[3]).split(',').map(Number),shiftDurationHours:Number(v[4]),accountingHours:Number(v[5]),active:true,revision:wfToken_(v)};}
function wfVacation_(v,year,people){const old=String(v[7]||'').indexOf('vacation:')===0&&String(v[8]||'').indexOf('vacation:')!==0,o=old?-1:0,name=String(v[0]||'').trim(),person=(people||[]).find(item=>String(item.fullName||'').trim()===name);return {id:String(v[8+o]),employeeId:String(v[9+o]||person?.id||''),year,startDate:wfDay_(v[3+o]),endDate:wfDay_(v[4+o]),days:typeof v[5+o]==='number'?v[5+o]:null,status:String(v[6+o]),note:old?'':String(v[7+o]||''),revision:wfToken_([v[0],v[1+o],v[2+o],wfDay_(v[3+o]),wfDay_(v[4+o]),v[6+o],v[7+o],v[8+o],v[9+o],v[10+o]]),updatedAt:wfIso_(v[11+o]),updatedBy:String(v[12+o]||'')};}
function wfMatches_(current,op){return (current?current.revision:'empty')===op.expectedRevision;}
function wfConflict_(){return {ok:false,status:409,conflict:true,message:'Эту запись уже изменили. Обновите данные и выберите, какие исправления сохранить.'};}
function wfToken_(v){return Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,JSON.stringify(v),Utilities.Charset.UTF_8));}
function wfDay_(v){return v instanceof Date?Utilities.formatDate(v,'Europe/Vilnius','yyyy-MM-dd'):String(v||'');}
function wfIso_(v){return v instanceof Date?v.toISOString():String(v||'');}
function wfDate_(value){const s=String(value||''),d=new Date(s+'T12:00:00Z');if(!/^\d{4}-\d{2}-\d{2}$/.test(s)||!Number.isFinite(d.getTime())||d.toISOString().slice(0,10)!==s)throw new Error('Некорректная дата');return d;}
function wfDateOrEmpty_(value){return String(value||'').trim()?wfDate_(value):'';}
function wfText_(v){const s=String(v||'').trim();if(s.length>2000||/^[=+@]/.test(s))throw new Error('Некорректный текст');return s;}
function wfLog_(book){let s=book.getSheetByName('_Синхронизация');if(!s){s=book.insertSheet('_Синхронизация');s.appendRow(['Request ID','Содержимое','Результат','Время']);s.hideSheet();}return s;}
