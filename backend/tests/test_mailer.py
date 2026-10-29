import re
import smtplib

import pytest
from fastapi.testclient import TestClient

import backend.app as app_module
from backend import mailer
from backend.store import Store


PASSWORD = "river walks on quiet hills"


class FakeSMTP:
    sent = []

    def __init__(self, host, port, timeout=None, context=None):
        self.host = host
        self.port = port
        self.calls = []
        FakeSMTP.sent.append(self)

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.calls.append("quit")

    def starttls(self, context=None):
        self.calls.append("starttls")

    def login(self, username, password):
        self.calls.append(("login", username))

    def send_message(self, message):
        self.calls.append(("send", message["To"], message["Subject"], message.get_content()))


class FakeSMTPSSL(FakeSMTP):
    pass


@pytest.fixture(autouse=True)
def clean_env(monkeypatch):
    for name in ["SMTP_HOST", "SMTP_PORT", "SMTP_FROM", "SMTP_USERNAME", "SMTP_PASSWORD", "SMTP_STARTTLS", "SMTP_USE_SSL", "ALLOW_DEVELOPMENT_CODES"]:
        monkeypatch.delenv(name, raising=False)
    FakeSMTP.sent = []
    monkeypatch.setattr(mailer.smtplib, "SMTP", FakeSMTP)
    monkeypatch.setattr(mailer.smtplib, "SMTP_SSL", FakeSMTPSSL)


def configure(monkeypatch, **values):
    base = {"SMTP_HOST": "smtp.example.com", "SMTP_FROM": "no-reply@example.com", "SMTP_USERNAME": "user", "SMTP_PASSWORD": "secret"}
    for name, value in {**base, **values}.items():
        monkeypatch.setenv(name, value)


def test_unconfigured_email_returns_false_without_connecting(monkeypatch):
    def fail(*_args, **_kwargs):
        raise AssertionError("should not connect")

    monkeypatch.setattr(mailer.smtplib, "SMTP", fail)
    assert mailer.send_email("someone@example.com", "Subject", "Body") is False


def test_starttls_on_port_587_with_login(monkeypatch):
    configure(monkeypatch)
    assert mailer.send_email("someone@example.com", "Verify", "Code 123456") is True
    connection = FakeSMTP.sent[0]
    assert connection.port == 587
    assert connection.calls[0] == "starttls"
    assert connection.calls[1] == ("login", "user")
    assert connection.calls[2] == ("send", "someone@example.com", "Verify", "Code 123456\n")


def test_implicit_tls_on_port_465(monkeypatch):
    configure(monkeypatch, SMTP_USE_SSL="true")
    mailer.send_email("someone@example.com", "Verify", "Code")
    connection = FakeSMTP.sent[0]
    assert isinstance(connection, FakeSMTPSSL)
    assert connection.port == 465
    assert "starttls" not in connection.calls
    assert connection.calls[0] == ("login", "user")


def test_starttls_can_be_turned_off(monkeypatch):
    configure(monkeypatch, SMTP_STARTTLS="false", SMTP_PORT="2525")
    mailer.send_email("someone@example.com", "Verify", "Code")
    connection = FakeSMTP.sent[0]
    assert connection.port == 2525
    assert "starttls" not in connection.calls


def test_signup_emails_the_code_and_does_not_reveal_it(monkeypatch):
    configure(monkeypatch)
    monkeypatch.setattr(app_module, "store", Store(":memory:"))
    with TestClient(app_module.app) as client:
        response = client.post("/auth/signup", json={"email": "mail@example.com", "password": PASSWORD})
    assert response.status_code == 200
    assert response.json().get("development_code") is None
    sent = [call for connection in FakeSMTP.sent for call in connection.calls if isinstance(call, tuple) and call[0] == "send"]
    assert sent, "a verification email should be sent"
    assert sent[0][1] == "mail@example.com"
    assert re.search(r"\b\d{6}\b", sent[0][3])


def test_smtp_failure_is_a_clear_error_in_production(monkeypatch):
    configure(monkeypatch)

    class BrokenSMTP(FakeSMTP):
        def send_message(self, message):
            raise smtplib.SMTPException("relay denied")

    monkeypatch.setattr(mailer.smtplib, "SMTP", BrokenSMTP)
    monkeypatch.setattr(app_module, "store", Store(":memory:"))
    with TestClient(app_module.app) as client:
        response = client.post("/auth/signup", json={"email": "fail@example.com", "password": PASSWORD})
    assert response.status_code == 503
    assert "Email delivery is not configured" in response.json()["detail"]
