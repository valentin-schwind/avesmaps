import { describe, expect, it } from "vitest";
import type {
    SearchAnfrage,
    SearchResponse,
    SearchSpracheHit,
    SearchVorkommenHit,
    SearchZahl,
    SearchZielGruppe,
    SearchZielHit,
} from "@avesmaps3d/shared";
import {
    baueAnsicht,
    restLeer,
    spracheZeilenText,
    zahlAnzeige,
    zahlenFragen,
    zeigtChips,
    zielZahl,
} from "../src/search/vorkommen-ansicht";

/**
 * Die Trefferliste der Spotlight-Suche mit den Vorkommen (WI-0257 S3b), ohne Vue und ohne Browser: Welche Sektionen stehen in welcher Reihenfolge da, wann Chips und wann die leise Zeile, was die Zahlen sagen.
 */

const ID_A = "165000d1-21db-479c-a677-a9f21686c517";
const ID_B = "8a7cf561-dd3e-4bad-96c7-8af76d9aff59";
const PRAEPOSITIONEN = ["in", "im", "auf", "nördlich von", "südlich von", "östlich von", "westlich von", "zwischen"];

const vorkommen = (id: string, name: string, extra: Partial<SearchVorkommenHit> = {}): SearchVorkommenHit => ({
    id,
    name,
    kind: "fauna",
    gefundenIn: "name",
    kartenbezug: true,
    leuchten: { eintrag: id },
    ...extra,
});

const sprache = (id: string, name: string, extra: Partial<SearchSpracheHit> = {}): SearchSpracheHit => ({
    id,
    schluessel: name.toLowerCase(),
    name,
    farbe: "#ffb901",
    gefundenIn: "name",
    gruppe: false,
    gegenden: 3,
    ...extra,
});

const antwort = (extra: Partial<SearchResponse> = {}): SearchResponse => ({
    query: "x",
    hits: [],
    truncated: false,
    ...extra,
});

const ort = { kind: "ort" as const, id: "o1", name: "Baumdrachental", subtype: "dorf", x: 1, y: 2, zoom: 4 };

const ziel = (name: string, extra: Partial<SearchZielHit> = {}): SearchZielHit => ({
    name,
    genannt: false,
    genau: false,
    gegenden: 3,
    text: `Baumdrache in ${name}`,
    leuchten: { eintrag: ID_A, landschaften: [ID_B] },
    ...extra,
});

const gruppe = (
    art: SearchZielGruppe["art"],
    hits: SearchZielHit[],
    extra: Partial<SearchZielGruppe> = {},
): SearchZielGruppe => ({
    art,
    hits,
    total: hits.length,
    ungeprueft: 0,
    ...extra,
});

const BEGRIFF = { name: "Baumdrache", kind: "fauna" as const, eintrag: ID_A };

describe("baueAnsicht", () => {
    it("ohne Antwort steht nichts da", () => {
        const ansicht = baueAnsicht(undefined, "");
        expect(ansicht.flach).toEqual([]);
        expect(ansicht.chips).toBeUndefined();
        expect(ansicht.hinweis).toBe(false);
    });

    it("eine gewöhnliche Antwort bleibt die Liste von früher: eine Sektion ohne Überschrift", () => {
        const ansicht = baueAnsicht(antwort({ hits: [ort] }), "baum");
        expect(ansicht.sektionen).toHaveLength(1);
        expect(ansicht.sektionen[0]).toMatchObject({ id: "hits", titel: undefined });
        expect(ansicht.flach.map((zeile) => zeile.art)).toEqual(["hit"]);
    });

    it("nach einem abgeschlossenen Begriff steht das Vorkommen vor den gewöhnlichen Treffern, sonst dahinter", () => {
        const sektion = { hits: [vorkommen(ID_A, "Baumdrache")], total: 1 };
        const mit = baueAnsicht(
            antwort({
                hits: [ort],
                vorkommen: sektion,
                anfrage: { begriff: BEGRIFF, praepositionen: PRAEPOSITIONEN },
            }),
            "baumdrache",
        );
        expect(mit.flach.map((zeile) => zeile.art)).toEqual(["vorkommen", "hit"]);
        const ohne = baueAnsicht(antwort({ hits: [ort], vorkommen: sektion }), "baumdr");
        expect(ohne.flach.map((zeile) => zeile.art)).toEqual(["hit", "vorkommen"]);
    });

    it("die Überschrift „Vorkommen“ steht nur über dem Vorkommen, „… und N weitere“ rechnet Gesamtzahl minus Gezeigte", () => {
        const hits = [vorkommen(ID_A, "A"), vorkommen(ID_B, "B")];
        const ansicht = baueAnsicht(antwort({ vorkommen: { hits, total: 9 } }), "a");
        const sektion = ansicht.sektionen[0];
        expect(sektion?.titel).toEqual({ art: "sektion", key: "search.sektion.vorkommen" });
        expect(sektion?.weitere).toBe(7);
    });

    it("Herrschaftsgebiete stehen in ihrer eigenen Sektion, nach den übrigen", () => {
        const ansicht = baueAnsicht(
            antwort({
                hits: [ort],
                gebiete: {
                    hits: [{ id: "g1", name: "Orkreich", typ: "Reich", x: 1, y: 1, bounds: [0, 0, 1, 1] }],
                    total: 1,
                },
            }),
            "o",
        );
        expect(ansicht.sektionen.map((sektion) => sektion.id)).toEqual(["hits", "gebiete"]);
        expect(ansicht.flach.map((zeile) => zeile.art)).toEqual(["hit", "gebiet"]);
    });

    it("Sprachen (WI-0261 S5c) stehen in ihrer eigenen Sektion hinter den gewöhnlichen Treffern und vor den Vorkommen und Gebieten", () => {
        const ansicht = baueAnsicht(
            antwort({
                hits: [ort],
                sprachen: { hits: [sprache(ID_A, "Garethi")], total: 1 },
                vorkommen: { hits: [vorkommen(ID_B, "Garten")], total: 1 },
                gebiete: {
                    hits: [{ id: "g1", name: "Garetien", typ: "Provinz", x: 1, y: 1, bounds: [0, 0, 1, 1] }],
                    total: 1,
                },
            }),
            "gar",
        );
        expect(ansicht.sektionen.map((sektion) => sektion.id)).toEqual(["hits", "sprachen", "vorkommen", "gebiete"]);
        expect(ansicht.flach.map((zeile) => zeile.art)).toEqual(["hit", "sprache", "vorkommen", "gebiet"]);
        expect(ansicht.sektionen[1]?.titel).toEqual({ art: "sektion", key: "search.sektion.sprachen" });
        // Die Zeile trägt den Treffer des Servers und einen eindeutigen Schlüssel.
        expect(ansicht.sektionen[1]?.zeilen[0]).toMatchObject({ art: "sprache", key: `sprache:${ID_A}` });
    });

    it("Landmarken (WI-0271 L6) stehen in ihrer eigenen Sektion gleich hinter den gewöhnlichen Treffern, vor den Sprachen", () => {
        const ansicht = baueAnsicht(
            antwort({
                hits: [ort],
                sprachen: { hits: [sprache(ID_A, "Garethi")], total: 1 },
                landmarken: { hits: [{ id: ID_B, name: "Garhöhle", art: "hoehle", x: 1, y: 2 }], total: 3 },
            }),
            "gar",
        );
        expect(ansicht.sektionen.map((sektion) => sektion.id)).toEqual(["hits", "landmarken", "sprachen"]);
        expect(ansicht.sektionen[1]?.titel).toEqual({ art: "sektion", key: "search.sektion.landmarken" });
        expect(ansicht.sektionen[1]?.zeilen[0]).toMatchObject({ art: "landmarke", key: `landmarke:${ID_B}` });
        expect(ansicht.sektionen[1]?.weitere).toBe(2);
    });

    it("hinter einem abgeschlossenen Begriff steht das Vorkommen vorn, die Sprachen bleiben hinter den gewöhnlichen Treffern", () => {
        const ansicht = baueAnsicht(
            antwort({
                hits: [ort],
                sprachen: { hits: [sprache(ID_A, "Garethi")], total: 1 },
                vorkommen: { hits: [vorkommen(ID_B, "Baumdrache")], total: 1 },
                anfrage: { begriff: BEGRIFF, praepositionen: PRAEPOSITIONEN },
            }),
            "baumdrache",
        );
        expect(ansicht.sektionen.map((sektion) => sektion.id)).toEqual(["vorkommen", "hits", "sprachen"]);
    });

    it("eine Antwort NUR mit Sprachen ist nicht „nichts gefunden“, und „… und N weitere“ rechnet Gesamtzahl minus Gezeigte", () => {
        const ansicht = baueAnsicht(
            antwort({ sprachen: { hits: [sprache(ID_A, "Garethi"), sprache(ID_B, "Garethisch")], total: 8 } }),
            "gar",
        );
        expect(ansicht.flach).toHaveLength(2);
        expect(ansicht.sektionen[0]?.weitere).toBe(6);
        expect(ansicht.sektionen[0]?.ungeprueft).toBe(0);
    });

    it("Ziele: je Gruppe mit Treffern eine Sektion mit der ganzen Anfrage im Titel; leere Gruppen fehlen", () => {
        const anfrage: SearchAnfrage = {
            begriff: BEGRIFF,
            praeposition: "in",
            ziele: [
                gruppe("landschaft", [ziel("Bornland", { genannt: true }), ziel("Orkland")], { total: 8 }),
                gruppe("gebiet", []),
            ],
        };
        const ansicht = baueAnsicht(antwort({ anfrage }), "Baumdrache in ");
        expect(ansicht.sektionen).toHaveLength(1);
        expect(ansicht.sektionen[0]?.titel).toEqual({
            art: "ziele",
            begriff: "Baumdrache",
            praeposition: "in",
            gruppe: "landschaft",
        });
        expect(ansicht.sektionen[0]?.weitere).toBe(6);
        expect(ansicht.flach).toHaveLength(2);
        expect(ansicht.zieleErklaerung).toBe(true);
        expect(ansicht.zieleLeer).toBe(false);
        expect(ansicht.zieleFehlen).toBe(false);
    });

    it("🔴 fehlt `ziele` bei ganzer Präposition, wurde nicht gerechnet: erneut fragen, nie „keine Treffer“", () => {
        const ansicht = baueAnsicht(antwort({ anfrage: { begriff: BEGRIFF, praeposition: "in" } }), "Baumdrache in");
        expect(ansicht.zieleFehlen).toBe(true);
        expect(ansicht.zieleLeer).toBe(false);
    });

    it("leere Ziele heißen „keine Orte mit Treffern“", () => {
        const ansicht = baueAnsicht(
            antwort({
                anfrage: {
                    begriff: BEGRIFF,
                    praeposition: "in",
                    ziele: [gruppe("landschaft", []), gruppe("gebiet", [])],
                },
            }),
            "Baumdrache in Nirgendwo",
        );
        expect(ansicht.zieleLeer).toBe(true);
        expect(ansicht.zieleFehlen).toBe(false);
    });

    it("ein Ziel ohne Anfrage (zwischen A und …) bleibt wählbar und ergänzt nur den Text", () => {
        const offen = ziel("Gareth", { text: "Baumdrache zwischen Gareth und " });
        delete (offen as { gegenden?: number }).gegenden;
        delete (offen as { leuchten?: unknown }).leuchten;
        const ansicht = baueAnsicht(
            antwort({ anfrage: { begriff: BEGRIFF, praeposition: "zwischen", ziele: [gruppe("ort", [offen])] } }),
            "Baumdrache zwischen ",
        );
        expect(ansicht.flach).toHaveLength(1);
        expect(ansicht.flach[0]?.art === "ziel" && ansicht.flach[0].hit.leuchten).toBeUndefined();
    });

    it("„N nicht geprüft“ steht nur, wo getippt wurde; bei leerem Rest ist die Liste ein Vorschlag", () => {
        const anfrage: SearchAnfrage = {
            begriff: BEGRIFF,
            praeposition: "in",
            ziele: [gruppe("landschaft", [ziel("Kosch")], { ungeprueft: 593 })],
        };
        expect(baueAnsicht(antwort({ anfrage }), "Baumdrache in ").sektionen[0]?.ungeprueft).toBe(0);
        expect(baueAnsicht(antwort({ anfrage }), "Baumdrache in K").sektionen[0]?.ungeprueft).toBe(593);
    });
});

describe("Chips und leise Zeile", () => {
    const anfrage = (praepositionen: string[]): SearchAnfrage => ({ begriff: BEGRIFF, praepositionen });
    const sektion = { hits: [vorkommen(ID_A, "Baumdrache")], total: 1 };

    it("der Begriff ohne Leerzeichen zeigt die leise Zeile, kein Chip", () => {
        const ansicht = baueAnsicht(antwort({ vorkommen: sektion, anfrage: anfrage(PRAEPOSITIONEN) }), "baumdrache");
        expect(ansicht.chips).toBeUndefined();
        expect(ansicht.hinweis).toBe(true);
    });

    it("mit Leerzeichen dahinter stehen die Präpositionen als Chips", () => {
        const ansicht = baueAnsicht(antwort({ vorkommen: sektion, anfrage: anfrage(PRAEPOSITIONEN) }), "baumdrache ");
        expect(ansicht.chips).toEqual({ begriff: "Baumdrache", praepositionen: PRAEPOSITIONEN });
        expect(ansicht.hinweis).toBe(false);
    });

    it("eine eingegrenzte Liste („baumdrache n“) zeigt Chips, auch ohne Leerzeichen am Ende", () => {
        expect(zeigtChips(anfrage(["nördlich von"]), "baumdrache n")).toBe(true);
        expect(zeigtChips(anfrage(PRAEPOSITIONEN), "baumdrache")).toBe(false);
        expect(zeigtChips(undefined, "baumdrache ")).toBe(false);
        expect(zeigtChips({ begriff: BEGRIFF, praeposition: "in" }, "baumdrache in ")).toBe(false);
    });
});

describe("restLeer", () => {
    const anfrage: SearchAnfrage = { begriff: BEGRIFF, praeposition: "südlich von", ziele: [] };
    it("nach der Präposition steht noch nichts", () => {
        expect(restLeer(anfrage, "Baumdrache südlich von ")).toBe(true);
        expect(restLeer(anfrage, "Baumdrache südlich von Gareth")).toBe(false);
        expect(restLeer({ begriff: BEGRIFF }, "Baumdrache")).toBe(false);
    });
});

describe("Zahlen", () => {
    const zahl = (extra: Partial<SearchZahl>): SearchZahl => ({
        id: ID_A,
        gegenden: 0,
        orte: 0,
        nurKontinent: false,
        ...extra,
    });

    it("ohne Kartenbezug steht „noch kein Ort“, noch ehe eine Zahl da ist", () => {
        expect(zahlAnzeige(vorkommen(ID_A, "A", { kartenbezug: false }), undefined)).toEqual({ art: "keinOrt" });
    });

    it("solange die Zahl fehlt, steht nichts da", () => {
        expect(zahlAnzeige(vorkommen(ID_A, "A"), undefined)).toEqual({ art: "keine" });
    });

    it("Gegenden gehen vor Orten, „überall“ nur ohne beides", () => {
        const hit = vorkommen(ID_A, "A");
        expect(zahlAnzeige(hit, zahl({ gegenden: 5, orte: 2 }))).toEqual({ art: "gegenden", n: 5 });
        expect(zahlAnzeige(hit, zahl({ orte: 2 }))).toEqual({ art: "orte", n: 2 });
        expect(zahlAnzeige(hit, zahl({ nurKontinent: true }))).toEqual({ art: "ueberall" });
        expect(zahlAnzeige(hit, zahl({}))).toEqual({ art: "keinOrt" });
    });

    it("gefragt werden nur sichtbare Vorkommen mit Kartenbezug, höchstens fünf", () => {
        const hits = Array.from({ length: 7 }, (_, i) =>
            vorkommen(`00000000-0000-4000-8000-00000000000${String(i)}`, `V${String(i)}`, { kartenbezug: i !== 1 }),
        );
        const ansicht = baueAnsicht(antwort({ vorkommen: { hits, total: 7 } }), "v");
        const ids = zahlenFragen(ansicht);
        expect(ids).toHaveLength(5);
        expect(ids).not.toContain(hits[1]?.id);
    });

    it("ein Ziel nennt Gegenden, sonst Orte, sonst nichts", () => {
        expect(zielZahl(ziel("A", { gegenden: 4, orte: 1 }))).toEqual({ art: "gegenden", n: 4 });
        expect(zielZahl(ziel("A", { gegenden: 0, orte: 2 }))).toEqual({ art: "orte", n: 2 });
        const ohne = ziel("A");
        delete (ohne as { gegenden?: number }).gegenden;
        expect(zielZahl(ohne)).toBeUndefined();
    });
});

describe("Der Text der Zeile einer Sprache (WI-0261 S5c)", () => {
    it("über den Namen: Art, keine Erklärung, Zahl der Gegenden", () => {
        expect(spracheZeilenText(sprache(ID_A, "Garethi"))).toEqual({
            art: { key: "sprache.art.sprache" },
            detail: undefined,
            gegenden: 3,
        });
    });

    it("eine Gruppe heißt „Sprachgruppe“; über einen Wiki-Artikel oder die Legende gefunden, steht dieser Text da", () => {
        const gruppe = sprache(ID_A, "Thorwalsch", { gruppe: true, gefundenIn: "wiki", ueber: "Gjalskisch" });
        expect(spracheZeilenText(gruppe)).toMatchObject({
            art: { key: "sprache.art.sprachgruppe" },
            detail: "Gjalskisch",
        });
        const legende = sprache(ID_A, "Thorwalsch", {
            gruppe: true,
            gefundenIn: "legende",
            ueber: "Thorwalsch / Gjalskisch / Fjarningsch",
        });
        expect(spracheZeilenText(legende).detail).toBe("Thorwalsch / Gjalskisch / Fjarningsch");
    });

    it("ein Dialekt nennt die Sprache, zu der er gehört: „Dialekt von …“, ohne weitere Erklärung (er steht schon im Namen)", () => {
        const dialekt = sprache(ID_A, "Horathi", { gefundenIn: "dialekt", dialektVon: "Garethi" });
        expect(spracheZeilenText(dialekt)).toEqual({
            art: { key: "search.sprache.dialektVon", params: { sprache: "Garethi" } },
            detail: undefined,
            gegenden: 3,
        });
    });

    it("eine Sprache ohne Fläche trägt null Gegenden (die Zeile sagt „noch keine Fläche“)", () => {
        expect(spracheZeilenText(sprache(ID_A, "Trollisch", { gegenden: 0 })).gegenden).toBe(0);
    });
});
