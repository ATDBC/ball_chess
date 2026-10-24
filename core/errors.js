export class GameError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "GameError";
    this.code = code;
    this.details = details;
  }
}
