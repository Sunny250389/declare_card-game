"""Send one test email using the SMTP settings in the environment.

Usage (from the repository root):
    python -m backend.send_test you@example.com
"""

from __future__ import annotations

import socket
import smtplib
import sys
from pathlib import Path

# Let this file run directly (python path\to\send_test.py) as well as with -m.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from backend import mailer  # noqa: E402


def main(argv: list[str]) -> int:
    if len(argv) != 2 or "@" not in argv[1]:
        print("Usage: python -m backend.send_test you@example.com")
        return 2

    settings = mailer.load_settings()
    if settings is None:
        print("Email is not configured. Set SMTP_HOST and SMTP_FROM first.")
        return 1

    recipient = argv[1]
    try:
        mailer.send_email(recipient, "Declare test email", "If you can read this, Declare can send verification emails.")
    except smtplib.SMTPAuthenticationError as error:
        print(f"Login was rejected by {settings.host}: {error.smtp_code} {error.smtp_error!r}")
        print("Check SMTP_USERNAME and SMTP_PASSWORD. Gmail needs an app password, not your normal password.")
        return 1
    except (smtplib.SMTPException, OSError, socket.timeout) as error:
        print(f"Could not send through {settings.host}:{settings.port}: {error}")
        return 1

    print(f"Sent a test email to {recipient} through {settings.host}:{settings.port}.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
