from __future__ import annotations

import base64
import hashlib
import hmac
import os
import random
import smtplib
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage
from enum import StrEnum
from secrets import token_hex
from typing import Any

from fastapi import Depends, FastAPI, Header, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field


MATCH_LIMIT = 100
DECLARE_LIMIT = 15
HAND_SIZE = 5
RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"]
SUITS = ["spades", "hearts", "diamonds", "clubs"]
COMMON_PASSWORDS = {
    "123456789", "1234567890", "password", "password123", "qwertyuiop",
    "letmein123", "welcome123", "declare123", "iloveyou123", "adminadmin",
}


app = FastAPI(title="Declare Online Backend", version="0.2.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
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
    verification_hash: str | None = None
    verification_expires_at: datetime | None = None
    reset_hash: str | None = None
    reset_expires_at: datetime | None = None


class AuthRequest(BaseModel):
    email: str
    password: str
    username: str | None = None


class VerifyEmailRequest(BaseModel):
    email: str
    code: str = Field(min_length=6, max_length=6)


class ForgotPasswordRequest(BaseModel):
    email: str


class ResetPasswordRequest(BaseModel):
    email: str
    code: str = Field(min_length=6, max_length=6)
    password: str


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


rooms: dict[str, Room] = {}
connections: dict[str, list[tuple[WebSocket, str]]] = {}
users_by_email: dict[str, StoredUser] = {}
sessions: dict[str, str] = {}
matches_by_room: dict[str, dict[str, Any]] = {}


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def password_error(password: str) -> str | None:
    if len(password) < 15:
        return "Use a password or passphrase with at least 15 characters."
    if len(password) > 128:
        return "Password must be 128 characters or fewer."
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


def code_hash(code: str) -> str:
    return hashlib.sha256(code.encode("utf-8")).hexdigest()


def issue_verification_code(user: StoredUser) -> str:
    code = f"{random.SystemRandom().randint(0, 999999):06d}"
    user.verification_hash = code_hash(code)
    user.verification_expires_at = utc_now() + timedelta(minutes=15)
    return code


def send_email(email: str, subject: str, content: str) -> bool:
    host = os.getenv("SMTP_HOST")
    sender = os.getenv("SMTP_FROM")
    if not host or not sender:
        return False

    message = EmailMessage()
    message["Subject"] = subject
    message["From"] = sender
    message["To"] = email
    message.set_content(content)
    port = int(os.getenv("SMTP_PORT", "587"))
    with smtplib.SMTP(host, port, timeout=10) as client:
        if os.getenv("SMTP_STARTTLS", "true").lower() != "false":
            client.starttls()
        username = os.getenv("SMTP_USERNAME")
        password = os.getenv("SMTP_PASSWORD")
        if username and password:
            client.login(username, password)
        client.send_message(message)
    return True


def verification_response(user: StoredUser, code: str) -> VerificationResponse:
    try:
        delivered = send_email(user.email, "Verify your Declare account", f"Your Declare verification code is {code}. It expires in 15 minutes.")
    except (OSError, smtplib.SMTPException):
        delivered = False
    if delivered:
        return VerificationResponse(message="We emailed a six-digit verification code. It expires in 15 minutes.")
    return VerificationResponse(
        message="Email delivery is not configured. Use the development verification code shown below, or configure SMTP on the server.",
        development_code=code,
    )


def issue_reset_code(user: StoredUser) -> str:
    code = f"{random.SystemRandom().randint(0, 999999):06d}"
    user.reset_hash = code_hash(code)
    user.reset_expires_at = utc_now() + timedelta(minutes=15)
    return code


def reset_response(user: StoredUser, code: str) -> CodeDeliveryResponse:
    try:
        delivered = send_email(user.email, "Reset your Declare password", f"Your Declare password reset code is {code}. It expires in 15 minutes.")
    except (OSError, smtplib.SMTPException):
        delivered = False
    if delivered:
        return CodeDeliveryResponse(message="We emailed a six-digit password reset code. It expires in 15 minutes.")
    return CodeDeliveryResponse(
        message="Email delivery is not configured. Use the development reset code shown below, or configure SMTP on the server.",
        development_code=code,
    )


def make_auth_response(user: StoredUser, message: str) -> AuthResponse:
    token = token_hex(32)
    sessions[token] = user.id
    return AuthResponse(user=AuthUser(**user.model_dump(exclude={"password_hash", "password_salt", "email_verified", "verification_hash", "verification_expires_at"})), token=token, message=message)


def current_user(authorization: str | None = Header(default=None)) -> StoredUser:
    token = authorization.removeprefix("Bearer ").strip() if authorization else ""
    user_id = sessions.get(token)
    user = next((item for item in users_by_email.values() if item.id == user_id), None)
    if user is None or not user.email_verified:
        raise HTTPException(status_code=401, detail="Sign in with a verified account to continue.")
    return user


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/auth/signup", response_model=VerificationResponse)
def signup(request: AuthRequest) -> VerificationResponse:
    email = request.email.strip().lower()
    if "@" not in email:
        raise HTTPException(status_code=400, detail="Enter a valid email address.")
    error = password_error(request.password)
    if error:
        raise HTTPException(status_code=400, detail=error)
    if email in users_by_email:
        raise HTTPException(status_code=409, detail="An account already exists for this email.")
    password_hash, password_salt = hash_password(request.password)
    user = StoredUser(
        id=f"user-{token_hex(8)}",
        username=(request.username or email.split("@")[0]).strip() or "Player",
        email=email,
        password_hash=password_hash,
        password_salt=password_salt,
    )
    users_by_email[email] = user
    return verification_response(user, issue_verification_code(user))


@app.post("/auth/verify-email", response_model=AuthResponse)
def verify_email(request: VerifyEmailRequest) -> AuthResponse:
    email = request.email.strip().lower()
    user = users_by_email.get(email)
    if user is None or user.verification_hash is None or user.verification_expires_at is None:
        raise HTTPException(status_code=400, detail="Request a new verification code first.")
    if utc_now() > user.verification_expires_at or not hmac.compare_digest(code_hash(request.code), user.verification_hash):
        raise HTTPException(status_code=400, detail="That verification code is invalid or has expired.")
    user.email_verified = True
    user.verification_hash = None
    user.verification_expires_at = None
    return make_auth_response(user, "Email verified. You are signed in.")


@app.post("/auth/resend-verification", response_model=VerificationResponse)
def resend_verification(request: ForgotPasswordRequest) -> VerificationResponse:
    user = users_by_email.get(request.email.strip().lower())
    if user is None or user.email_verified:
        raise HTTPException(status_code=400, detail="No unverified account was found for this email.")
    return verification_response(user, issue_verification_code(user))


@app.post("/auth/login", response_model=AuthResponse)
def login(request: AuthRequest) -> AuthResponse:
    email = request.email.strip().lower()
    user = users_by_email.get(email)
    if user is None or not password_matches(request.password, user):
        raise HTTPException(status_code=401, detail="Email or password is incorrect.")
    if not user.email_verified:
        raise HTTPException(status_code=403, detail="Verify your email before logging in.")
    return make_auth_response(user, "Logged in.")


@app.post("/auth/forgot-password")
def forgot_password(request: ForgotPasswordRequest) -> CodeDeliveryResponse:
    user = users_by_email.get(request.email.strip().lower())
    if user is None or not user.email_verified:
        return CodeDeliveryResponse(message="If an account exists, a password reset code has been sent.")
    return reset_response(user, issue_reset_code(user))


@app.post("/auth/reset-password", response_model=AuthResponse)
def reset_password(request: ResetPasswordRequest) -> AuthResponse:
    email = request.email.strip().lower()
    user = users_by_email.get(email)
    error = password_error(request.password)
    if error:
        raise HTTPException(status_code=400, detail=error)
    if user is None or user.reset_hash is None or user.reset_expires_at is None:
        raise HTTPException(status_code=400, detail="Request a password reset code first.")
    if utc_now() > user.reset_expires_at or not hmac.compare_digest(code_hash(request.code), user.reset_hash):
        raise HTTPException(status_code=400, detail="That password reset code is invalid or has expired.")
    user.password_hash, user.password_salt = hash_password(request.password)
    user.reset_hash = None
    user.reset_expires_at = None
    return make_auth_response(user, "Password reset. You are signed in.")


@app.post("/rooms")
def create_room(request: CreateRoomRequest, user: StoredUser = Depends(current_user)) -> Room:
    if request.host.id != user.id:
        raise HTTPException(status_code=403, detail="Room host does not match the signed-in account.")
    code = token_hex(3).upper()
    room = Room(code=code, host_id=user.id, settings=request.settings, players=[PlayerProfile(id=user.id, username=user.username)])
    room.event_stream.append(make_event(EventType.ROOM_CREATED, user.id, {"code": code}))
    rooms[code] = room
    connections[code] = []
    return room


@app.get("/rooms/{code}")
def get_room(code: str, _: StoredUser = Depends(current_user)) -> Room:
    room = rooms.get(code.upper())
    if room is None:
        raise HTTPException(status_code=404, detail="Room not found.")
    return room


@app.post("/rooms/{code}/join")
async def join_room(code: str, request: JoinRoomRequest, user: StoredUser = Depends(current_user)) -> Room:
    code = code.upper()
    room = rooms.get(code)
    if room is None:
        raise HTTPException(status_code=404, detail="Room not found.")
    if request.player.id != user.id:
        raise HTTPException(status_code=403, detail="Room player does not match the signed-in account.")
    if len(room.players) >= room.settings.max_players and all(player.id != user.id for player in room.players):
        raise HTTPException(status_code=409, detail="Room is full.")
    if all(player.id != user.id for player in room.players):
        room.players.append(PlayerProfile(id=user.id, username=user.username))
    event = make_event(EventType.ROOM_JOINED, user.id, {"player": {"id": user.id, "username": user.username}, "room": room.model_dump(mode="json")})
    room.event_stream.append(event)
    await broadcast(code, event)
    return room


@app.websocket("/ws/rooms/{code}")
async def room_socket(websocket: WebSocket, code: str, token: str = "") -> None:
    code = code.upper()
    user_id = sessions.get(token)
    if code not in rooms or user_id is None:
        await websocket.close(code=1008)
        return
    if all(player.id != user_id for player in rooms[code].players):
        await websocket.close(code=1008)
        return
    await websocket.accept()
    connections.setdefault(code, []).append((websocket, user_id))
    await websocket.send_json({
        "type": "Snapshot",
        "payload": {"room": rooms[code].model_dump(mode="json"), "match": project_match(matches_by_room.get(code), user_id)},
    })
    try:
        while True:
            raw = await websocket.receive_json()
            client_event = ClientEvent.model_validate(raw)
            response_event = apply_online_action(code, user_id, client_event)
            if response_event:
                await broadcast(code, response_event)
    except WebSocketDisconnect:
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
        "currentPlayerIndex": 0, "drawPile": [], "discardPile": [], "hands": {}, "turn": {"hasDrawn": False},
        "roundResult": None, "matchStats": {"roundsPlayed": 0, "successfulDeclares": 0, "failedDeclares": 0, "specialDeclares": 0, "startedAt": utc_now().isoformat()},
        "settings": {"initialHandSize": HAND_SIZE, "darkMode": True, "landscape": True, "accessibilityLabels": True}, "eventLog": [],
    }
    return start_round(match)


def start_round(match: dict[str, Any]) -> dict[str, Any]:
    deck = make_deck()
    hands = {player["id"]: [deck.pop(0) for _ in range(HAND_SIZE)] for player in match["players"]}
    next_match = {**match, "status": "playing", "roundNumber": match["roundNumber"] + 1, "currentPlayerIndex": 0, "drawPile": deck, "discardPile": [], "hands": hands, "turn": {"hasDrawn": False}, "roundResult": None}
    next_match["eventLog"] = append_event(match, "GameStarted", {"roundNumber": next_match["roundNumber"]})
    return next_match


def current_player(match: dict[str, Any]) -> dict[str, Any]:
    return match["players"][match["currentPlayerIndex"]]


def require_turn(match: dict[str, Any], player_id: str) -> None:
    if match["status"] != "playing" or current_player(match)["id"] != player_id:
        raise ValueError("It is not this player's turn.")


def hand_value(hand: list[dict[str, Any]]) -> int:
    return sum(card["points"] for card in hand)


def draw_card(match: dict[str, Any], player_id: str, source: str) -> dict[str, Any]:
    require_turn(match, player_id)
    if match["turn"].get("hasDrawn"):
        raise ValueError("Only one draw action is allowed per turn.")
    next_match = deepcopy(match)
    if source == "draw" and not next_match["drawPile"] and len(next_match["discardPile"]) > 1:
        top = next_match["discardPile"].pop()
        random.SystemRandom().shuffle(next_match["discardPile"])
        next_match["drawPile"] = next_match["discardPile"]
        next_match["discardPile"] = [top]
    pile_name = "drawPile" if source == "draw" else "discardPile"
    if not next_match[pile_name]:
        raise ValueError("That pile is empty.")
    next_match["hands"][player_id].append(next_match[pile_name].pop())
    next_match["turn"] = {"hasDrawn": True, "source": source}
    next_match["eventLog"] = append_event(match, "CardDrawn", {"playerId": player_id, "source": source})
    return next_match


def discard_cards(match: dict[str, Any], player_id: str, card_ids: list[str]) -> dict[str, Any]:
    require_turn(match, player_id)
    if not match["turn"].get("hasDrawn"):
        raise ValueError("Draw before discarding.")
    if not card_ids or len(card_ids) != len(set(card_ids)):
        raise ValueError("Select one or more distinct cards to discard.")
    hand = match["hands"][player_id]
    selected = [next((card for card in hand if card["id"] == card_id), None) for card_id in card_ids]
    if any(card is None for card in selected) or any(card["rank"] != selected[0]["rank"] for card in selected):
        raise ValueError("Discarded cards must be in your hand and share a rank.")
    next_match = deepcopy(match)
    discarded_ids = set(card_ids)
    next_match["hands"][player_id] = [card for card in hand if card["id"] not in discarded_ids]
    next_match["discardPile"].extend(selected)
    next_index = (match["currentPlayerIndex"] + 1) % len(match["players"])
    next_match["currentPlayerIndex"] = next_index
    next_match["turn"] = {"hasDrawn": False}
    next_match["eventLog"] = append_event(match, "CardsDiscarded", {"playerId": player_id, "cardIds": card_ids, "nextPlayerId": match["players"][next_index]["id"]})
    return next_match


def declare_round(match: dict[str, Any], player_id: str) -> dict[str, Any]:
    require_turn(match, player_id)
    if hand_value(match["hands"][player_id]) >= DECLARE_LIMIT:
        raise ValueError("You may declare only below 15 points.")
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
    room = rooms[code]
    event_type = client_event.type
    try:
        if event_type == EventType.GAME_STARTED:
            if room.host_id != user_id:
                raise ValueError("Only the host can start the match.")
            matches_by_room[code] = create_online_match(room)
            event = make_event(EventType.GAME_STARTED, user_id, {"match": matches_by_room[code]})
        elif event_type in {EventType.CARD_DRAWN, EventType.CARDS_DISCARDED, EventType.DECLARE_ATTEMPTED, EventType.ROUND_FINISHED}:
            match = matches_by_room.get(code)
            if match is None:
                raise ValueError("Start the match before playing.")
            if event_type == EventType.CARD_DRAWN:
                matches_by_room[code] = draw_card(match, user_id, str(client_event.payload.get("source", "draw")))
            elif event_type == EventType.CARDS_DISCARDED:
                matches_by_room[code] = discard_cards(match, user_id, list(client_event.payload.get("cardIds", [])))
            elif event_type == EventType.DECLARE_ATTEMPTED:
                matches_by_room[code] = declare_round(match, user_id)
            else:
                if match["status"] != "roundResult":
                    raise ValueError("The next round is not ready yet.")
                matches_by_room[code] = start_round(match)
            event = make_event(EventType.GAME_STATE_SYNCED, user_id, {"match": matches_by_room[code]})
        else:
            return None
    except ValueError as error:
        return make_event(EventType.GAME_STATE_SYNCED, user_id, {"error": str(error)})
    room.event_stream.append(event)
    return event


async def broadcast(code: str, event: dict[str, Any]) -> None:
    stale: list[WebSocket] = []
    for websocket, player_id in connections.get(code, []):
        try:
            outgoing = deepcopy(event)
            if outgoing["payload"].get("match"):
                outgoing["payload"]["match"] = project_match(outgoing["payload"]["match"], player_id)
            await websocket.send_json(outgoing)
        except RuntimeError:
            stale.append(websocket)
    if stale:
        connections[code] = [(item, player_id) for item, player_id in connections.get(code, []) if item not in stale]
