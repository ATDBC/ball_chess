import { GameError } from "../core/errors.js";
import { toAscii } from "./ascii.js";

function withAscii(state) {
  const projected = { ...state, ascii: toAscii(state) };
  if (Array.isArray(state.legalActions)) {
    const legalActions = { moves: [], walls: { h: [], v: [] } };
    for (const action of state.legalActions) {
      if (action.type === "move") legalActions.moves.push(action.direction);
      if (action.type === "place_wall") legalActions.walls[action.orientation].push([action.x, action.y]);
    }
    projected.legalActions = legalActions;
  }
  return projected;
}

export class AgentSession {
  constructor({ baseUrl, matchId = null, token = null, fetchImpl = fetch }) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.fetch = fetchImpl;
    this.matchId = matchId;
    this.token = token;
    this.joined = false;
    this.joining = null;
  }

  async request(suffix, { token = this.token, ...options } = {}) {
    const response = await this.fetch(`${this.baseUrl}${suffix}`, {
      ...options,
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(options.body ? { "content-type": "application/json" } : {}),
        ...options.headers
      }
    });
    const body = await response.json();
    if (!response.ok) {
      throw Object.assign(new Error(body.error?.message || "HTTP request failed"), {
        code: body.error?.code || "HTTP_ERROR",
        details: body.error?.details || {},
        state: body.state
      });
    }
    return body;
  }

  requireBinding() {
    if (!this.matchId || !this.token) throw new GameError("NOT_JOINED", "Call join_match before using this tool");
  }

  async ensureJoined() {
    this.requireBinding();
    if (this.joined) return;
    if (!this.joining) {
      this.joining = this.join(this.matchId, this.token).finally(() => {
        this.joining = null;
      });
    }
    await this.joining;
  }

  async join(matchId, token, name) {
    if (this.matchId && (this.matchId !== matchId || this.token !== token)) {
      throw new GameError("ALREADY_JOINED", "This MCP session is already bound to a match seat");
    }
    const state = await this.request(`/api/matches/${matchId}/join`, {
      token,
      method: "POST",
      body: JSON.stringify({ name: name || "MCP agent", clientKind: "mcp" })
    });
    this.matchId = matchId;
    this.token = token;
    this.joined = true;
    return withAscii(state);
  }

  async getState() {
    await this.ensureJoined();
    return withAscii(await this.request(`/api/matches/${this.matchId}/state`));
  }

  async submitAction(expectedVersion, action) {
    await this.ensureJoined();
    try {
      const state = await this.request(`/api/matches/${this.matchId}/actions`, {
        method: "POST",
        body: JSON.stringify({ expectedVersion, action })
      });
      return { ok: true, state: withAscii(state) };
    } catch (error) {
      if (!error.code) throw error;
      let state = error.state ? withAscii(error.state) : null;
      if (!state) {
        try {
          state = await this.getState();
        } catch {
          // Preserve the original action error if a recovery snapshot is unavailable.
        }
      }
      return {
        ok: false,
        error: { code: error.code, message: error.message, details: error.details || {} },
        state
      };
    }
  }

  async waitForTurn(timeoutSeconds = 10) {
    await this.ensureJoined();
    let state = await this.getState();
    const finished = () => state.status === "finished" || Boolean(state.result);
    if (state.yourTurn || finished()) return { waiting: false, state };

    const duration = Math.min(15, Math.max(1, timeoutSeconds)) * 1000;
    const endAt = Date.now() + duration;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), duration);
    try {
      while (Date.now() < endAt && !controller.signal.aborted) {
        let reader;
        try {
          const response = await this.fetch(`${this.baseUrl}/api/matches/${this.matchId}/events`, { signal: controller.signal });
          if (!response.ok || !response.body) throw new Error(`SSE request failed with status ${response.status}`);
          reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            let end;
            while ((end = buffer.indexOf("\n\n")) >= 0) {
              const packet = buffer.slice(0, end);
              buffer = buffer.slice(end + 2);
              const data = packet.split("\n").find((line) => line.startsWith("data:"));
              if (!data) continue;
              const snapshot = JSON.parse(data.slice(5).trim());
              if (snapshot.version < state.version) continue;
              state = await this.getState();
              if (state.yourTurn || finished()) return { waiting: false, state };
            }
          }
        } catch (error) {
          if (controller.signal.aborted || Date.now() >= endAt) break;
        } finally {
          if (reader) await reader.cancel().catch(() => {});
        }
        const remaining = endAt - Date.now();
        if (remaining > 0 && !controller.signal.aborted) {
          await new Promise((resolve) => setTimeout(resolve, Math.min(100, remaining)));
        }
      }
      return { waiting: !(state.yourTurn || finished()), state };
    } finally {
      clearTimeout(timeout);
      controller.abort();
    }
  }
}
