#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const terser = require("terser");

/**
 * Build script for BetterDiscord VimMotions plugin
 * Usage: node scripts/build.js [version]
 * Example: node scripts/build.js 1.2.0
 */

const PLUGIN_PATH = path.join(__dirname, "../plugins/VimMotions.plugin.js");
const OUTPUT_PATH = path.join(__dirname, "../dist/VimMotions.plugin.js");

function updateVersion(content, newVersion) {
  // Update the @version line in the plugin metadata
  return content.replace(/(@version\s+)[\d.]+/, `$1${newVersion}`);
}

async function minifyCode(content) {
  // Extract metadata (JSDoc header) to preserve it
  const metadataMatch = content.match(/(\/\*[\s\S]*?\*\/\s*)/);
  const metadata = metadataMatch ? metadataMatch[1] : "";
  // Get the actual code (everything after metadata)
  const code = content.substring(metadata.length);

  // Use terser to minify the code
  const result = await terser.minify(code, {
    compress: {
      passes: 2,
    },
    mangle: true,
    format: {
      comments: false,
    },
  });

  if (result.error) {
    throw result.error;
  }

  // Combine metadata with minified code
  return metadata + (result.code || "");
}
async function build(version) {
  console.log("🔨 Building VimMotions plugin...");

  // Read the plugin file
  if (!fs.existsSync(PLUGIN_PATH)) {
    console.error(`❌ Plugin file not found: ${PLUGIN_PATH}`);
    process.exit(1);
  }

  let content = fs.readFileSync(PLUGIN_PATH, "utf8");

  // Update version if provided
  if (version) {
    console.log(`📝 Updating version to ${version}...`);
    content = updateVersion(content, version);

    // Write the updated version back to the source file
    fs.writeFileSync(PLUGIN_PATH, content, "utf8");
    console.log(`✅ Updated ${PLUGIN_PATH}`);
  }

  // Create dist directory if it doesn't exist
  const distDir = path.dirname(OUTPUT_PATH);
  if (!fs.existsSync(distDir)) {
    fs.mkdirSync(distDir, { recursive: true });
  }

  // Minify and save to dist
  console.log("🗜️  Minifying code...");
  const minified = await minifyCode(content);
  fs.writeFileSync(OUTPUT_PATH, minified, "utf8");

  const originalSize = Buffer.byteLength(content, "utf8");
  const minifiedSize = Buffer.byteLength(minified, "utf8");
  const reduction = ((1 - minifiedSize / originalSize) * 100).toFixed(2);

  console.log(`✅ Minified plugin saved to ${OUTPUT_PATH}`);
  console.log(
    `📊 Size: ${(originalSize / 1024).toFixed(2)}KB → ${(
      minifiedSize / 1024
    ).toFixed(2)}KB (${reduction}% reduction)`
  );
  console.log("🎉 Build complete!");
}

// Get version from command line argument
const version = process.argv[2];

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log(`
Build script for BetterDiscord VimMotions plugin

Usage:
  node scripts/build.js [version]

Arguments:
  version    (optional) Version number to set in the plugin metadata

Examples:
  node scripts/build.js           # Build without changing version
  node scripts/build.js 1.2.0     # Build and update version to 1.2.0
  `);
  process.exit(0);
}

build(version).catch((err) => {
  console.error("Build failed:", err);
  process.exit(1);
});
