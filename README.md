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

Copy [`.env.example`](.env.example) and set the variables below.

| Variable | Required | Description |
|----------|----------|-------------|
| `PROOFPOINT_ESSENTIALS_USERNAME` | For stdio and `AUTH_MODE=env` | Org-administrator username (sent as the `X-User` header) |
| `PROOFPOINT_ESSENTIALS_PASSWORD` | For stdio and `AUTH_MODE=env` | Org-administrator password (sent as the `X-Password` header) |
| `PROOFPOINT_ESSENTIALS_REGION` | No | Region subdomain, e.g. `us1` or `eu1` (default: `us1`) |
| `MCP_TRANSPORT` | No | `stdio` (default) or `http` |
| `AUTH_MODE` | No | `gateway` (Docker image and Compose default) or `env`. Gateway mode requires `X-Proofpoint-Essentials-Username` and `X-Proofpoint-Essentials-Password` on each `/mcp` request (`X-Proofpoint-Essentials-Region` is optional) and never falls back to `PROOFPOINT_ESSENTIALS_*`. `env` uses those variables only after S2S auth succeeds. |
| `CONDUIT_S2S_SECRET` | Yes for HTTP | Service-to-service secret. The HTTP server logs an error and exits non-zero when this is empty or a known placeholder (`changeme`, `secret`, `placeholder`, `your-s2s-secret`, `replace-with-a-real-secret`, and the same list in `src/index.ts`). Compose will not start when it is unset. Never commit a real value. The process never logs it. |
| `MCP_ALLOW_INSECURE_DEV` | No | Set to exactly `1` only for local development to start HTTP without `CONDUIT_S2S_SECRET`. The process logs a warning, skips `X-Gateway-S2S`, and listens on `127.0.0.1` only. A wider `MCP_HTTP_HOST` is overridden. A known placeholder secret is still refused. |
| `MCP_HTTP_HOST` | No | Bind address when `MCP_TRANSPORT=http`. Defaults to `127.0.0.1`. A configured `CONDUIT_S2S_SECRET` honors this value, including `0.0.0.0`. The container image sets `0.0.0.0`. Without a secret, the listener is `127.0.0.1` only. |
| `MCP_HTTP_PORT` | No | HTTP port. Defaults to `8080`. |

Only organization-administrator accounts can authenticate against this API; end-user
accounts cannot.

`/health` and `/healthz` stay unauthenticated and do not read credentials. The stdio transport does not use `CONDUIT_S2S_SECRET`.

### HTTP authentication

With `MCP_TRANSPORT=http` and `CONDUIT_S2S_SECRET` set, every `/mcp` request must include `X-Gateway-S2S`. A missing or invalid header returns 401 before any vendor credential is read.

The header is an HMAC proof, not a copy of the secret:

```text
t=<unix seconds>,v1=<hex hmac-sha256>
```

`<hex hmac-sha256>` is HMAC-SHA256 of the ASCII string `t=<unix seconds>` (the same `t=` prefix and the same decimal timestamp), keyed with `CONDUIT_S2S_SECRET`, encoded as lowercase hex. The timestamp must be within 300 seconds of the server clock.

```js
import { createHmac } from "node:crypto";

const secret = process.env.CONDUIT_S2S_SECRET;
const t = Math.floor(Date.now() / 1000);
const v1 = createHmac("sha256", secret).update(`t=${t}`).digest("hex");
const xGatewayS2s = `t=${t},v1=${v1}`;
```

In `AUTH_MODE=gateway`, `/mcp` also requires `X-Proofpoint-Essentials-Username` and `X-Proofpoint-Essentials-Password`. Those headers are the only credential source for that request.

```js
await fetch("http://127.0.0.1:8080/mcp", {
  method: "POST",
  headers: {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    "x-gateway-s2s": xGatewayS2s,
    "x-proofpoint-essentials-username": "org-admin@example.com",
    "x-proofpoint-essentials-password": "org-admin-password",
    "x-proofpoint-essentials-region": "us1",
  },
  body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
});
```

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

The image listens on `0.0.0.0` inside the container (`MCP_HTTP_HOST`) and defaults to `AUTH_MODE=gateway`. Publish the port on loopback and pass the S2S secret. In gateway mode, Proofpoint Essentials credentials arrive on each request as `X-Proofpoint-Essentials-*` headers; the image does not read them from the environment.

```bash
docker build --platform linux/amd64 --build-arg GITHUB_TOKEN=$(gh auth token) -t proofpoint-essentials-mcp .
docker run \
  -e CONDUIT_S2S_SECRET="$CONDUIT_S2S_SECRET" \
  -p 127.0.0.1:8080:8080 \
  proofpoint-essentials-mcp
```

Compose refuses to start when `CONDUIT_S2S_SECRET` is unset, sets `AUTH_MODE=gateway`, publishes `127.0.0.1:8080:8080`, and passes no `PROOFPOINT_ESSENTIALS_*` variables:

```bash
CONDUIT_S2S_SECRET="$CONDUIT_S2S_SECRET" docker compose up
```

Single-tenant HTTP (`AUTH_MODE=env`) still requires the S2S secret, then uses `PROOFPOINT_ESSENTIALS_USERNAME` and `PROOFPOINT_ESSENTIALS_PASSWORD`:

```bash
docker run \
  -e CONDUIT_S2S_SECRET="$CONDUIT_S2S_SECRET" \
  -e AUTH_MODE=env \
  -e PROOFPOINT_ESSENTIALS_USERNAME=your-value \
  -e PROOFPOINT_ESSENTIALS_PASSWORD=your-value \
  -e PROOFPOINT_ESSENTIALS_REGION=us1 \
  -p 127.0.0.1:8080:8080 \
  proofpoint-essentials-mcp
```

Local HTTP without a secret is development-only. It binds `127.0.0.1` and logs a warning. A non-loopback `MCP_HTTP_HOST` is overridden to `127.0.0.1`:

```bash
MCP_TRANSPORT=http MCP_ALLOW_INSECURE_DEV=1 npm start
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
