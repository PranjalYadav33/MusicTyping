/**
 * Post-build script: copies public/ and .next/static/ into the
 * standalone output so the self-contained server can serve them.
 */
const fs = require("fs");
const path = require("path");

function copyDirSync(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirSync(s, d);
    } else {
      fs.copyFileSync(s, d);
    }
  }
}

const standaloneDir = path.join(".next", "standalone");

if (!fs.existsSync(standaloneDir)) {
  console.error("ERROR: .next/standalone not found. Did next build run with output: 'standalone'?");
  process.exit(1);
}

// 1. Copy public/ → .next/standalone/public/
if (fs.existsSync("public")) {
  console.log("Copying public/ → standalone/public/");
  copyDirSync("public", path.join(standaloneDir, "public"));
}

// 2. Copy .next/static/ → .next/standalone/.next/static/
const staticDir = path.join(".next", "static");
if (fs.existsSync(staticDir)) {
  console.log("Copying .next/static/ → standalone/.next/static/");
  copyDirSync(staticDir, path.join(standaloneDir, ".next", "static"));
}

console.log("Standalone preparation complete.");
