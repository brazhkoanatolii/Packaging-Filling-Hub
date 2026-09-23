export class PackagingWarehouseRepository {
  constructor(remote) { this.remote = remote; }
  list() { return this.remote.list(); }
  save(record) { return this.remote.save(record); }
  remove(id) { return this.remote.remove(id); }
}
