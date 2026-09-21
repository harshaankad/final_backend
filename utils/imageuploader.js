const cloudinary = require("cloudinary").v2;
const sharp = require("sharp");
const fs = require("fs").promises;

// Formats sharp can decode that we accept as clinical photos. Everything is
// identified by magic bytes — the filename/extension/mimetype the browser
// sends are ignored.
const ALLOWED_FORMATS = new Set(["jpeg", "png", "webp", "heif"]);
// Decompression-bomb guard: refuse anything over 50 megapixels.
const MAX_INPUT_PIXELS = 50 * 1000 * 1000;
// Cloudinary free-plan per-file cap.
const CLOUDINARY_MAX_BYTES = 10 * 1024 * 1024;
const MIN_JPEG_QUALITY = 40;
const MIN_DIMENSION = 500;

class ImageValidationError extends Error {
    constructor(message) {
        super(message);
        this.name = "ImageValidationError";
        this.status = 400;
    }
}
exports.ImageValidationError = ImageValidationError;

const sniff = async (path) => {
    let meta;
    try {
        meta = await sharp(path, { limitInputPixels: MAX_INPUT_PIXELS }).metadata();
    } catch (err) {
        if (/pixel limit/i.test(err.message)) {
            throw new ImageValidationError("Image dimensions are too large. Please upload a photo under 50 megapixels.");
        }
        throw new ImageValidationError("That file is not a supported image. Please upload a JPEG, PNG or WebP photo.");
    }
    if (!ALLOWED_FORMATS.has(meta.format) || !meta.width || !meta.height) {
        throw new ImageValidationError("That file is not a supported image. Please upload a JPEG, PNG or WebP photo.");
    }
    return meta;
};

// Re-encode from scratch. `.rotate()` bakes in the EXIF orientation, and
// because we never call `.withMetadata()` the output carries no EXIF/IPTC/XMP
// at all — no GPS coordinates, device model or timestamps. Rewriting the
// container also discards anything hidden inside the original file.
const reencode = async (inPath, outPath, { format, quality, width, height }) => {
    let img = sharp(inPath, { limitInputPixels: MAX_INPUT_PIXELS }).rotate();
    if (width || height) {
        img = img.resize({ width, height, fit: "inside", withoutEnlargement: true });
    }
    img = format === "png"
        ? img.png({ compressionLevel: 9 })
        : img.jpeg({ quality, progressive: true, mozjpeg: true });
    return img.toFile(outPath); // { size, width, height, format }
};

/**
 * Validate, sanitise and upload one image. Returns the Cloudinary public_id
 * (never a URL — authenticated assets are only reachable through signed URLs
 * minted per response by utils/imageAccess.js).
 */
exports.uploadImageToCloudinary = async (file, folder) => {
    const meta = await sniff(file.tempFilePath);

    // Lossless stays lossless; everything else becomes JPEG.
    let format = meta.format === "png" ? "png" : "jpeg";
    let outPath = `${file.tempFilePath}.out.${format === "png" ? "png" : "jpg"}`;
    const tempOutputs = new Set([outPath]);

    try {
        let quality = 90;
        let info = await reencode(file.tempFilePath, outPath, { format, quality });

        // Too big for Cloudinary: a PNG switches to JPEG, then quality drops,
        // then dimensions shrink — same strategy as before, now applied
        // after sanitising.
        if (info.size > CLOUDINARY_MAX_BYTES && format === "png") {
            format = "jpeg";
            outPath = `${file.tempFilePath}.out.jpg`;
            tempOutputs.add(outPath);
            info = await reencode(file.tempFilePath, outPath, { format, quality });
        }
        while (info.size > CLOUDINARY_MAX_BYTES && quality > MIN_JPEG_QUALITY) {
            quality -= 10;
            info = await reencode(file.tempFilePath, outPath, { format, quality });
        }
        let width = info.width;
        let height = info.height;
        while (info.size > CLOUDINARY_MAX_BYTES && width > MIN_DIMENSION) {
            width = Math.floor(width * 0.8);
            height = Math.floor(height * 0.8);
            info = await reencode(file.tempFilePath, outPath, { format, quality: 80, width, height });
        }
        if (info.size > CLOUDINARY_MAX_BYTES) {
            throw new ImageValidationError("Image is too large even after compression. Please upload a smaller photo.");
        }

        const result = await cloudinary.uploader.upload(outPath, {
            folder,
            type: "authenticated", // no public URL exists for this asset
            resource_type: "image",
            use_filename: false,
            unique_filename: true,
            overwrite: false,
        });

        return {
            publicId: result.public_id,
            format: result.format,
            width: result.width,
            height: result.height,
            bytes: result.bytes,
        };
    } finally {
        for (const p of tempOutputs) await fs.unlink(p).catch(() => {});
    }
};

// Remove an image from Cloudinary. Accepts a public_id (authenticated asset)
// or a pre-migration public URL. Missing assets are treated as deleted.
const LEGACY_URL_RE = /^https?:\/\/res\.cloudinary\.com\/[^/]+\/image\/upload\/(?:v\d+\/)?(.+?)\.[a-z0-9]+$/i;
exports.deleteImage = async (ref) => {
    if (!ref) return;
    let publicId = ref;
    let type = "authenticated";
    const legacy = typeof ref === "string" && ref.match(LEGACY_URL_RE);
    if (legacy) {
        publicId = legacy[1];
        type = "upload";
    }
    const result = await cloudinary.uploader.destroy(publicId, { type, resource_type: "image", invalidate: true });
    if (result.result !== "ok" && result.result !== "not found") {
        throw new Error(`Cloudinary destroy failed for ${publicId}: ${result.result}`);
    }
};
