import { describe, expect, it, vi } from "vitest";
import type { EditorPowerlineDetail } from "@avesmaps3d/shared";
import { createWerkzeugfenster } from "../src/editor-panel/werkzeugfenster.ts";
import { createKraftlinieneditorSteuerung } from "../src/kraftlinieneditor/kraftlinieneditor-steuerung.ts";

/**
 * „Kraftlinie entfernen“ (EDIT-0003 T39 am Nodix, K3 an der Linie; Fund des Betreibers auf der Stage 2026-10-17: „nur kraftlinie
 * entfernen hat keinen effekt“). Problemfall: An der Linie ist der Gegenstand der GETROFFENE Abschnitt; der Server nennt die Linie unter
 * ihrem Anker (kleinster Abschnitt). Blieb die Nachfrage am getroffenen Abschnitt hängen, stand sie nie im Fenster (es zeigt sie nur an
 * der Linie seines Fensters), und „Entfernen“ schrieb nichts.
 */

const ANKER = "0d0d0d0d-0000-4000-8000-000000000001";
const GETROFFEN = "0d0d0d0d-0000-4000-8000-000000000002";
const DETAIL: EditorPowerlineDetail = {
    id: ANKER,
    name: "Ley von Gareth",
    circle: "voll",
    shape: "strang",
    segments: [
        { id: ANKER, from: "a", to: "b", curve: null, labelVisible: true, revision: 3 },
        { id: GETROFFEN, from: "b", to: "c", curve: null, labelVisible: true, revision: 5 },
    ],
    nodes: [],
    bounds: [0, 0, 1, 1],
} as EditorPowerlineDetail;

function aufbau() {
    const gesendet: { url: string; body: unknown }[] = [];
    const fetcher = vi.fn(async (eingabe: string | URL | Request, init?: RequestInit) => {
        const url = String(eingabe);
        if (init?.method === "POST") {
            gesendet.push({ url, body: JSON.parse(String(init.body)) });
            return new Response(JSON.stringify({ mapRevision: 77 }), { status: 200 });
        }
        if (url.endsWith(`/${ANKER}`) || url.endsWith(`/${GETROFFEN}`))
            return new Response(JSON.stringify(DETAIL), { status: 200 });
        return new Response(JSON.stringify({ rows: [] }), { status: 200 });
    });
    const werkzeugfenster = createWerkzeugfenster(undefined);
    const steuerung = createKraftlinieneditorSteuerung(werkzeugfenster, fetcher);
    return { steuerung, gesendet, werkzeugfenster };
}

describe("Kraftlinie entfernen", () => {
    it("🔴 an der Linie (getroffener Abschnitt): die Nachfrage steht am Fenster der Linie, „Ganz löschen“ legt ALLE Abschnitte still", async () => {
        const { steuerung, gesendet } = aufbau();
        await steuerung.frageEntfernen(GETROFFEN);
        // Das Fenster heißt nach dem Anker; dort steht die Nachfrage.
        expect(steuerung.fenster.value.map((f) => f.gegenstand)).toEqual([ANKER]);
        expect(steuerung.entfernenFrage.value).toBe(ANKER);
        await vi.waitFor(() => expect(steuerung.bearbeitungVon(ANKER)?.detail.value?.id).toBe(ANKER));
        const ergebnis = await steuerung.entferne("loeschen");
        expect(ergebnis).toMatchObject({
            ok: true,
            name: "Ley von Gareth",
            wechsel: "powerline.retire",
            mapRevision: 77,
        });
        expect(gesendet).toHaveLength(1);
        expect(gesendet[0]!.url).toContain(`/api/editor/powerlines/${ANKER}/retire`);
        expect(gesendet[0]!.body).toMatchObject({
            segments: [
                { id: ANKER, baseRevision: 3 },
                { id: GETROFFEN, baseRevision: 5 },
            ],
        });
        // Das Fenster bleibt und zeigt den Stand (K10): Von dort und über den Verlauf kommt die Linie zurück.
        expect(steuerung.fenster.value.map((f) => f.gegenstand)).toEqual([ANKER]);
        expect(steuerung.entfernenFrage.value).toBeUndefined();
        steuerung.destroy();
    });

    it("am Nodix (Anker der Linie): „Von der Karte nehmen“ geht an alle Abschnitte", async () => {
        const { steuerung, gesendet } = aufbau();
        await steuerung.frageEntfernen(ANKER);
        expect(steuerung.entfernenFrage.value).toBe(ANKER);
        await vi.waitFor(() => expect(steuerung.bearbeitungVon(ANKER)?.detail.value?.id).toBe(ANKER));
        expect((await steuerung.entferne("abnehmen")).ok).toBe(true);
        expect(gesendet).toHaveLength(1);
        expect(gesendet[0]!.url).toContain(`/api/editor/powerlines/${ANKER}/take-off-map`);
        steuerung.destroy();
    });
});
