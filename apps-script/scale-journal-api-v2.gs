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
