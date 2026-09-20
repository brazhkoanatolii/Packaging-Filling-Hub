import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = normalize(join(fileURLToPath(new URL(".", import.meta.url)), ".."));
loadEnvironment(join(projectRoot, ".env"));

const appVersion = JSON.parse(readFileSync(join(projectRoot, "package.json"), "utf8")).version;
const port = numberFromEnvironment("PORT", 4173);
const host = process.env.HOST || "127.0.0.1";
const writesEnabled = process.env.GOOGLE_WRITES_ENABLED === "true";
const workstationRole = normalizeWorkstationRole(process.env.WORKSTATION_ROLE);
const workstationId = normalizeWorkstationId(process.env.WORKSTATION_ID);
const workstationLabel = normalizeWorkstationLabel(process.env.WORKSTATION_LABEL);
const maximumBodyBytes = 1024 * 1024;
const types = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json; charset=utf-8"
};
const publicFiles = new Set(["index.html", "manifest.webmanifest", "service-worker.js"]);
const publicDirectories = ["assets/", "src/"];

let tokenCache = null;

createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host || `${host}:${port}`}`);

    if (url.pathname === "/runtime-config.js") {
      return sendJavaScript(response, `globalThis.__PACKAGING_FILLING_CONFIG__ = Object.freeze(${JSON.stringify({
        mode: "gateway",
        googleWritesEnabled: writesEnabled,
        gatewayBaseUrl: "",
        workstationRole,
        workstationId,
        workstationLabel
      })});`);
    }

    if (url.pathname === "/api/health" && request.method === "GET") {
      return sendJson(response, 200, {
        ok: true,
        version: appVersion,
        configured: missingGoogleSettings().length === 0,
        writesEnabled,
        workstationRole,
        workstationConfigured: workstationRole !== null,
        workstationId,
        workstationLabel,
        missing: missingGoogleSettings()
      });
    }

    if (url.pathname === "/api/scale-records" && request.method === "GET") {
      const result = await runAppsScript("listScaleRecords");
      return sendJson(response, 200, result);
    }

    if (url.pathname === "/api/workforce" && request.method === "GET") {
      if (!workstationRole) return sendJson(response, 403, { ok: false, message: "Назначьте роль рабочего компьютера" });
      const result = await runAppsScript("getWorkforceSnapshot", [{ role: workstationRole }]);
      return sendJson(response, result?.ok === false ? 400 : 200, result);
    }
    if (url.pathname === "/api/workforce" && request.method === "POST") {
      if (!writesEnabled) return sendJson(response, 403, { ok: false, message: "Запись в Google выключена" });
      const payload = await readJsonBody(request);
      if (!workstationRole || (workstationRole !== "manager" && payload.kind !== "attendance")) return sendJson(response, 403, { ok: false, message: "Недостаточно прав" });
      const result = await runAppsScript("writeWorkforceOperation", [{ ...payload, role: workstationRole }]);
      return sendJson(response, result?.ok === false ? (result.status || 400) : 200, result);
    }

    if (url.pathname === "/api/scale-records" && request.method === "POST") {
      if (!writesEnabled) {
        return sendJson(response, 403, { ok: false, message: "Запись в Google пока выключена начальником участка" });
      }
      const payload = await readJsonBody(request);
      const result = await runAppsScript("writeScaleRecordV2", [payload]);
      return sendJson(response, result?.conflict ? 409 : 200, result);
    }

    if (url.pathname === "/api/personnel" && request.method === "GET") {
      const result = await runAppsScript("listPersonnel");
      return sendJson(response, 200, result);
    }

    if (url.pathname === "/api/personnel" && request.method === "POST") {
      if (!writesEnabled) return sendJson(response, 403, { ok: false, message: "Запись в Google пока выключена начальником участка" });
      const result = await runAppsScript("savePersonnel", [await readJsonBody(request)]);
      return sendJson(response, 200, result);
    }

    if (url.pathname.startsWith("/api/")) {
      return sendJson(response, 404, { ok: false, message: "Команда шлюза не найдена" });
    }

    return serveStatic(url.pathname, response);
  } catch (error) {
    const status = error.statusCode || 500;
    console.error(`[gateway] ${error.name}: ${error.message}`);
    return sendJson(response, status, {
      ok: false,
      message: status >= 500 ? "Не удалось выполнить запрос к Google" : error.message
    });
  }
}).listen(port, host, () => {
  console.log(`Packaging-Filling-Hub: http://${host}:${port}`);
  console.log(`Рабочее место: ${workstationLabel || workstationId || workstationRole || "не назначено"}`);
  console.log(`Google: ${missingGoogleSettings().length ? "требуется настройка" : "настроен"}; запись: ${writesEnabled ? "включена" : "выключена"}`);
});

async function runAppsScript(functionName, parameters = []) {
  assertGoogleConfigured();
  const accessToken = await getAccessToken();
  const deploymentId = process.env.GOOGLE_SCRIPT_DEPLOYMENT_ID;
  const response = await fetch(`https://script.googleapis.com/v1/scripts/${encodeURIComponent(deploymentId)}:run`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ function: functionName, parameters, devMode: false })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw googleError(response.status, payload?.error?.message || "Google Apps Script недоступен");
  if (payload.error) {
    const detail = payload.error.details?.[0]?.errorMessage || payload.error.message;
    throw googleError(502, detail || "Функция Google завершилась с ошибкой");
  }
  return payload.response?.result ?? null;
}

async function getAccessToken() {
  if (tokenCache && Date.now() < tokenCache.expiresAt - 60_000) return tokenCache.value;
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_OAUTH_CLIENT_ID,
      client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
      refresh_token: process.env.GOOGLE_OAUTH_REFRESH_TOKEN,
      grant_type: "refresh_token"
    })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.access_token) {
    throw googleError(response.status || 502, payload.error_description || "Не удалось обновить доступ к Google");
  }
  tokenCache = {
    value: payload.access_token,
    expiresAt: Date.now() + Number(payload.expires_in || 3600) * 1000
  };
  return tokenCache.value;
}

function serveStatic(pathname, response) {
  const relativePath = pathname === "/" ? "index.html" : decodeURIComponent(pathname).replace(/^\/+/, "");
  let filePath = resolve(projectRoot, relativePath);
  const rel = relative(projectRoot, filePath);
  const publicPath = rel.split(sep).join("/");
  const outsideProject = rel.startsWith(`..${sep}`) || rel === "..";
  const allowed = publicFiles.has(publicPath) || publicDirectories.some(directory => publicPath.startsWith(directory));
  if (outsideProject || !allowed || !existsSync(filePath) || statSync(filePath).isDirectory()) {
    response.writeHead(404, {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff"
    });
    response.end("Страница не найдена");
    return;
  }
  response.writeHead(200, {
    "Content-Type": types[extname(filePath)] || "application/octet-stream",
    "Cache-Control": extname(filePath) === ".html" ? "no-cache" : "public, max-age=300",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "same-origin"
  });
  createReadStream(filePath).pipe(response);
}

function readJsonBody(request) {
  return new Promise((resolveBody, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", chunk => {
      body += chunk;
      if (Buffer.byteLength(body, "utf8") > maximumBodyBytes) {
        const error = new Error("Запрос слишком большой");
        error.statusCode = 413;
        reject(error);
        request.destroy();
      }
    });
    request.on("end", () => {
      try {
        resolveBody(JSON.parse(body || "{}"));
      } catch {
        const error = new Error("Некорректные данные запроса");
        error.statusCode = 400;
        reject(error);
      }
    });
    request.on("error", reject);
  });
}

function sendJson(response, statusCode, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  });
  response.end(body);
}

function sendJavaScript(response, body) {
  response.writeHead(200, {
    "Content-Type": "text/javascript; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  });
  response.end(body);
}

function assertGoogleConfigured() {
  const missing = missingGoogleSettings();
  if (!missing.length) return;
  const error = new Error(`Не заполнены настройки: ${missing.join(", ")}`);
  error.statusCode = 503;
  throw error;
}

function missingGoogleSettings() {
  return [
    "GOOGLE_OAUTH_CLIENT_ID",
    "GOOGLE_OAUTH_CLIENT_SECRET",
    "GOOGLE_OAUTH_REFRESH_TOKEN",
    "GOOGLE_SCRIPT_DEPLOYMENT_ID"
  ].filter(name => !process.env[name]);
}

function googleError(statusCode, message) {
  const error = new Error(message);
  error.name = "GoogleApiError";
  error.statusCode = statusCode === 401 || statusCode === 403 ? statusCode : 502;
  return error;
}

function numberFromEnvironment(name, fallback) {
  const value = Number(process.env[name] || fallback);
  if (Number.isInteger(value) && value > 0 && value <= 65535) return value;
  throw new Error(`${name} должен быть корректным номером порта`);
}

function normalizeWorkstationRole(value) {
  if (!value) return null;
  if (["manager", "senior"].includes(value)) return value;
  throw new Error("WORKSTATION_ROLE должен иметь значение manager или senior");
}

function normalizeWorkstationId(value) {
  if (!value) return null;
  const result = String(value).trim().toLowerCase();
  if (/^[a-z0-9][a-z0-9-]{1,63}$/.test(result)) return result;
  throw new Error("WORKSTATION_ID должен содержать латинские буквы, цифры и дефисы");
}

function normalizeWorkstationLabel(value) {
  if (!value) return null;
  const result = String(value).trim();
  if (result.length <= 80) return result;
  throw new Error("WORKSTATION_LABEL не должен превышать 80 символов");
}

function loadEnvironment(filePath) {
  if (!existsSync(filePath)) return;
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!match || match[2].startsWith("#") || process.env[match[1]] !== undefined) continue;
    const value = match[2].replace(/^(['"])(.*)\1$/, "$2");
    process.env[match[1]] = value;
  }
}
