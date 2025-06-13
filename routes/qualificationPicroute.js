const express = require("express");
const { uploadQualificationPic } = require("../controller/qualificationPic");
const { auth } = require("../middlewares/authmiddleware");

const router = express.Router();

router.post("/upload-qualification", auth, uploadQualificationPic);

module.exports = router;
