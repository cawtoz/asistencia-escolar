const path = require("node:path");

module.exports = {
  port: Number(process.env.PORT || 3000),
  dataDir: process.env.DATA_DIR || path.join(__dirname, "..", "data"),
  timeZone: process.env.TIME_ZONE || "America/Bogota",
};
