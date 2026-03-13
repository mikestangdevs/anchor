# Contributing to Anchor

Thanks for your interest in contributing!

## Getting Started

```bash
git clone https://github.com/mikestangdevs/anchor.git
cd anchor
pnpm install
pnpm build
pnpm -F @acr/connectors test
```

## Development

```bash
# Run CLI from source (no global link needed)
node apps/cli/dist/index.js <command>

# Or link globally
cd apps/cli && pnpm link --global
acr <command>
```

## Pull Requests

1. Fork the repo and create a branch
2. Make your changes
3. Run `pnpm build` and `pnpm -F @acr/connectors test`
4. Open a PR with a clear description

## Adding a New Connector

See `.agents/workflows/add-connector.md` for the step-by-step checklist.

## Reporting Issues

Open an issue at [github.com/mikestangdevs/anchor/issues](https://github.com/mikestangdevs/anchor/issues).

Include:
- `acr --version` output
- `acr doctor --json` output
- Steps to reproduce
