const ONLINE_EVENTS = Object.freeze({
  PLAYER_CONNECTED: "PlayerConnected",
  PLAYER_DISCONNECTED: "PlayerDisconnected",
  ROOM_CREATED: "RoomCreated",
  ROOM_JOINED: "RoomJoined",
  ROOM_LEFT: "RoomLeft",
  PLAYER_READY: "PlayerReady",
  GAME_STARTED: "GameStarted",
  TURN_STARTED: "TurnStarted",
  CARD_DRAWN: "CardDrawn",
  CARDS_DISCARDED: "CardsDiscarded",
  DECLARE_ATTEMPTED: "DeclareAttempted",
  DECLARE_RESOLVED: "DeclareResolved",
  ROUND_FINISHED: "RoundFinished",
  SCORE_UPDATED: "ScoreUpdated",
  MATCH_FINISHED: "MatchFinished",
  PLAYER_RECONNECTED: "PlayerReconnected",
  CHAT_MESSAGE_RECEIVED: "ChatMessageReceived",
  SPECTATOR_JOINED: "SpectatorJoined"
});

module.exports = { ONLINE_EVENTS };
