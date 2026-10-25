import { MatchApi } from "./api.js";
import { acceptSnapshot, activateIdentity, createAppState, createRefreshCoordinator, stageFor } from "./app-state.js";
import { renderBoard } from "./board.js";
import { canInteract, nextReadyValue, resolveInteractionMode, seatPhaseText, wallsRemaining } from "./state-view.js";

const api = new MatchApi({ baseUrl: "", eventSourceFactory: (url) => new EventSource(url) });
const byId = (id) => document.getElementById(id);
const STORAGE_KEY = "ballChess.activeMatch.v2";
const SEAT_NAMES = { left: "左侧红球", right: "右侧蓝球" };
const DIRECTION_NAMES = { up: "上", down: "下", left: "左", right: "右" };

let appState = createAppState();
let eventSource = null;
let invitationText = "";
let pendingRedemption = null;

function showError(message = "") {
  byId("error").textContent = message;
}

function resultText(result) {
  if (!result) return "";
  if (result.reason === "reached_goal") return `${SEAT_NAMES[result.winner]}抵达顶边，获胜。`;
  if (result.reason === "max_plies") return "已达到行动上限，本局和棋。";
  if (result.reason === "no_legal_action") return `${SEAT_NAMES[result.winner]}获胜：对方无合法行动。`;
  if (result.reason === "turn_timeout") return `${SEAT_NAMES[result.winner]}获胜：对方回合超时。`;
  if (result.reason === "admin_abort") return "对局已由管理员中止。";
  return `${result.kind}: ${result.reason}`;
}

function formatAction(entry) {
  const action = entry.action;
  const detail = action.type === "move"
    ? `向${DIRECTION_NAMES[action.direction]}移动`
    : `放${action.orientation === "h" ? "横" : "竖"}墙 (${action.x}, ${action.y})`;
  return `#${entry.ply} · ${SEAT_NAMES[entry.player]} · ${detail}`;
}

function persistIdentity() {
  const { matchId, role, seat, adminToken, playerToken } = appState.identity;
  if (!matchId) {
    localStorage.removeItem(STORAGE_KEY);
    return;
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ matchId, role, seat, adminToken, playerToken }));
  } catch {
    // A blocked storage area does not prevent the current page from playing.
  }
}

function closeEvents() {
  if (!eventSource) return;
  eventSource.onmessage = null;
  eventSource.onerror = null;
  eventSource.onopen = null;
  eventSource.close();
  eventSource = null;
}

function renderRecord() {
  const element = byId("finished-record");
  if (!appState.record) {
    element.textContent = "正在读取完整棋谱…";
    return;
  }
  if (!appState.record.actions.length) {
    element.textContent = "本局没有行动。";
    return;
  }
  element.replaceChildren(...appState.record.actions.map((entry) => {
    const line = document.createElement("p");
    line.textContent = formatAction(entry);
    return line;
  }));
}

function renderStatus(snapshot) {
  const reconnecting = appState.connection === "reconnecting" ? " · 正在重连" : "";
  if (!snapshot) {
    byId("status").textContent = appState.identity.matchId ? "正在读取对局…" : "创建、输入邀请码，或观战一局。";
    return;
  }
  if (snapshot.status === "waiting") {
    const phases = [snapshot.seats.left.phase, snapshot.seats.right.phase];
    byId("status").textContent = `等待双方准备 · 已加入 ${phases.filter((phase) => phase !== "open").length}/2 · 已准备 ${phases.filter((phase) => phase === "ready").length}/2${reconnecting}`;
  } else if (snapshot.status === "finished") {
    byId("status").textContent = `对局结束 · 共 ${snapshot.plies} 手${reconnecting}`;
  } else {
    const turn = snapshot.yourTurn ? "轮到你行动" : `等待${SEAT_NAMES[snapshot.currentPlayer]}`;
    byId("status").textContent = `${turn} · ${snapshot.plies}/${snapshot.config.maxPlies} 手${reconnecting}`;
  }
}

function renderAll() {
  const snapshot = appState.snapshot;
  const stage = stageFor(appState);
  document.body.dataset.stage = stage;
  for (const panel of document.querySelectorAll("[data-stage-panel]")) {
    panel.hidden = panel.dataset.stagePanel !== stage;
  }
  byId("match-id").textContent = appState.identity.matchId || "尚未加入";
  renderStatus(snapshot);
  byId("result").textContent = resultText(snapshot?.result);
  byId("identity-summary").textContent = appState.identity.role === "player"
    ? `你控制${SEAT_NAMES[appState.identity.seat] || "一个席位"}。双方准备后自动开始。`
    : appState.identity.role === "admin" ? "你正在管理并观战此对局。" : "你正在观战。";

  if (!snapshot) {
    byId("ready-toggle").hidden = true;
    return;
  }
  for (const seat of ["left", "right"]) {
    byId(`${seat}-phase`).textContent = seatPhaseText(snapshot.seats[seat].phase);
    byId(`${seat}-walls`).textContent = wallsRemaining(snapshot, seat);
    byId(`${seat}-status`).classList.toggle("active", snapshot.status === "playing" && snapshot.currentPlayer === seat);
  }

  const ready = nextReadyValue(snapshot);
  byId("ready-toggle").hidden = ready === null;
  byId("ready-toggle").disabled = appState.pending === "ready";
  byId("ready-toggle").textContent = ready === false ? "取消准备" : "准备";
  byId("admin-invitations").hidden = !appState.identity.adminToken;
  byId("abort-match").hidden = !appState.identity.adminToken;
  for (const seat of ["left", "right"]) {
    byId(`invite-${seat}`).disabled = snapshot.status !== "waiting" || snapshot.seats[seat].phase !== "open" || appState.pending === "invitation";
  }

  const interactive = canInteract(snapshot) && appState.pending !== "action";
  const actions = snapshot.legalActions || [];
  appState = {
    ...appState,
    ui: {
      ...appState.ui,
      actionMode: resolveInteractionMode(snapshot, appState.ui.actionMode, appState.pending === "action")
    }
  };
  byId("mode-move").disabled = !interactive || !actions.some((action) => action.type === "move");
  byId("mode-wall").disabled = !interactive || !actions.some((action) => action.type === "place_wall");
  byId("wall-orientation").disabled = !interactive || !actions.some((action) => action.type === "place_wall");
  byId("wall-orientation").value = appState.ui.wallOrientation;
  byId("mode-move").classList.toggle("active", appState.ui.actionMode === "move");
  byId("mode-wall").classList.toggle("active", appState.ui.actionMode === "wall");
  renderBoard(byId("board"), snapshot, {
    legalActions: actions,
    mode: appState.ui.actionMode,
    orientation: appState.ui.wallOrientation,
    interactive,
    onAction: submitBoardAction,
    onModeChange: (actionMode) => { appState = { ...appState, ui: { ...appState.ui, actionMode } }; renderAll(); },
    onOrientationChange: (wallOrientation) => { appState = { ...appState, ui: { ...appState.ui, wallOrientation } }; renderAll(); },
    onCancel: () => { appState = { ...appState, ui: { ...appState.ui, actionMode: "move" } }; renderAll(); }
  });

  const logEntries = appState.record?.actions || (snapshot.lastAction ? [snapshot.lastAction] : []);
  byId("action-log").replaceChildren(...(logEntries.length ? [...logEntries].reverse().slice(0, 8).map((entry) => {
    const line = document.createElement("p");
    line.textContent = formatAction(entry);
    return line;
  }) : [document.createTextNode("尚未行动")]));
  renderRecord();
}

async function loadFinishedRecord(matchId, epoch) {
  if (appState.record || stageFor(appState) !== "finished") return;
  try {
    const record = await api.record(matchId);
    if (appState.identity.epoch === epoch && appState.identity.matchId === matchId) {
      appState = { ...appState, record };
      renderAll();
    }
  } catch (error) {
    showError(error.message);
  }
}

const refreshCoordinator = createRefreshCoordinator(async () => {
  const { matchId, playerToken, epoch } = appState.identity;
  if (!matchId) return;
  try {
    const snapshot = await api.state(matchId, playerToken || undefined);
    appState = acceptSnapshot(appState, snapshot, epoch);
    appState = { ...appState, connection: "live" };
    showError();
    renderAll();
    await loadFinishedRecord(matchId, epoch);
  } catch (error) {
    if (appState.identity.epoch !== epoch) return;
    showError(error.message);
    appState = { ...appState, connection: "reconnecting" };
    renderAll();
  }
});

function connectEvents() {
  closeEvents();
  const { matchId, epoch } = appState.identity;
  if (!matchId) return;
  eventSource = api.events(matchId);
  eventSource.onopen = () => {
    if (appState.identity.epoch !== epoch) return;
    appState = { ...appState, connection: "live" };
    renderAll();
  };
  eventSource.onmessage = () => {
    if (appState.identity.epoch === epoch) refreshCoordinator.refresh();
  };
  eventSource.onerror = () => {
    if (appState.identity.epoch !== epoch) return;
    appState = { ...appState, connection: "reconnecting" };
    renderAll();
    refreshCoordinator.refresh();
  };
}

async function activateMatch(identity, initialSnapshot = null, { claimCompatibility = false, persist = true } = {}) {
  closeEvents();
  appState = activateIdentity(appState, identity);
  invitationText = "";
  byId("invitation-result").hidden = true;
  showError();
  if (claimCompatibility && identity.playerToken) {
    initialSnapshot = await api.join(identity.matchId, identity.playerToken, { displayName: "浏览器玩家", clientType: "browser" });
  }
  if (initialSnapshot) appState = acceptSnapshot(appState, initialSnapshot, appState.identity.epoch);
  if (persist) persistIdentity();
  renderAll();
  connectEvents();
  await refreshCoordinator.refresh();
}

function resetToOutside() {
  closeEvents();
  appState = createAppState();
  pendingRedemption = null;
  invitationText = "";
  localStorage.removeItem(STORAGE_KEY);
  showError();
  renderAll();
}

function randomRedemptionId() {
  return [...crypto.getRandomValues(new Uint8Array(16))].map((value) => value.toString(16).padStart(2, "0")).join("");
}

async function submitBoardAction(action) {
  if (!canInteract(appState.snapshot) || appState.pending) return;
  const { matchId, playerToken, epoch } = appState.identity;
  appState = { ...appState, pending: "action" };
  renderAll();
  try {
    const next = await api.submitAction(matchId, playerToken, appState.snapshot.version, action);
    appState = acceptSnapshot(appState, next, epoch);
  } catch (error) {
    showError(error.message);
    if (error.state) appState = acceptSnapshot(appState, error.state, epoch);
  } finally {
    if (appState.identity.epoch === epoch) appState = { ...appState, pending: null };
    await refreshCoordinator.refresh();
    renderAll();
  }
}

byId("create-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = event.currentTarget.querySelector("button[type=submit]");
  button.disabled = true;
  try {
    const seat = byId("seat").value;
    const timeoutSeconds = byId("turn-timeout").value;
    const created = await api.create({
      config: {
        wallLimit: byId("wall-mode").value === "finite" ? Number(byId("wall-limit").value) : null,
        maxPlies: Number(byId("max-plies").value),
        turnTimeoutMs: timeoutSeconds ? Number(timeoutSeconds) * 1000 : null,
        firstPlayer: byId("first-player").value
      },
      ...(seat === "spectate" ? {} : { claim: { seat, profile: { displayName: byId("create-name").value.trim(), clientType: "browser" } } })
    });
    await activateMatch({
      matchId: created.matchId,
      role: seat === "spectate" ? "admin" : "player",
      seat,
      adminToken: created.adminToken,
      playerToken: created.playerToken || null
    }, created.state);
  } catch (error) {
    showError(error.message);
  } finally {
    button.disabled = false;
  }
});

byId("invite-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const code = byId("invite-code").value.trim();
  if (!pendingRedemption || pendingRedemption.code !== code) pendingRedemption = { code, redemptionId: randomRedemptionId() };
  try {
    const redeemed = await api.redeemInvitation({
      inviteCode: code,
      redemptionId: pendingRedemption.redemptionId,
      profile: { displayName: byId("invite-name").value.trim(), clientType: "browser" }
    });
    pendingRedemption = null;
    await activateMatch({ matchId: redeemed.matchId, role: "player", seat: redeemed.seat, playerToken: redeemed.playerToken }, redeemed.state);
  } catch (error) {
    showError(`${error.message}；如结果不确定，可直接重试同一邀请码。`);
  }
});

byId("spectate-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  await activateMatch({ matchId: byId("spectate-id").value.trim(), role: "spectator", seat: "spectate" });
});

byId("join-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const matchId = byId("join-id").value.trim();
  const playerToken = byId("join-token").value.trim();
  await activateMatch({ matchId, role: "player", seat: "player", playerToken }, null, { claimCompatibility: true });
  byId("join-token").value = "";
});

byId("ready-toggle").addEventListener("click", async () => {
  const ready = nextReadyValue(appState.snapshot);
  if (ready === null || appState.pending) return;
  const { matchId, playerToken, epoch } = appState.identity;
  appState = { ...appState, pending: "ready" };
  renderAll();
  try {
    appState = acceptSnapshot(appState, await api.ready(matchId, playerToken, ready), epoch);
  } catch (error) {
    showError(error.message);
  } finally {
    if (appState.identity.epoch === epoch) appState = { ...appState, pending: null };
    renderAll();
  }
});

for (const seat of ["left", "right"]) {
  byId(`invite-${seat}`).addEventListener("click", async () => {
    if (!appState.identity.adminToken || appState.pending) return;
    appState = { ...appState, pending: "invitation" };
    renderAll();
    try {
      const invitation = await api.createInvitation(appState.identity.matchId, appState.identity.adminToken, seat);
      invitationText = `加入邀请码 ${invitation.code} 并开始`;
      byId("invitation-code").textContent = invitation.code;
      byId("invitation-result").hidden = false;
      appState = acceptSnapshot(appState, invitation.state, appState.identity.epoch);
    } catch (error) {
      showError(error.message);
    } finally {
      appState = { ...appState, pending: null };
      renderAll();
    }
  });
}

async function copyText(text, button) {
  try {
    await navigator.clipboard.writeText(text);
    const original = button.textContent;
    button.textContent = "已复制";
    setTimeout(() => { button.textContent = original; }, 1400);
  } catch (error) {
    showError(error.message);
  }
}

byId("copy-invitation").addEventListener("click", (event) => copyText(invitationText, event.currentTarget));
byId("leave-match").addEventListener("click", resetToOutside);
byId("new-match").addEventListener("click", resetToOutside);
byId("abort-match").addEventListener("click", async () => {
  if (!appState.identity.adminToken || !window.confirm("确定中止当前对局？此操作不能撤销。")) return;
  try {
    await api.abort(appState.identity.matchId, appState.identity.adminToken);
    await refreshCoordinator.refresh();
  } catch (error) {
    showError(error.message);
  }
});
byId("wall-mode").addEventListener("change", (event) => { byId("wall-limit").disabled = event.target.value !== "finite"; });
byId("mode-move").addEventListener("click", () => { appState = { ...appState, ui: { ...appState.ui, actionMode: "move" } }; renderAll(); });
byId("mode-wall").addEventListener("click", () => { appState = { ...appState, ui: { ...appState.ui, actionMode: "wall" } }; renderAll(); });
byId("wall-orientation").addEventListener("change", (event) => { appState = { ...appState, ui: { ...appState.ui, wallOrientation: event.target.value } }; renderAll(); });

setInterval(() => {
  const snapshot = appState.snapshot;
  if (!snapshot) { byId("countdown").textContent = "回合不限时"; return; }
  if (snapshot.status === "finished") { byId("countdown").textContent = "对局已结束"; return; }
  if (snapshot.turnDeadlineAt === null) { byId("countdown").textContent = "回合不限时"; return; }
  const remaining = Math.max(0, snapshot.turnDeadlineAt - Date.now());
  byId("countdown").textContent = remaining > 0 ? `${SEAT_NAMES[snapshot.currentPlayer]} · 剩余 ${(remaining / 1000).toFixed(1)} 秒` : "等待服务端结算超时…";
  if (remaining === 0) refreshCoordinator.refresh();
}, 250);

async function restore() {
  let saved;
  try { saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null"); } catch { return; }
  if (!saved?.matchId) return;
  try { await activateMatch(saved, null, { persist: false }); } catch (error) { showError(`恢复对局失败：${error.message}`); }
}

renderAll();
restore();
window.addEventListener("beforeunload", closeEvents);
