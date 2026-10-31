export const REQUEST_TIMEOUT_MS = 15000;

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

export function normalizeBackendUrl(url, fallback = "") {
  return (url || fallback).trim().replace(/\/+$/, "");
}

export function isValidServerUrl(url) {
  return /^https?:\/\/[^\s/]+/i.test(url);
}

export function httpToWs(url) {
  const normalized = normalizeBackendUrl(url);
  if (normalized.startsWith("https://")) return normalized.replace("https://", "wss://");
  return normalized.replace("http://", "ws://");
}

// Build-time VITE_API_URL wins. Otherwise use port 8000 on the same host the app was opened from,
// so opening the app at http://192.168.0.111:5173 talks to http://192.168.0.111:8000.
export function defaultServerUrl(env = import.meta.env, location = globalThis.location) {
  if (env && env.VITE_API_URL) return normalizeBackendUrl(env.VITE_API_URL);
  if (location && location.hostname) return `${location.protocol}//${location.hostname}:8000`;
  return "";
}

export function errorMessage(data, status) {
  if (typeof data.detail === "string") return data.detail;
  if (Array.isArray(data.detail)) return data.detail.map((item) => item.msg).join(" ");
  if (status === 404) return "That server address did not respond like a Declare server. Check the server URL.";
  if (status === 429) return "Too many requests. Wait a moment and try again.";
  return `The server returned an error (${status}). Try again.`;
}

// Every server call goes through here, so timeouts, network failures, and non-JSON
// responses all produce a readable message.
export async function apiRequest(baseUrl, path, { method = "GET", token, body, timeoutMs = REQUEST_TIMEOUT_MS, fetchImpl } = {}) {
  if (!baseUrl) throw new ApiError("Enter the server URL first.", 0);
  const doFetch = fetchImpl ?? globalThis.fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await doFetch(`${baseUrl}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal
    });
  } catch (error) {
    const message = error?.name === "AbortError"
      ? "The server took too long to respond. Check the server URL and try again."
      : "Could not reach the server. Check the server URL and your internet connection.";
    throw new ApiError(message, 0);
  } finally {
    clearTimeout(timer);
  }

  const text = await response.text();
  let data = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = {};
    }
  }
  if (!response.ok) throw new ApiError(errorMessage(data, response.status), response.status);
  return data;
}
