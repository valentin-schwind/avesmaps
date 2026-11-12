import { beforeEach, describe, expect, it } from "vitest";
import type { MapHistoryEntry, MapHistoryObject, MapHistoryPage, MapHistorySeries } from "@avesmaps3d/shared";
import {
    brauchtDetail,
    detailGegenstaende,
    mitDetail,
    serienDetail,
    zeilenAusFeldern,
} from "../src/aenderungen/aenderung-detail-modell";
import {
    LEERER_FILTER,
    aenderungenFrage,
    eintragsKreis,
    gesetzteFilter,
    gruppiere,
    objektZiel,
    personenAus,
    serienName,
    serienZustand,
    sprungGegenstand,
    zaehle,
    zeitraumVon,
    type SerienZeile,
} from "../src/aenderungen/aenderung-modell";
import { nichtRuecknehmbarSatz, wertText } from "../src/aenderungen/aenderung-text";
import { t } from "../src/i18n/i18n";
import { createAenderungenDaten } from "../src/aenderungen/aenderungen-daten";
import { createAenderungenListe } from "../src/aenderungen/aenderungen-liste";
import {
    gilt,
    leereSprung,
    nimmZuAenderungen,
    nimmZumObjektverlauf,
    springeZuAenderungen,
    springeZumObjektverlauf,
    sprungReiterWunsch,
    SPRUNG_GILT_MS,
} from "../src/aenderungen/sprung";

/**
 * Reiter „Änderungen“ (WI-0265 B5a): Frage an den Server, Serien als Gruppen, Zustand, Detail mit nachgeladenen Werten und fehlender früherer
 * Form, Seiten und Sprung. Ohne Bauteil und ohne Browser; die Bauteile selbst prüft die Sichtprüfung gegen die Probierseite.
 */

const JETZT = new Date(2026, 9, 31, 15, 10, 0);
const id = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const PERSON = "11111111-1111-4111-8111-111111111111";

function gegenstand(teil: Partial<MapHistoryObject> & Pick<MapHistoryObject, "kind" | "id">): MapHistoryObject {
    return {
        action: "landscape.updated",
        revisionBefore: 3,
        revisionAfter: 4,
        changes: {},
        ...teil,
    };
}

function eintrag(n: number, teil: Partial<MapHistoryEntry> = {}): MapHistoryEntry {
    return {
        operationId: id(n),
        seq: 1000 + n,
        at: new Date(2026, 9, 31, 14, n, 0).toISOString(),
        operation: "landscape.update",
        source: "editor",
        summary: `Blutzinnen: Schritt ${String(n)}`,
        actor: { kind: "person", id: PERSON, name: "Vali" },
        status: "ruecknehmbar",
        objects: [
            gegenstand({
                kind: "landscape",
                id: id(900),
                name: "Blutzinnen",
                changes: { name: { before: "A", after: "B" } },
            }),
        ],
        ...teil,
    };
}

const serieMeta = (ids: number[], teil: Partial<MapHistorySeries> = {}): MapHistorySeries => ({
    id: id(Math.min(...ids)),
    size: ids.length,
    delivered: ids.length,
    members: ids.map(id),
    membersHash: "hash",
    scope: { kind: "landscape", id: id(900), name: "Blutzinnen" },
    ...teil,
});

const mitSerie = (n: number, ids: number[]): MapHistoryEntry =>
    eintrag(n, { series: { id: id(Math.min(...ids)), position: ids.indexOf(n) + 1, size: ids.length } });

describe("Die Frage an den Server (alle Filter wirken dort)", () => {
    it("🔴 ohne Filter: keine Parameter; „Meine“ schickt mine, unter „Meine“ gilt keine Person", () => {
        expect(aenderungenFrage(LEERER_FILTER, { jetzt: JETZT })).toBe("");
        expect(aenderungenFrage({ ...LEERER_FILTER, tab: "meine", person: PERSON }, { jetzt: JETZT })).toBe(
            "mine=true",
        );
        expect(aenderungenFrage({ ...LEERER_FILTER, person: PERSON }, { jetzt: JETZT })).toBe(`person=${PERSON}`);
    });

    it("Art, Objekt, Zustand, Suche mit den Feldnamen, Cursor und Grenze", () => {
        const frage = new URLSearchParams(
            aenderungenFrage(
                {
                    ...LEERER_FILTER,
                    art: "landscape",
                    objekt: { ref: `landscape:${id(900)}`, name: "Blutzinnen" },
                    status: "bereits_zurueckgenommen",
                    q: " Kamm ",
                    qFelder: ["gebirge", "name"],
                },
                { before: 1007, limit: 50, jetzt: JETZT },
            ),
        );
        expect(Object.fromEntries(frage)).toEqual({
            kind: "landscape",
            object: `landscape:${id(900)}`,
            status: "bereits_zurueckgenommen",
            q: "Kamm",
            qFelder: "gebirge,name",
            limit: "50",
            before: "1007",
        });
    });

    it("🔴 der Zeitraum geht mit Zeitzone: „heute“ ab Mitternacht Ortszeit, „Jahr“ ab dem 1. Januar", () => {
        expect(zeitraumVon("heute", JETZT)).toEqual(new Date(2026, 9, 31, 0, 0, 0));
        expect(zeitraumVon("jahr", JETZT)).toEqual(new Date(2026, 0, 1));
        expect(zeitraumVon("tage7", JETZT).getTime()).toBe(JETZT.getTime() - 7 * 86_400_000);
        const von = new URLSearchParams(
            aenderungenFrage({ ...LEERER_FILTER, zeitraum: "tage30" }, { jetzt: JETZT }),
        ).get("from");
        expect(von).toMatch(/Z$|[+-]\d\d:\d\d$/u);
        expect(new Date(von!).getTime()).toBe(JETZT.getTime() - 30 * 86_400_000);
    });

    it("der Trichter zählt Person, Zeitraum, Art, Objekt und Zustand; „Meine“ und die Suche zählen nicht", () => {
        expect(gesetzteFilter({ ...LEERER_FILTER, tab: "meine", q: "x" })).toBe(0);
        expect(gesetzteFilter({ ...LEERER_FILTER, person: PERSON, zeitraum: "heute", status: "ruecknehmbar" })).toBe(3);
    });
});

describe("Arbeitsserien als Gruppen der Liste", () => {
    const ids = [3, 5, 6];
    // Neueste zuerst; dazwischen ein Eintrag einer anderen Sache (Serien gelten je Gegenstand, nicht je Zeitfolge).
    const liste = [
        mitSerie(6, ids),
        eintrag(9, { objects: [] }),
        mitSerie(5, ids),
        eintrag(4, { objects: [] }),
        mitSerie(3, ids),
    ];

    it("🔴 eine Serie steht an der Stelle ihres neuesten Mitglieds; die übrigen rücken hinein, die Reihenfolge bleibt", () => {
        const zeilen = gruppiere(liste, new Map([[serieMeta(ids).id, serieMeta(ids)]]));
        expect(zeilen.map((z) => z.art)).toEqual(["serie", "eintrag", "eintrag"]);
        const serie = zeilen[0] as SerienZeile;
        expect(serie.mitglieder.map((m) => m.operationId)).toEqual([id(6), id(5), id(3)]);
        expect(serie.meta?.size).toBe(3);
        expect(serienName(serie)).toBe("Blutzinnen");
    });

    it("ohne Meta nennt das erste Mitglied den Namen; Einträge ohne `series` bleiben einzeln", () => {
        const zeilen = gruppiere([eintrag(1), eintrag(2)], new Map());
        expect(zeilen.every((z) => z.art === "eintrag")).toBe(true);
        const ohneMeta = gruppiere([mitSerie(6, ids)], new Map())[0] as SerienZeile;
        expect(ohneMeta.meta).toBeUndefined();
        expect(serienName(ohneMeta)).toBe("Blutzinnen");
    });

    it("🔴 der Zustand der Serie: ● wirksam, ◐ einige zurück (mit Zahl), ○ alle zurück, gesperrt nur nicht rücknehmbare", () => {
        const mit = (...status: NonNullable<MapHistoryEntry["status"]>[]): SerienZeile =>
            gruppiere(
                status.map((s, i) => ({ ...mitSerie(10 + i, [10, 11, 12].slice(0, status.length)), status: s })),
                new Map(),
            )[0] as SerienZeile;
        expect(serienZustand(mit("ruecknehmbar", "ruecknehmbar"))).toEqual({ kreis: "voll", zurueck: 0 });
        expect(serienZustand(mit("ruecknehmbar", "bereits_zurueckgenommen"))).toEqual({ kreis: "halb", zurueck: 1 });
        expect(serienZustand(mit("bereits_zurueckgenommen", "bereits_zurueckgenommen"))).toEqual({
            kreis: "leer",
            zurueck: 2,
        });
        expect(serienZustand(mit("nicht_ruecknehmbar", "nicht_ruecknehmbar")).kreis).toBe("gesperrt");
    });

    it("🔴 B6f: der Satz zum Grund: Quelle oder Art; sonst keiner (seit B6g3 gibt es keinen eigenen Satz zu Inhalten mehr)", () => {
        const nicht = (operation: string, statusReason?: "quelle" | "art"): MapHistoryEntry =>
            eintrag(1, {
                operation,
                status: "nicht_ruecknehmbar",
                ...(statusReason === undefined ? {} : { statusReason }),
            });
        expect(nichtRuecknehmbarSatz(nicht("place.create", "art"))).toBe(t("aenderungen.status.grund.art"));
        expect(nichtRuecknehmbarSatz(nicht("path.split", "art"))).toBe(t("aenderungen.status.grund.art"));
        // Quelle, Werk und Korpus (B6g1), das Vorkommen (B6g2) und die Quellen am Träger (B6g3): rücknehmbar; ihr Anlegen ist eine Art wie jedes andere Anlegen (der allgemeine Satz, nie „noch nicht“).
        for (const angelegt of ["source.create", "work.create", "corpus.create", "lore.create"])
            expect([angelegt, nichtRuecknehmbarSatz(nicht(angelegt, "art"))]).toEqual([
                angelegt,
                t("aenderungen.status.grund.art"),
            ]);
        expect(nichtRuecknehmbarSatz(nicht("place.update", "quelle"))).toBe(t("aenderungen.status.grund.quelle"));
        // Ohne Grund, rücknehmbar und zurückgenommen sagen nichts (der Hinweis „keine Zusage“ ist ein anderer Satz).
        expect(nichtRuecknehmbarSatz(nicht("place.update"))).toBeUndefined();
        expect(nichtRuecknehmbarSatz(eintrag(2))).toBeUndefined();
        expect(nichtRuecknehmbarSatz(eintrag(3, { status: "bereits_zurueckgenommen" }))).toBeUndefined();
    });

    it("🔴 B6f: der Kreis für nicht rücknehmbar mit Grund art ist derselbe durchgestrichene wie bei der Quelle; eine Serie nur aus Art ist gesperrt", () => {
        const art = eintrag(1, { status: "nicht_ruecknehmbar", statusReason: "art" });
        const quelleGrund = eintrag(2, { status: "nicht_ruecknehmbar", statusReason: "quelle" });
        expect(eintragsKreis(art.status)).toBe(eintragsKreis(quelleGrund.status));
        expect(eintragsKreis(art.status)).toBe("gesperrt");
        const serieArt = gruppiere(
            [
                { ...mitSerie(10, [10, 11]), status: "nicht_ruecknehmbar" as const, statusReason: "art" as const },
                { ...mitSerie(11, [10, 11]), status: "nicht_ruecknehmbar" as const, statusReason: "art" as const },
            ],
            new Map(),
        )[0] as SerienZeile;
        expect(serienZustand(serieArt)).toEqual({ kreis: "gesperrt", zurueck: 0 });
        expect(zaehle([art, quelleGrund], gruppiere([art, quelleGrund], new Map()))).toMatchObject({
            gesperrt: 2,
            wirksam: 0,
        });
    });

    it("der Kreis eines Eintrags: ● ○ und der durchgestrichene; ohne Zustand keiner", () => {
        expect(
            [undefined, "ruecknehmbar", "bereits_zurueckgenommen", "nicht_ruecknehmbar"].map((s) =>
                eintragsKreis(s as never),
            ),
        ).toEqual([undefined, "voll", "leer", "gesperrt"]);
    });

    it("die Zählung der Legende: Operationen je Zustand, teils zurückgenommene Serien, geladen", () => {
        const eintraege = [
            { ...mitSerie(1, [1, 2]), status: "ruecknehmbar" as const },
            { ...mitSerie(2, [1, 2]), status: "bereits_zurueckgenommen" as const },
            { ...eintrag(7), status: "nicht_ruecknehmbar" as const },
            eintrag(8),
        ];
        const zeilen = gruppiere(eintraege, new Map());
        expect(zaehle(eintraege, zeilen)).toEqual({ wirksam: 2, zurueck: 1, gesperrt: 1, teils: 1, geladen: 4 });
    });

    it("die Personen für den Trichter kommen aus den Einträgen, sortiert; wer einmal da war, bleibt", () => {
        const mara = { kind: "person" as const, id: "22222222-2222-4222-8222-222222222222", name: "Mara" };
        const bisher = personenAus([eintrag(1), eintrag(2, { actor: mara })]);
        expect([...bisher.values()]).toEqual(["Mara", "Vali"]);
        expect([...personenAus([eintrag(3, { actor: { kind: "system" } })], bisher).keys()]).toHaveLength(2);
    });
});

describe("Das gemeinsame Detail", () => {
    it("🔴 Werte, die die Liste weglässt (omitted), brauchen das Detail; mitDetail nimmt dessen Nutzlast und lässt den Kopf", () => {
        const liste = eintrag(1, {
            objects: [
                gegenstand({
                    kind: "landscape",
                    id: id(900),
                    changes: { geometry: { omitted: true }, name: { before: "A", after: "B" } },
                }),
            ],
        });
        expect(brauchtDetail(liste)).toBe(true);
        expect(brauchtDetail(eintrag(2))).toBe(false);
        const detail = eintrag(1, {
            summary: "anderes",
            objects: [
                gegenstand({
                    kind: "landscape",
                    id: id(900),
                    changes: { geometry: { before: [[1, 2]], after: [[3, 4]] } },
                }),
            ],
        });
        const voll = mitDetail(liste, detail);
        expect(voll.summary).toBe(liste.summary);
        expect(brauchtDetail(voll)).toBe(false);
        expect(detailGegenstaende(voll)[0]!.zeilen[0]).toMatchObject({
            feld: "geometry",
            hatVorher: true,
            omitted: false,
        });
    });

    it("🔴 frühere Form fehlt: aus formFehlt des Details, oder wenn der Gegenstand schon eine Revision hatte und kein `before` steht — nie ergänzt", () => {
        const g = gegenstand({
            kind: "path",
            id: id(1),
            revisionBefore: 7,
            changes: { geometry: { after: [[1, 2]] }, name: { before: "A", after: "B" } },
            formFehlt: ["geometry"],
        });
        const zeilen = detailGegenstaende(eintrag(1, { objects: [g] }))[0]!.zeilen;
        expect(zeilen.map((z) => [z.feld, z.formFehlt, z.hatVorher])).toEqual([
            ["geometry", true, false],
            ["name", false, true],
        ]);
        // Ohne die Auskunft des Details gilt dieselbe Regel; ein neu angelegter Gegenstand hat kein „Vorher“ zu vermissen.
        const ohne = gegenstand({
            kind: "path",
            id: id(1),
            revisionBefore: 7,
            changes: { position: { after: [1, 2] } },
        });
        const neu = gegenstand({
            kind: "path",
            id: id(2),
            revisionBefore: null,
            changes: { position: { after: [1, 2] } },
        });
        expect(detailGegenstaende(eintrag(1, { objects: [ohne] }))[0]!.zeilen[0]!.formFehlt).toBe(true);
        expect(detailGegenstaende(eintrag(1, { objects: [neu] }))[0]!.zeilen[0]!.formFehlt).toBe(false);
    });

    it("🔴 B6g2: der Grund einer Rücknahme (`restoreReason`) ist keine Feldzeile im Detail, auch nicht in der Serie; er steht als eigener Satz (`reason`)", () => {
        // Gilt für jede Familie: Der Server schreibt den Grund als Feld `restoreReason` (nur `after`) an jeden Eintrag der Rücknahme.
        for (const kind of ["lore", "source", "place", "landscape"] as const) {
            const g = gegenstand({
                kind,
                id: id(1),
                changes: {
                    name: { before: "A", after: "B" },
                    restoreReason: { after: "Falsche Angabe" },
                },
            });
            const e = eintrag(1, { source: "restore", reason: "Falsche Angabe", objects: [g] });
            expect(
                detailGegenstaende(e)[0]!.zeilen.map((z) => z.feld),
                kind,
            ).toEqual(["name"]);
            const serie = serienDetail([e], new Map());
            expect(
                serie.gegenstaende[0]!.zeilen.map((z) => z.feld),
                kind,
            ).toEqual(["name"]);
        }
        // Eine Rücknahme, die NUR den Grund trüge (nichts geschrieben), ergibt keine Zeile statt einer rohen.
        const nurGrund = gegenstand({ kind: "lore", id: id(2), changes: { restoreReason: { after: "x" } } });
        expect(detailGegenstaende(eintrag(2, { objects: [nurGrund] }))[0]!.zeilen).toEqual([]);
    });

    it("das Herkunftsfeld neben einem Feld ist keine eigene Zeile; ein verwaistes bleibt", () => {
        const g = gegenstand({
            kind: "place",
            id: id(1),
            changes: {
                name: { before: "A", after: "B" },
                nameOrigin: { before: "wiki", after: "manual" },
                parentOrigin: { after: "manual" },
            },
        });
        expect(detailGegenstaende(eintrag(1, { objects: [g] }))[0]!.zeilen.map((z) => z.feld)).toEqual([
            "name",
            "parentOrigin",
        ]);
    });

    it("die Felder des Objektverlaufs behalten ihre Folge, das Detail ergänzt, was nur die Gegenstände wissen", () => {
        const g = gegenstand({ kind: "path", id: id(1), revisionBefore: 2, changes: { kurve: { after: [[1, 2]] } } });
        const zeilen = zeilenAusFeldern(
            [
                { feld: "kurve", vorher: undefined, nachher: [[1, 2]] },
                { feld: "fremd", vorher: "x", nachher: "y" },
            ],
            [g],
        );
        expect(zeilen.map((z) => [z.feld, z.formFehlt])).toEqual([
            ["kurve", true],
            ["fremd", false],
        ]);
    });
});

describe("Gleiche Wechsel an mehreren Gegenständen einmal", () => {
    const abschnitt = (n: number, changes: MapHistoryObject["changes"]): MapHistoryObject =>
        gegenstand({ kind: "powerline", id: id(n), name: "Punin–Gareth", changes });

    it("🔴 eine Kraftlinie ändert ihren Namen an jedem Abschnitt: das Detail zeigt EINEN Gegenstand", () => {
        const name = { name: { before: "A", after: "B" } };
        const e = eintrag(1, { objects: [abschnitt(1, name), abschnitt(2, name)] });
        expect(detailGegenstaende(e)).toHaveLength(1);
        const serie = serienDetail(
            [eintrag(1, { objects: [abschnitt(1, name)] }), eintrag(2, { objects: [abschnitt(2, name)] })],
            new Map(),
        );
        expect(serie.gegenstaende).toHaveLength(1);
    });

    it("🔴 verschiedene Werte bleiben getrennt, und was noch nicht geladen ist (omitted), gilt nie als gleich", () => {
        const e = eintrag(1, {
            objects: [
                abschnitt(1, { name: { before: "A", after: "B" } }),
                abschnitt(2, { name: { before: "A", after: "C" } }),
            ],
        });
        expect(detailGegenstaende(e)).toHaveLength(2);
        const offen = eintrag(1, {
            objects: [abschnitt(1, { geometry: { omitted: true } }), abschnitt(2, { geometry: { omitted: true } })],
        });
        expect(detailGegenstaende(offen)).toHaveLength(2);
    });
});

describe("Vorher vor dem ersten, Nachher nach dem letzten „Fertig“", () => {
    const g = (n: number, changes: MapHistoryObject["changes"]): MapHistoryEntry =>
        eintrag(n, { objects: [gegenstand({ kind: "landscape", id: id(900), name: "Blutzinnen", changes })] });
    const mitglieder = [
        g(1, { gebirge: { omitted: true }, grat: { before: 14, after: 16 } }),
        g(2, { grat: { before: 16, after: 18 } }),
        g(3, { gebirge: { omitted: true } }),
    ];

    it("🔴 je Feld der älteste Wert vorher und der neueste nachher; Nutzlast nur für erstes und letztes Mitglied, das das Feld änderte", () => {
        const roh = serienDetail(mitglieder, new Map());
        const zeilen = roh.gegenstaende[0]!.zeilen;
        const grat = zeilen.find((z) => z.feld === "grat")!;
        expect([grat.vorher, grat.nachher]).toEqual([14, 18]);
        expect(grat.omitted).toBe(false);
        const gebirge = zeilen.find((z) => z.feld === "gebirge")!;
        expect(gebirge.omitted).toBe(true);
        expect(gebirge.braucht).toEqual([id(1), id(3)]);
        // Das mittlere Mitglied (2) braucht kein Detail, auch wenn es eines hätte.
        expect([...roh.fehlend].sort()).toEqual([id(1), id(3)]);
    });

    it("mit den nachgeladenen Werten ist nichts mehr offen, und das Vorher kommt vom ersten, das Nachher vom letzten", () => {
        const geladen = new Map<string, MapHistoryEntry>([
            [id(1), g(1, { gebirge: { before: { hoehe: 1 }, after: { hoehe: 2 } }, grat: { before: 14, after: 16 } })],
            [id(3), g(3, { gebirge: { before: { hoehe: 5 }, after: { hoehe: 6 } } })],
        ]);
        const neu = serienDetail(mitglieder, geladen);
        expect(neu.fehlend).toEqual([]);
        const gebirge = neu.gegenstaende[0]!.zeilen.find((z) => z.feld === "gebirge:hoehe")!;
        expect([gebirge.vorher, gebirge.nachher]).toEqual([1, 6]);
        expect(gebirge.omitted).toBe(false);
    });
});

describe("Werte, wie Menschen sie lesen", () => {
    it("leer als Strich, ja/nein, Zahlen, eine Lage, Linien als Zahl der Punkte, Großes gekürzt; nicht Geführtes bleibt undefined", () => {
        expect(wertText("x", undefined)).toBeUndefined();
        expect(wertText("x", null)).toBe("–");
        expect(wertText("x", "")).toBe("–");
        expect(wertText("x", true)).toBe("ja");
        expect(wertText("x", 4250)).toBe("4250");
        expect(wertText("position", [412.5, 311])).toBe("412,50 · 311,00");
        const ring = Array.from({ length: 400 }, (_, i) => [i, i * 2]);
        expect(wertText("geometry", ring)).toBe("Punkte: 400");
        expect(wertText("geometry", [ring, ring.slice(0, 10)])).toBe("Punkte: 410");
        expect(wertText("x", ["a", "b"])).toBe("a, b");
        expect(wertText("gebirge", { text: "x".repeat(500) })!.length).toBeLessThanOrEqual(160);
    });
});

describe("Sprung in den Objektverlauf", () => {
    it("🔴 die Derographie-Fläche heißt im Verlauf `landscape` und als Subjekt `area`; Teilfläche und Nodix haben kein eigenes Ziel", () => {
        expect(objektZiel("landscape")).toEqual({ subject: "area", werkzeug: "landschaftseditor" });
        expect(objektZiel("place")?.werkzeug).toBe("ortseditor");
        expect(objektZiel("area")).toBeUndefined();
        expect(objektZiel("nodix")).toBeUndefined();
    });

    it("der Gegenstand des Sprungs ist der erste mit einem Objektverlauf", () => {
        const e = eintrag(1, {
            objects: [
                gegenstand({ kind: "area", id: id(1) }),
                gegenstand({ kind: "path", id: id(2) }),
                gegenstand({ kind: "place", id: id(3) }),
            ],
        });
        expect(sprungGegenstand(e)?.id).toBe(id(2));
        expect(sprungGegenstand(eintrag(1, { objects: [] }))).toBeUndefined();
    });
});

describe("Der Sprung als Wunsch mit Verfallszeit", () => {
    beforeEach(() => leereSprung());

    it("🔴 wer springt, legt ihn ab; das Ziel nimmt ihn einmal auf, derselbe Wunsch wirkt nicht zweimal", () => {
        springeZumObjektverlauf({ operationId: id(1) }, "landschaftseditor");
        expect(sprungReiterWunsch.value).toMatchObject({ werkzeug: "landschaftseditor", reiter: "verlauf" });
        expect(nimmZumObjektverlauf()?.operationId).toBe(id(1));
        expect(nimmZumObjektverlauf()).toBeUndefined();
        expect(sprungReiterWunsch.value).toBeUndefined();

        springeZuAenderungen({ operationId: id(2), objekt: { kind: "path", id: id(3) } });
        expect(nimmZuAenderungen()?.objekt?.id).toBe(id(3));
        expect(nimmZuAenderungen()).toBeUndefined();

        // Die Editorenliste (WI-0276): nur die Liste auf eine Person filtern, keine Operation wählen.
        springeZuAenderungen({ person: id(4) });
        const nachPerson = nimmZuAenderungen();
        expect(nachPerson?.person).toBe(id(4));
        expect(nachPerson?.operationId).toBeUndefined();
    });

    it("ein Sprung, den kein Ziel aufnahm, verfällt, statt später in einem fremden Fenster zu wirken", () => {
        const jetzt = Date.now();
        expect(gilt(jetzt, jetzt + SPRUNG_GILT_MS)).toBe(true);
        expect(gilt(jetzt, jetzt + SPRUNG_GILT_MS + 1)).toBe(false);
    });
});

describe("Die Liste: Seiten, Serien über die Seitengrenze, Antworten", () => {
    function aufbau(seiten: MapHistoryPage[]): { urls: string[]; liste: ReturnType<typeof createAenderungenListe> } {
        const urls: string[] = [];
        let i = 0;
        const fetcher = (async (url: string) => {
            urls.push(url);
            return new Response(JSON.stringify(seiten[Math.min(i++, seiten.length - 1)]), { status: 200 });
        }) as unknown as typeof fetch;
        return { urls, liste: createAenderungenListe(createAenderungenDaten({ fetcher, jetzt: () => JETZT })) };
    }

    it("🔴 „Weitere laden“ fragt mit before=next; die Serien beider Seiten bleiben EINE Gruppe", async () => {
        const ids = [1, 2, 3];
        const meta = serieMeta(ids);
        const { urls, liste } = aufbau([
            {
                entries: [mitSerie(3, ids), eintrag(9, { objects: [] })],
                next: 1500,
                series: [{ ...meta, delivered: 1 }],
            },
            { entries: [mitSerie(2, ids), mitSerie(1, ids)], series: [{ ...meta, delivered: 2 }] },
        ]);
        await liste.lade();
        expect(liste.mehrDa.value).toBe(true);
        await liste.lade(true);
        expect(urls[1]).toBe("/api/editor/changes?before=1500");
        expect(liste.mehrDa.value).toBe(false);
        const serien = liste.zeilen.value.filter((z) => z.art === "serie") as SerienZeile[];
        expect(serien).toHaveLength(1);
        expect(serien[0]!.mitglieder).toHaveLength(3);
        expect(liste.zaehlung.value.geladen).toBe(4);
    });

    it("ein Filter beginnt von vorn und fragt auf dem Server; die Antwort einer älteren Frage zählt nicht", async () => {
        const { urls, liste } = aufbau([{ entries: [eintrag(1)] }]);
        await liste.lade();
        liste.setze({ tab: "meine" });
        liste.setze({ tab: "alle", art: "path" });
        await new Promise((fertig) => setTimeout(fertig, 10));
        expect(urls.at(-1)).toBe("/api/editor/changes?kind=path");
        expect(liste.eintraege.value).toHaveLength(1);
    });

    it("ladeBis lädt Seiten nach, bis die Operation da ist; fehlt sie, gibt es auf und lädt nicht endlos", async () => {
        const seiten: MapHistoryPage[] = [
            { entries: [eintrag(9)], next: 30 },
            { entries: [eintrag(8)], next: 20 },
            { entries: [eintrag(7)] },
        ];
        const a = aufbau(seiten);
        await a.liste.lade();
        expect(await a.liste.ladeBis(id(7))).toBe(true);
        const b = aufbau(seiten);
        await b.liste.lade();
        expect(await b.liste.ladeBis(id(77))).toBe(false);
        expect(b.urls).toHaveLength(3);
    });

    it("ein Fehler steht als Fehler da, nicht als leere Liste; die Personen bleiben nach einem Filter", async () => {
        const mara = { kind: "person" as const, id: "22222222-2222-4222-8222-222222222222", name: "Mara" };
        const { liste } = aufbau([{ entries: [eintrag(1), eintrag(2, { actor: mara })] }, { entries: [eintrag(1)] }]);
        await liste.lade();
        liste.setze({ person: PERSON });
        await new Promise((fertig) => setTimeout(fertig, 10));
        expect([...liste.personen.value.values()]).toEqual(["Mara", "Vali"]);

        const kaputt = createAenderungenListe(
            createAenderungenDaten({
                fetcher: (async () => new Response("", { status: 500 })) as unknown as typeof fetch,
            }),
        );
        await kaputt.lade();
        expect(kaputt.fehler.value).toBe(true);
    });

    it("das Detail einer Operation liest die Detail-Route; 404 ist `null`", async () => {
        const urls: string[] = [];
        const daten = createAenderungenDaten({
            fetcher: (async (url: string) => {
                urls.push(url);
                return url.endsWith(id(2))
                    ? new Response("", { status: 404 })
                    : new Response(JSON.stringify(eintrag(1)), { status: 200 });
            }) as unknown as typeof fetch,
        });
        expect((await daten.detail(id(1), new AbortController().signal))?.operationId).toBe(id(1));
        expect(await daten.detail(id(2), new AbortController().signal)).toBeNull();
        expect(urls[0]).toBe(`/api/editor/changes/${id(1)}`);
    });
});
