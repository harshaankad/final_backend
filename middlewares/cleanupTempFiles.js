const fs = require("fs").promises;

// express-fileupload only removes temp files on error/abort, never after a
// successful request — so raw patient images were accumulating in /tmp.
// Delete every temp file once the response is done, whatever the outcome.
module.exports = (req, res, next) => {
  let done = false;
  const cleanup = () => {
    if (done || !req.files) return;
    done = true;
    const files = Object.values(req.files).flat();
    for (const f of files) {
      if (f?.tempFilePath) fs.unlink(f.tempFilePath).catch(() => {});
    }
  };
  res.on("finish", cleanup);
  res.on("close", cleanup);
  next();
};
