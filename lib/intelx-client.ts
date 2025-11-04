import type {
  SearchRequest,
  PhonebookSearchRequest,
  SearchResponse,
  SearchResultResponse,
  PhonebookResultResponse,
  TreeViewItem,
  Selector,
  CapabilitiesResponse
} from './types.js';
import { API_ROOTS, API_RATE_LIMIT_MS, FILE_FORMATS, SEARCH_STATUS, PHONEBOOK_TARGETS } from './constants.js';

export class IntelXClient {
  private apiKey: string;
  private apiRoot: string;
  private userAgent: string;
  private lastRequestTime: number = 0;

  constructor(apiKey: string, userAgent: string = 'IntelX-MCP/1.0') {
    this.apiKey = apiKey;
    this.apiRoot = API_ROOTS.MAIN;
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
      'User-Agent': this.userAgent,
      'Content-Type': 'application/json'
    };
  }

  async intelligentSearch(params: SearchRequest): Promise<string> {
    await this.rateLimit();
    
    const payload = {
      term: params.term,
      buckets: params.buckets || [],
      lookuplevel: 0,
      maxresults: params.maxresults || 100,
      timeout: params.timeout || 5,
      datefrom: params.datefrom || '',
      dateto: params.dateto || '',
      sort: params.sort ?? 4,
      media: params.media ?? 0,
      terminate: params.terminate || []
    };

    const response = await fetch(`${this.apiRoot}/intelligent/search`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errorBody = await response.text();
      const errorMsg = errorBody || 'Invalid request (possibly invalid bucket names)';
      throw new Error(`API error ${response.status}: ${response.statusText} - ${errorMsg}`);
    }

    const data = (await response.json()) as SearchResponse;
    
    if (data.status === 1) {
      throw new Error('Invalid search term');
    }
    
    return data.id;
  }

  async getSearchResults(searchId: string, limit: number = 100): Promise<SearchResultResponse> {
    await this.rateLimit();

    const response = await fetch(
      `${this.apiRoot}/intelligent/search/result?id=${searchId}&limit=${limit}`,
      { headers: this.getHeaders() }
    );

    if (!response.ok) {
      const errorBody = await response.text();
      const errorMsg = errorBody || 'Invalid request';
      throw new Error(`API error ${response.status}: ${response.statusText} - ${errorMsg}`);
    }

    return (await response.json()) as SearchResultResponse;
  }

  async search(params: SearchRequest): Promise<SearchResultResponse> {
    const searchId = await this.intelligentSearch(params);
    const allRecords = [];
    let maxresults = params.maxresults || 100;

    while (true) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      const results = await this.getSearchResults(searchId, maxresults);
      
      if (results.records && Array.isArray(results.records)) {
        allRecords.push(...results.records);
        maxresults -= results.records.length;
      }

      if (results.status === SEARCH_STATUS.SUCCESS && (!results.records || results.records.length === 0)) {
        continue;
      }

      if (
        results.status === SEARCH_STATUS.NO_MORE_RESULTS ||
        results.status === SEARCH_STATUS.NOT_FOUND ||
        maxresults <= 0
      ) {
        if (maxresults <= 0) {
          await this.terminateSearch(searchId);
        }
        break;
      }
    }

    return { status: 0, records: allRecords };
  }

  async phonebookSearch(params: PhonebookSearchRequest): Promise<string> {
    await this.rateLimit();

    let targetValue: number = PHONEBOOK_TARGETS.ALL;
    if (params.target === 'domains') targetValue = PHONEBOOK_TARGETS.DOMAINS;
    if (params.target === 'emails') targetValue = PHONEBOOK_TARGETS.EMAILS;
    if (params.target === 'urls') targetValue = PHONEBOOK_TARGETS.URLS;

    const payload = {
      term: params.term,
      buckets: params.buckets || [],
      lookuplevel: 0,
      maxresults: params.maxresults || 100,
      timeout: params.timeout || 5,
      datefrom: params.datefrom || '',
      dateto: params.dateto || '',
      sort: params.sort ?? 4,
      media: params.media ?? 0,
      terminate: params.terminate || [],
      target: targetValue
    };

    const response = await fetch(`${this.apiRoot}/phonebook/search`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      throw new Error(`API error ${response.status}: ${response.statusText}`);
    }

    const data = (await response.json()) as SearchResponse;
    return data.id;
  }

  async getPhonebookResults(searchId: string, limit: number = 1000, offset: number = -1): Promise<PhonebookResultResponse> {
    await this.rateLimit();

    const response = await fetch(
      `${this.apiRoot}/phonebook/search/result?id=${searchId}&limit=${limit}&offset=${offset}`,
      { headers: this.getHeaders() }
    );

    if (!response.ok) {
      throw new Error(`API error ${response.status}: ${response.statusText}`);
    }

    return (await response.json()) as PhonebookResultResponse;
  }

  async phonebookSearchComplete(params: PhonebookSearchRequest): Promise<PhonebookResultResponse[]> {
    const searchId = await this.phonebookSearch(params);
    const allResults: PhonebookResultResponse[] = [];
    let maxresults = params.maxresults || 1000;

    while (true) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      const results = await this.getPhonebookResults(searchId, maxresults);
      allResults.push(results);
      maxresults -= results.selectors.length;

      if (
        results.status === SEARCH_STATUS.NO_MORE_RESULTS ||
        results.status === SEARCH_STATUS.NOT_FOUND ||
        maxresults <= 0
      ) {
        if (maxresults <= 0) {
          await this.terminateSearch(searchId);
        }
        break;
      }
    }

    return allResults;
  }

  async terminateSearch(searchId: string): Promise<boolean> {
    await this.rateLimit();

    const response = await fetch(
      `${this.apiRoot}/intelligent/search/terminate?id=${searchId}`,
      { headers: this.getHeaders() }
    );

    return response.ok;
  }

  async filePreview(
    storageId: string,
    bucket: string,
    mediaType: number,
    contentType: number,
    lines: number = 8,
    format: number = 0
  ): Promise<string> {
    await this.rateLimit();

    const response = await fetch(
      `${this.apiRoot}/file/preview?c=${contentType}&m=${mediaType}&f=${format}&sid=${storageId}&b=${bucket}&e=0&l=${lines}&k=${this.apiKey}`
    );

    if (!response.ok) {
      throw new Error(`API error ${response.status}: ${response.statusText}`);
    }

    return await response.text();
  }

  async fileView(
    storageId: string,
    bucket: string,
    mediaType: number,
    contentType: number
  ): Promise<string> {
    await this.rateLimit();

    let format: number = FILE_FORMATS.TEXT;
    if (mediaType === 23 || mediaType === 9) format = FILE_FORMATS.HTML_TEXT as number;
    else if (mediaType === 15) format = FILE_FORMATS.PDF_TEXT as number;
    else if (mediaType === 16) format = FILE_FORMATS.WORD_TEXT as number;
    else if (mediaType === 18) format = FILE_FORMATS.POWERPOINT_TEXT as number;
    else if (mediaType === 25) format = FILE_FORMATS.EBOOK_TEXT as number;
    else if (mediaType === 17) format = FILE_FORMATS.EXCEL_TEXT as number;
    else if (contentType === 1) format = FILE_FORMATS.TEXT as number;
    else format = FILE_FORMATS.HEX as number;

    const response = await fetch(
      `${this.apiRoot}/file/view?f=${format}&storageid=${storageId}&bucket=${bucket}&escape=0&k=${this.apiKey}`
    );

    if (!response.ok) {
      throw new Error(`API error ${response.status}: ${response.statusText}`);
    }

    return await response.text();
  }

  async fileRead(systemId: string, bucket: string): Promise<ArrayBuffer> {
    await this.rateLimit();

    const response = await fetch(
      `${this.apiRoot}/file/read?type=0&systemid=${systemId}&bucket=${bucket}`,
      { headers: this.getHeaders() }
    );

    if (!response.ok) {
      throw new Error(`API error ${response.status}: ${response.statusText}`);
    }

    return await response.arrayBuffer();
  }

  async fileTreeView(bucket: string, storageId?: string, systemId?: string): Promise<TreeViewItem[]> {
    await this.rateLimit();

    let url = `${this.apiRoot}/file/view?f=${FILE_FORMATS.TREE_VIEW_JSON}&bucket=${bucket}`;
    if (storageId) {
      url += `&storageid=${storageId}`;
    } else if (systemId) {
      url += `&systemid=${systemId}`;
    }
    url += `&k=${this.apiKey}`;

    const response = await fetch(url, { headers: this.getHeaders() });

    if (!response.ok) {
      const errorBody = await response.text();
      const errorMsg = errorBody || 'Invalid request';
      throw new Error(`API error ${response.status}: ${response.statusText} - ${errorMsg}`);
    }

    const text = await response.text();
    if (text.includes('Could not generate')) {
      throw new Error('Could not generate tree view');
    }

    return JSON.parse(text);
  }

  async getSelectors(systemId: string): Promise<Selector[]> {
    await this.rateLimit();

    const response = await fetch(
      `${this.apiRoot}/item/selector/list/human?id=${systemId}&k=${this.apiKey}`
    );

    if (!response.ok) {
      throw new Error(`API error ${response.status}: ${response.statusText}`);
    }

    const data = (await response.json()) as { selectors?: Selector[] };
    return data.selectors || [];
  }

  async getCapabilities(): Promise<CapabilitiesResponse> {
    await this.rateLimit();

    const response = await fetch(
      `${this.apiRoot}/authenticate/info`,
      { headers: this.getHeaders() }
    );

    if (!response.ok) {
      throw new Error(`API error ${response.status}: ${response.statusText}`);
    }

    return (await response.json()) as CapabilitiesResponse;
  }

  searchStats(records: Array<{ bucket?: string }>): Record<string, number> {
    const stats: Record<string, number> = {};
    for (const record of records) {
      const bucket = record.bucket || 'unknown';
      stats[bucket] = (stats[bucket] || 0) + 1;
    }
    return stats;
  }
}

