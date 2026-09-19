export class ShiftService {
  constructor(store) {
    this.store = store;
  }

  async current() {
    return this.store.preference("activeShift");
  }

  async start(employee) {
    const current = await this.current();
    if (current?.active) return current;
    const input = typeof employee === "string"
      ? { supervisor: employee, shiftNumber: 1, attendance: [{ employeeId: "legacy-supervisor", status: "present" }] }
      : employee;
    if (!input?.supervisor) throw new Error("Выберите старшего смены");
    if (![1, 2].includes(Number(input.shiftNumber))) throw new Error("Выберите первую или вторую смену");
    if (!Array.isArray(input.attendance) || !input.attendance.length) throw new Error("Отметьте присутствие сотрудников");
    const startedAt = new Date().toISOString();
    const shiftNumber = Number(input.shiftNumber);
    const shift = {
      active: true,
      employee: input.supervisor,
      supervisor: input.supervisor,
      shiftNumber,
      shiftTeamId: String(input.shiftTeamId || ""),
      attendance: input.attendance.map(item => ({ employeeId: item.employeeId, status: item.status })),
      startedAt,
      endedAt: null,
      requiresScaleControl: shiftNumber === 1,
      weightsCompletedAt: shiftNumber === 1 ? null : startedAt
    };
    await this.store.setPreference("activeShift", shift);
    return shift;
  }

  async updateAttendance(attendance) {
    const current = await this.current();
    if (!current?.active) throw new Error("Смена не начата");
    if (!Array.isArray(attendance) || !attendance.length) throw new Error("Отметьте присутствие сотрудников");
    const shift = {
      ...current,
      attendance: attendance.map(item => ({ employeeId: item.employeeId, status: item.status })),
      attendanceUpdatedAt: new Date().toISOString()
    };
    await this.store.setPreference("activeShift", shift);
    return shift;
  }

  async completeScaleControl(recordCount) {
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
    const current = await this.current();
    if (!current?.active) return current;
    const shift = { ...current, active: false, endedAt: new Date().toISOString() };
    await this.store.setPreference("activeShift", shift);
    return shift;
  }
}
