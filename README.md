# Proofpoint Essentials MCP Server

[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen.svg)](https://nodejs.org/)

A [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) server for the
[Proofpoint Essentials](https://us1.proofpointessentials.com/api/v1/docs/index.php) API.
Enables AI assistants to manage MSP-multi-tenant email security: organizations, domains,
users, licensing, features, subscription packages, and email flow reporting.

This is a distinct product/API from Proofpoint TAP (see
[`proofpoint-mcp`](https://github.com/WYRE-AI/proofpoint-mcp) for TAP threat intelligence,
quarantine, and URL defense) — Essentials is Proofpoint's SMB/MSP email-security product,
with its own base URL, auth model, and org-management surface.

> **Part of the [WYRE AI](https://github.com/WYRE-AI) MCP fleet** — a growing suite of AI
> integrations for the MSP stack.

## Installation

```bash
npm install @wyre-ai/proofpoint-essentials-mcp
```

## Configuration

Set the following environment variables:

| Variable | Required | Description |
|----------|----------|-------------|
| `PROOFPOINT_ESSENTIALS_USERNAME` | Yes | Org-administrator username (sent as the `X-User` header) |
| `PROOFPOINT_ESSENTIALS_PASSWORD` | Yes | Org-administrator password (sent as the `X-Password` header) |
| `PROOFPOINT_ESSENTIALS_REGION` | No | Region subdomain, e.g. `us1` or `eu1` (default: `us1`) |
| `MCP_TRANSPORT` | No | Transport mode: `stdio` (default) or `http` |

Only organization-administrator accounts can authenticate against this API; end-user
accounts cannot.

## Usage

### Running with Claude Desktop

Add to your Claude Desktop `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "proofpoint-essentials-mcp": {
      "command": "npx",
      "args": ["@wyre-ai/proofpoint-essentials-mcp"],
      "env": {
        "PROOFPOINT_ESSENTIALS_USERNAME": "your-username",
        "PROOFPOINT_ESSENTIALS_PASSWORD": "your-password"
      }
    }
  }
}
```

### Running with Claude Code (CLI)

```bash
claude mcp add proofpoint-essentials-mcp \
  -e PROOFPOINT_ESSENTIALS_USERNAME=your-value \
  -e PROOFPOINT_ESSENTIALS_PASSWORD=your-value \
  -- npx -y @wyre-ai/proofpoint-essentials-mcp
```

### Docker

```bash
docker build --platform linux/amd64 --build-arg GITHUB_TOKEN=$(gh auth token) -t proofpoint-essentials-mcp .
docker run \
  -e PROOFPOINT_ESSENTIALS_USERNAME=your-value \
  -e PROOFPOINT_ESSENTIALS_PASSWORD=your-value \
  -e MCP_TRANSPORT=http \
  -p 8080:8080 proofpoint-essentials-mcp
```

## Available Tools

Proofpoint Essentials is an MSP multi-tenant API — every org/domain/user-scoped tool
takes the target customer organization's domain as a per-call argument (credentials are
not scoped to a single org).

### Organizations
- `proofpoint_essentials_org_get` — get org data and its domains
- `proofpoint_essentials_org_set_active` — activate/deactivate an org ⚠ high-impact
- `proofpoint_essentials_org_delete` — delete an org ⚠ destructive, irreversible

### Domains
- `proofpoint_essentials_domains_list`
- `proofpoint_essentials_domains_create` — batch add
- `proofpoint_essentials_domains_update` ⚠ high-impact
- `proofpoint_essentials_domains_delete` ⚠ destructive, irreversible

### Users
- `proofpoint_essentials_users_list`
- `proofpoint_essentials_users_get`
- `proofpoint_essentials_users_create` — batch add
- `proofpoint_essentials_users_update` ⚠ high-impact
- `proofpoint_essentials_users_delete` ⚠ destructive, irreversible

### Endpoint discovery
- `proofpoint_essentials_endpoint_discover` — resolve which region hosts a customer domain

### Features / Licensing / Package
- `proofpoint_essentials_features_get` / `proofpoint_essentials_features_update` ⚠ high-impact
- `proofpoint_essentials_licensing_get` / `proofpoint_essentials_licensing_update` ⚠ high-impact
- `proofpoint_essentials_package_update` ⚠ high-impact

### Reporting
- `proofpoint_essentials_reporting_get` — inbound/outbound email flow metrics

### Token
- `proofpoint_essentials_token_create` — mint an Odin-based SSO token

Destructive tools require explicit confirmation. Interactive MCP clients are prompted
via elicitation; non-interactive callers (e.g. the WYRE gateway) must pass
`confirm_destructive_action: true` and are otherwise blocked.

## Development

```bash
git clone https://github.com/WYRE-AI/proofpoint-essentials-mcp.git
cd proofpoint-essentials-mcp
npm install
npm run build
npm test
npm run smoke   # requires a prior `npm run build`
```

## Contributing

Contributions are welcome! Please see [CONTRIBUTING.md](CONTRIBUTING.md), or open an
issue to discuss changes.

## License

Licensed under the Apache License, Version 2.0. See [LICENSE](LICENSE) for details.
