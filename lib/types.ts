export interface SearchRequest {
  term: string;
  buckets?: string[];
  lookuplevel?: number;
  maxresults?: number;
  timeout?: number;
  datefrom?: string;
  dateto?: string;
  sort?: number;
  media?: number;
  terminate?: string[];
}

export interface PhonebookSearchRequest {
  term: string;
  buckets?: string[];
  maxresults?: number;
  target?: "all" | "domains" | "emails" | "urls";
}

export interface SearchResponse {
  id: string;
  status: number;
}

export interface SearchRecordNormalized {
  system_id: string;
  bucket: string;
  name: string;
  indexfile?: string;
  storage_id: string;
  media: number;
  type: number;
  added: string;
  date: string;
}

export interface SearchRecord {
  systemid: string;
  name: string;
  bucket: string;
  added: string;
  date: string;
  media: number;
  type: number;
  storageid: string;
  indexfile?: string;
  [key: string]: unknown;
}

export interface SearchResultResponse {
  status: number;
  records: SearchRecord[];
}

export interface PhonebookSelector {
  selectorvalue: string;
  [key: string]: unknown;
}

export interface PhonebookResultResponse {
  status: number;
  selectors: PhonebookSelector[];
}

export interface TreeViewItem {
  systemid: string;
  storageid?: string;
  name: string;
  date: string;
  media: number;
  type: number;
  size: number;
  bucket?: string;
  [key: string]: unknown;
}

export interface Selector {
  selector: string;
  [key: string]: unknown;
}

export interface CapabilitiesResponse {
  [key: string]: unknown;
}

export interface IdentitySearchRequest {
  selector: string;
  bucket?: string;
  skipinvalid?: boolean;
  limit?: number;
  analyze?: boolean;
  datefrom?: string;
  dateto?: string;
  terminate?: string[];
}

export interface IdentityRecord {
  item: {
    name: string;
    date: string;
    bucket: string;
    storageid: string;
    systemid: string;
    [key: string]: unknown;
  };
  linea: string;
}

export interface IdentityNormalizedRecord {
  line: string;
  system_id: string;
  storage_id: string;
  bucket: string;
  filename: string;
  date: string;
}

export interface IdentitySearchResponse {
  id: string;
  status: number;
  records?: IdentityRecord[];
}
