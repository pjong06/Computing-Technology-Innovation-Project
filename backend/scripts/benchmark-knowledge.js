// Read-only benchmark of the actual Express search route against live Supabase.
const fs = require('node:fs');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });
const express = require('express');
const { createKnowledgeRouter } = require('../src/routes/knowledge');

async function main() {
  const app = express();
  app.use('/api/knowledge', createKnowledgeRouter());
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/knowledge`;
  const samples = Number(process.env.BENCHMARK_SAMPLES || 20);
  if (!Number.isSafeInteger(samples) || samples < 1 || samples > 100) {
    server.close(); throw new Error('BENCHMARK_SAMPLES must be between 1 and 100');
  }
  const scenarios = [
    ['catalogue', '/species?page_size=2'],
    ['scientific_name', '/species?q=Shorea'],
    ['common_name', '/species?q=Pitcher'],
    ['family', '/species?family=Dipterocarpaceae'],
    ['no_matches', '/species?q=NoSuchSpeciesBenchmark'],
    ['second_page', '/species?page=2&page_size=2'],
  ];
  const results = [];
  const percentile = (values, p) => values[Math.ceil(values.length * p) - 1];
  try {
    for (const [name, endpoint] of scenarios) {
      const measurements = [];
      // One unmeasured warm-up per scenario; sequential requests, concurrency 1.
      for (let i = -1; i < samples; i++) {
        const start = performance.now();
        const response = await fetch(base + endpoint, { signal: AbortSignal.timeout(15000) });
        const body = await response.json();
        const elapsed = performance.now() - start;
        if (!response.ok || !Array.isArray(body.data) || !body.pagination) {
          throw new Error(`Benchmark failed: ${name}, HTTP ${response.status}`);
        }
        if (i >= 0) measurements.push({ ms: elapsed, rows: body.data.length, total: body.pagination.total });
      }
      const times = measurements.map(x => x.ms).sort((a, b) => a - b);
      results.push({ name, endpoint, samples, failures: 0,
        median_ms: percentile(times, .5), p95_ms: percentile(times, .95),
        min_ms: times[0], max_ms: times.at(-1),
        under_1000ms_percent: 100 * times.filter(x => x < 1000).length / samples,
        measurements });
      console.log(`${name}: median ${percentile(times, .5).toFixed(1)} ms, p95 ${percentile(times, .95).toFixed(1)} ms`);
    }
    const report = { measured_at: new Date().toISOString(), supabase_url: process.env.SUPABASE_URL,
      runtime: process.version, concurrency: 1, warmups_per_scenario: 1,
      scope: 'Local Express API through live Supabase, including network, count and taxonomy join; excludes hosted API and browser rendering.',
      limitation: 'Small existing development catalogue; does not establish performance at production scale or whole-system coverage.',
      results };
    const output = path.resolve(process.env.BENCHMARK_OUTPUT || 'benchmark-results/knowledge-search.json');
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
    console.log(`Saved ${output}`);
  } finally {
    server.close(); server.closeAllConnections();
  }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
