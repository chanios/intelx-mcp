const API_RATE_LIMIT_MS = 1000;

export class RateLimiter {
  private lastRequestTime = 0;

  async wait(): Promise<void> {
    const elapsed = Date.now() - this.lastRequestTime;
    if (elapsed < API_RATE_LIMIT_MS) {
      await new Promise((r) => setTimeout(r, API_RATE_LIMIT_MS - elapsed));
    }
    this.lastRequestTime = Date.now();
  }
}
