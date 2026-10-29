import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, apiRequest, defaultServerUrl, httpToWs, isValidServerUrl, normalizeBackendUrl } from "../../src/api.js";

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => (body === undefined ? "" : JSON.stringify(body))
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("server URL helpers", () => {
  it("trims spaces and trailing slashes, and uses the fallback when empty", () => {
    expect(normalizeBackendUrl("  http://example.com:8000/// ")).toBe("http://example.com:8000");
    expect(normalizeBackendUrl("", "http://fallback:8000")).toBe("http://fallback:8000");
  });

  it("accepts only http and https URLs", () => {
    expect(isValidServerUrl("http://192.168.0.111:8000")).toBe(true);
    expect(isValidServerUrl("https://api.example.com")).toBe(true);
    expect(isValidServerUrl("localhost:8000")).toBe(false);
    expect(isValidServerUrl("ftp://example.com")).toBe(false);
    expect(isValidServerUrl("")).toBe(false);
  });

  it("turns http into ws and https into wss for the room socket", () => {
    expect(httpToWs("http://localhost:8000")).toBe("ws://localhost:8000");
    expect(httpToWs("https://api.example.com/")).toBe("wss://api.example.com");
  });

  it("prefers the build-time API URL, then the same host on port 8000", () => {
    expect(defaultServerUrl({ VITE_API_URL: "https://api.example.com/" }, { protocol: "http:", hostname: "localhost" })).toBe("https://api.example.com");
    expect(defaultServerUrl({}, { protocol: "http:", hostname: "192.168.0.111" })).toBe("http://192.168.0.111:8000");
    expect(defaultServerUrl({}, null)).toBe("");
  });
});

describe("apiRequest", () => {
  it("returns the parsed body for a successful response", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, { status: "ok" }));
    const result = await apiRequest("http://server", "/health", { fetchImpl });
    expect(result).toEqual({ status: "ok" });
    expect(fetchImpl.mock.calls[0][0]).toBe("http://server/health");
  });

  it("sends the bearer token and a JSON body", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, {}));
    await apiRequest("http://server", "/rooms", { method: "POST", token: "abc", body: { a: 1 }, fetchImpl });
    const [, init] = fetchImpl.mock.calls[0];
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer abc");
    expect(init.body).toBe(JSON.stringify({ a: 1 }));
  });

  it("turns the server's detail message into an ApiError with the status", async () => {
    const fetchImpl = async () => jsonResponse(401, { detail: "Your session has ended. Sign in again." });
    const error = await apiRequest("http://server", "/auth/me", { fetchImpl }).catch((caught) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(401);
    expect(error.message).toBe("Your session has ended. Sign in again.");
  });

  it("explains validation errors that list several problems", async () => {
    const fetchImpl = async () => jsonResponse(422, { detail: [{ msg: "Field required." }, { msg: "Invalid code." }] });
    const error = await apiRequest("http://server", "/auth/login", { fetchImpl }).catch((caught) => caught);
    expect(error.message).toBe("Field required. Invalid code.");
  });

  it("reports a server that cannot be reached", async () => {
    const fetchImpl = async () => {
      throw new TypeError("Failed to fetch");
    };
    const error = await apiRequest("http://server", "/health", { fetchImpl }).catch((caught) => caught);
    expect(error.status).toBe(0);
    expect(error.message).toMatch(/Could not reach the server/);
  });

  it("reports a request that times out", async () => {
    const fetchImpl = (_url, { signal }) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
      });
    const error = await apiRequest("http://server", "/health", { fetchImpl, timeoutMs: 10 }).catch((caught) => caught);
    expect(error.message).toMatch(/took too long/);
  });

  it("turns a non-JSON error page into a readable message", async () => {
    const fetchImpl = async () => ({ ok: false, status: 500, text: async () => "<html>oops</html>" });
    const error = await apiRequest("http://server", "/health", { fetchImpl }).catch((caught) => caught);
    expect(error.message).toBe("The server returned an error (500). Try again.");
  });

  it("asks for a server URL before making any request", async () => {
    const fetchImpl = vi.fn();
    const error = await apiRequest("", "/health", { fetchImpl }).catch((caught) => caught);
    expect(error.message).toBe("Enter the server URL first.");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
