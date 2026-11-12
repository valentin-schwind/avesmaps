import { describe, expect, it, vi } from "vitest";
import type { EditorLandscapeDetail, EditorPeakDetail } from "@avesmaps3d/shared";
import { createWerkzeugfenster } from "../src/editor-panel/werkzeugfenster";
import { landschaftMeldung, meldeLandschaften } from "../src/landschaftseditor/landschaft-melde";
import { createLandschaftseditorSteuerung } from "../src/landschaftseditor/landschaftseditor-steuerung";

/**
 * Flächen und Gipfel, die der Reiter „Änderungen“ zurücknimmt (WI-0265 B6c2): Ein offenes Derographie- oder Gipfelfenster hält die Revisionen vom letzten Lesen. Problemfälle: Das Fenster zeigt
 * nach dem ↺ den alten Stand und schreibt mit einer veralteten Revision (409 beim nächsten „Fertig“); sein Verlauf nennt die Rücknahme nicht; die Kacheln der Karte ziehen nicht nach; ein
 * Fenster, das die Rücknahme nicht berührt, liest unnötig neu; ein Fenster mit laufender Bearbeitung verliert sein Ungeschriebenes.
 */

const WALD = "c3c3c3c3-0000-4000-8000-000000000001";
const FLAECHE = "c3c3c3c3-0000-4000-8000-0000000000a1";
const LABEL = "c3c3c3c3-0000-4000-8000-0000000000c1";
const ANDERE = "c3c3c3c3-0000-4000-8000-000000000002";
const GIPFEL = "c8c8c8c8-0000-4000-8000-000000000001";
const FREMDER_GIPFEL = "c8c8c8c8-0000-4000-8000-000000000002";
const ORT = "0a0a0a0a-0000-4000-8000-000000000001";

const landschaft = (
    id: string,
    revision: number,
    extra: Partial<EditorLandscapeDetail> = {},
): EditorLandscapeDetail => ({
    id,
    name: id === WALD ? "Formwald" : "Andere Fläche",
    layer: "vegetation",
    type: "wald",
    circle: "voll",
    order: 0,
    clickLocked: false,
    areas: id === WALD ? [{ id: FLAECHE, affectsPaths: true, revision: 7, polygons: [] }] : [],
    labels: id === WALD ? [{ id: LABEL, text: "Formwald", x: 5, y: 5, visible: true, revision: 4, size: 12 }] : [],
    neighbors: [],
    revision,
    ...extra,
});
const gipfel = (revision: number): EditorPeakDetail => ({
    id: GIPFEL,
    name: "Probezinne",
    subtype: "berggipfel",
    showName: true,
    position: [450, 560],
    revision,
});

const ruhe = () => new Promise((r) => setTimeout(r, 0));
const warte = async () => {
    for (let i = 0; i < 6; i += 1) await ruhe();
};

interface Aufbau {
    /** Die Revisionen, die der Server jetzt nennt: Die Rücknahme hat sie weitergezählt. */
    readonly stand: {
        landschaft: number;
        andere: number;
        gipfel: number;
        peaks: { id: string; revision: number }[];
        /** Die Landschaft ist still gelegt (die Rücknahme ihrer Anlage): Der Server kennt sie nicht mehr (404). */
        weg?: boolean;
    };
}

function aufbau(optionen: Partial<Aufbau["stand"]> = {}) {
    const stand: Aufbau["stand"] = { landschaft: 3, andere: 8, gipfel: 2, peaks: [], ...optionen };
    const zaehler = {
        liste: 0,
        landschaft: 0,
        andere: 0,
        verlaufLandschaft: 0,
        verlaufAndere: 0,
        gipfel: 0,
        verlaufGipfel: 0,
    };
    const fetcher = vi.fn(async (url: string) => {
        const antwort = (body: unknown) => new Response(JSON.stringify(body));
        if (url === "/api/editor/landscapes") {
            zaehler.liste += 1;
            return antwort({ rows: [], peaks: [] });
        }
        if (url === `/api/editor/landscapes/${WALD}/history`) {
            zaehler.verlaufLandschaft += 1;
            return antwort({ entries: [] });
        }
        if (url === `/api/editor/landscapes/${ANDERE}/history`) {
            zaehler.verlaufAndere += 1;
            return antwort({ entries: [] });
        }
        if (url === `/api/editor/landscapes/${WALD}`) {
            zaehler.landschaft += 1;
            if (stand.weg === true) return new Response("{}", { status: 404 });
            return antwort(
                landschaft(WALD, stand.landschaft, {
                    peaks: stand.peaks.map((p) => ({
                        id: p.id,
                        name: "Probezinne",
                        subtype: "berggipfel",
                        position: [450, 560],
                        revision: p.revision,
                    })),
                }),
            );
        }
        if (url === `/api/editor/landscapes/${ANDERE}`) {
            zaehler.andere += 1;
            return antwort(landschaft(ANDERE, stand.andere));
        }
        if (url === `/api/editor/peaks/${GIPFEL}/history`) {
            zaehler.verlaufGipfel += 1;
            return antwort({ entries: [] });
        }
        if (url === `/api/editor/peaks/${GIPFEL}`) {
            zaehler.gipfel += 1;
            return antwort(gipfel(stand.gipfel));
        }
        return new Response("{}", { status: 404 });
    });
    const geaendert = vi.fn();
    const fenster = createWerkzeugfenster(undefined);
    const steuerung = createLandschaftseditorSteuerung(fenster, fetcher as never, undefined, {
        sperre: {
            nimm: vi.fn(async () => ({ art: "genommen" as const, sperre: {} as never })),
            gib: vi.fn(),
            beiVerlust: () => () => undefined,
        },
        geaendert,
        darfSchreiben: () => true,
    });
    return { steuerung, stand, zaehler, geaendert };
}

describe("Meldung nach einer Rücknahme: was gemeldet wird", () => {
    it("🔴 Flächen, Teilflächen, Beschriftungen, Gebirgswerte und Gipfel werden gemeldet, Orte und Wege nicht; ohne etwas davon entsteht keine Meldung", () => {
        meldeLandschaften(
            [
                { kind: "place", id: ORT },
                { kind: "landscape", id: WALD },
                { kind: "area", id: FLAECHE },
                { kind: "label", id: LABEL },
                { kind: "terrain_control", id: FLAECHE },
                { kind: "peak", id: GIPFEL },
                { kind: "path", id: ORT },
            ],
            4711,
        );
        const meldung = landschaftMeldung.value;
        expect(meldung?.flaechen).toEqual([WALD, FLAECHE, LABEL, FLAECHE]);
        expect(meldung?.gipfel).toEqual([GIPFEL]);
        expect(meldung?.mapRevision).toBe(4711);

        meldeLandschaften(
            [
                { kind: "place", id: ORT },
                { kind: "path", id: ORT },
            ],
            4712,
        );
        expect(landschaftMeldung.value).toBe(meldung);
    });
});

describe("B8c: angelegte und still gelegte Gegenstände werden gemeldet", () => {
    it("🔴 die Rücknahme einer Anlage nennt Landschaft, Teilfläche, Beschriftung und Gipfel (still gelegt oder belebt): alle erreichen die Meldung", () => {
        // Das Stilllegen einer angelegten Fläche samt Beschriftung und eines gesetzten Gipfels, und ebenso ihr Beleben (die Rücknahme der Rücknahme), nennen dieselben Arten in `affected`.
        meldeLandschaften(
            [
                { kind: "landscape", id: WALD },
                { kind: "area", id: FLAECHE },
                { kind: "label", id: LABEL },
            ],
            8100,
        );
        expect(landschaftMeldung.value?.flaechen).toEqual([WALD, FLAECHE, LABEL]);
        expect(landschaftMeldung.value?.gipfel).toEqual([]);
        meldeLandschaften([{ kind: "peak", id: GIPFEL }], 8101);
        expect(landschaftMeldung.value).toMatchObject({ flaechen: [], gipfel: [GIPFEL], mapRevision: 8101 });
    });

    it("🔴 eine Fläche, deren Anlage zurückgenommen wurde, liest das offene Fenster neu: Es sagt „fehlt“ statt mit einer veralteten Revision zu schreiben; die Liste liest neu", async () => {
        const { steuerung, stand, zaehler } = aufbau();
        steuerung.oeffneFuer(WALD);
        await warte();
        const bearbeitung = steuerung.bearbeitungVon(WALD)!;
        expect(bearbeitung.zustand.value.art).toBe("bereit");
        const vorher = { ...zaehler };

        stand.weg = true;
        meldeLandschaften(
            [
                { kind: "landscape", id: WALD },
                { kind: "area", id: FLAECHE },
            ],
            8200,
        );
        await warte();

        expect(zaehler.liste).toBe(vorher.liste + 1);
        expect(zaehler.landschaft).toBe(vorher.landschaft + 1);
        expect(bearbeitung.zustand.value.art).toBe("fehlt");
        steuerung.destroy();
    });
});

describe("Derographie-Fenster nach einer Rücknahme im Reiter „Änderungen“", () => {
    it("🔴 die Kacheln ziehen mit der Revision der Rücknahme nach, Liste, Fläche und Verlauf lesen neu, die Bearbeitung hat die neue Revision", async () => {
        const { steuerung, stand, zaehler, geaendert } = aufbau();
        steuerung.oeffneFuer(WALD);
        await warte();
        const bearbeitung = steuerung.bearbeitungVon(WALD)!;
        expect(bearbeitung.detail.value?.revision).toBe(3);
        void steuerung.verlaufVon(WALD)?.lade();
        await warte();
        const vorher = { ...zaehler };

        stand.landschaft = 4;
        meldeLandschaften([{ kind: "landscape", id: WALD }], 4711);
        await warte();

        expect(geaendert).toHaveBeenCalledWith(4711);
        expect(zaehler.liste).toBe(vorher.liste + 1);
        expect(zaehler.landschaft).toBe(vorher.landschaft + 1);
        expect(zaehler.verlaufLandschaft).toBe(vorher.verlaufLandschaft + 1);
        expect(steuerung.bearbeitungVon(WALD)).toBe(bearbeitung);
        expect(bearbeitung.detail.value?.revision).toBe(4);
        steuerung.destroy();
    });

    it("🔴 eine Rücknahme, die nur eine Teilfläche oder eine Beschriftung nennt (Form, Beschriftungsfeld), erreicht das Fenster ihrer Landschaft", async () => {
        const { steuerung, stand, zaehler } = aufbau();
        steuerung.oeffneFuer(WALD);
        await warte();
        const geladen = zaehler.landschaft;

        stand.landschaft = 4;
        meldeLandschaften([{ kind: "area", id: FLAECHE }], 5000);
        await warte();
        expect(zaehler.landschaft).toBe(geladen + 1);
        expect(steuerung.bearbeitungVon(WALD)?.detail.value?.revision).toBe(4);

        stand.landschaft = 5;
        meldeLandschaften([{ kind: "label", id: LABEL }], 5001);
        await warte();
        expect(zaehler.landschaft).toBe(geladen + 2);

        stand.landschaft = 6;
        meldeLandschaften([{ kind: "terrain_control", id: FLAECHE }], 5002);
        await warte();
        expect(zaehler.landschaft).toBe(geladen + 3);
        expect(steuerung.bearbeitungVon(WALD)?.detail.value?.revision).toBe(6);
        steuerung.destroy();
    });

    it("🔴 ein Gebirge, dessen Gipfel zurückgenommen wurde, liest neu: Die Gipfelliste im Fenster trägt dessen Revision", async () => {
        const { steuerung, stand, zaehler } = aufbau({ peaks: [{ id: GIPFEL, revision: 2 }] });
        steuerung.oeffneFuer(WALD);
        await warte();
        expect(steuerung.bearbeitungVon(WALD)?.detail.value?.peaks?.[0]?.revision).toBe(2);
        const geladen = zaehler.landschaft;

        stand.peaks = [{ id: GIPFEL, revision: 3 }];
        meldeLandschaften([{ kind: "peak", id: GIPFEL }], 6000);
        await warte();

        expect(zaehler.landschaft).toBe(geladen + 1);
        expect(steuerung.bearbeitungVon(WALD)?.detail.value?.peaks?.[0]?.revision).toBe(3);
        steuerung.destroy();
    });

    it("🔴 ein Fenster, das die Rücknahme nicht berührt, liest nicht neu; die Kacheln ziehen trotzdem nach", async () => {
        const { steuerung, zaehler, geaendert } = aufbau();
        steuerung.oeffneFuer(WALD);
        await warte();
        steuerung.oeffneFuer(ANDERE);
        await warte();
        void steuerung.verlaufVon(ANDERE)?.lade();
        await warte();
        const vorher = { ...zaehler };

        meldeLandschaften([{ kind: "landscape", id: WALD }], 7000);
        await warte();

        expect(geaendert).toHaveBeenCalledWith(7000);
        expect(zaehler.andere).toBe(vorher.andere);
        expect(zaehler.verlaufAndere).toBe(vorher.verlaufAndere);
        steuerung.destroy();
    });

    it("🔴 laufende Bearbeitung: das Ungeschriebene bleibt, der Stand wird nicht unter ihr ausgetauscht, die Kacheln ziehen nach", async () => {
        const { steuerung, stand, geaendert } = aufbau();
        steuerung.oeffneFuer(WALD);
        await warte();
        const bearbeitung = steuerung.bearbeitungVon(WALD)!;
        bearbeitung.feld((felder) => ({ ...felder, name: "Neuer Name" }));
        await warte();
        expect(bearbeitung.lage.value.aktiv).toBe(true);

        stand.landschaft = 4;
        meldeLandschaften([{ kind: "landscape", id: WALD }], 8000);
        await warte();

        expect(geaendert).toHaveBeenCalledWith(8000);
        expect(bearbeitung.lage.value.aktiv).toBe(true);
        expect(bearbeitung.stand.value?.felder.name).toBe("Neuer Name");
        expect(bearbeitung.detail.value?.revision).toBe(3);
        steuerung.destroy();
    });
});

describe("Gipfel-Fenster nach einer Rücknahme im Reiter „Änderungen“", () => {
    it("🔴 Gipfel und Verlauf lesen neu, die Bearbeitung hat die neue Revision, die Kacheln ziehen nach", async () => {
        const { steuerung, stand, zaehler, geaendert } = aufbau();
        const gegenstand = steuerung.oeffneGipfel(GIPFEL, "Probezinne");
        expect(gegenstand).toBeDefined();
        await warte();
        const bearbeitung = steuerung.gipfelBearbeitungVon(`gipfel:${GIPFEL}`)!;
        expect(bearbeitung.detail.value?.revision).toBe(2);
        void steuerung.verlaufVon(`gipfel:${GIPFEL}`)?.lade();
        await warte();
        const vorher = { ...zaehler };

        stand.gipfel = 3;
        meldeLandschaften([{ kind: "peak", id: GIPFEL }], 9000);
        await warte();

        expect(geaendert).toHaveBeenCalledWith(9000);
        expect(zaehler.gipfel).toBe(vorher.gipfel + 1);
        expect(zaehler.verlaufGipfel).toBe(vorher.verlaufGipfel + 1);
        expect(steuerung.gipfelBearbeitungVon(`gipfel:${GIPFEL}`)).toBe(bearbeitung);
        expect(bearbeitung.detail.value?.revision).toBe(3);
        steuerung.destroy();
    });

    it("🔴 ein anderer Gipfel oder nur eine Fläche berührt das Gipfelfenster nicht", async () => {
        const { steuerung, zaehler } = aufbau();
        steuerung.oeffneGipfel(GIPFEL, "Probezinne");
        await warte();
        const geladen = zaehler.gipfel;

        meldeLandschaften([{ kind: "peak", id: FREMDER_GIPFEL }], 9100);
        meldeLandschaften([{ kind: "landscape", id: WALD }], 9101);
        await warte();

        expect(zaehler.gipfel).toBe(geladen);
        steuerung.destroy();
    });
});

describe("Hören und Aufhören", () => {
    it("🔴 eine zweite Meldung mit gleichem Inhalt wirkt wieder; nach `destroy` hört die Steuerung nicht mehr zu", async () => {
        const { steuerung, geaendert } = aufbau();
        meldeLandschaften([{ kind: "landscape", id: WALD }], 9500);
        await warte();
        meldeLandschaften([{ kind: "landscape", id: WALD }], 9500);
        await warte();
        expect(geaendert).toHaveBeenCalledTimes(2);

        steuerung.destroy();
        meldeLandschaften([{ kind: "landscape", id: WALD }], 9501);
        await warte();
        expect(geaendert).toHaveBeenCalledTimes(2);
    });
});
