import { ACCOUNTS } from "../config/app-config.js";

const DEFAULT_PASSWORD = "0000";
const SESSION_KEY = "sessionAccount";
const SESSION_AUTHORIZED_KEY = "sessionAuthorized";

function passwordKey(accountId) {
  return `accountPassword:${accountId}`;
}

async function passwordHash(value) {
  const data = new TextEncoder().encode(String(value));
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

export class AuthService {
  constructor(store, { allowedRole = null, apiBaseUrl = "", remote = false, fetchImpl = globalThis.fetch } = {}) {
    this.store = store;
    this.allowedRole = allowedRole;
    this.apiBaseUrl = String(apiBaseUrl || "").replace(/\/$/, "");
    this.remote = Boolean(remote);
    this.fetch = typeof fetchImpl === "function" ? fetchImpl.bind(globalThis) : null;
  }

  async current() {
    if (this.remote) {
      const payload = await this.request("/api/auth/session", { method: "GET" });
      return payload.account ?? null;
    }
    const accountId = await this.store.preference(SESSION_KEY);
    const authorized = await this.store.preference(SESSION_AUTHORIZED_KEY, false);
    const account = ACCOUNTS.find(item => item.id === accountId) ?? null;
    if (!authorized || (account && !this.isAllowed(account))) {
      await this.logout();
      return null;
    }
    return account;
  }

  async login(accountId, password) {
    if (this.remote) {
      const payload = await this.request("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId, password })
      });
      return payload.account;
    }
    const account = ACCOUNTS.find(item => item.id === accountId);
    if (!account) throw new Error("Учётная запись не найдена");
    if (!this.isAllowed(account)) throw new Error("Эта учётная запись недоступна на данном компьютере");
    if (!await this.matchesPassword(account.id, password)) throw new Error("Неверный пароль");
    await this.store.setPreference(SESSION_KEY, account.id);
    await this.store.setPreference(SESSION_AUTHORIZED_KEY, true);
    return account;
  }

  async logout() {
    if (this.remote) {
      await this.request("/api/auth/logout", { method: "POST" });
      return;
    }
    await this.store.setPreference(SESSION_KEY, null);
    await this.store.setPreference(SESSION_AUTHORIZED_KEY, false);
  }

  async changePassword(accountId, currentPassword, nextPassword) {
    if (this.remote) {
      await this.request("/api/auth/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId, currentPassword, nextPassword })
      });
      return;
    }
    const account = ACCOUNTS.find(item => item.id === accountId);
    if (!account) throw new Error("Учётная запись не найдена");
    if (!await this.matchesPassword(accountId, currentPassword)) throw new Error("Текущий пароль указан неверно");
    const password = String(nextPassword || "");
    if (password.length < 4) throw new Error("Новый пароль должен содержать минимум 4 символа");
    await this.store.setPreference(passwordKey(accountId), await passwordHash(password));
  }

  async matchesPassword(accountId, candidate) {
    const savedHash = await this.store.preference(passwordKey(accountId));
    const expectedHash = savedHash || await passwordHash(DEFAULT_PASSWORD);
    return await passwordHash(candidate) === expectedHash;
  }

  availableAccounts() {
    return ACCOUNTS.filter(account => this.isAllowed(account));
  }

  isAllowed(account) {
    return !this.allowedRole || account.role === this.allowedRole;
  }

  async request(path, options) {
    if (!this.fetch) throw new Error("Браузер не поддерживает сетевые запросы");
    let response;
    try {
      response = await this.fetch(`${this.apiBaseUrl}${path}`, {
        ...options,
        credentials: "same-origin",
        headers: { Accept: "application/json", ...(options.headers ?? {}) }
      });
    } catch {
      throw new Error("Нет связи с центральным сервером программы");
    }
    const payload = await response.json().catch(() => null);
    if (!response.ok || payload?.ok === false) throw new Error(payload?.message || "Не удалось выполнить вход");
    return payload ?? {};
  }
}

