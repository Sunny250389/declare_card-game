export function playerName(match, id) {
  return match.players.find((player) => player.id === id)?.name || id;
}

export function capitalize(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function formatDelta(value) {
  return value > 0 ? `+${value}` : String(value);
}

export function onlinePlayer(user) {
  return { id: user.id, username: user.username, avatar: null, ready: false };
}
