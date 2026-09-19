const fs = require("node:fs");
const path = require("node:path");

let JSZip;
try {
  JSZip = require("jszip");
} catch {
  try {
    const jszipPath = require.resolve("jszip", {
      paths: [path.resolve(__dirname, "../packages/theme-core"), path.resolve(__dirname, "../apps/api")],
    });
    JSZip = require(jszipPath);
  } catch (err) {
    console.error("Could not resolve jszip:", err.message);
  }
}

async function packDesignerPackage() {
  const packageDir = path.resolve(__dirname, "../VIBRESS_THEME_DESIGNER_PACKAGE");
  const outputPath = path.resolve(__dirname, "../VIBRESS_THEME_DESIGNER_PACKAGE.zip");

  const zip = new JSZip();

  function addDir(dir, prefix = "") {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      // Avoid packaging another zip or node_modules or system files
      if (entry.name === "VIBRESS_THEME_DESIGNER_PACKAGE.zip" || entry.name.startsWith(".")) {
        continue;
      }
      const fullPath = path.join(dir, entry.name);
      const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        addDir(fullPath, relPath);
      } else if (entry.isFile()) {
        const content = fs.readFileSync(fullPath);
        zip.file(relPath, content);
      }
    }
  }

  addDir(packageDir);

  const buffer = await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 9 },
  });

  fs.writeFileSync(outputPath, buffer);
  console.log(`Successfully packed Theme Designer Package to ${outputPath} (${buffer.length} bytes)`);
}

packDesignerPackage().catch(console.error);
