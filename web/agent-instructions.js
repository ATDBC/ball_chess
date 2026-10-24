export function buildMcpConfig(setup) {
  return { mcpServers: { "ball-chess": { command: setup.command, args: [...setup.args] } } };
}

export function buildAgentPrompt({ matchId, token, seat }) {
  return [
    `Join Ball Chess match ${matchId} as ${seat} using playerToken ${token}.`,
    "Use join_match once, then repeat wait_for_turn until yourTurn or finished.",
    "Choose only from legalActions and call submit_action with the latest version.",
    "On STALE_STATE or ILLEGAL_ACTION, read the returned state and choose again.",
    "Continue until result is not null; do not try to act for the other seat."
  ].join("\n");
}
