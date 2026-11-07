const express = require('express');
const multer = require('multer');

const {
  identifyPlant,
  PlantAiError,
} = require('../services/plantAiService');

const router = express.Router();

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
    ];

    if (!allowedTypes.includes(file.mimetype)) {
      callback(
        new Error(
          'Only JPG and PNG plant images are allowed.'
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
          res.status(400).json({
            success: false,
            message:
              'The photo must be 10 MB or smaller.',
          });

          return;
        }

        if (
          error.code ===
          'LIMIT_UNEXPECTED_FILE'
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
            'The photo could not be uploaded.',
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
          'The file must be a valid JPG or PNG image.',
      });
    }

    try {
      const defaultFilename =
        req.file.mimetype === 'image/png'
          ? 'plant.png'
          : 'plant.jpg';

      const suggestions =
        await identifyPlant({
          buffer: req.file.buffer,
          mimetype: req.file.mimetype,
          filename:
            req.file.originalname ||
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

module.exports = router;