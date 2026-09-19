import { getVilniusDate, makeId, validateScaleCheck } from "../domain/scale-check.js";

export class JournalService {
  constructor(repository, journal) {
    this.repository = repository;
    this.journal = journal;
  }

  list() {
    return this.repository.list();
  }

  async create(input, account) {
    const values = validateScaleCheck(input, this.journal);
    return this.#createValidated(values, account);
  }

  async createBatch(inputs, account) {
    if (!Array.isArray(inputs) || inputs.length === 0) {
      throw new Error("Добавьте хотя бы одно показание");
    }
    const values = inputs.map(input => validateScaleCheck(input, this.journal));
    const records = [];
    for (const item of values) records.push(await this.#createValidated(item, account));
    return records;
  }

  async #createValidated(values, account) {
    const now = new Date().toISOString();
    const record = {
      id: makeId("scale"),
      journalId: this.journal.id,
      ...values,
      status: "Действует",
      annulReason: null,
      version: 0,
      createdAt: now,
      createdBy: values.performer,
      updatedAt: now,
      updatedBy: values.performer,
      source: "local"
    };
    return this.repository.save(record, {
      type: "create",
      expectedVersion: 0,
      actor: `${values.performer} (${account.title})`
    });
  }

  async update(id, input, account) {
    const current = await this.repository.get(id);
    if (!current) throw new Error("Запись не найдена");
    if (current.status === "Аннулировано") throw new Error("Аннулированную запись нельзя изменять");
    const values = validateScaleCheck(input, this.journal);
    return this.repository.save({ ...current, ...values }, {
      type: "update",
      expectedVersion: current.version,
      actor: `${values.performer} (${account.title})`
    });
  }

  async annul(id, reason, performer, account) {
    const current = await this.repository.get(id);
    if (!current) throw new Error("Запись не найдена");
    if (!reason?.trim()) throw new Error("Укажите причину аннулирования");
    return this.repository.save({
      ...current,
      status: "Аннулировано",
      annulReason: reason.trim(),
      performer
    }, {
      type: "annul",
      expectedVersion: current.version,
      actor: `${performer} (${account.title})`
    });
  }

  emptyForm() {
    return {
      date: getVilniusDate(),
      scaleName: this.journal.scaleOptions[0] ?? "",
      actual: "",
      condition: "Рабочие",
      performer: "",
      note: ""
    };
  }
}
