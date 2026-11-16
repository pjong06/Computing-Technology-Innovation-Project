const express = require('express');
const multer = require('multer');
const sharp = require('sharp');
const { requireAuth, requireRole } = require('../middleware/auth');
const { createIdentifyRateLimit } = require('../middleware/identifyRateLimit');

const {
  identifyPlant,
  PlantAiError,
} = require('../services/plantAiService');

function createIdentifyRouter({
  ipLimit = 20, userLimit = 10, windowMs = 60000, now = Date.now,
} = {}) {
const router = express.Router();
const ipLimiter = createIdentifyRateLimit({
  limit: ipLimit, windowMs, now, keyFor: req => req.ip || req.socket.remoteAddress,
});
const userLimiter = createIdentifyRateLimit({
  limit: userLimit, windowMs, now, keyFor: req => req.user.id,
});

const MAX_IMAGE_SIZE = 10 * 1024 * 1024;

const MAX_CONCURRENT_IDENTIFICATIONS = 2;
let activeIdentifications = 0;

function limitConcurrentIdentifications(req, res, next) {
  if (activeIdentifications >= MAX_CONCURRENT_IDENTIFICATIONS) {
    return res.status(503).json({
      success: false,
      message: 'Plant identification is busy. Please try again later.',
    });
  }

  activeIdentifications++;

  let released = false;

  function releaseSlot() {
    if (released) return;
    released = true;
    activeIdentifications--;
  }

  res.once('finish', releaseSlot);
  res.once('close', releaseSlot);

  next();
}

const upload = multer({
  storage: multer.memoryStorage(),

  limits: {
    fileSize: MAX_IMAGE_SIZE,
    files: 1,
    fields: 0,
    parts: 1,
    fieldNameSize: 32,
  },

  fileFilter: (_req, file, callback) => {
    const allowedTypes = [
      'image/jpeg',
      'image/png',
      'image/webp',
    ];

    if (!allowedTypes.includes(file.mimetype)) {
      callback(
        new Error(
          'Only JPEG, PNG and WebP plant images are allowed.'
        )
      );

      return;
    }

    callback(null, true);
  },
});

function hasValidImageSignature(file) {
  const bytes = file.buffer;

  if (file.mimetype === 'image/jpeg') {
    return (
      bytes.length >= 3 &&
      bytes[0] === 0xff &&
      bytes[1] === 0xd8 &&
      bytes[2] === 0xff
    );
  }

  if (file.mimetype === 'image/png') {
    return (
      bytes.length >= 8 &&
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47 &&
      bytes[4] === 0x0d &&
      bytes[5] === 0x0a &&
      bytes[6] === 0x1a &&
      bytes[7] === 0x0a
    );
  }

  if (file.mimetype === 'image/webp') {
    return bytes.length >= 12 &&
      bytes.toString('ascii', 0, 4) === 'RIFF' &&
      bytes.toString('ascii', 8, 12) === 'WEBP';
  }

  return false;
}

function uploadImage(req, res, next) {
  upload.single('image')(
    req,
    res,
    (error) => {
      if (!error) {
        next();
        return;
      }

      if (
        error instanceof multer.MulterError
      ) {
        if (
          error.code === 'LIMIT_FILE_SIZE'
        ) {
          res.status(413).json({
            success: false,
            message:
              'The photo must be 10 MB or smaller.',
          });

          return;
        }

        if (
          error.code === 'LIMIT_UNEXPECTED_FILE' ||
          error.code === 'LIMIT_FILE_COUNT'
        ) {
          res.status(400).json({
            success: false,
            message:
              'Upload one photo using the image field.',
          });

          return;
        }

        res.status(400).json({
          success: false,
          message:
            'Upload one photo using the image field, without extra fields.',
        });

        return;
      }

      res.status(400).json({
        success: false,
        message:
          error instanceof Error
            ? error.message
            : 'Invalid photo.',
      });
    }
  );
}

router.post(
  '/',
  ipLimiter,
  requireAuth,
  requireRole('botanist', 'officer'),
  userLimiter,
  limitConcurrentIdentifications,
  uploadImage,
  async (req, res) => {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message:
          'Please upload a plant image.',
      });
    }

    if (
      !hasValidImageSignature(req.file)
    ) {
      return res.status(400).json({
        success: false,
        message:
          'The file must be a valid JPEG, PNG or WebP image.',
      });
    }

    // The identification provider expects JPEG/PNG. Decode WebP with a pixel
    // bound and send a fresh JPEG, rather than forwarding an unsupported format.
    let image = req.file;
    if (image.mimetype === 'image/webp') {
      try {
        const buffer = await sharp(image.buffer, { limitInputPixels: 25_000_000 })
          .rotate()
          .resize(2000, 2000, { fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality: 85 }).toBuffer();
        image = { buffer, mimetype: 'image/jpeg', originalname: 'plant.jpg' };
      } catch {
        return res.status(400).json({ success: false, message: 'The file must be a valid WebP image (maximum 25 megapixels).' });
      }
    }

    try {
      const defaultFilename =
        image.mimetype === 'image/png'
          ? 'plant.png'
          : 'plant.jpg';

      const suggestions =
        await identifyPlant({
          buffer: image.buffer,
          mimetype: image.mimetype,
          filename:
            image.originalname ||
            defaultFilename,
        });

      return res.json({
        success: true,

        message:
          suggestions.length > 0
            ? 'Species suggestions generated successfully.'
            : 'No species suggestions were found.',

        suggestions,
      });
    } catch (error) {
      if (
        !(error instanceof PlantAiError)
      ) {
        console.error(
          'Species identification failed:',
          error
        );
      }

      const statusCode =
        error instanceof PlantAiError
          ? error.statusCode
          : 502;

      const message =
        error instanceof PlantAiError
          ? error.message
          : 'Species identification failed.';

      return res.status(statusCode).json({
        success: false,
        message,
      });
    }
  }
);

return router;
}

module.exports = createIdentifyRouter();
module.exports.createIdentifyRouter = createIdentifyRouter;
