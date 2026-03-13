# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability, please report it responsibly.

**Do not open a public issue.**

Email: [Create a private security advisory](https://github.com/mikestangdevs/anchor/security/advisories/new) on GitHub.

## Scope

Anchor stores configuration locally in `.acr/config.json`, which may contain database URLs and API keys. This file is gitignored by default.

- Never commit `.acr/` to version control
- Never commit `.env` files with real credentials
- Supabase `service_role` keys have full admin access — handle with care

## Supported Versions

| Version | Supported |
|---------|-----------|
| 0.1.x   | ✅        |
