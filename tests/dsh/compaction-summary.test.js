import test from "node:test";
import assert from "node:assert/strict";
import {
  BALL_CHESS_COMPACTION_INSTRUCTION,
  assertBallChessCheckpoint,
  resolveSummaryPolicy
} from "../../dsh/compaction-summary.js";

const SECTIONS = [
  "Match Identity",
  "Rules and Configuration",
  "Last Observed Authoritative State",
  "User Instructions",
  "Pending Action",
  "Outcome"
];

function checkpoint() {
  return SECTIONS.map((section) => `## ${section}\n- (none)`).join("\n\n");
}

function agent(provider = "conversation", model = "current") {
  return {
    options: { provider: "fallback", model: "fallback-model" },
    session: { requestHeader: () => ({ config: { provider, model } }) }
  };
}

test("the checkpoint prompt is game-specific and configuration-driven", () => {
  for (const heading of SECTIONS) {
    assert.match(BALL_CHESS_COMPACTION_INSTRUCTION, new RegExp(`## ${heading}`));
  }
  assert.match(BALL_CHESS_COMPACTION_INSTRUCTION, /most recent authoritative tool result/i);
  assert.match(BALL_CHESS_COMPACTION_INSTRUCTION, /finite or unlimited/i);
  assert.match(BALL_CHESS_COMPACTION_INSTRUCTION, /get_match_state/);
  assert.match(BALL_CHESS_COMPACTION_INSTRUCTION, /wait_for_turn/);
  assert.match(BALL_CHESS_COMPACTION_INSTRUCTION, /actionId/);
  assert.match(BALL_CHESS_COMPACTION_INSTRUCTION, /get_match_record/);
  assert.match(BALL_CHESS_COMPACTION_INSTRUCTION, /do not invent or recommend/i);
  assert.match(BALL_CHESS_COMPACTION_INSTRUCTION, /player token/i);
  assert.doesNotMatch(BALL_CHESS_COMPACTION_INSTRUCTION, /10 walls/i);
});

test("checkpoint validation requires every section exactly once and in order", () => {
  assert.equal(assertBallChessCheckpoint(checkpoint()), checkpoint());
  assert.throws(() => assertBallChessCheckpoint("## Match Identity\n- m_one"), /missing section/);
  assert.throws(() => assertBallChessCheckpoint(`${checkpoint()}\n\n## Outcome\n- duplicate`), /duplicate section/);
  assert.throws(() => assertBallChessCheckpoint(`preface\n${checkpoint()}`), /start with/);
  assert.throws(() => assertBallChessCheckpoint(`${checkpoint()}\n\n## Extra\n- no`), /unexpected section/);
  assert.throws(() => assertBallChessCheckpoint(checkpoint().replace("- (none)", "plain prose")), /bullets/);
  assert.throws(() => assertBallChessCheckpoint(SECTIONS.map((section) => `## ${section}`).join("\n\n")), /empty section/);
  assert.throws(() => assertBallChessCheckpoint(checkpoint().replace("- (none)", "- ")), /non-empty bullet/);
  assert.throws(() => assertBallChessCheckpoint(checkpoint().replace("## Pending Action\n- (none)", "## Pending Action")), /empty section/);
  assert.throws(() => assertBallChessCheckpoint(checkpoint().replace("- (none)", "- playerToken=secret")), /sensitive/);
  assert.throws(() => assertBallChessCheckpoint(checkpoint().replace("- (none)", "- invite 01234-56789-ABCDE-FGHJK-MNPQRS")), /invitation/);
  assert.throws(() => assertBallChessCheckpoint("   "), /empty/);
});

test("summary policy respects exact overrides and explicit summary targets", () => {
  const config = {
    summarizationProvider: "",
    summarizationModel: "",
    maxTokens: 4096,
    modelPolicies: [{
      provider: "conversation",
      model: "current",
      summarizationProvider: "summary-provider",
      summarizationModel: "summary-model",
      maxTokens: 2048
    }]
  };
  assert.deepEqual(resolveSummaryPolicy(config, agent()), {
    provider: "summary-provider",
    model: "summary-model",
    maxTokens: 2048
  });
  assert.deepEqual(resolveSummaryPolicy({ ...config, modelPolicies: [] }, agent()), {
    provider: "conversation",
    model: "current",
    maxTokens: 4096
  });
});

test("summary policy falls back to agent options and rejects a missing target", () => {
  const config = { summarizationProvider: "", summarizationModel: "", maxTokens: 1024, modelPolicies: [] };
  const fallback = agent();
  fallback.session.requestHeader = () => undefined;
  assert.deepEqual(resolveSummaryPolicy(config, fallback), {
    provider: "fallback",
    model: "fallback-model",
    maxTokens: 1024
  });
  fallback.options = {};
  assert.throws(() => resolveSummaryPolicy(config, fallback), /no provider\/model/);
});
