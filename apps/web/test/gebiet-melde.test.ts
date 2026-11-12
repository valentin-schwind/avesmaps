import { describe, expect, it, vi } from "vitest";
import type { EditorTerritoryDetail } from "@avesmaps3d/shared";
import { createWerkzeugfenster } from "../src/editor-panel/werkzeugfenster";
import { gebietMeldung, meldeGebiete } from "../src/gebietseditor/gebiet-melde";
import { createGebietseditorSteuerung } from "../src/gebietseditor/gebietseditor-steuerung";

/**
 * Gebiete, die der Server zurücknimmt (WI-0265 B6h, Reiter „Änderungen“ oder Verlauf eines Objekts): Ein offenes Gebietsfenster hält die Revisionen vom letzten Lesen. Problemfälle: Das
 * Fenster zeigt nach dem ↺ den alten Stand und schreibt mit einer veralteten Revision (409 beim nächsten „Fertig“); sein Verlauf nennt die Rücknahme nicht; Karte und Infopanel ziehen nicht
 * nach; ein Fenster, das die Rücknahme nicht berührt, liest unnötig neu; ein Fenster mit laufender Bearbeitung verliert sein Ungeschriebenes.
 */

const GEBIET = "a6a6a6a6-0000-4000-8000-000000000001";
const FLAECHE = "a6a6a6a6-0000-4000-8000-0000000000a1";
const OBER = "a6a6a6a6-0000-4000-8000-000000000002";
const FREMD = "a6a6a6a6-0000-4000-8000-000000000003";
const ORT = "0a0a0a0a-0000-4000-8000-000000000001";

const NAMEN: Record<string, string> = { [GEBIET]: "Valis Reich", [OBER]: "Oberreich", [FREMD]: "Fremdes Reich" };

const detailVon = (id: string, revision: number): EditorTerritoryDetail =>
    ({
        id,
        revision,
        name: NAMEN[id]!,
        color: "#888888",
        opacity: 0.33,
        order: 0,
        parents: [],
        // Das Obergebiet nennt das Gebiet als Untergebiet: Wird dessen Obergebiet zurückgenommen, steht es in der Liste.
        children: id === OBER ? [{ id: GEBIET, name: NAMEN[GEBIET] }] : [],
        details: {},
        areas: id === GEBIET ? [{ id: FLAECHE, revision: 5 }] : [],
        claimedBy: [],
        claims: [],
    }) as unknown as EditorTerritoryDetail;

const ruhe = () => new Promise((r) => setTimeout(r, 0));
const warte = async () => {
    for (let i = 0; i < 6; i += 1) await ruhe();
};

function aufbau() {
    /** Die Revisionen, die der Server jetzt nennt: Die Rücknahme hat sie weitergezählt. */
    const stand: Record<string, number> = { [GEBIET]: 3, [OBER]: 6, [FREMD]: 8 };
    const zaehler = {
        liste: 0,
        hierarchie: 0,
        sammelStand: 0,
        detail: { [GEBIET]: 0, [OBER]: 0, [FREMD]: 0 } as Record<string, number>,
        verlauf: { [GEBIET]: 0, [OBER]: 0, [FREMD]: 0 } as Record<string, number>,
    };
    const fetcher = vi.fn(async (eingabe: RequestInfo | URL) => {
        const url = String(eingabe);
        const antwort = (body: unknown) => new Response(JSON.stringify(body));
        if (url === "/api/editor/territories") {
            zaehler.liste += 1;
            return antwort({ yearBf: 1049, rows: [{ id: GEBIET }, { id: OBER }, { id: FREMD }] });
        }
        if (url.endsWith("/hierarchy")) {
            zaehler.hierarchie += 1;
            return antwort({});
        }
        if (url.endsWith("/sammel/stand")) {
            zaehler.sammelStand += 1;
            return antwort({ territories: [] });
        }
        for (const id of [GEBIET, OBER, FREMD]) {
            if (url === `/api/editor/territories/${id}/history`) {
                zaehler.verlauf[id]! += 1;
                return antwort({ entries: [] });
            }
            if (url === `/api/editor/territories/${id}`) {
                zaehler.detail[id]! += 1;
                return antwort(detailVon(id, stand[id]!));
            }
        }
        return new Response("{}", { status: 404 });
    });
    const geaendert = vi.fn();
    const steuerung = createGebietseditorSteuerung(createWerkzeugfenster(undefined), fetcher as never, undefined, {
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
    it("🔴 Gebiete und ihre Flächen werden gemeldet, Orte, Wege, Landschaften und Kraftlinien nicht; ohne etwas davon entsteht keine Meldung", () => {
        meldeGebiete(
            [
                { kind: "place", id: ORT },
                { kind: "territory", id: GEBIET },
                { kind: "territory_area", id: FLAECHE },
                { kind: "territory", id: OBER },
                { kind: "powerline", id: ORT },
                { kind: "landscape", id: ORT },
            ],
            4711,
        );
        const meldung = gebietMeldung.value;
        expect(meldung?.gebiete).toEqual([GEBIET, OBER]);
        expect(meldung?.flaechen).toEqual([FLAECHE]);
        expect(meldung?.mapRevision).toBe(4711);

        meldeGebiete(
            [
                { kind: "place", id: ORT },
                { kind: "powerline", id: ORT },
            ],
            4712,
        );
        expect(gebietMeldung.value).toBe(meldung);
    });
});

describe("Gebietsfenster nach einer Rücknahme", () => {
    it("🔴 das Fenster des berührten Gebiets liest Gebiet und Verlauf neu, Liste und Hierarchie folgen, Karte und Infopanel ziehen nach", async () => {
        const { steuerung, stand, zaehler, geaendert } = aufbau();
        steuerung.oeffneFuer(GEBIET);
        await warte();
        const bearbeitung = steuerung.bearbeitungVon(GEBIET)!;
        expect(bearbeitung.detail.value?.revision).toBe(3);
        void bearbeitung.verlauf.lade();
        await warte();
        const vorher = { ...zaehler, detail: { ...zaehler.detail }, verlauf: { ...zaehler.verlauf } };

        stand[GEBIET] = 4;
        meldeGebiete([{ kind: "territory", id: GEBIET }], 4711);
        await warte();

        expect(geaendert).toHaveBeenCalledWith(4711, GEBIET);
        expect(zaehler.liste).toBe(vorher.liste + 1);
        expect(zaehler.hierarchie).toBe(vorher.hierarchie + 1);
        expect(zaehler.detail[GEBIET]).toBe(vorher.detail[GEBIET]! + 1);
        expect(zaehler.verlauf[GEBIET]).toBe(vorher.verlauf[GEBIET]! + 1);
        // Dieselbe Bearbeitung, mit der neuen Revision: Das nächste „Fertig“ schreibt gegen den Stand von jetzt.
        expect(steuerung.bearbeitungVon(GEBIET)).toBe(bearbeitung);
        expect(bearbeitung.detail.value?.revision).toBe(4);
        steuerung.destroy();
    });

    it("🔴 eine Rücknahme, die nur die Fläche eines Gebiets nennt (Zoomspanne), erreicht das Fenster, das sie trägt", async () => {
        const { steuerung, stand, zaehler } = aufbau();
        steuerung.oeffneFuer(GEBIET);
        await warte();
        const geladen = zaehler.detail[GEBIET]!;

        stand[GEBIET] = 4;
        meldeGebiete([{ kind: "territory_area", id: FLAECHE }], 5000);
        await warte();

        expect(zaehler.detail[GEBIET]).toBe(geladen + 1);
        expect(steuerung.bearbeitungVon(GEBIET)?.detail.value?.revision).toBe(4);
        steuerung.destroy();
    });

    it("🔴 das Fenster des Obergebiets, das das berührte Gebiet als Untergebiet nennt, liest neu (sonst bliebe „Untergebiete“ stehen)", async () => {
        const { steuerung, stand, zaehler } = aufbau();
        steuerung.oeffneFuer(OBER);
        await warte();
        const geladen = zaehler.detail[OBER]!;

        stand[OBER] = 7;
        meldeGebiete([{ kind: "territory", id: GEBIET }], 5100);
        await warte();

        expect(zaehler.detail[OBER]).toBe(geladen + 1);
        expect(steuerung.bearbeitungVon(OBER)?.detail.value?.revision).toBe(7);
        steuerung.destroy();
    });

    it("🔴 ein Fenster, das die Rücknahme nicht berührt, liest nicht neu; die Kacheln ziehen trotzdem nach", async () => {
        const { steuerung, zaehler, geaendert } = aufbau();
        steuerung.oeffneFuer(GEBIET);
        await warte();
        steuerung.oeffneFuer(FREMD);
        await warte();
        void steuerung.bearbeitungVon(FREMD)?.verlauf.lade();
        await warte();
        const vorher = { detail: zaehler.detail[FREMD], verlauf: zaehler.verlauf[FREMD] };

        meldeGebiete([{ kind: "territory", id: GEBIET }], 7000);
        await warte();

        expect(geaendert).toHaveBeenCalledWith(7000, GEBIET);
        expect(zaehler.detail[FREMD]).toBe(vorher.detail);
        expect(zaehler.verlauf[FREMD]).toBe(vorher.verlauf);
        steuerung.destroy();
    });

    it("🔴 laufende Bearbeitung: das Ungeschriebene bleibt, der Stand wird nicht unter ihr ausgetauscht, die Kacheln ziehen nach", async () => {
        const { steuerung, stand, geaendert } = aufbau();
        steuerung.oeffneFuer(GEBIET);
        await warte();
        const bearbeitung = steuerung.bearbeitungVon(GEBIET)!;
        bearbeitung.feld((felder) => ({ ...felder, name: "Neuer Name" }), "name");
        await warte();
        expect(bearbeitung.lage.value.aktiv).toBe(true);

        stand[GEBIET] = 4;
        meldeGebiete([{ kind: "territory", id: GEBIET }], 8000);
        await warte();

        expect(geaendert).toHaveBeenCalledWith(8000, GEBIET);
        expect(bearbeitung.lage.value.aktiv).toBe(true);
        expect(bearbeitung.stand.value?.felder.name).toBe("Neuer Name");
        expect(bearbeitung.detail.value?.revision).toBe(3);
        steuerung.destroy();
    });

    it("🔴 die Mehrfachauswahl liest den Stand ihrer Gebiete neu, wenn die Rücknahme eines davon berührt; ein anderes Gebiet lässt sie in Ruhe", async () => {
        const { steuerung, zaehler } = aufbau();
        steuerung.oeffneFuer(GEBIET);
        await vi.waitFor(() => expect(steuerung.liste.value?.rows).toHaveLength(3));
        steuerung.mehrfachauswahl.setzeAn(true);
        steuerung.mehrfachauswahl.setzeAngehakt([GEBIET, OBER]);
        await warte();
        expect(steuerung.mehrfachauswahl.entwurf.value).toBeDefined();
        const gelesen = zaehler.sammelStand;
        expect(gelesen).toBeGreaterThan(0);

        meldeGebiete([{ kind: "territory", id: FREMD }], 8500);
        await warte();
        expect(zaehler.sammelStand).toBe(gelesen);

        meldeGebiete([{ kind: "territory", id: OBER }], 8501);
        await warte();
        expect(zaehler.sammelStand).toBe(gelesen + 1);
        steuerung.destroy();
    });

    it("🔴 eine zweite Meldung mit gleichem Inhalt wirkt wieder; nach `destroy` hört die Steuerung nicht mehr zu", async () => {
        const { steuerung, zaehler, geaendert } = aufbau();
        steuerung.oeffneFuer(GEBIET);
        await warte();
        const geladen = zaehler.detail[GEBIET]!;

        meldeGebiete([{ kind: "territory", id: GEBIET }], 9000);
        await warte();
        meldeGebiete([{ kind: "territory", id: GEBIET }], 9000);
        await warte();
        expect(zaehler.detail[GEBIET]).toBe(geladen + 2);

        steuerung.destroy();
        geaendert.mockClear();
        meldeGebiete([{ kind: "territory", id: GEBIET }], 9001);
        await warte();
        expect(geaendert).not.toHaveBeenCalled();
        expect(zaehler.detail[GEBIET]).toBe(geladen + 2);
    });
});
