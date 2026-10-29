from __future__ import annotations

import base64
import hashlib
import hmac
import json
import math
import os
import random
import re
import smtplib
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from enum import StrEnum
from pathlib import Path
from secrets import token_hex
from typing import Any

from fastapi import Depends, FastAPI, Header, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, ValidationError

from backend import mailer
from backend.store import Store


RULES = json.loads((Path(__file__).resolve().parent.parent / "shared" / "rules.json").read_text(encoding="utf-8"))
MATCH_LIMIT = RULES["match_limit"]
DECLARE_LIMIT = RULES["declare_limit"]
HAND_SIZE = RULES["hand_size"]
RANKS = RULES["ranks"]
SUITS = RULES["suits"]

PASSWORD_MIN = 15
PASSWORD_MAX = 128
USERNAME_MIN = 2
USERNAME_MAX = 24
EMAIL_MAX = 254
EMAIL_PATTERN = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
COMMON_PASSWORDS = {
    "123456789", "1234567890", "password", "password123", "qwertyuiop",
    "letmein123", "welcome123", "declare123", "iloveyou123", "adminadmin",
    "passwordpassword", "correct horse battery staple", "iloveyouforever", "qwertyuiopasdfgh",
    "letmeinplease123",
}
CODE_TTL = timedelta(minutes=15)
CODE_RESEND_SECONDS = 60
CODE_MAX_ATTEMPTS = 5
LOGIN_MAX_FAILURES = 5
LOGIN_LOCK = timedelta(minutes=15)
SESSION_TTL = timedelta(days=30)
ROOM_EVENT_LIMIT = 100


store = Store(os.getenv("DATABASE_PATH", "data/declare.sqlite3"))
connections: dict[str, list[tuple[WebSocket, str]]] = {}


def cors_origins() -> list[str]:
    raw = os.getenv("CORS_ORIGINS", "*")
    return [origin.strip() for origin in raw.split(",") if origin.strip()]


app = FastAPI(title="Declare Online Backend", version="0.3.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins(),
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


class EventType(StrEnum):
    PLAYER_CONNECTED = "PlayerConnected"
    PLAYER_DISCONNECTED = "PlayerDisconnected"
    ROOM_CREATED = "RoomCreated"
    ROOM_JOINED = "RoomJoined"
    ROOM_LEFT = "RoomLeft"
    PLAYER_READY = "PlayerReady"
    GAME_STARTED = "GameStarted"
    GAME_STATE_SYNCED = "GameStateSynced"
    TURN_STARTED = "TurnStarted"
    CARD_DRAWN = "CardDrawn"
    CARDS_DISCARDED = "CardsDiscarded"
    DECLARE_ATTEMPTED = "DeclareAttempted"
    DECLARE_RESOLVED = "DeclareResolved"
    ROUND_FINISHED = "RoundFinished"
    SCORE_UPDATED = "ScoreUpdated"
    MATCH_FINISHED = "MatchFinished"
    PLAYER_RECONNECTED = "PlayerReconnected"
    CHAT_MESSAGE_RECEIVED = "ChatMessageReceived"
    SPECTATOR_JOINED = "SpectatorJoined"


class PlayerProfile(BaseModel):
    id: str
    username: str
    avatar: str | None = None
    ready: bool = False


class AuthUser(BaseModel):
    id: str
    username: str
    email: str


class StoredUser(AuthUser):
    password_hash: str
    password_salt: str
    email_verified: bool = False
    session_version: int = 0
    verification_hash: str | None = None
    verification_expires_at: datetime | None = None
    verification_attempts: int = 0
    verification_sent_at: datetime | None = None
    reset_hash: str | None = None
    reset_expires_at: datetime | None = None
    reset_attempts: int = 0
    reset_sent_at: datetime | None = None


class AuthRequest(BaseModel):
    email: str = Field(max_length=EMAIL_MAX)
    password: str = Field(max_length=512)
    username: str | None = Field(default=None, max_length=64)


class VerifyEmailRequest(BaseModel):
    email: str = Field(max_length=EMAIL_MAX)
    code: str = Field(pattern=r"^\d{6}$")


class EmailRequest(BaseModel):
    email: str = Field(max_length=EMAIL_MAX)


class ResetPasswordRequest(BaseModel):
    email: str = Field(max_length=EMAIL_MAX)
    code: str = Field(pattern=r"^\d{6}$")
    password: str = Field(max_length=512)


class AuthResponse(BaseModel):
    user: AuthUser
    token: str
    message: str


class VerificationResponse(BaseModel):
    requires_verification: bool = True
    message: str
    development_code: str | None = None


class CodeDeliveryResponse(BaseModel):
    message: str
    development_code: str | None = None


class MessageResponse(BaseModel):
    message: str


class RoomSettings(BaseModel):
    max_players: int = Field(default=4, ge=2, le=6)
    public: bool = True
    ai_fill_empty_seats: bool = True
    turn_timer_seconds: int = Field(default=45, ge=10, le=180)
    spectators_enabled: bool = True


class Room(BaseModel):
    code: str
    host_id: str
    settings: RoomSettings
    players: list[PlayerProfile]
    spectators: list[str] = Field(default_factory=list)
    event_stream: list[dict[str, Any]] = Field(default_factory=list)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class CreateRoomRequest(BaseModel):
    host: PlayerProfile
    settings: RoomSettings = Field(default_factory=RoomSettings)


class JoinRoomRequest(BaseModel):
    player: PlayerProfile


class ClientEvent(BaseModel):
    type: EventType
    payload: dict[str, Any] = Field(default_factory=dict)


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def minutes_until(moment: datetime) -> int:
    return max(1, math.ceil((moment - utc_now()).total_seconds() / 60))


# ---------------------------------------------------------------------------
# Accounts, codes, and sessions
# ---------------------------------------------------------------------------

def normalize_email(value: str) -> str:
    return value.strip().lower()


def validate_email(email: str) -> None:
    if len(email) > EMAIL_MAX or not EMAIL_PATTERN.match(email):
        raise HTTPException(status_code=400, detail="Enter a valid email address.")


def clean_username(value: str | None, email: str) -> str:
    if value is None or not value.strip():
        return email.split("@")[0][:USERNAME_MAX] or "Player"
    name = " ".join(value.split())
    if not USERNAME_MIN <= len(name) <= USERNAME_MAX:
        raise HTTPException(status_code=400, detail=f"Username must be {USERNAME_MIN} to {USERNAME_MAX} characters.")
    return name


def password_error(password: str) -> str | None:
    if len(password) < PASSWORD_MIN:
        return f"Use a password or passphrase with at least {PASSWORD_MIN} characters."
    if len(password) > PASSWORD_MAX:
        return f"Password must be {PASSWORD_MAX} characters or fewer."
    if password.casefold() in COMMON_PASSWORDS:
        return "Choose a less common password or passphrase."
    return None


def hash_password(password: str, salt: bytes | None = None) -> tuple[str, str]:
    salt = salt or os.urandom(16)
    digest = hashlib.scrypt(password.encode("utf-8"), salt=salt, n=2**14, r=8, p=1)
    return base64.b64encode(digest).decode("ascii"), base64.b64encode(salt).decode("ascii")


def password_matches(password: str, user: StoredUser) -> bool:
    salt = base64.b64decode(user.password_salt)
    digest, _ = hash_password(password, salt)
    return hmac.compare_digest(digest, user.password_hash)


def digest_text(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def get_user(email: str) -> StoredUser | None:
    data = store.get("users", email)
    return StoredUser.model_validate(data) if data else None


def save_user(user: StoredUser) -> None:
    store.put("users", user.email, user.model_dump(mode="json"))


def issue_code(user: StoredUser, purpose: str) -> str:
    """Create a six-digit code for `verification` or `reset`, replacing any previous one."""
    code = f"{random.SystemRandom().randint(0, 999999):06d}"
    setattr(user, f"{purpose}_hash", digest_text(code))
    setattr(user, f"{purpose}_expires_at", utc_now() + CODE_TTL)
    setattr(user, f"{purpose}_attempts", 0)
    setattr(user, f"{purpose}_sent_at", utc_now())
    return code


def clear_code(user: StoredUser, purpose: str) -> None:
    setattr(user, f"{purpose}_hash", None)
    setattr(user, f"{purpose}_expires_at", None)
    setattr(user, f"{purpose}_attempts", 0)


def resend_wait_seconds(user: StoredUser, purpose: str) -> int:
    sent_at = getattr(user, f"{purpose}_sent_at")
    if sent_at is None:
        return 0
    elapsed = (utc_now() - sent_at).total_seconds()
    return max(0, math.ceil(CODE_RESEND_SECONDS - elapsed))


def check_code(user: StoredUser, purpose: str, code: str) -> None:
    """Raise unless `code` matches the pending code. Failed attempts are counted and saved."""
    stored_hash = getattr(user, f"{purpose}_hash")
    expires_at = getattr(user, f"{purpose}_expires_at")
    if stored_hash is None or expires_at is None:
        raise HTTPException(status_code=400, detail="Request a new code first.")
    if utc_now() > expires_at:
        clear_code(user, purpose)
        save_user(user)
        raise HTTPException(status_code=400, detail="That code has expired. Request a new one.")
    attempts = getattr(user, f"{purpose}_attempts")
    if attempts >= CODE_MAX_ATTEMPTS:
        clear_code(user, purpose)
        save_user(user)
        raise HTTPException(status_code=429, detail="Too many incorrect codes. Request a new one.")
    if not hmac.compare_digest(digest_text(code), stored_hash):
        setattr(user, f"{purpose}_attempts", attempts + 1)
        save_user(user)
        left = CODE_MAX_ATTEMPTS - attempts - 1
        raise HTTPException(status_code=400, detail=f"That code is invalid. {left} attempts left.")


def check_login_lock(email: str) -> None:
    record = store.get("login_failures", email)
    if record and record.get("locked_until"):
        locked_until = datetime.fromisoformat(record["locked_until"])
        if utc_now() < locked_until:
            raise HTTPException(status_code=429, detail=f"Too many failed sign-ins. Try again in {minutes_until(locked_until)} minutes.")
        store.delete("login_failures", email)


def record_login_failure(email: str) -> None:
    record = store.get("login_failures", email) or {"failures": 0, "locked_until": None}
    record["failures"] += 1
    if record["failures"] >= LOGIN_MAX_FAILURES:
        record = {"failures": 0, "locked_until": (utc_now() + LOGIN_LOCK).isoformat()}
    store.put("login_failures", email, record)


def token_key(token: str) -> str:
    return digest_text(token)


def create_session(user: StoredUser) -> str:
    token = token_hex(32)
    store.put("sessions", token_key(token), {
        "email": user.email,
        "version": user.session_version,
        "expires_at": (utc_now() + SESSION_TTL).isoformat(),
    })
    return token


def user_for_token(token: str) -> StoredUser | None:
    if not token:
        return None
    key = token_key(token)
    record = store.get("sessions", key)
    if record is None:
        return None
    if utc_now() > datetime.fromisoformat(record["expires_at"]):
        store.delete("sessions", key)
        return None
    user = get_user(record["email"])
    if user is None or not user.email_verified or user.session_version != record["version"]:
        return None
    return user


def public_user(user: StoredUser) -> AuthUser:
    return AuthUser(id=user.id, username=user.username, email=user.email)


def make_auth_response(user: StoredUser, message: str) -> AuthResponse:
    return AuthResponse(user=public_user(user), token=create_session(user), message=message)


def bearer_token(authorization: str | None) -> str:
    return authorization.removeprefix("Bearer ").strip() if authorization else ""


def current_user(authorization: str | None = Header(default=None)) -> StoredUser:
    user = user_for_token(bearer_token(authorization))
    if user is None:
        raise HTTPException(status_code=401, detail="Your session has ended. Sign in again.")
    return user


def development_codes_allowed() -> bool:
    """Show codes in API responses only when explicitly enabled. Never enable on a public server."""
    return os.getenv("ALLOW_DEVELOPMENT_CODES", "").lower() == "true"


def deliver_code(email: str, subject: str, content: str) -> bool:
    try:
        return mailer.send_email(email, subject, content)
    except (OSError, smtplib.SMTPException):
        return False


def verification_response(user: StoredUser, code: str) -> VerificationResponse:
    if deliver_code(user.email, "Verify your Declare account", f"Your Declare verification code is {code}. It expires in 15 minutes."):
        return VerificationResponse(message="We emailed a six-digit verification code. It expires in 15 minutes.")
    if not development_codes_allowed():
        raise HTTPException(status_code=503, detail="Email delivery is not configured on this server.")
    return VerificationResponse(
        message="Email delivery is not configured. Use the development verification code shown below.",
        development_code=code,
    )


def reset_response(user: StoredUser, code: str) -> CodeDeliveryResponse:
    if deliver_code(user.email, "Reset your Declare password", f"Your Declare password reset code is {code}. It expires in 15 minutes."):
        return CodeDeliveryResponse(message="We emailed a six-digit password reset code. It expires in 15 minutes.")
    if not development_codes_allowed():
        raise HTTPException(status_code=503, detail="Email delivery is not configured on this server.")
    return CodeDeliveryResponse(
        message="Email delivery is not configured. Use the development reset code shown below.",
        development_code=code,
    )


# ---------------------------------------------------------------------------
# Auth routes
# ---------------------------------------------------------------------------

@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/auth/signup", response_model=VerificationResponse)
def signup(request: AuthRequest) -> VerificationResponse:
    email = normalize_email(request.email)
    validate_email(email)
    error = password_error(request.password)
    if error:
        raise HTTPException(status_code=400, detail=error)
    username = clean_username(request.username, email)

    with store.lock:
        user = get_user(email)
        if user and user.email_verified:
            raise HTTPException(status_code=409, detail="An account already exists for this email. Log in instead.")
        if user:
            wait = resend_wait_seconds(user, "verification")
            if wait:
                raise HTTPException(status_code=429, detail=f"Wait {wait} seconds before requesting another code.")
            user.username = username
            user.password_hash, user.password_salt = hash_password(request.password)
        else:
            password_hash, password_salt = hash_password(request.password)
            user = StoredUser(
                id=f"user-{token_hex(8)}",
                username=username,
                email=email,
                password_hash=password_hash,
                password_salt=password_salt,
            )
        code = issue_code(user, "verification")
        save_user(user)
    return verification_response(user, code)


@app.post("/auth/verify-email", response_model=AuthResponse)
def verify_email(request: VerifyEmailRequest) -> AuthResponse:
    email = normalize_email(request.email)
    with store.lock:
        user = get_user(email)
        if user is None or user.email_verified:
            raise HTTPException(status_code=400, detail="Request a new verification code first.")
        check_code(user, "verification", request.code)
        user.email_verified = True
        clear_code(user, "verification")
        save_user(user)
        return make_auth_response(user, "Email verified. You are signed in.")


@app.post("/auth/resend-verification", response_model=VerificationResponse)
def resend_verification(request: EmailRequest) -> VerificationResponse:
    email = normalize_email(request.email)
    with store.lock:
        user = get_user(email)
        if user is None or user.email_verified:
            raise HTTPException(status_code=400, detail="No unverified account was found for this email.")
        wait = resend_wait_seconds(user, "verification")
        if wait:
            raise HTTPException(status_code=429, detail=f"Wait {wait} seconds before requesting another code.")
        code = issue_code(user, "verification")
        save_user(user)
    return verification_response(user, code)


@app.post("/auth/login", response_model=AuthResponse)
def login(request: AuthRequest) -> AuthResponse:
    email = normalize_email(request.email)
    check_login_lock(email)
    with store.lock:
        user = get_user(email)
        if user is None or not password_matches(request.password, user):
            record_login_failure(email)
            raise HTTPException(status_code=401, detail="Email or password is incorrect.")
        if not user.email_verified:
            raise HTTPException(status_code=403, detail="Verify your email before logging in.")
        store.delete("login_failures", email)
        return make_auth_response(user, "Logged in.")


@app.get("/auth/me", response_model=AuthUser)
def me(user: StoredUser = Depends(current_user)) -> AuthUser:
    return public_user(user)


@app.post("/auth/logout", response_model=MessageResponse)
def logout(authorization: str | None = Header(default=None)) -> MessageResponse:
    token = bearer_token(authorization)
    if token:
        store.delete("sessions", token_key(token))
    return MessageResponse(message="Signed out.")


@app.post("/auth/forgot-password", response_model=CodeDeliveryResponse)
def forgot_password(request: EmailRequest) -> CodeDeliveryResponse:
    email = normalize_email(request.email)
    generic = CodeDeliveryResponse(message="If an account exists, a password reset code has been sent.")
    with store.lock:
        user = get_user(email)
        if user is None or not user.email_verified or resend_wait_seconds(user, "reset"):
            return generic
        code = issue_code(user, "reset")
        save_user(user)
    return reset_response(user, code)


@app.post("/auth/reset-password", response_model=AuthResponse)
def reset_password(request: ResetPasswordRequest) -> AuthResponse:
    email = normalize_email(request.email)
    error = password_error(request.password)
    if error:
        raise HTTPException(status_code=400, detail=error)
    with store.lock:
        user = get_user(email)
        if user is None or not user.email_verified:
            raise HTTPException(status_code=400, detail="Request a password reset code first.")
        check_code(user, "reset", request.code)
        user.password_hash, user.password_salt = hash_password(request.password)
        user.session_version += 1
        clear_code(user, "reset")
        save_user(user)
        return make_auth_response(user, "Password reset. You are signed in.")


# ---------------------------------------------------------------------------
# Rooms and online matches
# ---------------------------------------------------------------------------

def load_room(code: str) -> Room | None:
    data = store.get("rooms", code)
    return Room.model_validate(data) if data else None


def save_room(room: Room) -> None:
    store.put("rooms", room.code, room.model_dump(mode="json"))


def load_match(code: str) -> dict[str, Any] | None:
    return store.get("matches", code)


def save_match(code: str, match: dict[str, Any]) -> None:
    store.put("matches", code, match)


def match_in_progress(code: str) -> bool:
    match = load_match(code)
    return match is not None and match["status"] in {"playing", "roundResult"}


def is_member(room: Room, user_id: str) -> bool:
    return any(player.id == user_id for player in room.players)


def new_room_code() -> str:
    while True:
        code = token_hex(3).upper()
        if load_room(code) is None:
            return code


def record_room_event(room: Room, event: dict[str, Any]) -> None:
    """Keep a short room log. Match snapshots are omitted to keep stored rooms small."""
    summary = {
        **event,
        "payload": {key: value for key, value in event["payload"].items() if key not in {"match", "room"}},
    }
    room.event_stream = [*room.event_stream[-(ROOM_EVENT_LIMIT - 1):], summary]


@app.post("/rooms")
def create_room(request: CreateRoomRequest, user: StoredUser = Depends(current_user)) -> Room:
    if request.host.id != user.id:
        raise HTTPException(status_code=403, detail="Room host does not match the signed-in account.")
    with store.lock:
        code = new_room_code()
        room = Room(code=code, host_id=user.id, settings=request.settings, players=[PlayerProfile(id=user.id, username=user.username)])
        event = make_event(EventType.ROOM_CREATED, user.id, {"code": code})
        record_room_event(room, event)
        save_room(room)
    return room


@app.get("/rooms/{code}")
def get_room(code: str, user: StoredUser = Depends(current_user)) -> Room:
    room = load_room(code.upper())
    if room is None:
        raise HTTPException(status_code=404, detail="Room not found. Check the code and try again.")
    if not is_member(room, user.id):
        raise HTTPException(status_code=403, detail="Join this room before viewing it.")
    return room


@app.post("/rooms/{code}/join")
async def join_room(code: str, request: JoinRoomRequest, user: StoredUser = Depends(current_user)) -> Room:
    code = code.upper()
    if request.player.id != user.id:
        raise HTTPException(status_code=403, detail="Room player does not match the signed-in account.")
    with store.lock:
        room = load_room(code)
        if room is None:
            raise HTTPException(status_code=404, detail="Room not found. Check the code and try again.")
        if not is_member(room, user.id):
            if len(room.players) >= room.settings.max_players:
                raise HTTPException(status_code=409, detail="Room is full.")
            if match_in_progress(code):
                raise HTTPException(status_code=409, detail="A match is already in progress. Join once it finishes.")
            room.players.append(PlayerProfile(id=user.id, username=user.username))
        event = make_event(EventType.ROOM_JOINED, user.id, {"player": {"id": user.id, "username": user.username}, "room": room.model_dump(mode="json")})
        record_room_event(room, event)
        save_room(room)
    await broadcast(code, event)
    return room


@app.post("/rooms/{code}/leave", response_model=MessageResponse)
async def leave_room(code: str, user: StoredUser = Depends(current_user)) -> MessageResponse:
    code = code.upper()
    event = None
    with store.lock:
        room = load_room(code)
        if room is None or not is_member(room, user.id):
            raise HTTPException(status_code=404, detail="You are not in this room.")
        if match_in_progress(code):
            raise HTTPException(status_code=409, detail="Finish the current match before leaving.")
        room.players = [player for player in room.players if player.id != user.id]
        if not room.players:
            store.delete("rooms", code)
            store.delete("matches", code)
        else:
            if room.host_id == user.id:
                room.host_id = room.players[0].id
            event = make_event(EventType.ROOM_LEFT, user.id, {"playerId": user.id, "room": room.model_dump(mode="json")})
            record_room_event(room, event)
            save_room(room)
    await close_connections(code, user.id)
    if event:
        await broadcast(code, event)
    return MessageResponse(message="Left the room.")


def snapshot_payload(code: str, room: Room, user_id: str) -> dict[str, Any]:
    match = load_match(code)
    visible = project_match(match, user_id) if match and any(player["id"] == user_id for player in match["players"]) else None
    return {"room": room.model_dump(mode="json"), "match": visible}


@app.websocket("/ws/rooms/{code}")
async def room_socket(websocket: WebSocket, code: str, token: str = "") -> None:
    code = code.upper()
    user = user_for_token(token)
    room = load_room(code)
    if user is None or room is None or not is_member(room, user.id):
        await websocket.close(code=1008)
        return
    await websocket.accept()
    connections.setdefault(code, []).append((websocket, user.id))
    await websocket.send_json({"type": "Snapshot", "payload": snapshot_payload(code, room, user.id)})
    try:
        while True:
            text = await websocket.receive_text()
            try:
                raw = json.loads(text)
                if isinstance(raw, dict) and raw.get("type") == "Ping":
                    await websocket.send_json({"type": "Pong", "payload": {}})
                    continue
                client_event = ClientEvent.model_validate(raw)
                with store.lock:
                    response_event = apply_online_action(code, user.id, client_event)
            except (ValueError, ValidationError) as error:
                # Errors go only to the player who sent the bad action.
                await websocket.send_json(make_event(EventType.GAME_STATE_SYNCED, user.id, {"error": str(error)}))
                continue
            if response_event:
                await broadcast(code, response_event)
    except WebSocketDisconnect:
        pass
    finally:
        connections[code] = [(item, player_id) for item, player_id in connections.get(code, []) if item is not websocket]


def make_event(event_type: EventType, player_id: str | None, payload: dict[str, Any]) -> dict[str, Any]:
    return {"id": token_hex(8), "type": event_type.value, "player_id": player_id, "payload": payload, "at": utc_now().isoformat()}


def card_points(rank: str) -> int:
    return 1 if rank == "A" else 10 if rank in {"J", "Q", "K"} else int(rank)


def make_deck() -> list[dict[str, Any]]:
    deck = [{"id": f"{rank}-{suit}", "rank": rank, "suit": suit, "points": card_points(rank)} for suit in SUITS for rank in RANKS]
    random.SystemRandom().shuffle(deck)
    return deck


def append_event(match: dict[str, Any], event_type: str, payload: dict[str, Any]) -> list[dict[str, Any]]:
    events = match.get("eventLog", [])
    return [*events, {"id": f"{event_type}-{len(events) + 1}", "type": event_type, "payload": payload, "at": utc_now().isoformat()}]


def create_online_match(room: Room) -> dict[str, Any]:
    players = [{
        "id": player.id, "name": player.username, "type": "human", "difficulty": "medium", "totalScore": 0,
        "stats": {"successfulDeclares": 0, "failedDeclares": 0, "specialDeclares": 0, "roundsWon": 0},
    } for player in room.players]
    if len(players) < 2:
        raise ValueError("At least two players are required.")
    match = {
        "id": f"match-{token_hex(8)}", "mode": "online", "status": "playing", "players": players, "roundNumber": 0,
        "currentPlayerIndex": 0, "drawPile": [], "discardPile": [], "hands": {}, "turn": fresh_turn(),
        "roundResult": None, "matchStats": {"roundsPlayed": 0, "successfulDeclares": 0, "failedDeclares": 0, "specialDeclares": 0, "startedAt": utc_now().isoformat()},
        "settings": {"initialHandSize": HAND_SIZE, "darkMode": True, "landscape": True, "accessibilityLabels": True}, "eventLog": [],
    }
    return start_round(match)


def fresh_turn(pickup_card_id: str | None = None) -> dict[str, Any]:
    # pickupCardId is the card that was on top of the discard pile before this turn's discard.
    return {"hasDiscarded": False, "hasDrawn": False, "pickupCardId": pickup_card_id}


def start_round(match: dict[str, Any]) -> dict[str, Any]:
    deck = make_deck()
    hands = {player["id"]: [deck.pop(0) for _ in range(HAND_SIZE)] for player in match["players"]}
    # The round opens with one card already on the discard pile, so the first player has something to pick up.
    starter = deck.pop()
    next_match = {**match, "status": "playing", "roundNumber": match["roundNumber"] + 1, "currentPlayerIndex": 0, "drawPile": deck, "discardPile": [starter], "hands": hands, "turn": fresh_turn(), "roundResult": None}
    next_match["eventLog"] = append_event(match, "GameStarted", {"roundNumber": next_match["roundNumber"]})
    return next_match


def current_player(match: dict[str, Any]) -> dict[str, Any]:
    return match["players"][match["currentPlayerIndex"]]


def require_turn(match: dict[str, Any], player_id: str) -> None:
    if match["status"] != "playing" or current_player(match)["id"] != player_id:
        raise ValueError("It is not this player's turn.")


def hand_value(hand: list[dict[str, Any]]) -> int:
    return sum(card["points"] for card in hand)


def discard_cards(match: dict[str, Any], player_id: str, card_ids: list[str]) -> dict[str, Any]:
    # Turn order: discard first (required), then pick up one card (required). Picking up ends the turn.
    require_turn(match, player_id)
    if match["turn"].get("hasDiscarded"):
        raise ValueError("You have already discarded this turn.")
    if not card_ids or len(card_ids) != len(set(card_ids)):
        raise ValueError("Select one or more distinct cards to discard.")
    hand = match["hands"][player_id]
    selected = [next((card for card in hand if card["id"] == card_id), None) for card_id in card_ids]
    if any(card is None for card in selected) or any(card["rank"] != selected[0]["rank"] for card in selected):
        raise ValueError("Discarded cards must be in your hand and share a rank.")
    next_match = deepcopy(match)
    discarded_ids = set(card_ids)
    top_before_discard = match["discardPile"][-1] if match["discardPile"] else None
    next_match["hands"][player_id] = [card for card in hand if card["id"] not in discarded_ids]
    next_match["discardPile"].extend(selected)
    next_match["turn"] = fresh_turn(top_before_discard["id"] if top_before_discard else None)
    next_match["turn"]["hasDiscarded"] = True
    next_match["eventLog"] = append_event(match, "CardsDiscarded", {"playerId": player_id, "cardIds": card_ids})
    return next_match


def draw_card(match: dict[str, Any], player_id: str, source: str) -> dict[str, Any]:
    # Pick up one card from the draw pile, or the pickup card from the discard pile. Ends the turn.
    require_turn(match, player_id)
    if not match["turn"].get("hasDiscarded"):
        raise ValueError("Discard before picking up a card.")
    if match["turn"].get("hasDrawn"):
        raise ValueError("Only one pick-up is allowed per turn.")
    next_match = deepcopy(match)
    if source == "draw":
        if not next_match["drawPile"] and len(next_match["discardPile"]) > 1:
            top = next_match["discardPile"].pop()
            random.SystemRandom().shuffle(next_match["discardPile"])
            next_match["drawPile"] = next_match["discardPile"]
            next_match["discardPile"] = [top]
        if not next_match["drawPile"]:
            raise ValueError("Draw pile is empty.")
        card = next_match["drawPile"].pop()
    elif source == "discard":
        pickup_id = match["turn"].get("pickupCardId")
        index = next((position for position, item in enumerate(next_match["discardPile"]) if item["id"] == pickup_id), None)
        if index is None:
            raise ValueError("No discarded card is available to pick up.")
        card = next_match["discardPile"].pop(index)
    else:
        raise ValueError("Pick up from the draw pile or the discard pile.")
    next_index = (match["currentPlayerIndex"] + 1) % len(match["players"])
    next_match["hands"][player_id].append(card)
    next_match["currentPlayerIndex"] = next_index
    next_match["turn"] = fresh_turn()
    next_match["eventLog"] = append_event(match, "CardDrawn", {"playerId": player_id, "source": source, "nextPlayerId": match["players"][next_index]["id"]})
    return next_match


def declare_round(match: dict[str, Any], player_id: str) -> dict[str, Any]:
    require_turn(match, player_id)
    # Declaring is an alternative to the turn, so it is only allowed before this turn's discard.
    if match["turn"].get("hasDiscarded"):
        raise ValueError("You can declare only at the start of your turn, before discarding.")
    if hand_value(match["hands"][player_id]) > DECLARE_LIMIT:
        raise ValueError("You may declare only at 15 points or less.")
    values = {player["id"]: hand_value(match["hands"][player["id"]]) for player in match["players"]}
    declarer_value = values[player_id]
    lower = [player_id_ for player_id_, value in values.items() if player_id_ != player_id and value < declarer_value]
    tied = [player_id_ for player_id_, value in values.items() if player_id_ != player_id and value == declarer_value]
    scores: dict[str, int] = {}
    result_type = "success"
    zeroes = [player_id]
    if lower:
        result_type, zeroes = "failed", lower
        scores = {identifier: 50 if identifier == player_id else 0 if identifier in lower else values[identifier] for identifier in values}
    elif tied:
        result_type, zeroes = "tie", tied
        scores = {identifier: declarer_value * 2 if identifier == player_id else 0 if identifier in tied else values[identifier] for identifier in values}
    else:
        special = bool(match["hands"][player_id]) and all(card["rank"] == match["hands"][player_id][0]["rank"] for card in match["hands"][player_id])
        result_type = "same-card-bonus" if special else "success"
        scores = {identifier: -25 if identifier == player_id and special else 0 if identifier == player_id else values[identifier] for identifier in values}
    next_match = deepcopy(match)
    for player in next_match["players"]:
        identifier = player["id"]
        player["totalScore"] += scores[identifier]
        if identifier == player_id:
            player["stats"]["successfulDeclares"] += int(result_type in {"success", "same-card-bonus"})
            player["stats"]["failedDeclares"] += int(result_type == "failed")
            player["stats"]["specialDeclares"] += int(result_type == "same-card-bonus")
        player["stats"]["roundsWon"] += int(identifier in zeroes)
    finished = any(player["totalScore"] >= MATCH_LIMIT for player in next_match["players"])
    next_match["status"] = "matchResult" if finished else "roundResult"
    next_match["roundResult"] = {"roundNumber": match["roundNumber"], "declarerId": player_id, "declareResult": {"type": result_type, "declarerValue": declarer_value, "lowerPlayerIds": lower, "tiedPlayerIds": tied, "zeroScorePlayerIds": zeroes, "roundScores": scores, "specialBonus": result_type == "same-card-bonus"}, "hands": deepcopy(match["hands"]), "handValues": values, "cumulativeScores": {player["id"]: player["totalScore"] for player in next_match["players"]}}
    next_match["matchStats"]["roundsPlayed"] += 1
    next_match["matchStats"]["successfulDeclares"] += int(result_type in {"success", "same-card-bonus"})
    next_match["matchStats"]["failedDeclares"] += int(result_type == "failed")
    next_match["matchStats"]["specialDeclares"] += int(result_type == "same-card-bonus")
    next_match["eventLog"] = append_event(match, "MatchFinished" if finished else "RoundFinished", {"declarerId": player_id})
    return next_match


def project_match(match: dict[str, Any] | None, player_id: str) -> dict[str, Any] | None:
    if match is None:
        return None
    projected = deepcopy(match)
    if projected["status"] == "playing":
        for player in projected["players"]:
            identifier = player["id"]
            if identifier != player_id:
                projected["hands"][identifier] = [{"id": f"hidden-{identifier}-{index}", "hidden": True} for index in range(len(match["hands"][identifier]))]
    return projected


def apply_online_action(code: str, user_id: str, client_event: ClientEvent) -> dict[str, Any] | None:
    """Apply one player action. Caller must hold `store.lock`. Raises ValueError for rule violations."""
    room = load_room(code)
    if room is None:
        raise ValueError("This room no longer exists.")
    event_type = client_event.type
    if event_type == EventType.GAME_STARTED:
        if room.host_id != user_id:
            raise ValueError("Only the host can start the match.")
        if match_in_progress(code):
            raise ValueError("A match is already in progress.")
        match = create_online_match(room)
        save_match(code, match)
        event = make_event(EventType.GAME_STARTED, user_id, {"match": match})
    elif event_type in {EventType.CARD_DRAWN, EventType.CARDS_DISCARDED, EventType.DECLARE_ATTEMPTED, EventType.ROUND_FINISHED}:
        match = load_match(code)
        if match is None:
            raise ValueError("Start the match before playing.")
        if all(player["id"] != user_id for player in match["players"]):
            raise ValueError("Only players in this match can act.")
        if event_type == EventType.CARD_DRAWN:
            next_match = draw_card(match, user_id, str(client_event.payload.get("source", "draw")))
        elif event_type == EventType.CARDS_DISCARDED:
            next_match = discard_cards(match, user_id, list(client_event.payload.get("cardIds", [])))
        elif event_type == EventType.DECLARE_ATTEMPTED:
            next_match = declare_round(match, user_id)
        else:
            if match["status"] != "roundResult":
                raise ValueError("The next round is not ready yet.")
            next_match = start_round(match)
        save_match(code, next_match)
        event = make_event(EventType.GAME_STATE_SYNCED, user_id, {"match": next_match})
    else:
        return None
    record_room_event(room, event)
    save_room(room)
    return event


async def broadcast(code: str, event: dict[str, Any]) -> None:
    stale: list[WebSocket] = []
    for websocket, player_id in list(connections.get(code, [])):
        try:
            outgoing = deepcopy(event)
            if outgoing["payload"].get("match"):
                outgoing["payload"]["match"] = project_match(outgoing["payload"]["match"], player_id)
            await websocket.send_json(outgoing)
        except Exception:
            stale.append(websocket)
    if stale:
        connections[code] = [(item, player_id) for item, player_id in connections.get(code, []) if item not in stale]


async def close_connections(code: str, user_id: str) -> None:
    for websocket, player_id in list(connections.get(code, [])):
        if player_id == user_id:
            try:
                await websocket.close(code=1000)
            except Exception:
                pass
    connections[code] = [(item, player_id) for item, player_id in connections.get(code, []) if player_id != user_id]
