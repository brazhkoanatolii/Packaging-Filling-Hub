const KEY = "googleWorkforceV1";
const empty = () => ({ personnel: [], shiftTeams: [], attendance: [], vacations: [], years: [], ready: false });
export class WorkforceRepository {
  constructor(store, provider, actor = () => ({})) {
    this.store = store; this.provider = provider; this.actor = actor; this.serial = Promise.resolve(); this.syncRunning = null; this.lastError = null;
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
    if (this.syncRunning) return this.syncRunning;
    this.syncRunning = this.performSync().finally(() => { this.syncRunning = null; });
    return this.syncRunning;
  }
  async performSync() {
    // Network calls deliberately run outside exclusive().  A new local form
    // save can therefore join the queue while Google is still processing an
    // earlier item instead of waiting up to the request timeout.
    while (true) {
      const operation = await this.exclusive(async () => {
        const data = await this.load();
        const next = data.pending.find(item => item.status === "pending");
        if (!next) return null;
        next.attempted = true;
        await this.store.setPreference(KEY, data);
        return structuredClone(next);
      });
      if (!operation) break;
      try {
        const result = await this.provider.write(operation);
        await this.exclusive(async () => {
          const data = await this.load();
          const current = data.pending.find(item => item.requestId === operation.requestId);
          if (!current) return;
          const index = data.confirmed[current.kind].findIndex(item => item.id === result.record.id);
          if (index < 0) data.confirmed[current.kind].push(result.record); else data.confirmed[current.kind][index] = result.record;
          data.pending = data.pending.filter(item => item.requestId !== operation.requestId);
          await this.store.setPreference(KEY, data);
        });
      } catch (error) {
        this.lastError = error.message;
        await this.exclusive(async () => {
          const data = await this.load();
          const current = data.pending.find(item => item.requestId === operation.requestId);
          if (!current) return;
          if (error.conflict || error.status === 409) current.status = "conflict";
          else if ([400, 403, 422].includes(error.status)) current.status = "error";
          else { await this.store.setPreference(KEY, data); throw error; }
          current.error = error.message;
          await this.store.setPreference(KEY, data);
        });
      }
    }
    const remote = await this.provider.snapshot();
    if (!Array.isArray(remote.personnel) || !Array.isArray(remote.shiftTeams) || !Array.isArray(remote.attendance) || !Array.isArray(remote.vacations)) throw new Error("Google вернул неполный список журналов");
    return this.exclusive(async () => {
      const data = await this.load();
      // A browser can lose the response after Google has already saved an attendance
      // row. Treat that as delivered only when the remote row is exactly the same;
      // never discard a genuine conflicting correction.
      data.pending = data.pending.filter(operation => {
        if (operation.kind !== "attendance" || operation.status !== "conflict") return true;
        const remoteRecord = remote.attendance.find(record => record.id === operation.record.id);
        return !sameAttendance(remoteRecord, operation.record);
      });
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
  async retryMissingAttendance(requestId) {
    return this.exclusive(async () => {
      const data = await this.load();
      const item = data.pending.find(operation => operation.requestId === requestId);
      if (!item || item.kind !== "attendance" || !["conflict", "error"].includes(item.status)) throw new Error("Для этой записи повторная отправка недоступна");

      // Never overwrite a record that has appeared in Google since the conflict.
      const remote = await this.provider.snapshot();
      if (!Array.isArray(remote.attendance)) throw new Error("Google вернул неполный список табеля");
      if (remote.attendance.some(record => record.id === item.record.id)) {
        throw new Error("В Google уже есть запись за этого сотрудника и дату. Выберите версию вручную.");
      }

      item.expectedRevision = "empty";
      item.status = "pending";
      item.attempted = false;
      delete item.error;
      data.confirmed = { ...remote, ready: true };
      data.lastSync = new Date().toISOString();
      await this.store.setPreference(KEY, data);
      try {
        const result = await this.provider.write(item);
        const index = data.confirmed.attendance.findIndex(record => record.id === result.record.id);
        if (index < 0) data.confirmed.attendance.push(result.record); else data.confirmed.attendance[index] = result.record;
        data.pending = data.pending.filter(operation => operation.requestId !== requestId);
        this.lastError = null;
        await this.store.setPreference(KEY, data);
        return result.record;
      } catch (error) {
        item.status = error.conflict || error.status === 409 ? "conflict" : "error";
        item.attempted = true;
        item.error = error.message;
        this.lastError = error.message;
        await this.store.setPreference(KEY, data);
        throw error;
      }
    });
  }
}

function sameAttendance(remote, local) {
  if (!remote || !local) return false;
  return String(remote.value || "") === String(local.value || "")
    && Boolean(remote.overtime) === Boolean(local.overtime)
    && String(remote.substitutionReason || "") === String(local.substitutionReason || "")
    && String(remote.homeShiftTeamId || "") === String(local.homeShiftTeamId || "");
}
