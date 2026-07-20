class RequestManager {
  constructor() {
    this.requests = new Map();
  }

  start(sessionId, child) {
    if (this.requests.has(sessionId)) return false;
    this.requests.set(sessionId, child);
    return true;
  }

  isRunning(sessionId) {
    return this.requests.has(sessionId);
  }

  stop(sessionId) {
    const child = this.requests.get(sessionId);
    if (!child) return false;
    child.kill();
    return true;
  }

  finish(sessionId, child) {
    if (this.requests.get(sessionId) === child) this.requests.delete(sessionId);
  }
}

module.exports = { RequestManager };
