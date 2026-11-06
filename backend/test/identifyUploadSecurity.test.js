
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

// Mock PlantNet so tests never call the real AI service.
const servicePath = require.resolve('../src/services/plantAiService');
const originalService = require.cache[servicePath];

let identifyCalls = 0;

require.cache[servicePath] = {
  id: servicePath,
  filename: servicePath,
  loaded: true,
  exports: {
    identifyPlant: async () => {
      identifyCalls++;
      return [];
    },
    PlantAiError: class PlantAiError extends Error {},
  },
};

const identifyRouter = require('../src/routes/identify');

// Restore the original module cache so other tests are unaffected.
if (originalService) {
  require.cache[servicePath] = originalService;
} else {
  delete require.cache[servicePath];
}

async function withApp(run) {
  const app = express();
  app.use('/api/identify', identifyRouter);

  const server = await new Promise(resolve => {
    const instance = app.listen(0, '127.0.0.1', () => {
      resolve(instance);
    });
  });

  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    await run(base);
  } finally {
    await new Promise((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
    });
  }
}

function jpegBlob(size = 4) {
  const bytes = Buffer.alloc(size);
  bytes[0] = 0xff;
  bytes[1] = 0xd8;
  bytes[2] = 0xff;
  bytes[3] = 0xd9;
  return new Blob([bytes], { type: 'image/jpeg' });
}

async function uploadImage(base, options = {}) {
  const form = new FormData();

  if (options.extraField) {
    form.set('unexpected', 'value');
  }

  form.append(
    'image',
    jpegBlob(options.size ?? 4),
    'plant.jpg'
  );

  if (options.secondImage) {
    form.append('image', jpegBlob(), 'plant2.jpg');
  }

  const response = await fetch(`${base}/api/identify`, {
    method: 'POST',
    body: form,
  });

  return {
    status: response.status,
    body: await response.json(),
  };
}

test('Identify: accepts a valid JPEG image', async () => {
  identifyCalls = 0;

  await withApp(async base => {
    const result = await uploadImage(base);

    assert.equal(result.status, 200);
    assert.equal(result.body.success, true);
    assert.equal(identifyCalls, 1);
  });
});

test('Identify: rejects images larger than 10 MiB', async () => {
  identifyCalls = 0;

  await withApp(async base => {
    const result = await uploadImage(base, {
      size: 10 * 1024 * 1024 + 1,
    });

    assert.equal(result.status, 400);
    assert.equal(result.body.success, false);
    assert.match(result.body.message, /10 MB/);
    assert.equal(identifyCalls, 0);
  });
});

test('Identify: rejects unexpected multipart fields', async () => {
  identifyCalls = 0;

  await withApp(async base => {
    const result = await uploadImage(base, {
      extraField: true,
    });

    assert.equal(result.status, 400);
    assert.equal(result.body.success, false);
    assert.equal(identifyCalls, 0);
  });
});

test('Identify: rejects multiple image uploads', async () => {
  identifyCalls = 0;

  await withApp(async base => {
    const result = await uploadImage(base, {
      secondImage: true,
    });

    assert.equal(result.status, 400);
    assert.equal(result.body.success, false);
    assert.equal(identifyCalls, 0);
  });
});
