import { posix } from "node:path";
import type { TestDatei } from "./pruef-auswahl.ts";

/** Conservative reverse import graph; dynamic file reads remain covered by the path rules. */
export function abhaengigeTests(geaendert: readonly string[], quellen: readonly TestDatei[]): string[] {
    const bekannt = new Set([...quellen.map((q) => q.pfad), ...geaendert]);
    const rueck = new Map<string, Set<string>>();
    const sharedIndex = "packages/shared/src/index.ts";
    const barrel = quellen.find((q) => q.pfad === sharedIndex)?.text ?? "";
    const exporte = [...barrel.matchAll(/export\s+(?:type\s+)?(\{[^}]+\}|\*)\s+from\s*["']([^"']+)["']/g)];
    const kante = (ziel: string, leser: string): void => {
        const liste = rueck.get(ziel) ?? new Set<string>();
        liste.add(leser);
        rueck.set(ziel, liste);
    };
    for (const q of quellen) {
        // Shared is an export-only barrel. Resolve named exports at the consumer.
        if (q.pfad === sharedIndex) continue;
        for (const m of q.text.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)["']([^"']+)["']/g)) {
            const modul = m[1] ?? "";
            const basis = modul.startsWith(".")
                ? posix.normalize(posix.join(posix.dirname(q.pfad), modul))
                : modul === "@avesmaps3d/shared"
                  ? "packages/shared/src/index.ts"
                  : undefined;
            if (basis === undefined) continue;
            const ziel = [
                basis,
                `${basis}.ts`,
                `${basis}.vue`,
                `${basis}/index.ts`,
                basis.replace(/\.js$/, ".ts"),
            ].find((p) => bekannt.has(p));
            if (ziel === undefined) continue;
            kante(ziel, q.pfad);
            if (ziel === sharedIndex) {
                const prefix = q.text.slice(0, m.index);
                const clause = /(?:import|export)\s+(?:type\s+)?\{([^}]+)\}\s*$/.exec(prefix)?.[1];
                const namen = clause?.split(",").map(
                    (n) =>
                        n
                            .trim()
                            .replace(/^type\s+/, "")
                            .split(/\s+as\s+/)[0],
                );
                for (const e of exporte) {
                    const trifft =
                        namen === undefined ||
                        e[1] === "*" ||
                        namen.some((n) => n !== undefined && new RegExp(`\\b${n}\\b`).test(e[1] ?? ""));
                    if (trifft) kante(posix.normalize(posix.join("packages/shared/src", e[2] ?? "")), q.pfad);
                }
            }
        }
    }
    const betroffen = new Set(geaendert);
    for (const pfad of betroffen) for (const leser of rueck.get(pfad) ?? []) betroffen.add(leser);
    return [...betroffen].filter((p) => p.endsWith(".test.ts")).sort();
}

/** Cost estimate, not a test verdict. DB includes one cluster/migration setup, never one per file. */
export function auswahlKosten(ohneDb: number, db: number): { sekunden: number; gross: boolean } {
    const sekunden = 120 + ohneDb * 2.5 + (db > 0 ? 45 + db * 5 : 0);
    return { sekunden: Math.ceil(sekunden), gross: sekunden > 300 || ohneDb > 100 || db > 30 };
}
