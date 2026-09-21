const Patient = require("../models/patient");
const Report = require("../models/report");
const { deleteImage } = require("../utils/imageuploader");
const logger = require("../utils/logger");

// Erase everything held for one patient: originals, the report's annotated
// copies, the report rows and the patient row. Image deletion happens first
// so a failure there leaves the DB record (and a retry path) intact.
exports.deletePatientRecord = async (patient) => {
  const reports = await Report.find({ patient: patient._id });

  const refs = [
    patient.nakedEyePhoto,
    ...(patient.dermoscopePhotos || []),
    ...reports.flatMap((r) => [r.editedNakedEyePhoto, ...(r.editedDermoscopePhotos || [])]),
  ].filter(Boolean);

  for (const ref of refs) await deleteImage(ref);

  await Report.deleteMany({ patient: patient._id });
  await Patient.deleteOne({ _id: patient._id });

  return { images: refs.length, reports: reports.length };
};

// Drop only the raw originals once the report (annotated copies) exists.
exports.purgeOriginals = async (patient) => {
  const refs = [patient.nakedEyePhoto, ...(patient.dermoscopePhotos || [])].filter(Boolean);
  for (const ref of refs) await deleteImage(ref);
  await Patient.updateOne(
    { _id: patient._id },
    { $unset: { nakedEyePhoto: 1 }, $set: { dermoscopePhotos: [], originalsPurgedAt: new Date() } }
  );
  return refs.length;
};

// Everything a doctor account holds: their patients (with reports and
// images) and the account itself.
exports.deleteDoctorRecord = async (doctor) => {
  const patients = await Patient.find({ doctor: doctor._id });
  let images = 0;
  for (const p of patients) {
    const r = await exports.deletePatientRecord(p);
    images += r.images;
  }
  await doctor.deleteOne();
  logger.info({ doctorId: String(doctor._id), patients: patients.length, images }, "doctor erased");
  return { patients: patients.length, images };
};
