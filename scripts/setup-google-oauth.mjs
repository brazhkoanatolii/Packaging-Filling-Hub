import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = normalize(join(fileURLToPath(new URL(".", import.meta.url)), ".."));
const credentialsPath = process.argv[2];
const environmentPath = join(projectRoot, ".env");
const oauthScopes = [
  "https://www.googleapis.com/auth/script.scriptapp",
  "https://www.googleapis.com/auth/spreadsheets.currentonly"
];

if (!credentialsPath || !existsSync(credentialsPath)) {
  console.error("Укажите путь к скачанному JSON-файлу OAuth-клиента.");
  console.error('Пример: npm run setup:google-oauth -- "C:\\Users\\User\\Downloads\\client_secret_....json"');
  process.exit(1);
}

const credentials = JSON.parse(readFileSync(credentialsPath, "utf8"));
const installed = credentials.installed;
if (!installed?.client_id || !installed?.client_secret) {
  throw new Error("Файл не содержит данные OAuth-клиента типа «Настольное приложение».");
}

const codeVerifier = toBase64Url(randomBytes(48));
const codeChallenge = toBase64Url(createHash("sha256").update(codeVerifier).digest());
const expectedState = toBase64Url(randomBytes(24));

const server = createServer(async (request, response) => {
  try {
    const requestUrl = new URL(request.url, "http://127.0.0.1");
    if (requestUrl.pathname !== "/oauth2/callback") return respond(response, 404, "Страница не найдена.");
    if (requestUrl.searchParams.get("state") !== expectedState) throw new Error("Google вернул некорректный параметр безопасности.");
    if (requestUrl.searchParams.get("error")) throw new Error("Доступ Google не был предоставлен.");

    const code = requestUrl.searchParams.get("code");
    if (!code) throw new Error("Google не вернул код авторизации.");

    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: installed.client_id,
        client_secret: installed.client_secret,
        code,
        code_verifier: codeVerifier,
        grant_type: "authorization_code",
        redirect_uri: redirectUri
      })
    });
    const token = await tokenResponse.json().catch(() => ({}));
    if (!tokenResponse.ok || !token.refresh_token) {
      throw new Error(token.error_description || "Google не вернул refresh token.");
    }

    updateEnvironment(environmentPath, {
      GOOGLE_OAUTH_CLIENT_ID: installed.client_id,
      GOOGLE_OAUTH_CLIENT_SECRET: installed.client_secret,
      GOOGLE_OAUTH_REFRESH_TOKEN: token.refresh_token
    });
    respond(response, 200, "Авторизация завершена. Можно закрыть эту вкладку и вернуться в программу.");
    console.log("OAuth настроен: данные сохранены только в локальном .env.");
    console.log(`Использован файл: ${basename(credentialsPath)}`);
    closeAndExit(0);
  } catch (error) {
    respond(response, 400, `Не удалось завершить авторизацию: ${error.message}`);
    console.error(`Ошибка OAuth: ${error.message}`);
    closeAndExit(1);
  }
});

server.listen(0, "127.0.0.1", () => {
  const address = server.address();
  redirectUri = `http://127.0.0.1:${address.port}/oauth2/callback`;
  const authorizationUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authorizationUrl.search = new URLSearchParams({
    access_type: "offline",
    client_id: installed.client_id,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    include_granted_scopes: "true",
    prompt: "consent",
    redirect_uri: redirectUri,
    response_type: "code",
    scope: oauthScopes.join(" "),
    state: expectedState
  }).toString();

  console.log("Откройте эту ссылку в браузере и подтвердите два разрешения Google:");
  console.log(authorizationUrl.toString());
});

let redirectUri = "";

function updateEnvironment(filePath, values) {
  const existing = existsSync(filePath) ? readFileSync(filePath, "utf8") : "";
  const lines = existing.split(/\r?\n/);
  for (const [name, value] of Object.entries(values)) {
    const index = lines.findIndex(line => line.startsWith(`${name}=`));
    const replacement = `${name}=${value}`;
    if (index >= 0) lines[index] = replacement;
    else lines.push(replacement);
  }
  writeFileSync(filePath, `${lines.join("\n").replace(/\n+$/, "")}\n`, { encoding: "utf8", mode: 0o600 });
}

function respond(response, statusCode, message) {
  const body = `<!doctype html><html lang="ru"><meta charset="utf-8"><title>Packaging-Filling-Hub</title><body style="font:20px system-ui;max-width:720px;margin:64px auto;padding:24px"><h1>Packaging-Filling-Hub</h1><p>${escapeHtml(message)}</p></body></html>`;
  response.writeHead(statusCode, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
  response.end(body);
}

function closeAndExit(code) {
  server.close(() => process.exit(code));
  setTimeout(() => process.exit(code), 1_000).unref();
}

function toBase64Url(value) {
  return Buffer.from(value).toString("base64url");
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, symbol => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[symbol]);
}
