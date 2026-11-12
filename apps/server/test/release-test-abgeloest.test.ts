import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

/**
 * Der Start des Release-Tests überlebt den Server (WI-0248 L, Fehlerbehebung 2026-10-23). Der Server läuft lokal unter `node --watch` und wird
 * hart neu gestartet, sobald eine beobachtete Datei ein Ereignis meldet; ein Starter, der als gewöhnliches Kind des Servers lief, starb dabei
 * mit und hinterließ nichts. Die Sätze, auf die es ankommt:
 * 1. **Der abgelöste Starter läuft weiter, wenn der Server hart endet.** Ein echter Ersatz-Prozess startet einen Ersatz-Starter über denselben Code
 *    wie der Dienst (\`starteAbgeloest\`) und wird dann beendet. Nie ein echter Release-Lauf.
 * 2. **Die Kontrolle (Windows): ein nicht abgelöstes Kind stirbt mit.** Ohne sie bewiese der erste Satz nichts.
 * 3. **Der Server importiert nichts aus \`scripts/\`.** Ein Import aus den Werkzeugen hinge deren Dateien in den Modulgraphen und damit an
 *    \`node --watch\`; der Starter ist ein eigener Prozess.
 */

const eltern = fileURLToPath(new URL("./support/release-test-eltern.mjs", import.meta.url));
const ordnerListe: string[] = [];

afterEach(() => {
    for (const ordner of ordnerListe.splice(0)) rmSync(ordner, { recursive: true, force: true, maxRetries: 5 });
});

function ersatzServer(modus: "abgeloest" | "gebunden"): {
    ordner: string;
    status: number | null;
    signal: string | null;
} {
    const ordner = mkdtempSync(join(tmpdir(), "avm-release-abgeloest-"));
    ordnerListe.push(ordner);
    const lauf = spawnSync(process.execPath, [eltern, ordner, modus], { timeout: 60_000, windowsHide: true });
    return { ordner, status: lauf.status, signal: lauf.signal };
}
const warteBis = async (bedingung: () => boolean, ms = 20_000): Promise<boolean> => {
    for (let i = 0; i < ms / 50 && !bedingung(); i += 1) await new Promise((ok) => setTimeout(ok, 50));
    return bedingung();
};

describe("Der Start überlebt den Server", () => {
    it("🔴 der abgelöste Starter läuft weiter und beendet seine Arbeit, auch wenn der Server hart endet", async () => {
        const { ordner, status, signal } = ersatzServer("abgeloest");
        // Der Ersatz-Server ist nicht regulär zu Ende gegangen (Windows: Exit 1 nach TerminateProcess, sonst Signal).
        expect(status === 0 && signal === null).toBe(false);
        // Er endete, als der Starter noch arbeitete (der braucht 2,5 s).
        expect(existsSync(join(ordner, "gestartet.txt"))).toBe(true);
        expect(await warteBis(() => existsSync(join(ordner, "fertig.txt")))).toBe(true);
        const fertig = JSON.parse(readFileSync(join(ordner, "fertig.txt"), "utf8")) as { pid: number; ppid: number };
        expect(fertig.pid).toBe(Number(readFileSync(join(ordner, "gestartet.txt"), "utf8")));
        // Seine Ausgabe liegt in der Datei, nicht in einer Röhre zum toten Server.
        expect(
            await warteBis(
                () => existsSync(join(ordner, "ausgabe.log")) && statSync(join(ordner, "ausgabe.log")).size > 0,
            ),
        ).toBe(true);
        expect(readFileSync(join(ordner, "ausgabe.log"), "utf8")).toContain('"status":"gestartet"');
    }, 60_000);

    it.runIf(process.platform === "win32")(
        "Kontrolle: ein gewöhnliches Kind (wie vorher) stirbt unter Windows mit dem Server und lässt nichts zurück",
        async () => {
            const { ordner } = ersatzServer("gebunden");
            expect(existsSync(join(ordner, "gestartet.txt"))).toBe(true);
            // Länger als der Starter braucht (2,5 s): Lebte er, stünde die Datei längst da.
            await new Promise((ok) => setTimeout(ok, 4_500));
            expect(existsSync(join(ordner, "fertig.txt"))).toBe(false);
        },
        60_000,
    );
});

describe("Der Server importiert nichts aus scripts/", () => {
    const quellen = fileURLToPath(new URL("../src", import.meta.url));
    const skripte = join(resolve(quellen, "..", "..", ".."), "scripts");
    const dateien = (ordner: string): string[] =>
        readdirSync(ordner, { withFileTypes: true }).flatMap((eintrag) =>
            eintrag.isDirectory()
                ? dateien(join(ordner, eintrag.name))
                : eintrag.name.endsWith(".ts") || eintrag.name.endsWith(".mjs")
                  ? [join(ordner, eintrag.name)]
                  : [],
        );
    /** Alle Modulangaben einer Datei: \`from "x"\`, \`import "x"\`, \`import("x")\`, \`require("x")\`. */
    const angaben = (text: string): string[] =>
        [...text.matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)["']([^"'\n]+)["']/gu)].map(
            (m) => m[1] ?? "",
        );

    it("die Suche erkennt die Formen eines Imports", () => {
        expect(
            angaben(
                [
                    'import { a } from "../../scripts/dev/x.ts";',
                    'import "../../scripts/dev/y.ts";',
                    'const z = await import("../../scripts/dev/z.ts");',
                    'const w = require("../../scripts/dev/w.cjs");',
                    "export * from '../../scripts/dev/v.ts';",
                ].join("\n"),
            ),
        ).toEqual([
            "../../scripts/dev/x.ts",
            "../../scripts/dev/y.ts",
            "../../scripts/dev/z.ts",
            "../../scripts/dev/w.cjs",
            "../../scripts/dev/v.ts",
        ]);
    });

    it("🔴 keine Datei unter apps/server/src nennt einen Pfad unter scripts/ als Modul", () => {
        expect(existsSync(skripte)).toBe(true);
        const alle = dateien(quellen);
        // Die Suche sieht den ganzen Quellbaum und nicht nichts.
        expect(alle.length).toBeGreaterThan(100);
        const verstoesse: string[] = [];
        for (const datei of alle) {
            for (const angabe of angaben(readFileSync(datei, "utf8"))) {
                if (!angabe.startsWith(".")) continue;
                const ziel = resolve(dirname(datei), angabe);
                if (ziel === skripte || ziel.startsWith(skripte + sep)) verstoesse.push(`${datei} -> ${angabe}`);
            }
        }
        expect(verstoesse).toEqual([]);
    });
});
