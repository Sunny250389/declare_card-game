import { useState } from "react";
import { Field, PrimaryButton, Screen, SecondaryButton, Segment } from "../components/ui.jsx";

const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

// Returns a message for the first problem with the form, or null when it can be submitted.
export function validateLogin({ mode, email, password, code }) {
  if (!email.trim() || (mode !== "verify" && !password)) return "Email and password are required.";
  if (!EMAIL_PATTERN.test(email.trim())) return "Enter a valid email address.";
  if (mode === "signup" && password.length < 15) return "Use a password or passphrase with at least 15 characters.";
  if ((mode === "verify" || mode === "reset") && !/^\d{6}$/.test(code)) return "Enter the six-digit code from your email.";
  return null;
}

function withDevelopmentCode(result) {
  return result.development_code ? `${result.message}\nDevelopment code: ${result.development_code}` : result.message;
}

export function LoginScreen({ backendUrl, setBackendUrl, onLogin, onResendVerification, onForgotPassword, onBack }) {
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function run(action) {
    setBusy(true);
    setMessage("");
    try {
      await action();
    } finally {
      setBusy(false);
    }
  }

  function submit(event) {
    event.preventDefault();
    const problem = validateLogin({ mode, email, password, code });
    if (problem) {
      setMessage(problem);
      return;
    }
    run(async () => {
      try {
        const result = await onLogin({ email: email.trim(), password, username: username.trim(), mode, verificationCode: code });
        if (result?.requires_verification) {
          setMode("verify");
          setMessage(withDevelopmentCode(result));
        }
      } catch (error) {
        // The server refuses sign-in until the email is verified. Take the player to the code step.
        if (error.status === 403 && mode === "login") {
          setMode("verify");
          setMessage("Your email is not verified yet. Enter the code we sent, or request a new one.");
        } else {
          setMessage(error.message);
        }
      }
    });
  }

  function forgot() {
    if (!email.trim()) {
      setMessage("Enter your email first.");
      return;
    }
    run(async () => {
      try {
        const result = await onForgotPassword(email.trim());
        setMode("reset");
        setMessage(withDevelopmentCode(result));
      } catch (error) {
        setMessage(error.message);
      }
    });
  }

  function resend() {
    if (!email.trim()) {
      setMessage("Enter your email first.");
      return;
    }
    run(async () => {
      try {
        setMessage(withDevelopmentCode(await onResendVerification(email.trim())));
      } catch (error) {
        setMessage(error.message);
      }
    });
  }

  const title = mode === "verify" ? "Verify email" : mode === "reset" ? "Reset password" : "Play together.";
  const submitLabel = mode === "login" ? "Login" : mode === "signup" ? "Create Account" : mode === "verify" ? "Verify Email" : "Reset Password";
  const codeStep = mode === "verify" || mode === "reset";

  return (
    <Screen>
      <div className="hero">
        <p className="kicker">DECLARE</p>
        <h1 className="title">{title}</h1>
      </div>
      {!codeStep && (
        <div className="segment-row">
          <Segment label="Login" active={mode === "login"} onClick={() => { setMode("login"); setMessage(""); }} />
          <Segment label="Sign Up" active={mode === "signup"} onClick={() => { setMode("signup"); setMessage(""); }} />
        </div>
      )}
      <form className="panel" onSubmit={submit} noValidate>
        <Field label="Server URL">
          <input className="input" value={backendUrl} autoCapitalize="none" placeholder="http://192.168.0.111:8000" onChange={(event) => setBackendUrl(event.target.value)} />
        </Field>
        {mode === "signup" && (
          <Field label="Username">
            <input className="input" value={username} placeholder="Your player name" onChange={(event) => setUsername(event.target.value)} />
          </Field>
        )}
        <Field label="Email">
          <input className="input" type="email" value={email} autoComplete="email" placeholder="you@example.com" onChange={(event) => setEmail(event.target.value)} />
        </Field>
        {codeStep ? (
          <>
            <Field label={mode === "verify" ? "Verification code" : "Reset code"}>
              <input className="input" inputMode="numeric" maxLength={6} value={code} placeholder="6-digit code" onChange={(event) => setCode(event.target.value)} />
            </Field>
            {mode === "reset" && (
              <Field label="New password">
                <input className="input" type="password" value={password} autoComplete="new-password" placeholder="Password or passphrase" onChange={(event) => setPassword(event.target.value)} />
              </Field>
            )}
          </>
        ) : (
          <Field label="Password">
            <span className="password-row">
              <input
                className="input"
                type={showPassword ? "text" : "password"}
                value={password}
                autoComplete={mode === "signup" ? "new-password" : "current-password"}
                placeholder="Password or passphrase"
                onChange={(event) => setPassword(event.target.value)}
              />
              <SecondaryButton label={showPassword ? "Hide" : "Show"} onClick={() => setShowPassword(!showPassword)} compact />
            </span>
          </Field>
        )}
        {(mode === "signup" || mode === "reset") && (
          <p className="muted small">Use 15 to 128 characters. Common passwords are blocked; spaces and symbols are allowed.</p>
        )}
        {message && <p className="status-text">{message}</p>}
        <button type="submit" className="btn primary" disabled={busy}>{submitLabel}</button>
      </form>
      {mode === "verify" ? <SecondaryButton label="Resend Code" onClick={resend} disabled={busy} /> : mode === "reset" ? <SecondaryButton label="Request Another Code" onClick={forgot} disabled={busy} /> : <SecondaryButton label="Forgot Password" onClick={forgot} disabled={busy} />}
      {codeStep ? <SecondaryButton label="Back to login" onClick={() => { setMode("login"); setMessage(""); }} /> : <SecondaryButton label="Back" onClick={onBack} />}
    </Screen>
  );
}
