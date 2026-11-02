// Response content is deliberately excluded: no free-text data reaches the log.
function responseSummary(text) {
  try {
    const value = JSON.parse(text);
    const summary = { format: 'json', shape: Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value };
    if (Array.isArray(value)) summary.rowCount = value.length;
    else if (value && typeof value === 'object') {
      if (Array.isArray(value.data)) summary.rowCount = value.data.length;
      else if (Number.isSafeInteger(value.data?.total) && value.data.total >= 0) summary.rowCount = value.data.total;
    }
    return summary;
  } catch { return { format: 'non-json' }; }
}

async function logResponseSummary(response, write = console.log) {
  const summary = responseSummary(await response.text());
  write(JSON.stringify(summary));
}

module.exports = { responseSummary, logResponseSummary };
