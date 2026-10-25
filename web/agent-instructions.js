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
    "Choose only from decision.legal, copy its actionId exactly, and call submit_action with that actionId and the latest version.",
    "On STALE_STATE or ILLEGAL_ACTION, read the returned state and choose again.",
    "Call get_match_record only when you need the complete move history.",
    "Continue until result is not null; do not try to act for the other seat."
  ].join("\n");
}
export function buildInvitePrompt({ code }) {
  return `加入邀请码 ${code} 并开始`;
}
