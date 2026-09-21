import { CycloneRepository } from "./cyclone-repository.js";

// Separate database; reuses the transactional outbox and retry logic.
export class MaintenanceRepository extends CycloneRepository {
  async refresh() {
    const records = await super.refresh();
    await this.local.setPreference("machines", this.remote.machines);
    await this.local.setPreference("performers", this.remote.performers);
    return records;
  }
  async machines() { return await this.local.preference("machines") || []; }
  async performers() { return await this.local.preference("performers") || []; }
}
