import type {
  IdentitySearchRequest,
  IdentitySearchResponse,
  IdentityRecord,
} from "./types.js";
import { API_ROOTS } from "./constants.js";
import { RateLimiter } from "./rate-limiter.js";

const POLL_INITIAL_MS = 200;
const POLL_MAX_MS = 2000;
const POLL_MULTIPLIER = 1.5;

export class IdentityClient {
  private apiKey: string;
  private apiRoot: string;
  private userAgent: string;
  private limiter: RateLimiter;

  constructor(apiKey: string, userAgent: string = "IntelX-MCP/1.0") {
    this.apiKey = apiKey;
    this.apiRoot = API_ROOTS.IDENTITY;
    this.userAgent = userAgent;
    this.limiter = new RateLimiter();
  }

  private getHeaders(): Record<string, string> {
    return {
      "X-Key": this.apiKey,
      "User-Agent": this.userAgent,
    };
  }

  async search(params: IdentitySearchRequest): Promise<IdentityRecord[]> {
    await this.limiter.wait();

    const qp = new URLSearchParams({
      selector: params.selector,
      bucket: params.bucket || "",
      skipinvalid: String(params.skipinvalid ?? false),
      limit: String(params.limit || 100),
      analyze: String(params.analyze ?? false),
      datefrom: params.datefrom || "",
      dateto: params.dateto || "",
      terminate: JSON.stringify(params.terminate || []),
    });

    const response = await fetch(`${this.apiRoot}/live/search/internal?${qp}`, {
      headers: this.getHeaders(),
    });
    if (!response.ok) {
      throw new Error(`API ${response.status}: ${response.statusText}`);
    }

    const data = (await response.json()) as IdentitySearchResponse;
    if (String(data.id).length <= 3) {
      throw new Error(`Invalid search ID: ${data.id}`);
    }

    const allRecords: IdentityRecord[] = [];
    let remaining = params.limit || 100;
    let delay = POLL_INITIAL_MS;

    while (true) {
      await new Promise((r) => setTimeout(r, delay));
      const results = await this.getSearchResults(data.id, remaining);

      if (results.records?.length) {
        allRecords.push(...results.records);
        remaining -= results.records.length;
      }

      if (results.status === 2 || results.status === 3 || remaining <= 0) {
        if (remaining <= 0 || results.status === 3) await this.terminateSearch(data.id);
        break;
      }

      delay = Math.min(delay * POLL_MULTIPLIER, POLL_MAX_MS);
    }

    return allRecords;
  }

  private async getSearchResults(
    searchId: string,
    maxresults: number,
  ): Promise<IdentitySearchResponse> {
    await this.limiter.wait();
    const qp = new URLSearchParams({
      id: searchId,
      format: "1",
      limit: String(maxresults),
    });
    const response = await fetch(`${this.apiRoot}/live/search/result?${qp}`, {
      headers: this.getHeaders(),
    });
    if (!response.ok) {
      throw new Error(`API ${response.status}: ${response.statusText}`);
    }
    return (await response.json()) as IdentitySearchResponse;
  }

  private async terminateSearch(searchId: string): Promise<void> {
    await this.limiter.wait();
    const qp = new URLSearchParams({ id: searchId });
    await fetch(`${this.apiRoot}/live/search/terminate?${qp}`, {
      headers: this.getHeaders(),
    });
  }
}
