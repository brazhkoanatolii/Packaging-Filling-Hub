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
  constructor(store, { allowedRole = null } = {}) {
    this.store = store;
    this.allowedRole = allowedRole;
  }

  async current() {
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
    const account = ACCOUNTS.find(item => item.id === accountId);
    if (!account) throw new Error("Учётная запись не найдена");
    if (!this.isAllowed(account)) throw new Error("Эта учётная запись недоступна на данном компьютере");
    if (!await this.matchesPassword(account.id, password)) throw new Error("Неверный пароль");
    await this.store.setPreference(SESSION_KEY, account.id);
    await this.store.setPreference(SESSION_AUTHORIZED_KEY, true);
    return account;
  }

  async logout() {
    await this.store.setPreference(SESSION_KEY, null);
    await this.store.setPreference(SESSION_AUTHORIZED_KEY, false);
  }

  async changePassword(accountId, currentPassword, nextPassword) {
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
}

