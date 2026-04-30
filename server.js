const fs = require("fs");
const path = require("path");

const candidates = [
  path.join(__dirname, "backend", "dist", "src", "server.js"),
  path.join(__dirname, "dist", "src", "server.js"),
  path.join(__dirname, "..", "backend", "dist", "src", "server.js"),
];

const entry = candidates.find((file) => fs.existsSync(file));

if (!entry) {
  console.error("No se encontro backend compilado. Busque en:");
  for (const file of candidates) console.error(` - ${file}`);
  process.exit(1);
}

require(entry);
