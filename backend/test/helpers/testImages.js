'use strict';

// Real test photos for upload tests (not a test file itself). The JPEG carries EXIF with a
// GPS position, a camera note and an ICC profile, so tests can check that what the backend
// stores or serves has none of it.
const sharp = require('sharp');

// A real camera EXIF block is hard to build by hand; sharp writes IFD0 and GPS tags.
const SECRET_EXIF = {
  IFD0: { Copyright: 'SECRET_CAMERA_OWNER', ImageDescription: 'SECRET_NOTE' },
  IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '3/1 48/1 5300/100', GPSLongitudeRef: 'E', GPSLongitude: '113/1 46/1 4500/100' },
};

let cachedJpeg = null;
async function photoWithMetadata({ width = 1600, height = 900 } = {}) {
  if (width === 1600 && height === 900 && cachedJpeg) return cachedJpeg;
  const jpeg = await sharp({ create: { width, height, channels: 3, background: { r: 40, g: 120, b: 60 } } })
    .withExif(SECRET_EXIF)
    .withIccProfile('p3')
    .jpeg({ quality: 80 })
    .toBuffer();
  if (width === 1600 && height === 900) cachedJpeg = jpeg;
  return jpeg;
}

// Says what metadata a stored or served image still has.
async function metadataOf(buffer) {
  const info = await sharp(buffer).metadata();
  return {
    format: info.format,
    width: info.width,
    height: info.height,
    exif: info.exif,
    xmp: info.xmp,
    icc: info.icc,
    iptc: info.iptc,
  };
}

// True when the bytes contain any of the secret EXIF text or an EXIF/XMP marker.
function hasMetadataBytes(buffer) {
  const text = Buffer.from(buffer).toString('latin1');
  return /SECRET_CAMERA_OWNER|SECRET_NOTE|Exif\0\0|http:\/\/ns\.adobe\.com\/xap/.test(text);
}

module.exports = { photoWithMetadata, metadataOf, hasMetadataBytes, SECRET_EXIF };
