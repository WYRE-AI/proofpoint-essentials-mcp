# Contributing

Thanks for your interest in improving `proofpoint-essentials-mcp`.

## Development setup

```bash
git clone https://github.com/WYRE-AI/proofpoint-essentials-mcp.git
cd proofpoint-essentials-mcp
npm install
```

## Workflow

1. Create a feature branch.
2. Make your changes, adding or updating tests as needed.
3. Run the full check suite before opening a PR:
   ```bash
   npm run lint
   npm run typecheck
   npm test
   npm run build
   npm run smoke
   ```
4. Commit using [Conventional Commits](https://www.conventionalcommits.org/) (`fix:`,
   `feat:`, `chore:`, …) — this repo releases via semantic-release, so the commit type
   drives versioning.
5. Open a pull request describing the change and its motivation.

## Reporting issues

Please open a [GitHub issue](https://github.com/WYRE-AI/proofpoint-essentials-mcp/issues)
with reproduction steps and relevant logs (redact any credentials).
