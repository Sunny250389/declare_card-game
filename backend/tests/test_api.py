import pytest
from fastapi.testclient import TestClient

import backend.app as app_module
from backend.store import Store


PASSWORD = "river walks on quiet hills"


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("ALLOW_DEVELOPMENT_CODES", "true")
    monkeypatch.delenv("SMTP_HOST", raising=False)
    monkeypatch.delenv("SMTP_FROM", raising=False)
    monkeypatch.setattr(app_module, "store", Store(":memory:"))
    app_module.connections.clear()
    with TestClient(app_module.app) as test_client:
        yield test_client


def register(client, email, username):
    response = client.post("/auth/signup", json={"email": email, "password": PASSWORD, "username": username})
    assert response.status_code == 200, response.text
    code = response.json()["development_code"]
    verified = client.post("/auth/verify-email", json={"email": email, "code": code})
    assert verified.status_code == 200, verified.text
    return verified.json()


def auth(session):
    return {"Authorization": f"Bearer {session['token']}"}


def player(session):
    return {"id": session["user"]["id"], "username": session["user"]["username"]}


def create_room(client, host, max_players=4):
    response = client.post(
        "/rooms",
        json={"host": player(host), "settings": {"max_players": max_players, "public": False}},
        headers=auth(host),
    )
    assert response.status_code == 200, response.text
    return response.json()["code"]


# --- Login robustness -------------------------------------------------------

def test_signup_rejects_invalid_email_and_weak_password(client):
    assert client.post("/auth/signup", json={"email": "not-an-email", "password": PASSWORD}).status_code == 400
    short = client.post("/auth/signup", json={"email": "a@example.com", "password": "short pass"})
    assert short.status_code == 400
    common = client.post("/auth/signup", json={"email": "a@example.com", "password": "correct horse battery staple"})
    assert common.status_code == 400


def test_email_is_case_insensitive_and_trimmed(client):
    register(client, "Player@Example.com", "Player")
    response = client.post("/auth/login", json={"email": "  PLAYER@example.com ", "password": PASSWORD})
    assert response.status_code == 200
    assert response.json()["user"]["email"] == "player@example.com"


def test_unverified_login_is_forbidden_until_verified(client):
    client.post("/auth/signup", json={"email": "new@example.com", "password": PASSWORD})
    response = client.post("/auth/login", json={"email": "new@example.com", "password": PASSWORD})
    assert response.status_code == 403


def test_repeated_wrong_codes_are_locked_out(client):
    response = client.post("/auth/signup", json={"email": "codes@example.com", "password": PASSWORD})
    real_code = response.json()["development_code"]
    wrong = "000000" if real_code != "000000" else "111111"
    for _ in range(5):
        assert client.post("/auth/verify-email", json={"email": "codes@example.com", "code": wrong}).status_code == 400
    assert client.post("/auth/verify-email", json={"email": "codes@example.com", "code": real_code}).status_code == 429


def test_failed_logins_lock_the_account_temporarily(client):
    register(client, "lock@example.com", "Lock")
    for _ in range(5):
        assert client.post("/auth/login", json={"email": "lock@example.com", "password": "wrong password here"}).status_code == 401
    assert client.post("/auth/login", json={"email": "lock@example.com", "password": PASSWORD}).status_code == 429


def test_resend_code_has_cooldown(client):
    client.post("/auth/signup", json={"email": "cool@example.com", "password": PASSWORD})
    assert client.post("/auth/resend-verification", json={"email": "cool@example.com"}).status_code == 429


def test_session_restore_and_logout(client):
    session = register(client, "session@example.com", "Session")
    assert client.get("/auth/me", headers=auth(session)).json()["email"] == "session@example.com"
    assert client.post("/auth/logout", headers=auth(session)).status_code == 200
    assert client.get("/auth/me", headers=auth(session)).status_code == 401


def test_password_reset_signs_out_old_sessions(client):
    old = register(client, "reset@example.com", "Reset")
    forgot = client.post("/auth/forgot-password", json={"email": "reset@example.com"})
    code = forgot.json()["development_code"]
    new_password = "a different river walks home"
    reset = client.post("/auth/reset-password", json={"email": "reset@example.com", "code": code, "password": new_password})
    assert reset.status_code == 200
    assert client.get("/auth/me", headers=auth(old)).status_code == 401
    assert client.post("/auth/login", json={"email": "reset@example.com", "password": new_password}).status_code == 200


def test_development_codes_are_hidden_unless_explicitly_enabled(client, monkeypatch):
    monkeypatch.setenv("ALLOW_DEVELOPMENT_CODES", "false")
    response = client.post("/auth/signup", json={"email": "prod@example.com", "password": PASSWORD})
    assert response.status_code == 503


# --- Rooms and online play --------------------------------------------------

def test_room_can_be_joined_by_code_and_plays_over_websocket(client):
    host = register(client, "host@example.com", "Host")
    guest = register(client, "guest@example.com", "Guest")
    code = create_room(client, host, max_players=3)

    joined = client.post(f"/rooms/{code.lower()}/join", json={"player": player(guest)}, headers=auth(guest))
    assert joined.status_code == 200
    assert len(joined.json()["players"]) == 2

    with client.websocket_connect(f"/ws/rooms/{code}?token={host['token']}") as host_ws:
        assert host_ws.receive_json()["type"] == "Snapshot"
        with client.websocket_connect(f"/ws/rooms/{code}?token={guest['token']}") as guest_ws:
            assert guest_ws.receive_json()["type"] == "Snapshot"

            host_ws.send_json({"type": "GameStarted", "payload": {}})
            started = host_ws.receive_json()["payload"]["match"]
            guest_ws.receive_json()
            assert started["status"] == "playing"
            # During play the host sees their own cards but not the guest's.
            assert all(card.get("hidden") for card in started["hands"][guest["user"]["id"]])
            assert not any(card.get("hidden") for card in started["hands"][host["user"]["id"]])

            # Out-of-turn actions produce an error for the sender only.
            guest_ws.send_json({"type": "CardDrawn", "payload": {"source": "draw"}})
            assert "not this player's turn" in guest_ws.receive_json()["payload"]["error"]

            # Picking up before discarding is rejected.
            host_ws.send_json({"type": "CardDrawn", "payload": {"source": "draw"}})
            assert "Discard before" in host_ws.receive_json()["payload"]["error"]

            # Discard first. The turn stays with the host.
            host_card = started["hands"][host["user"]["id"]][0]["id"]
            host_ws.send_json({"type": "CardsDiscarded", "payload": {"cardIds": [host_card]}})
            discarded = host_ws.receive_json()["payload"]["match"]
            guest_ws.receive_json()
            assert discarded["turn"]["hasDiscarded"] is True
            assert discarded["currentPlayerIndex"] == 0

            # After discarding, declaring is refused until the player picks up.
            host_ws.send_json({"type": "DeclareAttempted", "payload": {}})
            assert "before discarding" in host_ws.receive_json()["payload"]["error"]

            # Then pick up from the discard pile. The turn passes to the guest.
            host_ws.send_json({"type": "CardDrawn", "payload": {"source": "discard"}})
            picked = host_ws.receive_json()["payload"]["match"]
            guest_ws.receive_json()
            assert picked["currentPlayerIndex"] == 1
            assert len(picked["hands"][host["user"]["id"]]) == 5

            host_ws.send_json({"type": "Ping", "payload": {}})
            assert host_ws.receive_json()["type"] == "Pong"

            host_ws.send_text("this is not json")
            assert "error" in host_ws.receive_json()["payload"]

    # Joining is blocked while a match is in progress.
    third = register(client, "third@example.com", "Third")
    blocked = client.post(f"/rooms/{code}/join", json={"player": player(third)}, headers=auth(third))
    assert blocked.status_code == 409


def test_full_room_rejects_new_players(client):
    host = register(client, "full-host@example.com", "Host")
    guest = register(client, "full-guest@example.com", "Guest")
    third = register(client, "full-third@example.com", "Third")
    code = create_room(client, host, max_players=2)
    assert client.post(f"/rooms/{code}/join", json={"player": player(guest)}, headers=auth(guest)).status_code == 200
    assert client.post(f"/rooms/{code}/join", json={"player": player(third)}, headers=auth(third)).status_code == 409


def test_room_details_are_visible_only_to_members(client):
    host = register(client, "private-host@example.com", "Host")
    outsider = register(client, "outsider@example.com", "Outsider")
    code = create_room(client, host)
    assert client.get(f"/rooms/{code}", headers=auth(host)).status_code == 200
    assert client.get(f"/rooms/{code}", headers=auth(outsider)).status_code == 403


def test_player_can_leave_before_match_and_host_passes_on(client):
    host = register(client, "leave-host@example.com", "Host")
    guest = register(client, "leave-guest@example.com", "Guest")
    code = create_room(client, host)
    client.post(f"/rooms/{code}/join", json={"player": player(guest)}, headers=auth(guest))

    assert client.post(f"/rooms/{code}/leave", headers=auth(host)).status_code == 200
    room = client.get(f"/rooms/{code}", headers=auth(guest)).json()
    assert [item["id"] for item in room["players"]] == [guest["user"]["id"]]
    assert room["host_id"] == guest["user"]["id"]

    assert client.post(f"/rooms/{code}/leave", headers=auth(guest)).status_code == 200
    assert client.get(f"/rooms/{code}", headers=auth(guest)).status_code == 404


def test_rooms_and_accounts_survive_a_restart(monkeypatch, tmp_path):
    monkeypatch.setenv("ALLOW_DEVELOPMENT_CODES", "true")
    monkeypatch.delenv("SMTP_HOST", raising=False)
    database = str(tmp_path / "declare.sqlite3")

    monkeypatch.setattr(app_module, "store", Store(database))
    with TestClient(app_module.app) as first:
        host = register(first, "durable@example.com", "Host")
        code = create_room(first, host)
        token = host["token"]

    # New store object on the same file, as after a server restart.
    monkeypatch.setattr(app_module, "store", Store(database))
    with TestClient(app_module.app) as second:
        assert second.get(f"/rooms/{code}", headers={"Authorization": f"Bearer {token}"}).json()["code"] == code
        assert second.post("/auth/login", json={"email": "durable@example.com", "password": PASSWORD}).status_code == 200
