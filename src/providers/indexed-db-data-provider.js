const DATABASE_NAME = "packaging-filling-hub";
const DATABASE_VERSION = 1;
const STORES = ["records", "remoteRecords", "operations", "preferences", "audit"];

export class IndexedDbDataProvider {
  #database;

  async init() {
    if (!globalThis.indexedDB) throw new Error("Браузер не поддерживает локальное хранилище IndexedDB");
    this.#database = await new Promise((resolve, reject) => {
      const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
      request.onupgradeneeded = () => {
        for (const name of STORES) {
          if (!request.result.objectStoreNames.contains(name)) {
            request.result.createObjectStore(name, { keyPath: name === "preferences" ? "key" : "id" });
          }
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return this;
  }

  async get(storeName, key) {
    return this.#request(storeName, "readonly", store => store.get(key));
  }

  async getAll(storeName) {
    return this.#request(storeName, "readonly", store => store.getAll());
  }

  async put(storeName, value) {
    await this.#request(storeName, "readwrite", store => store.put(value));
    return value;
  }

  async delete(storeName, key) {
    await this.#request(storeName, "readwrite", store => store.delete(key));
  }

  async preference(key, fallback = null) {
    return (await this.get("preferences", key))?.value ?? fallback;
  }

  async setPreference(key, value) {
    return this.put("preferences", { key, value });
  }

  #request(storeName, mode, operation) {
    return new Promise((resolve, reject) => {
      const transaction = this.#database.transaction(storeName, mode);
      const request = operation(transaction.objectStore(storeName));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      transaction.onabort = () => reject(transaction.error);
    });
  }
}

