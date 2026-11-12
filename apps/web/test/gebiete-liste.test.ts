import { describe, expect, it } from "vitest";
import { EDITOR_TERRITORIES_URL, type EditorTerritoryList, type EditorTerritoryRow } from "@avesmaps3d/shared";
import { berechne, type ListenStand } from "../src/editor-liste/liste-modell";
import {
    GEBIETE_LEGENDE,
    GEBIETE_OPTIONEN,
    artName,
    facettenName,
    ladeGebiete,
    wertName,
    zeilenVon,
} from "../src/gebietseditor/gebiete-liste";

/**
 * Die Herrschaftsgebiete als Baum (WI-0209 Paket A2, EDIT-0005 §3): jedes Gebiet unter seinem Elter, Legacys Kreis mit Legacys
 * Bedeutung, Facetten Karte, Jahr und Art, Unterzeile mit Spanne. Problemfälle: Ein Gebiet ohne Fläche fehlt; ein Treffer steht ohne
 * seine Vorfahren da; ein Elter, den die Liste nicht kennt, lässt das Gebiet verschwinden; die Legende nennt die Wörter der Ortsliste.
 */
const id = (n: number): string => `a2a2a2a2-0000-4000-8000-00000000000${String(n)}`;
const REICH: EditorTerritoryRow = {
    id: id(1),
    name: "Neues Reich",
    type: "Kaiserreich",
    circle: "halb",
    minZoom: 0,
    maxZoom: 1,
    color: "#40a040",
    order: 1,
};
const NORDMARKEN: EditorTerritoryRow = {
    id: id(2),
    name: "Nordmarken",
    type: "Herzogtum",
    parent: id(1),
    circle: "halb",
    minZoom: 2,
    maxZoom: 2,
    color: "#5fb068",
    order: 2,
};
const TRAPPENFURTEN: EditorTerritoryRow = {
    id: id(3),
    name: "Trappenfurten",
    type: "Baronie",
    parent: id(2),
    circle: "voll",
    area: true,
    minZoom: 4,
    maxZoom: 8,
    color: "#5eaf7c",
    order: 3,
};
const LEER: EditorTerritoryRow = {
    id: id(4),
    name: "Leere Baronie",
    type: "Baronie",
    parent: id(2),
    circle: "leer",
    minZoom: 4,
    maxZoom: 8,
    color: "#5eaf7c",
    order: 1,
};
const ALT: EditorTerritoryRow = {
    id: id(5),
    name: "Altes Reich",
    circle: "voll",
    area: true,
    color: "#123456",
    order: 0,
    notInYear: true,
};
const WAISE: EditorTerritoryRow = {
    id: id(6),
    name: "Waise",
    type: "Baronie",
    parent: id(9),
    circle: "leer",
    color: "#123456",
    order: 0,
};
const LISTE: EditorTerritoryList = { yearBf: 1049, rows: [REICH, NORDMARKEN, TRAPPENFURTEN, LEER, ALT, WAISE] };
/** Ganz gelöscht (D3), unter den Nordmarken (T54). */
const GELOESCHT: EditorTerritoryRow = {
    id: id(7),
    name: "Gelöschte Mark",
    type: "Mark",
    parent: id(2),
    circle: "leer",
    color: "#777777",
    order: 4,
    deleted: true,
};
const ALLE = zeilenVon(LISTE);
const stand = (teil: Partial<ListenStand> = {}): ListenStand => ({
    suche: "",
    filter: new Map(),
    sortierung: "reihenfolge",
    offen: new Set(),
    ...teil,
});

describe("Herrschaftsgebiete als Baum (WI-0209 A2)", () => {
    it("🔴 ein Baum: Wurzeln ohne Elter, ein unbekannter Elter macht zur Wurzel; aufgeklappt stehen die Kinder darunter", () => {
        expect(GEBIETE_OPTIONEN.form).toBe("baum");
        expect(ALLE.map((z) => z.eltern)).toEqual([undefined, id(1), id(2), id(2), undefined, undefined]);
        const zu = berechne(ALLE, stand(), GEBIETE_OPTIONEN).darstellung.map((z) => z.key);
        expect(zu).toEqual([id(5), id(6), id(1)]);
        const auf = berechne(ALLE, stand({ offen: new Set([id(1), id(2)]) }), GEBIETE_OPTIONEN).darstellung;
        expect(auf.map((z) => [z.key, z.art === "zeile" ? z.tiefe : -1])).toEqual([
            [id(5), 0],
            [id(6), 0],
            [id(1), 0],
            [id(2), 1],
            [id(4), 2],
            [id(3), 2],
        ]);
    });

    it("🔴 ein Treffer bringt seine Vorfahren als Zusammenhang mit, aufgeklappt", () => {
        const ergebnis = berechne(ALLE, stand({ suche: "trappen" }), GEBIETE_OPTIONEN);
        expect(ergebnis.treffer.map((z) => z.name)).toEqual(["Trappenfurten"]);
        expect(ergebnis.darstellung.map((z) => z.key)).toEqual([id(1), id(2), id(3)]);
    });

    it("🔴 Legacys Kreis mit Legacys Bedeutung (T26 (5)), nicht den Wörtern der Ortsliste", () => {
        expect(ALLE.map((z) => z.kreis)).toEqual(["halb", "halb", "voll", "leer", "voll", "leer"]);
        expect(GEBIETE_LEGENDE()).toEqual({
            voll: "Gebiet und alle Untergebiete auf der Karte",
            "halb-rechts": "Gebiet auf der Karte, Untergebiete unvollständig",
            halb: "nur über Untergebiete, unvollständig",
            leer: "nicht auf der Karte",
        });
    });

    it("🔴 Facetten Karte, Jahr, Art; ohne eigene Fläche filtert die Baronien ohne Fläche heraus", () => {
        expect(GEBIETE_OPTIONEN.facetten).toEqual(["karte", "jahr", "art", "befund", "stand"]);
        expect(ALLE.map((z) => z.facetten["karte"])).toEqual(["keine", "keine", "eigene", "keine", "eigene", "keine"]);
        expect(ALLE.map((z) => z.facetten["jahr"])).toEqual(["gilt", "gilt", "gilt", "gilt", "giltNicht", "gilt"]);
        expect(facettenName("karte")).toBe("Karte");
        expect(facettenName("jahr")).toBe("Jahr");
        expect(wertName("karte", "eigene", 1049)).toBe("mit eigener Fläche");
        expect(wertName("jahr", "giltNicht", 1049)).toBe("gilt 1049 BF nicht");
        expect(wertName("art", "", 1049)).toBe("ohne Art");
        const mitFlaeche = berechne(
            ALLE,
            stand({ filter: new Map([["karte", new Set(["eigene"])]]) }),
            GEBIETE_OPTIONEN,
        );
        expect(mitFlaeche.treffer.map((z) => z.name).sort()).toEqual(["Altes Reich", "Trappenfurten"]);
    });

    it("🔴 D6 Facette „Befund“: erst mit geladenen Befunden; mit Befund filtert, die Unterzeile nennt die Zahl", () => {
        // Ohne geladene Befunde trägt keine Zeile den Wert: Der Trichter bietet nichts an, statt „ohne Befund“ zu behaupten.
        expect(ALLE.every((z) => z.facetten["befund"] === undefined)).toBe(true);
        const mit = zeilenVon(LISTE, new Map([[id(5), 2]]));
        expect(mit.map((z) => z.facetten["befund"])).toEqual(["ohne", "ohne", "ohne", "ohne", "mit", "ohne"]);
        expect(mit[4]!.unter?.text).toContain("Befunde: 2");
        expect(facettenName("befund")).toBe("Befund");
        expect(wertName("befund", "mit", 1049)).toBe("mit Befund");
        const gefiltert = berechne(mit, stand({ filter: new Map([["befund", new Set(["mit"])]]) }), GEBIETE_OPTIONEN);
        expect(gefiltert.treffer.map((z) => z.key)).toEqual([id(5)]);
    });

    it("🔴 T54 Facette „Stand“: Gelöschtes steht nur unter „Gelöscht“, zählt in keiner Legende; der Start klappt den Baum nicht auf", () => {
        const VORBELEGT = new Set(["aufDerKarte", "nichtAufDerKarte"]);
        expect(GEBIETE_OPTIONEN.vorbelegt?.get("stand")).toEqual(VORBELEGT);
        const zeilen = zeilenVon({ ...LISTE, rows: [...LISTE.rows, GELOESCHT] });
        // Die gemeinsamen Werte (T54): Legacys ○ heißt „nicht auf der Karte“, wie in der Legende.
        expect(zeilen.map((z) => z.facetten["stand"])).toEqual([
            "aufDerKarte",
            "aufDerKarte",
            "aufDerKarte",
            "nichtAufDerKarte",
            "aufDerKarte",
            "nichtAufDerKarte",
            "geloescht",
        ]);
        const start = berechne(zeilen, stand({ filter: new Map([["stand", VORBELEGT]]) }), GEBIETE_OPTIONEN);
        expect(start.treffer.map((z) => z.key)).not.toContain(id(7));
        // Der Start zeigt den Baum wie ohne Trichter: nur die Wurzeln, zu.
        const ohneTrichter = berechne(ALLE, stand(), GEBIETE_OPTIONEN);
        expect(start.darstellung.map((d) => [d.key, d.art === "zeile" ? d.offen : undefined])).toEqual(
            ohneTrichter.darstellung.map((d) => [d.key, d.art === "zeile" ? d.offen : undefined]),
        );
        const mit = berechne(
            zeilen,
            stand({ filter: new Map([["stand", new Set([...VORBELEGT, "geloescht"])]]) }),
            GEBIETE_OPTIONEN,
        );
        expect(mit.treffer.map((z) => z.key)).toContain(id(7));
        // Ein gelöschtes ○ zählt nicht: dieselben Kreise wie ohne es.
        expect(mit.bilanz.leer).toBe(start.bilanz.leer);
        const nur = berechne(zeilen, stand({ filter: new Map([["stand", new Set(["geloescht"])]]) }), GEBIETE_OPTIONEN);
        expect(nur.treffer.map((z) => z.key)).toEqual([id(7)]);
        expect(zeilen.find((z) => z.key === id(7))!.unter).toEqual({ text: "Gelöscht", ton: "warnung" });
        expect(facettenName("stand")).toBe("Stand");
        expect(wertName("stand", "geloescht", 1049)).toBe("Gelöscht");
        expect(wertName("stand", "aufDerKarte", 1049)).toBe("Auf der Karte");
        expect(wertName("stand", "nichtAufDerKarte", 1049)).toBe("Nicht auf der Karte");
    });

    it("die Unterzeile: Spanne mit offenen Grenzen als 0 und 8, ohne eigene Fläche, außerhalb des Jahrs als Warnung", () => {
        expect(ALLE.map((z) => z.unter)).toEqual([
            { text: "Band 0–1 · keine eigene Fläche", ton: "leise" },
            { text: "Band 2–2 · keine eigene Fläche", ton: "leise" },
            { text: "Band 4–8", ton: "leise" },
            { text: "Band 4–8 · keine eigene Fläche", ton: "leise" },
            { text: "Band 0–8 · gilt 1049 BF nicht", ton: "warnung" },
            { text: "Band 0–8 · keine eigene Fläche", ton: "leise" },
        ]);
        expect(ALLE.map((z) => z.rechts)).toEqual([
            "Kaiserreich",
            "Herzogtum",
            "Baronie",
            "Baronie",
            "ohne Art",
            "Baronie",
        ]);
        expect(artName(undefined)).toBe("ohne Art");
    });

    it("sortiert unter Geschwistern nach Reihenfolge, nach Name und nach Zustand", () => {
        const kinder = (sortierung: string) =>
            berechne(ALLE, stand({ sortierung, offen: new Set([id(1), id(2)]) }), GEBIETE_OPTIONEN)
                .darstellung.filter((z) => z.art === "zeile" && z.zeile.eltern === id(2))
                .map((z) => (z.art === "zeile" ? z.zeile.name : ""));
        expect(kinder("reihenfolge")).toEqual(["Leere Baronie", "Trappenfurten"]);
        expect(kinder("name")).toEqual(["Leere Baronie", "Trappenfurten"]);
        expect(kinder("kreis")).toEqual(["Leere Baronie", "Trappenfurten"]);
    });

    it("🔴 lädt mit „no-cache“ (ETag, 304 aus dem Browser) und meldet einen Fehler des Servers mit seinem Code", async () => {
        const anfragen: [string, RequestInit | undefined][] = [];
        const liste = await ladeGebiete(new AbortController().signal, async (url, init) => {
            anfragen.push([String(url), init]);
            return new Response(JSON.stringify(LISTE), { status: 200 });
        });
        expect(liste.rows).toHaveLength(6);
        expect(anfragen[0]?.[0]).toBe(EDITOR_TERRITORIES_URL);
        expect(anfragen[0]?.[1]?.cache).toBe("no-cache");
        await expect(
            ladeGebiete(
                new AbortController().signal,
                async () =>
                    new Response(JSON.stringify({ error: { code: "forbidden", message: "Kein Recht" } }), {
                        status: 403,
                    }),
            ),
        ).rejects.toMatchObject({ status: 403, code: "forbidden" });
    });
});
