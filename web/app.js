import { MatchApi } from "./api.js";
import { renderBoard } from "./board.js";
import { buildAgentPrompt, buildMcpConfig } from "./agent-instructions.js";
import { canInteract, shouldAcceptSnapshot, wallsRemaining } from "./state-view.js";

const api = new MatchApi({ baseUrl: "", eventSourceFactory: (url) => new EventSource(url) });
const byId = (id) => document.getElementById(id);
const boardElement = byId("board");
const statusElement = byId("status");
const sidebarElement = byId("sidebar");
const actionLogElement = byId("action-log");
const resultElement = byId("result");
const errorElement = byId("error");
const STORAGE_KEY = "ballChess.activeMatch";

let activeMatchId = null;
let activePlayerToken = null;
let activeAdminToken = null;
let activeSeat = "spectate";
let currentSetup = null;
let currentState = null;
let interactionMode = "move";
let wallOrientation = "h";
let actionPending = false;
let eventSource = null;
let connectionState = "live";
let actionEntries = new Map();
let expiredRefresh = null;

const SEAT_NAMES = { left: "左侧红球", right: "右侧蓝球" };
const DIRECTION_NAMES = { up: "上", down: "下", left: "左", right: "右" };

function showError(message) {
  errorElement.textContent = message;
}

function saveSession() {
  if (!activeMatchId) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      matchId: activeMatchId,
      adminToken: activeAdminToken,
      seat: activeSeat,
      ...(activeAdminToken ? {} : { playerToken: activePlayerToken })
    }));
  } catch {
    // The match remains usable when browser storage is unavailable.
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

function formatAction(entry) {
  const action = entry.action;
  const detail = action.type === "move"
    ? `向${DIRECTION_NAMES[action.direction]}移动`
    : `放${action.orientation === "h" ? "横" : "竖"}墙 (${action.x}, ${action.y})`;
  return `#${entry.ply} · ${SEAT_NAMES[entry.player]} · ${detail}`;
}

function renderActionLog() {
  const entries = [...actionEntries.values()].sort((a, b) => b.ply - a.ply).slice(0, 8);
  if (!entries.length) {
    actionLogElement.textContent = "尚未行动";
    return;
  }
  actionLogElement.replaceChildren(...entries.map((entry) => {
    const line = document.createElement("p");
    line.textContent = formatAction(entry);
    return line;
  }));
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

function renderStatus(state) {
  const connection = connectionState === "reconnecting" ? " · 正在重连" : "";
  if (state.status === "waiting") {
    const joined = Number(state.seats.left.joined) + Number(state.seats.right.joined);
    statusElement.textContent = `等待双方加入 · ${joined}/2${connection}`;
  } else if (state.status === "finished") {
    statusElement.textContent = `对局结束 · 共 ${state.plies} 手${connection}`;
  } else {
    const turn = state.yourTurn ? "轮到你行动" : `等待${SEAT_NAMES[state.currentPlayer]}`;
    statusElement.textContent = `${turn} · ${state.plies}/${state.config.maxPlies} 手${connection}`;
  }
  resultElement.textContent = resultText(state.result);
}

function renderSidebar(state) {
  sidebarElement.dataset.status = state.status;
  byId("left-walls").textContent = wallsRemaining(state, "left");
  byId("right-walls").textContent = wallsRemaining(state, "right");
  byId("left-status").classList.toggle("active", state.status === "playing" && state.currentPlayer === "left");
  byId("right-status").classList.toggle("active", state.status === "playing" && state.currentPlayer === "right");
  byId("left-status").title = state.seats.left.joined ? "左侧已加入" : "左侧等待加入";
  byId("right-status").title = state.seats.right.joined ? "右侧已加入" : "右侧等待加入";
  renderActionLog();
}

function renderAgentSetup() {
  const section = byId("agent-setup");
  section.hidden = !currentSetup;
  if (!currentSetup) return;
  const seat = byId("agent-seat").value;
  byId("mcp-config").textContent = JSON.stringify(buildMcpConfig(currentSetup.mcp), null, 2);
  byId("agent-prompt").textContent = buildAgentPrompt({
    matchId: activeMatchId,
    token: currentSetup.playerTokens[seat],
    seat
  });
  byId("abort-match").disabled = Boolean(currentState?.result);
}

function renderControls(state) {
  const interactive = Boolean(state && canInteract(state) && !actionPending);
  const actions = state?.legalActions || [];
  const hasMove = actions.some((action) => action.type === "move");
  const hasWall = actions.some((action) => action.type === "place_wall");
  if (!hasWall && interactionMode === "wall") interactionMode = "move";
  byId("mode-move").disabled = !interactive || !hasMove;
  byId("mode-wall").disabled = !interactive || !hasWall;
  byId("wall-orientation").disabled = !interactive || !hasWall;
  byId("mode-move").classList.toggle("active", interactionMode === "move");
  byId("mode-wall").classList.toggle("active", interactionMode === "wall");
  byId("mode-move").setAttribute("aria-pressed", String(interactionMode === "move"));
  byId("mode-wall").setAttribute("aria-pressed", String(interactionMode === "wall"));
}

function renderAll() {
  if (!currentState) {
    renderControls(null);
    return;
  }
  renderStatus(currentState);
  renderSidebar(currentState);
  renderControls(currentState);
  renderAgentSetup();
  renderBoard(boardElement, currentState, {
    legalActions: currentState.legalActions || [],
    mode: interactionMode,
    orientation: wallOrientation,
    interactive: canInteract(currentState) && !actionPending,
    onAction: submitBoardAction
  });
}

function acceptState(next) {
  if (!shouldAcceptSnapshot(currentState, next)) return;
  currentState = next;
  if (next.yourPlayer) activeSeat = next.yourPlayer;
  if (next.lastAction) actionEntries.set(next.lastAction.ply, next.lastAction);
  byId("match-id").textContent = next.matchId;
  renderAll();
}

async function refreshState() {
  if (!activeMatchId) return;
  const matchId = activeMatchId;
  const token = activePlayerToken;
  try {
    const next = await api.state(matchId, token || undefined);
    if (matchId === activeMatchId && token === activePlayerToken) acceptState(next);
  } catch (error) {
    if (matchId === activeMatchId) showError(error.message);
  }
}

function connectEvents() {
  closeEvents();
  if (!activeMatchId) return;
  const matchId = activeMatchId;
  eventSource = api.events(matchId);
  eventSource.onopen = () => {
    if (matchId !== activeMatchId) return;
    connectionState = "live";
    if (currentState) renderStatus(currentState);
  };
  eventSource.onmessage = (event) => {
    if (matchId !== activeMatchId) return;
    try {
      const snapshot = JSON.parse(event.data);
      if (!shouldAcceptSnapshot(currentState, snapshot)) return;
      if (activePlayerToken) refreshState();
      else acceptState(snapshot);
    } catch (error) {
      showError(error.message);
    }
  };
  eventSource.onerror = () => {
    if (matchId !== activeMatchId) return;
    connectionState = "reconnecting";
    if (currentState) renderStatus(currentState);
    refreshState();
  };
}

async function activateMatch(credentials, { persist = true } = {}) {
  closeEvents();
  activeMatchId = credentials.matchId;
  activeAdminToken = credentials.adminToken || null;
  activePlayerToken = credentials.playerToken || null;
  activeSeat = credentials.seat || "spectate";
  currentSetup = null;
  currentState = null;
  actionEntries = new Map();
  expiredRefresh = null;
  connectionState = "live";
  showError("");
  byId("match-id").textContent = activeMatchId;
  statusElement.textContent = "正在连接对局…";
  resultElement.textContent = "";
  actionLogElement.textContent = "尚未行动";
  renderAgentSetup();
  renderControls(null);

  if (activeAdminToken) {
    currentSetup = await api.setup(activeMatchId, activeAdminToken);
    if (activeSeat === "left" || activeSeat === "right") {
      activePlayerToken = currentSetup.playerTokens[activeSeat];
      byId("agent-seat").value = activeSeat === "left" ? "right" : "left";
    }
  }
  if (activePlayerToken) {
    const joined = await api.join(activeMatchId, activePlayerToken, { name: "浏览器玩家", clientKind: "browser" });
    acceptState(joined);
  }
  if (persist) saveSession();
  renderAgentSetup();
  connectEvents();
  await refreshState();
}

async function submitBoardAction(action) {
  if (!canInteract(currentState) || actionPending) return;
  const matchId = activeMatchId;
  const token = activePlayerToken;
  const expectedVersion = currentState.version;
  actionPending = true;
  showError("");
  renderAll();
  try {
    const next = await api.submitAction(matchId, token, expectedVersion, action);
    if (matchId === activeMatchId) acceptState(next);
  } catch (error) {
    if (matchId === activeMatchId) {
      showError(error.message);
      if (error.state) acceptState(error.state);
      if (["STALE_STATE", "NOT_YOUR_TURN", "ILLEGAL_ACTION", "MATCH_FINISHED"].includes(error.code)) await refreshState();
    }
  } finally {
    if (matchId === activeMatchId) {
      actionPending = false;
      await refreshState();
      renderAll();
    }
  }
}

byId("create-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const submit = event.currentTarget.querySelector("button[type=submit]");
  submit.disabled = true;
  showError("");
  try {
    const timeoutSeconds = byId("turn-timeout").value;
    const created = await api.create({
      wallLimit: byId("wall-mode").value === "finite" ? Number(byId("wall-limit").value) : null,
      maxPlies: Number(byId("max-plies").value),
      turnTimeoutMs: timeoutSeconds ? Number(timeoutSeconds) * 1000 : null,
      firstPlayer: byId("first-player").value
    });
    await activateMatch({ matchId: created.matchId, adminToken: created.adminToken, seat: byId("seat").value });
  } catch (error) {
    showError(error.message);
  } finally {
    submit.disabled = false;
  }
});

byId("join-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const matchId = byId("join-id").value.trim();
  const playerToken = byId("join-token").value.trim();
  try {
    await activateMatch({ matchId, playerToken: playerToken || null, seat: playerToken ? "player" : "spectate" });
    byId("join-token").value = "";
  } catch (error) {
    showError(error.message);
  }
});

byId("wall-mode").addEventListener("change", (event) => {
  byId("wall-limit").disabled = event.target.value !== "finite";
});
byId("mode-move").addEventListener("click", () => {
  interactionMode = "move";
  renderAll();
});
byId("mode-wall").addEventListener("click", () => {
  interactionMode = "wall";
  renderAll();
});
byId("wall-orientation").addEventListener("change", (event) => {
  wallOrientation = event.target.value;
  renderAll();
});
byId("agent-seat").addEventListener("change", renderAgentSetup);

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
byId("copy-mcp").addEventListener("click", (event) => copyText(byId("mcp-config").textContent, event.currentTarget));
byId("copy-prompt").addEventListener("click", (event) => copyText(byId("agent-prompt").textContent, event.currentTarget));
byId("abort-match").addEventListener("click", async () => {
  if (!activeAdminToken || !window.confirm("确定中止当前对局？此操作不能撤销。")) return;
  try {
    await api.abort(activeMatchId, activeAdminToken);
    await refreshState();
  } catch (error) {
    showError(error.message);
  }
});

setInterval(() => {
  if (!currentState) return;
  if (currentState.status === "finished") {
    byId("countdown").textContent = "对局已结束";
    return;
  }
  if (currentState.turnDeadlineAt === null) {
    byId("countdown").textContent = "回合不限时";
    return;
  }
  const remaining = Math.max(0, currentState.turnDeadlineAt - Date.now());
  byId("countdown").textContent = remaining > 0
    ? `${SEAT_NAMES[currentState.currentPlayer]} · 剩余 ${(remaining / 1000).toFixed(1)} 秒`
    : "等待服务端结算超时…";
  if (remaining === 0 && expiredRefresh !== currentState.turnDeadlineAt) {
    expiredRefresh = currentState.turnDeadlineAt;
    refreshState();
  }
}, 250);

async function restore() {
  let saved;
  try {
    saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
  } catch {
    return;
  }
  if (!saved || typeof saved.matchId !== "string") return;
  try {
    await activateMatch(saved, { persist: false });
  } catch (error) {
    showError(`恢复对局失败：${error.message}`);
  }
}

renderControls(null);
restore();
window.addEventListener("beforeunload", closeEvents);
