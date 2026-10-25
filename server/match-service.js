import { EventEmitter } from "node:events";
import { randomBytes } from "node:crypto";
import { GameError } from "../core/errors.js";
import { resolveMatchConfig } from "./config.js";
import {
  abortMatchRecord,
  createMatchRecord,
  expireMatchRecord,
  joinMatchRecord,
  restoreMatch,
  serializeMatch,
  statusFor,
  submitMatchAction,
  toPublicState
} from "./match-record.js";

function makeToken() {
  return randomBytes(16).toString("base64url");
}

function normalizeProfile(profile = {}) {
  const normalized = {};
  if (typeof profile.name === "string" && profile.name.trim()) normalized.name = profile.name.trim().slice(0, 80);
  if (typeof profile.clientKind === "string" && profile.clientKind.trim()) normalized.clientKind = profile.clientKind.trim().slice(0, 40);
  return normalized;
}

export class MatchService extends EventEmitter {
  constructor(store, {
    now = Date.now,
    setTimer = setTimeout,
    clearTimer = clearTimeout,
    onBackgroundError = (error) => console.error(error)
  } = {}) {
    super();
    this.store = store;
    this.now = now;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.onBackgroundError = onBackgroundError;
    this.matches = new Map();
    this.timers = new Map();
    this.unavailable = new Map();
    this.queues = new Map();
  }

  static async open({ store, ...dependencies }) {
    const service = new MatchService(store, dependencies);
    const { records, failures } = await store.loadAll();
    for (const failure of failures) service.unavailable.set(failure.matchId, failure);
    for (const raw of records) {
      try {
        const record = restoreMatch(raw);
        service.matches.set(record.id, record);
        service.armTimer(record);
      } catch (error) {
        service.unavailable.set(raw.id, { message: error.message });
      }
    }
    return service;
  }

  requireMatch(id) {
    const record = this.matches.get(id);
    if (record) return record;
    if (this.unavailable.has(id)) throw new GameError("MATCH_UNAVAILABLE", "Match record could not be restored");
    throw new GameError("MATCH_NOT_FOUND", "Match not found", { matchId: id });
  }

  seatForToken(record, token) {
    if (!token) throw new GameError("UNAUTHORIZED", "A valid player token is required");
    if (token === record.playerTokens.left) return "left";
    if (token === record.playerTokens.right) return "right";
    throw new GameError("UNAUTHORIZED", "Invalid player token");
  }

  enqueue(id, operation) {
    const previous = this.queues.get(id) || Promise.resolve();
    const run = previous.catch(() => {}).then(operation);
    this.queues.set(id, run);
    return run.finally(() => {
      if (this.queues.get(id) === run) this.queues.delete(id);
    });
  }

  async waitForWrites(id) {
    const pending = this.queues.get(id);
    if (pending) await pending.catch(() => {});
  }

  async commit(candidate) {
    try {
      await this.store.save(serializeMatch(candidate));
    } catch (error) {
      throw new GameError("STORAGE_ERROR", "Could not persist match", { message: error.message });
    }
    this.matches.set(candidate.id, candidate);
    this.armTimer(candidate);
    this.publishUpdate(candidate);
    return candidate;
  }

  reportBackgroundError(error, context) {
    try {
      this.onBackgroundError(error, context);
    } catch (reportError) {
      console.error("Ball Chess background error reporter failed", reportError);
    }
  }

  publishUpdate(record) {
    const payload = { matchId: record.id, state: toPublicState(record, null, this.now()) };
    for (const listener of this.rawListeners("update")) {
      try {
        const pending = listener.call(this, payload);
        Promise.resolve(pending).catch((error) => {
          this.reportBackgroundError(error, { operation: "publish_update", matchId: record.id });
        });
      } catch (error) {
        this.reportBackgroundError(error, { operation: "publish_update", matchId: record.id });
      }
    }
  }

  armTimer(record) {
    const old = this.timers.get(record.id);
    if (old) this.clearTimer(old);
    this.timers.delete(record.id);
    if (statusFor(record) !== "playing" || record.turnDeadlineAt === null) return;
    const delay = Math.max(0, record.turnDeadlineAt - this.now());
    const timer = this.setTimer(() => {
      this.expire(record.id, record.version).catch((error) => {
        this.reportBackgroundError(error, { operation: "expire_turn", matchId: record.id });
      });
    }, delay);
    timer.unref?.();
    this.timers.set(record.id, timer);
  }

  async create(options = {}) {
    const config = resolveMatchConfig(options);
    let id;
    do id = `m_${randomBytes(9).toString("base64url")}`; while (this.matches.has(id));
    const adminToken = makeToken();
    const playerTokens = { left: makeToken(), right: makeToken() };
    const record = createMatchRecord({ id, adminToken, playerTokens, config, now: this.now() });
    await this.commit(record);
    return { matchId: id, adminToken, playerTokens, state: toPublicState(record, null, this.now()) };
  }

  join(id, token, profile = {}) {
    return this.enqueue(id, async () => {
      const record = this.requireMatch(id);
      const seat = this.seatForToken(record, token);
      const candidate = joinMatchRecord(record, seat, normalizeProfile(profile), this.now());
      const current = candidate === record ? record : await this.commit(candidate);
      return toPublicState(current, seat, this.now());
    });
  }

  async getState(id, token) {
    await this.waitForWrites(id);
    let record = this.requireMatch(id);
    const seat = token === undefined ? null : this.seatForToken(record, token);
    const now = this.now();
    if (statusFor(record) === "playing" && record.turnDeadlineAt !== null && record.turnDeadlineAt <= now) {
      await this.expire(id, record.version);
      record = this.requireMatch(id);
    }
    return toPublicState(record, seat, now);
  }

  submitAction(id, token, expectedVersion, action) {
    return this.enqueue(id, async () => {
      const seat = this.seatForToken(this.requireMatch(id), token);
      const now = this.now();
      const record = await this.expireIfDue(this.requireMatch(id), now);
      if (record.game.result?.reason === "turn_timeout") {
        throw new GameError("TURN_EXPIRED", "The turn deadline has passed", { result: record.game.result });
      }
      const candidate = submitMatchAction(record, seat, expectedVersion, action, now);
      await this.commit(candidate);
      return toPublicState(candidate, seat, this.now());
    });
  }

  expire(id, version) {
    return this.enqueue(id, async () => {
      const record = this.requireMatch(id);
      if (record.version !== version) return record;
      return this.expireIfDue(record, this.now());
    });
  }

  async expireIfDue(record, now = this.now()) {
    if (statusFor(record) !== "playing" || record.turnDeadlineAt === null || record.turnDeadlineAt > now) return record;
    return this.commit(expireMatchRecord(record, now));
  }

  async getSetup(id, adminToken) {
    await this.waitForWrites(id);
    const record = this.requireMatch(id);
    if (!adminToken) throw new GameError("UNAUTHORIZED", "Administrator token is required");
    if (adminToken !== record.adminToken) throw new GameError("FORBIDDEN", "Administrator token is invalid");
    return { matchId: id, playerTokens: structuredClone(record.playerTokens) };
  }

  async getRecord(id) {
    await this.waitForWrites(id);
    const record = this.requireMatch(id);
    return {
      schemaVersion: 1,
      matchId: id,
      config: structuredClone(record.config),
      actions: structuredClone(record.actions),
      result: structuredClone(record.game.result),
      createdAt: record.createdAt,
      updatedAt: record.updatedAt
    };
  }

  abort(id, adminToken) {
    return this.enqueue(id, async () => {
      const record = this.requireMatch(id);
      if (!adminToken) throw new GameError("UNAUTHORIZED", "Administrator token is required");
      if (adminToken !== record.adminToken) throw new GameError("FORBIDDEN", "Administrator token is invalid");
      const candidate = abortMatchRecord(record, this.now());
      const current = candidate === record ? record : await this.commit(candidate);
      return toPublicState(current, null, this.now());
    });
  }

  close() {
    for (const timer of this.timers.values()) this.clearTimer(timer);
    this.timers.clear();
  }
}
