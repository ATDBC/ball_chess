const EMPTY_IDENTITY = Object.freeze({
  matchId: null,
  role: "outside",
  seat: "spectate",
  adminToken: null,
  playerToken: null,
  epoch: 0
});

export function createAppState() {
  return {
    identity: { ...EMPTY_IDENTITY },
    snapshot: null,
    record: null,
    connection: "idle",
    pending: null,
    ui: { actionMode: "move", wallOrientation: "h" }
  };
}

export function activateIdentity(state, identity) {
  return {
    ...createAppState(),
    identity: {
      ...EMPTY_IDENTITY,
      ...identity,
      epoch: state.identity.epoch + 1
    },
    connection: "connecting",
    ui: { ...state.ui }
  };
}

export function acceptSnapshot(state, snapshot, epoch) {
  if (epoch !== state.identity.epoch) return state;
  if (snapshot.matchId !== state.identity.matchId) return state;
  if (state.snapshot && snapshot.version < state.snapshot.version) return state;
  return { ...state, snapshot };
}

export function stageFor(state) {
  if (!state.identity.matchId) return "outside";
  if (state.snapshot?.status === "finished") return "finished";
  if (state.snapshot?.status === "playing") return "playing";
  return "waiting";
}

export function createRefreshCoordinator(load) {
  let inFlight = null;
  return {
    refresh(...args) {
      if (inFlight) return inFlight;
      inFlight = Promise.resolve(load(...args)).finally(() => {
        inFlight = null;
      });
      return inFlight;
    }
  };
}

