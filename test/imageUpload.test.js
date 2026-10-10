// Photo checks and sanitising in utils/imageuploader.js. Cloudinary is
// mocked, so nothing leaves the machine and no database is needed.
//
//   npm test
const { test, beforeEach, after, mock } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const sharp = require("sharp");
const cloudinary = require("cloudinary").v2;
const { uploadImageToCloudinary, ImageValidationError, HEIC_MESSAGE } = require("../utils/imageuploader");

// Made with macOS `sips -s format heic` from a synthetic gradient: a real
// HEVC-compressed HEIC, the format iPhone cameras save by default.
const HEIC_FIXTURE = path.join(__dirname, "fixtures", "iphone-photo.heic");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ankad-imgtest-"));
after(() => fs.rmSync(dir, { recursive: true, force: true }));

// express-fileupload hands controllers { tempFilePath, name, mimetype, ... }.
// The uploader must judge by content alone, so name/mimetype here always
// claim JPEG whatever the bytes really are.
let seq = 0;
const asUpload = (buf) => {
  const tempFilePath = path.join(dir, `tmp-${seq++}`);
  fs.writeFileSync(tempFilePath, buf);
  return { tempFilePath, name: "IMG_0001.JPG", mimetype: "image/jpeg", size: buf.length };
};

const gradient = (width = 640, height = 480) => {
  const raw = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 3;
      raw[i] = x % 256;
      raw[i + 1] = y % 256;
      raw[i + 2] = 128;
    }
  }
  return sharp(raw, { raw: { width, height, channels: 3 } });
};

// Anything the uploader writes next to the temp file (`<tmp>.out.jpg`) must
// be gone once it returns or throws.
const leftovers = () => fs.readdirSync(dir).filter((f) => f.includes(".out."));

let uploads;
beforeEach(() => {
  mock.restoreAll();
  uploads = [];
  mock.method(cloudinary.uploader, "upload", async (filePath, options) => {
    // Inspect the file exactly as Cloudinary would receive it; the uploader
    // deletes it right after this resolves.
    const meta = await sharp(filePath).metadata();
    uploads.push({ options, meta });
    return { public_id: `${options.folder}/mock${uploads.length}`, format: meta.format, width: meta.width, height: meta.height, bytes: 1 };
  });
});

test("the HEIC fixture really is an iPhone-style (HEVC) HEIC", async () => {
  const meta = await sharp(HEIC_FIXTURE).metadata();
  assert.equal(meta.format, "heif");
  assert.equal(meta.compression, "hevc");
});

test("an iPhone HEIC photo is refused with a clear message and never uploaded", async () => {
  const file = asUpload(fs.readFileSync(HEIC_FIXTURE));
  await assert.rejects(uploadImageToCloudinary(file, "patients"), (err) => {
    assert.ok(err instanceof ImageValidationError, `expected ImageValidationError, got ${err.name}: ${err.message}`);
    assert.equal(err.status, 400);
    assert.equal(err.message, HEIC_MESSAGE);
    assert.match(err.message, /HEIC/);
    assert.match(err.message, /JPEG or PNG/);
    return true;
  });
  assert.equal(uploads.length, 0);
  assert.deepEqual(leftovers(), []);
});

test("JPEG is accepted, re-encoded without EXIF and uploaded as an authenticated asset", async () => {
  const buf = await gradient().jpeg().withExif({ IFD0: { ImageDescription: "taken at the clinic" } }).toBuffer();
  assert.ok((await sharp(buf).metadata()).exif, "precondition: input carries EXIF");

  const result = await uploadImageToCloudinary(asUpload(buf), "patients");

  assert.equal(result.publicId, "patients/mock1");
  assert.equal(uploads.length, 1);
  assert.equal(uploads[0].options.type, "authenticated");
  assert.equal(uploads[0].options.folder, "patients");
  assert.equal(uploads[0].meta.format, "jpeg");
  assert.equal(uploads[0].meta.exif, undefined);
  assert.deepEqual(leftovers(), []);
});

test("EXIF orientation is baked into the pixels", async () => {
  // 200x100 stored, orientation 6 = display rotated 90°.
  const buf = await gradient(200, 100).jpeg().withMetadata({ orientation: 6 }).toBuffer();
  await uploadImageToCloudinary(asUpload(buf), "patients");
  assert.equal(uploads[0].meta.width, 100);
  assert.equal(uploads[0].meta.height, 200);
  assert.equal(uploads[0].meta.orientation, undefined);
});

test("PNG is accepted and stays PNG", async () => {
  const buf = await gradient().png().toBuffer();
  await uploadImageToCloudinary(asUpload(buf), "patients");
  assert.equal(uploads[0].meta.format, "png");
});

test("WebP is accepted and converted to JPEG", async () => {
  const buf = await gradient().webp().toBuffer();
  await uploadImageToCloudinary(asUpload(buf), "patients");
  assert.equal(uploads[0].meta.format, "jpeg");
});

test("AVIF (the other HEIF flavour) is still accepted", async () => {
  const buf = await gradient().avif().toBuffer();
  const meta = await sharp(buf).metadata();
  assert.equal(meta.format, "heif");
  assert.equal(meta.compression, "av1");

  await uploadImageToCloudinary(asUpload(buf), "reports");
  assert.equal(uploads.length, 1);
  assert.equal(uploads[0].meta.format, "jpeg");
  assert.equal(uploads[0].options.folder, "reports");
});

const solid = (width, height) => sharp({ create: { width, height, channels: 3, background: { r: 200, g: 120, b: 90 } } });

test("a standard 12 MP iPhone photo keeps its full size", async () => {
  const buf = await solid(4032, 3024).jpeg().toBuffer();
  await uploadImageToCloudinary(asUpload(buf), "patients");
  assert.equal(uploads[0].meta.width, 4032);
  assert.equal(uploads[0].meta.height, 3024);
});

test("larger photos are scaled so the longest edge is 4096 px", async () => {
  // 24 MP portrait, stored landscape with orientation 6 like an iPhone.
  const buf = await solid(5712, 4284).jpeg().withMetadata({ orientation: 6 }).toBuffer();
  await uploadImageToCloudinary(asUpload(buf), "patients");
  assert.equal(uploads[0].meta.width, 3072);
  assert.equal(uploads[0].meta.height, 4096);
});

test("photos uploaded together are decoded one at a time", async () => {
  // Each decode needs 100-300 MB; several at once used to exceed the
  // server's 512 MB and get it killed mid-request.
  const realToFile = sharp.prototype.toFile;
  let active = 0;
  let maxActive = 0;
  mock.method(sharp.prototype, "toFile", async function (...args) {
    active++;
    maxActive = Math.max(maxActive, active);
    try {
      return await realToFile.apply(this, args);
    } finally {
      active--;
    }
  });

  const buf = await gradient(1200, 900).jpeg().toBuffer();
  await Promise.all(Array.from({ length: 8 }, () => uploadImageToCloudinary(asUpload(buf), "patients")));

  assert.equal(uploads.length, 8);
  assert.equal(maxActive, 1);
  assert.deepEqual(leftovers(), []);
});

test("a failed photo does not block the photos queued behind it", async () => {
  const good = await gradient().jpeg().toBuffer();
  const results = await Promise.allSettled([
    uploadImageToCloudinary(asUpload(Buffer.from("not a photo")), "patients"),
    uploadImageToCloudinary(asUpload(good), "patients"),
  ]);
  assert.equal(results[0].status, "rejected");
  assert.ok(results[0].reason instanceof ImageValidationError);
  assert.equal(results[1].status, "fulfilled");
  assert.equal(uploads.length, 1);
});

test("a file that is not an image is refused, whatever it claims to be", async () => {
  const file = asUpload(Buffer.from("definitely not a photo"));
  await assert.rejects(uploadImageToCloudinary(file, "patients"), (err) => {
    assert.ok(err instanceof ImageValidationError);
    assert.match(err.message, /not a supported image/);
    return true;
  });
  assert.equal(uploads.length, 0);
});

test("GIF is refused", async () => {
  const buf = await gradient(64, 64).gif().toBuffer();
  await assert.rejects(uploadImageToCloudinary(asUpload(buf), "patients"), ImageValidationError);
  assert.equal(uploads.length, 0);
});
