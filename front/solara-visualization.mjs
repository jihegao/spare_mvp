export const DEFAULT_SOLARA_VISUALIZATION_URL = "http://127.0.0.1:8765";
export const SOLARA_VISUALIZATION_URL_STORAGE_KEY = "spare-mvp:solaraVisualizationUrl";

export function resolveSolaraVisualizationBaseUrl({
  locationRef = globalThis.location,
  storage = globalThis.localStorage
} = {}) {
  const fromSearch = queryValue(locationRef?.search || "", "solaraUrl");
  const fromHash = queryValue(hashQuery(locationRef?.hash || ""), "solaraUrl");
  const fromStorage = safeStorageGet(storage, SOLARA_VISUALIZATION_URL_STORAGE_KEY);
  return normalizeSolaraVisualizationUrl(fromSearch || fromHash || fromStorage || DEFAULT_SOLARA_VISUALIZATION_URL);
}

export function buildSolaraVisualizationUrl(baseUrl, context = {}) {
  const normalizedBase = normalizeSolaraVisualizationUrl(baseUrl || DEFAULT_SOLARA_VISUALIZATION_URL);
  let url;
  try {
    url = new URL(normalizedBase);
  } catch {
    url = new URL(DEFAULT_SOLARA_VISUALIZATION_URL);
  }
  url.searchParams.set("embedded", "1");
  for (const [key, value] of Object.entries(context)) {
    if (value === undefined || value === null || value === "") continue;
    url.searchParams.set(toSnakeCase(key), String(value));
  }
  return url.toString();
}

export function normalizeSolaraVisualizationUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return DEFAULT_SOLARA_VISUALIZATION_URL;
  try {
    const url = new URL(raw);
    if (!["http:", "https:"].includes(url.protocol)) return DEFAULT_SOLARA_VISUALIZATION_URL;
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return DEFAULT_SOLARA_VISUALIZATION_URL;
  }
}

function queryValue(search, key) {
  const raw = String(search || "");
  const query = raw.startsWith("?") ? raw.slice(1) : raw;
  if (!query) return "";
  return new URLSearchParams(query).get(key) || "";
}

function hashQuery(hash) {
  const raw = String(hash || "");
  const index = raw.indexOf("?");
  return index >= 0 ? raw.slice(index + 1) : "";
}

function safeStorageGet(storage, key) {
  try {
    return storage?.getItem?.(key) || "";
  } catch {
    return "";
  }
}

function toSnakeCase(key) {
  return String(key).replace(/[A-Z]/g, (match) => `_${match.toLowerCase()}`);
}
