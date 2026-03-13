# Releasing Anchor / ACR

## Version Convention

- `0.x.0-beta.N` — pre-release, may have breaking changes
- `0.x.0` — stable minor release
- `1.0.0` — first stable public release

## Beta Release Checklist

### Before publishing

1. **Run tests**
   ```bash
   pnpm build
   pnpm -F @acr/connectors test
   ```

2. **Bump version** (if needed)
   Update both:
   - `apps/cli/package.json` → `version`
   - `apps/cli/src/index.ts` → `.version('x.x.x')`

3. **Build clean**
   ```bash
   pnpm build
   ```

4. **Pack tarball**
   ```bash
   cd apps/cli
   npm pack
   # produces: anchor-acr-0.1.0-beta.1.tgz
   ```

5. **Tarball smoke test** (required before every publish)
   ```bash
   # Install into a fresh temp directory
   mkdir /tmp/acr-release-test && cd /tmp/acr-release-test
   npm install /path/to/anchor/apps/cli/anchor-acr-0.1.0-beta.1.tgz

   # Verify CLI works
   npx acr --version        # should print 0.1.0-beta.1
   npx acr --help           # should show all commands
   npx acr init             # should create .acr/config.json
   npx acr doctor           # should run checks (will fail without config — that's OK)

   # Full flow (requires DATABASE_URL + EMBEDDING_API_KEY):
   # edit .acr/config.json with your credentials
   npx acr db-push
   npx acr doctor                     # all 7 checks should pass
   npx acr source add --name "Test" --type local_folder --folder-path /tmp/acr-test-docs
   npx acr sync --source "Test"
   npx acr search "setup guide"
   npx acr source inspect "Test"

   # Clean up
   cd .. && rm -rf /tmp/acr-release-test
   ```

6. **Review tarball contents**
   ```bash
   tar tzf anchor-acr-0.1.0-beta.1.tgz | head -20
   # Should contain: package/dist/index.js, package/dist/mcp-server.js, package/package.json
   # Should NOT contain: src/, node_modules/, .acr/, tsup.config.ts
   ```

### Publishing

```bash
cd apps/cli

# Beta release
npm publish --tag beta

# Stable release (when ready)
npm publish
```

### After publishing

1. **Verify install from registry**
   ```bash
   mkdir /tmp/acr-verify && cd /tmp/acr-verify
   npm install anchor-acr@beta
   npx acr --version
   npx acr --help
   cd .. && rm -rf /tmp/acr-verify
   ```

2. **Tag the release**
   ```bash
   git tag v0.1.0-beta.1
   git push origin v0.1.0-beta.1
   ```

## Package Name

The npm package name is `anchor-acr`. To change it:

1. Update `apps/cli/package.json` → `name`
2. Update README install commands
3. Update this file's examples

If using a scoped name like `@anchor/acr`:
- Add `"publishConfig": { "access": "public" }` to package.json
- You must own the `@anchor` npm scope
