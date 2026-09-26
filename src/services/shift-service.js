export class ShiftService {
  constructor(store, remote = null) {
    this.store = store;
    this.remote = remote;
  }

  async current() {
    if (this.remote) return this.remote.current();
    return this.store.preference("activeShift");
  }

  async start(employee) {
    if (this.remote) return this.remote.update("start", typeof employee === "string" ? { supervisor: employee } : employee);
    const current = await this.current();
    if (current?.active) return current;
    const input = typeof employee === "string"
      ? { supervisor: employee, shiftNumber: 1, attendance: [{ employeeId: "legacy-supervisor", status: "present" }] }
      : employee;
    const seniorMechanic = String(input?.seniorMechanic || input?.supervisor || "").trim();
    const mechanic = String(input?.mechanic || "").trim();
    if (!seniorMechanic) throw new Error("Выберите старшего механика");
    if (!Array.isArray(input.attendance) || !input.attendance.length) throw new Error("Отметьте присутствие сотрудников");
    const startedAt = new Date().toISOString();
    const shiftNumber = [1, 2].includes(Number(input.shiftNumber)) ? Number(input.shiftNumber) : 1;
    const shift = {
      active: true,
      employee: input.supervisor,
      supervisor: seniorMechanic,
      seniorMechanic,
      mechanic,
      shiftNumber,
      shiftTeamId: String(input.shiftTeamId || ""),
      attendance: input.attendance.map(normalizeAttendance),
      startedAt,
      endedAt: null,
      requiresScaleControl: shiftNumber === 1,
      weightsCompletedAt: shiftNumber === 1 ? null : startedAt
    };
    await this.store.setPreference("activeShift", shift);
    return shift;
  }

  async updateAttendance(attendance) {
    if (this.remote) return this.remote.update("update-attendance", { attendance });
    const current = await this.current();
    if (!current?.active) throw new Error("Смена не начата");
    if (!Array.isArray(attendance) || !attendance.length) throw new Error("Отметьте присутствие сотрудников");
    const shift = {
      ...current,
      attendance: attendance.map(normalizeAttendance),
      attendanceUpdatedAt: new Date().toISOString()
    };
    await this.store.setPreference("activeShift", shift);
    return shift;
  }

  async completeScaleControl(recordCount) {
    if (this.remote) return this.remote.update("complete-scale-control", { recordCount });
    const current = await this.current();
    if (!current?.active) return current;
    if (!current.requiresScaleControl || current.weightsCompletedAt) return current;
    if (Number(recordCount) < 13) return current;
    const shift = {
      ...current,
      weightsCompletedAt: new Date().toISOString(),
      scaleControlRecordCount: Number(recordCount)
    };
    await this.store.setPreference("activeShift", shift);
    return shift;
  }

  async end() {
    if (this.remote) return this.remote.update("end");
    const current = await this.current();
    if (!current?.active) return current;
    const shift = { ...current, active: false, endedAt: new Date().toISOString() };
    await this.store.setPreference("activeShift", shift);
    return shift;
  }
}

function normalizeAttendance(item) {
  const attendance = {
    employeeId: String(item.employeeId || ""),
    status: String(item.status || "")
  };
  if (item.isSubstitute) {
    attendance.isSubstitute = true;
    attendance.substitutionReason = String(item.substitutionReason || "");
    attendance.homeShiftTeamId = String(item.homeShiftTeamId || "");
  }
  return attendance;
}
