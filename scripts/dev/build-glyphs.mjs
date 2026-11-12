/**
 * Builds the self-hosted SDF glyphs MapLibre needs for map labels.
 *
 * Avesmaps serves everything from its own infrastructure (chapter 2.1), so there is no glyph CDN to
 * point at. The font is Faculty Glyphic under the SIL Open Font License, the same face the legacy
 * map letters with, so the new map keeps the typography people know.
 *
 * The rasterising happens in a real browser: TinySDF draws through the browser's own text engine,
 * which is the same engine that produced the reference rendering, and it avoids a native toolchain
 * (fontnik, FreeType) that would have to be built on every machine. The browser only produces
 * bitmaps and metrics; the protobuf is written here.
 *
 * The metric conversion follows MapLibre's own glyph manager: server glyphs place `top` relative to
 * an origin above the em box while TinySDF measures from the baseline, and MapLibre calibrates that
 * difference with a fixed adjustment. Using the same numbers here is what makes our glyphs line up
 * the way MapLibre expects.
 *
 * Usage: node scripts/dev/build-glyphs.mjs
 */
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { PbfWriter } = require("pbf");
const { chromium } = require("@playwright/test");
const fontkit = require("fontkit");

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const fontFile = join(repositoryRoot, "assets", "fonts", "FacultyGlyphic-Regular.ttf");
const outputRoot = join(repositoryRoot, "apps", "web", "public", "glyphs");

/**
 * The stacks the style asks for. MapLibre requests `{fontstack}/{range}.pbf`.
 *
 * 🔴 ZWEI STACKS AUS EINER SCHRIFTDATEI. Legacy zeichnet Ruinennamen kursiv
 * (`.location-name-label--ruined span { font-style: italic }`) und registriert dafür **keinen
 * zweiten Schnitt**: `css/base/fonts.css` kennt nur `FacultyGlyphic-Regular.woff2`. Die Neigung
 * erzeugt der Browser synthetisch, aus demselben Regular. Sein Canvas-Renderer setzt dafür
 * buchstäblich `font = "italic 400 14px Faculty Glyphic"` (`renderMapLabelToImage`).
 *
 * MapLibre kennt kein `font-style`, es kennt nur Stacknamen. Die technische Entsprechung ist
 * deshalb ein zweiter Stack, der GENAUSO entsteht: dieselbe Datei, derselbe Browser, derselbe
 * Schnitt - nur mit `fontStyle: "italic"` an TinySDF. Die Neigung ist damit nicht gewählt, sondern
 * dieselbe, die Legacy zeichnet; kalibriert wird sie durch die Bauweise, nicht durch eine Zahl.
 *
 * ⭐ Keine zweite Schriftdatei, keine zweite Lizenz, keine Laufzeitabhängigkeit.
 *
 * 🪤 Gemessen am 2026-09-22 in Chrome 152 gegen die laufende Legacy-Karte: die Neigung entspricht
 * tan ≈ 0,256 (≈ 14,4°), und der VORSCHUB ändert sich dabei **nicht** - `measureText` liefert für
 * dieselbe Zeile in beiden Schnitten exakt dieselbe Breite. Nur der Tintenkasten wird breiter. Die
 * Vorschubtafel des kursiven Stacks wird trotzdem eigens erzeugt, statt die des Regular zu erben:
 * eine gemessene Gleichheit ist etwas anderes als eine erzwungene.
 */
const FONT_STACKS = [
    { name: "Faculty Glyphic Regular", fontStyle: "normal" },
    { name: "Faculty Glyphic Italic", fontStyle: "italic" },
];

/** MapLibre asks for glyphs in blocks of 256 code points. */
const RANGE_SIZE = 256;

/** The blocks a German fantasy map needs: Latin-1, Latin Extended-A and general punctuation. */
const RANGES = [0, 256, 8192];

/** Server glyph convention, and TinySDF's defaults: 24px em, 3px buffer, 8px falloff. */
const SDF = { fontSize: 24, buffer: 3, radius: 8, cutoff: 0.25 };

/**
 * TinySDF measures `top` from the alphabetic baseline, server glyphs from an origin above the em
 * box. MapLibre bridges the two with these constants; we generate server glyphs, so we apply them
 * in the same direction MapLibre expects to find them.
 */
const TOP_ADJUSTMENT = 27.5;
const LEFT_ADJUSTMENT = 0.5;

function writeGlyph(glyph, pbf) {
    pbf.writeVarintField(1, glyph.id);
    pbf.writeBytesField(2, glyph.bitmap);
    pbf.writeVarintField(3, glyph.width);
    pbf.writeVarintField(4, glyph.height);
    pbf.writeSVarintField(5, glyph.left);
    pbf.writeSVarintField(6, glyph.top);
    pbf.writeVarintField(7, glyph.advance);
}

function writeFontstack(stack, pbf) {
    pbf.writeStringField(1, stack.name);
    pbf.writeStringField(2, stack.range);
    for (const glyph of stack.glyphs) {
        pbf.writeMessage(3, writeGlyph, glyph);
    }
}

function encodeRange(name, range, glyphs) {
    const pbf = new PbfWriter();
    pbf.writeMessage(1, writeFontstack, { name, range, glyphs });
    return Buffer.from(pbf.finish());
}

async function main() {
    const fontBytes = await readFile(fontFile);
    const font = fontkit.create(fontBytes);

    // Only code points the font actually carries. Drawing an uncovered one would silently fall back
    // to whatever the browser has and ship a foreign letter under our font name.
    const covered = new Set(font.characterSet);

    const browser = await chromium.launch();
    const page = await browser.newPage();
    // TinySDF is an ES module with a default export; injected as a module script it has no global,
    // so the binding is published explicitly.
    const tinySdfSource = await readFile(require.resolve("@mapbox/tiny-sdf"), "utf8");
    await page.addScriptTag({
        content: `${tinySdfSource}
globalThis.TinySDF = TinySDF;`,
        type: "module",
    });
    await page.waitForFunction(() => typeof globalThis.TinySDF === "function");
    await page.evaluate(
        async ({ base64 }) => {
            const binary = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
            const face = new FontFace("GlyphSource", binary.buffer);
            await face.load();
            document.fonts.add(face);
            await document.fonts.ready;
        },
        { base64: fontBytes.toString("base64") },
    );

    await mkdir(outputRoot, { recursive: true });

    for (const stack of FONT_STACKS) {
        // Ein eigener Zeichner je Schnitt. TinySDF baut seine `ctx.font`-Zeile aus fontStyle,
        // fontWeight, fontSize und fontFamily - dieselbe Kurzschreibweise, die Legacys Canvas setzt.
        await page.evaluate(
            ({ options, fontStyle }) => {
                globalThis.__sdf = new globalThis.TinySDF({ ...options, fontFamily: "GlyphSource", fontStyle });
            },
            { options: SDF, fontStyle: stack.fontStyle },
        );

        const stackDirectory = join(outputRoot, stack.name);
        await rm(stackDirectory, { recursive: true, force: true });
        await mkdir(stackDirectory, { recursive: true });

        let total = 0;
        for (const start of RANGES) {
            const end = start + RANGE_SIZE - 1;
            const codePoints = [];
            for (let code = start; code <= end; code += 1) {
                if (covered.has(code)) {
                    codePoints.push(code);
                }
            }
            if (codePoints.length === 0) {
                continue;
            }

            const drawn = await page.evaluate(
                ({ points, topAdjustment, leftAdjustment }) =>
                    points.map((code) => {
                        const character = String.fromCodePoint(code);
                        const glyph = globalThis.__sdf.draw(character);
                        return {
                            id: code,
                            bitmap: Array.from(glyph.data),
                            width: glyph.glyphWidth,
                            height: glyph.glyphHeight,
                            left: Math.round(glyph.glyphLeft + leftAdjustment),
                            top: Math.round(glyph.glyphTop - topAdjustment),
                            advance: Math.round(glyph.glyphAdvance),
                        };
                    }),
                { points: codePoints, topAdjustment: TOP_ADJUSTMENT, leftAdjustment: LEFT_ADJUSTMENT },
            );

            const glyphs = drawn.map((glyph) => ({ ...glyph, bitmap: Buffer.from(glyph.bitmap) }));
            const range = `${start}-${end}`;
            const encoded = encodeRange(stack.name, range, glyphs);
            await writeFile(join(stackDirectory, `${range}.pbf`), encoded);
            total += glyphs.length;
            console.log(`${stack.name} ${range}: ${glyphs.length} glyphs, ${encoded.length} bytes`);
        }
        console.log(`${total} glyphs written to ${stackDirectory}`);
    }

    await browser.close();
}

await main();
