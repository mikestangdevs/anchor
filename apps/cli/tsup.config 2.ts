import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'mcp-server': 'src/mcp-server.ts',
  },
  format: ['esm'],
  target: 'node20',
  splitting: false,
  clean: true,
  // Bundle @acr/* workspace packages into the CLI output.
  // Third-party npm packages stay external (resolved from node_modules at runtime).
  noExternal: [
    '@acr/annotations',
    '@acr/config',
    '@acr/connectors',
    '@acr/core',
    '@acr/db',
    '@acr/embeddings',
    '@acr/parser',
    '@acr/retrieval',
    '@acr/types',
  ],
  // Explicitly externalize third-party deps that have CJS issues in ESM bundles.
  // cheerio + turndown and their transitive deps must stay external.
  external: [
    'cheerio',
    'turndown',
  ],
  shims: true,
});
