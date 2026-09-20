const KEY = "googleWorkforceV1";
const empty = () => ({ personnel: [], shiftTeams: [], attendance: [], vacations: [], years: [], ready: false });
export class WorkforceRepository {
  constructor(store, provider, actor = () => ({})) {
    this.store = store; this.provider = provider; this.actor = actor; this.serial = Promise.resolve(); this.lastError = null;
  }
  exclusive(fn) {
    const run = () => globalThis.navigator?.locks ? navigator.locks.request("packaging-workforce", fn) : fn();
    const result = this.serial.then(run, run); this.serial = result.catch(() => {}); return result;
  }
  async load() { return this.store.preference(KEY, { confirmed: empty(), pending: [], lastSync: null }); }
  async snapshot() {
    const data = await this.load(), view = structuredClone(data.confirmed);
    for (const op of data.pending) {
      const list = view[op.kind], index = list.findIndex(x => x.id === op.record.id);
      const value = { ...op.record, syncStatus: op.status };
      if (index >= 0) list[index] = value; else list.push(value);
    }
    return { ...view, pending: data.pending, lastSync: data.lastSync, syncError: this.lastError };
  }
  async initialize() { try { await this.sync(); } catch (e) { this.lastError = e.message; } return this.snapshot(); }
  async save(kind, record) {
    return this.exclusive(async () => {
      if (!this.provider.writesEnabled) throw new Error("Запись в Google пока выключена в настройках рабочего места");
      const data = await this.load();
      if (!data.confirmed.ready) throw new Error("Сначала загрузите журналы из Google. Старые локальные данные не отправляются автоматически.");
      const actor = this.actor();
      if (!actor.performer) throw new Error("Выберите, кто вносит запись");
      const prior = data.pending.find(o => o.kind === kind && o.record.id === record.id);
      if (prior?.attempted || (prior && prior.status !== "pending")) throw new Error("Для этой записи уже есть отправка или конфликт. Сначала выполните синхронизацию.");
      if (prior) prior.record = record;
      else data.pending.push({ requestId: crypto.randomUUID(), kind, record, expectedRevision: data.confirmed[kind].find(x => x.id === record.id)?.revision ?? "empty", actor, status: "pending", attempted: false });
      await this.store.setPreference(KEY, data);
      return record;
    });
  }
  async sync() {
    return this.exclusive(async () => {
      const data = await this.load();
      for (const op of data.pending) {
        if (op.status !== "pending") continue;
        op.attempted = true;
        await this.store.setPreference(KEY, data);
        try {
          const result = await this.provider.write(op);
          const index = data.confirmed[op.kind].findIndex(x => x.id === result.record.id);
          if (index < 0) data.confirmed[op.kind].push(result.record); else data.confirmed[op.kind][index] = result.record;
          op.status = "sent";
        } catch (error) {
          this.lastError = error.message;
          if (error.conflict || error.status === 409) op.status = "conflict";
          else if ([400, 403, 422].includes(error.status)) op.status = "error";
          else { await this.store.setPreference(KEY, data); throw error; }
          op.error = error.message;
        }
        data.pending = data.pending.filter(item => item.status !== "sent");
        await this.store.setPreference(KEY, data);
      }
      const remote = await this.provider.snapshot();
      if (!Array.isArray(remote.personnel) || !Array.isArray(remote.shiftTeams) || !Array.isArray(remote.attendance) || !Array.isArray(remote.vacations)) throw new Error("Google вернул неполный список журналов");
      data.confirmed = { ...remote, ready: true };
      data.lastSync = new Date().toISOString(); this.lastError = null;
      await this.store.setPreference(KEY, data);
      return this.snapshot();
    });
  }
  async acceptRemote(requestId) {
    return this.exclusive(async () => {
      const data = await this.load();
      const item = data.pending.find(o => o.requestId === requestId);
      if (!item || !["conflict", "error"].includes(item.status)) throw new Error("Нет конфликта для разрешения");
      // Keep the rejected draft in local audit history; only the pending overlay is removed.
      const history = await this.store.preference("workforceRejectedDrafts", []);
      await this.store.setPreference("workforceRejectedDrafts", [...history, { ...item, resolvedAt: new Date().toISOString() }]);
      data.pending = data.pending.filter(o => o.requestId !== requestId);
      await this.store.setPreference(KEY, data);
    });
  }
}
