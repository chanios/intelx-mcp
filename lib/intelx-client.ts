import type {
  SearchRequest,
  PhonebookSearchRequest,
  SearchResponse,
  SearchResultResponse,
  PhonebookResultResponse,
  TreeViewItem,
  Selector,
  CapabilitiesResponse,
} from "./types.js";
import {
  API_ROOTS,
  FILE_FORMATS,
  SEARCH_STATUS,
  PHONEBOOK_TARGETS,
} from "./constants.js";
import { RateLimiter } from "./rate-limiter.js";

const POLL_INITIAL_MS = 200;
const POLL_MAX_MS = 2000;
const POLL_MULTIPLIER = 1.5;
const MAX_FILE_VIEW_BYTES = 10 * 1024 * 1024; // 10MB cap for text file views
const MAX_FILE_READ_BYTES = 50 * 1024 * 1024; // 50MB cap for binary reads
const MAX_FILE_DOWNLOAD_BYTES = 500 * 1024 * 1024; // 500MB cap for streamed downloads

export class IntelXClient {
  private apiKey: string;
  private apiRoot: string;
  private userAgent: string;
  private limiter: RateLimiter;

  constructor(apiKey: string, userAgent: string = "IntelX-MCP/1.0") {
    this.apiKey = apiKey;
    this.apiRoot = API_ROOTS.MAIN;
    this.userAgent = userAgent;
    this.limiter = new RateLimiter();
  }

  private getHeaders(): Record<string, string> {
    return {
      "X-Key": this.apiKey,
      "User-Agent": this.userAgent,
      "Content-Type": "application/json",
    };
  }

  private async fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
    const response = await fetch(url, { headers: this.getHeaders(), ...init });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`API ${response.status}: ${response.statusText}${body ? ` - ${body}` : ""}`);
    }
    return response.json() as Promise<T>;
  }

  private async fetchText(url: string, init?: RequestInit, maxBytes?: number): Promise<string> {
    const response = await fetch(url, init);
    if (!response.ok) {
      throw new Error(`API ${response.status}: ${response.statusText}`);
    }
    if (maxBytes && response.body) {
      const reader = response.body.getReader();
      const decoder = new TextDecoder("utf-8", { fatal: false });
      let result = "";
      let bytesRead = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytesRead += value.byteLength;
        if (bytesRead > maxBytes) {
          result += decoder.decode(value.slice(0, value.byteLength - (bytesRead - maxBytes)), { stream: false });
          reader.cancel();
          break;
        }
        result += decoder.decode(value, { stream: true });
      }
      return result;
    }
    return response.text();
  }

  async intelligentSearch(params: SearchRequest): Promise<string> {
    await this.limiter.wait();
    const data = await this.fetchJson<SearchResponse>(
      `${this.apiRoot}/intelligent/search`,
      {
        method: "POST",
        body: JSON.stringify({
          term: params.term,
          buckets: params.buckets || [],
          lookuplevel: 0,
          maxresults: params.maxresults || 100,
          timeout: params.timeout || 5,
          datefrom: params.datefrom || "",
          dateto: params.dateto || "",
          sort: params.sort ?? 4,
          media: params.media ?? 0,
          terminate: params.terminate || [],
        }),
      },
    );
    if (data.status === 1) throw new Error("Invalid search term");
    return data.id;
  }

  async getSearchResults(searchId: string, limit: number = 100): Promise<SearchResultResponse> {
    await this.limiter.wait();
    return this.fetchJson<SearchResultResponse>(
      `${this.apiRoot}/intelligent/search/result?id=${searchId}&limit=${limit}`,
    );
  }

  async search(params: SearchRequest): Promise<SearchResultResponse> {
    const searchId = await this.intelligentSearch(params);
    const allRecords: SearchResultResponse["records"] = [];
    let remaining = params.maxresults || 100;
    let delay = POLL_INITIAL_MS;

    while (true) {
      await new Promise((r) => setTimeout(r, delay));
      const results = await this.getSearchResults(searchId, remaining);

      if (results.records?.length) {
        allRecords.push(...results.records);
        remaining -= results.records.length;
      }

      if (
        results.status === SEARCH_STATUS.NO_MORE_RESULTS ||
        results.status === SEARCH_STATUS.NOT_FOUND ||
        remaining <= 0
      ) {
        if (remaining <= 0) await this.terminateSearch(searchId);
        break;
      }

      delay = Math.min(delay * POLL_MULTIPLIER, POLL_MAX_MS);
    }

    return { status: 0, records: allRecords };
  }

  async phonebookSearch(params: PhonebookSearchRequest): Promise<string> {
    await this.limiter.wait();

    const targetMap: Record<string, number> = {
      domains: PHONEBOOK_TARGETS.DOMAINS,
      emails: PHONEBOOK_TARGETS.EMAILS,
      urls: PHONEBOOK_TARGETS.URLS,
    };

    const data = await this.fetchJson<SearchResponse>(
      `${this.apiRoot}/phonebook/search`,
      {
        method: "POST",
        body: JSON.stringify({
          term: params.term,
          buckets: params.buckets || [],
          lookuplevel: 0,
          maxresults: params.maxresults || 100,
          timeout: 5,
          datefrom: "",
          dateto: "",
          sort: 4,
          media: 0,
          terminate: [],
          target: (params.target && targetMap[params.target]) ?? PHONEBOOK_TARGETS.ALL,
        }),
      },
    );
    return data.id;
  }

  async getPhonebookResults(
    searchId: string,
    limit: number = 1000,
    offset: number = -1,
  ): Promise<PhonebookResultResponse> {
    await this.limiter.wait();
    return this.fetchJson<PhonebookResultResponse>(
      `${this.apiRoot}/phonebook/search/result?id=${searchId}&limit=${limit}&offset=${offset}`,
    );
  }

  async phonebookSearchComplete(params: PhonebookSearchRequest): Promise<PhonebookResultResponse[]> {
    const searchId = await this.phonebookSearch(params);
    const allResults: PhonebookResultResponse[] = [];
    let remaining = params.maxresults || 1000;
    let delay = POLL_INITIAL_MS;

    while (true) {
      await new Promise((r) => setTimeout(r, delay));
      const results = await this.getPhonebookResults(searchId, remaining);
      allResults.push(results);
      remaining -= results.selectors.length;

      if (
        results.status === SEARCH_STATUS.NO_MORE_RESULTS ||
        results.status === SEARCH_STATUS.NOT_FOUND ||
        remaining <= 0
      ) {
        if (remaining <= 0) await this.terminateSearch(searchId);
        break;
      }
      delay = Math.min(delay * POLL_MULTIPLIER, POLL_MAX_MS);
    }

    return allResults;
  }

  async terminateSearch(searchId: string): Promise<boolean> {
    await this.limiter.wait();
    const response = await fetch(
      `${this.apiRoot}/intelligent/search/terminate?id=${searchId}`,
      { headers: this.getHeaders() },
    );
    return response.ok;
  }

  async fileView(
    id: string,
    bucket: string,
    mediaType: number,
    contentType: number,
    idType: "storage" | "system" = "storage",
  ): Promise<string> {
    if (idType === "system") {
      return this.fileReadText(id, bucket);
    }
    await this.limiter.wait();

    const formatMap: Record<number, number> = {
      23: FILE_FORMATS.HTML_TEXT,
      9: FILE_FORMATS.HTML_TEXT,
      15: FILE_FORMATS.PDF_TEXT,
      16: FILE_FORMATS.WORD_TEXT,
      18: FILE_FORMATS.POWERPOINT_TEXT,
      25: FILE_FORMATS.EBOOK_TEXT,
      17: FILE_FORMATS.EXCEL_TEXT,
    };
    const format = formatMap[mediaType] ?? (contentType === 1 ? FILE_FORMATS.TEXT : FILE_FORMATS.HEX);

    return this.fetchText(
      `${this.apiRoot}/file/view?f=${format}&storageid=${id}&bucket=${bucket}&escape=0&k=${this.apiKey}`,
      undefined,
      MAX_FILE_VIEW_BYTES,
    );
  }

  async fileRead(systemId: string, bucket: string, type: number = 0): Promise<ArrayBuffer> {
    await this.limiter.wait();
    const response = await fetch(
      `${this.apiRoot}/file/read?type=${type}&systemid=${systemId}&bucket=${bucket}`,
      { headers: this.getHeaders() },
    );
    if (!response.ok) {
      throw new Error(`API ${response.status}: ${response.statusText}`);
    }
    const contentLength = response.headers.get("content-length");
    if (contentLength && parseInt(contentLength) > MAX_FILE_READ_BYTES) {
      throw new Error(`File too large (${contentLength} bytes, max ${MAX_FILE_READ_BYTES})`);
    }
    if (!response.body) return response.arrayBuffer();
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_FILE_READ_BYTES) {
        reader.cancel();
        throw new Error(`File exceeds max size (>${MAX_FILE_READ_BYTES} bytes)`);
      }
      chunks.push(value);
    }
    const result = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return result.buffer;
  }

  // Returns the raw fetch Response so the caller can stream the body
  // straight through without buffering the whole file in memory.
  async fileReadResponse(systemId: string, bucket: string, type: number = 0): Promise<Response> {
    await this.limiter.wait();
    const response = await fetch(
      `${this.apiRoot}/file/read?type=${type}&systemid=${systemId}&bucket=${bucket}`,
      { headers: this.getHeaders() },
    );
    if (!response.ok) {
      throw new Error(`API ${response.status}: ${response.statusText}`);
    }
    const contentLength = response.headers.get("content-length");
    if (contentLength && parseInt(contentLength) > MAX_FILE_DOWNLOAD_BYTES) {
      throw new Error(`File too large (${contentLength} bytes, max ${MAX_FILE_DOWNLOAD_BYTES})`);
    }
    return response;
  }

  async fileReadText(systemId: string, bucket: string): Promise<string> {
    const buf = await this.fileRead(systemId, bucket);
    return new TextDecoder("utf-8", { fatal: false }).decode(buf);
  }

  async fileTreeView(bucket: string, storageId?: string, systemId?: string): Promise<TreeViewItem[]> {
    await this.limiter.wait();
    let url = `${this.apiRoot}/file/view?f=${FILE_FORMATS.TREE_VIEW_JSON}&bucket=${bucket}`;
    if (storageId) url += `&storageid=${storageId}`;
    else if (systemId) url += `&systemid=${systemId}`;
    url += `&k=${this.apiKey}`;

    const text = await this.fetchText(url, { headers: this.getHeaders() });
    if (!text || text.includes("Could not generate")) {
      throw new Error("Could not generate tree view");
    }
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [];
  }

  async getSelectors(systemId: string): Promise<Selector[]> {
    await this.limiter.wait();
    const data = await this.fetchJson<{ selectors?: Selector[] }>(
      `${this.apiRoot}/item/selector/list/human?id=${systemId}&k=${this.apiKey}`,
    );
    return data.selectors || [];
  }

  async getCapabilities(): Promise<CapabilitiesResponse> {
    await this.limiter.wait();
    return this.fetchJson<CapabilitiesResponse>(`${this.apiRoot}/authenticate/info`);
  }
}
