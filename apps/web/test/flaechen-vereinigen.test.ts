import { describe, expect, it, vi } from "vitest";
import type { FlaechenVereinigenPruefung, MapHistoryEntry } from "@avesmaps3d/shared";
import { createFlaechenVereinigen, FEHLER_NEU_NACH_MS, type FlaechenAuswahl } from "../src/map/flaechen-vereinigen.ts";
import { ortHandgriffe, type OrtLage } from "../src/editor-menu/handgriffe-ort.ts";
import { anlegenEintraege, kartenAbschnitte } from "../src/editor-menu/kartenmenue.ts";
import { ruecknahmeZiel } from "../src/aenderungen/aenderung-ruecknahme.ts";
import { createLandschaftVerlaufsArt } from "../src/landschaftseditor/landschaft-verlauf.ts";

/**
 * „Flächen vereinigen ›“ im Kartenmenü (WI-0252). Problemfälle: Der Eintrag steht ohne Mehrfachauswahl da; er geht, bevor der Server
 * geprüft hat, oder fehlt, wenn es nicht geht (statt grau mit dem Grund); er steht nicht direkt unter „Hier hinzufügen ›“; das Untermenü
 * nennt Flächen, die nicht Vorlage sein können; die Wahl schickt andere Revisionen als die gelesenen.
 */

const WALD = "11111111-1111-4111-8111-1111111111a1";
const HAIN = "11111111-1111-4111-8111-1111111111b1";
const AUSWAHL: FlaechenAuswahl = { art: "landscape", ids: [WALD, HAIN] };
const uebersetze = (key: string): string => `«${key}»`;
const artName = (_art: string, typ: string): string => `Art ${typ}`;

function aufbau(pruefung: FlaechenVereinigenPruefung) {
    const gesendet: { url: string; body: unknown }[] = [];
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
        if (init?.method === "POST") {
            gesendet.push({ url, body: JSON.parse(String(init.body)) });
            return new Response(
                JSON.stringify({
                    operationId: "x",
                    status: "applied",
                    environment: "test",
                    affected: [],
                    derivedWork: [],
                    warnings: [],
                    mapRevision: 7,
                    publicId: HAIN,
                }),
            );
        }
        return new Response(JSON.stringify(pruefung));
    });
    return { v: createFlaechenVereinigen(fetcher as never), fetcher, gesendet };
}
const GEHT: FlaechenVereinigenPruefung = {
    geht: true,
    objekte: [
        { publicId: WALD, revision: 3, name: "Wald von Gareth", art: "wald", flaechen: 1 },
        { publicId: HAIN, revision: 5, name: "Hain", art: "wald", flaechen: 2 },
    ],
    vorlagen: [WALD, HAIN],
};

describe("Flächen vereinigen: der Eintrag", () => {
    it("🔴 nur bei einer Mehrfachauswahl von zwei oder mehr; erst „wird geprüft“, dann die Vorlagen mit Name und Art", async () => {
        const { v } = aufbau(GEHT);
        expect(v.eintrag(undefined, artName, undefined)).toBeUndefined();
        expect(v.eintrag({ art: "landscape", ids: [WALD] }, artName, undefined)).toBeUndefined();
        expect(v.eintrag(AUSWAHL, artName, undefined)).toMatchObject({ grund: "ortseditor.vereinigen.grund.laedt" });
        await v.bereit(AUSWAHL);
        expect(v.eintrag(AUSWAHL, artName, undefined)).toEqual({
            id: "flaechen-vereinigen",
            text: "ortseditor.anlegen.vereinigen",
            wahlen: [
                { id: WALD, text: "Wald von Gareth", hinweis: "Art wald", vorschau: true },
                { id: HAIN, text: "Hain", hinweis: "Art wald", vorschau: true },
            ],
        });
    });

    it("🔴 geht es nicht, steht er grau mit dem Grund; nur Vorlagen im Untermenü; ohne Recht fragt er gar nicht erst", async () => {
        const art = aufbau({ geht: false, grund: "art", objekte: GEHT.objekte });
        await art.v.bereit(AUSWAHL);
        expect(art.v.eintrag(AUSWAHL, artName, undefined)?.grund).toBe("ortseditor.vereinigen.grund.art");
        const gebiete = aufbau({ geht: false, grund: "art", objekte: GEHT.objekte });
        const zweiGebiete: FlaechenAuswahl = { art: "territory", ids: [WALD, HAIN] };
        await gebiete.v.bereit(zweiGebiete);
        expect(gebiete.v.eintrag(zweiGebiete, artName, undefined)?.grund).toBe("ortseditor.vereinigen.grund.artGebiet");
        expect(gebiete.fetcher.mock.calls[0]?.[0]).toMatch(/^\/api\/editor\/territories\/vereinigen\?ids=/);
        const eine = aufbau({ ...GEHT, vorlagen: [HAIN] });
        await eine.v.bereit(AUSWAHL);
        expect(eine.v.eintrag(AUSWAHL, artName, undefined)?.wahlen.map((w) => w.id)).toEqual([HAIN]);
        const ohne = aufbau(GEHT);
        expect(ohne.v.eintrag(AUSWAHL, artName, "ortseditor.handgriff.grund.recht")).toMatchObject({
            grund: "ortseditor.handgriff.grund.recht",
            wahlen: [],
        });
        expect(ohne.fetcher).not.toHaveBeenCalled();
    });

    it("🔴 die Wahl schickt EINE Operation mit der Vorlage und den Revisionen, die die Prüfung las", async () => {
        const { v, gesendet } = aufbau(GEHT);
        await v.bereit(AUSWAHL);
        const antwort = await v.vereinige(AUSWAHL, HAIN);
        expect(antwort).toMatchObject({ ok: true, n: 2, quittung: { publicId: HAIN } });
        expect(gesendet).toEqual([
            {
                url: "/api/editor/landscapes/vereinigen",
                body: {
                    operationId: expect.any(String),
                    objects: [
                        { publicId: WALD, baseRevision: 3 },
                        { publicId: HAIN, baseRevision: 5 },
                    ],
                    vorlage: HAIN,
                },
            },
        ]);
        // Danach ist die Prüfung vergessen: das nächste Menü fragt neu.
        expect(v.eintrag(AUSWAHL, artName, undefined)?.grund).toBe("ortseditor.vereinigen.grund.laedt");
    });
});

describe("Flächen vereinigen: eine gescheiterte Prüfung", () => {
    it("🔴 bleibt nicht für die ganze Auswahl stehen: nach der Frist fragt das nächste Öffnen des Menüs noch einmal (Zeitüberschreitung des Servers)", async () => {
        let uhr = 1_000;
        let antworten = 0;
        const fetcher = vi.fn(async () => {
            antworten += 1;
            // Die erste Prüfung scheitert (503 an der Zeitgrenze), die zweite geht.
            return antworten === 1
                ? new Response(JSON.stringify({ error: { code: "database_unavailable", message: "x" } }), {
                      status: 503,
                  })
                : new Response(JSON.stringify(GEHT));
        });
        const v = createFlaechenVereinigen(fetcher as never, () => uhr);
        await v.bereit(AUSWAHL);
        expect(v.eintrag(AUSWAHL, artName, undefined)?.grund).toBe("ortseditor.vereinigen.grund.fehler");
        // Gleich danach (ein Menü, das sich mehrfach aufbaut): keine zweite Anfrage.
        uhr += FEHLER_NEU_NACH_MS - 1;
        expect(v.eintrag(AUSWAHL, artName, undefined)?.grund).toBe("ortseditor.vereinigen.grund.fehler");
        expect(fetcher).toHaveBeenCalledTimes(1);
        // Nach der Frist: neu gestellt, „wird geprüft“, dann die Vorlagen.
        uhr += 1;
        expect(v.eintrag(AUSWAHL, artName, undefined)?.grund).toBe("ortseditor.vereinigen.grund.laedt");
        await v.bereit(AUSWAHL);
        expect(fetcher).toHaveBeenCalledTimes(2);
        expect(v.eintrag(AUSWAHL, artName, undefined)?.wahlen.map((w) => w.id)).toEqual([WALD, HAIN]);
    });
});

describe("Flächen vereinigen: im Kartenmenü", () => {
    const lage = (): OrtLage => ({
        rechte: [
            "use_editor_menu",
            "edit_map_objects",
            "edit_map_geometry",
            "edit_territories",
            "edit_landscapes",
            "edit_territory_form",
            "edit_landscape_form",
            "edit_mountains",
        ],
        bearbeiten: { mapEditing: "testwelt" } as never,
        laeuft: false,
    });
    const wirkung = { bearbeiten: vi.fn(), verschieben: vi.fn(), verbergen: vi.fn() };

    it("🔴 direkt unter „Hier hinzufügen ›“, das Untermenü mit `flaechen-vereinigen#<Vorlage>`; grau ohne Untermenü", () => {
        const mit = kartenAbschnitte({
            actions: ortHandgriffe(lage, wirkung),
            subject: undefined,
            anlegen: anlegenEintraege(lage, vi.fn()),
            uebersetze,
            vereinigen: {
                id: "flaechen-vereinigen",
                text: "ortseditor.anlegen.vereinigen",
                wahlen: [{ id: WALD, text: "Wald von Gareth", hinweis: "Wald", vorschau: true }],
            },
        });
        const anlegen = mit.find((abschnitt) => abschnitt.id === "anlegen")!;
        expect(anlegen.eintraege.map((e) => e.id)).toEqual(["hier-hinzufuegen", "flaechen-vereinigen"]);
        expect(anlegen.eintraege[1]).toMatchObject({ zeichen: "vereinigen", text: "«ortseditor.anlegen.vereinigen»" });
        expect(anlegen.eintraege[1]?.unter).toEqual([
            {
                id: `flaechen-vereinigen#${WALD}`,
                zeichen: undefined,
                text: "Wald von Gareth",
                gefahr: undefined,
                hinweis: "Wald",
                vorschau: true,
            },
        ]);
        const grau = kartenAbschnitte({
            actions: [],
            subject: undefined,
            anlegen: [],
            uebersetze,
            vereinigen: {
                id: "flaechen-vereinigen",
                text: "ortseditor.anlegen.vereinigen",
                grund: "ortseditor.vereinigen.grund.nachbar",
                wahlen: [],
            },
        });
        // Auch ohne „Hier hinzufügen“ steht der Abschnitt Anlegen, mit dem grauen Eintrag allein.
        expect(grau.map((a) => a.id)).toEqual(["anlegen"]);
        expect(grau[0]?.eintraege).toEqual([
            {
                id: "flaechen-vereinigen",
                zeichen: "vereinigen",
                text: "«ortseditor.anlegen.vereinigen»",
                grund: "«ortseditor.vereinigen.grund.nachbar»",
                grundSichtbar: true,
            },
        ]);
    });
});

describe("Flächen vereinigen: ↺ im Verlauf der Vorlage", () => {
    const OP = "33333333-3333-4333-8333-333333333333";
    const FLAECHE = "11111111-1111-4111-8111-1111111111c1";
    const eintrag = (operation: string, objects: MapHistoryEntry["objects"]): MapHistoryEntry =>
        ({
            operationId: OP,
            seq: 9,
            at: "2026-10-24T18:00:00.000Z",
            operation,
            source: "editor",
            actor: { kind: "person", name: "Rondrikan" },
            objects,
        }) as MapHistoryEntry;

    it("🔴 Landschaft: `landscape.merge` nimmt der Server zurück (WI-0265 B6c): Der Verlauf der Vorlage nennt die Adresse, der Anschluss spielt nichts selbst zurück", () => {
        const e = eintrag("landscape.merge", [
            {
                kind: "area",
                id: FLAECHE,
                action: "area.merged",
                revisionBefore: 4,
                revisionAfter: 5,
                changes: { geometry: { before: [], after: [] } },
                landscape: { id: WALD },
            },
        ]);
        const art = createLandschaftVerlaufsArt();
        expect(
            art.ruecknahme(e, { id: WALD, areas: [{ id: FLAECHE, revision: 5 }], labels: [] } as never, "op"),
        ).toEqual({
            art: "nicht",
        });
        expect(art.ruecknahmeZiel?.(e, WALD)).toEqual({ familie: "landscape", id: WALD });
    });

    it("🔴 Gebiet: `territory.merge` nimmt der Server zurück (WI-0265 B6b: Adresse am Gebiet, ↺ im gemeinsamen Bauteil)", () => {
        const e = eintrag("territory.merge", [
            {
                kind: "territory_area",
                id: FLAECHE,
                territory: { id: HAIN, name: "Hain" },
                action: "territory_area.merged",
                revisionBefore: 2,
                revisionAfter: 3,
                changes: { geometry: { before: [], after: [] } },
            },
        ]);
        // Das Protokoll nennt nur die Fläche; sie trägt ihr Gebiet als Adresse der Rücknahme.
        expect(ruecknahmeZiel(e)).toEqual({ familie: "territory", id: HAIN });
    });
});
