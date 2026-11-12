import { describe, expect, it } from "vitest";
import { EDITOR_POWERLINES_URL, type EditorPowerlineRow } from "@avesmaps3d/shared";
import { berechne, type ListenStand } from "../src/editor-liste/liste-modell";
import {
    KRAFTLINIEN_LEGENDE,
    KRAFTLINIEN_OPTIONEN,
    endName,
    ladeKraftlinien,
    sortierungsName,
    wertName,
    zeileVon,
} from "../src/kraftlinieneditor/kraftlinien-liste";
import { LANDSCHAFTEN_LEGENDE } from "../src/landschaftseditor/landschaften-liste";

/**
 * Die Kraftlinien als Liste (WI-0205 Paket K2, Blatt Kraftlinien, EDIT-0003 T28 (1)): eine Zeile je Linie, der Kreis vom Server mit
 * den Wörtern aller Listen, Facetten Wiki und Gestalt, Unterzeile mit Nodices, Abschnitten, Teilzuordnung und Enden. Problemfälle: Ein
 * Teil der Abschnitte mit Artikel gilt als fertig; ein fehlender Knoten verschwindet hinter den Zählern; ein Kraftlinienpunkt ohne
 * Namen steht leer am Ende; eine Linie ohne Namen hat keinen Text.
 */
const PUNIN: EditorPowerlineRow = {
    id: "b2b2b2b2-0000-4000-8000-000000000001",
    name: "Punin–Gareth",
    circle: "voll",
    shape: "strang",
    segments: 3,
    nodes: 4,
    wiki: { url: "https://de.wiki-aventurica.de/wiki/Kraftlinie", title: "Kraftlinie" },
    ends: ["Punin", ""],
    bounds: [400, 380, 520, 470],
};
const GESPINST: EditorPowerlineRow = {
    id: "b2b2b2b2-0000-4000-8000-000000000002",
    name: "Gespinst im Raschtulswall",
    circle: "halb-rechts",
    shape: "verzweigt",
    segments: 5,
    nodes: 6,
    wiki: { url: "https://de.wiki-aventurica.de/wiki/Raschtulswall", title: "Raschtulswall" },
    wikiSegments: 2,
};
const OHNE: EditorPowerlineRow = {
    id: "b2b2b2b2-0000-4000-8000-000000000003",
    name: "",
    circle: "halb-rechts",
    shape: "teile",
    segments: 2,
    nodes: 3,
    missingNodes: 1,
};
const RING: EditorPowerlineRow = {
    id: "b2b2b2b2-0000-4000-8000-000000000004",
    name: "Ring um Gareth",
    circle: "voll",
    shape: "ring",
    segments: 4,
    nodes: 4,
    wiki: { url: "https://de.wiki-aventurica.de/wiki/Gareth", title: "Gareth" },
};
const ALLE = [PUNIN, GESPINST, OHNE, RING].map(zeileVon);
const stand = (teil: Partial<ListenStand> = {}): ListenStand => ({
    suche: "",
    filter: new Map(),
    sortierung: "name",
    offen: new Set(),
    ...teil,
});

describe("Kraftlinien als Liste (WI-0205 K2)", () => {
    it("🔴 eine Zeile je Linie, der Kreis vom Server; die Legende nennt alle vier Zustände mit den Wörtern aller Listen", () => {
        expect(ALLE.map((z) => [z.key, z.kreis])).toEqual([
            [PUNIN.id, "voll"],
            [GESPINST.id, "halb-rechts"],
            [OHNE.id, "halb-rechts"],
            [RING.id, "voll"],
        ]);
        expect(KRAFTLINIEN_LEGENDE()).toEqual(LANDSCHAFTEN_LEGENDE());
        expect(KRAFTLINIEN_OPTIONEN.form).toBe("flach");
        const { bilanz } = berechne(ALLE, stand(), KRAFTLINIEN_OPTIONEN);
        expect([bilanz.voll, bilanz.halb, bilanz["halb-rechts"], bilanz.leer]).toEqual([2, 0, 2, 0]);
    });

    it("🔴 Facetten Wiki (an jedem Abschnitt, an einem Teil, ohne) und Gestalt; ein Teil ist nicht „an jedem“", () => {
        expect(KRAFTLINIEN_OPTIONEN.facetten).toEqual(["wiki", "gestalt", "stand"]);
        expect(ALLE.map((z) => z.facetten["wiki"])).toEqual(["jeder", "teil", "ohne", "jeder"]);
        expect(ALLE.map((z) => z.facetten["gestalt"])).toEqual(["strang", "verzweigt", "teile", "ring"]);
        expect(wertName("wiki", "teil")).toBe("an einem Teil");
        expect(wertName("gestalt", "teile")).toBe("in Teilen");
        const jeder = berechne(ALLE, stand({ filter: new Map([["wiki", new Set(["jeder"])]]) }), KRAFTLINIEN_OPTIONEN);
        expect(jeder.treffer.map((z) => z.key)).toEqual([PUNIN.id, RING.id]);
    });

    it("🔴 T54: Stand mit den Werten aller Listen; Gelöschtes steht nur unter „Gelöscht“ (vorbelegt aus) und zählt in keiner Legende", () => {
        const ab = zeileVon({ ...OHNE, id: "c4c4c4c4-0000-4000-8000-0000000000a1", offMap: true, circle: "leer" });
        const weg = zeileVon({ ...PUNIN, id: "c4c4c4c4-0000-4000-8000-0000000000a2", deleted: true });
        const zeilen = [...ALLE, ab, weg];
        expect(zeilen.map((z) => z.facetten["stand"])).toEqual([
            "aufDerKarte",
            "aufDerKarte",
            "aufDerKarte",
            "aufDerKarte",
            "nichtAufDerKarte",
            "geloescht",
        ]);
        expect(["aufDerKarte", "nichtAufDerKarte", "geloescht"].map((w) => wertName("stand", w))).toEqual([
            "Auf der Karte",
            "Nicht auf der Karte",
            "Gelöscht",
        ]);
        expect(weg).toMatchObject({ zaehltNicht: true, unter: { text: "Gelöscht", ton: "warnung" } });
        const start = berechne(
            zeilen,
            stand({ filter: new Map(KRAFTLINIEN_OPTIONEN.vorbelegt) }),
            KRAFTLINIEN_OPTIONEN,
        );
        expect(start.treffer.map((z) => z.key)).not.toContain(weg.key);
        expect(start.treffer.map((z) => z.key)).toContain(ab.key);
        // Gewählt steht die gelöschte Linie da, zählt aber nicht mit.
        const mit = berechne(
            zeilen,
            stand({ filter: new Map([["stand", new Set(["aufDerKarte", "nichtAufDerKarte", "geloescht"])]]) }),
            KRAFTLINIEN_OPTIONEN,
        );
        expect(mit.treffer.map((z) => z.key)).toContain(weg.key);
        expect(mit.bilanz.voll).toBe(2);
    });

    it("🔴 die Unterzeile: Nodices, Abschnitte oder die Teilzuordnung, die Enden; ein fehlender Knoten verdrängt alles als Warnung", () => {
        expect(ALLE.map((z) => z.unter)).toEqual([
            { text: "4 Nodices · 3 Abschnitte · Punin ↔ Kraftlinienpunkt", ton: "gut" },
            { text: "6 Nodices · Wiki an 2 von 5 Abschnitten", ton: "warnung" },
            { text: "⚠ 1 Knoten fehlt", ton: "warnung" },
            { text: "4 Nodices · 4 Abschnitte", ton: "gut" },
        ]);
        expect(ALLE.map((z) => z.rechts)).toEqual(["Strang", "verzweigt", "in Teilen", "Ring"]);
        expect(ALLE.map((z) => z.name)).toEqual([
            "Punin–Gareth",
            "Gespinst im Raschtulswall",
            "ohne Namen",
            "Ring um Gareth",
        ]);
        expect(endName("")).toBe("Kraftlinienpunkt");
        expect(endName("Punin")).toBe("Punin");
    });

    it("sortiert nach Abschnitten (die meisten zuerst) und nach Zustand von ○ zu ●", () => {
        expect(
            berechne(ALLE, stand({ sortierung: "abschnitte" }), KRAFTLINIEN_OPTIONEN).treffer.map((z) => z.key),
        ).toEqual([GESPINST.id, RING.id, PUNIN.id, OHNE.id]);
        expect(
            berechne(ALLE, stand({ sortierung: "kreis" }), KRAFTLINIEN_OPTIONEN).treffer.map((z) => z.kreis),
        ).toEqual(["halb-rechts", "halb-rechts", "voll", "voll"]);
        expect(sortierungsName("abschnitte")).toBe("Abschnitte");
    });

    it("🔴 lädt mit „no-cache“ (ETag, 304 aus dem Browser) und meldet einen Fehler des Servers mit seinem Code", async () => {
        const anfragen: [string, RequestInit | undefined][] = [];
        const liste = await ladeKraftlinien(new AbortController().signal, async (url, init) => {
            anfragen.push([String(url), init]);
            return new Response(JSON.stringify({ rows: [PUNIN] }), { status: 200 });
        });
        expect(liste.rows).toHaveLength(1);
        expect(anfragen[0]?.[0]).toBe(EDITOR_POWERLINES_URL);
        expect(anfragen[0]?.[1]?.cache).toBe("no-cache");
        await expect(
            ladeKraftlinien(
                new AbortController().signal,
                async () =>
                    new Response(JSON.stringify({ error: { code: "forbidden", message: "Kein Recht" } }), {
                        status: 403,
                    }),
            ),
        ).rejects.toMatchObject({ status: 403, code: "forbidden" });
    });
});
