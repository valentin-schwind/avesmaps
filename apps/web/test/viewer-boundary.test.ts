import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * M9 (Hardening Review 2026-09-28): `bootstrapViewer()` (`apps/web/src/viewer/bootstrap-viewer.ts`)
 * ist die EINZIGE Stelle, die `?besucher` liest. Jeder andere Aufrufer fragt stattdessen eine
 * Capability über den verteilten `ViewerContext` (`@avesmaps3d/shared`). Dieser Test sichert das
 * mechanisch über beide Quellbäume ab, in denen die Frage überhaupt auftauchen könnte.
 *
 * `planner-link.ts` ist ausdrücklich erlaubt: es reicht `besucher` nur als einen der Adressparameter
 * durch, die beim Schreiben eines Reiselinks unangetastet bleiben (ein Name in einer Liste), es LIEST
 * den Parameter nicht.
 *
 * 🔴 Gemessen wird der ZUGRIFF, nicht das Wort (WI-0138): Die Besucherstatistik trägt „besucher“ als Kennung
 * ihrer Sorte im Navigationsregister („Status › Besucher“), in der Sprachtafel und in ihrem Bauteil, fragt aber
 * nie die Adresse. Eine Wortsuche hätte deshalb die halbe Anwendung auf die Ausnahmeliste gezwungen und den
 * Wächter stumpf gemacht. Beanstandet wird, wer den Parameter liest: `has("besucher")`, `get("besucher")`
 * oder `?besucher` in einer Adresse.
 */

const WEB_SRC = resolve(import.meta.dirname, "..", "src");
const SHARED_SRC = resolve(import.meta.dirname, "..", "..", "..", "packages", "shared", "src");
const ALLOWED = new Set([
    resolve(WEB_SRC, "viewer", "bootstrap-viewer.ts"),
    resolve(WEB_SRC, "route-planner", "planner-link.ts"),
]);

/** Wer den Adressparameter liest: `has`/`get` darauf oder die Adresse selbst. */
const LIEST_PARAMETER = /\.(?:has|get|getAll)\(\s*["'`]besucher["'`]|[?&]besucher\b/;

function sourceFiles(root: string): string[] {
    return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
        const path = resolve(root, entry.name);
        if (entry.isDirectory()) return sourceFiles(path);
        return entry.name.endsWith(".ts") || entry.name.endsWith(".vue") ? [path] : [];
    });
}

describe("nur bootstrapViewer() kennt '?besucher'", () => {
    it("kein anderer Aufrufer in apps/web/src oder packages/shared/src liest 'besucher'", () => {
        const readers = [...sourceFiles(WEB_SRC), ...sourceFiles(SHARED_SRC)].filter((file) =>
            LIEST_PARAMETER.test(readFileSync(file, "utf8")),
        );
        const unexpected = readers.filter((file) => !ALLOWED.has(file));
        expect(unexpected, unexpected.join(", ")).toEqual([]);
    });
});
