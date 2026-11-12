import { describe, expect, it } from "vitest";
import type {
    SearchEintrag,
    SearchEintragGegend,
    SearchEintragOrt,
    SearchEintragWo,
    SourceEntry,
} from "@avesmaps3d/shared";
import {
    CC_BY_SA_3_LINK,
    WO_MAX,
    WO_SICHT,
    autorenUrl,
    hatWeitere,
    kontinentFeld,
    lizenzLink,
    publikationenVon,
    restSatz,
    sichtbareZeilen,
    untertitelTeile,
    woGruppen,
    zeilenZahl,
    type WoRelation,
    type WoZeile,
} from "../src/info-panel/eintrag-wo";
import { de } from "../src/i18n/de";

/**
 * „Wo es vorkommt“ im Panel eines Vorkommens (WI-0260) als reine Daten: Welche Gruppen es gibt und in welcher Folge, was zuerst und was nach „Weitere anzeigen“ zu sehen ist, welcher Satz unter einer zu langen Liste
 * steht und was im Untertitel und in den Feldern steht. Ohne Vue und ohne Browser.
 */

const ID = "165000d1-21db-479c-a677-a9f21686c517";
const ziel = (n: number) => ({ landschaften: [`00000000-0000-4000-8000-${String(n).padStart(12, "0")}`] });

const gegend = (name: string, relation: WoRelation = "verbreitung", typ = "wald"): SearchEintragGegend => ({
    key: `l:${name.toLowerCase()}`,
    name,
    kind: "landschaft",
    typ,
    relation,
    ziel: ziel(name.length),
});
const gebiet = (name: string, relation: WoRelation = "verbreitung"): SearchEintragGegend => ({
    key: `g:${name.toLowerCase()}`,
    name,
    kind: "gebiet",
    typ: "Grafschaft",
    relation,
    ziel: { gebiet: "11111111-1111-4111-8111-111111111111" },
});
const ort = (
    name: string,
    relation: SearchEintragOrt["relation"] = "verbreitung",
    klasse = "stadt",
): SearchEintragOrt => ({
    ref: { kind: "place", id: `22222222-2222-4222-8222-${String(name.length).padStart(12, "0")}` },
    name,
    klasse,
    relation,
});
/** Ein Gipfel ist ein Ort mit dem Ref eines Gipfels (`klasse`: `berggipfel`, `vulkan`). */
const gipfel = (name: string, klasse = "berggipfel"): SearchEintragOrt => ({
    ref: { kind: "peak", id: "33333333-3333-4333-8333-333333333333" },
    name,
    klasse,
    relation: "verbreitung",
});
const wo = (
    gegenden: SearchEintragGegend[],
    orte: SearchEintragOrt[] = [],
    auchGenannt: string[] = [],
): SearchEintragWo => ({
    gegenden,
    orte,
    auchGenannt,
});
const namen = (zeilen: readonly WoZeile[]): string[] => zeilen.map((zeile) => zeile.name);

describe("🔴 die Gruppen von „Wo es vorkommt“", () => {
    it("Gegenden und Orte: erst die Gegenden, dann die Orte; die Folge des Servers bleibt", () => {
        const gruppen = woGruppen(
            "fauna",
            wo(
                [gegend("Kosch"), gegend("Albernia"), gegend("Gebiet 10"), gegend("Gebiet 2")],
                [ort("Gareth"), ort("Angbar")],
            ),
        );
        expect(gruppen.map((gruppe) => gruppe.id)).toEqual(["gegenden", "orte"]);
        expect(namen(gruppen[0]?.zeilen ?? [])).toEqual(["Kosch", "Albernia", "Gebiet 10", "Gebiet 2"]);
        expect(namen(gruppen[1]?.zeilen ?? [])).toEqual(["Gareth", "Angbar"]);
        expect(gruppen.map((gruppe) => gruppe.titel)).toEqual(["eintrag.gruppe.gegenden", "eintrag.gruppe.orte"]);
    });

    it("was das Wiki nennt, steht für sich; was nur aus dem Lebensraum folgt, in „Weitere nach Lebensraum“ darunter", () => {
        const gruppen = woGruppen("flora", wo([gegend("Kosch"), gegend("Zorgan", "regel"), gegend("Almada", "regel")]));
        expect(gruppen.map((gruppe) => gruppe.id)).toEqual(["gegenden", "regel"]);
        expect(namen(gruppen[0]?.zeilen ?? [])).toEqual(["Kosch"]);
        expect(namen(gruppen[1]?.zeilen ?? [])).toEqual(["Zorgan", "Almada"]);
        expect(gruppen[1]?.titel).toBe("eintrag.gruppe.regel");
    });

    it("gibt es nur Regeltreffer, steht EINE Gruppe „Gegenden“; die Überschrift „Weitere nach Lebensraum“ wäre falsch", () => {
        const gruppen = woGruppen("fauna", wo([gegend("Almada", "regel"), gegend("Zorgan", "regel")]));
        expect(gruppen.map((gruppe) => gruppe.id)).toEqual(["gegenden"]);
    });

    it("eine Ware mit Herkunft: Herkunft (Gegenden und Orte), Verbreitung, Orte", () => {
        const gruppen = woGruppen(
            "ware",
            wo(
                [gegend("Liebliches Feld", "herkunft", "region"), gegend("Grafschaft Sikram"), gebiet("Baronie Nord")],
                [ort("Radoleth", "herkunft"), ort("Gareth")],
            ),
        );
        expect(gruppen.map((gruppe) => gruppe.id)).toEqual(["herkunft", "verbreitung", "orte"]);
        expect(namen(gruppen[0]?.zeilen ?? [])).toEqual(["Liebliches Feld", "Radoleth"]);
        expect(namen(gruppen[1]?.zeilen ?? [])).toEqual(["Grafschaft Sikram", "Baronie Nord"]);
        expect(namen(gruppen[2]?.zeilen ?? [])).toEqual(["Gareth"]);
        expect(gruppen[0]?.zeilen.map((zeile) => zeile.art)).toEqual(["gegend", "ort"]);
    });

    it("eine Ware ohne Herkunft, und jede andere Art mit „Herkunft“ im Wiki, bleibt bei Gegenden und Orten", () => {
        expect(woGruppen("ware", wo([gegend("Kosch")], [ort("Gareth")])).map((gruppe) => gruppe.id)).toEqual([
            "gegenden",
            "orte",
        ]);
        expect(woGruppen("fauna", wo([gegend("Kosch", "herkunft")])).map((gruppe) => gruppe.id)).toEqual(["gegenden"]);
    });

    it("eine Gruppe ohne Zeile entsteht nicht; ohne alles bleibt die Liste leer", () => {
        expect(woGruppen("fauna", wo([], [ort("Gareth")])).map((gruppe) => gruppe.id)).toEqual(["orte"]);
        expect(woGruppen("fauna", wo([]))).toEqual([]);
        expect(zeilenZahl(wo([gegend("Kosch")], [ort("Gareth"), ort("Angbar")]))).toBe(3);
    });

    it("eine Zeile trägt Namen, Art in Worten und ihr Ziel; ein Ort trägt seinen Ref; keine Zahl steht in der Zeile", () => {
        const [gegenden, orte] = woGruppen(
            "fauna",
            wo([gegend("Kosch", "verbreitung", "wald"), gebiet("Baronie Nord")], [gipfel("Raschtulswall")]),
        );
        const kosch = gegenden?.zeilen.find((zeile) => zeile.name === "Kosch");
        expect(kosch).toMatchObject({ art: "gegend", typ: de["landscape.type.wald"] });
        expect(kosch?.art === "gegend" ? kosch.gegend.ziel : undefined).toEqual(ziel(5));
        // Die Art eines Herrschaftsgebiets steht so in den Daten.
        expect(gegenden?.zeilen.find((zeile) => zeile.name === "Baronie Nord")?.typ).toBe("Grafschaft");
        const spitze = orte?.zeilen[0];
        expect(spitze).toMatchObject({ art: "ort", typ: de["peak.berggipfel"] });
        expect(spitze?.art === "ort" ? spitze.ort.ref.kind : undefined).toBe("peak");
        for (const zeile of [...(gegenden?.zeilen ?? []), ...(orte?.zeilen ?? [])]) {
            expect(Object.keys(zeile)).not.toContain("zahl");
            expect(`${zeile.name} ${zeile.typ}`).not.toMatch(/\d/u);
        }
    });

    it("die Klasse eines Orts steht in der Sprache der Seite; eine unbekannte Art bleibt, wie sie ist", () => {
        const [gruppe] = woGruppen(
            "fauna",
            wo([], [ort("Gareth", "verbreitung", "metropole"), ort("Fernort", "verbreitung", "festung")]),
        );
        expect(gruppe?.zeilen.map((zeile) => zeile.typ)).toEqual([de["place.metropole"], "festung"]);
    });

    it("eine Landmarke heißt nach ihrer Art (WI-0271 L6), eine unbekannte Art „Gipfel“", () => {
        const [gruppe] = woGruppen(
            "fauna",
            wo(
                [],
                [
                    gipfel("Feuerberg", "vulkan"),
                    gipfel("Hohe Spitze"),
                    gipfel("Drachenhöhle", "hoehle"),
                    gipfel("Irgendwas", "unbekannt"),
                ],
            ),
        );
        expect(gruppe?.zeilen.map((zeile) => zeile.typ).sort()).toEqual(
            [de["peak.vulkan"], de["peak.berggipfel"], de["peak.hoehle"], de["inhalte.kind.peak"]].sort(),
        );
    });
});

describe("🔴 die Kürzung: acht Zeilen, mit „Weitere anzeigen“ bis vierzig, dann der Satz", () => {
    const viele = (n: number, relation: WoRelation = "verbreitung"): WoZeile[] =>
        woGruppen(
            "fauna",
            wo(Array.from({ length: n }, (_, i) => gegend(`Gegend ${String(i + 1).padStart(3, "0")}`, relation))),
        )[0]?.zeilen.slice() ?? [];

    it("zu Anfang acht, danach höchstens vierzig", () => {
        const zeilen = viele(100);
        expect(sichtbareZeilen(zeilen, false)).toHaveLength(WO_SICHT);
        expect(sichtbareZeilen(zeilen, true)).toHaveLength(WO_MAX);
        expect([WO_SICHT, WO_MAX]).toEqual([8, 40]);
    });

    it("„Weitere anzeigen“ gibt es erst bei mehr als acht Zeilen", () => {
        expect(hatWeitere(viele(8))).toBe(false);
        expect(hatWeitere(viele(9))).toBe(true);
        expect(sichtbareZeilen(viele(9), true)).toHaveLength(9);
    });

    it("der Satz steht nur unter einer Gruppe, die ganz zu sehen ist, und er nennt, wie viele nicht dastehen", () => {
        expect(restSatz(viele(40), true)).toBeUndefined();
        expect(restSatz(viele(41), false)).toBeUndefined();
        expect(restSatz(viele(41), true)).toEqual({ key: "eintrag.rest.gegenden", n: 1 });
        expect(restSatz(viele(100), true)).toEqual({ key: "eintrag.rest.gegenden", n: 60 });
        // Was nur aus dem Lebensraum folgt, sagt es.
        expect(restSatz(viele(60, "regel"), true)).toEqual({ key: "eintrag.rest.regel", n: 20 });
        const orte =
            woGruppen(
                "fauna",
                wo(
                    [],
                    Array.from({ length: 45 }, (_, i) => ort(`Ort ${String(i)}`)),
                ),
            )[0]?.zeilen ?? [];
        expect(restSatz(orte, true)).toEqual({ key: "eintrag.rest.orte", n: 5 });
    });

    it("die Gegenden, die der Server nicht mitschickt (`weitere`), kommen zu den Zeilen über vierzig dazu - und der Satz steht auch unter einer kurzen Liste", () => {
        // Eine kurze Liste ohne „Weitere anzeigen“: Der Satz steht sofort da.
        expect(restSatz(viele(5), false, 2_700)).toEqual({ key: "eintrag.rest.gegenden", n: 2_700 });
        // Eine lange: erst nach „Weitere anzeigen“, mit den Zeilen darüber.
        expect(restSatz(viele(60, "regel"), false, 2_740)).toBeUndefined();
        expect(restSatz(viele(60, "regel"), true, 2_740)).toEqual({ key: "eintrag.rest.regel", n: 2_760 });
        // Sie gehören der Gruppe der Regeln, sonst der letzten mit Gegenden; nie den Orten.
        const mitRegel = woGruppen("fauna", {
            ...wo([gegend("Kosch"), gegend("Almada", "regel")], [ort("Gareth")]),
            weitere: 12,
        });
        expect(mitRegel.map((gruppe) => [gruppe.id, gruppe.weitere])).toEqual([
            ["gegenden", 0],
            ["regel", 12],
            ["orte", 0],
        ]);
        const nurNamen = woGruppen("ware", {
            ...wo([gegend("Kosch", "herkunft"), gegend("Zorgan")], [ort("Gareth")]),
            weitere: 3,
        });
        expect(nurNamen.map((gruppe) => [gruppe.id, gruppe.weitere])).toEqual([
            ["herkunft", 0],
            ["verbreitung", 3],
            ["orte", 0],
        ]);
        expect(woGruppen("fauna", wo([gegend("Kosch")])).every((gruppe) => gruppe.weitere === 0)).toBe(true);
    });
});

describe("der Untertitel, die Felder und die Quellen", () => {
    const eintrag = (extra: Partial<SearchEintrag>): SearchEintrag => ({
        id: ID,
        name: "Sikrami",
        kind: "ware",
        kartenbezug: true,
        gegenden: 0,
        orte: 0,
        nurKontinent: false,
        leuchten: { eintrag: ID },
        ziele: [],
        kurzbeschreibung: null,
        typ: null,
        kontinent: null,
        wo: wo([]),
        publikationen: [],
        ...extra,
    });

    it("eine Ware nennt ihren Gegenstandstyp: „Ware · Hartwurst · profan“", () => {
        expect(untertitelTeile(eintrag({ typ: "Hartwurst", gruppe: "profan" }))).toEqual([
            de["eintrag.art.ware"],
            "Hartwurst",
            "profan",
        ]);
        // Was fehlt, fehlt: kein leerer Platz zwischen den Punkten.
        expect(untertitelTeile(eintrag({ typ: null, gruppe: "profan" }))).toEqual([de["eintrag.art.ware"], "profan"]);
        expect(untertitelTeile(eintrag({ typ: "" }))).toEqual([de["eintrag.art.ware"]]);
    });

    it("alles andere nennt Art und Gruppe: „Fauna · Niederer Drache“, und eine Spezies steht allein", () => {
        expect(untertitelTeile(eintrag({ kind: "fauna", gruppe: "Niederer Drache", typ: "ignoriert" }))).toEqual([
            de["infoPanel.lore.fauna"],
            "Niederer Drache",
        ]);
        expect(untertitelTeile(eintrag({ kind: "spezies" }))).toEqual([de["infoPanel.lore.spezies"]]);
    });

    it("der Kontinent ist ein Feld nur, wo er nicht Aventurien ist", () => {
        expect(kontinentFeld("Aventurien")).toBeUndefined();
        expect(kontinentFeld(" aventurien ")).toBeUndefined();
        expect(kontinentFeld(null)).toBeUndefined();
        expect(kontinentFeld("")).toBeUndefined();
        expect(kontinentFeld("Myranor")).toBe("Myranor");
        expect(kontinentFeld("Aventurien/Myranor")).toBe("Aventurien / Myranor");
    });

    it("die Publikationen gehen unverändert an den Quellenkasten; ohne sie gibt es keine Liste", () => {
        const eintragA: SourceEntry = {
            title: "Aventurisches Bestiarium",
            type: "regionalspielhilfe",
            official: true,
            referenceKind: "ausfuehrlich",
            pages: "32, 33",
        };
        expect(publikationenVon(eintrag({ publikationen: [eintragA] }))).toEqual([eintragA]);
        expect(publikationenVon(eintrag({ publikationen: [] }))).toBeUndefined();
        expect(publikationenVon(eintrag({}))).toBeUndefined();
    });
});

describe("🔴 die Lizenzzeile der Kurzbeschreibung: Wiki, Autoren, Lizenz", () => {
    it("die Seite der Autoren eines Artikels entsteht aus seiner Adresse", () => {
        expect(autorenUrl("https://de.wiki-aventurica.de/wiki/Sikrami")).toBe(
            "https://de.wiki-aventurica.de/wiki/Sikrami?action=credits",
        );
        // Umlaute und Leerzeichen stehen schon kodiert im Pfad und bleiben es.
        expect(autorenUrl("https://de.wiki-aventurica.de/wiki/Gro%C3%9Fer_Wurm")).toBe(
            "https://de.wiki-aventurica.de/wiki/Gro%C3%9Fer_Wurm?action=credits",
        );
        expect(autorenUrl("https://de.wiki-aventurica.de/wiki/Großer Wurm")).toBe(
            "https://de.wiki-aventurica.de/wiki/Gro%C3%9Fer%20Wurm?action=credits",
        );
    });

    it("eine Adresse anderer Form, ein Text und eine Adresse ohne https haben keine Seite der Autoren", () => {
        expect(autorenUrl("https://de.wiki-aventurica.de/index.php?title=Sikrami")).toBeUndefined();
        expect(autorenUrl("Sikrami")).toBeUndefined();
        expect(autorenUrl("http://de.wiki-aventurica.de/wiki/Sikrami")).toBeUndefined();
        expect(autorenUrl("javascript:alert(1)")).toBeUndefined();
    });

    it("CC BY-SA 3.0 führt auf die deutsche Zusammenfassung, jede andere Lizenz dahin, wo der Server sie nennt", () => {
        expect(lizenzLink({ name: "CC BY-SA 3.0", uri: "https://creativecommons.org/licenses/by-sa/3.0/" })).toBe(
            CC_BY_SA_3_LINK,
        );
        expect(lizenzLink({ name: "CC BY-SA 3.0" })).toBe("https://creativecommons.org/licenses/by-sa/3.0/deed.de");
        expect(lizenzLink({ name: "CC BY-SA 4.0", uri: "https://creativecommons.org/licenses/by-sa/4.0/" })).toBe(
            "https://creativecommons.org/licenses/by-sa/4.0/",
        );
        expect(lizenzLink({ name: "Eigene Lizenz" })).toBeUndefined();
    });
});
