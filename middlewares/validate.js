// validate(schema)          → parses req.body, replaces it with the typed result
// validate(schema, "query") → same for req.query
// validateParam(name)       → :param must be a Mongo ObjectId
const { params } = require("../validation/schemas");

const firstMessage = (err) => err.issues?.[0]?.message || "Invalid request.";

exports.validate = (schema, source = "body") => (req, res, next) => {
  const result = schema.safeParse(req[source] ?? {});
  if (!result.success) {
    return res.status(400).json({ success: false, error: firstMessage(result.error), message: firstMessage(result.error) });
  }
  if (source === "query") {
    // Express 4 lets us replace req.query; Express 5 would not.
    req.query = result.data;
  } else {
    req[source] = result.data;
  }
  next();
};

exports.validateParam = (name) => (req, res, next) => {
  if (!params.objectId.safeParse(req.params[name]).success) {
    return res.status(400).json({ success: false, message: `Invalid ${name}.` });
  }
  next();
};
