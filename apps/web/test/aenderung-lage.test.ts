import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    AVENTURIA,
    SEARCH_FIT_MAX_ZOOM,
    placeNearZoom,
    renderBounds,
    type MapChangeLage,
    type MapHistoryEntry,
} from "@avesmaps3d/shared";
import { fillZoom } from "../src/map/camera/visible-area";
import {
    besitzerEintrag,
    besitzerSerie,
    karteKnopfText,
    laedtKarte,
    schliesseKarteMit,
    statusText,
    umfeldFuerEintrag,
    umfeldFuerSerie,
    vergissStatus,
    zeigeKarteFuer,
    type ZeigenUmfeld,
} from "../src/aenderungen/aenderung-karte-zeigen";
import { kartenBild, type KartenGegenstand } from "../src/aenderungen/aenderung-karte-modell";
import {
    MINDEST_KANTE,
    bildAusLage,
    flugOptionen,
    istGrenzen,
    istPunktartig,
    kannLageHaben,
    lageFrage,
    mitMindestkante,
} from "../src/aenderungen/aenderung-lage-modell";
import { createAenderungenDaten, type AenderungenDaten } from "../src/aenderungen/aenderungen-daten";
import { kartenWunsch, schliesseKarte, zeigeAufKarte } from "../src/aenderungen/karte-ablage";

/**
 * „Auf der Karte zeigen“ für jede Änderung (WI-0265 B9): woher der Ort kommt (a Protokoll, b Datenbank, c keiner), der Kasten und der Zoom, und dass die Zeile ohne offenes Detail denselben
 * Ablauf geht wie das Detail. Ohne Karte und ohne Browser; dass die Kamera wirklich fliegt, prüft der Browserfall (`e2e/aenderungen-lage.spec.ts`).
 */

const OP = "b9b90265-0000-4000-9000-000000000001";
const OP2 = "b9b90265-0000-4000-9000-000000000002";
const OP3 = "b9b90265-0000-4000-9000-000000000003";
const ORT = "b9b90265-0000-4000-8000-000000000001";

const lageAntwort = (teil: Partial<MapChangeLage> = {}): MapChangeLage => ({
    grenzen: [100, 200, 160, 260],
    gegenstaende: 1,
    stillgelegt: 0,
    ...teil,
});

function eintrag(
    operationId: string,
    changes: MapHistoryEntry["objects"][number]["changes"],
    kind = "place",
): MapHistoryEntry {
    return {
        operationId,
        seq: 1,
        at: "2026-11-01T10:00:00.000Z",
        operation: "place.update",
        source: "editor",
        actor: { kind: "person", name: "Anna" },
        objects: [
            {
                kind: kind as MapHistoryEntry["objects"][number]["kind"],
                id: ORT,
                name: "Luring",
                action: "place.updated",
                revisionBefore: 1,
                revisionAfter: 2,
                changes,
            },
        ],
    };
}

/** Eine reine Feldänderung: „Ungefähre Lage“ geändert, keine Geometrie im Protokoll. */
const FELD = eintrag(OP, { approximate: { before: false, after: true } });
/** Eine Verschiebung: die Lage steht im Protokoll, in der Liste weggelassen. */
const VERSCHOBEN = eintrag(OP2, { position: { omitted: true } });

function daten(teil: Partial<AenderungenDaten> = {}): AenderungenDaten & {
    detail: ReturnType<typeof vi.fn>;
    lage: ReturnType<typeof vi.fn>;
} {
    return {
        seite: vi.fn(),
        detail: vi.fn(() => Promise.resolve(null)),
        lage: vi.fn(() => Promise.resolve(lageAntwort())),
        ...teil,
    } as never;
}

const geometrie: KartenGegenstand = {
    kind: "place",
    zeilen: [
        {
            feld: "position",
            vorher: [100, 100],
            nachher: [120, 130],
            hatVorher: true,
            formFehlt: false,
            omitted: false,
        },
    ],
};

function umfeld(teil: Partial<ZeigenUmfeld> = {}): ZeigenUmfeld {
    return {
        gegenstaende: () => Promise.resolve([{ kind: "place", zeilen: [] }]),
        lage: () => Promise.resolve(lageAntwort()),
        gilt: () => true,
        ...teil,
    };
}

beforeEach(() => {
    vi.useFakeTimers();
    schliesseKarte();
});
afterEach(() => {
    vergissStatus("b");
    schliesseKarte();
    vi.useRealTimers();
});

describe("der Kasten und der Zoom", () => {
    it("ein Kasten ohne Fläche ist ein Punkt: Er bekommt für die Kamera eine Mindestkante um dieselbe Mitte", () => {
        expect(istPunktartig([80, 90, 80, 90])).toBe(true);
        expect(istPunktartig([80, 90, 80 + MINDEST_KANTE, 90 + MINDEST_KANTE])).toBe(false);
        const [x0, y0, x1, y1] = mitMindestkante([80, 90, 80, 90]);
        expect([(x0 + x1) / 2, (y0 + y1) / 2]).toEqual([80, 90]);
        expect(x1 - x0).toBe(MINDEST_KANTE);
        expect(y1 - y0).toBe(MINDEST_KANTE);
        // Eine schmale Straße (eine Richtung ohne Ausdehnung) wird nur in der schmalen Richtung aufgezogen.
        expect(mitMindestkante([100, 100, 100, 160])).toEqual([
            100 - MINDEST_KANTE / 2,
            100,
            100 + MINDEST_KANTE / 2,
            160,
        ]);
        // Was breit genug ist, bleibt, wie es ist.
        expect(mitMindestkante([100, 200, 160, 260])).toEqual([100, 200, 160, 260]);
    });

    it("🔴 ein Punkt fliegt so nah wie an einen Ort und mindestens so nah; alles andere höchstens so nah wie an einen Weg", () => {
        const nah = placeNearZoom(undefined);
        expect(flugOptionen([80, 90, 80, 90])).toEqual({ maxZoom: nah, minZoom: nah });
        expect(flugOptionen([100, 200, 160, 260])).toEqual({ maxZoom: SEARCH_FIT_MAX_ZOOM.weg });
        // Ganz Aventurien: kein Sonderfall, die Kamera passt es ein (ohne Füllstufe gibt es keinen unteren Deckel).
        expect(flugOptionen([0, 0, 1024, 1024])).toEqual({ maxZoom: SEARCH_FIT_MAX_ZOOM.weg });
        expect(flugOptionen(undefined)).toEqual({ maxZoom: SEARCH_FIT_MAX_ZOOM.weg });
    });

    it("🔴 (B9c) ein Kasten größer als die Karte fährt höchstens so weit hinaus, wie das Kartenbild die freie Fläche füllt: Die Füllstufe ist der untere Deckel", () => {
        const fuell = 1.19;
        const alleKaesten: [number, number, number, number][] = [
            [6, 10, 1018, 1012], // ein Lauf über 608 Sprachartikel (Production 2026-11-01)
            [0, 0, 1024, 1024], // ganz Aventurien
            [-300, -300, 1400, 1400], // größer als die Karte
            [100, 200, 160, 260], // ein Gebiet: Die Kamera rechnet max(Passstufe, minZoom), der Deckel schneidet es nie an
        ];
        for (const kasten of alleKaesten) {
            expect(flugOptionen(kasten, fuell)).toEqual({ maxZoom: SEARCH_FIT_MAX_ZOOM.weg, minZoom: fuell });
        }
        // Ein Kasten ohne Ausdehnung in einer Richtung (eine Straße) ist kein Punkt und bekommt denselben Deckel.
        expect(flugOptionen([100, 100, 100, 400], fuell).minZoom).toBe(fuell);
    });

    it("🔴 (B9c) Desktop- und Telefonmaße: Der Deckel liegt unter der Stufe, auf der das Gebiet (100 × 70) ganz ins Bild passt, am Telefon wie am Rechner; die Startstufe läge darüber und schnitte es am Telefon an", () => {
        const grenzen = renderBounds(AVENTURIA.coordinateSpace);
        const zaun = {
            west: grenzen.southWest.lng,
            south: grenzen.southWest.lat,
            east: grenzen.northEast.lng,
            north: grenzen.northEast.lat,
        };
        // Wie breit die ganze Karte bei einer Stufe ist (Bildpunkte): 1920 px bei der Stufe, die eine 1920 px breite Fläche füllt.
        const weltBreite = (zoom: number): number => 1920 * 2 ** (zoom - fillZoom(zaun, { width: 1920, height: 1 }));
        const bildpunkteJeEinheit = (zoom: number): number => weltBreite(zoom) / 1024;
        /** Die Stufe, auf der das Gebiet mit Rand ganz in die Fläche passt (die Breitenpassung: das Gebiet ist breiter als hoch). */
        const passStufe = (flaeche: { width: number; height: number }): number => {
            const rand = 40;
            const gebiet = { breit: 100, hoch: 70 };
            const noetig = Math.min(
                (flaeche.width - 2 * rand) / gebiet.breit,
                (flaeche.height - 2 * rand) / gebiet.hoch,
            );
            return Math.log2(noetig / bildpunkteJeEinheit(0));
        };
        const STARTSTUFE = 3.41;
        for (const [name, flaeche] of [
            ["Rechner (Full HD, Planer und Editorpanel)", { width: 1170, height: 1034 }],
            ["Telefon (Pixel 7, Panel weg)", { width: 412, height: 915 }],
        ] as const) {
            const deckel = flugOptionen([100, 500, 200, 570], fillZoom(zaun, flaeche)).minZoom!;
            // Das Gebiet passt auf der Passstufe ganz ins Bild, und der Deckel liegt darunter: Die Kamera fährt auf die Passstufe.
            expect(deckel, name).toBeLessThan(passStufe(flaeche));
        }
        // Am Telefon schnitte die Startstufe das Gebiet an (es ist dort breiter als die Fläche); der Deckel tut es nicht.
        expect(STARTSTUFE).toBeGreaterThan(passStufe({ width: 412, height: 915 }));
        // Das Telefon füllt auf einer tieferen Stufe als der Rechner: Seine längere Seite ist kürzer.
        expect(fillZoom(zaun, { width: 412, height: 915 })).toBeLessThan(fillZoom(zaun, { width: 1170, height: 1034 }));
    });

    it("(B9c) der Deckel darf den Deckel nach innen nicht überschreiten, und Unbrauchbares gilt als kein Deckel; ein Punkt bleibt bei seiner Ortsstufe", () => {
        expect(flugOptionen([0, 0, 1024, 1024], 99)).toEqual({
            maxZoom: SEARCH_FIT_MAX_ZOOM.weg,
            minZoom: SEARCH_FIT_MAX_ZOOM.weg,
        });
        expect(flugOptionen([0, 0, 1024, 1024], Number.NaN)).toEqual({ maxZoom: SEARCH_FIT_MAX_ZOOM.weg });
        expect(flugOptionen([0, 0, 1024, 1024], Number.NEGATIVE_INFINITY)).toEqual({
            maxZoom: SEARCH_FIT_MAX_ZOOM.weg,
        });
        const nah = placeNearZoom(undefined);
        expect(flugOptionen([80, 90, 80, 90], 1.19)).toEqual({ maxZoom: nah, minZoom: nah });
    });

    it("istGrenzen weist Unbrauchbares ab (nicht geordnet, nicht endlich, falsche Länge)", () => {
        expect(istGrenzen([1, 2, 3, 4])).toBe(true);
        expect(istGrenzen([3, 2, 1, 4])).toBe(false);
        expect(istGrenzen([1, 2, 3, Number.NaN])).toBe(false);
        expect(istGrenzen([1, 2, 3])).toBe(false);
        expect(istGrenzen(null)).toBe(false);
    });
});

describe("das Bild des heutigen Ortes", () => {
    it("ein Kasten mit Fläche wird sein Umriss (geschlossen), mit dem Kasten für die Kamera und ohne Vorher und Nachher", () => {
        const bild = bildAusLage(lageAntwort({ grenzen: [100, 200, 160, 260], gegenstaende: 3 }))!;
        expect(bild.vorher).toEqual([]);
        expect(bild.nachher).toEqual([]);
        expect(bild.verschiebungen).toEqual([]);
        expect(bild.grenzen).toEqual([100, 200, 160, 260]);
        expect(bild.heute?.gegenstaende).toBe(3);
        expect(bild.heute?.stillgelegt).toBe(false);
        expect(bild.heute?.teile).toEqual([
            {
                art: "linie",
                punkte: [
                    [100, 200],
                    [160, 200],
                    [160, 260],
                    [100, 260],
                    [100, 200],
                ],
            },
        ]);
    });

    it("ein Ort ist ein Punkt in der Mitte des Kastens", () => {
        const bild = bildAusLage(lageAntwort({ grenzen: [80, 90, 80, 90] }))!;
        expect(bild.heute?.teile).toEqual([{ art: "punkt", punkt: [80, 90] }]);
        expect(bild.grenzen).toEqual([80, 90, 80, 90]);
    });

    it("🔴 ein stillgelegter Gegenstand wird gemeldet; keine Lage und Unbrauchbares geben kein Bild", () => {
        expect(bildAusLage(lageAntwort({ stillgelegt: 2 }))?.heute?.stillgelegt).toBe(true);
        expect(bildAusLage({ grenzen: null, gegenstaende: 0, stillgelegt: 0 })).toBeUndefined();
        expect(bildAusLage(lageAntwort({ gegenstaende: 0 }))).toBeUndefined();
        expect(bildAusLage(lageAntwort({ grenzen: [5, 5, 1, 1] }))).toBeUndefined();
    });

    it("jede Art von Gegenstand kann einen Ort haben; eine Operation ohne Gegenstand nicht", () => {
        expect(kannLageHaben([{ kind: "place" }])).toBe(true);
        expect(kannLageHaben([{ kind: "source" }, { kind: "corpus" }])).toBe(true);
        expect(kannLageHaben([])).toBe(false);
    });

    it("eine Serie fragt mit ihrer ersten Operation und den weiteren, höchstens hundert", () => {
        expect(lageFrage([])).toBeUndefined();
        expect(lageFrage([OP])).toEqual({ operationId: OP, mit: [] });
        expect(lageFrage([OP, OP2, OP, OP3])).toEqual({ operationId: OP, mit: [OP2, OP3] });
        const viele = Array.from({ length: 150 }, (_, i) => `b9b90265-0000-4000-9000-${String(i).padStart(12, "0")}`);
        expect(lageFrage(viele)?.mit).toHaveLength(100);
    });
});

describe("woher der Ort kommt (a, b, c)", () => {
    it("🔴 (a) Trägt die Änderung Geometrie, gilt das Protokoll: Vorher und Nachher, nicht der heutige Ort; der Server wird nicht gefragt", async () => {
        const lage = vi.fn(() => Promise.resolve(lageAntwort()));
        const ergebnis = await zeigeKarteFuer("b", umfeld({ gegenstaende: () => Promise.resolve([geometrie]), lage }));
        expect(ergebnis).toBe("gezeigt");
        expect(lage).not.toHaveBeenCalled();
        const bild = kartenWunsch.value!.bild;
        expect(bild.vorher).toHaveLength(1);
        expect(bild.nachher).toHaveLength(1);
        expect(bild.heute).toBeUndefined();
        expect(kartenWunsch.value!.besitzer).toBe("b");
    });

    it("🔴 (b) Ohne Geometrie im Protokoll fragt der Ablauf den Server und legt den heutigen Ort auf die Karte", async () => {
        const lage = vi.fn(() => Promise.resolve(lageAntwort({ grenzen: [80, 90, 80, 90] })));
        expect(await zeigeKarteFuer("b", umfeld({ lage }))).toBe("gezeigt");
        expect(lage).toHaveBeenCalledTimes(1);
        const wunsch = kartenWunsch.value!;
        expect(wunsch.bild.heute?.teile).toEqual([{ art: "punkt", punkt: [80, 90] }]);
        expect(wunsch.bild.grenzen).toEqual([80, 90, 80, 90]);
        expect(wunsch.rueckweg).toBe("detail");
    });

    it("(b) Eine Geometrie, die das Protokoll nicht zeigbar führt (Lage-Feld ohne Form), fällt auf den heutigen Ort zurück", async () => {
        const ohneForm: KartenGegenstand = {
            kind: "place",
            zeilen: [
                { feld: "position", vorher: null, nachher: null, hatVorher: false, formFehlt: true, omitted: false },
            ],
        };
        expect(kartenBild([ohneForm]).grenzen).toBeUndefined();
        expect(await zeigeKarteFuer("b", umfeld({ gegenstaende: () => Promise.resolve([ohneForm]) }))).toBe("gezeigt");
        expect(kartenWunsch.value!.bild.heute).toBeDefined();
    });

    it("🔴 (c) Kennt auch der Server keine Lage, kommt kein Bild: Der Knopf sagt es kurz und danach wieder, was er immer sagt", async () => {
        const keine = umfeld({ lage: () => Promise.resolve({ grenzen: null, gegenstaende: 0, stillgelegt: 0 }) });
        expect(await zeigeKarteFuer("b", keine)).toBe("keineLage");
        expect(kartenWunsch.value).toBeUndefined();
        expect(statusText("b")).toBe("Keine Lage bekannt");
        expect(karteKnopfText("b")).toBe("Keine Lage bekannt");
        vi.advanceTimersByTime(4000);
        expect(statusText("b")).toBeUndefined();
        expect(karteKnopfText("b")).toBe("⊕ Auf der Karte zeigen");
        // 404: Die Operation gibt es nicht mehr, auch das ist keine Lage und kein Fehler.
        expect(await zeigeKarteFuer("b", umfeld({ lage: () => Promise.resolve(null) }))).toBe("keineLage");
    });

    it("eine Frage, die scheitert, sagt es kurz und zeigt nichts", async () => {
        expect(await zeigeKarteFuer("b", umfeld({ lage: () => Promise.resolve(undefined) }))).toBe("fehler");
        expect(statusText("b")).toBe("Lage nicht geladen");
        expect(kartenWunsch.value).toBeUndefined();
        expect(await zeigeKarteFuer("b", umfeld({ gegenstaende: () => Promise.resolve(undefined) }))).toBe("fehler");
    });

    it("der Rückweg gilt, wohin die Karte gerufen wurde (aus der Zeile in die Liste)", async () => {
        await zeigeKarteFuer("b", umfeld(), "liste");
        expect(kartenWunsch.value!.rueckweg).toBe("liste");
    });
});

describe("Schalter, Abbruch und doppelter Druck", () => {
    it("derselbe Knopf nimmt die Überlagerung wieder weg", async () => {
        await zeigeKarteFuer("b", umfeld());
        expect(kartenWunsch.value).toBeDefined();
        expect(await zeigeKarteFuer("b", umfeld())).toBe("weg");
        expect(kartenWunsch.value).toBeUndefined();
    });

    it("🔴 ein zweiter Druck, solange der erste fragt, fragt nicht noch einmal", async () => {
        let antworten: (lage: MapChangeLage) => void = () => undefined;
        const lage = vi.fn(() => new Promise<MapChangeLage>((fertig) => (antworten = fertig)));
        const erster = zeigeKarteFuer("b", umfeld({ lage }));
        await Promise.resolve();
        await Promise.resolve();
        expect(laedtKarte("b")).toBe(true);
        expect(await zeigeKarteFuer("b", umfeld({ lage }))).toBe("laeuft");
        antworten(lageAntwort());
        expect(await erster).toBe("gezeigt");
        expect(laedtKarte("b")).toBe(false);
        expect(lage).toHaveBeenCalledTimes(1);
    });

    it("🔴 gilt die Frage nach der Antwort nicht mehr (Detail geschlossen, andere Zeile), legt sie nichts auf die Karte", async () => {
        let gilt = true;
        const lage = vi.fn(() => {
            gilt = false;
            return Promise.resolve(lageAntwort());
        });
        expect(await zeigeKarteFuer("b", umfeld({ lage, gilt: () => gilt }))).toBe("abgebrochen");
        expect(kartenWunsch.value).toBeUndefined();
        expect(statusText("b")).toBeUndefined();
        expect(laedtKarte("b")).toBe(false);
    });

    it("der Wechsel des Reiters nimmt nur die Überlagerungen weg, die seinen Zeilen gehören", () => {
        const bild = bildAusLage(lageAntwort())!;
        zeigeAufKarte("ortseditor-verlauf:x", bild);
        schliesseKarteMit("editorpanel-aenderung:");
        expect(kartenWunsch.value).toBeDefined();
        zeigeAufKarte("editorpanel-aenderung:serie:abc", bild);
        schliesseKarteMit("editorpanel-aenderung:");
        expect(kartenWunsch.value).toBeUndefined();
    });

    it("Besitzer: Reiter und Objektverlauf zählen getrennt, eine Serie hat ihren eigenen", () => {
        expect(besitzerEintrag("editorpanel-aenderung", OP)).toBe(`editorpanel-aenderung:${OP}`);
        expect(besitzerSerie("editorpanel-aenderung", OP)).toBe(`editorpanel-aenderung:serie:${OP}`);
    });
});

describe("die Zeile ohne offenes Detail", () => {
    const signal = new AbortController().signal;

    it("🔴 eine reine Feldänderung lädt das Detail nicht nach und fragt den Server nach der Lage", async () => {
        const d = daten();
        const u = umfeldFuerEintrag(d, FELD, signal);
        expect(await zeigeKarteFuer("zeile", u, "liste")).toBe("gezeigt");
        expect(d.detail).not.toHaveBeenCalled();
        expect(d.lage).toHaveBeenCalledWith(OP, [], signal);
        expect(kartenWunsch.value!.bild.heute).toBeDefined();
        expect(kartenWunsch.value!.rueckweg).toBe("liste");
    });

    it("🔴 eine Verschiebung lädt das Detail (die Liste lässt die Geometrie weg) und zeigt Vorher und Nachher", async () => {
        const detail = eintrag(OP2, { position: { before: [100, 100], after: [120, 130] } });
        const d = daten({ detail: vi.fn(() => Promise.resolve(detail)) });
        expect(await zeigeKarteFuer("zeile", umfeldFuerEintrag(d, VERSCHOBEN, signal))).toBe("gezeigt");
        expect(d.detail).toHaveBeenCalledWith(OP2, signal);
        expect(d.lage).not.toHaveBeenCalled();
        expect(kartenWunsch.value!.bild.vorher).toHaveLength(1);
        expect(kartenWunsch.value!.bild.nachher).toHaveLength(1);
    });

    it("scheitert das Nachladen des Details, ist es ein Fehler, kein „keine Lage“", async () => {
        const d = daten({ detail: vi.fn(() => Promise.reject(new Error("x"))) });
        expect(await zeigeKarteFuer("zeile", umfeldFuerEintrag(d, VERSCHOBEN, signal))).toBe("fehler");
        const d404 = daten({ detail: vi.fn(() => Promise.resolve(null)) });
        expect(await zeigeKarteFuer("zeile", umfeldFuerEintrag(d404, VERSCHOBEN, signal))).toBe("fehler");
    });

    it("ein abgebrochenes Signal gilt nicht mehr", async () => {
        const abbruch = new AbortController();
        const u = umfeldFuerEintrag(daten(), FELD, abbruch.signal);
        abbruch.abort();
        expect(u.gilt()).toBe(false);
    });

    it("🔴 eine Serie fragt mit allen Mitgliedern auf einmal, ohne Detail, wenn keines Geometrie führt", async () => {
        const d = daten();
        const u = umfeldFuerSerie(d, [eintrag(OP3, { name: { before: "a", after: "b" } }), FELD], signal);
        expect(await zeigeKarteFuer("serie", u, "liste")).toBe("gezeigt");
        expect(d.detail).not.toHaveBeenCalled();
        expect(d.lage).toHaveBeenCalledWith(OP3, [OP], signal);
    });

    it("eine Serie mit Geometrie lädt nur nach, was eine Zeile braucht, und zeigt Vorher vor dem ersten und Nachher nach dem letzten", async () => {
        const erstes = eintrag(OP, { position: { omitted: true } });
        const letztes = eintrag(OP2, { position: { omitted: true } });
        const detail = vi.fn((id: string) =>
            Promise.resolve(
                id === OP
                    ? eintrag(OP, { position: { before: [100, 100], after: [110, 110] } })
                    : eintrag(OP2, { position: { before: [110, 110], after: [150, 160] } }),
            ),
        );
        const d = daten({ detail });
        // Die Liste führt die Mitglieder von neu nach alt.
        const u = umfeldFuerSerie(d, [letztes, erstes], signal);
        expect(await zeigeKarteFuer("serie", u)).toBe("gezeigt");
        expect(detail).toHaveBeenCalledTimes(2);
        const bild = kartenWunsch.value!.bild;
        expect(bild.vorher).toEqual([{ art: "punkt", punkt: [100, 100] }]);
        expect(bild.nachher).toEqual([{ art: "punkt", punkt: [150, 160] }]);
    });
});

describe("der Datenzugriff", () => {
    it("die Route heißt …/changes/:operationId/lage, trägt die weiteren Operationen als mit und liest 404 als „gibt es nicht“", async () => {
        const urls: string[] = [];
        const fetcher = vi.fn((url: string) => {
            urls.push(url);
            return Promise.resolve(
                url.includes("404")
                    ? new Response("{}", { status: 404 })
                    : url.includes("500")
                      ? new Response("{}", { status: 500 })
                      : new Response(JSON.stringify(lageAntwort()), { status: 200 }),
            );
        });
        const d = createAenderungenDaten({ fetcher: fetcher as never });
        const signal = new AbortController().signal;
        expect(await d.lage(OP, [], signal)).toEqual(lageAntwort());
        expect(await d.lage(OP, [OP2, OP3], signal)).toEqual(lageAntwort());
        expect(urls).toEqual([`/api/editor/changes/${OP}/lage`, `/api/editor/changes/${OP}/lage?mit=${OP2},${OP3}`]);
        expect(await d.lage("x-404", [], signal)).toBeNull();
        await expect(d.lage("x-500", [], signal)).rejects.toThrow();
    });
});
