import { describe, expect, it } from "vitest";
import { SMOOTH_NET_OPTIONS, smoothNet, type NetArea } from "../src/index.ts";

/**
 * Die Rundung der Flächen als gemeinsame Rechnung (WI-0178 Paket L2; T27 (6) „beim Ziehen die fertige Rundung live“): Sie liegt in
 * `packages/shared`, damit Browser und Server Punkt für Punkt dasselbe rechnen. Die ausführlichen Fälle mit WKB und PostGIS stehen
 * beim Server (`apps/server/test/smooth-net.test.ts`, `land-smooth.test.ts`). Hier nur, was L2 zusichert: über den Einstieg von
 * `shared` erreichbar, ohne Node, mit dem Rezept der Karte, und zwei Nachbarinnen teilen ihre gerundete Grenze genau.
 */
const ring = (punkte: [number, number][]): Float64Array => Float64Array.from([...punkte, punkte[0]!].flat());
const flaeche = (id: number, punkte: [number, number][]): NetArea => ({
    id,
    layer: "topographie",
    polygons: [[ring(punkte)]],
});

/** Die Punkte eines Rings als „x y“, ohne Schlusspunkt. */
function punkte(coords: Float64Array): Set<string> {
    const aus = new Set<string>();
    for (let q = 0; q + 2 < coords.length; q += 2) aus.add(`${String(coords[q])} ${String(coords[q + 1])}`);
    return aus;
}

describe("Rundung der Flächen in shared (WI-0178 L2)", () => {
    it("🔴 das Rezept der Karte: Toleranz, drei Chaikin-Durchgänge, halber Bildpunkt bei Zoom 8", () => {
        expect(SMOOTH_NET_OPTIONS).toEqual({ tolerance: 0.001, passes: 3, resolution: 0.004 });
        expect(Object.isFrozen(SMOOTH_NET_OPTIONS)).toBe(true);
    });

    it("🔴 zwei Nachbarinnen: gerundet, und ihre gemeinsame Grenze ist in beiden dieselbe Linie (kein Spalt, keine Überlappung)", () => {
        // Becken und Vorgebirge wie im Blatt: eine gemeinsame Grenze mit einem Knick bei (412, 405).
        const becken = flaeche(1, [
            [400, 400],
            [410, 400],
            [412, 405],
            [410, 410],
            [400, 410],
        ]);
        const vorgebirge = flaeche(2, [
            [410, 400],
            [420, 400],
            [420, 410],
            [410, 410],
            [412, 405],
        ]);
        const ergebnis = smoothNet([becken, vorgebirge], SMOOTH_NET_OPTIONS);
        const a = punkte(ergebnis.shapes.get(1)![0]![0]!);
        const b = punkte(ergebnis.shapes.get(2)![0]![0]!);
        // Gerundet: mehr Punkte als die fünf Ecken.
        expect(a.size).toBeGreaterThan(5);
        // Die Kette der Grenze liegt in beiden: Die Punkte zwischen den festen Enden (410, 400) und (410, 410) sind gemeinsam.
        const gemeinsam = [...a].filter((p) => b.has(p));
        expect(gemeinsam).toContain("410 400");
        expect(gemeinsam).toContain("410 410");
        expect(gemeinsam.length).toBeGreaterThan(2);
        // Wo die Eigentümer wechseln, bleibt die Ecke fest (Ketten enden dort).
        expect(a.has("400 400")).toBe(false); // eine Ecke nur des Beckens wird gerundet
    });
});
