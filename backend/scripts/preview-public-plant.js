const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const publicPlants = require('../src/routes/publicPlants');

const config = fs.readFileSync(path.join(__dirname, '../../frontend/js/shared.js'), 'utf8');
for (const name of ['SUPABASE_URL', 'SUPABASE_KEY']) {
    const value = config.match(new RegExp(name + "\\s*=\\s*['\"]([^'\"]+)"))?.[1];
    if (!value) throw new Error(`Could not read ${name} from frontend/js/shared.js`);
    process.env[name] = value;
}

const { publicClient } = require('../src/config/supabase');
const app = express();
app.disable('x-powered-by');
const port = Number(process.argv[2] || 3040);
app.use(publicPlants.createPublicPlantsRouter({ client: publicClient }));
app.listen(port, '127.0.0.1').on('listening', () => {
    console.log(`Preview ready at http://127.0.0.1:${port}/p/NIAH-PLT-00004`);
}).on('error', error => {
    console.error(error.message);
    process.exitCode = 1;
});
