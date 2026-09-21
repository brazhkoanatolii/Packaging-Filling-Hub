import { DEMO_PRODUCT_SPECIFICATIONS } from "../config/product-specification-config.js";

const CACHE_KEY = "productSpecificationsCache";

export class ProductSpecificationService {
  constructor(store, provider = null) { this.store = store; this.provider = provider; }

  async initialize() {
    const cached = await this.store.preference(CACHE_KEY, null);
    if (!this.provider) return { specifications: structuredClone(DEMO_PRODUCT_SPECIFICATIONS), source: "demo", cachedAt: null };
    try {
      const specifications = await this.provider.list();
      await this.store.setPreference(CACHE_KEY, { specifications, cachedAt: new Date().toISOString() });
      return { specifications, source: "google", cachedAt: new Date().toISOString() };
    } catch (error) {
      if (cached?.specifications?.length) return { specifications: cached.specifications, source: "cache", cachedAt: cached.cachedAt, error: error.message };
      return { specifications: [], source: "unavailable", cachedAt: null, error: error.message };
    }
  }
}
