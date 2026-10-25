const SECTIONS = [
  "Match Identity",
  "Rules and Configuration",
  "Last Observed Authoritative State",
  "User Instructions",
  "Pending Action",
  "Outcome"
];

export const BALL_CHESS_COMPACTION_INSTRUCTION = [
  "You are now creating a Ball Chess continuation checkpoint from the conversation ABOVE.",
  "Output exactly the Markdown sections below, in order. Use terse bullets and write (none) for an empty section.",
  "",
  ...SECTIONS.flatMap((section) => [`## ${section}`, "- [facts required by this section]", ""]),
  "Rules:",
  "- Dynamic match state comes only from the most recent authoritative tool result. Older versions are history and must not replace it.",
  "- Record the observed version as last observed, never as permanent authority. If it is uncertain, Pending Action must say to call get_match_state.",
  "- If the match is not actionable for this seat, Pending Action must say to call wait_for_turn.",
  "- Copy the actual wall configuration as finite or unlimited. For finite walls retain limit, used, and remaining; for unlimited walls retain used only.",
  "- Preserve the actual first player, maximum plies, timeout, board, last action, winner, and reason only when present in authoritative output.",
  "- Never output a player token. Drop a redeemed invitation code and any authentication value.",
  "- A finished match keeps winner, reason, final version, and the instruction not to submit another action.",
  "- Merge still-current facts from an older checkpoint instead of nesting or copying that checkpoint verbatim.",
  "- Do not choose a move, call tools, continue the match, or discuss this compaction request.",
  "- Output only the checkpoint text."
].join("\n");

function routedTarget(agent) {
  const latest = agent.session.requestHeader?.()?.config;
  if (latest?.provider && latest?.model) return { provider: latest.provider, model: latest.model };
  if (agent.options?.provider && agent.options?.model) {
    return { provider: agent.options.provider, model: agent.options.model };
  }
  return null;
}

export function resolveSummaryPolicy(config, agent) {
  const target = routedTarget(agent);
  const override = target && config.modelPolicies.find((policy) => (
    policy.provider === target.provider && policy.model === target.model
  ));
  const summaryProvider = override?.summarizationProvider ?? config.summarizationProvider;
  const summaryModel = override?.summarizationModel ?? config.summarizationModel;
  if (summaryProvider && summaryModel) {
    return {
      provider: summaryProvider,
      model: summaryModel,
      maxTokens: override?.maxTokens ?? config.maxTokens
    };
  }
  if (!target) {
    throw new Error("no provider/model available for Ball Chess compaction");
  }
  return {
    provider: target.provider,
    model: target.model,
    maxTokens: override?.maxTokens ?? config.maxTokens
  };
}

export function assertBallChessCheckpoint(text) {
  if (typeof text !== "string" || text.trim().length === 0) {
    throw new Error("Ball Chess compaction checkpoint is empty");
  }
  const normalized = text.replaceAll("\r\n", "\n").trim();
  if (!normalized.startsWith(`## ${SECTIONS[0]}\n`)) {
    throw new Error(`Ball Chess compaction checkpoint must start with section: ${SECTIONS[0]}`);
  }
  const headingLines = normalized.split("\n").filter((line) => line.startsWith("## "));
  const expectedHeadings = SECTIONS.map((section) => `## ${section}`);
  for (const heading of headingLines) {
    if (!expectedHeadings.includes(heading)) {
      throw new Error(`Ball Chess compaction checkpoint has unexpected section: ${heading.slice(3)}`);
    }
  }
  for (const heading of expectedHeadings) {
    const count = headingLines.filter((line) => line === heading).length;
    if (count === 0) throw new Error(`Ball Chess compaction checkpoint is missing section: ${heading.slice(3)}`);
    if (count > 1) throw new Error(`Ball Chess compaction checkpoint has duplicate section: ${heading.slice(3)}`);
  }
  if (headingLines.join("\0") !== expectedHeadings.join("\0")) {
    throw new Error("Ball Chess compaction checkpoint sections are out of order");
  }
  const contentLines = normalized.split("\n").filter((line) => line.length > 0 && !line.startsWith("## "));
  if (contentLines.some((line) => !line.startsWith("- "))) {
    throw new Error("Ball Chess compaction checkpoint section content must use bullets");
  }
  if (/\b(?:player[ _-]?token|admin[ _-]?token|authorization|bearer)\b/i.test(normalized)) {
    throw new Error("Ball Chess compaction checkpoint contains sensitive authentication content");
  }
  const invitePattern = /(?:^|[^0-9A-Z])(?:[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{6}|[0-9A-HJKMNP-TV-Z]{26})(?=$|[^0-9A-Z])/i;
  if (invitePattern.test(normalized)) {
    throw new Error("Ball Chess compaction checkpoint contains a redeemed invitation code");
  }
  return text;
}
