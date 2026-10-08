import {
  McpServer,
  ResourceTemplate,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdir } from "node:fs/promises";
import { IntelXClient } from "./lib/intelx-client.js";
import { IdentityClient } from "./lib/identity-client.js";
import { mintFileToken, redeemFileToken, TOKEN_TTL_MS } from "./lib/file-tokens.js";
import express from "express";
import {
  intelligentSearchSchema,
  phonebookSearchSchema,
  terminateSearchSchema,
  fileViewSchema,
  fileReadSchema,
  fileTreeViewSchema,
  getSelectorsSchema,
  identitySearchSchema,
} from "./lib/validators.js";
import {
  getEntry,
  getOriginalUuid,
  normalizeIdentityRecords,
  normalizeIntelxId,
  normalizePhoneBookResponse,
  normalizeSearchRecordResponse,
  normalizeSelectors,
  normalizeTreeViewResponse,
} from "./lib/postprocess.js";
import {
  isStrongSelector,
  isDomainOrEmail,
  isDomainEmailOrUrl,
} from "./lib/constants.js";

const INTELX_API_KEY = process.env.INTELX_API_KEY;

if (!INTELX_API_KEY) {
  console.error("Error: INTELX_API_KEY environment variable is required");
  process.exit(1);
}

const intelxClient = new IntelXClient(INTELX_API_KEY);
const identityClient = new IdentityClient(INTELX_API_KEY);

const useStdio = process.argv.includes("--stdio") || !process.env.MCP_HTTP;
const port = parseInt(process.env.PORT || "3000");

const server = new McpServer({
  name: "intelx-server",
  version: "1.1.0",
});

// -- Helpers --

function errResponse(msg: string) {
  return { content: [{ type: "text" as const, text: msg }], isError: true };
}

function textResponse(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data) }] };
}

function resolveUuid(field: "storage_id" | "system_id" | "indexfile", id: number) {
  const uuid = getOriginalUuid(field, id);
  if (!uuid) return errResponse(`Error: Invalid ${field}: ${id}`);
  return uuid;
}

function sliceLines(text: string, offset: number, limit: number): { content: string; total_lines: number; offset: number; limit: number } {
  let total = 0;
  let startIdx = 0;
  let endIdx = -1;
  let lineNum = 0;
  let sliceStart = -1;
  let sliceEnd = -1;

  for (let i = 0; i <= text.length; i++) {
    if (i === text.length || text[i] === "\n") {
      if (lineNum === offset) sliceStart = startIdx;
      if (lineNum === offset + limit) {
        sliceEnd = startIdx - 1;
      }
      lineNum++;
      startIdx = i + 1;
    }
  }
  total = lineNum;

  if (sliceStart === -1) sliceStart = text.length;
  if (sliceEnd === -1) sliceEnd = text.length;

  return {
    content: text.slice(sliceStart, sliceEnd),
    total_lines: total,
    offset,
    limit,
  };
}

// -- Tools --

server.registerTool(
  "intelx_intelligent_search",
  {
    title: "Intelligence X Search",
    description: `Search Intelligence X data archive for STRONG SELECTORS ONLY.

SUPPORTED SELECTOR TYPES (exact format required):
- Email: user@domain.com
- Domain: example.com or *.example.com (wildcards supported)
- URL: https://example.com/path
- IPv4: 192.168.1.1
- IPv6: 2001:0db8:85a3::8a2e:0370:7334
- CIDR: 192.168.1.0/24 or 2001:db8::/32
- Phone: +1234567890
- Bitcoin Address: 1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa
- MAC Address: 00:1B:44:11:3A:B7
- IPFS Hash: QmXg9Pp2ytZ14xgmQjYEiHjVjMFXzCVVEcRTWJBmLgR39V
- UUID: 550e8400-e29b-41d4-a716-446655440000
- Storage ID: (from previous results)
- System ID: (from previous results)
- Simhash: (similarity hash)
- Credit Card: 4532-1234-5678-9010
- IBAN: DE89370400440532013000

IMPORTANT: Generic search terms are NOT supported. Use specific identifiers only.

PARAMETERS:
- term: The selector to search (REQUIRED)
- maxresults: Max results per bucket (default: 100)
- buckets: Array of bucket names (leave empty for all buckets)
  AVAILABLE BUCKETS: darknet, dns, documents.public, dumpster, leaks.logs,
  leaks.private, leaks.public, pastes, usenet, web.gov.ru, web.public, whois
  Example: "pastes,darknet,leaks.public"
- timeout: Search timeout in seconds (default: 5)
- datefrom/dateto: Date range "YYYY-MM-DD HH:MM:SS"
- sort: 0=none, 1=score_asc, 2=score_desc, 3=date_asc, 4=date_desc (default: 4)

NOTE: Invalid bucket names will cause a 401 error. Use empty array [] to search all buckets.`,
    inputSchema: {
      term: z.string(),
      maxresults: z.number().optional(),
      buckets: z.string().optional(),
      timeout: z.number().optional(),
      datefrom: z.string().optional(),
      dateto: z.string().optional(),
      sort: z.number().optional(),
    },
  },
  async (params) => {
    try {
      // @ts-ignore
      params.buckets = params.buckets?.split(",") || [];
      const validated = intelligentSearchSchema.parse(params);

      if (!isStrongSelector(validated.term)) {
        return errResponse(
          "Error: term should be a strong selector (email, domain, URL, IP address, phone, bitcoin address, etc.)",
        );
      }

      const results = await intelxClient
        .search(validated)
        .then(normalizeSearchRecordResponse)
        .then(normalizeIntelxId);

      return textResponse(results);
    } catch (error) {
      return errResponse(`Error: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  },
);

server.registerTool(
  "intelx_phonebook_search",
  {
    title: "Intelligence X Phonebook Search",
    description: `Search phonebook for selectors. Returns list of related selectors.

USE CASES:
- Find all email addresses associated with a domain
- Find all URLs containing a domain
- Discover related selectors

SEARCH TERM EXAMPLES:
- Domain: "example.com"
- Partial email: "@example.com" to find all emails in domain
- URL: "https://example.com"

PARAMETERS:
- term: Selector to search (domain, email, URL)
- target: Filter results by type
  * "all" - Return all selector types (default)
  * "domains" - Only domain results
  * "emails" - Only email addresses
  * "urls" - Only URL results
- maxresults: Max results to return (default: 100)
- buckets: Optional bucket filter (leave empty for all)
  Available: darknet, dns, documents.public, dumpster, leaks.logs, leaks.private,
  leaks.public, pastes, usenet, web.gov.ru, web.public, whois`,
    inputSchema: {
      term: z.string(),
      maxresults: z.number().optional(),
      buckets: z.string().optional(),
      target: z.enum(["all", "domains", "emails", "urls"]).optional(),
    },
  },
  async (params) => {
    try {
      // @ts-ignore
      params.buckets = params.buckets?.split(",") || [];
      const validated = phonebookSearchSchema.parse(params);

      if (!isDomainEmailOrUrl(validated.term)) {
        return errResponse("Error: term should be a strong selector (email, domain, URL)");
      }

      const results = await intelxClient
        .phonebookSearchComplete(validated)
        .then(normalizePhoneBookResponse);

      return { content: [{ type: "text" as const, text: results.join(" ") }] };
    } catch (error) {
      return errResponse(`Error: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  },
);

server.registerTool(
  "intelx_terminate_search",
  {
    title: "Terminate Search",
    description: "Terminate an ongoing Intelligence X search by ID",
    inputSchema: { search_id: z.string() },
  },
  async (params) => {
    try {
      const validated = terminateSearchSchema.parse(params);
      const success = await intelxClient.terminateSearch(validated.search_id);
      return {
        content: [
          { type: "text" as const, text: success ? "Search terminated successfully" : "Failed to terminate search" },
        ],
      };
    } catch (error) {
      return errResponse(`Error: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  },
);

server.registerTool(
  "intelx_file_view",
  {
    title: "File View",
    description: `View full file contents with automatic format conversion (PDF→text, Word→text, Excel→text, etc).

REQUIRED:
- bucket: The "bucket" field from the result
- ID: pass either storage_id or system_id from the previous result. The tool auto-detects which API endpoint to use, so just pass whichever ID the result has.

PARAMETERS:
- media, type: From the result (optional, defaults to 0/1)
- offset: Line offset to start reading from (default: 0)
- limit: Max number of lines to return (default: 200)

RETURNS: JSON with content (text), total_lines, offset, limit for pagination.`,
    inputSchema: {
      storage_id: z.number().optional(),
      system_id: z.number().optional(),
      bucket: z.string(),
      media: z.number().optional(),
      type: z.number().optional(),
      offset: z.number().optional(),
      limit: z.number().optional(),
    },
  },
  async (params) => {
    try {
      const validated = fileViewSchema.parse(params);

      const id = validated.storage_id ?? validated.system_id;
      if (!id) {
        return errResponse("Error: Either storage_id or system_id is required");
      }
      const entry = getEntry(id);
      if (!entry) {
        return errResponse(`Error: Invalid id: ${id}`);
      }
      const idType: "storage" | "system" = entry.field === "system_id" ? "system" : "storage";

      const fullText = await intelxClient.fileView(
        entry.uuid,
        validated.bucket,
        validated.media,
        validated.type,
        idType,
      );

      const result = sliceLines(fullText, validated.offset, validated.limit);
      return textResponse(result);
    } catch (error) {
      return errResponse(`Error: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  },
);

server.registerTool(
  "intelx_file_read",
  {
    title: "File Read",
    description: `Read raw file contents from Intelligence X (no format conversion).

Unlike intelx_file_view (which converts PDF/Word/Excel to text), this returns the
original file bytes exactly as stored.

REQUIRED:
- system_id: The "system_id" field from a search result
- bucket: The "bucket" field from the result

PARAMETERS:
- type: 0=original file (default), 1=preview
- encoding: "text" (default) - UTF-8 decoded with line-based pagination (offset/limit); max 50MB
            "url" - RECOMMENDED for binary or large files: returns a one-time download
                    URL (valid ${TOKEN_TTL_MS / 60000} min). Fetch it with curl/Bash, e.g.
                    curl -o file.zip "<url>"
                    Bytes never enter the LLM context; streamed server-side up to 500MB.
            "base64" - base64-encoded full content; max 512KB, small binaries only
                      (certificates, small images). Larger files: use "url".
- offset/limit: Line pagination (text encoding only)

RETURNS:
- text: JSON with content (text), total_lines, offset, limit for pagination
- url: JSON with url, expires_at — download once, then it is invalidated
- base64: JSON with content (base64), size (bytes)`,
    inputSchema: {
      system_id: z.number(),
      bucket: z.string(),
      type: z.number().optional(),
      encoding: z.enum(["text", "base64", "url"]).optional(),
      offset: z.number().optional(),
      limit: z.number().optional(),
    },
  },
  async (params) => {
    try {
      const validated = fileReadSchema.parse(params);
      const resolved = resolveUuid("system_id", validated.system_id);
      if (typeof resolved !== "string") return resolved;

      if (validated.encoding === "url" && !useStdio) {
        const { token, expiresAt } = mintFileToken(resolved, validated.bucket, validated.type);
        const base = (process.env.MCP_PUBLIC_URL || `http://localhost:${port}`).replace(/\/+$/, "");
        return textResponse({
          encoding: "url",
          url: `${base}/files/${token}`,
          expires_at: new Date(expiresAt).toISOString(),
          note: "One-time download link. Fetch with curl/Bash; it is invalidated after first use.",
        });
      }

      const data = await intelxClient.fileRead(resolved, validated.bucket, validated.type);

      if (validated.encoding === "url") {
        // stdio mode: no HTTP listener, so spool to local disk instead
        const spoolDir = join(tmpdir(), "intelx-mcp");
        await mkdir(spoolDir, { recursive: true });
        const name = `${resolved}_${validated.bucket}_${Date.now()}`.replace(/[^a-zA-Z0-9._-]/g, "_");
        const path = join(spoolDir, name);
        await Bun.write(path, data);
        return textResponse({ encoding: "file", path, size: data.byteLength });
      }

      if (validated.encoding === "base64") {
        const MAX_BASE64_BYTES = 512 * 1024;
        if (data.byteLength > MAX_BASE64_BYTES) {
          return errResponse(
            `Error: file too large for base64 (${data.byteLength} bytes, max ${MAX_BASE64_BYTES}). Use encoding "url" to get a download link instead.`,
          );
        }
        return textResponse({
          encoding: "base64",
          size: data.byteLength,
          content: Buffer.from(data).toString("base64"),
        });
      }

      const fullText = new TextDecoder("utf-8", { fatal: false }).decode(data);
      return textResponse(sliceLines(fullText, validated.offset, validated.limit));
    } catch (error) {
      return errResponse(`Error: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  },
);

server.registerTool(
  "intelx_file_treeview",
  {
    title: "File Tree View",
    description: `Get hierarchical tree of related files.

USE CASES:
- Stealer logs: Browse files in ZIP/RAR containers
- Archive sites: View historical copies of websites
- Large files: Access multi-part file segments
- Container files: Explore contents of archives

REQUIRED:
- bucket: The "bucket" field from search result
- indexfile: Use the "indexfile" field from search results (preferred for archives/containers)
- OR storage_id / system_id: Use "storage_id"/"system_id" for direct lookups

RETURNS: JSON array of related items with metadata (name, date, size, media type)

WORKFLOW:
1. Get search results
2. Check if result has "indexfile" or "historyfile" field
3. Use that as storage_id to get tree view
4. Browse related files in the tree`,
    inputSchema: {
      bucket: z.string(),
      storage_id: z.number().optional(),
      system_id: z.number().optional(),
      indexfile: z.number().optional(),
    },
  },
  async (params) => {
    try {
      const validated = fileTreeViewSchema.parse(params);

      let originalStorageId: string | undefined;
      if (validated.indexfile) {
        const resolved = resolveUuid("indexfile", validated.indexfile);
        if (typeof resolved !== "string") return resolved;
        originalStorageId = resolved;
      } else if (validated.storage_id) {
        const resolved = resolveUuid("storage_id", validated.storage_id);
        if (typeof resolved !== "string") return resolved;
        originalStorageId = resolved;
      }

      let originalSystemId: string | undefined;
      if (validated.system_id) {
        const resolved = resolveUuid("system_id", validated.system_id);
        if (typeof resolved !== "string") return resolved;
        originalSystemId = resolved;
      }

      const tree = await intelxClient
        .fileTreeView(validated.bucket, originalStorageId, originalSystemId)
        .then((items) => normalizeTreeViewResponse(items, validated.bucket))
        .then(normalizeIntelxId);

      return textResponse(tree);
    } catch (error) {
      return errResponse(`Error: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  },
);

server.registerTool(
  "intelx_get_selectors",
  {
    title: "Extract Selectors",
    description: `Extract all selectors found in a document.

EXTRACTS:
- Email addresses
- IP addresses
- Domains
- URLs
- Bitcoin addresses
- Phone numbers
- And more...

REQUIRED:
- system_id: The "system_id" field from search result

RETURNS: Array of each selector found

USE CASE: Discover related identifiers in a document to search for additional context`,
    inputSchema: { system_id: z.number() },
  },
  async (params) => {
    try {
      const validated = getSelectorsSchema.parse(params);
      const resolved = resolveUuid("system_id", validated.system_id);
      if (typeof resolved !== "string") return resolved;

      const selectors = await intelxClient.getSelectors(resolved).then(normalizeSelectors);

      return { content: [{ type: "text" as const, text: selectors.join(" ") }] };
    } catch (error) {
      return errResponse(`Error: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  },
);

server.registerTool(
  "intelx_get_capabilities",
  {
    title: "Get Account Capabilities",
    description: "Get current API account capabilities and permissions",
    inputSchema: {},
  },
  async () => {
    try {
      const capabilities = await intelxClient.getCapabilities().then(normalizeIntelxId);
      return textResponse(capabilities);
    } catch (error) {
      return errResponse(`Error: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  },
);

server.registerTool(
  "intelx_identity_search",
  {
    title: "Identity Search",
    description: `Search the IntelX Identity Portal (a specialized breach and identity intelligence database) for compromised data using domain-level wildcard search (recommended for efficiency). This tool leverages IntelX's advanced reverse lookup capabilities to identify leaked credentials, accounts, and other sensitive information associated with the specified domain and its subdomains.

SEARCH TERMS:
- Domain: set.or.th

PARAMETERS:
- selector: Domain to search (REQUIRED; supports wildcard for subdomains, e.g., "set.or.th" automatically includes *.set.or.th)
- maxresults: Max results (default: 100, increase to 500+ for full domain scans)
- buckets: Optional bucket filter (comma-separated; e.g., "leaks.private.general,leaks.public.general" for breach-focused results)
- datefrom/dateto: Date range "YYYY-MM-DD HH:MM:SS" (filters results by leak date)
- analyze: Include breach analysis (default: false; provides summary insights on leak sources and severity)
- skip_invalid: Skip invalid results (default: false; filters out malformed or irrelevant entries)

RETURNS: Array of breach records, each containing:
- system_id: Unique identifier for the leak source
- storage_id: Internal storage reference
- filename: Name of the leaked file or log
- line data: List of all lines where the search term (domain or related selectors) appears in the results, including highlighted matches for emails, passwords, usernames, or other compromised data

USE CASE: Efficiently find data breaches, leaked credentials, and compromised accounts across an entire organization (e.g., all subdomains of set.or.th) with minimal API calls. Ideal for security teams monitoring for exposed PII or authentication details in stealer logs, paste sites, and dark web leaks.

NOTE: Each line will limited to 64 characters. If you have interest in these file use intelx_file_view tool`,
    inputSchema: {
      selector: z.string(),
      maxresults: z.number().optional(),
      buckets: z.string().optional(),
      datefrom: z.string().optional(),
      dateto: z.string().optional(),
      analyze: z.boolean().optional(),
      skip_invalid: z.boolean().optional(),
      terminate: z.array(z.string()).optional(),
    },
  },
  async (params) => {
    try {
      const validated = identitySearchSchema.parse(params);

      if (!isDomainOrEmail(validated.selector)) {
        return errResponse("Error: selector should be a domain or email address");
      }

      const results = await identityClient
        .search(validated)
        .then(normalizeIdentityRecords)
        .then(normalizeIntelxId);

      return textResponse(results);
    } catch (error) {
      return errResponse(`Error: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  },
);

// -- Resources --

server.registerResource(
  "search",
  new ResourceTemplate("intelx://search/{searchId}", { list: undefined }),
  {
    title: "Search Results",
    description: "Access Intelligence X search results by ID",
  },
  async (uri, { searchId }) => {
    try {
      const results = await intelxClient
        .getSearchResults(searchId as string, 100)
        .then(normalizeIntelxId);
      return {
        contents: [{ uri: uri.href, text: JSON.stringify(results), mimeType: "application/json" }],
      };
    } catch (error) {
      return {
        contents: [
          { uri: uri.href, text: `Error: ${error instanceof Error ? error.message : "Unknown error"}`, mimeType: "text/plain" },
        ],
        isError: true,
      };
    }
  },
);

server.registerResource(
  "file",
  new ResourceTemplate("intelx://file/{systemId}/{bucket}", { list: undefined }),
  {
    title: "File Content",
    description: "Access file contents from Intelligence X",
  },
  async (uri, { systemId, bucket }) => {
    try {
      if (!systemId || !bucket) {
        return {
          contents: [{ uri: uri.href, text: "Error: Missing required parameters", mimeType: "text/plain" }],
          isError: true,
        };
      }
      const data = await intelxClient.fileRead(
        getOriginalUuid("system_id", +systemId) as string,
        bucket as string,
      );
      return {
        contents: [{ uri: uri.href, blob: Buffer.from(data).toString("base64"), mimeType: "application/octet-stream" }],
      };
    } catch (error) {
      return {
        contents: [
          { uri: uri.href, text: `Error: ${error instanceof Error ? error.message : "Unknown error"}`, mimeType: "text/plain" },
        ],
        isError: true,
      };
    }
  },
);

server.registerResource(
  "tree",
  new ResourceTemplate("intelx://tree/{storageId}/{bucket}", { list: undefined }),
  {
    title: "File Tree",
    description: "Access file tree view from Intelligence X",
  },
  async (uri, { storageId, bucket }) => {
    try {
      if (!storageId || !bucket) {
        return {
          contents: [{ uri: uri.href, text: "Error: Missing required parameters", mimeType: "text/plain" }],
          isError: true,
        };
      }
      const tree = await intelxClient
        .fileTreeView(bucket as string, getOriginalUuid("storage_id", +storageId) as string)
        .then(normalizeIntelxId);
      return {
        contents: [{ uri: uri.href, text: JSON.stringify(tree), mimeType: "application/json" }],
      };
    } catch (error) {
      return {
        contents: [
          { uri: uri.href, text: `Error: ${error instanceof Error ? error.message : "Unknown error"}`, mimeType: "text/plain" },
        ],
        isError: true,
      };
    }
  },
);

// -- Transport --

if (useStdio) {
  const transport = new StdioServerTransport();
  await server.connect(transport);
} else {
  const app = express();
  app.use(express.json());

  app.post("/mcp", async (req, res) => {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on("close", () => transport.close());
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });

  // One-time, TTL'd download endpoint for large/binary files.
  // The tool returns the URL; bytes stream directly from IntelX to the
  // client without passing through the LLM context.
  app.get("/files/:token", async (req, res) => {
    const entry = redeemFileToken(req.params.token);
    if (!entry) {
      res.status(404).json({ error: "invalid or expired token" });
      return;
    }
    try {
      const upstream = await intelxClient.fileReadResponse(entry.systemId, entry.bucket, entry.type);
      const contentLength = upstream.headers.get("content-length");
      if (contentLength) res.setHeader("Content-Length", contentLength);
      res.setHeader("Content-Type", "application/octet-stream");
      if (!upstream.body) {
        res.end();
        return;
      }
      const reader = upstream.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!res.write(Buffer.from(value))) {
          await new Promise<void>((r) => res.once("drain", () => r()));
        }
      }
      res.end();
    } catch (error) {
      if (!res.headersSent) {
        res.status(502).json({ error: error instanceof Error ? error.message : "upstream error" });
      } else {
        res.end();
      }
    }
  });

  app
    .listen(port, () => {
      console.error(`IntelX MCP Server running on http://localhost:${port}/mcp`);
    })
    .on("error", (error) => {
      console.error("Server error:", error);
      process.exit(1);
    });
}
