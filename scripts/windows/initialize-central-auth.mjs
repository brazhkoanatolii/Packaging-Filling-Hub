import { resolve } from "node:path";
import { CentralAuthService } from "../../server/central-auth.mjs";

const accountsPath = process.argv[2] ? resolve(process.argv[2]) : null;
if (!accountsPath) throw new Error("Укажите путь к файлу центральных учётных записей");

const manager = process.env.PFH_MANAGER_PASSWORD || "";
const senior = process.env.PFH_SENIOR_PASSWORD || "";
const auth = new CentralAuthService({ accountsPath });
auth.initialize({ manager, "senior-mechanic": senior });
console.log("Центральные учётные записи созданы.");
