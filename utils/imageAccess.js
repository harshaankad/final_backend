const cloudinary = require("cloudinary").v2;

// Patient photos are stored as Cloudinary public_ids of *authenticated*
// assets. They cannot be fetched without a signature, so every API response
// that needs to show one mints a signed download URL that dies after
// IMAGE_URL_TTL_SEC. A leaked URL (screenshot, history, log line) therefore
// stops working within half an hour.
//
// Values that still start with http(s) are pre-migration public URLs and are
// passed through unchanged until scripts/migrate-images-to-authenticated.js
// has run.
const IMAGE_URL_TTL_SEC = 30 * 60;

const isLegacyUrl = (ref) => typeof ref === "string" && /^https?:\/\//i.test(ref);

const signedUrl = (publicId, expiresAt) =>
    cloudinary.utils.private_download_url(publicId, "", {
        type: "authenticated",
        resource_type: "image",
        expires_at: expiresAt,
        attachment: false,
    });

exports.imageUrl = (ref, expiresAt = nowPlusTtl()) => {
    if (!ref) return ref;
    return isLegacyUrl(ref) ? ref : signedUrl(ref, expiresAt);
};

exports.imageUrls = (refs, expiresAt = nowPlusTtl()) => (Array.isArray(refs) ? refs.map((r) => exports.imageUrl(r, expiresAt)) : []);

const nowPlusTtl = () => Math.floor(Date.now() / 1000) + IMAGE_URL_TTL_SEC;

const plain = (doc) => (doc && typeof doc.toObject === "function" ? doc.toObject() : { ...doc });

// Patient with image refs replaced by signed URLs. `imageUrlsExpireAt` lets a
// client refresh before the links go stale.
exports.presentPatient = (doc) => {
    if (!doc) return doc;
    const expiresAt = nowPlusTtl();
    const p = plain(doc);
    p.nakedEyePhoto = exports.imageUrl(p.nakedEyePhoto, expiresAt);
    p.dermoscopePhotos = exports.imageUrls(p.dermoscopePhotos, expiresAt);
    p.imageUrlsExpireAt = new Date(expiresAt * 1000);
    return p;
};

exports.presentReport = (doc) => {
    if (!doc) return doc;
    const expiresAt = nowPlusTtl();
    const r = plain(doc);
    r.editedNakedEyePhoto = exports.imageUrl(r.editedNakedEyePhoto, expiresAt);
    r.editedDermoscopePhotos = exports.imageUrls(r.editedDermoscopePhotos, expiresAt);
    r.imageUrlsExpireAt = new Date(expiresAt * 1000);
    return r;
};

exports.presentDoctor = (doc) => {
    if (!doc) return doc;
    const d = plain(doc);
    d.qualificationPic = exports.imageUrl(d.qualificationPic);
    return d;
};

// Projection for list endpoints: they never need the photos, so don't ship
// (or sign) them.
exports.WITHOUT_PATIENT_IMAGES = "-nakedEyePhoto -dermoscopePhotos";
exports.WITHOUT_REPORT_IMAGES = "-editedNakedEyePhoto -editedDermoscopePhotos";
