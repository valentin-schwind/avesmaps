// js/map-features/__tests__/ecosystem-heightmap-raster.test.js
//
// V11: the ENCODING RULE of the stored height rasters. Run from the repo root:
//   node js/map-features/__tests__/ecosystem-heightmap-raster.test.js
// Exit 0 = all asserts passed.
//
// 🔴 Until 2026-09-14 this file also tested the rasteriser and the grid builder of the encoding file.
// Both fell with the old batch run of the Landschaften editor (see the head of the encoding file), and
// the asserts that were about THEM went with them. The coverage they carried along did not: the
// rasteriser test also drove `buildEcosystemHeightStack`, `sampleEcosystemHeightField` and
// `ecosystemGeometryBounds`, and all three have their own tests (ecosystem-height-combine.test.js,
// ecosystem-height-field.test.js, ecosystem-geometry.test.js) -- counted before deleting.
"use strict";

const assert = require("assert");
const path = require("path");
const fs = require("fs");
const vm = require("vm");

// 🪤 `Buffer` is handed in: `btoa` is absent in a vm context, and ecosystemHeightmapToBase64 falls back
// to Buffer. The typed arrays are handed in so the ones built out here are the ones it reads.
const context = { module: { exports: {} }, Buffer, Uint8Array, Uint16Array };
context.globalThis = context;
vm.createContext(context);
const file = path.join(__dirname, "..", "map-features-ecosystem-heightmap-raster.js");
vm.runInContext(fs.readFileSync(file, "utf8"), context, { filename: file });

// --- base64 round trip, little-endian -------------------------------------------------------------
const encoded = context.ecosystemHeightmapToBase64(new Uint16Array([1, 258]));
const bytes = Buffer.from(encoded, "base64");
assert.strictEqual(bytes.length, 4, "two uint16 are four bytes");
assert.deepStrictEqual([...bytes], [1, 0, 2, 1], "little-endian, as the PHP reader's unpack('v') expects");

// --- the clamp is the uint16 ceiling --------------------------------------------------------------
// 65.535 Schritt is four times the owner's 15.000 ceiling; the upload path clamps against this value.
// 🪤 Through module.exports, not `context.X`: a top-level `const` in a vm script lives in the script's
// lexical scope and never becomes a property of the context object (a `function` does).
assert.strictEqual(context.module.exports.ECOSYSTEM_HEIGHTMAP_MAX_SCHRITT, 65535, "the encoding holds exactly uint16");

console.log("ecosystem-heightmap-raster.test: all asserts passed");
