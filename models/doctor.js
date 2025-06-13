const mongoose = require("mongoose");

const doctorSchema = new mongoose.Schema({
  firstname: String,
  lastname: String,
  email: { type: String, unique: true, required: true },
  phone: String,
  password: String,
  age: Number,
  qualificationPic: String,
  role: { type: String, enum: ["doctor", "admin"], default: "doctor" },

  token: {
			type: String,
		},
	resetPasswordExpires: {
			type: Date,
		},

  howDoYouKnowAdmin: {
    type: String,
    enum: ["Family", "Friend", "Colleague", "No Direct Connection"],
    required: true,
  },

  pendingPatients: [{ type: mongoose.Schema.Types.ObjectId, ref: "Patient" }],
  donePatients: [{ type: mongoose.Schema.Types.ObjectId, ref: "Patient" }],
});

module.exports = mongoose.model("Doctor", doctorSchema);
