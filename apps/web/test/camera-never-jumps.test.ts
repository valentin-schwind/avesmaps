import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Die Kamera springt nie (Betreiber 2026-09-29: „die kamera muss immer ans ziel ‚fliegen‘“; Design Guide §17).
 *
 * Ein Sprung ist jeder Kameraaufruf ohne Fahrt: `jumpTo`, eine Dauer von 0, `animate: false`, die `set…`-Aufrufe.
 * Der Wächter lässt sie in `apps/web/src` nur an Stellen zu, die
 * - in der Allowlist stehen (Datei und Ausnahme) **und**
 * - im Code mit `Kamera-Sprung erlaubt (<Ausnahme>): <Grund>` gekennzeichnet sind, in den zehn Zeilen davor.
 *
 * Wer einen Sprung braucht, fällt hier auf, bevor er in der Karte auffällt: Er trägt sich mit Grund ein oder
 * baut eine Fahrt (`camera.ts`: `showPoint`, `showBounds`, `showView`, `approach`).
 *
 * Die Ausnahmen des Betreibers:
 * - `follow`: das Folgen Bild für Bild im Playmode (kleine Schritte).
 * - `gesture`: direkte Gesten - die Hand ist die Kamera.
 * - `reduced-motion`: bei „Bewegung reduzieren“ ist der Sprung richtig.
 * - `first`: der allererste Blick beim Laden.
 *
 * Bis WI-0218 gab es dazu `padding`, die Anpassung des Innenabstands an die Panels. Seit der Fluchtpunkt in der Bildmitte bleibt,
 * setzt niemand mehr einen Innenabstand.
 */

type Exception = "follow" | "gesture" | "reduced-motion" | "first";

/** Wo welche Ausnahme vorkommen darf. Eine neue Datei ist eine bewusste Entscheidung, keine Nebenwirkung. */
const ALLOWED: Readonly<Record<string, readonly Exception[]>> = {
    // Das Folgen des Pfeils, Bild für Bild, und der Tastenschritt in der Folge bei reduzierter Bewegung. `gesture`: der Haken der Gesten
    // zieht MapLibres gewünschten Stand auf die gezeichnete Neigung nach (`neigungBeimZoom`, 2026-11-08); das bewegt nichts.
    "apps/web/src/map/camera/camera.ts": ["follow", "reduced-motion", "gesture"],
    // Die Mitte, um die die Neigung einer Zoomgeste kippt (2026-11-09): gerechnet an einer Kopie von MapLibres Transformation.
    "apps/web/src/map/camera/neigung-anker.ts": ["gesture"],
    // Drehen und Neigen mit Strg + Ziehen oder Mitteltaste: jede Mausbewegung ein Schritt.
    "apps/web/src/map/camera/pointer-controls.ts": ["gesture"],
    // Der erste Blick rückt in die freie Fläche (`settle`).
    "apps/web/src/map/camera/visible-area.ts": ["first"],
};

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const sourceRoot = join(repositoryRoot, "apps/web/src");

/** Was ein Sprung ist. Ein Methodenaufruf hat den Punkt davor: eine Funktion `jumpTo(hit)` der Suche zählt nicht. */
const JUMPS: readonly { name: string; pattern: RegExp }[] = [
    { name: ".jumpTo(", pattern: /\.jumpTo\(/ },
    { name: "duration: 0", pattern: /\bduration:\s*0\b(?![.\w])/ },
    { name: "animate: false", pattern: /\banimate:\s*false\b/ },
    { name: ".setCenter(", pattern: /\.setCenter\(/ },
    { name: ".setZoom(", pattern: /\.setZoom\(/ },
    { name: ".setBearing(", pattern: /\.setBearing\(/ },
    { name: ".setPitch(", pattern: /\.setPitch\(/ },
    { name: ".setPadding(", pattern: /\.setPadding\(/ },
    { name: ".fitBounds(", pattern: /\.fitBounds\(/ },
];

const MARKER = /Kamera-Sprung erlaubt \((follow|gesture|reduced-motion|first)\):\s*\S/;
const LOOKBACK = 10;

/** Alle `.ts` und `.vue` unter `src`. Bei `.vue` zählt nur, was im `<script>` steht. */
function sourceFiles(directory: string): string[] {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) return sourceFiles(path);
        return /\.(ts|vue)$/.test(entry.name) ? [path] : [];
    });
}

function scriptOf(file: string, text: string): string {
    if (!file.endsWith(".vue")) return text;
    // Nur die Zeilen des Skripts; die Zeilennummern bleiben stehen, damit ein Fund auffindbar ist.
    const lines = text.split("\n");
    let inScript = false;
    return lines
        .map((line) => {
            if (/^<script\b/.test(line)) inScript = true;
            const keep = inScript ? line : "";
            if (/^<\/script>/.test(line)) inScript = false;
            return keep;
        })
        .join("\n");
}

interface Found {
    file: string;
    line: number;
    jump: string;
    exception: Exception | undefined;
}

/** Ein Kommentar allein erzeugt keinen Fund: Wer einen Sprung erklärt, muss ihn nennen dürfen. */
const codeOf = (line: string): string => line.replace(/\/\/.*$/, "").replace(/\/\*.*?\*\//g, "");

/** Eine Paint-Transition bewegt keine Kamera; echte Kameraoptionen daneben bleiben sichtbar. */
function jumpCodeOf(line: string): string {
    return codeOf(line).replace(/(["'])[-\w]+-transition\1\s*:\s*\{[^{}]*\}/g, "");
}

function findJumps(): Found[] {
    const found: Found[] = [];
    for (const path of sourceFiles(sourceRoot)) {
        const file = relative(repositoryRoot, path).replaceAll("\\", "/");
        const lines = scriptOf(file, readFileSync(path, "utf8")).split("\n");
        lines.forEach((line, index) => {
            const code = jumpCodeOf(line);
            for (const { name, pattern } of JUMPS) {
                if (!pattern.test(code)) continue;
                const before = lines.slice(Math.max(0, index - LOOKBACK), index + 1).join("\n");
                const marker = MARKER.exec(before.split("\n").reverse().join("\n"));
                found.push({ file, line: index + 1, jump: name, exception: marker?.[1] as Exception | undefined });
            }
        });
    }
    return found;
}

describe("🔴 die Kamera springt nie (Design Guide §17)", () => {
    const found = findJumps();

    it("jeder Sprung steht an einer erlaubten Stelle, mit Ausnahme und Grund im Code", () => {
        const unerlaubt = found.filter(
            ({ file, exception }) => exception === undefined || !(ALLOWED[file] ?? []).includes(exception),
        );
        expect(
            unerlaubt.map(({ file, line, jump, exception }) =>
                exception === undefined
                    ? `${file}:${String(line)} ${jump} ohne „Kamera-Sprung erlaubt (…): Grund“`
                    : `${file}:${String(line)} ${jump} mit Ausnahme „${exception}“, die dort nicht erlaubt ist`,
            ),
        ).toEqual([]);
    });

    it("der Wächter sieht die bekannten Stellen (sonst prüfte er nichts)", () => {
        const byFile = new Map<string, number>();
        for (const { file } of found) byFile.set(file, (byFile.get(file) ?? 0) + 1);
        expect([...byFile.keys()].sort()).toEqual(Object.keys(ALLOWED).sort());
    });

    it("die Allowlist hat keine Ausnahme, die nirgends gebraucht wird", () => {
        const used = new Set(found.map(({ file, exception }) => `${file}:${String(exception)}`));
        const unused = Object.entries(ALLOWED).flatMap(([file, exceptions]) =>
            exceptions
                .filter((exception) => !used.has(`${file}:${exception}`))
                .map((exception) => `${file}: ${exception}`),
        );
        expect(unused).toEqual([]);
    });

    describe("erkennt, was ein Sprung ist", () => {
        const sees = (code: string): string[] =>
            JUMPS.filter(({ pattern }) => pattern.test(jumpCodeOf(code))).map(({ name }) => name);

        it("Methodenaufrufe, Dauer 0 und ausgeschaltete Animation", () => {
            expect(sees("map.jumpTo({ center });")).toEqual([".jumpTo("]);
            expect(sees("map.flyTo({ center, duration: 0 });")).toEqual(["duration: 0"]);
            expect(sees("map.setCenter(c, { animate: false });").sort()).toEqual([".setCenter(", "animate: false"]);
            expect(sees("map.setZoom(4);")).toEqual([".setZoom("]);
            expect(sees("map.fitBounds(b);")).toEqual([".fitBounds("]);
        });

        it("eine Kontur-Transition ist kein Kamerasprung, ein Kameraaufruf daneben bleibt einer", () => {
            expect(sees('"line-opacity-transition": { duration: 0, delay: 0 },')).toEqual([]);
            expect(sees('"line-opacity-transition": { duration: 0 }, map.flyTo({ duration: 0 })')).toEqual([
                "duration: 0",
            ]);
        });

        it("eine eigene Funktion `jumpTo(hit)`, ein Kommentar und CSS-Zeiten sind keiner", () => {
            expect(sees("function jumpTo(hit: SearchHit): void {")).toEqual([]);
            expect(sees("    jumpTo({ kind: 'landschaft' });")).toEqual([]);
            expect(sees("// map.jumpTo(options) beendet jede Fahrt")).toEqual([]);
            expect(sees("transition-duration: 0ms;")).toEqual([]);
            expect(sees("duration: 0.75,")).toEqual([]);
            expect(sees("map.setCenterClampedToGround(true);")).toEqual([]);
        });
    });
});
