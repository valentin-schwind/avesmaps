import { describe, expect, it, vi } from "vitest";
import type { EditorPowerlineDetail, EditorPowerlineList } from "@avesmaps3d/shared";
import { createWerkzeugfenster } from "../src/editor-panel/werkzeugfenster";
import { kraftlinieMeldung, meldeKraftlinien } from "../src/kraftlinieneditor/kraftlinie-melde";
import { createKraftlinieneditorSteuerung } from "../src/kraftlinieneditor/kraftlinieneditor-steuerung";

/**
 * Kraftlinien, die der Server zurücknimmt (WI-0265 B6h, Reiter „Änderungen“ oder Verlauf einer Linie): Ein offenes Kraftlinienfenster hält die Revisionen seiner Abschnitte vom letzten Lesen.
 * Problemfälle: Das Fenster zeigt nach dem ↺ den alten Stand und schreibt mit einer veralteten Revision (409 beim nächsten „Fertig“); sein Verlauf nennt die Rücknahme nicht; die Kacheln
 * ziehen nicht nach; ein Fenster, das die Rücknahme nicht berührt, liest unnötig neu; ein Fenster mit laufender Bearbeitung verliert sein Ungeschriebenes.
 */

const ANKER = "0b0b0b0b-0000-4000-8000-000000000001";
const ZWEITER = "0b0b0b0b-0000-4000-8000-000000000002";
const ANDERE = "0b0b0b0b-0000-4000-8000-000000000009";
const ORT = "0a0a0a0a-0000-4000-8000-000000000001";

const KNOTEN = "0c0c0c0c-0000-4000-8000-000000000001";

const linie = (
    anker: string,
    name: string,
    abschnitte: readonly string[],
    revision: number,
    knoten: readonly string[] = [],
): EditorPowerlineDetail =>
    ({
        id: anker,
        name,
        circle: "voll",
        shape: "strang",
        segments: abschnitte.map((id, i) => ({
            id,
            from: `k${String(i)}`,
            to: `k${String(i + 1)}`,
            curve: null,
            labelVisible: true,
            revision,
        })),
        nodes: knoten.map((id) => ({ id, kind: "nodix", nodix: true, meets: [] })),
    }) as EditorPowerlineDetail;

const LISTE: EditorPowerlineList = {
    rows: [
        { id: ANKER, name: "Ley von Gareth", circle: "voll", shape: "strang", segments: 2, nodes: 3 },
        { id: ANDERE, name: "Ley von Punin", circle: "voll", shape: "strang", segments: 1, nodes: 2 },
    ],
};

const ruhe = () => new Promise((r) => setTimeout(r, 0));
const warte = async () => {
    for (let i = 0; i < 6; i += 1) await ruhe();
};

function aufbau() {
    /** Die Revision, die der Server jetzt nennt: Die Rücknahme hat sie weitergezählt. */
    const stand = { gareth: 2, punin: 4 };
    const zaehler = { liste: 0, gareth: 0, punin: 0, verlaufGareth: 0, verlaufPunin: 0 };
    const fetcher = vi.fn(async (eingabe: RequestInfo | URL) => {
        const url = String(eingabe);
        const antwort = (body: unknown) => new Response(JSON.stringify(body));
        if (url === "/api/editor/powerlines") {
            zaehler.liste += 1;
            return antwort(LISTE);
        }
        if (url === `/api/editor/powerlines/${ANKER}/history`) {
            zaehler.verlaufGareth += 1;
            return antwort({ entries: [] });
        }
        if (url === `/api/editor/powerlines/${ANDERE}/history`) {
            zaehler.verlaufPunin += 1;
            return antwort({ entries: [] });
        }
        if (url === `/api/editor/powerlines/${ANKER}` || url === `/api/editor/powerlines/${ZWEITER}`) {
            zaehler.gareth += 1;
            return antwort(linie(ANKER, "Ley von Gareth", [ANKER, ZWEITER], stand.gareth, [KNOTEN]));
        }
        if (url === `/api/editor/powerlines/${ANDERE}`) {
            zaehler.punin += 1;
            return antwort(linie(ANDERE, "Ley von Punin", [ANDERE], stand.punin));
        }
        return new Response("{}", { status: 404 });
    });
    const geaendert = vi.fn();
    const steuerung = createKraftlinieneditorSteuerung(createWerkzeugfenster(undefined), fetcher as never, undefined, {
        sperre: {
            nimm: vi.fn(async () => ({ art: "genommen" as const, sperre: { own: true } as never })),
            gib: vi.fn(),
            beiVerlust: () => () => undefined,
        },
        geaendert,
        darfSchreiben: () => true,
    });
    return { steuerung, stand, zaehler, geaendert };
}

describe("Meldung nach einer Rücknahme: was gemeldet wird", () => {
    it("🔴 Abschnitte von Kraftlinien werden gemeldet, Orte, Wege, Gebiete und Landschaften nicht; ohne etwas davon entsteht keine Meldung", () => {
        meldeKraftlinien(
            [
                { kind: "place", id: ORT },
                { kind: "powerline", id: ANKER },
                { kind: "powerline", id: ZWEITER },
                { kind: "territory", id: ORT },
                { kind: "nodix", id: ORT },
            ],
            4711,
        );
        const meldung = kraftlinieMeldung.value;
        expect(meldung?.abschnitte).toEqual([ANKER, ZWEITER]);
        expect(meldung?.mapRevision).toBe(4711);

        meldeKraftlinien(
            [
                { kind: "place", id: ORT },
                { kind: "territory", id: ORT },
            ],
            4712,
        );
        expect(kraftlinieMeldung.value).toBe(meldung);
    });
});

describe("Kraftlinienpunkte nach einer Rücknahme (B8b)", () => {
    it("🔴 ein Kraftlinienpunkt in `affected` wird gemeldet, auch ohne Abschnitt; das Fenster einer Linie, die dort endet, liest neu, ein fremdes nicht", async () => {
        meldeKraftlinien([{ kind: "nodix", id: KNOTEN }], 6100);
        expect(kraftlinieMeldung.value).toMatchObject({ abschnitte: [], knoten: [KNOTEN], mapRevision: 6100 });

        const { steuerung, stand, zaehler, geaendert } = aufbau();
        await steuerung.oeffneFuer(ANKER);
        await warte();
        await steuerung.oeffneFuer(ANDERE);
        await warte();
        const vorher = { ...zaehler };

        stand.gareth = 3;
        meldeKraftlinien([{ kind: "nodix", id: KNOTEN }], 6200);
        await warte();

        expect(geaendert).toHaveBeenCalledWith(6200);
        expect(zaehler.liste).toBe(vorher.liste + 1);
        expect(zaehler.gareth).toBe(vorher.gareth + 1);
        expect(zaehler.punin).toBe(vorher.punin);
        expect(steuerung.bearbeitungVon(ANKER)?.detail.value?.segments[0]?.revision).toBe(3);
        steuerung.destroy();
    });
});

describe("Sammelansicht der Mehrfachauswahl nach einer Rücknahme (B6h2)", () => {
    async function mitAuswahl() {
        const a = aufbau();
        await a.steuerung.oeffneFuer(ANKER);
        await warte();
        const fensterId = a.steuerung.fenster.value[0]!.id;
        a.steuerung.setzeAngehakt(fensterId, [ANKER, ANDERE]);
        a.steuerung.setzeMehrfach(fensterId, true);
        const sammel = a.steuerung.sammelVon(fensterId)!;
        await vi.waitFor(() => expect(sammel.details.value.size).toBe(2));
        return { ...a, sammel };
    }

    it("🔴 eine Rücknahme an einer Linie der Auswahl lässt die Auswahl ihre Revisionen neu lesen; der Entwurf bleibt", async () => {
        const { steuerung, sammel, stand, zaehler } = await mitAuswahl();
        sammel.entwurf.aufWiki("description");
        expect(sammel.entwurf.lage.value.ungespeichert).toBe(1);
        expect(sammel.details.value.get(ANDERE)?.segments[0]?.revision).toBe(4);
        const gelesen = zaehler.punin;

        stand.punin = 5;
        meldeKraftlinien([{ kind: "powerline", id: ANDERE }], 4711);
        await warte();

        expect(zaehler.punin).toBe(gelesen + 1);
        expect(sammel.details.value.get(ANDERE)?.segments[0]?.revision).toBe(5);
        expect(sammel.entwurf.lage.value.ungespeichert).toBe(1);
        expect(steuerung.sammelVon(steuerung.fenster.value[0]!.id)).toBe(sammel);
        steuerung.destroy();
    });

    it("🔴 ein anderer Abschnitt der Linie (nicht ihr Anker) erreicht die Auswahl über den gelesenen Stand", async () => {
        const { steuerung, sammel, stand, zaehler } = await mitAuswahl();
        const gelesen = zaehler.gareth;

        stand.gareth = 3;
        meldeKraftlinien([{ kind: "powerline", id: ZWEITER }], 4800);
        await warte();

        // Das Fenster der Linie liest sie neu, die Auswahl ebenso (sie liest alle ihre Linien).
        expect(zaehler.gareth).toBeGreaterThan(gelesen + 1);
        expect(sammel.details.value.get(ANKER)?.segments.map((a) => a.revision)).toEqual([3, 3]);
        steuerung.destroy();
    });

    it("🔴 eine Rücknahme an einer Linie außerhalb der Auswahl lässt sie in Ruhe", async () => {
        const { steuerung, zaehler } = await mitAuswahl();
        const vorher = { ...zaehler };

        meldeKraftlinien([{ kind: "powerline", id: ORT }], 4900);
        await warte();

        expect(zaehler.gareth).toBe(vorher.gareth);
        expect(zaehler.punin).toBe(vorher.punin);
        steuerung.destroy();
    });
});

describe("Kraftlinienfenster nach einer Rücknahme", () => {
    it("🔴 das Fenster der berührten Linie liest Linie und Verlauf neu, die Liste folgt, die Kacheln ziehen mit der Revision der Rücknahme nach", async () => {
        const { steuerung, stand, zaehler, geaendert } = aufbau();
        const bearbeitung = (await steuerung.oeffneFuer(ANKER))!;
        await warte();
        expect(bearbeitung.detail.value?.segments[0]?.revision).toBe(2);
        void steuerung.verlaufVon(ANKER)?.lade();
        await warte();
        const vorher = { ...zaehler };

        stand.gareth = 3;
        meldeKraftlinien([{ kind: "powerline", id: ANKER }], 4711);
        await warte();

        expect(geaendert).toHaveBeenCalledWith(4711);
        expect(zaehler.liste).toBe(vorher.liste + 1);
        expect(zaehler.gareth).toBe(vorher.gareth + 1);
        expect(zaehler.verlaufGareth).toBe(vorher.verlaufGareth + 1);
        // Dieselbe Bearbeitung, mit den neuen Revisionen: Das nächste „Fertig“ schreibt gegen den Stand von jetzt.
        expect(steuerung.bearbeitungVon(ANKER)).toBe(bearbeitung);
        expect(bearbeitung.detail.value?.segments.map((a) => a.revision)).toEqual([3, 3]);
        steuerung.destroy();
    });

    it("🔴 eine Rücknahme, die nur einen anderen Abschnitt der Linie nennt (nicht den Anker), erreicht ihr Fenster", async () => {
        const { steuerung, stand, zaehler } = aufbau();
        await steuerung.oeffneFuer(ANKER);
        await warte();
        const geladen = zaehler.gareth;

        stand.gareth = 3;
        meldeKraftlinien([{ kind: "powerline", id: ZWEITER }], 5000);
        await warte();

        expect(zaehler.gareth).toBe(geladen + 1);
        expect(steuerung.bearbeitungVon(ANKER)?.detail.value?.segments[1]?.revision).toBe(3);
        steuerung.destroy();
    });

    it("🔴 ein Fenster, das die Rücknahme nicht berührt, liest nicht neu; die Kacheln ziehen trotzdem nach", async () => {
        const { steuerung, zaehler, geaendert } = aufbau();
        await steuerung.oeffneFuer(ANKER);
        await warte();
        await steuerung.oeffneFuer(ANDERE);
        await warte();
        void steuerung.verlaufVon(ANDERE)?.lade();
        await warte();
        const vorher = { ...zaehler };

        meldeKraftlinien([{ kind: "powerline", id: ANKER }], 7000);
        await warte();

        expect(geaendert).toHaveBeenCalledWith(7000);
        expect(zaehler.punin).toBe(vorher.punin);
        expect(zaehler.verlaufPunin).toBe(vorher.verlaufPunin);
        steuerung.destroy();
    });

    it("🔴 laufende Bearbeitung: das Ungeschriebene bleibt, der Stand wird nicht unter ihr ausgetauscht, die Kacheln ziehen nach", async () => {
        const { steuerung, stand, geaendert } = aufbau();
        const bearbeitung = (await steuerung.oeffneFuer(ANKER))!;
        await vi.waitFor(() => expect(bearbeitung.zustand.value.art).toBe("bereit"));
        bearbeitung.feld((felder) => ({ ...felder, description: "Eine Ader." }), "description");
        await warte();
        expect(bearbeitung.lage.value.aktiv).toBe(true);

        stand.gareth = 3;
        meldeKraftlinien([{ kind: "powerline", id: ANKER }], 8000);
        await warte();

        expect(geaendert).toHaveBeenCalledWith(8000);
        expect(bearbeitung.lage.value.aktiv).toBe(true);
        expect(bearbeitung.stand.value?.felder.description).toBe("Eine Ader.");
        expect(bearbeitung.detail.value?.segments[0]?.revision).toBe(2);
        steuerung.destroy();
    });

    it("🔴 eine zweite Meldung mit gleichem Inhalt wirkt wieder; nach `destroy` hört die Steuerung nicht mehr zu", async () => {
        const { steuerung, zaehler, geaendert } = aufbau();
        await steuerung.oeffneFuer(ANKER);
        await warte();
        const geladen = zaehler.gareth;

        meldeKraftlinien([{ kind: "powerline", id: ANKER }], 9000);
        await warte();
        meldeKraftlinien([{ kind: "powerline", id: ANKER }], 9000);
        await warte();
        expect(zaehler.gareth).toBe(geladen + 2);

        steuerung.destroy();
        geaendert.mockClear();
        meldeKraftlinien([{ kind: "powerline", id: ANKER }], 9001);
        await warte();
        expect(geaendert).not.toHaveBeenCalled();
        expect(zaehler.gareth).toBe(geladen + 2);
    });
});
