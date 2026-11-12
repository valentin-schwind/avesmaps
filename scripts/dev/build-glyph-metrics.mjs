/**
 * Erzeugt die Glyphen-Vorschubtafel aus den ausgelieferten Glyphendateien.
 *
 * Die Ableitung der Schriftläufe und der Kachelzuschnitt müssen wissen, wie breit ein Name bei
 * einer Schriftgröße tatsächlich wird (WI-0004, Invariante I2). Eine geschätzte mittlere
 * Zeichenbreite reicht dafür nicht: sie ist bei „Ödenmoor" und bei „Westlicher Hangwald des
 * Raschtulswalls" verschieden falsch, und die Zusicherung „der Lauf ist länger als sein Name" wäre
 * keine.
 *
 * 💣 Gelesen wird aus den `.pbf`-Dateien, nicht aus der Schriftdatei. Das ist derselbe Vorschub,
 * den MapLibre beim Zeichnen benutzt - es liest dieselben Dateien. Eine zweite Messung aus der
 * Schrift könnte davon abweichen (Rundung, Hinting, der Umweg über TinySDF), und dann wäre die
 * Tafel plausibel und trotzdem falsch.
 *
 * Nach jedem Lauf von build-glyphs.mjs erneut ausführen.
 *
 * Usage: node scripts/dev/build-glyph-metrics.mjs
 */
import { createRequire } from "node:module";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { PbfReader } = require("pbf");

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const outputDirectory = join(repositoryRoot, "config", "glyph-metrics");

/**
 * Beide Stacks, die `build-glyphs.mjs` erzeugt.
 *
 * 🪤 Der kursive bekommt eine EIGENE Tafel, obwohl seine Vorschubwerte gemessen dieselben sind: die
 * synthetische Neigung schert die Glyphe, sie verschiebt den Vorschub nicht. Die Tafel des Regular
 * mitzubenutzen waere trotzdem falsch - dann waere aus einer gemessenen Gleichheit eine erzwungene
 * geworden, und ein spaeterer Schriftwechsel koennte sie still brechen.
 */
const FONT_STACKS = [
    { name: "Faculty Glyphic Regular", file: "faculty-glyphic-regular.json" },
    { name: "Faculty Glyphic Italic", file: "faculty-glyphic-italic.json" },
];

/** Die Em-Größe, in der Servierglyphen ihre Metrik führen. MapLibres ONE_EM. */
const UNITS_PER_EM = 24;

function readGlyph(tag, glyph, pbf) {
    if (tag === 1) {
        glyph.id = pbf.readVarint();
    } else if (tag === 7) {
        glyph.advance = pbf.readVarint();
    } else {
        pbf.skip(pbf.type);
    }
}

function readFontstack(tag, stack, pbf) {
    if (tag === 3) {
        const glyph = {};
        pbf.readMessage(readGlyph, glyph);
        if (glyph.id !== undefined && glyph.advance !== undefined) {
            stack.glyphs.push(glyph);
        }
    } else {
        pbf.skip(pbf.type);
    }
}

function readGlyphs(tag, stack, pbf) {
    if (tag === 1) {
        pbf.readMessage(readFontstack, stack);
    } else {
        pbf.skip(pbf.type);
    }
}

async function buildStack(stack) {
    const glyphRoot = join(repositoryRoot, "apps", "web", "public", "glyphs", stack.name);
    const files = (await readdir(glyphRoot)).filter((name) => name.endsWith(".pbf")).sort();
    if (files.length === 0) {
        console.error(`keine Glyphendateien unter ${glyphRoot}; zuerst build-glyphs.mjs ausfuehren`);
        process.exit(1);
    }

    const advances = {};
    for (const file of files) {
        const stack = { glyphs: [] };
        new PbfReader(await readFile(join(glyphRoot, file))).readFields(readGlyphs, stack);
        for (const glyph of stack.glyphs) {
            advances[glyph.id] = glyph.advance;
        }
    }

    const codePoints = Object.keys(advances)
        .map(Number)
        .sort((a, b) => a - b);
    const sorted = {};
    for (const code of codePoints) {
        sorted[code] = advances[code];
    }

    // Was ein nicht abgedeckter Buchstabe kostet. MapLibre laesst ihn weg; wer ihn beim Rechnen mit
    // null ansetzt, unterschaetzt die Breite. Der breiteste Vorschub ist die sichere Annahme.
    const fallbackAdvance = Math.max(...Object.values(sorted));

    const model = {
        schemaVersion: 1,
        fontStack: stack.name,
        unitsPerEm: UNITS_PER_EM,
        generatedFrom: `apps/web/public/glyphs/${stack.name}/*.pbf`,
        fallbackAdvance,
        advances: sorted,
    };

    const outputFile = join(outputDirectory, stack.file);
    await mkdir(outputDirectory, { recursive: true });
    await writeFile(outputFile, `${JSON.stringify(model, null, 4)}\n`);
    console.log(`${stack.name}: ${codePoints.length} Vorschubwerte aus ${files.length} Dateien -> ${outputFile}`);
    console.log(`  breitester Vorschub (Rueckfall): ${fallbackAdvance}/${UNITS_PER_EM} em`);
    return sorted;
}

async function main() {
    const tables = [];
    for (const stack of FONT_STACKS) {
        tables.push(await buildStack(stack));
    }

    // 🔴 Die Gegenprobe, die die Behauptung traegt: schert die synthetische Neigung den Vorschub?
    // Gemessen, nicht angenommen - und als Zeile im Lauf, damit ein spaeterer Schriftwechsel sie
    // sichtbar umwirft, statt sie still ungueltig zu machen.
    const [regular, italic] = tables;
    const abweichend = Object.keys(regular).filter((code) => regular[code] !== italic[code]);
    console.log(
        abweichend.length === 0
            ? "Vorschub: kursiv = regulaer fuer alle Zeichen (die Neigung schert, sie verschiebt nicht)"
            : `Vorschub: ${abweichend.length} Zeichen weichen ab (${abweichend.slice(0, 12).join(", ")})`,
    );
}

await main();
