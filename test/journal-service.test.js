import test from "node:test";
import assert from "node:assert/strict";

import { JournalService } from "../src/services/journal-service.js";

const journal = {
  id: "scale-check-50g",
  nominal: 50,
  tolerance: 0.05,
  scaleOptions: ["WTC 600 (F1)"]
};

function validInput() {
  return {
    date: "2026-09-19",
    scaleName: "WTC 600 (F1)",
    actual: "50",
    condition: "Рабочие",
    performer: "Albert Krevski",
    note: ""
  };
}

test("домашнее исправление содержит устройство в аудите", async () => {
  let savedOptions;
  const repository = {
    async save(record, options) {
      savedOptions = options;
      return record;
    }
  };
  const service = new JournalService(repository, journal, {
    workstationId: "manager-home",
    workstationLabel: "Домашний компьютер начальника"
  });

  await service.create(validInput(), { title: "Начальник участка" });

  assert.equal(
    savedOptions.actor,
    "Albert Krevski (Начальник участка; Домашний компьютер начальника)"
  );
});

test("старые установки сохраняют прежний формат автора", async () => {
  let savedOptions;
  const repository = {
    async save(record, options) {
      savedOptions = options;
      return record;
    }
  };
  const service = new JournalService(repository, journal);

  await service.create(validInput(), { title: "Начальник участка" });

  assert.equal(savedOptions.actor, "Albert Krevski (Начальник участка)");
});
