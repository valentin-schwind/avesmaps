import { describe, expect, it, vi } from "vitest";
import type { Map as MapLibreMap } from "maplibre-gl";
import { installKachelWiederholung, WIEDERHOLUNG_MS } from "../src/map/kachel-wiederholung";

/**
 * Kacheln nach einem 503 noch einmal fragen (Thomas 4.2, Claudio 2026-10-19: die Anmeldetür fällt bei jedem Rollout 2 bis 4 s aus).
 * Problemfälle: Eine Kachel bleibt nach einem 503 leer; eine Kachel wird ohne Ende gefragt; ein 404 (keine Kachel) wird wiederholt;
 * nach dem Abhängen feuert noch ein Versuch.
 */

function aufbau() {
    const hoerer = new Map<string, (e: unknown) => void>();
    const refreshTiles = vi.fn();
    const map = {
        on: (art: string, f: (e: unknown) => void) => hoerer.set(art, f),
        off: (art: string) => hoerer.delete(art),
        getSource: () => ({}),
        refreshTiles,
    } as unknown as MapLibreMap;
    const geplant: { f: () => void; ms: number; handle: number }[] = [];
    const geloescht: unknown[] = [];
    const ab = installKachelWiederholung(map, {
        setTimeout: (f, ms) => {
            const handle = geplant.length + 1;
            geplant.push({ f, ms, handle });
            return handle;
        },
        clearTimeout: (handle) => geloescht.push(handle),
        zufall: () => 0,
    });
    const kachel = { tileID: { canonical: { x: 3, y: 5, z: 7 } } };
    const fehler = (status: number) => hoerer.get("error")?.({ error: { status }, sourceId: "regions", tile: kachel });
    const geladen = () => hoerer.get("data")?.({ dataType: "source", sourceId: "regions", tile: kachel });
    return { ab, fehler, geladen, geplant, geloescht, refreshTiles, hoerer };
}

describe("Kacheln nach 503", () => {
    it("🔴 fragt genau diese Kachel nach den Wartezeiten noch einmal, höchstens dreimal", () => {
        const t = aufbau();
        for (let i = 0; i < 5; i++) t.fehler(503);
        expect(t.geplant.map((g) => g.ms)).toEqual([...WIEDERHOLUNG_MS]);
        t.geplant[0]!.f();
        expect(t.refreshTiles).toHaveBeenCalledWith("regions", [{ x: 3, y: 5, z: 7 }]);
    });

    it("🔴 404 und andere Fehler bleiben, wie sie sind", () => {
        const t = aufbau();
        t.fehler(404);
        t.fehler(500);
        expect(t.geplant).toHaveLength(0);
    });

    it("eine geladene Kachel zählt beim nächsten Ausfall von vorn; abgehängt feuert nichts mehr", () => {
        const t = aufbau();
        t.fehler(503);
        t.fehler(503);
        t.geladen();
        t.fehler(503);
        expect(t.geplant.map((g) => g.ms)).toEqual([WIEDERHOLUNG_MS[0], WIEDERHOLUNG_MS[1], WIEDERHOLUNG_MS[0]]);
        t.ab();
        expect(t.geloescht).toEqual([1, 2, 3]);
        expect(t.hoerer.size).toBe(0);
    });
});
