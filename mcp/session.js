import { randomBytes } from "node:crypto";
import { BallChessAgentClient } from "../agent/client.js";

export class AgentSession {
  constructor({ baseUrl, matchId = null, token = null, fetchImpl = fetch }) {
    this.client = new BallChessAgentClient({ baseUrl, fetchImpl, clientType: "mcp" });
    this.prebound = matchId && token ? { matchId, playerToken: token } : null;
    this.bindingPromise = null;
  }

  ensureBound() {
    if (!this.prebound) return Promise.resolve();
    if (!this.bindingPromise) {
      this.bindingPromise = this.client.bindByToken({ ...this.prebound, name: "MCP agent" }).then(() => {
        this.prebound = null;
      }).catch((error) => {
        this.bindingPromise = null;
        throw error;
      });
    }
    return this.bindingPromise;
  }

  joinByInvite(code, name) {
    return this.client.bindByInvite({
      code,
      redemptionId: randomBytes(16).toString("hex"),
      name: name || "MCP agent",
      ready: true
    });
  }

  async setReady(ready) {
    await this.ensureBound();
    return this.client.setReady(ready);
  }

  async getState() {
    await this.ensureBound();
    return this.client.getState();
  }

  async submitAction(expectedVersion, action) {
    await this.ensureBound();
    return this.client.submitAction(expectedVersion, action);
  }

  async waitForTurn(signal) {
    await this.ensureBound();
    return this.client.waitForActionable({ signal });
  }

  close() {
    this.client.close();
  }
}
