import { describe, expect, it, vi } from "vitest";
import type { EditorLandscapeLayer, EditorPathTargets, EditorPlaceDetail, PathCreateBody } from "@avesmaps3d/shared";
import {
    anlegenStand,
    anlegenStart,
    type AnlegenEingabe,
    type AnlegenEntwurf,
    type AnlegenModus,
    type AnlegenPunkt,
} from "../src/map/geometrie/anlegen";
import { FLUSS_ANLEGEN, WEG_ANLEGEN } from "../src/map/geometrie/arten";
import type { Punkt } from "../src/map/geometrie/geometrie";
import { createNeuerWeg, kastenUm, zieleAus, type NeuerWegKarte } from "../src/wegeditor/neuer-weg";
import type { Anlegeantwort, Kasten, WegeditorDaten } from "../src/wegeditor/wegeditor-daten";

/**
 * Die Steuerung „Neuer Weg“ (WI-0177; EDIT-0003 T40 (3), R12, T24) gegen gestellte Daten und eine gestellte Karte. Problemfälle: Der
 * Start am Ort nimmt nicht die Lage des Orts; die Stelle aus „Hier hinzufügen“ rastet nicht am Ort ein; „Fertig“ schreibt mehr als
 * EINE Operation oder vor der Quittung; nach einer Ablehnung ist der Entwurf weg; Esc verwirft ohne Frage; die Ziele werden während
 * des Zeichnens nicht nachgeladen; ein Ort ohne Lage startet trotzdem.
 */

const ORT = "44444444-4444-4444-8444-444444444444";
const ZIEL_ORT = "55555555-5555-4555-8555-555555555555";

const ZIELE: EditorPathTargets = {
    margin: 0,
    peaks: [{ publicId: "marke-1", name: "Probezinne", x: 130, y: 120 }],
    places: [
        { publicId: ORT, name: "Gareth", x: 100, y: 100 },
        { publicId: ZIEL_ORT, name: "Rommilys", x: 140, y: 100 },
    ],
    vertices: [{ pathId: "weg-1", name: "Weg-6029", index: 2, x: 120, y: 110, end: false, revision: 3 }],
};

function ortDetail(position: Punkt | undefined): EditorPlaceDetail {
    return {
        publicId: ORT,
        name: "Gareth",
        active: true,
        ...(position ? { position } : {}),
    } as unknown as EditorPlaceDetail;
}

function aufbau(
    optionen: {
        ort?: EditorPlaceDetail | null;
        antwort?: Anlegeantwort;
        ziele?: EditorPathTargets;
        ebenen?: () => readonly EditorLandscapeLayer[];
    } = {},
) {
    const gesendet: PathCreateBody[] = [];
    const kaesten: Kasten[] = [];
    /** Was je Anfrage für Fluss und Bach mitging (`undefined` beim Weg). */
    const flussFragen: ({ art: string; ebenen: readonly EditorLandscapeLayer[] } | undefined)[] = [];
    let entwurf: AnlegenEntwurf = anlegenStart();
    let eingabe: AnlegenEingabe | undefined;
    const modus = {
        zurueck: vi.fn(),
        wieder: vi.fn(),
        verwerfen: vi.fn(),
        fertig: vi.fn(),
        sperre: vi.fn<(an: boolean) => void>(),
        aktualisiere: vi.fn(),
        entwurf: () => entwurf,
        aus: vi.fn(),
    } satisfies AnlegenModus;
    const daten: Pick<WegeditorDaten, "zieleImKasten" | "legeAn" | "ort"> = {
        zieleImKasten: vi.fn(
            async (
                kasten: Kasten,
                _signal: AbortSignal,
                fluss?: { readonly art: "fluss" | "bach"; readonly ebenen: readonly EditorLandscapeLayer[] },
            ) => {
                kaesten.push(kasten);
                flussFragen.push(fluss === undefined ? undefined : { art: fluss.art, ebenen: [...fluss.ebenen] });
                return optionen.ziele ?? ZIELE;
            },
        ),
        legeAn: vi.fn(async (body: PathCreateBody) => {
            gesendet.push(body);
            return (
                optionen.antwort ?? {
                    ok: true as const,
                    quittung: {
                        operationId: body.operationId,
                        status: "applied" as const,
                        environment: "test" as const,
                        affected: [{ kind: "path", id: "neu-1", revision: 1 }],
                        derivedWork: [],
                        warnings: [],
                        mapRevision: 77,
                        publicId: "neu-1",
                        name: "Weg-7001",
                        subtype: "Weg",
                        ends: {
                            start: { kind: "place" as const, publicId: ORT, name: "Gareth" },
                            end: { kind: "place" as const, publicId: ZIEL_ORT, name: "Rommilys" },
                        },
                    },
                }
            );
        }),
        ort: vi.fn(async () => (optionen.ort === undefined ? ortDetail({ x: 100, y: 100 }) : optionen.ort)),
    };
    const geaendert = vi.fn();
    const geoeffnet = vi.fn();
    // Ein Kartenpunkt am Schirm: zehn Bildpunkte je Einheit.
    const schirm = (p: Punkt) => ({ x: p.x * 10, y: p.y * 10 });
    const karte: NeuerWegKarte = {
        ein: vi.fn((e: AnlegenEingabe) => {
            eingabe = e;
            entwurf = anlegenStart(e.anfang);
            return modus;
        }),
        sichtbar: () => ({ x0: 0, y0: 0, x1: 400, y1: 300 }),
        schirm,
        geaendert,
    };
    const neuerWeg = createNeuerWeg({
        daten,
        fangradius: () => 10,
        geoeffnet,
        neueKennung: () => "op-1",
        karte,
        ...(optionen.ebenen ? { ebenen: optionen.ebenen } : {}),
    });
    /** Wie der Modus: Punkte setzen und den Stand melden. */
    const setzePunkte = (...punkte: AnlegenPunkt[]): void => {
        entwurf = { ...entwurf, punkte: [...entwurf.punkte, ...punkte] };
        eingabe?.stand(anlegenStand(eingabe.art, entwurf));
    };
    return {
        neuerWeg,
        karte,
        modus,
        daten,
        gesendet,
        kaesten,
        flussFragen,
        geaendert,
        geoeffnet,
        setzePunkte,
        eingabe: () => eingabe,
        entwurf: () => entwurf,
    };
}

describe("Geländemarken als Ziel (OPS-000088)", () => {
    it("🔴 nur Fluss und Bach rasten an einer Marke ein; ein Weg kennt sie nicht", () => {
        const marke = (art: "weg" | "fluss" | "bach") => zieleAus(ZIELE, art).filter((z) => z.art === "gipfel");
        expect(marke("weg")).toEqual([]);
        expect(marke("fluss")).toEqual([
            { art: "gipfel", at: { x: 130, y: 120 }, objekt: "marke-1", name: "Probezinne" },
        ]);
        expect(marke("bach")).toHaveLength(1);
        expect(WEG_ANLEGEN.ziele("weiter")).toContain("gipfel");
    });
});

/**
 * Vali 2026-11-08 („dass … Flüsse an Seen, anderen Flächen und anderen Flüssen "andocken" können“): Ein neuer Fluss oder Bach rastet
 * bei jedem Klick auch an Ecken und Kanten der Flächen der sichtbaren Ebenen und an Strecken anderer Flüsse ein. Problemfälle: Die
 * Ebenen gehen nicht zum Server; ein Weg bekommt Flächen; der erste Punkt rastet am Ufer nicht ein; ein Klick am Ufer beendet.
 */
describe("Neuer Fluss rastet an Flächen und Flüssen ein (Vali 2026-11-08)", () => {
    const SEE = "66666666-6666-4666-8666-666666666666";
    const FLUSS_ZIELE: EditorPathTargets = {
        ...ZIELE,
        areaEdges: [{ areaId: SEE, name: "Probesee", a: [60, 50], b: [60, 70] }],
        riverEdges: [{ pathId: "fluss-1", name: "Flussweg-12", index: 3, a: [80, 50], b: [80, 70] }],
    };

    it("🔴 Fluss und Bach fragen mit Art und sichtbaren Ebenen; ihre Ziele sind Ecken und Kanten der Fläche und die Strecke des Flusses", async () => {
        const t = aufbau({ ziele: FLUSS_ZIELE, ebenen: () => ["topographie"] });
        await t.neuerWeg.starte({ punkt: { x: 10, y: 10 }, art: "fluss" });
        expect(t.flussFragen.at(-1)).toEqual({ art: "fluss", ebenen: ["topographie"] });
        const e = t.eingabe()!;
        expect(e.art).toBe(FLUSS_ANLEGEN);
        expect(
            e
                .ziele()
                .filter((z) => z.art === "kante" || z.objekt === SEE)
                .map((z) => `${z.art}:${z.objekt}`),
        ).toEqual([`ecke:${SEE}`, `ecke:${SEE}`, `kante:${SEE}`, "kante:fluss-1"]);
        expect(e.ziele().find((z) => z.objekt === "fluss-1")?.stelle).toEqual({ objekt: "fluss-1", nr: 0, index: 3 });
        // Jeder Klick nimmt die Kante, am Ufer geht es weiter; nur ein Ort beendet.
        expect(FLUSS_ANLEGEN.ziele("weiter")).toEqual(expect.arrayContaining(["ort", "ecke", "gipfel", "kante"]));
        expect(
            FLUSS_ANLEGEN.amZiel(
                e.ziele().find((z) => z.art === "kante")!,
                [{ x: 0, y: 0 }],
            ),
        ).toBe("einrasten");
        await t.neuerWeg.starte({ punkt: { x: 10, y: 10 }, art: "bach" });
        expect(t.flussFragen.at(-1)).toEqual({ art: "bach", ebenen: ["topographie"] });
    });

    it("🔴 der Anfang aus „Hier hinzufügen“ rastet am Seeufer ein wie ein Klick", async () => {
        const t = aufbau({ ziele: FLUSS_ZIELE });
        await t.neuerWeg.starte({ punkt: { x: 60.5, y: 60 }, art: "fluss" });
        expect(t.eingabe()?.anfang).toMatchObject({ at: { x: 60, y: 60 }, ziel: { art: "kante", objekt: SEE } });
        // Ohne Ebenen der Seite fragt er nach allen dreien.
        expect(t.flussFragen.at(-1)).toEqual({ art: "fluss", ebenen: ["derographisch", "vegetation", "topographie"] });
    });

    it("🔴 ein Weg bleibt, wie er war: keine Art und keine Ebenen in der Frage, keine Fläche als Ziel", async () => {
        const t = aufbau({ ziele: FLUSS_ZIELE, ebenen: () => ["topographie"] });
        await t.neuerWeg.starte({ punkt: { x: 60.5, y: 60 } });
        expect(t.flussFragen.at(-1)).toBeUndefined();
        expect(t.eingabe()?.art).toBe(WEG_ANLEGEN);
        expect(
            t
                .eingabe()
                ?.ziele()
                .some((z) => z.art === "kante" || z.objekt === SEE),
        ).toBe(false);
        expect(t.eingabe()?.anfang?.ziel).toBeUndefined();
        expect(zieleAus(FLUSS_ZIELE, "weg").some((z) => z.art === "kante")).toBe(false);
    });
});

describe("Neuer Weg (WI-0177)", () => {
    it("🔴 ab einem Ort: der Ort ist der feste Anfang, die Ziele kommen aus dem Kasten um ihn", async () => {
        const t = aufbau();
        await t.neuerWeg.starte({ ort: ORT });
        expect(t.daten.ort).toHaveBeenCalledWith(ORT, expect.any(AbortSignal));
        expect(t.eingabe()?.anfang).toEqual({
            at: { x: 100, y: 100 },
            ziel: { art: "ort", at: { x: 100, y: 100 }, objekt: ORT, name: "Gareth" },
        });
        // Der sichtbare Ausschnitt ist breiter als 160: gekürzt auf den Ort.
        expect(t.kaesten[0]).toEqual({ x0: 20, y0: 20, x1: 180, y1: 180 });
        expect(
            t
                .eingabe()
                ?.ziele()
                .map((z) => z.objekt),
        ).toEqual([ORT, ZIEL_ORT, "weg-1"]);
        expect(t.neuerWeg.laufend.value).toMatchObject({ phase: "bereit", von: { art: "ort", name: "Gareth" } });
    });

    it("🔴 an einer Stelle: sie rastet am Ort im Fangradius ein (P5), sonst bleibt sie frei", async () => {
        const t = aufbau();
        await t.neuerWeg.starte({ punkt: { x: 100.5, y: 100.5 } });
        expect(t.eingabe()?.anfang?.ziel?.objekt).toBe(ORT);
        expect(t.eingabe()?.anfang?.at).toEqual({ x: 100, y: 100 });
        await t.neuerWeg.starte({ punkt: { x: 60, y: 60 } });
        expect(t.eingabe()?.anfang).toEqual({ at: { x: 60, y: 60 }, ziel: undefined });
        expect(t.neuerWeg.laufend.value?.von).toEqual({ art: "frei" });
    });

    it("🔴 ein Ort ohne Lage startet nicht und meldet es", async () => {
        const t = aufbau({ ort: ortDetail(undefined) });
        await t.neuerWeg.starte({ ort: ORT });
        expect(t.neuerWeg.laufend.value).toBeUndefined();
        expect(t.neuerWeg.meldung.value).toEqual({ art: "ladefehler" });
    });

    it("🔴 „Fertig“ schreibt EINE Operation path.create, danach Kacheln, Meldung und das Wege-Fenster", async () => {
        const t = aufbau();
        await t.neuerWeg.starte({ ort: ORT });
        const punkte: AnlegenPunkt[] = [
            { at: { x: 100, y: 100 }, ziel: undefined },
            { at: { x: 120, y: 110 }, ziel: undefined },
            { at: { x: 140, y: 100 }, ziel: undefined },
        ];
        t.eingabe()?.fertig(punkte);
        expect(t.neuerWeg.laufend.value?.phase).toBe("speichert");
        expect(t.modus.sperre).toHaveBeenCalledWith(true);
        await vi.waitFor(() => expect(t.neuerWeg.laufend.value).toBeUndefined());
        expect(t.gesendet).toEqual([
            {
                operationId: "op-1",
                points: [
                    { x: 100, y: 100 },
                    { x: 120, y: 110 },
                    { x: 140, y: 100 },
                ],
            },
        ]);
        expect(t.geaendert).toHaveBeenCalledWith(77);
        expect(t.geoeffnet).toHaveBeenCalledWith("neu-1");
        expect(t.modus.aus).toHaveBeenCalled();
        expect(t.neuerWeg.meldung.value).toMatchObject({ art: "gespeichert", publicId: "neu-1" });
    });

    it("🔴 Neuer Fluss und neuer Bach (Plan Fluss/Bach): derselbe Modus, „Fertig“ schreibt die Art mit; ein Weg schreibt keine", async () => {
        const t = aufbau();
        const punkte: AnlegenPunkt[] = [
            { at: { x: 100, y: 100 }, ziel: undefined },
            { at: { x: 140, y: 100 }, ziel: undefined },
        ];
        await t.neuerWeg.starte({ ort: ORT, art: "fluss" });
        t.eingabe()?.fertig(punkte);
        await vi.waitFor(() => expect(t.neuerWeg.laufend.value).toBeUndefined());
        await t.neuerWeg.starte({ punkt: { x: 60, y: 60 }, art: "bach" });
        t.eingabe()?.fertig(punkte);
        await vi.waitFor(() => expect(t.neuerWeg.laufend.value).toBeUndefined());
        await t.neuerWeg.starte({ ort: ORT });
        t.eingabe()?.fertig(punkte);
        await vi.waitFor(() => expect(t.neuerWeg.laufend.value).toBeUndefined());
        expect(t.gesendet.map((body) => body.art)).toEqual(["fluss", "bach", undefined]);
    });

    it("🔴 der Lauf und seine Meldungen tragen die Art (die Leiste sagt „Neuer Bach“); ein Weg trägt keine", async () => {
        const t = aufbau();
        await t.neuerWeg.starte({ punkt: { x: 60, y: 60 }, art: "bach" });
        expect(t.neuerWeg.laufend.value?.art).toBe("bach");
        t.setzePunkte({ at: { x: 110, y: 100 }, ziel: undefined });
        t.neuerWeg.verwerfen();
        expect(t.neuerWeg.meldung.value).toEqual({ art: "verworfen", anlage: "bach" });
        await t.neuerWeg.starte({ punkt: { x: 60, y: 60 } });
        expect(t.neuerWeg.laufend.value?.art).toBe("weg");
        t.setzePunkte({ at: { x: 110, y: 100 }, ziel: undefined });
        t.neuerWeg.verwerfen();
        expect(t.neuerWeg.meldung.value).toEqual({ art: "verworfen" });
    });

    it("🔴 Fluss und Bach stellen auf die Topographie (Betreiber 2026-10-20); nach dem Speichern bleibt sie, ein Abbruch stellt zurück, ein Weg wechselt nie", async () => {
        const t = aufbau();
        const ansicht = { zurueck: vi.fn(), bleib: vi.fn() };
        const zuTopographie = vi.fn(() => ansicht);
        Object.assign(t.karte, { zuTopographie });
        const punkte: AnlegenPunkt[] = [
            { at: { x: 100, y: 100 }, ziel: undefined },
            { at: { x: 140, y: 100 }, ziel: undefined },
        ];

        await t.neuerWeg.starte({ punkt: { x: 60, y: 60 }, art: "fluss" });
        expect(zuTopographie).toHaveBeenCalledOnce();
        // Gezeichnet wird an derselben Stelle, erst nach dem Wechsel.
        expect(t.eingabe()?.anfang?.at).toEqual({ x: 60, y: 60 });
        t.eingabe()?.fertig(punkte);
        await vi.waitFor(() => expect(t.neuerWeg.laufend.value).toBeUndefined());
        expect(ansicht.bleib).toHaveBeenCalledOnce();
        expect(ansicht.zurueck).not.toHaveBeenCalled();

        await t.neuerWeg.starte({ punkt: { x: 60, y: 60 }, art: "bach" });
        expect(t.neuerWeg.abbrechen()).toBe(true);
        expect(ansicht.zurueck).toHaveBeenCalledOnce();

        // Esc während des Schreibens: Ob er entstand, sagt erst die Quittung; die Ansicht bleibt (wie „Neue Fläche“).
        vi.mocked(t.daten.legeAn).mockImplementationOnce(() => new Promise<Anlegeantwort>(() => undefined));
        await t.neuerWeg.starte({ punkt: { x: 60, y: 60 }, art: "fluss" });
        t.eingabe()?.fertig(punkte);
        expect(t.neuerWeg.laufend.value?.phase).toBe("speichert");
        expect(t.neuerWeg.abbrechen()).toBe(true);
        expect(ansicht.bleib).toHaveBeenCalledTimes(2);

        await t.neuerWeg.starte({ punkt: { x: 60, y: 60 } });
        expect(t.neuerWeg.abbrechen()).toBe(true);
        expect(zuTopographie).toHaveBeenCalledTimes(3);
        expect(ansicht.bleib).toHaveBeenCalledTimes(2);
        expect(ansicht.zurueck).toHaveBeenCalledOnce();
    });

    it("🔴 eine Ablehnung lässt den Entwurf stehen und nennt den Satz des Servers", async () => {
        const t = aufbau({
            antwort: {
                ok: false,
                status: 400,
                fehler: { code: "validation_failed", message: "Ein Stützpunkt liegt außerhalb der Karte." },
            },
        });
        await t.neuerWeg.starte({ ort: ORT });
        t.eingabe()?.fertig([
            { at: { x: 100, y: 100 }, ziel: undefined },
            { at: { x: 2000, y: 100 }, ziel: undefined },
        ]);
        await vi.waitFor(() => expect(t.neuerWeg.laufend.value?.phase).toBe("bereit"));
        expect(t.modus.sperre).toHaveBeenLastCalledWith(false);
        expect(t.modus.aus).not.toHaveBeenCalled();
        expect(t.geaendert).not.toHaveBeenCalled();
        expect(t.neuerWeg.meldung.value).toEqual({
            art: "abgelehnt",
            satz: "Ein Stützpunkt liegt außerhalb der Karte.",
        });
    });

    it("🔴 ein Fehler des Servers (500, Fund von Thomas auf der Stage) sagt das mit Status; der Entwurf bleibt, „Fertig“ geht wieder", async () => {
        const t = aufbau({
            antwort: {
                ok: false,
                status: 500,
                fehler: { code: "internal_error", message: "Ein interner Fehler ist aufgetreten." },
            },
        });
        await t.neuerWeg.starte({ ort: ORT });
        const punkte = [
            { at: { x: 100, y: 100 }, ziel: undefined },
            { at: { x: 120, y: 100 }, ziel: undefined },
        ];
        t.eingabe()?.fertig(punkte);
        await vi.waitFor(() => expect(t.neuerWeg.laufend.value?.phase).toBe("bereit"));
        expect(t.neuerWeg.meldung.value).toEqual({ art: "serverfehler", status: 500 });
        expect(t.modus.aus).not.toHaveBeenCalled();
        t.eingabe()?.fertig(punkte);
        await vi.waitFor(() => expect(t.gesendet).toHaveLength(2));
    });

    it("🔴 eine Ausnahme beim Schreiben lässt den Modus nie im Schreiben hängen: keine Antwort, der Entwurf bleibt", async () => {
        const t = aufbau();
        vi.mocked(t.daten.legeAn).mockRejectedValueOnce(new SyntaxError("Unexpected token <"));
        await t.neuerWeg.starte({ ort: ORT });
        t.eingabe()?.fertig([
            { at: { x: 100, y: 100 }, ziel: undefined },
            { at: { x: 120, y: 100 }, ziel: undefined },
        ]);
        await vi.waitFor(() => expect(t.neuerWeg.laufend.value?.phase).toBe("bereit"));
        expect(t.neuerWeg.meldung.value).toEqual({ art: "serverfehler", status: 0 });
    });

    it("🔴 Esc während des Schreibens beendet den Modus ohne zu warten; eine spätere Quittung bringt die Kacheln trotzdem", async () => {
        let erfuelle: ((wert: Anlegeantwort) => void) | undefined;
        const t = aufbau();
        vi.mocked(t.daten.legeAn).mockImplementationOnce(
            () => new Promise<Anlegeantwort>((resolve) => (erfuelle = resolve)),
        );
        await t.neuerWeg.starte({ ort: ORT });
        t.eingabe()?.fertig([
            { at: { x: 100, y: 100 }, ziel: undefined },
            { at: { x: 120, y: 100 }, ziel: undefined },
        ]);
        expect(t.neuerWeg.laufend.value?.phase).toBe("speichert");
        expect(t.neuerWeg.abbrechen()).toBe(true);
        expect(t.neuerWeg.laufend.value).toBeUndefined();
        expect(t.modus.aus).toHaveBeenCalled();
        erfuelle!({
            ok: true,
            quittung: {
                operationId: "op-1",
                status: "applied",
                environment: "test",
                affected: [{ kind: "path", id: "neu-1", revision: 1 }],
                derivedWork: [],
                warnings: [],
                mapRevision: 78,
                publicId: "neu-1",
                name: "Weg-7001",
                subtype: "Weg",
                ends: { start: { kind: "free" }, end: { kind: "free" } },
            },
        });
        await vi.waitFor(() => expect(t.geaendert).toHaveBeenCalledWith(78));
        expect(t.geoeffnet).not.toHaveBeenCalled();
    });

    it("🔴 Esc: ohne Abschnitt endet der Modus, mit Abschnitt fragt er; die Antwort verwirft oder lässt weiterzeichnen", async () => {
        const t = aufbau();
        await t.neuerWeg.starte({ ort: ORT });
        expect(t.neuerWeg.abbrechen()).toBe(true);
        expect(t.neuerWeg.laufend.value).toBeUndefined();

        await t.neuerWeg.starte({ ort: ORT });
        t.setzePunkte({ at: { x: 110, y: 100 }, ziel: undefined });
        expect(t.neuerWeg.laufend.value?.stand.abschnitte).toBe(1);
        expect(t.neuerWeg.abbrechen()).toBe(true);
        expect(t.neuerWeg.laufend.value?.frage).toBe(true);
        t.neuerWeg.antworte(false);
        expect(t.neuerWeg.laufend.value?.frage).toBe(false);
        t.neuerWeg.abbrechen();
        t.neuerWeg.antworte(true);
        expect(t.neuerWeg.laufend.value).toBeUndefined();
        expect(t.neuerWeg.meldung.value).toEqual({ art: "verworfen" });
        expect(t.daten.legeAn).not.toHaveBeenCalled();
    });

    it("🔴 Esc verlässt den Modus immer (Fund von Thomas, 2026-10-17): das zweite Esc verwirft und endet, statt die Frage nur zu schließen", async () => {
        const t = aufbau();
        await t.neuerWeg.starte({ ort: ORT });
        t.setzePunkte({ at: { x: 110, y: 100 }, ziel: undefined });
        expect(t.neuerWeg.abbrechen()).toBe(true);
        expect(t.neuerWeg.laufend.value?.frage).toBe(true);
        expect(t.neuerWeg.abbrechen()).toBe(true);
        expect(t.neuerWeg.laufend.value).toBeUndefined();
        expect(t.neuerWeg.meldung.value).toEqual({ art: "verworfen" });
        expect(t.daten.legeAn).not.toHaveBeenCalled();
    });

    it("die Ziele folgen dem Ausschnitt, um den letzten Punkt; der Modus zeichnet sie neu", async () => {
        const t = aufbau();
        await t.neuerWeg.starte({ ort: ORT });
        t.setzePunkte({ at: { x: 200, y: 150 }, ziel: undefined });
        await t.neuerWeg.ladeZiele();
        expect(t.kaesten.at(-1)).toEqual({ x0: 120, y0: 70, x1: 280, y1: 230 });
        expect(t.modus.aktualisiere).toHaveBeenCalled();
    });

    it("kastenUm: ein kleiner Ausschnitt bleibt, wie er ist", () => {
        expect(kastenUm({ x0: 10, y0: 20, x1: 50, y1: 60 }, { x: 0, y: 0 })).toEqual({
            x0: 10,
            y0: 20,
            x1: 50,
            y1: 60,
        });
    });
});
