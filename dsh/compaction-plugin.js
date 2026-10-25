import BasicCompactionEngine from "@deepseek-ai/dsh-compaction-basic";
import { BlockAssembler, contentHasImage, LlmError } from "@deepseek-ai/dsh-llm";
import {
  BALL_CHESS_COMPACTION_INSTRUCTION,
  assertBallChessCheckpoint,
  resolveSummaryPolicy
} from "./compaction-summary.js";

export default class BallChessCompactionEngine extends BasicCompactionEngine {
  async summarize(input, agent, signal) {
    const policy = resolveSummaryPolicy(this.config, agent);
    const assembler = new BlockAssembler();
    const messages = [
      ...input.messages,
      {
        role: "user",
        content: [{ type: "text", text: BALL_CHESS_COMPACTION_INSTRUCTION }]
      }
    ];
    const options = {
      provider: policy.provider,
      model: policy.model,
      messages,
      toolHistory: agent.session.toolHistory(),
      ...(input.tools === undefined ? {} : { tools: [...input.tools] }),
      maxTokens: policy.maxTokens,
      sessionId: agent.session.id,
      purpose: "compaction",
      ...(signal === undefined ? {} : { signal })
    };
    for await (const chunk of this.ctx.llm.stream(options)) assembler.push(chunk);

    if (assembler.finish.kind === "error" || assembler.finish.kind === "aborted") {
      throw new LlmError(
        assembler.finish.failure.message,
        assembler.finish.failure.code,
        assembler.finish.failure
      );
    }
    if (assembler.finish.kind === "max-tokens") {
      throw Object.assign(new Error("Ball Chess compaction summary was truncated"), { code: "MAX_TOKENS" });
    }

    const rawOutput = assembler.blocks();
    if (contentHasImage(rawOutput)) {
      throw new LlmError("Ball Chess compaction summary cannot contain images", "UNSUPPORTED_CONTENT");
    }
    const summary = rawOutput.filter((block) => block.type === "text");
    assertBallChessCheckpoint(summary.map((block) => block.text).join(""));
    return {
      summary,
      rawOutput,
      llmStreamCall: true,
      provider: options.provider,
      model: options.model,
      maxTokens: options.maxTokens,
      ...(assembler.usage === undefined ? {} : { usage: assembler.usage })
    };
  }
}
