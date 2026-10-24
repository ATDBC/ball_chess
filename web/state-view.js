export function shouldAcceptSnapshot(current, incoming) {
  return !current || incoming.version >= current.version;
}

export function canInteract(state) {
  return Boolean(state && state.status === "playing" && state.yourTurn && !state.result);
}

export function wallsRemaining(state, seat) {
  if (state.config.wallLimit === null) return "∞";
  return String(Math.max(0, state.config.wallLimit - state.players[seat].wallsUsed));
}

export function resolveInteractionMode(state, mode, actionPending) {
  const interactive = Boolean(state && canInteract(state) && !actionPending);
  const hasWall = (state?.legalActions || []).some((action) => action.type === "place_wall");
  return interactive && !hasWall && mode === "wall" ? "move" : mode;
}
