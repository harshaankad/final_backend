const { uploadImageToCloudinary, ImageValidationError } = require("../utils/imageuploader");
const Doctor = require("../models/doctor");
const { presentDoctor } = require("../utils/imageAccess");

exports.uploadQualificationPic = async (req, res) => {
    try {
        if (!req.files || !req.files.qualificationPic || Array.isArray(req.files.qualificationPic)) {
            return res.status(400).json({
                success: false,
                message: "Qualification picture is required.",
            });
        }

        const uploadedImage = await uploadImageToCloudinary(req.files.qualificationPic, "qualification_pics");

        const updatedDoctor = await Doctor.findByIdAndUpdate(
            req.doctorId,
            { qualificationPic: uploadedImage.publicId },
            { new: true }
        ).select("firstname lastname email role qualificationPic");

        if (!updatedDoctor) {
            return res.status(404).json({ success: false, message: "Doctor not found." });
        }

        return res.status(200).json({
            success: true,
            message: "Qualification picture uploaded successfully.",
            data: presentDoctor(updatedDoctor),
        });
    } catch (error) {
        if (error instanceof ImageValidationError) {
            return res.status(400).json({ success: false, message: error.message });
        }
        console.error("Upload Error:", error.message);
        res.status(500).json({
            success: false,
            message: "Error uploading qualification picture.",
        });
    }
};
