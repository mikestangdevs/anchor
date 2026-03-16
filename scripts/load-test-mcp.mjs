#!/usr/bin/env node
/**
 * MCP HTTP Load Test
 *
 * Sends concurrent search_context tool calls through the MCP HTTP transport.
 * Tests: singleflight dedup, semaphore behavior, session management.
 *
 * Usage:
 *   node scripts/load-test-mcp.mjs                      # default: 5 clients
 *   node scripts/load-test-mcp.mjs --clients 20          # 20 concurrent
 *   node scripts/load-test-mcp.mjs --port 3200            # custom port
 *   node scripts/load-test-mcp.mjs --identical-only       # only identical queries
 */

const BASE_URL = `http://localhost:${getArg('--port', '3100')}`;
const MCP_ENDPOINT = `${BASE_URL}/mcp`;
const CONCURRENCY_LEVELS = getArg('--clients', null)
  ? [parseInt(getArg('--clients', '5'))]
  : [1, 5, 10, 20];

const IDENTICAL_QUERY = 'how do agents work';
const MIXED_QUERIES = [
  'how do agents work',
  'what is function calling',
  'error handling patterns',
  'streaming responses',
  'authentication and API keys',
  'how to create a custom tool',
  'multi-agent orchestration',
  'context window management',
  'rate limiting best practices',
  'deployment to production',
];

const IDENTICAL_ONLY = process.argv.includes('--identical-only');

// ─── MCP Client Helpers ─────────────────────────────────────────

async function mcpRequest(sessionId, body) {
  const headers = {
    'Content-Type': 'application/json',
    'Accept': 'application/json, text/event-stream',
  };
  if (sessionId) headers['mcp-session-id'] = sessionId;

  const response = await fetch(MCP_ENDPOINT, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });

  const text = await response.text();

  // Parse SSE response
  const lines = text.split('\n');
  for (const line of lines) {
    if (line.startsWith('data: ')) {
      return {
        data: JSON.parse(line.slice(6)),
        sessionId: response.headers.get('mcp-session-id') || sessionId,
        status: response.status,
      };
    }
  }

  // Direct JSON response
  try {
    return {
      data: JSON.parse(text),
      sessionId: response.headers.get('mcp-session-id') || sessionId,
      status: response.status,
    };
  } catch {
    return { data: null, sessionId, status: response.status, error: text };
  }
}

async function initSession() {
  const result = await mcpRequest(null, {
    jsonrpc: '2.0',
    method: 'initialize',
    params: {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: { name: 'load-test', version: '1.0' },
    },
    id: 1,
  });
  return result.sessionId;
}

async function searchContext(sessionId, query, requestId) {
  const t0 = performance.now();
  try {
    const result = await mcpRequest(sessionId, {
      jsonrpc: '2.0',
      method: 'tools/call',
      params: {
        name: 'search_context',
        arguments: { query, max_results: 5 },
      },
      id: requestId,
    });
    const latency = performance.now() - t0;
    const hasResults = result.data?.result?.content?.[0]?.text;
    return { latency, success: !!hasResults, error: null, status: result.status };
  } catch (err) {
    const latency = performance.now() - t0;
    return { latency, success: false, error: err.message, status: 0 };
  }
}

// ─── Stats ──────────────────────────────────────────────────────

function computeStats(results) {
  const latencies = results.map(r => r.latency).sort((a, b) => a - b);
  const successes = results.filter(r => r.success).length;
  const errors = results.filter(r => !r.success);

  const p50 = latencies[Math.floor(latencies.length * 0.5)] ?? 0;
  const p95 = latencies[Math.floor(latencies.length * 0.95)] ?? 0;
  const p99 = latencies[Math.floor(latencies.length * 0.99)] ?? 0;
  const avg = latencies.reduce((a, b) => a + b, 0) / latencies.length;
  const min = latencies[0] ?? 0;
  const max = latencies[latencies.length - 1] ?? 0;

  return {
    total: results.length,
    successes,
    errorRate: ((results.length - successes) / results.length * 100).toFixed(1) + '%',
    latency: {
      min: min.toFixed(0) + 'ms',
      avg: avg.toFixed(0) + 'ms',
      p50: p50.toFixed(0) + 'ms',
      p95: p95.toFixed(0) + 'ms',
      p99: p99.toFixed(0) + 'ms',
      max: max.toFixed(0) + 'ms',
    },
    errors: errors.map(e => e.error).filter(Boolean),
  };
}

// ─── Test Scenarios ─────────────────────────────────────────────

async function runIdenticalQueryTest(concurrency) {
  console.log(`\n── Identical-query test (${concurrency} concurrent) ──`);
  console.log(`   Query: "${IDENTICAL_QUERY}"`);
  console.log(`   This should trigger singleflight dedup — expect 1 embed API call.\n`);

  // Initialize sessions
  const sessions = await Promise.all(
    Array.from({ length: concurrency }, () => initSession())
  );

  // Fire all identical queries simultaneously
  const t0 = performance.now();
  const results = await Promise.all(
    sessions.map((sid, i) => searchContext(sid, IDENTICAL_QUERY, i + 100))
  );
  const wallTime = performance.now() - t0;

  const stats = computeStats(results);
  console.log(`   Wall time:  ${wallTime.toFixed(0)}ms`);
  console.log(`   Successes:  ${stats.successes}/${stats.total}`);
  console.log(`   Error rate: ${stats.errorRate}`);
  console.log(`   Latency:    p50=${stats.latency.p50}  p95=${stats.latency.p95}  max=${stats.latency.max}`);
  if (stats.errors.length > 0) {
    console.log(`   Errors:     ${stats.errors.slice(0, 3).join(', ')}`);
  }

  return { scenario: 'identical', concurrency, wallTime, stats };
}

async function runMixedQueryTest(concurrency) {
  console.log(`\n── Mixed-query test (${concurrency} concurrent) ──`);
  console.log(`   Queries: ${concurrency} different queries`);
  console.log(`   This tests semaphore backpressure — max 3 concurrent embeds.\n`);

  const sessions = await Promise.all(
    Array.from({ length: concurrency }, () => initSession())
  );

  const t0 = performance.now();
  const results = await Promise.all(
    sessions.map((sid, i) => {
      const query = MIXED_QUERIES[i % MIXED_QUERIES.length];
      return searchContext(sid, query, i + 200);
    })
  );
  const wallTime = performance.now() - t0;

  const stats = computeStats(results);
  console.log(`   Wall time:  ${wallTime.toFixed(0)}ms`);
  console.log(`   Successes:  ${stats.successes}/${stats.total}`);
  console.log(`   Error rate: ${stats.errorRate}`);
  console.log(`   Latency:    p50=${stats.latency.p50}  p95=${stats.latency.p95}  max=${stats.latency.max}`);
  if (stats.errors.length > 0) {
    console.log(`   Errors:     ${stats.errors.slice(0, 3).join(', ')}`);
  }

  return { scenario: 'mixed', concurrency, wallTime, stats };
}

// ─── Main ───────────────────────────────────────────────────────

async function main() {
  console.log('╔══════════════════════════════════════════╗');
  console.log('║   ACR MCP HTTP Load Test                 ║');
  console.log('╚══════════════════════════════════════════╝');
  console.log(`Server: ${MCP_ENDPOINT}`);

  // Verify server is running
  try {
    const sid = await initSession();
    console.log(`Server OK — test session: ${sid?.slice(0, 8)}...`);
  } catch (err) {
    console.error(`\n✗ Cannot connect to MCP server at ${MCP_ENDPOINT}`);
    console.error(`  Start it first: acr run-mcp --http`);
    process.exit(1);
  }

  const allResults = [];

  for (const n of CONCURRENCY_LEVELS) {
    // Identical-query test (singleflight proof)
    const identical = await runIdenticalQueryTest(n);
    allResults.push(identical);

    if (!IDENTICAL_ONLY) {
      // Mixed-query test (semaphore/backpressure)
      const mixed = await runMixedQueryTest(n);
      allResults.push(mixed);
    }
  }

  // ─── Summary ────────────────────────────────────────────────
  console.log('\n═══════════════════════════════════════════');
  console.log('SUMMARY');
  console.log('═══════════════════════════════════════════');
  console.log('');
  console.log('Concurrency │ Scenario  │ Successes │ Error% │ p50      │ p95      │ Wall');
  console.log('────────────┼───────────┼───────────┼────────┼──────────┼──────────┼──────');
  for (const r of allResults) {
    const line = [
      String(r.concurrency).padStart(11),
      r.scenario.padEnd(9),
      `${r.stats.successes}/${r.stats.total}`.padStart(9),
      r.stats.errorRate.padStart(6),
      r.stats.latency.p50.padStart(8),
      r.stats.latency.p95.padStart(8),
      `${r.wallTime.toFixed(0)}ms`.padStart(6),
    ].join(' │ ');
    console.log(line);
  }
  console.log('');
}

function getArg(flag, defaultValue) {
  const idx = process.argv.indexOf(flag);
  if (idx >= 0 && process.argv[idx + 1]) return process.argv[idx + 1];
  return defaultValue;
}

main().catch((err) => {
  console.error('Load test error:', err);
  process.exit(1);
});
