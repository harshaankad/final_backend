const express = require("express");
const { uploadQualificationPic } = require("../controller/qualificationPic");
const { auth } = require("../middlewares/authmiddleware");
const { uploadLimiter } = require("../middlewares/rateLimiters");

const router = express.Router();

router.post("/upload-qualification", auth, uploadLimiter, uploadQualificationPic);

module.exports = router;
