import type {
  IdentitySearchRequest,
  IdentitySearchResponse,
  IdentityRecord,
  AccountRecord,
  AccountExportResponse
} from './types.js';
import { API_ROOTS, API_RATE_LIMIT_MS } from './constants.js';

export class IdentityClient {
  private apiKey: string;
  private apiRoot: string;
  private userAgent: string;
  private lastRequestTime: number = 0;

  constructor(apiKey: string, userAgent: string = 'IntelX-MCP/1.0') {
    this.apiKey = apiKey;
    this.apiRoot = API_ROOTS.IDENTITY;
    this.userAgent = userAgent;
  }

  private async rateLimit(): Promise<void> {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;
    if (timeSinceLastRequest < API_RATE_LIMIT_MS) {
      await new Promise(resolve => setTimeout(resolve, API_RATE_LIMIT_MS - timeSinceLastRequest));
    }
    this.lastRequestTime = Date.now();
  }

  private getHeaders(): Record<string, string> {
    return {
      'X-Key': this.apiKey,
      'User-Agent': this.userAgent
    };
  }

  async search(params: IdentitySearchRequest): Promise<IdentityRecord[]> {
    await this.rateLimit();

    const queryParams = new URLSearchParams({
      selector: params.selector,
      bucket: params.bucket || '',
      skipinvalid: String(params.skipinvalid ?? false),
      limit: String(params.limit || 100),
      analyze: String(params.analyze ?? false),
      datefrom: params.datefrom || '',
      dateto: params.dateto || '',
      terminate: JSON.stringify(params.terminate || [])
    });

    const response = await fetch(
      `${this.apiRoot}/live/search/internal?${queryParams}`,
      { headers: this.getHeaders() }
    );

    if (!response.ok) {
      throw new Error(`API error ${response.status}: ${response.statusText}`);
    }

    const data = await response.json() as IdentitySearchResponse;
    const searchId = data.id;
    
    if (String(searchId).length <= 3) {
      throw new Error(`Invalid search ID: ${searchId}`);
    }

    const allRecords: IdentityRecord[] = [];
    let maxresults = params.limit || 100;

    while (true) {
      await new Promise(resolve => setTimeout(resolve, 1000));

      const results = await this.getSearchResults(searchId, maxresults);

      if (results.status === 0 && results.records) {
        allRecords.push(...results.records);
        maxresults -= results.records.length;
      }

      if (results.status === 2 || maxresults <= 0) {
        if (results.records) {
          allRecords.push(...results.records);
        }
        if (maxresults <= 0) {
          await this.terminateSearch(searchId);
        }
        break;
      }

      if (results.status === 3) {
        await this.terminateSearch(searchId);
        break;
      }
    }

    return allRecords;
  }

  private async getSearchResults(searchId: string, maxresults: number): Promise<IdentitySearchResponse> {
    await this.rateLimit();

    const queryParams = new URLSearchParams({
      id: searchId,
      format: '1',
      limit: String(maxresults)
    });

    const response = await fetch(
      `${this.apiRoot}/live/search/result?${queryParams}`,
      { headers: this.getHeaders() }
    );

    if (!response.ok) {
      throw new Error(`API error ${response.status}: ${response.statusText}`);
    }

    return await response.json() as IdentitySearchResponse;
  }

  private async terminateSearch(searchId: string): Promise<void> {
    await this.rateLimit();

    const queryParams = new URLSearchParams({ id: searchId });

    await fetch(
      `${this.apiRoot}/live/search/terminate?${queryParams}`,
      { headers: this.getHeaders() }
    );
  }

  async exportAccounts(
    selector: string,
    maxresults: number = 100,
    buckets?: string,
    datefrom?: string,
    dateto?: string,
    terminate?: string[]
  ): Promise<AccountRecord[]> {
    await this.rateLimit();

    const queryParams = new URLSearchParams({
      selector: selector,
      bucket: buckets || '',
      limit: String(maxresults),
      datefrom: datefrom || '',
      dateto: dateto || '',
      terminate: JSON.stringify(terminate || [])
    });

    const response = await fetch(
      `${this.apiRoot}/accounts/csv?${queryParams}`,
      { headers: this.getHeaders() }
    );

    if (!response.ok) {
      throw new Error(`API error ${response.status}: ${response.statusText}`);
    }

    const data = await response.json() as AccountExportResponse;
    const searchId = data.id;

    if (String(searchId).length <= 3) {
      throw new Error(`Invalid search ID: ${searchId}`);
    }

    const allRecords: AccountRecord[] = [];
    let remaining = maxresults;

    while (true) {
      await new Promise(resolve => setTimeout(resolve, 1000));

      const results = await this.getSearchResults(searchId, remaining);

      if (results.status === 0 && results.records) {
        allRecords.push(...(results.records as unknown as AccountRecord[]));
        remaining -= results.records.length;
      }

      if (results.status === 2 || remaining <= 0) {
        if (remaining <= 0) {
          await this.terminateSearch(searchId);
        }
        break;
      }
    }

    return allRecords;
  }
}

