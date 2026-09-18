import { getVilniusDate } from "../domain/scale-check.js";

export function createDemoRecords() {
  const today = getVilniusDate();
  return [
    demo("demo-1", today, 50, "Albert Krevski", "Проверка перед началом смены"),
    demo("demo-2", today, 49.98, "Vladislav Balašov", "Повторная проверка")
  ];
}

function demo(id, date, actual, performer, note) {
  const timestamp = new Date().toISOString();
  return {
    id,
    journalId: "scale-check-50g",
    date,
    scaleName: "WTC 600 (F10)",
    nominal: 50,
    actual,
    deviation: Number((50 - actual).toFixed(3)),
    condition: "Рабочие",
    result: Math.abs(actual - 50) <= 0.05 ? "В пределах допуска" : "Вне допуска",
    performer,
    note,
    status: "Действует",
    annulReason: null,
    version: 1,
    createdAt: timestamp,
    createdBy: performer,
    updatedAt: timestamp,
    updatedBy: performer,
    syncState: "synced",
    source: "demo"
  };
}
