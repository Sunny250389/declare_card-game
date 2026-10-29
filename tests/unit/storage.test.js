import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SAVE_KEY, parseStoredSession, readItem, resumableMatch, savedMatchKey, writeItem } from "../../src/storage.js";

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("resumableMatch", () => {
  it("offers an unfinished local match", () => {
    const match = { mode: "local", status: "playing", roundNumber: 2 };
    expect(resumableMatch(JSON.stringify(match))).toEqual(match);
    expect(resumableMatch(JSON.stringify({ mode: "local", status: "roundResult" }))).not.toBeNull();
  });

  it("does not offer a finished match", () => {
    expect(resumableMatch(JSON.stringify({ mode: "local", status: "matchResult" }))).toBeNull();
  });

  it("does not offer an online match", () => {
    expect(resumableMatch(JSON.stringify({ mode: "online", status: "playing" }))).toBeNull();
  });

  it("ignores missing or corrupt data", () => {
    expect(resumableMatch(null)).toBeNull();
    expect(resumableMatch("{not json")).toBeNull();
  });
});

describe("saved match keys", () => {
  it("gives each account its own slot and guests a shared one", () => {
    expect(savedMatchKey("user-1")).toBe(`${SAVE_KEY}.user-1`);
    expect(savedMatchKey("user-2")).not.toBe(savedMatchKey("user-1"));
    expect(savedMatchKey(undefined)).toBe(SAVE_KEY);
  });
});

describe("stored session", () => {
  it("needs both a user and a token", () => {
    expect(parseStoredSession(JSON.stringify({ user: { id: "u" }, token: "t" }))).not.toBeNull();
    expect(parseStoredSession(JSON.stringify({ user: { id: "u" } }))).toBeNull();
    expect(parseStoredSession(JSON.stringify({ token: "t" }))).toBeNull();
    expect(parseStoredSession("oops")).toBeNull();
    expect(parseStoredSession(null)).toBeNull();
  });
});

describe("storage access", () => {
  it("reads back what was written", () => {
    writeItem("declare.test", "value");
    expect(readItem("declare.test")).toBe("value");
  });

  it("keeps working when the browser blocks storage", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(readItem("anything")).toBeNull();
    expect(() => writeItem("anything", "x")).not.toThrow();
  });
});
