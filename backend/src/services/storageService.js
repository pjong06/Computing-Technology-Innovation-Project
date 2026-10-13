const multer = require("multer");

// Keep uploaded images in memory temporarily.
// The route will upload them to Supabase Storage.
const storage = multer.memoryStorage();

const allowedTypes = [
    "image/jpeg",
    "image/png",
    "image/webp"
];

const upload = multer({
    storage,

    limits: {
        fileSize: 5 * 1024 * 1024 // Maximum 5 MB
    },

    fileFilter: (req, file, cb) => {
        if (!allowedTypes.includes(file.mimetype)) {
            return cb(new Error(
                "Only JPEG, PNG and WebP images are allowed"
            ));
        }

        cb(null, true);
    }
});

module.exports = upload;