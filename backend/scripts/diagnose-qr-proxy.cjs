const https = require('node:https');
const fs = require('node:fs');
const path = require('node:path');

const run = process.argv[2] || String(Date.now());
if (!/^[0-9]{10,16}$/.test(run)) throw new Error('Run ID must contain 10 to 16 digits');
const origin = 'https://niah-backend.onrender.com';
const result = { run, startedAt: new Date().toISOString(), requests: [], phoneUrls: [] };
const output = path.resolve(__dirname, '../qr-proxy-diagnostic-' + run + '-results.json');

function request(marker) {
    return new Promise((resolve, reject) => {
        const start = new Date().toISOString();
        const q = https.get(origin + '/api/public/plants/by-qr?code=&sec76_client_check=' + marker,
            { agent: false, family: 4, headers: { 'Cache-Control': 'no-cache' } }, response => {
                response.resume();
                response.on('end', () => resolve({ marker, start,
                    end: new Date().toISOString(), status: response.statusCode }));
            });
        q.setTimeout(60000, () => q.destroy(new Error('Request timeout')));
        q.on('error', reject);
    });
}

async function main() {
    for (let n = 1; n <= 3; n++) {
        const marker = `sec76-computer-${run}-${n}`;
        const row = await request(marker);
        result.requests.push(row);
        console.log(JSON.stringify(row));
        if (![400, 429].includes(row.status)) throw new Error('Unexpected status');
    }
    for (let n = 1; n <= 3; n++) {
        const url = origin + '/api/public/plants/by-qr?code=NIAH-PLT-90001&sec76_client_check='
            + `sec76-phone-${run}-${n}`;
        result.phoneUrls.push(url);
        console.log('Phone ' + n + ': ' + url);
    }
    result.outcome = 'Computer probes complete; compare six marked server logs after phone requests';
}

main().catch(() => {
    result.outcome = 'INCONCLUSIVE: request failed; no IP diagnosis inferred';
    process.exitCode = 1;
}).finally(() => {
    result.completedAt = new Date().toISOString();
    fs.writeFileSync(output, JSON.stringify(result, null, 2));
    console.log('Results: ' + output);
});
