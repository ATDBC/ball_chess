import { GameError } from "../core/errors.js";
import { projectRecord, projectState } from "./projection.js";
import { abortableDelay, readSseData } from "./sse.js";

function bindingKey(kind, value) {
  return `${kind}:${value}`;
}

function actionable(state) {
  if (state.status === "finished" || state.result) return { kind: "finished", state };
  if (state.status === "playing" && state.yourTurn) return { kind: "turn", state };
  return null;
}

export class BallChessAgentClient {
  constructor({ baseUrl, fetchImpl = fetch, binding = null, clientType = "agent" }) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.fetch = fetchImpl;
    this.binding = binding ? { ...binding } : null;
    this.clientType = clientType;
    this.bindingPromise = null;
    this.bindingFingerprint = binding ? bindingKey("match", binding.matchId) : null;
    this.closeController = new AbortController();
  }

  requireBinding() {
    if (!this.binding) throw new GameError("NOT_JOINED", "Join by invitation before using this tool");
    return this.binding;
  }

  async request(path, { token = this.binding?.playerToken, method = "GET", body, signal } = {}) {
    const response = await this.fetch(`${this.baseUrl}${path}`, {
      method,
      signal,
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(body === undefined ? {} : { "content-type": "application/json" })
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
    const payload = await response.json();
    if (!response.ok) {
      throw Object.assign(new Error(payload.error?.message || `HTTP ${response.status}`), {
        code: payload.error?.code || "HTTP_ERROR",
        details: payload.error?.details || {},
        state: payload.state || null,
        status: response.status
      });
    }
    return payload;
  }

  bindByInvite({ code, redemptionId, name = "Ball Chess agent", ready = false }) {
    const fingerprint = bindingKey("invite", `${code}:${redemptionId}`);
    return this.bindOnce(fingerprint, async () => {
      const redeemed = await this.request("/api/invitations/redeem", {
        token: null,
        method: "POST",
        body: { code, redemptionId, profile: { displayName: name, clientType: this.clientType } }
      });
      this.binding = { matchId: redeemed.matchId, seat: redeemed.seat, playerToken: redeemed.playerToken };
      let state = redeemed.state;
      if (ready) state = await this.request(`/api/matches/${encodeURIComponent(redeemed.matchId)}/ready`, { method: "POST", body: { ready: true } });
      return { kind: state.status === "playing" && state.yourTurn ? "turn" : state.status === "finished" ? "finished" : "waiting", state: projectState(state) };
    });
  }

  bindByToken({ matchId, playerToken, name = "Ball Chess agent" }) {
    const fingerprint = bindingKey("token", `${matchId}:${playerToken}`);
    return this.bindOnce(fingerprint, async () => {
      const state = await this.request(`/api/matches/${encodeURIComponent(matchId)}/join`, {
        token: playerToken,
        method: "POST",
        body: { displayName: name, clientType: this.clientType }
      });
      this.binding = { matchId, seat: state.yourPlayer, playerToken };
      return { kind: state.status, state: projectState(state) };
    });
  }

  bindOnce(fingerprint, operation) {
    if (this.binding) {
      if (this.bindingFingerprint !== fingerprint && !fingerprint.endsWith(`:${this.binding.matchId}`)) {
        throw new GameError("ALREADY_JOINED", "This client is already bound to another seat");
      }
      return this.getState().then((state) => ({ kind: state.status, state }));
    }
    if (this.bindingPromise) {
      if (this.bindingFingerprint !== fingerprint) throw new GameError("ALREADY_JOINED", "A different seat binding is already in progress");
      return this.bindingPromise;
    }
    this.bindingFingerprint = fingerprint;
    const attempt = operation();
    this.bindingPromise = attempt;
    return attempt.finally(() => {
      if (this.bindingPromise === attempt) this.bindingPromise = null;
    });
  }

  exportBinding() {
    const binding = this.requireBinding();
    return { ...binding };
  }

  async setReady(ready) {
    const { matchId } = this.requireBinding();
    const state = await this.request(`/api/matches/${encodeURIComponent(matchId)}/ready`, { method: "POST", body: { ready } });
    return { kind: actionable(state)?.kind || "waiting", state: projectState(state) };
  }

  async getState() {
    const { matchId } = this.requireBinding();
    return projectState(await this.request(`/api/matches/${encodeURIComponent(matchId)}/state`));
  }

  async getRecord(explicitMatchId = null) {
    const matchId = explicitMatchId ?? this.requireBinding().matchId;
    return projectRecord(await this.request(`/api/matches/${encodeURIComponent(matchId)}/record`, { token: null }));
  }

  async submitAction(expectedVersion, action) {
    const { matchId } = this.requireBinding();
    try {
      const state = await this.request(`/api/matches/${encodeURIComponent(matchId)}/actions`, {
        method: "POST",
        body: { expectedVersion, action }
      });
      return { ok: true, kind: actionable(state)?.kind || state.status, state: projectState(state) };
    } catch (error) {
      if (!error.code) throw error;
      let state = error.state ? projectState(error.state) : null;
      if (!state) {
        try { state = await this.getState(); } catch {
          // The original action failure remains authoritative when recovery also fails.
        }
      }
      return { ok: false, kind: actionable(state || {})?.kind || "error", error: { code: error.code, message: error.message, details: error.details || {} }, state };
    }
  }

  async waitForActionable({ signal } = {}) {
    const { matchId } = this.requireBinding();
    const combined = signal ? AbortSignal.any([signal, this.closeController.signal]) : this.closeController.signal;
    let state = await this.getState();
    let result = actionable(state);
    if (result) return result;
    while (!combined.aborted) {
      try {
        const response = await this.fetch(`${this.baseUrl}/api/matches/${encodeURIComponent(matchId)}/events`, { signal: combined });
        if (!response.ok || !response.body) throw new Error(`SSE HTTP ${response.status}`);
        for await (const data of readSseData(response.body, combined)) {
          const notification = JSON.parse(data);
          if (notification.version < state.version) continue;
          state = await this.getState();
          result = actionable(state);
          if (result) return result;
        }
      } catch (error) {
        if (combined.aborted) break;
        state = await this.getState();
        result = actionable(state);
        if (result) return result;
      }
      await abortableDelay(100, combined);
    }
    return { kind: "canceled", state };
  }

  close() {
    this.closeController.abort();
  }
}
