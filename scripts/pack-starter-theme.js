const fs = require("node:fs");
const path = require("node:path");
const JSZip = require("jszip");

async function packTheme() {
  const themeDir = path.resolve(__dirname, "../content/theme-starter");
  const outputPath = path.resolve(__dirname, "../content/vibress-theme-starter.zip");

  const zip = new JSZip();

  function addDir(dir, prefix = "") {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
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

  addDir(themeDir);

  const buffer = await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 9 },
  });

  fs.writeFileSync(outputPath, buffer);
  console.log(`Successfully packed starter theme to ${outputPath} (${buffer.length} bytes)`);
}

packTheme().catch(console.error);
