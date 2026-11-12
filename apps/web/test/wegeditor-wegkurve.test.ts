import { describe, expect, it, vi } from "vitest";
import type {
    EditorLandscapeLayer,
    EditorPathDetail,
    EditorPathEnds,
    EditorPathStreet,
    EditorPathTargets,
    PathSplitBody,
    PathUpdateBody,
} from "@avesmaps3d/shared";
import { createBearbeitung } from "../src/fenster/bearbeitung";
import { ENTWURF_SCHRITTE } from "../src/fenster/entwurf-kern";
import { WEG as WEG_ART } from "../src/map/geometrie/arten";
import type { Bild } from "../src/map/geometrie/bild";
import type { Aenderung, Marke, Punkt, Stelle, Teil, Ziel } from "../src/map/geometrie/geometrie";
import { einrasten } from "../src/map/geometrie/rechnung";
import type { GeometrieEingabe, GeometrieModus } from "../src/map/geometrie/modus";
import type { NimmErgebnis } from "../src/editor-sperre/sperre";
import { createWegArt } from "../src/wegeditor/weg-art";
import type { Teilantwort, WegeditorDaten } from "../src/wegeditor/wegeditor-daten";
import type { WegBearbeitung } from "../src/wegeditor/wegeditor-steuerung";
import { festeIndizes, vereinfachenBild } from "../src/wegeditor/vereinfachen-bild";
import { createWegkurve, markenAus, VEREINFACHEN_HOECHSTENS, VEREINFACHEN_VORGABE } from "../src/wegeditor/wegkurve";

/**
 * „Wegkurve bearbeiten“ als Form im EINEN Entwurf der Straße (WI-0177, W5b Schritt 3; F11 „Fertig“ schreibt) gegen gestellte Daten,
 * eine gestellte Karte und eine echte Bearbeitung (`fenster/bearbeitung.ts`) mit gestelltem Server. Problemfälle: Der Start holt auch
 * Wege am Ort als Mitzieher; eine Handbewegung fragt den Server; „Fertig“ schickt nur den letzten Schritt der Mitgezogenen statt des
 * Wegs vom Start an, oder Felder und Kurve als zwei Operationen; ↶ geht über 20 Schritte hinaus; nach einem Konflikt ist der Entwurf
 * weg; Esc während des Schreibens lässt die Kacheln alt; ein Abschnitt, der nicht der Anker ist, steht ohne eigene Sperre; ein abgelegtes
 * Fenster verliert die Kurve; die Kurve eines zweiten Abschnitts überschreibt die ungespeicherte des ersten.
 */

const WEG = "11111111-1111-4111-8111-111111111111";
const STICH = "22222222-2222-4222-8222-222222222222";
const AM_ORT = "33333333-3333-4333-8333-333333333333";
const ORT = "44444444-4444-4444-8444-444444444444";
/** Der Anker der Straße, wenn der Hauptweg nicht ihr Anker ist; zugleich ihr zweiter Abschnitt. */
const ANKER = "55555555-5555-4555-8555-555555555555";

const frei: EditorPathEnds = { start: { kind: "place", publicId: ORT, name: "Anfang" }, end: { kind: "free" } };

function weg(
    publicId: string,
    punkte: [number, number][],
    revision = 5,
    ends: EditorPathEnds = frei,
): EditorPathDetail {
    return {
        publicId,
        revision,
        name: publicId === WEG || publicId === ANKER ? "Hauptweg" : "Nebenweg",
        subtype: "Weg",
        labelVisible: true,
        isBach: false,
        flowDirection: null,
        sourceSystem: "test",
        active: true,
        points: punkte.map(([x, y]) => ({ x, y })),
        ends,
    };
}

/** Der Hauptweg beginnt am Ort (10|10), knickt bei (20|10), endet frei bei (30|10). Am Knick hängt STICH, am Ort AM_ORT. */
const HAUPT = weg(WEG, [
    [10, 10],
    [20, 10],
    [30, 10],
]);
const ZIELE: EditorPathTargets = {
    margin: 15,
    peaks: [{ publicId: "marke-1", name: "Probezinne", x: 30, y: 10 }],
    places: [{ publicId: ORT, name: "Anfang", x: 10, y: 10 }],
    vertices: [
        { pathId: STICH, name: "Nebenweg", index: 0, x: 20, y: 10, end: true, revision: 8 },
        { pathId: AM_ORT, name: "Am Ort", index: 3, x: 10, y: 10, end: true, revision: 2 },
        { pathId: AM_ORT, name: "Am Ort", index: 0, x: 4, y: 4, end: true, revision: 2 },
    ],
};

/** Die Straße des Hauptwegs unter ihrem Anker: allein oder hinter dem Abschnitt ANKER. */
function strasse(anker: string): EditorPathStreet {
    return {
        id: anker,
        name: "Hauptweg",
        subtype: "Weg",
        isBach: false,
        circle: "halb-rechts",
        labelVisible: true,
        segments: [
            ...(anker === WEG ? [] : [{ id: anker, revision: 3, labelVisible: true, wiki: false, points: 2 }]),
            { id: WEG, revision: 5, labelVisible: true, wiki: false, points: 3 },
        ],
    };
}

const quittung = (mapRevision: number, ends: EditorPathEnds): Response =>
    Response.json({
        operationId: "op",
        status: "applied",
        environment: "test",
        affected: [{ kind: "path", id: WEG, revision: 6 }],
        derivedWork: [],
        warnings: [],
        mapRevision,
        ends,
    });
const fehler = (status: number, code: string, message: string, details?: unknown): Response =>
    new Response(JSON.stringify({ error: { code, message, ...(details === undefined ? {} : { details }) } }), {
        status,
        headers: { "content-type": "application/json" },
    });

function aufgeschoben<T>() {
    let erfuelle!: (wert: T) => void;
    const versprechen = new Promise<T>((r) => (erfuelle = r));
    return { versprechen, erfuelle };
}

function aufbau(
    optionen: {
        weg?: () => Promise<EditorPathDetail | null>;
        /** Was die Sperre antwortet, je Ziel. */
        sperre?: (id: string) => NimmErgebnis;
        /** Was der Hinflug zurückgibt (beim Vereinfachen wartet die Vorgabe auf die Landung). */
        flug?: () => Promise<unknown> | undefined;
        /** Der Anker der Straße; ohne Angabe ist der Hauptweg selbst der Anker. */
        anker?: string;
        /** Was der Server als Ziele antwortet; ohne Angabe `ZIELE`. */
        ziele?: EditorPathTargets;
        /** Die sichtbaren Ebenen der Derographie. */
        ebenen?: () => readonly EditorLandscapeLayer[];
    } = {},
) {
    const anker = optionen.anker ?? WEG;
    const lesen: string[] = [];
    const gesendet: PathUpdateBody[] = [];
    const antworten: { erfuelle: (a: Response) => void }[] = [];
    let haupt = HAUPT;
    const geteilt: PathSplitBody[] = [];
    const daten: Pick<WegeditorDaten, "weg" | "ziele" | "teile"> = {
        weg: vi.fn(async (id: string) => {
            lesen.push(`weg:${id}`);
            if (id === WEG && optionen.weg) return optionen.weg();
            if (id === WEG) return haupt;
            if (id === ANKER)
                return weg(ANKER, [
                    [0, 0],
                    [10, 10],
                ]);
            return id === STICH
                ? weg(
                      STICH,
                      [
                          [20, 10],
                          [20, 20],
                      ],
                      8,
                  )
                : weg(
                      AM_ORT,
                      [
                          [4, 4],
                          [10, 10],
                      ],
                      2,
                  );
        }),
        ziele: vi.fn(async (id: string, _signal: AbortSignal, ebenen?: readonly EditorLandscapeLayer[]) => {
            lesen.push(ebenen === undefined ? `ziele:${id}` : `ziele:${id}:${ebenen.join(",")}`);
            return optionen.ziele ?? ZIELE;
        }),
        teile: vi.fn(async (_id: string, body: PathSplitBody): Promise<Teilantwort> => {
            geteilt.push(body);
            return {
                ok: true,
                quittung: {
                    operationId: "op",
                    status: "applied",
                    environment: "test",
                    affected: [],
                    derivedWork: [],
                    warnings: [],
                    mapRevision: 91,
                    publicId: "hinten-1",
                    ends: { vorne: frei, hinten: frei },
                } as never,
            };
        }),
    };
    const fetcher = vi.fn(async (url: string, init?: RequestInit): Promise<Response> => {
        if (url.endsWith("/street")) return Response.json(strasse(anker));
        gesendet.push(JSON.parse(String(init?.body)) as PathUpdateBody);
        const a = aufgeschoben<Response>();
        antworten.push(a);
        return a.versprechen;
    });
    const griffMenue = vi.fn();
    const modus = {
        aktualisiere: vi.fn(),
        markiere: vi.fn<(m: readonly Marke[]) => void>(),
        sperre: vi.fn<(an: boolean) => void>(),
        abbrechen: vi.fn(() => false),
        aus: vi.fn(),
    } satisfies GeometrieModus;
    let eingabe: GeometrieEingabe | undefined;
    let bild: (() => Bild) | undefined;
    const karte = {
        ein: vi.fn((e: GeometrieEingabe) => {
            eingabe = e;
            return modus;
        }),
        vorschau: vi.fn((b: () => Bild) => {
            bild = b;
            return modus;
        }),
        // Ein Bildpunkt ist eine Karteneinheit: Die Stärke ist dann die Toleranz selbst.
        massstab: vi.fn(() => 1),
        zeige: vi.fn(() => optionen.flug?.()),
        geaendert: vi.fn<(revision: number | undefined) => void>(),
    };
    let n = 0;
    const neueKennung = (): string => `op-${String(++n)}`;
    const verlust = new Set<(ziel: { kind: string; id: string }) => void>();
    const sperre = {
        nimm: vi.fn(
            async (ziel: { id: string }): Promise<NimmErgebnis> =>
                optionen.sperre?.(ziel.id) ?? { art: "genommen", sperre: {} as never },
        ),
        gib: vi.fn(),
        beiVerlust: vi.fn((zuhoerer: (ziel: { kind: string; id: string }) => void) => {
            verlust.add(zuhoerer);
            return () => verlust.delete(zuhoerer);
        }),
    };
    const kacheln = vi.fn<(revision: number | undefined) => void>();
    const art = createWegArt(fetcher as never);
    const bearbeitung: WegBearbeitung = Object.assign(
        createBearbeitung(art, {
            id: anker,
            titel: "Hauptweg",
            sperre: sperre as never,
            karte: { geaendert: kacheln },
            neueKennung,
        }),
        { art },
    );
    const holen = vi.fn(async (): Promise<WegBearbeitung | undefined> => bearbeitung);
    const kurve = createWegkurve({
        daten,
        karte,
        fangradius: () => 10,
        ladefehler: () => "nicht zu lesen",
        neueKennung,
        sperre: sperre as never,
        bearbeitung: holen,
        griffMenue,
        ...(optionen.ebenen ? { ebenen: optionen.ebenen } : {}),
    });
    return {
        kurve,
        bearbeitung,
        holen,
        daten,
        modus,
        karte,
        kacheln,
        lesen,
        gesendet,
        geteilt,
        griffMenue,
        eingabe: () => eingabe!,
        bild: () => bild!(),
        sperre,
        lage: () => bearbeitung.lage.value,
        /** Die Antwort des Servers auf das i-te Schreiben. */
        antworte: (i: number, antwort: Response) => antworten[i]!.erfuelle(antwort),
        verliere: (id: string) => {
            for (const zuhoerer of verlust) zuhoerer({ kind: "path", id });
        },
        setzeHaupt: (w: EditorPathDetail) => (haupt = w),
    };
}

const bewegung = (teil: Teil, punkte: [number, number][], mitgezogen: Aenderung["mitgezogen"] = []): Aenderung => ({
    art: "ziehen",
    stelle: { objekt: teil.objekt, nr: 0, index: 1 },
    teile: [{ ...teil, punkte: punkte.map(([x, y]) => ({ x, y })) }],
    mitgezogen,
    treffer: undefined,
    getrennt: false,
});

const ruhe = () => new Promise((r) => setTimeout(r, 0));

describe("Ein Flussende auf einer Geländemarke (OPS-000088)", () => {
    it("🔴 ist kein freies Ende; ein Ende daneben bleibt frei", () => {
        const teil: Teil = {
            objekt: "fluss",
            name: "Fluss",
            nr: 0,
            art: "linie",
            punkte: [
                { x: 30, y: 10 },
                { x: 40, y: 10 },
            ],
            revision: 1,
        };
        const frei = { kind: "free" } as const;
        expect(markenAus(teil, { start: frei, end: frei }, [{ x: 30, y: 10 }])).toEqual([
            { at: { x: 40, y: 10 }, art: "frei" },
        ]);
        expect(markenAus(teil, { start: frei, end: frei })).toHaveLength(2);
    });
});

/**
 * Vali 2026-11-08: „Kannst du machen, dass beim Editieren von Flussverläufen in der Derographie Flüsse an Seen, anderen Flächen und
 * anderen Flüssen "andocken" können - sprich dass der normale Snap wie bei der Wegbearbeitung erscheint.“ Der Hauptweg wird ein Fluss;
 * ein Seeufer läuft senkrecht bei x = 25 (Ecken bei y 0 und 20), ein anderer Fluss quer bei y = 14. Problemfälle: Nur die Enden rasten
 * ein, wie beim Weg; ein innerer Punkt rastet an einem Landweg ein (STICH, gemeinsamer Knoten mit einer Straße); ein Weg bekommt
 * Flächen als Ziele; die Ebenen der Ansicht gehen nicht zum Server.
 */
describe("Ein Fluss rastet überall an Flächen und Flüssen ein (Vali 2026-11-08)", () => {
    const SEE = "66666666-6666-4666-8666-666666666666";
    const ANDERER = "77777777-7777-4777-8777-777777777777";
    const FLUSS_ZIELE: EditorPathTargets = {
        ...ZIELE,
        vertices: [
            ...ZIELE.vertices,
            { pathId: ANDERER, name: "Nebenfluss", index: 1, x: 18, y: 14, end: false, revision: 4 },
        ],
        areaEdges: [{ areaId: SEE, name: "Probesee", a: [25, 0], b: [25, 20] }],
        riverEdges: [{ pathId: ANDERER, name: "Nebenfluss", index: 0, a: [0, 14], b: [18, 14] }],
    };
    const fluss = { ...HAUPT, subtype: "Flussweg" };
    /** Wohin der Modus einen Punkt an `stelle` zöge, der bei `zeiger` losgelassen wird (dieselbe Regel wie `modus.ts`, ein Bildpunkt = eine Einheit). */
    const rastet = (
        e: GeometrieEingabe,
        index: number,
        zeiger: Punkt,
    ): { art: string; objekt: string; at: Punkt } | undefined => {
        const teil = e.teile()[0]!;
        const stelle: Stelle = { objekt: teil.objekt, nr: 0, index };
        const treffer = einrasten(
            zeiger,
            e.ziele(),
            e.art.ziele(stelle, teil),
            2,
            (p) => p,
            (ziel: Ziel) => e.art.zielErlaubt(ziel, stelle, teil),
        );
        return treffer === undefined
            ? undefined
            : { art: treffer.ziel.art, objekt: treffer.ziel.objekt, at: treffer.at };
    };

    it("🔴 ein innerer Flusspunkt rastet am Seeufer (Ecke vor Kante) und am anderen Fluss (Punkt und Linie) ein, nie an einem Landweg", async () => {
        const a = aufbau({ ziele: FLUSS_ZIELE, ebenen: () => ["topographie"] });
        a.setzeHaupt(fluss);
        await a.kurve.starte(WEG);
        expect(a.lesen).toContain(`ziele:${WEG}:topographie`);
        const e = a.eingabe();
        expect(e.art.id).toBe("fluss");
        // Am Ufer: auf der Linie der Fußpunkt, nahe der Ecke die Ecke.
        expect(rastet(e, 1, { x: 24, y: 9 })).toEqual({ art: "kante", objekt: SEE, at: { x: 25, y: 9 } });
        expect(rastet(e, 1, { x: 24, y: 1 })).toEqual({ art: "ecke", objekt: SEE, at: { x: 25, y: 0 } });
        // Am anderen Fluss: Stützpunkt und Linie.
        expect(rastet(e, 1, { x: 17, y: 13 })).toEqual({ art: "ecke", objekt: ANDERER, at: { x: 18, y: 14 } });
        expect(rastet(e, 1, { x: 8, y: 13 })).toEqual({ art: "kante", objekt: ANDERER, at: { x: 8, y: 14 } });
        // Der Knoten mit dem Landweg STICH ist für einen inneren Punkt kein Ziel, wohl aber für das Ende.
        expect(rastet(e, 1, { x: 20, y: 11 })).toBeUndefined();
        expect(rastet(e, 2, { x: 20, y: 11 })).toMatchObject({ art: "ecke", objekt: STICH });
        // Das Ende rastet am Ufer ein wie der innere Punkt; Orte und Geländemarken bleiben Ziele der Enden.
        expect(rastet(e, 2, { x: 26, y: 5 })).toEqual({ art: "kante", objekt: SEE, at: { x: 25, y: 5 } });
        expect(rastet(e, 1, { x: 10, y: 11 })).toBeUndefined();
        expect(rastet(e, 0, { x: 10, y: 11 })).toMatchObject({ art: "ort", objekt: ORT });
    });

    it("🔴 ein Weg bleibt, wie er war: nur die Enden, keine Flächen, auch wenn der Server sie schickte", async () => {
        const a = aufbau({ ziele: FLUSS_ZIELE, ebenen: () => ["topographie"] });
        await a.kurve.starte(WEG);
        const e = a.eingabe();
        expect(e.art).toBe(WEG_ART);
        expect(e.ziele().some((z) => z.objekt === SEE || z.art === "kante")).toBe(false);
        expect(rastet(e, 1, { x: 17, y: 13 })).toBeUndefined();
    });

    it("beim Vereinfachen bleiben wie bisher nur Enden, Orte und Knoten mit anderen Wegen fest, keine Ecke einer Fläche", async () => {
        const a = aufbau({
            ziele: {
                ...FLUSS_ZIELE,
                peaks: [],
                areaEdges: [{ areaId: SEE, name: "Probesee", a: [25, 9.9], b: [25, 30] }],
            },
        });
        a.setzeHaupt({
            ...weg(WEG, [
                [10, 10],
                [15, 10.1],
                [20, 10],
                [25, 9.9],
                [30, 10],
                [35, 10.05],
                [40, 10],
            ]),
            subtype: "Flussweg",
        });
        await a.kurve.starte(WEG, "vereinfachen");
        // (25|9.9) liegt auf einer Ecke des Sees und fällt trotzdem; fest bleiben der Ort, der Knoten mit STICH und das Ende.
        expect(a.bild().anfasser.map((f) => f.at.x)).toEqual([10, 20, 40]);
    });
});

describe("Wegkurve bearbeiten: Start", () => {
    it("🔴 holt die Bearbeitung der Straße, liest Weg und Ziele; mitziehen können nur Wege am Knoten ohne Ort", async () => {
        const a = aufbau();
        await a.kurve.starte(WEG);
        expect(a.holen).toHaveBeenCalledWith(WEG);
        expect(a.lesen).toEqual([`weg:${WEG}`, `ziele:${WEG}`, `weg:${STICH}`]);
        const e = a.eingabe();
        expect(e.nachbarn().map((t) => t.objekt)).toEqual([STICH]);
        expect(e.ziele().map((z) => `${z.art}:${z.objekt}`)).toEqual([
            `ort:${ORT}`,
            `ecke:${STICH}`,
            `ecke:${AM_ORT}`,
            `ecke:${AM_ORT}`,
        ]);
        expect(e.ziele()[1]!.stelle).toEqual({ objekt: STICH, nr: 0, index: 0 });
        expect(e.orte()).toEqual([{ x: 10, y: 10 }]);
        expect(e.fangradius()).toBe(10);
        expect(a.kurve.laufend.value).toMatchObject({ publicId: WEG, name: "Hauptweg", phase: "bereit" });
        expect(a.kurve.laufend.value?.bearbeitung).toBe(a.bearbeitung);
        // Die Form hängt an der Bearbeitung: Sie läuft, mit Form, ohne Ungespeichertes.
        expect(a.lage()).toMatchObject({ aktiv: true, form: true, ungespeichert: 0, zurueck: false, frage: false });
        // Das freie Ende trägt den gestrichelten Ring.
        expect(a.modus.markiere).toHaveBeenLastCalledWith([{ at: { x: 30, y: 10 }, art: "frei" }]);
        expect(a.karte.zeige).toHaveBeenCalledWith(HAUPT.points);
    });

    it("ein Weg, der nicht zu lesen ist, startet keinen Modus und sagt warum; ebenso ohne Bearbeitung", async () => {
        const a = aufbau({ weg: async () => null });
        await a.kurve.starte(WEG);
        expect(a.karte.ein).not.toHaveBeenCalled();
        expect(a.kurve.laufend.value).toBeUndefined();
        expect(a.kurve.meldung.value).toEqual({ art: "abgelehnt", publicId: WEG, satz: "nicht zu lesen" });
        expect(a.lage().aktiv).toBe(false);
        const b = aufbau();
        b.holen.mockResolvedValueOnce(undefined);
        await b.kurve.starte(WEG);
        expect(b.karte.ein).not.toHaveBeenCalled();
        expect(b.kurve.meldung.value).toMatchObject({ art: "abgelehnt" });
    });

    it("ein Abschnitt, der nicht in der gelesenen Straße steht, startet nichts", async () => {
        const a = aufbau();
        await a.kurve.starte(STICH);
        expect(a.karte.ein).not.toHaveBeenCalled();
        expect(a.kurve.meldung.value).toEqual({ art: "abgelehnt", publicId: STICH, satz: "nicht zu lesen" });
    });

    it("die Marke: der gestrichelte Ring nur am freien Ende", () => {
        const teil: Teil = { objekt: WEG, name: "", nr: 0, art: "linie", punkte: HAUPT.points, revision: 5 };
        const beide: EditorPathEnds = {
            start: frei.start,
            end: { kind: "path", publicId: STICH, name: "N", subtype: "Weg", isBach: false, contact: "ende" },
        };
        expect(markenAus(teil, beide)).toEqual([]);
        expect(markenAus(teil, frei)).toEqual([{ at: { x: 30, y: 10 }, art: "frei" }]);
    });
});

const knick = (x: number, y: number): [number, number][] => [
    [10, 10],
    [x, y],
    [30, 10],
];
const zieht = (von: [number, number], nach: [number, number]): Aenderung["mitgezogen"] => [
    {
        stelle: { objekt: STICH, nr: 0, index: 0 },
        revision: 8,
        von: { x: von[0], y: von[1] },
        nach: { x: nach[0], y: nach[1] },
    },
];

describe("Wegkurve bearbeiten: EIN Entwurf mit den Feldern (W5b Schritt 3)", () => {
    it("🔴 eine Handbewegung ist ein Schritt und fragt den Server nicht; ↶ ↷ und Verwerfen gehen über die Bearbeitung", async () => {
        const a = aufbau();
        await a.kurve.starte(WEG);
        const start = a.eingabe().teile()[0]!;
        a.eingabe().handbewegung(bewegung(start, knick(22, 12)));
        expect(a.gesendet).toEqual([]);
        expect(a.lage()).toMatchObject({ ungespeichert: 1, zurueck: true, wieder: false });
        expect(a.eingabe().teile()[0]!.punkte[1]).toEqual({ x: 22, y: 12 });
        expect(a.bearbeitung.stand.value?.form?.teil.punkte[1]).toEqual({ x: 22, y: 12 });
        expect(a.modus.aktualisiere).toHaveBeenCalled();
        a.kurve.zurueck();
        expect(a.eingabe().teile()[0]).toBe(start);
        expect(a.lage()).toMatchObject({ ungespeichert: 0, zurueck: false, wieder: true });
        a.kurve.wieder();
        expect(a.eingabe().teile()[0]!.punkte[1]).toEqual({ x: 22, y: 12 });
        // Ein neuer Schritt nach ↶ wirft das Wieder weg.
        a.kurve.zurueck();
        a.eingabe().handbewegung(bewegung(start, knick(18, 8)));
        expect(a.lage()).toMatchObject({ ungespeichert: 1, wieder: false });
        a.bearbeitung.verwerfen();
        expect(a.eingabe().teile()[0]).toBe(start);
        expect(a.kurve.laufend.value?.phase).toBe("bereit");
        expect(a.lage()).toMatchObject({ ungespeichert: 0, zurueck: false, wieder: false });
        expect(a.kurve.meldung.value).toEqual({ art: "verworfen", publicId: WEG, name: "Hauptweg" });
        expect(a.gesendet).toEqual([]);
    });

    it("↶ geht bis 20 Schritte zurück (ENTWURF_SCHRITTE), nicht weiter", async () => {
        const a = aufbau();
        await a.kurve.starte(WEG);
        for (let i = 1; i <= ENTWURF_SCHRITTE + 5; i += 1)
            a.eingabe().handbewegung(bewegung(a.eingabe().teile()[0]!, knick(20 + i, 10)));
        for (let i = 0; i < ENTWURF_SCHRITTE + 3; i += 1) a.kurve.zurueck();
        expect(a.lage()).toMatchObject({ ungespeichert: 5, zurueck: false, wieder: true });
    });

    it("🔴 „Fertig“ schreibt EINE path.update mit der Kurve vom Start an, Mitgezogenes gegen SEINE Revision; danach endet der Modus", async () => {
        const a = aufbau();
        await a.kurve.starte(WEG);
        a.eingabe().handbewegung(bewegung(a.eingabe().teile()[0]!, knick(22, 12), zieht([20, 10], [22, 12])));
        a.eingabe().handbewegung(bewegung(a.eingabe().teile()[0]!, knick(25, 15), zieht([22, 12], [25, 15])));
        void a.kurve.fertig();
        await vi.waitFor(() => expect(a.gesendet).toHaveLength(1));
        expect(a.gesendet[0]).toEqual({
            operationId: "op-1",
            sections: [{ publicId: WEG, baseRevision: 5 }],
            shape: {
                publicId: WEG,
                points: [
                    { x: 10, y: 10 },
                    { x: 25, y: 15 },
                    { x: 30, y: 10 },
                ],
                carried: [{ pathId: STICH, index: 0, baseRevision: 8, from: { x: 20, y: 10 }, to: { x: 25, y: 15 } }],
            },
        });
        expect(a.modus.sperre).toHaveBeenLastCalledWith(true);
        expect(a.bearbeitung.zustand.value.art).toBe("speichert");
        // Während des Schreibens zählt keine Handbewegung, und ↶ geht nicht.
        a.eingabe().handbewegung(bewegung(a.eingabe().teile()[0]!, knick(40, 40)));
        a.kurve.zurueck();
        expect(a.lage().ungespeichert).toBe(2);

        const enden: EditorPathEnds = { start: frei.start, end: { kind: "free" } };
        a.antworte(0, quittung(40, enden));
        await vi.waitFor(() => expect(a.kurve.meldung.value?.art).toBe("gespeichert"));
        expect(a.kacheln).toHaveBeenCalledWith(40);
        expect(a.modus.aus).toHaveBeenCalledTimes(1);
        expect(a.kurve.laufend.value).toBeUndefined();
        expect(a.lage().aktiv).toBe(false);
        expect(a.sperre.gib).toHaveBeenCalledWith({ kind: "path", id: WEG });
        expect(a.kurve.meldung.value).toEqual({
            art: "gespeichert",
            publicId: WEG,
            name: "Hauptweg",
            enden,
            mitgezogen: ["Nebenweg"],
        });
    });

    it("🔴 Felder und Kurve in EINER Folge und EINER Operation; ↶ nimmt den jüngsten Schritt, egal welcher Art", async () => {
        const a = aufbau();
        await a.kurve.starte(WEG);
        a.bearbeitung.feld((felder) => ({ ...felder, name: "Neuer Weg" }), "name");
        a.bearbeitung.feldVerlassen();
        a.eingabe().handbewegung(bewegung(a.eingabe().teile()[0]!, knick(22, 12)));
        expect(a.lage().ungespeichert).toBe(2);
        a.kurve.zurueck();
        expect(a.eingabe().teile()[0]!.punkte[1]).toEqual({ x: 20, y: 10 });
        expect(a.bearbeitung.stand.value?.felder.name).toBe("Neuer Weg");
        a.kurve.wieder();
        void a.kurve.fertig();
        await vi.waitFor(() => expect(a.gesendet).toHaveLength(1));
        expect(a.gesendet[0]).toMatchObject({ name: "Neuer Weg", shape: { publicId: WEG, carried: [] } });
    });

    it("ein Mitgezogener, der wieder an seinem Platz liegt, steht nicht in der Operation", async () => {
        const a = aufbau();
        await a.kurve.starte(WEG);
        a.eingabe().handbewegung(bewegung(a.eingabe().teile()[0]!, knick(22, 12), zieht([20, 10], [22, 12])));
        a.eingabe().handbewegung(bewegung(a.eingabe().teile()[0]!, knick(20, 10), zieht([22, 12], [20, 10])));
        // Das freie Ende wandert: Es gibt etwas zu schreiben, nur der Nachbar nicht.
        a.eingabe().handbewegung(
            bewegung(a.eingabe().teile()[0]!, [
                [10, 10],
                [20, 10],
                [32, 11],
            ]),
        );
        void a.kurve.fertig();
        await vi.waitFor(() => expect(a.gesendet).toHaveLength(1));
        expect(a.gesendet[0]!.shape?.carried).toEqual([]);
        expect(a.gesendet[0]!.shape?.points.at(-1)).toEqual({ x: 32, y: 11 });
    });

    it("🔴 Schritte, die enden, wo der Weg begann, schreiben nichts: Der Modus endet still und gibt frei", async () => {
        const a = aufbau();
        await a.kurve.starte(WEG);
        a.eingabe().handbewegung(bewegung(a.eingabe().teile()[0]!, knick(22, 12), zieht([20, 10], [22, 12])));
        a.eingabe().handbewegung(bewegung(a.eingabe().teile()[0]!, knick(20, 10), zieht([22, 12], [20, 10])));
        await a.kurve.fertig();
        expect(a.gesendet).toEqual([]);
        expect(a.kurve.laufend.value).toBeUndefined();
        expect(a.sperre.gib).toHaveBeenCalledWith({ kind: "path", id: WEG });
    });

    it("„Fertig“ ohne Schritt schreibt nichts und beendet den Modus", async () => {
        const a = aufbau();
        await a.kurve.starte(WEG);
        await a.kurve.fertig();
        expect(a.gesendet).toEqual([]);
        expect(a.kurve.laufend.value).toBeUndefined();
        expect(a.kurve.meldung.value).toBeUndefined();
    });

    it("🔴 Konflikt: Der Entwurf bleibt, die Bearbeitung nennt wer und wann; der Modus läuft weiter", async () => {
        const a = aufbau();
        await a.kurve.starte(WEG);
        a.eingabe().handbewegung(bewegung(a.eingabe().teile()[0]!, knick(22, 12)));
        void a.kurve.fertig();
        await vi.waitFor(() => expect(a.gesendet).toHaveLength(1));
        a.antworte(
            0,
            fehler(409, "edit_conflict", "geändert", {
                changedBy: { displayName: "Thomas" },
                changedAt: "2026-10-16T08:00:00Z",
            }),
        );
        await vi.waitFor(() => expect(a.bearbeitung.zustand.value.art).toBe("konflikt"));
        expect(a.bearbeitung.zustand.value).toMatchObject({ wer: "Thomas", eigene: ["form"] });
        expect(a.kurve.laufend.value?.phase).toBe("bereit");
        expect(a.lage().ungespeichert).toBe(1);
        expect(a.eingabe().teile()[0]!.punkte[1]).toEqual({ x: 22, y: 12 });
        expect(a.modus.sperre).toHaveBeenLastCalledWith(false);
        expect(a.modus.aus).not.toHaveBeenCalled();
        expect(a.kacheln).not.toHaveBeenCalled();
    });

    it("🔴 eine fremde Sperre beim Schreiben (409 object_locked): Die Bearbeitung nennt, wer sie hält; der Entwurf bleibt", async () => {
        const a = aufbau();
        await a.kurve.starte(WEG);
        a.eingabe().handbewegung(bewegung(a.eingabe().teile()[0]!, knick(22, 12), zieht([20, 10], [22, 12])));
        void a.kurve.fertig();
        await vi.waitFor(() => expect(a.gesendet).toHaveLength(1));
        a.antworte(
            0,
            fehler(409, "object_locked", "Thomas bearbeitet das gerade.", {
                lock: { kind: "path", id: STICH, part: "form", person: { id: "x", name: "Thomas" } },
            }),
        );
        await vi.waitFor(() => expect(a.bearbeitung.zustand.value).toEqual({ art: "gesperrt", wer: "Thomas" }));
        expect(a.kurve.laufend.value?.phase).toBe("bereit");
        expect(a.lage().ungespeichert).toBe(1);
        expect(a.modus.aus).not.toHaveBeenCalled();
    });

    it("abgelehnt: Der Entwurf bleibt, die Bearbeitung trägt den Satz des Servers", async () => {
        const a = aufbau();
        await a.kurve.starte(WEG);
        a.eingabe().handbewegung(bewegung(a.eingabe().teile()[0]!, knick(2000, 10)));
        void a.kurve.fertig();
        await vi.waitFor(() => expect(a.gesendet).toHaveLength(1));
        a.antworte(0, fehler(400, "validation_failed", "Ein Stützpunkt liegt außerhalb der Karte."));
        await vi.waitFor(() => expect(a.bearbeitung.zustand.value.art).toBe("abgelehnt"));
        expect(a.bearbeitung.zustand.value).toMatchObject({ satz: "Ein Stützpunkt liegt außerhalb der Karte." });
        expect(a.lage().ungespeichert).toBe(1);
    });

    it("🔴 das Fenster wird abgelegt: Die Form hängt ab, der Entwurf bleibt; derselbe Abschnitt macht mit ihm weiter", async () => {
        const a = aufbau();
        await a.kurve.starte(WEG);
        a.eingabe().handbewegung(bewegung(a.eingabe().teile()[0]!, knick(22, 12)));
        a.kurve.haengeAb();
        expect(a.modus.aus).toHaveBeenCalledTimes(1);
        expect(a.kurve.laufend.value).toBeUndefined();
        expect(a.lage()).toMatchObject({ aktiv: true, form: false, ungespeichert: 1 });
        expect(a.bearbeitung.stand.value?.form?.teil.punkte[1]).toEqual({ x: 22, y: 12 });
        // Die Straße bleibt gesperrt, solange ihr Entwurf steht.
        expect(a.sperre.gib).not.toHaveBeenCalled();
        await a.kurve.starte(WEG);
        expect(a.eingabe().teile()[0]!.punkte[1]).toEqual({ x: 22, y: 12 });
        expect(a.lage()).toMatchObject({ form: true, ungespeichert: 1 });
    });
});

describe("Wegkurve bearbeiten: Esc", () => {
    it("bricht erst den laufenden Zug ab; ohne Schritte endet der Modus und die Bearbeitung", async () => {
        const a = aufbau();
        await a.kurve.starte(WEG);
        a.modus.abbrechen.mockReturnValueOnce(true);
        expect(a.kurve.abbrechen()).toBe(true);
        expect(a.modus.aus).not.toHaveBeenCalled();
        expect(a.kurve.abbrechen()).toBe(true);
        expect(a.modus.aus).toHaveBeenCalledTimes(1);
        expect(a.kurve.laufend.value).toBeUndefined();
        expect(a.lage().aktiv).toBe(false);
        expect(a.kurve.abbrechen()).toBe(false);
    });

    it("🔴 mit ungespeicherten Schritten fragt Esc (R2): weiter bearbeiten oder verwerfen und enden", async () => {
        const a = aufbau();
        await a.kurve.starte(WEG);
        a.eingabe().handbewegung(bewegung(a.eingabe().teile()[0]!, knick(22, 12)));
        expect(a.kurve.abbrechen()).toBe(true);
        expect(a.lage().frage).toBe(true);
        await a.bearbeitung.antworte("weiter");
        expect(a.lage()).toMatchObject({ frage: false, ungespeichert: 1 });
        // 🔴 Esc verlässt den Modus immer (Editor-Orchestrierung 2026-10-17): Das zweite Esc beantwortet die Frage mit „Verwerfen“.
        a.kurve.abbrechen();
        expect(a.lage().frage).toBe(true);
        expect(a.kurve.abbrechen()).toBe(true);
        expect(a.kurve.laufend.value).toBeUndefined();
        expect(a.lage().aktiv).toBe(false);
        expect(a.gesendet).toEqual([]);
    });

    it("🔴 Esc während des Schreibens beendet den Modus ohne zu warten; die Kacheln folgen der späteren Quittung", async () => {
        const a = aufbau();
        await a.kurve.starte(WEG);
        a.eingabe().handbewegung(bewegung(a.eingabe().teile()[0]!, knick(21, 10)));
        void a.kurve.fertig();
        await vi.waitFor(() => expect(a.gesendet).toHaveLength(1));
        expect(a.kurve.abbrechen()).toBe(true);
        expect(a.kurve.laufend.value).toBeUndefined();
        a.antworte(0, quittung(44, frei));
        await vi.waitFor(() => expect(a.kacheln).toHaveBeenCalledWith(44));
        expect(a.kurve.laufend.value).toBeUndefined();
        await vi.waitFor(() => expect(a.kurve.meldung.value?.art).toBe("gespeichert"));
    });
});

describe("Wegkurve bearbeiten: Sperre (EDIT-0003 §4)", () => {
    it("🔴 erst gesperrt, dann bearbeitet: Das Ende gibt die Straße frei", async () => {
        const a = aufbau();
        await a.kurve.starte(WEG);
        expect(a.sperre.nimm).toHaveBeenCalledWith({ kind: "path", id: WEG }, "form");
        expect(a.karte.ein).toHaveBeenCalled();
        expect(a.sperre.gib).not.toHaveBeenCalled();
        a.kurve.abbrechen();
        expect(a.sperre.gib).toHaveBeenCalledWith({ kind: "path", id: WEG });
    });

    it("🔴 ein Abschnitt, der nicht der Anker ist: die Straße am Anker UND der Abschnitt; das Ende gibt beide frei", async () => {
        const a = aufbau({ anker: ANKER });
        await a.kurve.starte(WEG);
        expect(a.sperre.nimm.mock.calls.map(([ziel]) => ziel.id)).toEqual([ANKER, WEG, ANKER]);
        expect(a.karte.ein).toHaveBeenCalled();
        a.eingabe().handbewegung(bewegung(a.eingabe().teile()[0]!, knick(22, 12)));
        void a.kurve.fertig();
        await vi.waitFor(() => expect(a.gesendet).toHaveLength(1));
        expect(a.gesendet[0]).toMatchObject({
            sections: [
                { publicId: ANKER, baseRevision: 3 },
                { publicId: WEG, baseRevision: 5 },
            ],
            shape: { publicId: WEG },
        });
        a.antworte(0, quittung(46, frei));
        await vi.waitFor(() => expect(a.kurve.laufend.value).toBeUndefined());
        expect(a.sperre.gib.mock.calls.map(([ziel]) => (ziel as { id: string }).id).sort()).toEqual(
            [ANKER, WEG].sort(),
        );
    });

    it("🔴 hält ein anderer die Straße, beginnt der Modus nicht und die Meldung nennt ihn", async () => {
        const a = aufbau({
            sperre: () => ({ art: "gesperrt", sperre: { person: { id: "x", name: "Thomas" } } as never }),
        });
        await a.kurve.starte(WEG);
        expect(a.karte.ein).not.toHaveBeenCalled();
        expect(a.kurve.laufend.value).toBeUndefined();
        expect(a.sperre.gib).not.toHaveBeenCalled();
        expect(a.lage().aktiv).toBe(false);
        expect(a.kurve.meldung.value).toEqual({ art: "gesperrt", publicId: WEG, name: "Hauptweg", wer: "Thomas" });
    });

    it("🔴 hält ein anderer nur den Abschnitt, gibt der Modus die schon genommene Straße wieder frei", async () => {
        const a = aufbau({
            anker: ANKER,
            sperre: (id) =>
                id === WEG
                    ? { art: "gesperrt", sperre: { person: { id: "x", name: "Thomas" } } as never }
                    : { art: "genommen", sperre: {} as never },
        });
        await a.kurve.starte(WEG);
        expect(a.karte.ein).not.toHaveBeenCalled();
        expect(a.sperre.gib).toHaveBeenCalledWith({ kind: "path", id: ANKER });
        expect(a.kurve.meldung.value).toEqual({ art: "gesperrt", publicId: WEG, name: "Hauptweg", wer: "Thomas" });
    });

    it("ohne Verbindung zur Sperre beginnt der Modus nicht", async () => {
        const a = aufbau({ sperre: () => ({ art: "fehler", fehler: {} as never }) });
        await a.kurve.starte(WEG);
        expect(a.karte.ein).not.toHaveBeenCalled();
        expect(a.kurve.meldung.value).toEqual({ art: "sperrfehler", publicId: WEG, name: "Hauptweg" });
    });

    it("geht die Sperre des Abschnitts verloren, bleibt der Entwurf und die Meldung sagt es", async () => {
        const a = aufbau({ anker: ANKER });
        await a.kurve.starte(WEG);
        a.eingabe().handbewegung(bewegung(a.eingabe().teile()[0]!, knick(22, 12)));
        a.verliere(WEG);
        expect(a.kurve.laufend.value?.phase).toBe("bereit");
        expect(a.lage().ungespeichert).toBe(1);
        expect(a.kurve.meldung.value).toEqual({ art: "verloren", publicId: WEG, name: "Hauptweg" });
        // Verloren heißt: nicht mehr freizugeben.
        a.kurve.haengeAb();
        expect(a.sperre.gib).not.toHaveBeenCalledWith({ kind: "path", id: WEG });
    });

    it("🔴 die ungespeicherte Kurve eines anderen Abschnitts bleibt: Der Modus beginnt nicht, der Hinweis nennt sie", async () => {
        const a = aufbau({ anker: ANKER });
        await a.kurve.starte(WEG);
        a.eingabe().handbewegung(bewegung(a.eingabe().teile()[0]!, knick(22, 12)));
        a.kurve.haengeAb();
        await a.kurve.starte(ANKER);
        expect(a.karte.ein).toHaveBeenCalledTimes(1);
        expect(a.kurve.laufend.value).toBeUndefined();
        expect(a.kurve.meldung.value).toEqual({ art: "andere", publicId: ANKER, name: "Hauptweg" });
        expect(a.bearbeitung.stand.value?.form?.teil.objekt).toBe(WEG);
    });
});

/**
 * WI-0177 W3: „Wegkurve vereinfachen“, die zweite Art derselben Steuerung. Problemfälle: Feste Punkte (Enden, Orte, Knoten) fallen weg
 * oder wandern; ein Ziehen des Reglers füllt den Verlauf; die Vorgabe rechnet vor dem Hinflug mit dem falschen Maßstab; „Fertig“
 * schickt mitgezogene Nachbarn oder schreibt, obwohl nichts übrig ist; die Anfasser lassen sich ziehen.
 */
describe("Wegkurve vereinfachen (W3)", () => {
    /** Ein zittriger Weg vom Ort (10|10) über den Knoten mit STICH (20|10) zum freien Ende (40|10). */
    const ZITTRIG = weg(WEG, [
        [10, 10],
        [15, 10.1],
        [20, 10],
        [25, 9.9],
        [30, 10],
        [35, 10.05],
        [40, 10],
    ]);
    const aufbauZittrig = (optionen: Parameters<typeof aufbau>[0] = {}) => {
        const a = aufbau(optionen);
        a.setzeHaupt(ZITTRIG);
        return a;
    };

    it("🔴 fest sind die Enden, der Punkt am Ort und der Knoten mit einem anderen Weg", () => {
        const punkte = ZITTRIG.points;
        const ziele = ZIELE.vertices.map((v) => ({
            art: "ecke" as const,
            at: { x: v.x, y: v.y },
            objekt: v.pathId,
            name: v.name,
        }));
        expect(festeIndizes(punkte, [{ x: 10, y: 10 }], ziele)).toEqual([0, 2, 6]);
        expect(festeIndizes(punkte, [], [])).toEqual([0, 6]);
    });

    it("🔴 der Start: gesperrt, die Vorschau ohne Anfasser zum Ziehen, gleich die Vorgabe als erster Schritt", async () => {
        const a = aufbauZittrig();
        await a.kurve.starte(WEG, "vereinfachen");
        expect(a.sperre.nimm).toHaveBeenCalledWith({ kind: "path", id: WEG }, "form");
        expect(a.karte.ein).not.toHaveBeenCalled();
        expect(a.karte.vorschau).toHaveBeenCalledTimes(1);
        expect(a.kurve.laufend.value).toMatchObject({
            art: "vereinfachen",
            phase: "bereit",
            vereinfachen: { staerke: VEREINFACHEN_VORGABE, vorher: 7, nachher: 3, fest: 3 },
        });
        expect(a.lage()).toMatchObject({ ungespeichert: 1, zurueck: true });
        // Nur gelesen beim Start, nichts geschrieben.
        expect(a.gesendet).toEqual([]);
    });

    it("🔴 die Vorgabe erst nach der Landung des Hinflugs: Der Maßstab gilt für die Karte, wie sie dann steht", async () => {
        let lande!: () => void;
        const landung = new Promise<void>((r) => (lande = r));
        const a = aufbauZittrig({ flug: () => landung });
        const start = a.kurve.starte(WEG, "vereinfachen");
        await vi.waitFor(() => expect(a.karte.zeige).toHaveBeenCalled());
        await ruhe();
        expect(a.lage().ungespeichert).toBe(0);
        expect(a.karte.massstab).not.toHaveBeenCalled();
        lande();
        await start;
        expect(a.lage().ungespeichert).toBe(1);
    });

    it("🔴 Ziehen zeigt nur, Loslassen ist ein Schritt; dieselbe Stärke noch einmal ist keiner", async () => {
        const a = aufbauZittrig();
        await a.kurve.starte(WEG, "vereinfachen");
        a.kurve.staerke(0, false);
        expect(a.kurve.laufend.value?.vereinfachen).toMatchObject({ staerke: 0, nachher: 7 });
        expect(a.lage().ungespeichert).toBe(1);
        expect(a.bild().andock).toEqual([]);
        a.kurve.staerke(0, true);
        expect(a.kurve.laufend.value?.vereinfachen).toMatchObject({ staerke: 0, nachher: 7 });
        expect(a.lage().ungespeichert).toBe(2);
        a.kurve.staerke(0, true);
        expect(a.lage().ungespeichert).toBe(2);
        a.kurve.zurueck();
        expect(a.lage().ungespeichert).toBe(1);
        expect(a.kurve.laufend.value?.vereinfachen).toMatchObject({ staerke: VEREINFACHEN_VORGABE });
    });

    it("die Stärke bleibt zwischen 0 und der größten", async () => {
        const a = aufbauZittrig();
        await a.kurve.starte(WEG, "vereinfachen");
        a.kurve.staerke(99, true);
        expect(a.kurve.laufend.value?.vereinfachen?.staerke).toBe(VEREINFACHEN_HOECHSTENS);
        a.kurve.staerke(-3, true);
        expect(a.kurve.laufend.value?.vereinfachen?.staerke).toBe(0);
    });

    it("🔴 „Fertig“ schreibt EINE path.update: die festen Punkte unverändert, nichts mitgezogen; der Hinweis zählt die Stützpunkte", async () => {
        const a = aufbauZittrig();
        await a.kurve.starte(WEG, "vereinfachen");
        void a.kurve.fertig();
        await vi.waitFor(() => expect(a.gesendet).toHaveLength(1));
        expect(a.gesendet[0]).toEqual({
            operationId: "op-1",
            sections: [{ publicId: WEG, baseRevision: 5 }],
            shape: {
                publicId: WEG,
                points: [
                    { x: 10, y: 10 },
                    { x: 20, y: 10 },
                    { x: 40, y: 10 },
                ],
                carried: [],
            },
        });
        a.antworte(0, quittung(41, frei));
        await vi.waitFor(() => expect(a.kurve.meldung.value?.art).toBe("gespeichert"));
        expect(a.kurve.laufend.value).toBeUndefined();
        expect(a.kurve.meldung.value).toMatchObject({ stuetzpunkte: { vorher: 7, nachher: 3 } });
        expect(a.sperre.gib).toHaveBeenCalledWith({ kind: "path", id: WEG });
    });

    it("zurück bis zum Start, dann „Fertig“: nichts zu schreiben, der Modus endet still", async () => {
        const a = aufbauZittrig();
        await a.kurve.starte(WEG, "vereinfachen");
        a.kurve.zurueck();
        await a.kurve.fertig();
        expect(a.gesendet).toEqual([]);
        expect(a.kurve.laufend.value).toBeUndefined();
    });

    it("die Vorschau: alter Verlauf blass, neuer rot, feste Punkte groß, wegfallende als leere Ringe", async () => {
        const a = aufbauZittrig();
        await a.kurve.starte(WEG, "vereinfachen");
        const bild = a.bild();
        expect(bild.linien.map((l) => l.rolle)).toEqual(["alt", "kante"]);
        expect(bild.anfasser.map((f) => [f.at.x, f.ende])).toEqual([
            [10, true],
            [20, true],
            [40, true],
        ]);
        expect(bild.andock.map((p) => p.x)).toEqual([15, 25, 30, 35]);
        // Dieselbe Rechnung rein, ohne Steuerung.
        const start = { objekt: WEG, name: "", nr: 0, art: "linie" as const, punkte: ZITTRIG.points, revision: 5 };
        expect(vereinfachenBild(WEG_ART, start, start, [0]).andock).toEqual([]);
    });

    it("während die Frage beim Verlassen steht, bewegt der Regler nichts", async () => {
        const a = aufbauZittrig();
        await a.kurve.starte(WEG, "vereinfachen");
        expect(a.kurve.abbrechen()).toBe(true);
        expect(a.lage().frage).toBe(true);
        a.kurve.staerke(10, true);
        expect(a.lage().ungespeichert).toBe(1);
        expect(a.kurve.laufend.value?.vereinfachen).toMatchObject({ staerke: VEREINFACHEN_VORGABE });
    });

    it("bei „Wegkurve bearbeiten“ tut der Regler nichts; derselbe Abschnitt in der anderen Art macht mit dem Entwurf weiter", async () => {
        const a = aufbauZittrig();
        await a.kurve.starte(WEG);
        a.kurve.staerke(10, true);
        expect(a.kurve.laufend.value).toMatchObject({ art: "kurve", vereinfachen: undefined });
        expect(a.lage().ungespeichert).toBe(0);
        await a.kurve.starte(WEG, "vereinfachen");
        expect(a.kurve.laufend.value?.art).toBe("vereinfachen");
        expect(a.modus.aus).toHaveBeenCalledTimes(1);
        expect(a.lage().ungespeichert).toBe(1);
    });
});

describe("Wegkurve am Stützpunkt (WI-0177 Stufe 3, T24 (3))", () => {
    it("🔴 der Rechtsklick auf einen Griff meldet ihn mit Index, Ende und Ungespeichertem; „Stützpunkt entfernen“ ist ein Schritt", async () => {
        const t = aufbau();
        await t.kurve.starte(WEG);
        t.eingabe().kontext?.({ objekt: WEG, nr: 0, index: 1 }, { x: 5, y: 6 });
        expect(t.griffMenue).toHaveBeenCalledWith({
            publicId: WEG,
            name: "Hauptweg",
            index: 1,
            ende: false,
            ungespeichert: false,
            screen: { x: 5, y: 6 },
        });
        // Die Enden bleiben, ein innerer Punkt geht als Schritt.
        t.kurve.entferneStuetzpunkt(0);
        expect(t.lage().ungespeichert).toBe(0);
        t.kurve.entferneStuetzpunkt(1);
        expect(t.kurve.form()?.teil.punkte).toEqual([
            { x: 10, y: 10 },
            { x: 30, y: 10 },
        ]);
        expect(t.lage().ungespeichert).toBe(1);
        t.kurve.zurueck();
        expect(t.kurve.form()?.teil.punkte).toHaveLength(3);
        expect(t.gesendet).toEqual([]);
    });

    it("🔴 „Hier teilen“: EINE Operation path.split gegen die Revision beim Start, danach endet die Bearbeitung; nie mit Ungespeichertem", async () => {
        const t = aufbau();
        await t.kurve.starte(WEG);
        t.kurve.entferneStuetzpunkt(1);
        await t.kurve.teile(1);
        expect(t.geteilt).toEqual([]);
        t.kurve.zurueck();
        await t.kurve.teile(1);
        expect(t.geteilt).toEqual([{ operationId: "op-1", baseRevision: 5, index: 1, at: { x: 20, y: 10 } }]);
        expect(t.karte.geaendert).toHaveBeenCalledWith(91);
        expect(t.kurve.laufend.value).toBeUndefined();
        expect(t.lage().aktiv).toBe(false);
        expect(t.kurve.meldung.value).toEqual({ art: "geteilt", publicId: WEG, name: "Hauptweg", hinten: "hinten-1" });
        expect(t.sperre.gib).toHaveBeenCalledWith({ kind: "path", id: WEG });
    });
});
