from __future__ import annotations

from datetime import datetime, timezone
from enum import StrEnum
from secrets import token_hex
from typing import Any

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from pydantic import BaseModel, Field


app = FastAPI(title="Declare Online Backend", version="0.1.0")


class EventType(StrEnum):
    PLAYER_CONNECTED = "PlayerConnected"
    PLAYER_DISCONNECTED = "PlayerDisconnected"
    ROOM_CREATED = "RoomCreated"
    ROOM_JOINED = "RoomJoined"
    ROOM_LEFT = "RoomLeft"
    PLAYER_READY = "PlayerReady"
    GAME_STARTED = "GameStarted"
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


class ClientEvent(BaseModel):
    type: EventType
    player_id: str | None = None
    payload: dict[str, Any] = Field(default_factory=dict)


rooms: dict[str, Room] = {}
connections: dict[str, list[WebSocket]] = {}


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/rooms")
def create_room(host: PlayerProfile, settings: RoomSettings | None = None) -> Room:
    code = token_hex(3).upper()
    room = Room(
        code=code,
        host_id=host.id,
        settings=settings or RoomSettings(),
        players=[host],
    )
    room.event_stream.append(make_event(EventType.ROOM_CREATED, host.id, {"code": code}))
    rooms[code] = room
    connections[code] = []
    return room


@app.get("/rooms/{code}")
def get_room(code: str) -> Room:
    return rooms[code.upper()]


@app.websocket("/ws/rooms/{code}")
async def room_socket(websocket: WebSocket, code: str) -> None:
    code = code.upper()
    await websocket.accept()
    if code not in rooms:
        await websocket.send_json({"type": "Error", "payload": {"message": "Room not found"}})
        await websocket.close()
        return

    connections.setdefault(code, []).append(websocket)
    await websocket.send_json({"type": "Snapshot", "payload": rooms[code].model_dump(mode="json")})

    try:
      while True:
        raw = await websocket.receive_json()
        client_event = ClientEvent.model_validate(raw)
        event = make_event(client_event.type, client_event.player_id, client_event.payload)
        apply_event(code, event)
        await broadcast(code, event)
    except WebSocketDisconnect:
        connections[code] = [item for item in connections.get(code, []) if item is not websocket]


def make_event(event_type: EventType, player_id: str | None, payload: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": token_hex(8),
        "type": event_type.value,
        "player_id": player_id,
        "payload": payload,
        "at": datetime.now(timezone.utc).isoformat(),
    }


def apply_event(code: str, event: dict[str, Any]) -> None:
    room = rooms[code]
    event_type = event["type"]
    payload = event["payload"]

    if event_type == EventType.ROOM_JOINED.value:
        player = PlayerProfile.model_validate(payload["player"])
        if len(room.players) < room.settings.max_players and all(item.id != player.id for item in room.players):
            room.players.append(player)
    elif event_type == EventType.PLAYER_READY.value:
        for player in room.players:
            if player.id == event["player_id"]:
                player.ready = bool(payload.get("ready", True))
    elif event_type == EventType.SPECTATOR_JOINED.value and room.settings.spectators_enabled:
        spectator_id = payload.get("spectator_id")
        if spectator_id and spectator_id not in room.spectators:
            room.spectators.append(spectator_id)

    room.event_stream.append(event)


async def broadcast(code: str, event: dict[str, Any]) -> None:
    stale: list[WebSocket] = []
    for websocket in connections.get(code, []):
        try:
            await websocket.send_json(event)
        except RuntimeError:
            stale.append(websocket)
    if stale:
        connections[code] = [item for item in connections.get(code, []) if item not in stale]
