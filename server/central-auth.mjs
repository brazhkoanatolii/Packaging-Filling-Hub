import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export const CENTRAL_ACCOUNTS = Object.freeze([
  Object.freeze({ id: "manager", role: "manager", title: "Администрация", description: "Все журналы, настройки, сотрудники и права доступа" }),
  Object.freeze({ id: "senior-mechanic", role: "senior", title: "Старший механик", description: "Работа со сменой и разрешёнными журналами" })
]);

const MIN_PASSWORD_LENGTH = 6;

export class CentralAuthService {
  constructor({ accountsPath, sessionTtlMs = 12 * 60 * 60 * 1000, now = () => Date.now(), random = () => randomBytes(32).toString("base64url") } = {}) {
    if (!accountsPath) throw new Error("Не указан путь к центральным учётным записям");
    this.accountsPath = accountsPath;
    this.sessionTtlMs = sessionTtlMs;
    this.now = now;
    this.random = random;
    this.sessions = new Map();
    this.accounts = [];
  }

  initialize(bootstrapPasswords = {}) {
    if (existsSync(this.accountsPath)) {
      this.accounts = readAccounts(this.accountsPath);
      return this.publicAccounts();
    }
    const manager = String(bootstrapPasswords.manager || "");
    const senior = String(bootstrapPasswords["senior-mechanic"] || "");
    validatePassword(manager);
    validatePassword(senior);
    this.accounts = CENTRAL_ACCOUNTS.map(account => ({
      ...account,
      password: passwordRecord(account.id === "manager" ? manager : senior),
      updatedAt: new Date(this.now()).toISOString()
    }));
    this.persist();
    return this.publicAccounts();
  }

  publicAccounts() { return this.accounts.map(publicAccount); }

  login(accountId, password) {
    const account = this.accounts.find(item => item.id === String(accountId || ""));
    if (!account || !matchesPassword(account.password, password)) {
      const error = new Error("Неверный пароль");
      error.statusCode = 401;
      throw error;
    }
    const token = this.random();
    this.sessions.set(token, { accountId: account.id, expiresAt: this.now() + this.sessionTtlMs });
    return { token, account: publicAccount(account), expiresAt: this.now() + this.sessionTtlMs };
  }

  accountForToken(token) {
    const session = this.sessions.get(String(token || ""));
    if (!session) return null;
    if (session.expiresAt <= this.now()) {
      this.sessions.delete(String(token));
      return null;
    }
    const account = this.accounts.find(item => item.id === session.accountId);
    return account ? publicAccount(account) : null;
  }

  logout(token) { this.sessions.delete(String(token || "")); }

  changePassword(actor, accountId, currentPassword, nextPassword) {
    const target = this.accounts.find(item => item.id === String(accountId || ""));
    if (!actor || !target) {
      const error = new Error("Учётная запись не найдена");
      error.statusCode = 404;
      throw error;
    }
    if (actor.id !== target.id && actor.role !== "manager") {
      const error = new Error("Недостаточно прав для изменения пароля");
      error.statusCode = 403;
      throw error;
    }
    if (!matchesPassword(target.password, currentPassword)) {
      const error = new Error("Текущий пароль указан неверно");
      error.statusCode = 401;
      throw error;
    }
    validatePassword(nextPassword);
    target.password = passwordRecord(nextPassword);
    target.updatedAt = new Date(this.now()).toISOString();
    this.persist();
  }

  persist() {
    mkdirSync(dirname(this.accountsPath), { recursive: true });
    const temporary = `${this.accountsPath}.tmp`;
    writeFileSync(temporary, `${JSON.stringify({ schemaVersion: 1, accounts: this.accounts }, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    renameSync(temporary, this.accountsPath);
  }
}

export function readCookie(request, name) {
  const source = String(request?.headers?.cookie || "");
  for (const item of source.split(";")) {
    const [key, ...value] = item.trim().split("=");
    if (key === name) return decodeURIComponent(value.join("="));
  }
  return "";
}

function readAccounts(path) {
  let payload;
  try { payload = JSON.parse(readFileSync(path, "utf8")); } catch { throw new Error("Не удалось прочитать центральные учётные записи"); }
  if (payload?.schemaVersion !== 1 || !Array.isArray(payload.accounts)) throw new Error("Некорректный формат центральных учётных записей");
  const accounts = CENTRAL_ACCOUNTS.map(template => {
    const account = payload.accounts.find(item => item?.id === template.id);
    if (!account || !validPasswordRecord(account.password)) throw new Error(`Не настроена учётная запись: ${template.title}`);
    return { ...template, password: account.password, updatedAt: String(account.updatedAt || "") };
  });
  return accounts;
}

function publicAccount(account) { return { id: account.id, role: account.role, title: account.title, description: account.description }; }
function validatePassword(password) {
  if (String(password || "").length < MIN_PASSWORD_LENGTH) throw new Error(`Пароль должен содержать минимум ${MIN_PASSWORD_LENGTH} символов`);
}
function passwordRecord(password) {
  const salt = randomBytes(16).toString("base64url");
  return { algorithm: "scrypt", salt, hash: scryptSync(String(password), salt, 64).toString("base64url") };
}
function validPasswordRecord(value) { return value?.algorithm === "scrypt" && typeof value.salt === "string" && typeof value.hash === "string"; }
function matchesPassword(record, candidate) {
  if (!validPasswordRecord(record)) return false;
  const expected = Buffer.from(record.hash, "base64url");
  const actual = scryptSync(String(candidate || ""), record.salt, expected.length);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
