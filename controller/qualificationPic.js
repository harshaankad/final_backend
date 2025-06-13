const { uploadImageToCloudinary } = require("../utils/imageuploader");
const Doctor = require("../models/doctor");

exports.uploadQualificationPic = async (req, res) => {
    try {
        const doctorId = req.userId; // Get doctor ID from auth token

        // ✅ Check if file is uploaded
        if (!req.files || !req.files.qualificationPic) {
            return res.status(400).json({
                success: false,
                message: "Qualification picture is required.",
            });
        }

        const qualificationPic = req.files.qualificationPic;

        // 🔥 Debugging: Log file details
        console.log("Uploaded File Details:", qualificationPic);

        // ✅ Upload to Cloudinary
        const uploadedImage = await uploadImageToCloudinary(qualificationPic, "qualification_pics");

        // ✅ Update Doctor's profile with the uploaded image URL
        const updatedDoctor = await Doctor.findByIdAndUpdate(
            doctorId,
            { qualificationPic: uploadedImage.secure_url },
            { new: true }
        );

        if (!updatedDoctor) {
            return res.status(404).json({
                success: false,
                message: "Doctor not found.",
            });
        }

        return res.status(200).json({
            success: true,
            message: "Qualification picture uploaded successfully.",
            data: updatedDoctor,
        });

    } catch (error) {
        console.error("Upload Error:", error);
        res.status(500).json({
            success: false,
            message: "Error uploading qualification picture.",
            error: error.message,
        });
    }
};
