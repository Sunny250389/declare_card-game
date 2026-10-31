import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { WelcomeScreen } from "../../src/screens/Welcome.jsx";
import { LoginScreen, validateLogin } from "../../src/screens/Login.jsx";
import { pickupCardFor, visibleHand } from "../../src/screens/Gameplay.jsx";
import { createMatch } from "../../src/engine/gameEngine.js";

afterEach(() => {
  cleanup();
});

describe("WelcomeScreen", () => {
  it("offers login and play without an account", () => {
    const onLogin = vi.fn();
    const onPlayWithoutAccount = vi.fn();
    render(<WelcomeScreen onLogin={onLogin} onPlayWithoutAccount={onPlayWithoutAccount} />);

    fireEvent.click(screen.getByRole("button", { name: "Login or Sign Up" }));
    fireEvent.click(screen.getByRole("button", { name: "Play without account" }));

    expect(onLogin).toHaveBeenCalledTimes(1);
    expect(onPlayWithoutAccount).toHaveBeenCalledTimes(1);
  });
});

describe("validateLogin", () => {
  it("requires an email and a password for sign-in", () => {
    expect(validateLogin({ mode: "login", email: "", password: "x", code: "" })).toBe("Email and password are required.");
    expect(validateLogin({ mode: "login", email: "a@example.com", password: "", code: "" })).toBe("Email and password are required.");
  });

  it("rejects malformed email addresses", () => {
    expect(validateLogin({ mode: "login", email: "not-an-email", password: "pw", code: "" })).toBe("Enter a valid email address.");
  });

  it("enforces the 15-character minimum when signing up", () => {
    expect(validateLogin({ mode: "signup", email: "a@example.com", password: "short", code: "" })).toMatch(/at least 15/);
    expect(validateLogin({ mode: "signup", email: "a@example.com", password: "river walks on quiet hills", code: "" })).toBeNull();
  });

  it("requires a six-digit code on the code steps", () => {
    expect(validateLogin({ mode: "verify", email: "a@example.com", password: "", code: "12345" })).toMatch(/six-digit/);
    expect(validateLogin({ mode: "verify", email: "a@example.com", password: "", code: "123456" })).toBeNull();
    expect(validateLogin({ mode: "reset", email: "a@example.com", password: "river walks on quiet hills", code: "12a456" })).toMatch(/six-digit/);
  });

  it("shows the validation message in the form instead of calling the server", () => {
    const onLogin = vi.fn();
    const { container } = render(
      <LoginScreen backendUrl="http://localhost:8000" setBackendUrl={() => {}} onLogin={onLogin} onResendVerification={() => {}} onForgotPassword={() => {}} onBack={() => {}} />
    );
    fireEvent.change(screen.getByPlaceholderText("you@example.com"), { target: { value: "bad" } });
    fireEvent.change(screen.getByPlaceholderText("Password or passphrase"), { target: { value: "pw" } });
    fireEvent.click(container.querySelector('button[type="submit"]'));

    expect(screen.getByText("Enter a valid email address.")).toBeTruthy();
    expect(onLogin).not.toHaveBeenCalled();
  });
});

describe("what the player may see", () => {
  it("shows the local viewer's hand only during their own turn", () => {
    const match = createMatch({
      players: [
        { id: "p1", name: "You", type: "human", difficulty: "medium" },
        { id: "p2", name: "Mira", type: "ai", difficulty: "medium" }
      ],
      seed: 6
    });
    expect(visibleHand(match, null)).toEqual(match.hands.p1);
    const aiTurn = { ...match, currentPlayerIndex: 1 };
    expect(visibleHand(aiTurn, null)).toEqual([]);
  });

  it("always shows the signed-in player's own hand online", () => {
    const match = createMatch({
      players: [
        { id: "p1", name: "Ava", type: "human", difficulty: "medium" },
        { id: "p2", name: "Ben", type: "human", difficulty: "medium" }
      ],
      seed: 6
    });
    const benTurn = { ...match, currentPlayerIndex: 1 };
    expect(visibleHand(benTurn, "p1")).toEqual(match.hands.p1);
  });

  it("offers the top card before discarding, and the pickup card afterwards", () => {
    const match = createMatch({
      players: [
        { id: "p1", name: "You", type: "human", difficulty: "medium" },
        { id: "p2", name: "Mira", type: "ai", difficulty: "medium" }
      ],
      seed: 6
    });
    const starter = match.discardPile[0];
    expect(pickupCardFor(match)).toEqual(starter);
    const discarded = { ...match, turn: { hasDiscarded: true, hasDrawn: false, pickupCardId: starter.id } };
    expect(pickupCardFor(discarded)).toEqual(starter);
  });
});
