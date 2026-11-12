import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/feedback/toast", () => ({ showToast: vi.fn() }));

import { showToast } from "../src/feedback/toast";
import { belegeGeometrie, geometrieBelegt, geometrieModus, meldeGeometrieAn } from "../src/map/geometrie/besitzer";
import type { InteractionOwner, MapInteractionCoordinator } from "../src/map/interaction/types";
import { createNeuerWeg } from "../src/wegeditor/neuer-weg";

/**
 * Ein Modus zur Zeit im Geometrie-Modul (Editor-Orchestrierung 2026-10-17; `map/geometrie/besitzer.ts`). Problemfälle: Ein zweiter
 * Start wirft, weil der Koordinator die Kennung `geometry-edit` zweimal bekommt; der zweite Start beendet den laufenden still; nach
 * dem Ende bleibt das Modul belegt; der Nachlauf eines beendeten Modus blockiert den nächsten.
 */

/** Ein Koordinator, der wie der echte eine Kennung nur einmal annimmt. */
function koordinator(): MapInteractionCoordinator & { angemeldet: string[] } {
    const angemeldet: string[] = [];
    return {
        angemeldet,
        register(owner: InteractionOwner) {
            if (angemeldet.includes(owner.id)) throw new Error(`Besitzer ${owner.id} ist schon angemeldet`);
            angemeldet.push(owner.id);
            return () => angemeldet.splice(angemeldet.indexOf(owner.id), 1);
        },
    } as unknown as MapInteractionCoordinator & { angemeldet: string[] };
}

const besitzer = {
    id: "geometry-edit",
    priority: 91,
    kinds: [],
    layers: () => [],
    hit: () => undefined,
    apply: () => undefined,
};

describe("Ein Modus zur Zeit (Geometrie-Modul)", () => {
    afterEach(() => vi.mocked(showToast).mockClear());

    it("🔴 ein zweiter Start wird abgewiesen, mit Hinweis; der erste bleibt; nach dem Ende ist das Modul frei", () => {
        const erster = belegeGeometrie();
        expect(erster).toBeDefined();
        expect(geometrieBelegt()).toBe(true);
        expect(belegeGeometrie()).toBeUndefined();
        expect(showToast).toHaveBeenCalledWith("Erst den laufenden Bearbeiten-Modus beenden.", "warning");
        expect(geometrieBelegt()).toBe(true);
        erster!.frei();
        expect(geometrieBelegt()).toBe(false);
        const zweiter = belegeGeometrie();
        expect(zweiter).toBeDefined();
        // Ein altes `frei` gibt nicht den Nachfolger frei.
        erster!.frei();
        expect(geometrieBelegt()).toBe(true);
        zweiter!.frei();
    });

    it("🔴 Liste beim Modus: die Belegung nennt das Werkzeug des Modus, bis er endet; ein abgewiesener Start ändert es nicht", () => {
        const wegkurve = belegeGeometrie("wegeditor");
        expect(geometrieModus.value).toEqual({ werkzeug: "wegeditor" });
        expect(belegeGeometrie("ortseditor")).toBeUndefined();
        expect(geometrieModus.value).toEqual({ werkzeug: "wegeditor" });
        wegkurve!.frei();
        expect(geometrieModus.value).toBeUndefined();
        // Anlegen nennt kein Werkzeug: Es kommt aus keinem Fenster mit Liste.
        const anlegen = belegeGeometrie();
        expect(geometrieModus.value).toEqual({ werkzeug: undefined });
        anlegen!.frei();
    });

    it("🔴 der Nachlauf eines beendeten Modus endet, wenn der nächste sich anmeldet; nichts wirft", () => {
        vi.useFakeTimers();
        const k = koordinator();
        const alt = meldeGeometrieAn(k, besitzer);
        alt.nachlaufen(400);
        expect(k.angemeldet).toEqual(["geometry-edit"]);
        const neu = meldeGeometrieAn(k, besitzer);
        expect(k.angemeldet).toEqual(["geometry-edit"]);
        neu.ab();
        expect(k.angemeldet).toEqual([]);
        // Der Zeitgeber des alten Nachlaufs meldet den neuen nicht ab.
        const dritter = meldeGeometrieAn(k, besitzer);
        vi.advanceTimersByTime(500);
        expect(k.angemeldet).toEqual(["geometry-edit"]);
        dritter.ab();
        vi.useRealTimers();
    });

    it("🔴 „Neuer Weg“ beginnt nicht, solange ein Modus läuft: nichts gelesen, Hinweis", async () => {
        const laufender = belegeGeometrie()!;
        const ort = vi.fn();
        const neuerWeg = createNeuerWeg({
            daten: { ort, zieleImKasten: vi.fn(), legeAn: vi.fn() },
            fangradius: () => 10,
            karte: { ein: vi.fn(), sichtbar: () => undefined, schirm: (p) => p, geaendert: vi.fn() },
        });
        await neuerWeg.starte({ ort: "ort-1" });
        expect(ort).not.toHaveBeenCalled();
        expect(neuerWeg.laufend.value).toBeUndefined();
        expect(showToast).toHaveBeenCalledTimes(1);
        laufender.frei();
    });
});
