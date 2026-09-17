import { ACCOUNTS } from "../config/app-config.js";

export class AuthService {
  constructor(store) {
    this.store = store;
  }

  async current() {
    const accountId = await this.store.preference("sessionAccount");
    return ACCOUNTS.find(account => account.id === accountId) ?? null;
  }

  async login(accountId) {
    const account = ACCOUNTS.find(item => item.id === accountId);
    if (!account) throw new Error("Учётная запись не найдена");
    await this.store.setPreference("sessionAccount", account.id);
    return account;
  }

  async logout() {
    await this.store.setPreference("sessionAccount", null);
  }
}

