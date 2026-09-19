import { ACCOUNTS } from "../config/app-config.js";

export class AuthService {
  constructor(store, { allowedRole = null } = {}) {
    this.store = store;
    this.allowedRole = allowedRole;
  }

  async current() {
    const accountId = await this.store.preference("sessionAccount");
    const account = ACCOUNTS.find(item => item.id === accountId) ?? null;
    if (account && !this.isAllowed(account)) {
      await this.logout();
      return null;
    }
    return account;
  }

  async login(accountId) {
    const account = ACCOUNTS.find(item => item.id === accountId);
    if (!account) throw new Error("Учётная запись не найдена");
    if (!this.isAllowed(account)) throw new Error("Эта учётная запись недоступна на данном компьютере");
    await this.store.setPreference("sessionAccount", account.id);
    return account;
  }

  async logout() {
    await this.store.setPreference("sessionAccount", null);
  }

  availableAccounts() {
    return ACCOUNTS.filter(account => this.isAllowed(account));
  }

  isAllowed(account) {
    return !this.allowedRole || account.role === this.allowedRole;
  }
}

