# Intelligence X MCP Server

MCP server for [Intelligence X](https://intelx.io) - OSINT search engine and data archive.

## Setup

Install dependencies:
```bash
bun install
```

Configure API key:
```bash
cp .env.example .env
# Edit .env and add your Intelligence X API key
```

Get your API key from the [Developer Tab](https://intelx.io) in your Intelligence X account.

## Run

```bash
bun run index.ts
```

Server communicates via stdio for MCP protocol.

## MCP Tools

### Search Tools
- `intelx_intelligent_search` - Search for selectors (emails, domains, IPs, URLs, etc.)
- `intelx_phonebook_search` - Search phonebook (targeted selector search)
- `intelx_terminate_search` - Terminate ongoing search

### File Operations
- `intelx_file_preview` - Preview first N lines of a file
- `intelx_file_view` - View full file with format conversion (PDF→text, Word→text, etc.)
- `intelx_file_read` - Download raw file contents
- `intelx_file_treeview` - Get hierarchical tree of related files

### Metadata & Analysis
- `intelx_get_selectors` - Extract selectors from a document
- `intelx_get_capabilities` - Get API account capabilities

### Identity Service
- `intelx_identity_search` - Search breach/identity data
- `intelx_export_accounts` - Export leaked credentials

## Supported Selectors

Email, Domain (wildcards like `*.example.com`), URL, IPv4/IPv6, CIDR, Phone, Bitcoin address, MAC address, IPFS hash, UUID, Credit card, IBAN
