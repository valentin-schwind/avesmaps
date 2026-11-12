import { describe, expect, it, vi } from "vitest";
import { nextTick, ref } from "vue";
import type { Speicher } from "../src/editor-panel/editor-panel-nav.ts";
import { createWerkzeugfenster } from "../src/editor-panel/werkzeugfenster.ts";
import { createKraftlinieneditorSteuerung } from "../src/kraftlinieneditor/kraftlinieneditor-steuerung.ts";
import { createLandschaftseditorSteuerung } from "../src/landschaftseditor/landschaftseditor-steuerung.ts";
import {
    LISTEN_SCHLUESSEL,
    createListenSchalter,
    listeImModus,
    listenSchluessel,
} from "../src/fenster/listen-schalter.ts";

/**
 * Die Liste eines Werkzeugfensters bei Modus und Kartenklick (EDIT-0003, Entscheidung der Orchestrierung zu Kraftlinien K6/K8, Regel 7):
 * Ein Modus der Form aus einem angedockten Fenster zieht die Liste ein und stellt sie am Ende wieder her; öffnet ein Klick auf die
 * Karte den Editor, steht das Fenster nur mit den Eigenschaften (Variante A), über das Verb bleibt die Liste, wie sie ist.
 *
 * Problemfälle: Der Modus legt die Vorgabe neuer Fenster um; das Ende klappt eine Liste wieder auf, die schon vorher zu war oder die
 * jemand inzwischen selbst geöffnet hat; ein abgedocktes Fenster klappt mit; ein Kartenklick klappt die Liste eines offenen Fensters
 * zu, in dem jemand gerade mit ihr arbeitet; die Stellung der Landschaftsliste wird die Vorgabe des Ortseditors.
 */

function tafel(): Speicher & { werte: Map<string, string> } {
    const werte = new Map<string, string>();
    return {
        werte,
        getItem: (schluessel) => werte.get(schluessel) ?? null,
        setItem: (schluessel, wert) => void werte.set(schluessel, wert),
        removeItem: (schluessel) => void werte.delete(schluessel),
    };
}

describe("Schalter der Liste für alle Editoren", () => {
    it("🔴 die Vorgabe gilt je Werkzeug: die Landschaftsliste legt nicht die des Ortseditors um", () => {
        const speicher = tafel();
        const schalter = createListenSchalter(speicher);
        schalter.melde("l-1", "landschaftseditor");
        schalter.schalte("l-1", true);
        expect(speicher.werte.get(listenSchluessel("landschaftseditor"))).toBe("zu");
        expect(speicher.werte.has(LISTEN_SCHLUESSEL)).toBe(false);
        schalter.melde("o-1");
        expect(schalter.zu("o-1")).toBe(false);
        schalter.melde("l-2", "landschaftseditor");
        expect(schalter.zu("l-2")).toBe(true);
    });

    it("🔴 vorläufig stellt das Fenster, nicht die Vorgabe", () => {
        const speicher = tafel();
        const schalter = createListenSchalter(speicher);
        schalter.vorlaeufig("k-1", true, "kraftlinieneditor");
        expect(schalter.zu("k-1")).toBe(true);
        // Das Melden danach überschreibt die Stellung nicht.
        schalter.melde("k-1", "kraftlinieneditor");
        expect(schalter.zu("k-1")).toBe(true);
        schalter.melde("k-2", "kraftlinieneditor");
        expect(schalter.zu("k-2")).toBe(false);
        expect(speicher.werte.size).toBe(0);
    });

    it("🔴 der Modus zieht ein und stellt am Ende wieder her; eine schon eingezogene Liste bleibt zu", () => {
        const schalter = createListenSchalter(tafel());
        schalter.melde("k-1", "kraftlinieneditor");
        schalter.modus("k-1", true);
        expect(schalter.zu("k-1")).toBe(true);
        schalter.modus("k-1", false);
        expect(schalter.zu("k-1")).toBe(false);

        schalter.vorlaeufig("k-1", true);
        schalter.modus("k-1", true);
        schalter.modus("k-1", false);
        expect(schalter.zu("k-1")).toBe(true);
    });

    it("🔴 wer die Liste im Modus selbst aufklappt, behält sie; wer sie wieder zuklappt, auch", () => {
        const schalter = createListenSchalter(tafel());
        schalter.melde("l-1", "landschaftseditor");
        schalter.modus("l-1", true);
        schalter.schalte("l-1", false);
        schalter.modus("l-1", false);
        expect(schalter.zu("l-1")).toBe(false);

        schalter.modus("l-1", true);
        schalter.schalte("l-1", false);
        schalter.schalte("l-1", true);
        schalter.modus("l-1", false);
        expect(schalter.zu("l-1")).toBe(true);
    });
});

describe("Liste im Modus (listeImModus)", () => {
    it("🔴 nur am angedockten Fenster; ein Wechsel des Fensters stellt das alte wieder her", async () => {
        const schalter = createListenSchalter(tafel());
        for (const id of ["a", "b"]) schalter.melde(id, "kraftlinieneditor");
        const imModus = ref<string | undefined>(undefined);
        const angedockt = ref(new Set(["a", "b"]));
        const stop = listeImModus(
            schalter,
            () => imModus.value,
            (id) => angedockt.value.has(id),
        );
        imModus.value = "a";
        await nextTick();
        expect(schalter.zu("a")).toBe(true);
        imModus.value = "b";
        await nextTick();
        expect([schalter.zu("a"), schalter.zu("b")]).toEqual([false, true]);
        imModus.value = undefined;
        await nextTick();
        expect(schalter.zu("b")).toBe(false);

        angedockt.value = new Set(["b"]);
        imModus.value = "a";
        await nextTick();
        expect(schalter.zu("a")).toBe(false);
        stop();
    });
});

describe("Kartenklick öffnet mit eingezogener Liste (Variante A)", () => {
    const leer = vi.fn(async () => new Response(JSON.stringify({ rows: [] }), { status: 200 }));

    it("🔴 Landschaftseditor: der Klick, der das Fenster öffnet, zieht ein; ein zweiter am offenen Fenster und das Verb lassen es", () => {
        const fenster = createWerkzeugfenster(undefined);
        const schalter = createListenSchalter(tafel());
        const steuerung = createLandschaftseditorSteuerung(fenster, leer, schalter);
        const flaeche = { kind: "area", id: "a1a1a1a1-0000-4000-8000-000000000001" } as const;
        expect(steuerung.geoeffnet(flaeche, { source: "map", camera: "none" }, true)).toBe(true);
        const id = steuerung.fenster.value[0]!.id;
        expect(schalter.zu(id)).toBe(true);
        schalter.schalte(id, false);
        expect(steuerung.geoeffnet(flaeche, { source: "map", camera: "none" }, true)).toBe(true);
        expect(schalter.zu(id)).toBe(false);
        steuerung.destroy();

        const verbSchalter = createListenSchalter(tafel());
        const ueberVerb = createLandschaftseditorSteuerung(createWerkzeugfenster(undefined), leer, verbSchalter);
        ueberVerb.oeffneWerkzeug();
        expect(verbSchalter.zu(ueberVerb.fenster.value[0]!.id, "landschaftseditor")).toBe(false);
        ueberVerb.destroy();
    });

    it("🔴 Kraftlinien: „Eigenschaften bearbeiten“ und „Kraftlinie entfernen“ von der Karte ziehen ein, das Verb nicht", async () => {
        const schalter = createListenSchalter(tafel());
        const steuerung = createKraftlinieneditorSteuerung(createWerkzeugfenster(undefined), leer, schalter);
        steuerung.oeffneWerkzeug();
        const verb = steuerung.fenster.value[0]!.id;
        expect(schalter.zu(verb, "kraftlinieneditor")).toBe(false);
        steuerung.destroy();

        // Die Karte nennt einen Abschnitt; das Fenster öffnet, sobald die Linie unter ihrem Anker gelesen ist.
        const anker = "b2b2b2b2-0000-4000-8000-000000000001";
        const linie = vi.fn(async (eingabe: string | URL | Request) =>
            String(eingabe).endsWith(`/${anker}`)
                ? new Response(JSON.stringify({ id: anker, name: "Ley", segments: [{ id: anker }], nodes: [] }))
                : new Response(JSON.stringify({ rows: [] }), { status: 200 }),
        );
        for (const weg of ["oeffneFuer", "frageEntfernen"] as const) {
            const s = createListenSchalter(tafel());
            const k = createKraftlinieneditorSteuerung(createWerkzeugfenster(undefined), linie, s);
            await k[weg](anker);
            expect(s.zu(k.fenster.value[0]!.id)).toBe(true);
            k.destroy();
        }
    });
});
