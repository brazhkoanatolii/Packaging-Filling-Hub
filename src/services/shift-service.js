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
    const shift = {
      active: true,
      employee,
      startedAt: new Date().toISOString(),
      endedAt: null
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

