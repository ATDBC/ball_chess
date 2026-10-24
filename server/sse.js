export class SseHub {
  constructor() {
    this.clients = new Map();
    this.heartbeat = setInterval(() => {
      for (const clients of this.clients.values()) {
        for (const res of clients) res.write(": ping\n\n");
      }
    }, 15000);
    this.heartbeat.unref();
  }

  add(matchId, req, res, initialState) {
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
      "x-accel-buffering": "no"
    });
    res.write(`id: ${initialState.version}\ndata: ${JSON.stringify(initialState)}\n\n`);
    if (!this.clients.has(matchId)) this.clients.set(matchId, new Set());
    this.clients.get(matchId).add(res);
    req.on("close", () => {
      const clients = this.clients.get(matchId);
      clients?.delete(res);
      if (clients?.size === 0) this.clients.delete(matchId);
    });
  }

  publish(matchId, state) {
    for (const res of this.clients.get(matchId) || []) {
      res.write(`id: ${state.version}\ndata: ${JSON.stringify(state)}\n\n`);
    }
  }

  close() {
    clearInterval(this.heartbeat);
    for (const clients of this.clients.values()) {
      for (const res of clients) res.end();
    }
    this.clients.clear();
  }
}
