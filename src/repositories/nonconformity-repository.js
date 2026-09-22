export class NonconformityRepository {
  constructor(provider) { this.provider = provider; }
  list() { return this.provider.list(); }
  create(record) { return this.provider.create(record); }
  update(id, record) { return this.provider.update(id, record); }
  remove(id) { return this.provider.remove(id); }
}
