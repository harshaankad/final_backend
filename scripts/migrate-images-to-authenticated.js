#!/usr/bin/env node
/**
 * One-off migration: move every patient/report/doctor photo from a public
 * Cloudinary URL to an authenticated asset referenced by public_id.
 *
 *   node scripts/migrate-images-to-authenticated.js            # dry run (default)
 *   node scripts/migrate-images-to-authenticated.js --apply    # rename in place
 *   node scripts/migrate-images-to-authenticated.js --apply --reupload
 *
 * --apply     For each legacy URL: Cloudinary `rename` with to_type=authenticated
 *             (no data movement, CDN cache invalidated) and the DB field is
 *             rewritten to the bare public_id. Idempotent — re-running skips
 *             fields that no longer look like URLs.
 * --reupload  Instead of renaming, download the original, re-encode it through
 *             sharp (drops EXIF/GPS, same as new uploads) and upload it as a
 *             fresh authenticated asset, then delete the public original. Slower
 *             and moves data, but the only way to strip metadata from photos
 *             that were uploaded before this change.
 *
 * Old public URLs keep resolving from Cloudinary's CDN until the invalidation
 * propagates (minutes, occasionally up to an hour).
 */
require("dotenv").config();
const mongoose = require("mongoose");
const cloudinary = require("cloudinary").v2;
const sharp = require("sharp");
const fs = require("fs").promises;
const os = require("os");
const path = require("path");

const Patient = require("../models/patient");
const Report = require("../models/report");
const Doctor = require("../models/doctor");

const APPLY = process.argv.includes("--apply");
const REUPLOAD = process.argv.includes("--reupload");

cloudinary.config({
  cloud_name: process.env.CLOUD_NAME,
  api_key: process.env.API_KEY,
  api_secret: process.env.API_SECRET,
});

// https://res.cloudinary.com/<cloud>/image/upload/v123/patients/abc.jpg → patients/abc
const LEGACY_RE = new RegExp(`^https?://res\\.cloudinary\\.com/${process.env.CLOUD_NAME}/image/upload/(?:v\\d+/)?(.+?)\\.[a-z0-9]+$`, "i");
const parsePublicId = (url) => {
  const m = typeof url === "string" && url.match(LEGACY_RE);
  return m ? m[1] : null;
};

const TARGETS = [
  { model: Patient, label: "patients", single: ["nakedEyePhoto"], multi: ["dermoscopePhotos"] },
  { model: Report, label: "reports", single: ["editedNakedEyePhoto"], multi: ["editedDermoscopePhotos"] },
  { model: Doctor, label: "doctors", single: ["qualificationPic"], multi: [] },
];

const stats = { scanned: 0, migrated: 0, skipped: 0, failed: 0 };

// Returns the public_id the DB should now hold, or throws.
async function migrateOne(url) {
  const publicId = parsePublicId(url);
  if (!publicId) throw new Error(`not a ${process.env.CLOUD_NAME} upload URL`);
  if (!APPLY) return publicId;

  if (!REUPLOAD) {
    try {
      await cloudinary.uploader.rename(publicId, publicId, {
        type: "upload",
        to_type: "authenticated",
        resource_type: "image",
        invalidate: true,
      });
    } catch (err) {
      // Already moved on a previous run? Then the DB just needs updating.
      const already = await cloudinary.api.resource(publicId, { type: "authenticated", resource_type: "image" }).catch(() => null);
      if (!already) throw err;
    }
    return publicId;
  }

  // --reupload: sanitise a fresh copy, then remove the public original.
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`);
  const tmp = path.join(os.tmpdir(), `migrate-${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`);
  try {
    const buf = Buffer.from(await res.arrayBuffer());
    const meta = await sharp(buf).metadata();
    const pipeline = sharp(buf).rotate();
    const out = meta.format === "png" ? pipeline.png({ compressionLevel: 9 }) : pipeline.jpeg({ quality: 90, progressive: true, mozjpeg: true });
    await out.toFile(tmp);
    const folder = publicId.includes("/") ? publicId.slice(0, publicId.lastIndexOf("/")) : undefined;
    const up = await cloudinary.uploader.upload(tmp, {
      folder,
      type: "authenticated",
      resource_type: "image",
      use_filename: false,
      unique_filename: true,
      overwrite: false,
    });
    await cloudinary.uploader.destroy(publicId, { type: "upload", resource_type: "image", invalidate: true });
    return up.public_id;
  } finally {
    await fs.unlink(tmp).catch(() => {});
  }
}

async function processDoc(doc, single, multi, label) {
  let changed = false;
  for (const field of single) {
    const v = doc[field];
    if (!parsePublicId(v)) { if (typeof v === "string" && /^https?:/i.test(v)) stats.skipped++; continue; }
    stats.scanned++;
    try {
      doc[field] = await migrateOne(v);
      changed = true;
      stats.migrated++;
      console.log(`  ${label}/${doc._id}.${field}: ${APPLY ? "migrated" : "would migrate"} → ${doc[field]}`);
    } catch (err) {
      stats.failed++;
      console.error(`  ${label}/${doc._id}.${field}: FAILED — ${err.message}`);
    }
  }
  for (const field of multi) {
    const arr = Array.isArray(doc[field]) ? doc[field] : [];
    const next = [];
    for (const v of arr) {
      if (!parsePublicId(v)) { if (typeof v === "string" && /^https?:/i.test(v)) stats.skipped++; next.push(v); continue; }
      stats.scanned++;
      try {
        const id = await migrateOne(v);
        next.push(id);
        changed = true;
        stats.migrated++;
        console.log(`  ${label}/${doc._id}.${field}[]: ${APPLY ? "migrated" : "would migrate"} → ${id}`);
      } catch (err) {
        stats.failed++;
        next.push(v); // keep the old value so nothing is lost
        console.error(`  ${label}/${doc._id}.${field}[]: FAILED — ${err.message}`);
      }
    }
    doc[field] = next;
  }
  if (changed && APPLY) {
    await doc.constructor.updateOne({ _id: doc._id }, { $set: Object.fromEntries([...single, ...multi].map((f) => [f, doc[f]])) });
  }
}

(async () => {
  for (const k of ["MONGO_URI", "CLOUD_NAME", "API_KEY", "API_SECRET"]) {
    if (!process.env[k]) { console.error(`Missing ${k}`); process.exit(1); }
  }
  await mongoose.connect(process.env.MONGO_URI);
  console.log(`${APPLY ? (REUPLOAD ? "APPLY + REUPLOAD" : "APPLY (rename)") : "DRY RUN"} against ${mongoose.connection.host}/${mongoose.connection.name}, cloud ${process.env.CLOUD_NAME}\n`);

  for (const t of TARGETS) {
    const or = [...t.single, ...t.multi].map((f) => ({ [f]: /^https?:\/\//i }));
    const docs = await t.model.find({ $or: or }).select([...t.single, ...t.multi].join(" "));
    console.log(`${t.label}: ${docs.length} document(s) with legacy URLs`);
    for (const doc of docs) await processDoc(doc, t.single, t.multi, t.label);
  }

  console.log(`\nDone. legacy refs found: ${stats.scanned}, ${APPLY ? "migrated" : "would migrate"}: ${stats.migrated}, failed: ${stats.failed}, skipped (non-${process.env.CLOUD_NAME} URLs): ${stats.skipped}`);
  await mongoose.disconnect();
  process.exit(stats.failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
