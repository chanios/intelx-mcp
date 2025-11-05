import {
  McpServer,
  ResourceTemplate,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { IntelXClient } from "./lib/intelx-client.js";
import { IdentityClient } from "./lib/identity-client.js";
import express from "express";
import {
  intelligentSearchSchema,
  phonebookSearchSchema,
  terminateSearchSchema,
  filePreviewSchema,
  fileViewSchema,
  fileReadSchema,
  fileTreeViewSchema,
  getSelectorsSchema,
  identitySearchSchema,
  exportAccountsSchema,
} from "./lib/validators.js";
import {
  getOriginalUuid,
  normalizeIdentityRecords,
  normalizeIntelxId,
  denormalizeIntelxId,
  getNormalizedId,
  normalizePhoneBookResponse,
  normalizeSearchRecordResponse,
} from "./lib/postprocess.js";

const INTELX_API_KEY = process.env.INTELX_API_KEY;

if (!INTELX_API_KEY) {
  console.error("Error: INTELX_API_KEY environment variable is required");
  console.error(
    "Available env vars:",
    Object.keys(process.env).filter((k) => k.includes("INTELX")),
  );
  process.exit(1);
}

console.error(
  `[IntelX MCP] Using API key: ${INTELX_API_KEY.substring(0, 8)}...${INTELX_API_KEY.substring(INTELX_API_KEY.length - 4)}`,
);

const intelxClient = new IntelXClient(INTELX_API_KEY);
const identityClient = new IdentityClient(INTELX_API_KEY);

const server = new McpServer({
  name: "intelx-server",
  version: "1.0.0",
});

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
  Example: ["pastes", "darknet", "leaks.public"]
- timeout: Search timeout in seconds (default: 5)
- datefrom/dateto: Date range "YYYY-MM-DD HH:MM:SS"
- sort: 0=none, 1=score_asc, 2=score_desc, 3=date_asc, 4=date_desc (default: 4)
- media: Filter by media type 0-25 (0=all, 1=paste, 15=PDF, 16=Word, etc.)

NOTE: Invalid bucket names will cause a 401 error. Use empty array [] to search all buckets.`,
    inputSchema: {
      term: z.string(),
      maxresults: z.number().optional(),
      buckets: z.array(z.string()).optional(),
      timeout: z.number().optional(),
      datefrom: z.string().optional(),
      dateto: z.string().optional(),
      sort: z.number().optional(),
      media: z.number().optional(),
      terminate: z.array(z.string()).optional(),
    },
  },
  async (params) => {
    const validated = intelligentSearchSchema.parse(params);
    const results = await intelxClient
      .search(validated)
      .then(normalizeSearchRecordResponse)
      .then(normalizeIntelxId);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(results, null, 2),
        },
      ],
      structuredContent: { results } as Record<string, unknown>,
    };
  },
);

server.registerTool(
  "intelx_phonebook_search",
  {
    title: "Intelligence X Phonebook Search",
    description: `Search phonebook for selectors. Returns list of related selectors.

USE CASES:
- Find all email addresses associated with a domain
- Find all domains associated with an email
- Find all URLs containing a domain
- Discover related selectors

SEARCH TERM EXAMPLES:
- Domain: "example.com" or "*.example.com"
- Email: "user@example.com"
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
  leaks.public, pastes, usenet, web.gov.ru, web.public, whois
- timeout: Search timeout in seconds (default: 5)`,
    inputSchema: {
      term: z.string(),
      maxresults: z.number().optional(),
      buckets: z.array(z.string()).optional(),
      timeout: z.number().optional(),
      target: z.enum(["all", "domains", "emails", "urls"]).optional(),
    },
  },
  async (params) => {
    const validated = phonebookSearchSchema.parse(params);

    const results = await intelxClient
      .phonebookSearchComplete(validated)
      .then(normalizePhoneBookResponse);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(results, null, 2),
        },
      ],
      structuredContent: { results } as Record<string, unknown>,
    };
  },
);

server.registerTool(
  "intelx_terminate_search",
  {
    title: "Terminate Search",
    description: "Terminate an ongoing Intelligence X search by ID",
    inputSchema: {
      search_id: z.string(),
    },
  },
  async (params) => {
    const validated = terminateSearchSchema.parse(params);
    const success = await intelxClient.terminateSearch(validated.search_id);

    return {
      content: [
        {
          type: "text",
          text: success
            ? "Search terminated successfully"
            : "Failed to terminate search",
        },
      ],
      structuredContent: { success },
    };
  },
);

server.registerTool(
  "intelx_file_preview",
  {
    title: "File Preview",
    description: `Preview first N lines of a file from Intelligence X search results.

REQUIRED FROM SEARCH RESULTS:
- storage_id: The "storageid" field from search result
- bucket: The "bucket" field from search result
- media_type: The "media" field from search result
- content_type: The "type" field from search result

PARAMETERS:
- lines: Number of lines to preview (default: 8)
- format: "text" or "picture" (default: "text")

USE CASE: Quick preview of file contents before full download`,
    inputSchema: {
      storage_id: z.string(),
      bucket: z.string(),
      media_type: z.number(),
      content_type: z.number(),
      lines: z.number().optional(),
      format: z.enum(["text", "picture"]).optional(),
    },
  },
  async (params) => {
    const validated = filePreviewSchema.parse(params);
    const formatValue = validated.format === "picture" ? 1 : 0;

    const originalStorageId = getOriginalUuid(
      "storageid",
      +validated.storage_id,
    );
    if (!originalStorageId) {
      throw new Error(`Invalid storage_id: ${validated.storage_id}`);
    }

    const preview = await intelxClient
      .filePreview(
        originalStorageId,
        validated.bucket,
        validated.media_type,
        validated.content_type,
        validated.lines,
        formatValue,
      )
      .then(normalizeIntelxId);

    return {
      content: [{ type: "text", text: JSON.stringify(preview, null, 2) }],
    };
  },
);

server.registerTool(
  "intelx_file_view",
  {
    title: "File View",
    description: `View full file contents with automatic format conversion.

AUTOMATIC CONVERSIONS:
- PDF (media=15) → Plain text
- Word (media=16) → Plain text
- Excel (media=17) → Plain text
- PowerPoint (media=18) → Plain text
- HTML (media=9,23) → Plain text
- Ebook (media=25) → Plain text

REQUIRED FROM SEARCH RESULTS:
- storage_id: The "storageid" field
- bucket: The "bucket" field
- media_type: The "media" field
- content_type: The "type" field

USE CASE: Read full document content in human-readable format`,
    inputSchema: {
      storage_id: z.string(),
      bucket: z.string(),
      media_type: z.number(),
      content_type: z.number(),
    },
  },
  async (params) => {
    const validated = fileViewSchema.parse(params);

    const originalStorageId = getOriginalUuid(
      "storageid",
      +validated.storage_id,
    );
    if (!originalStorageId) {
      throw new Error(`Invalid storage_id: ${validated.storage_id}`);
    }

    const content = await intelxClient
      .fileView(
        originalStorageId,
        validated.bucket,
        validated.media_type,
        validated.content_type,
      )
      .then(normalizeIntelxId);

    return {
      content: [{ type: "text", text: JSON.stringify(content, null, 2) }],
    };
  },
);

server.registerTool(
  "intelx_file_read",
  {
    title: "File Read",
    description: `Download raw binary file contents from Intelligence X.

REQUIRED FROM SEARCH RESULTS:
- system_id: The "systemid" field from search result
- bucket: The "bucket" field from search result

RETURNS: Base64 encoded binary data

USE CASE: Download original file (images, PDFs, executables, etc.) without conversion`,
    inputSchema: {
      system_id: z.string(),
      bucket: z.string(),
      filename: z.string().optional(),
    },
  },
  async (params) => {
    const validated = fileReadSchema.parse(params);

    const originalSystemId = getOriginalUuid("systemid", +validated.system_id);
    if (!originalSystemId) {
      throw new Error(`Invalid system_id: ${validated.system_id}`);
    }

    const data = await intelxClient
      .fileRead(originalSystemId, validated.bucket)
      .then(normalizeIntelxId);

    const buffer = Buffer.from(data);
    const base64 = buffer.toString("base64");

    return {
      content: [
        {
          type: "text",
          text: `File downloaded (${buffer.length} bytes). Base64: ${base64.substring(0, 100)}...`,
        },
      ],
      structuredContent: {
        size: buffer.length,
        base64: base64,
      },
    };
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
- storage_id OR system_id: Use "indexfile" or "historyfile" field for archives, or "storageid"/"systemid" for containers

RETURNS: JSON array of related items with metadata (name, date, size, media type)

WORKFLOW:
1. Get search results
2. Check if result has "indexfile" or "historyfile" field
3. Use that as storage_id to get tree view
4. Browse related files in the tree`,
    inputSchema: {
      bucket: z.string(),
      storage_id: z.string().optional(),
      system_id: z.string().optional(),
    },
  },
  async (params) => {
    const validated = fileTreeViewSchema.parse(params);

    let originalStorageId: string | undefined;
    if (validated.storage_id) {
      originalStorageId = getOriginalUuid("storageid", +validated.storage_id);
      if (!originalStorageId) {
        throw new Error(`Invalid storage_id: ${validated.storage_id}`);
      }
    }

    let originalSystemId: string | undefined;
    if (validated.system_id) {
      originalSystemId = getOriginalUuid("systemid", +validated.system_id);
      if (!originalSystemId) {
        throw new Error(`Invalid system_id: ${validated.system_id}`);
      }
    }

    const tree = await intelxClient
      .fileTreeView(validated.bucket, originalStorageId, originalSystemId)
      .then(normalizeIntelxId);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(tree, null, 2),
        },
      ],
      structuredContent: { tree } as Record<string, unknown>,
    };
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
- system_id: The "systemid" field from search result

RETURNS: Array of {type, value} objects for each selector found

USE CASE: Discover related identifiers in a document to search for additional context`,
    inputSchema: {
      system_id: z.string(),
    },
  },
  async (params) => {
    const validated = getSelectorsSchema.parse(params);

    const originalSystemId = getOriginalUuid("systemid", +validated.system_id);
    if (!originalSystemId) {
      throw new Error(`Invalid system_id: ${validated.system_id}`);
    }

    const selectors = await intelxClient
      .getSelectors(originalSystemId)
      .then(normalizeIntelxId);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(selectors, null, 2),
        },
      ],
      structuredContent: { selectors } as Record<string, unknown>,
    };
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
    const capabilities = await intelxClient
      .getCapabilities()
      .then(normalizeIntelxId);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(capabilities, null, 2),
        },
      ],
      structuredContent: capabilities,
    };
  },
);

server.registerTool(
  "intelx_identity_search",
  {
    title: "Identity Search",
    description: `Search identity/breach database for compromised data.

SEARCH TERMS:
- Email: user@example.com
- Domain: example.com (finds all emails in domain)
- Partial: @example.com (all emails in domain)

PARAMETERS:
- selector: Email or domain to search (REQUIRED)
- maxresults: Max results (default: 100)
- buckets: Optional bucket filter (comma-separated)
- datefrom/dateto: Date range "YYYY-MM-DD HH:MM:SS"
- analyze: Include breach analysis (default: false)
- skip_invalid: Skip invalid results (default: false)

RETURNS: Array of breach records with systemid, storageid, filename, and line data

USE CASE: Find data breaches, leaked credentials, compromised accounts`,
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
    const validated = identitySearchSchema.parse(params);
    const results = await identityClient
      .search(validated)
      .then(normalizeIdentityRecords)
      .then(normalizeIntelxId);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(results, null, 2),
        },
      ],
      structuredContent: { results } as Record<string, unknown>,
    };
  },
);

server.registerTool(
  "intelx_export_accounts",
  {
    title: "Export Leaked Accounts",
    description: `Export leaked usernames and passwords from breaches.

SEARCH TERMS:
- Email: user@example.com
- Domain: example.com (all accounts in domain)
- Partial: @example.com (all accounts in domain)

PARAMETERS:
- selector: Email or domain (REQUIRED)
- maxresults: Max accounts to export (default: 100)
- buckets: Optional bucket filter
- datefrom/dateto: Date range "YYYY-MM-DD HH:MM:SS"

RETURNS: Array of {user, password, passwordtype, sourceshort}
- user: Username/email
- password: Plaintext or hash
- passwordtype: "plaintext", "md5", "sha1", "bcrypt", etc.
- sourceshort: Breach source name

WARNING: Contains sensitive credential data. Handle responsibly.`,
    inputSchema: {
      selector: z.string(),
      maxresults: z.number().optional(),
      buckets: z.string().optional(),
      datefrom: z.string().optional(),
      dateto: z.string().optional(),
      terminate: z.array(z.string()).optional(),
    },
  },
  async (params) => {
    const validated = exportAccountsSchema.parse(params);

    const accounts = await identityClient
      .exportAccounts(
        validated.selector,
        validated.maxresults,
        validated.buckets,
        validated.datefrom,
        validated.dateto,
        validated.terminate,
      )
      .then(normalizeIntelxId);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(accounts, null, 2),
        },
      ],
      structuredContent: { accounts } as Record<string, unknown>,
    };
  },
);

server.registerResource(
  "search",
  new ResourceTemplate("intelx://search/{searchId}", { list: undefined }),
  {
    title: "Search Results",
    description: "Access Intelligence X search results by ID",
  },
  async (uri, { searchId }) => {
    const results = await intelxClient
      .getSearchResults(searchId as string, 100)
      .then(normalizeIntelxId);

    return {
      contents: [
        {
          uri: uri.href,
          text: JSON.stringify(results, null, 2),
          mimeType: "application/json",
        },
      ],
    };
  },
);

server.registerResource(
  "file",
  new ResourceTemplate("intelx://file/{systemId}/{bucket}", {
    list: undefined,
  }),
  {
    title: "File Content",
    description: "Access file contents from Intelligence X",
    inputSchema: {
      storageId: z.number(),
      bucket: z.string(),
    },
  },
  async (uri, { systemId, bucket }) => {
    if (!systemId || !bucket) {
      throw new Error("Missing required parameters");
    }

    const data = await intelxClient.fileRead(
      getOriginalUuid("systemid", +systemId) as string,
      bucket as string,
    );
    const buffer = Buffer.from(data);

    return {
      contents: [
        {
          uri: uri.href,
          blob: buffer.toString("base64"),
          mimeType: "application/octet-stream",
        },
      ],
    };
  },
);

server.registerResource(
  "tree",
  new ResourceTemplate("intelx://tree/{storageId}/{bucket}", {
    list: undefined,
  }),
  {
    title: "File Tree",
    description: "Access file tree view from Intelligence X",
    inputSchema: {
      storageId: z.number(),
      bucket: z.string(),
    },
  },
  async (uri, { storageId, bucket }) => {
    if (!storageId || !bucket) {
      throw new Error("Missing required parameters");
    }

    const tree = await intelxClient
      .fileTreeView(
        bucket as string,
        getOriginalUuid("storageid", +storageId) as string,
      )
      .then(normalizeIntelxId);

    return {
      contents: [
        {
          uri: uri.href,
          text: JSON.stringify(tree, null, 2),
          mimeType: "application/json",
        },
      ],
    };
  },
);

const app = express();
app.use(express.json());

app.post("/mcp", async (req, res) => {
  // Create a new transport for each request to prevent request ID collisions
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  res.on("close", () => {
    transport.close();
  });

  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

const port = parseInt(process.env.PORT || "3000");
app
  .listen(port, () => {
    console.log(`Demo MCP Server running on http://localhost:${port}/mcp`);
  })
  .on("error", (error) => {
    console.error("Server error:", error);
    process.exit(1);
  });
