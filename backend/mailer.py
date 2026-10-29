from __future__ import annotations

import os
import smtplib
import ssl
from dataclasses import dataclass
from email.message import EmailMessage


@dataclass(frozen=True)
class SmtpSettings:
    host: str
    port: int
    sender: str
    username: str | None
    password: str | None
    use_ssl: bool
    starttls: bool


def load_settings() -> SmtpSettings | None:
    """Read SMTP settings from the environment. Returns None when email is not configured."""
    host = os.getenv("SMTP_HOST")
    sender = os.getenv("SMTP_FROM")
    if not host or not sender:
        return None
    use_ssl = os.getenv("SMTP_USE_SSL", "false").lower() == "true"
    default_port = "465" if use_ssl else "587"
    return SmtpSettings(
        host=host,
        port=int(os.getenv("SMTP_PORT", default_port)),
        sender=sender,
        username=os.getenv("SMTP_USERNAME") or None,
        password=os.getenv("SMTP_PASSWORD") or None,
        use_ssl=use_ssl,
        starttls=os.getenv("SMTP_STARTTLS", "true").lower() != "false",
    )


def build_message(settings: SmtpSettings, to: str, subject: str, body: str) -> EmailMessage:
    message = EmailMessage()
    message["Subject"] = subject
    message["From"] = settings.sender
    message["To"] = to
    message.set_content(body)
    return message


def send_email(to: str, subject: str, body: str) -> bool:
    """Send one email. Returns False when SMTP is not configured. Raises on delivery errors."""
    settings = load_settings()
    if settings is None:
        return False

    context = ssl.create_default_context()
    if settings.use_ssl:
        client = smtplib.SMTP_SSL(settings.host, settings.port, timeout=10, context=context)
    else:
        client = smtplib.SMTP(settings.host, settings.port, timeout=10)
    with client:
        if not settings.use_ssl and settings.starttls:
            client.starttls(context=context)
        if settings.username and settings.password:
            client.login(settings.username, settings.password)
        client.send_message(build_message(settings, to, subject, body))
    return True
