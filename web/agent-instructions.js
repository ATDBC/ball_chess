export function buildMcpConfig(setup, { matchId, playerToken }) {
  return {
    mcpServers: {
      "ball-chess": {
        command: setup.command,
        args: [...setup.args, "--match", matchId],
        env: { BALL_CHESS_PLAYER_TOKEN: playerToken }
      }
    }
  };
}

export function buildAgentPrompt({ matchId, seat }) {
  return [
    `Play Ball Chess match ${matchId} as the pre-bound ${seat} seat.`,
    "Call set_ready with ready=true once, then call get_match_state.",
    "Repeat wait_for_turn until yourTurn or finished.",
    "Choose only from the compact legalActions and call submit_action with the latest version.",
    "On STALE_STATE or ILLEGAL_ACTION, read the returned state and choose again.",
    "Continue until result is not null; do not try to act for the other seat."
  ].join("\n");
}
