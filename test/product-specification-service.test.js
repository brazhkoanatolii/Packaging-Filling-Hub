import test from "node:test";
import assert from "node:assert/strict";
import { ProductSpecificationService } from "../src/services/product-specification-service.js";

function createStore(initial = {}) {
  const values = new Map(Object.entries(initial));
  return { async preference(key, fallback = null) { return values.has(key) ? structuredClone(values.get(key)) : fallback; }, async setPreference(key, value) { values.set(key, structuredClone(value)); } };
}

test("спецификация загружается через источник и сохраняется для офлайн-просмотра", async () => {
  const store = createStore();
  const provider = { async list() { return [{ id: "spec:3", line: "Extreme Edition", product: "Extreme Freeze", variant: 70, dryMass: 11.8, wetMass: null, liquidVolume: null, processType: "сух.", pouchCount: 27, lidColor: "Ч/ДЗ", canType: "П/Кил" }]; } };
  const online = await new ProductSpecificationService(store, provider).initialize();
  assert.equal(online.source, "google");
  assert.equal(online.specifications[0].wetMass, null);

  const offline = await new ProductSpecificationService(store, { async list() { throw new Error("offline"); } }).initialize();
  assert.equal(offline.source, "cache");
  assert.equal(offline.specifications[0].product, "Extreme Freeze");
});
