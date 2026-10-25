export class ApiError extends Error {
  constructor(message, { code = "API_ERROR", details = {}, state = null, status = null } = {}) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.details = details;
    this.state = state;
    this.status = status;
  }
}

export class MatchApi {
  constructor({ baseUrl = "", fetchImpl = (...args) => fetch(...args), eventSourceFactory = (url) => new EventSource(url) } = {}) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.fetch = fetchImpl;
    this.eventSourceFactory = eventSourceFactory;
  }

  path(matchId, suffix) {
    return `/api/matches/${encodeURIComponent(matchId)}${suffix}`;
  }

  async request(path, { token, method = "GET", body } = {}) {
    const response = await this.fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(body !== undefined ? { "content-type": "application/json" } : {})
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {})
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new ApiError(payload.error?.message || `Request failed with status ${response.status}`, {
        code: payload.error?.code || "HTTP_ERROR",
        details: payload.error?.details || {},
        state: payload.state,
        status: response.status
      });
    }
    return payload;
  }

  create(request) {
    return this.request("/api/matches", { method: "POST", body: request });
  }

  join(id, token, profile = {}) {
    return this.request(this.path(id, "/join"), { method: "POST", token, body: profile });
  }

  ready(id, token, ready) {
    return this.request(this.path(id, "/ready"), { method: "POST", token, body: { ready } });
  }

  state(id, token) {
    return this.request(this.path(id, "/state"), { token });
  }

  setup(id, adminToken) {
    return this.request(this.path(id, "/setup"), { token: adminToken });
  }

  submitAction(id, token, expectedVersion, action) {
    return this.request(this.path(id, "/actions"), { method: "POST", token, body: { expectedVersion, action } });
  }

  abort(id, adminToken) {
    return this.request(this.path(id, "/abort"), { method: "POST", token: adminToken });
  }

  events(id) {
    return this.eventSourceFactory(`${this.baseUrl}${this.path(id, "/events")}`);
  }
}
