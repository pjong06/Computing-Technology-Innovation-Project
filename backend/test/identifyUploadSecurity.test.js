
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { mockAuth } = require('./helpers/routeTestKit');
mockAuth(() => ({ userId: 'upload-test-user', role: 'botanist' }));

// Mock PlantNet so tests never call the real AI service.
const servicePath = require.resolve('../src/services/plantAiService');
const originalService = require.cache[servicePath];

let identifyCalls = 0;
let identifyHandler = async () => [];

require.cache[servicePath] = {
  id: servicePath,
  filename: servicePath,
  loaded: true,
  exports: {
  identifyPlant: async (...args) => {
    identifyCalls++;
    return identifyHandler(...args);
},
    PlantAiError: class PlantAiError extends Error {},
  },
};

const {
  createIdentifyRouter,
  limitIdentifyRequestSize,
  MAX_IDENTIFY_REQUEST_BYTES,
} = require('../src/routes/identify');

// Restore the original module cache so other tests are unaffected.
if (originalService) {
  require.cache[servicePath] = originalService;
} else {
  delete require.cache[servicePath];
}

async function withApp(run) {
  const app = express();
  app.disable('x-powered-by');
  app.use('/api/identify', createIdentifyRouter());

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

function checkRequestLength(value) {
  let responseStatus;
  let responseBody;
  let nextCalled = false;
  const req = {
    get: name => name.toLowerCase() === 'content-length' ? value : undefined,
  };
  const res = {
    status(status) {
      responseStatus = status;
      return this;
    },
    json(body) {
      responseBody = body;
      return this;
    },
  };
  limitIdentifyRequestSize(req, res, () => {
    nextCalled = true;
  });
  return { responseStatus, responseBody, nextCalled };
}

async function uploadImage(base, options = {}) {
  const form = new FormData();

  if (options.extraField) {
    form.set('unexpected', 'value');
  }

  form.append(
    'image',
    options.blob ?? jpegBlob(options.size ?? 4),
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

test('Identify: PNG and WebP uploads work; WebP reaches AI as a decoded JPEG', async () => {
  const sharp = require('sharp');
  const source = { create: { width: 20, height: 20, channels: 3, background: '#228844' } };
  for (const format of ['png', 'webp']) {
    identifyCalls = 0;
    let received;
    identifyHandler = async image => { received = image; return []; };
    try {
      const buffer = await sharp(source).toFormat(format).toBuffer();
      await withApp(async base => {
        const response = await uploadImage(base, { blob: new Blob([buffer], { type: `image/${format}` }) });
        assert.equal(response.status, 200);
        assert.equal(identifyCalls, 1);
        const expected = format === 'webp' ? 'jpeg' : 'png';
        assert.equal(received.mimetype, `image/${expected}`);
        assert.equal((await sharp(received.buffer).metadata()).format, expected);
        if (format === 'webp') assert.equal(received.filename, 'plant.jpg');
      });
    } finally { identifyHandler = async () => []; }
  }
});

test('Identify: rejects disallowed MIME types and spoofed image contents before AI', async () => {
  identifyCalls = 0;
  const samples = [
    ['text/plain', Buffer.from('not an image')],
    ['image/gif', Buffer.from('GIF89a')],
    ['image/svg+xml', Buffer.from('<svg></svg>')],
    ['image/jpeg', Buffer.from('not an image')],
    ['image/png', Buffer.from('not an image')],
    ['image/webp', Buffer.from('RIFF0000WEBPinvalid')],
  ];
  await withApp(async base => {
    for (const [type, buffer] of samples) {
      const response = await uploadImage(base, { blob: new Blob([buffer], { type }) });
      assert.equal(response.status, 400);
      assert.match(response.body.message, /JPEG|PNG|WebP/);
    }
    assert.equal(identifyCalls, 0);
  });
});

test('Identify: rejects images larger than 10 MiB', async () => {
  identifyCalls = 0;

  await withApp(async base => {
    const result = await uploadImage(base, {
      size: 10 * 1024 * 1024 + 1,
    });

    assert.equal(result.status, 413);
    assert.equal(result.body.success, false);
    assert.match(result.body.message, /10 MB/);
    assert.equal(identifyCalls, 0);
  });
});

test('Identify: rejects oversized HTTP requests before Multer reads the body', () => {
  const result = checkRequestLength(String(MAX_IDENTIFY_REQUEST_BYTES + 1));
  assert.equal(result.responseStatus, 413);
  assert.equal(result.responseBody.success, false);
  assert.equal(result.nextCalled, false);
});

test('Identify: accepts a safe or missing Content-Length and still relies on Multer', () => {
  assert.equal(checkRequestLength(String(MAX_IDENTIFY_REQUEST_BYTES)).nextCalled, true);
  assert.equal(checkRequestLength(undefined).nextCalled, true);
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


test('Identify: limits concurrent requests and releases slots', async () => {
  identifyCalls = 0;

  let releaseRequests;
  const holdRequests = new Promise(resolve => {
    releaseRequests = resolve;
  });

  let signalTwoStarted;
  const twoStarted = new Promise(resolve => {
    signalTwoStarted = resolve;
  });

  identifyHandler = async () => {
    if (identifyCalls === 2) {
      signalTwoStarted();
    }

    await holdRequests;
    return [];
  };

  try {
    await withApp(async base => {
      const first = uploadImage(base);
      const second = uploadImage(base);

      try {
        // Wait until both requests reach the mocked PlantNet service.
        await twoStarted;

        // A third request must be rejected while both slots are occupied.
        const third = await uploadImage(base);

        assert.equal(third.status, 503);
        assert.equal(third.body.success, false);
        assert.match(third.body.message, /busy/i);
        assert.equal(identifyCalls, 2);
      } finally {
        // Always release the first two requests.
        releaseRequests();
        await Promise.allSettled([first, second]);
      }

      // After requests finish, a new upload should succeed.
      const fourth = await uploadImage(base);

      assert.equal(fourth.status, 200);
      assert.equal(fourth.body.success, true);
      assert.equal(identifyCalls, 3);
    });
  } finally {
    releaseRequests();
    identifyHandler = async () => [];
  }
});
