/**
 * Дополнение к уже установленной автоматизации журнала контроля весов.
 * Файл не переименовывает таблицу, листы и столбцы и не перемещает их.
 * Перед публикацией необходимо, чтобы в проекте уже была функция writeScaleRecord(payload).
 */

const PFH_V2_SPREADSHEET_ID = "1An019JRwrya4wl9EtqY4zNELfRNzaq26sidhQce3Tc8";
const PFH_V2_SHEET_NAME = "Контроль 50г";
const PFH_V2_HEADER_ROW = 6;
const PFH_V2_DATA_START_ROW = PFH_V2_HEADER_ROW + 1;
const PFH_V2_VISIBLE_COLUMN_COUNT = 10;
const PFH_V2_META_START_COLUMN = 27; // AA
const PFH_V2_META_COLUMN_COUNT = 6; // AA:AF
const PFH_V2_ANNULLED_PATTERN = /^\[АННУЛИРОВАНО:\s*(.*?)\](?:\s*([\s\S]*))?$/;
const PFH_PERSONNEL_SPREADSHEET_ID = "1r1opRywv4upVl4oMrUlOqmRsjAuETUu3-JFMUqjRu04";
const PFH_PERSONNEL_SHEET_NAME = "Персонал";
const PFH_PERSONNEL_HEADER_ROW = 5;

/** Единый справочник сотрудников для программы и всех журналов. */
function listPersonnel() {
  const sheet = pfhPersonnelSheet_();
  const count = Math.max(0, sheet.getLastRow() - PFH_PERSONNEL_HEADER_ROW);
  if (!count) return { ok: true, personnel: [] };
  const values = sheet.getRange(PFH_PERSONNEL_HEADER_ROW + 1, 1, count, 16).getValues();
  return { ok: true, personnel: values.filter(row => String(row[0]).trim()).map(pfhPersonnelFromRow_) };
}

/** Добавляет или обновляет только строку справочника, не меняя файл и структуру. */
function savePersonnel(input) {
  const payload = input || {};
  const fullName = String(payload.fullName || "").trim();
  if (fullName.length < 2) throw new Error("Укажите имя и фамилию");
  const sheet = pfhPersonnelSheet_();
  const count = Math.max(0, sheet.getLastRow() - PFH_PERSONNEL_HEADER_ROW);
  const names = count ? sheet.getRange(PFH_PERSONNEL_HEADER_ROW + 1, 1, count, 1).getDisplayValues().flat().map(String) : [];
  const original = String(payload.originalFullName || fullName).trim();
  const position = names.findIndex(name => name.trim() === original);
  const row = position >= 0 ? PFH_PERSONNEL_HEADER_ROW + 1 + position : Math.max(sheet.getLastRow() + 1, PFH_PERSONNEL_HEADER_ROW + 1);
  const isPacker = String(payload.role || "").trim() === "packer";
  sheet.getRange(row, 1, 1, 6).setValues([[fullName, String(payload.role || "").trim(), String(payload.shift || "").trim(), isPacker ? String(payload.pakNumber || "").trim() : "", isPacker ? String(payload.pakCode || "").trim() : "", payload.active === false ? "Не работает" : "Работает"]]);
  const priorPrivate = sheet.getRange(row, 13, 1, 4).getValues()[0];
  const has = (name) => Object.prototype.hasOwnProperty.call(payload, name);
  sheet.getRange(row, 13, 1, 4).setValues([[
    has("birthday") ? pfhPersonnelDateOrEmpty_(payload.birthday) : priorPrivate[0],
    has("hireDate") ? pfhPersonnelDateOrEmpty_(payload.hireDate) : priorPrivate[1],
    has("phone") ? String(payload.phone || "").trim() : priorPrivate[2],
    has("email") ? String(payload.email || "").trim() : priorPrivate[3]
  ]]);
  sheet.getRange(row, 13, 1, 2).setNumberFormat("dd.MM.yyyy");
  SpreadsheetApp.flush();
  return { ok: true, employee: pfhPersonnelFromRow_([fullName, payload.role, payload.shift, payload.pakNumber, payload.pakCode, payload.active === false ? "Не работает" : "Работает", "", "", "", "", "", "", payload.birthday, payload.hireDate, payload.phone, payload.email]) };
}

function pfhPersonnelSheet_() {
  const spreadsheet = SpreadsheetApp.openById(PFH_PERSONNEL_SPREADSHEET_ID);
  const sheet = spreadsheet.getSheetByName(PFH_PERSONNEL_SHEET_NAME);
  if (!sheet) throw new Error(`Лист «${PFH_PERSONNEL_SHEET_NAME}» не найден`);
  return sheet;
}

function pfhPersonnelFromRow_(row) {
  const name = String(row[0] || "").trim();
  const role = pfhPersonnelRole_(row[1]);
  const shiftTeamId = String(row[2] || "").trim() === "Смена B" ? "shift-team-b" : "shift-team-a";
  return { id: `person-${Utilities.base64EncodeWebSafe(name).replace(/=+$/g, "")}`, fullName: name, role: role, shiftTeamId: shiftTeamId, active: String(row[5] || "").trim() !== "Не работает", pakNumber: String(row[3] || "").trim(), pakCode: String(row[4] || "").trim(), birthday: pfhV2Date_(row[12]), hireDate: pfhV2Date_(row[13]), phone: String(row[14] || "").trim(), email: String(row[15] || "").trim() };
}

function pfhPersonnelDateOrEmpty_(value) {
  return String(value || "").trim() ? new Date(`${String(value).trim()}T12:00:00`) : "";
}

function pfhPersonnelRole_(value) {
  const label = String(value || "").trim();
  return ({ "Старший механик": "senior-mechanic", "Механик": "mechanic", "Механик-оператор": "mechanic-operator", "Упаковщик": "packer" })[label] || "mechanic-operator";
}

/** Возвращает все записи, доступные программе. */
function listScaleRecords() {
  const sheet = pfhV2Sheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow < PFH_V2_DATA_START_ROW) return { ok: true, records: [] };

  const rowCount = lastRow - PFH_V2_DATA_START_ROW + 1;
  const visible = sheet.getRange(PFH_V2_DATA_START_ROW, 1, rowCount, PFH_V2_VISIBLE_COLUMN_COUNT).getValues();
  const metadata = sheet.getRange(PFH_V2_DATA_START_ROW, PFH_V2_META_START_COLUMN, rowCount, PFH_V2_META_COLUMN_COUNT).getValues();
  const records = [];

  for (let index = 0; index < rowCount; index += 1) {
    const record = pfhV2Record_(visible[index], metadata[index]);
    if (record) records.push(record);
  }
  return { ok: true, records: records };
}

/**
 * Обёртка над проверенной writeScaleRecord: добавляет чтение полной записи
 * и безопасное аннулирование без удаления строки.
 */
function writeScaleRecordV2(payload) {
  if (typeof writeScaleRecord !== "function") {
    throw new Error("В проекте отсутствует функция writeScaleRecord");
  }

  const next = Object.assign({}, payload || {});
  if (next.operation === "annul") {
    const reason = String(next.annulReason || "").trim();
    if (!reason) throw new Error("Укажите причину аннулирования");
    const cleanNote = String(next.note || "").replace(PFH_V2_ANNULLED_PATTERN, "$2").trim();
    next.note = `[АННУЛИРОВАНО: ${reason}]${cleanNote ? ` ${cleanNote}` : ""}`;
  }

  const result = writeScaleRecord(next);
  SpreadsheetApp.flush();

  if (result && result.conflict) {
    return Object.assign({}, result, {
      current: pfhV2FindRecord_(next.recordId) || result.current || null
    });
  }

  const recordId = next.recordId || (result && (result.recordId || (result.record && result.record.recordId)));
  const record = pfhV2FindRecord_(recordId);
  if (!record) throw new Error("Google сохранил данные, но запись не найдена для ответа");
  return { ok: true, record: record };
}

function pfhV2FindRecord_(recordId) {
  if (!recordId) return null;
  const sheet = pfhV2Sheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow < PFH_V2_DATA_START_ROW) return null;
  const rowCount = lastRow - PFH_V2_DATA_START_ROW + 1;
  const ids = sheet.getRange(PFH_V2_DATA_START_ROW, PFH_V2_META_START_COLUMN, rowCount, 1).getValues();
  for (let index = 0; index < ids.length; index += 1) {
    if (String(ids[index][0]) !== String(recordId)) continue;
    const row = PFH_V2_DATA_START_ROW + index;
    const visible = sheet.getRange(row, 1, 1, PFH_V2_VISIBLE_COLUMN_COUNT).getValues()[0];
    const metadata = sheet.getRange(row, PFH_V2_META_START_COLUMN, 1, PFH_V2_META_COLUMN_COUNT).getValues()[0];
    return pfhV2Record_(visible, metadata);
  }
  return null;
}

function pfhV2Record_(visible, metadata) {
  const recordId = String(metadata[0] || "").trim();
  if (!recordId) return null;
  const rawNote = String(visible[9] || "").trim();
  const annulled = rawNote.match(PFH_V2_ANNULLED_PATTERN);
  return {
    recordId: recordId,
    entryDate: pfhV2Date_(visible[0]),
    scale: String(visible[1] || ""),
    nominal: pfhV2Number_(visible[2]),
    fact: pfhV2Number_(visible[3]),
    deviation: pfhV2Number_(visible[4]),
    condition: String(visible[5] || ""),
    result: String(visible[6] || ""),
    author: String(visible[7] || ""),
    shift: String(visible[8] || ""),
    note: annulled ? String(annulled[2] || "").trim() : rawNote,
    status: annulled ? "Аннулировано" : "Действует",
    annulReason: annulled ? String(annulled[1] || "").trim() : null,
    version: Number(metadata[1] || 0),
    createdAt: pfhV2Timestamp_(metadata[2]),
    updatedAt: pfhV2Timestamp_(metadata[3]),
    updatedBy: String(metadata[4] || visible[7] || ""),
    requestId: String(metadata[5] || "")
  };
}

function pfhV2Sheet_() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  if (!spreadsheet || spreadsheet.getId() !== PFH_V2_SPREADSHEET_ID) {
    throw new Error("Скрипт открыт не из рабочей таблицы журнала");
  }
  const sheet = spreadsheet.getSheetByName(PFH_V2_SHEET_NAME);
  if (!sheet) throw new Error(`Лист «${PFH_V2_SHEET_NAME}» не найден`);
  return sheet;
}

function pfhV2Date_(value) {
  if (value instanceof Date && !isNaN(value.getTime())) {
    return Utilities.formatDate(value, "Europe/Vilnius", "yyyy-MM-dd");
  }
  const text = String(value || "").trim();
  const match = text.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
  return match ? `${match[3]}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}` : text;
}

function pfhV2Timestamp_(value) {
  if (value instanceof Date && !isNaN(value.getTime())) return value.toISOString();
  return String(value || "").trim() || null;
}

function pfhV2Number_(value) {
  const number = Number(String(value).replace(",", "."));
  return Number.isFinite(number) ? number : 0;
}
