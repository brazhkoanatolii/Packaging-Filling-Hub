
const CACHE_KEY = "productSpecificationsCache";

export class ProductSpecificationService {
  constructor(store, provider = null) { this.store = store; this.provider = provider; }

  async snapshot() {
    const cached = await this.store.preference(CACHE_KEY, null);
    return { specifications: cached?.specifications ?? [], source: cached ? "cache" : "loading", cachedAt: cached?.cachedAt ?? null };
  }

  async initialize() {
    const cached = await this.store.preference(CACHE_KEY, null);
    if (!this.provider) return { specifications: cached?.specifications ?? [], source: cached ? "cache" : "unavailable", cachedAt: cached?.cachedAt ?? null, error: "Источник Google не подключён" };
    try {
      const specifications = await this.provider.list();
      await this.store.setPreference(CACHE_KEY, { specifications, cachedAt: new Date().toISOString() });
      return { specifications, source: "google", cachedAt: new Date().toISOString() };
    } catch (error) {
      if (cached?.specifications?.length) return { specifications: cached.specifications, source: "cache", cachedAt: cached.cachedAt, error: error.message };
      return { specifications: [], source: "unavailable", cachedAt: null, error: error.message };
    }
  }

  async save(specification) {
    if (!this.provider) throw new Error("Источник Google не подключён");
    const saved = await this.provider.save(specification);
    await this.initialize();
    return saved;
  }

  async remove(id) {
    if (!this.provider) throw new Error("Источник Google не подключён");
    await this.provider.remove(id);
    await this.initialize();
  }
}
