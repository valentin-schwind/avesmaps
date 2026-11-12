import { afterEach, describe, expect, it, vi } from "vitest";
import { nextTick, shallowRef } from "vue";
import {
    HERKUNFT_KOPF,
    beendeHerkunft,
    herkunftFuer,
    installiereHerkunft,
    setzeHerkunft,
} from "../src/community/herkunft.ts";
import type { FensterStand, WerkzeugFenster } from "../src/editor-panel/fenster-verwaltung.ts";

/**
 * Herkunft der Korrektur aus einem Community-Vorgang (WI-0268 C7): Welche Anfrage trägt die Kopfzeile `Avesmaps-Herkunft`, und wann endet sie?
 *
 * Problemfälle: ein GET, eine Kachel oder ein anderes Objekt im selben Editor trägt die Herkunft; eine fremde Herkunft (anderer Server) bekommt sie; die Herkunft überlebt
 * das Schließen des Editors; die Hülle um `fetch` verliert die eigenen Köpfe der Anfrage oder legt sich doppelt um sich selbst.
 */

const ORT = "8D3E0C2A-1111-4000-8000-000000000001";
const SEITE = "https://stage.avesmaps.de";

const fenster = (werkzeug: string): WerkzeugFenster => ({
    id: `f-${werkzeug}`,
    werkzeug,
    gegenstand: undefined,
    titel: werkzeug,
    ungespeichert: false,
    nurLesen: false,
    lage: "angedockt",
    letzteLage: "angedockt",
    box: undefined,
    vorn: 1,
});

afterEach(() => beendeHerkunft());

describe("Herkunft: welche Anfrage sie trägt", () => {
    it("ohne ⚙ trägt keine Anfrage eine Herkunft", () => {
        expect(herkunftFuer(`/api/editor/places/${ORT}`, "PATCH", SEITE)).toBeUndefined();
    });

    it("🔴 nur schreibend, nur unter /api/editor/, nur am Bezugsobjekt, nur am eigenen Server", () => {
        setzeHerkunft("COM-000123", ORT, "ortseditor");
        expect(herkunftFuer(`/api/editor/places/${ORT.toLowerCase()}`, "PATCH", SEITE)).toBe("COM-000123");
        expect(herkunftFuer(`/api/editor/places/${ORT.toLowerCase()}/move`, "post", SEITE)).toBe("COM-000123");
        expect(herkunftFuer(`${SEITE}/api/editor/places/${ORT}`, "DELETE", SEITE)).toBe("COM-000123");
        expect(herkunftFuer(`/api/editor/places/${ORT}`, "GET", SEITE)).toBeUndefined();
        expect(herkunftFuer(`/api/editor/places/8d3e0c2a-2222-4000-8000-000000000002`, "PATCH", SEITE)).toBeUndefined();
        expect(herkunftFuer(`/api/subjects/place/${ORT}`, "POST", SEITE)).toBeUndefined();
        expect(herkunftFuer(`https://fremd.example/api/editor/places/${ORT}`, "PATCH", SEITE)).toBeUndefined();
    });
});

describe("Herkunft: die Hülle um fetch und das Ende mit dem Editor", () => {
    it("🔴 setzt die Kopfzeile nur, wo sie gilt, behält die eigenen Köpfe und legt sich nie doppelt um fetch", async () => {
        const stand = shallowRef<FensterStand>({ fenster: [], zaehler: 0 });
        const abruf = vi.fn<typeof fetch>(async () => new Response("{}"));
        const ziel = { fetch: abruf as unknown as typeof fetch };
        const zurueck = installiereHerkunft(stand, ziel);
        const zweimal = installiereHerkunft(stand, ziel);
        setzeHerkunft("COM-000123", ORT, "ortseditor");

        await ziel.fetch(`http://localhost/api/editor/places/${ORT.toLowerCase()}`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: "{}",
        });
        await ziel.fetch(`http://localhost/api/editor/places/${ORT.toLowerCase()}`);
        expect(abruf).toHaveBeenCalledTimes(2);
        const [, schreibend] = abruf.mock.calls[0] ?? [];
        const koepfe = new Headers(schreibend?.headers);
        expect(koepfe.get(HERKUNFT_KOPF)).toBe("COM-000123");
        expect(koepfe.get("content-type")).toBe("application/json");
        expect(new Headers(abruf.mock.calls[1]?.[1]?.headers).get(HERKUNFT_KOPF)).toBeNull();

        zweimal();
        zurueck();
        expect(ziel.fetch).toBe(abruf);
    });

    it("🔴 endet, wenn kein Fenster des Werkzeugs mehr offen ist, aber nicht, bevor es sich geöffnet hat", async () => {
        const stand = shallowRef<FensterStand>({ fenster: [], zaehler: 0 });
        const zurueck = installiereHerkunft(stand, { fetch: (async () => new Response("{}")) as typeof fetch });
        setzeHerkunft("COM-000123", ORT, "ortseditor");
        const schreiben = () => herkunftFuer(`/api/editor/places/${ORT}`, "PATCH", "http://localhost");

        // Ein anderes Werkzeug geht zu, bevor der Ortseditor offen ist: die Herkunft bleibt.
        stand.value = { fenster: [fenster("wegeditor")], zaehler: 1 };
        await nextTick();
        stand.value = { fenster: [], zaehler: 2 };
        await nextTick();
        expect(schreiben()).toBe("COM-000123");

        stand.value = { fenster: [fenster("ortseditor")], zaehler: 3 };
        await nextTick();
        expect(schreiben()).toBe("COM-000123");
        stand.value = { fenster: [], zaehler: 4 };
        await nextTick();
        expect(schreiben()).toBeUndefined();
        zurueck();
    });

    it("ein Werkzeug, das beim Setzen schon offen stand, beendet sie mit seinem Schließen", async () => {
        const stand = shallowRef<FensterStand>({ fenster: [fenster("ortseditor")], zaehler: 1 });
        const zurueck = installiereHerkunft(stand, { fetch: (async () => new Response("{}")) as typeof fetch });
        setzeHerkunft("COM-000123", ORT, "ortseditor");
        stand.value = { fenster: [], zaehler: 2 };
        await nextTick();
        expect(herkunftFuer(`/api/editor/places/${ORT}`, "PATCH", "http://localhost")).toBeUndefined();
        zurueck();
    });
});
