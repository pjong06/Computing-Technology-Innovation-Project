// Response content is deliberately excluded: no free-text data reaches the log.
function responseSummary(text) {
  try {
    const value = JSON.parse(text);
    // Every output value is a fixed literal; no response-derived values cross
    // the diagnostic boundary, including numeric totals or array lengths.
    if (Array.isArray(value)) return { format: 'json', shape: 'array' };
    if (value === null) return { format: 'json', shape: 'null' };
    if (typeof value === 'object') return { format: 'json', shape: 'object' };
    return { format: 'json', shape: 'primitive' };
  } catch { return { format: 'non-json' }; }
}

async function logResponseSummary(response, write = console.log) {
  const summary = responseSummary(await response.text());
  write(JSON.stringify(summary));
}

module.exports = { responseSummary, logResponseSummary };
