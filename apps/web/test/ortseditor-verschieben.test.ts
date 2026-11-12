import { describe, expect, it, vi } from "vitest";
import type {
    EditorFreePathEnd,
    EditorMoveTargets,
    EditorPathEnd,
    EditorPlaceDetail,
    OperationReceipt,
    PlaceMoveBody,
} from "@avesmaps3d/shared";
import { aufNeuenStand, entwurfAus, setzeText } from "../src/ortseditor/entwurf.ts";
import { createOrtBearbeitung, type OrtApi } from "../src/ortseditor/ort-bearbeitung.ts";
import type { FreigabeAngebot } from "../src/editor-sperre/sperre.ts";
import type { OrtSperre } from "../src/ortseditor/ort-sperre.ts";
import { createOrtVerschieben, type VerschiebeApi, type VerschiebeKarte } from "../src/ortseditor/ort-verschieben.ts";
import { ORT as ORT_ART } from "../src/map/geometrie/arten.ts";
import type { Aenderung, Treffer } from "../src/map/geometrie/geometrie.ts";
import { ortNachbarn, ortTeile, ortZiele, zugAus } from "../src/map/geometrie/ort.ts";
import { einrasten, mitziehende } from "../src/map/geometrie/rechnung.ts";
import { bewegung, quittungAus, startAus, type Punkt, type Zug } from "../src/ortseditor/verschieben.ts";

/**
 * „✥ Ort verschieben“ (WI-0128 E12; EDIT-0001 §4.4, D11, Tests T12.2 bis T12.9; EDIT-0003 G4, Vali 2026-10-31): Rechnung und Steuerung
 * ohne Karte. Einrasten im Fangradius an freien Wegenden, Mitziehen der Enden am Ort, Strg lässt liegen (seit WI-0177 Stufe 4 über das
 * Geometrie-Modul, `map/geometrie/ort.ts`). Loslassen ist ein Schritt im Entwurf und schreibt nichts, man zieht mehrmals, ↶ ↷ und
 * „Verwerfen“ gehen über den Entwurf, „Fertig“ schreibt genau eine Operation mit der letzten Lage, Esc fragt bei Ungespeichertem, ein
 * Konflikt nennt die Person, und ein Entwurf der Felder überlebt das Verschieben seines Orts.
 */

const ORT = "7527ed5b-303a-57af-926e-ed41a8b82dfc";
const WEG_A = "0b6f0c55-0000-4000-8000-00000000000a";
const WEG_B = "0b6f0c55-0000-4000-8000-00000000000b";
const WEG_C = "0b6f0c55-0000-4000-8000-00000000000c";

const enden: EditorPathEnd[] = [
    {
        pathId: WEG_A,
        name: "Reichsstraße",
        end: "start",
        revision: 3,
        x: 450.2,
        y: 535.64,
        neighbor: { x: 452, y: 540 },
    },
    { pathId: WEG_B, name: "Pfad", end: "end", revision: 5, x: 450.3, y: 535.6, neighbor: { x: 445, y: 530 } },
];
const frei: EditorFreePathEnd[] = [
    { pathId: WEG_C, name: "Landstraße", end: "end", x: 460, y: 535.64 },
    { pathId: WEG_C, name: "Landstraße", end: "start", x: 470, y: 535.64 },
];

function ort(revision = 7, ueber: Partial<EditorPlaceDetail> = {}): EditorPlaceDetail {
    return {
        publicId: ORT,
        revision,
        name: "Gratenfels",
        subtype: "stadt",
        kind: null,
        position: { x: 450.2, y: 535.64 },
        active: true,
        hidden: false,
        ruined: false,
        nodix: false,
        seaport: false,
        underground: false,
        withdrawn: false,
        approximate: false,
        sourceSystem: "legacy",
        fields: {
            description: { value: null, origin: null, wiki: "Hauptstadt der Grafschaft." },
            einwohner: { value: null, origin: null, wiki: "2.200" },
            lage: { value: null, origin: null, wiki: "Kosch" },
            oberhaupt: { value: null, origin: null, wiki: null },
        },
        wiki: null,
        pathEnds: enden,
        ...ueber,
    };
}

/** Ein Kartenpunkt sind hier 2 Bildpunkte: 5 Kartenpunkte sind 10 px. */
const schirm = (at: Punkt): Punkt => ({ x: at.x * 2, y: at.y * 2 });
const start = startAus(ort(), frei);

const quittung = (revision: number): OperationReceipt => ({
    operationId: "00000000-0000-4000-8000-000000000001",
    status: "applied",
    environment: "development",
    affected: [
        { kind: "place", id: ORT, revision },
        { kind: "path", id: WEG_A, revision: 4 },
    ],
    derivedWork: [],
    warnings: [],
    mapRevision: 57,
});

/** Der Fangradius der Karteneinstellungen in diesen Fällen: 10 Bildpunkte (G12). */
const FANGRADIUS = 10;

/** Der gezogene Ort an `stelle` (Kartenpunkte), losgelassen: die Handbewegung, wie das Modul sie meldet. */
function losgelassen(stelle: Punkt, getrennt: boolean): Aenderung {
    const [teil] = ortTeile(start);
    const treffer: Treffer | undefined = getrennt
        ? undefined
        : einrasten(
              schirm(stelle),
              ortZiele(start),
              ORT_ART.ziele({ objekt: ORT, nr: 0, index: 0 }, teil!),
              FANGRADIUS,
              schirm,
          );
    const at = treffer?.at ?? stelle;
    return {
        art: "ziehen",
        stelle: { objekt: ORT, nr: 0, index: 0 },
        teile: [{ ...teil!, punkte: [at] }],
        mitgezogen: mitziehende(start.von, at, ortNachbarn(start), [], getrennt),
        treffer,
        getrennt,
    };
}

describe("Rechnung (über das Geometrie-Modul)", () => {
    it("🔴 T12.5 die freien Enden sind die Ziele: im Fangradius rastet der Ort am nächsten ein und sitzt genau darauf, darüber nicht", () => {
        // 4,9 Kartenpunkte = 9,8 px vor dem Ende bei x 460.
        const nah = zugAus(start, losgelassen({ x: 455.1, y: 535.64 }, false));
        expect(nah.ort).toEqual({ x: 460, y: 535.64 });
        expect(nah.eingerastet?.end).toBe("end");
        expect(zugAus(start, losgelassen({ x: 454.9, y: 535.64 }, false)).eingerastet).toBeUndefined();
        // Zwischen zwei Enden gewinnt das nähere.
        expect(zugAus(start, losgelassen({ x: 466, y: 535.64 }, false)).eingerastet?.end).toBe("start");
    });

    it("🔴 die Enden am Ort sind Nachbarn mit dem Endpunkt genau auf dem Ort (Kasten ±0,5): das Modul zieht beide mit, je mit seiner Revision", () => {
        expect(ortNachbarn(start).map((n) => [n.objekt, n.revision, n.punkte])).toEqual([
            [WEG_A, 3, [{ x: 452, y: 540 }, start.von]],
            [WEG_B, 5, [{ x: 445, y: 530 }, start.von]],
        ]);
        const aenderung = losgelassen({ x: 430, y: 520 }, false);
        expect(aenderung.mitgezogen.map((m) => [m.stelle.objekt, m.revision, m.nach])).toEqual([
            [WEG_A, 3, { x: 430, y: 520 }],
            [WEG_B, 5, { x: 430, y: 520 }],
        ]);
    });

    it("🔴 T12.4 Strg (getrennt): nichts rastet ein, nichts zieht mit", () => {
        const aenderung = losgelassen({ x: 458, y: 536 }, true);
        expect(aenderung.mitgezogen).toEqual([]);
        expect(zugAus(start, aenderung)).toEqual({ ort: { x: 458, y: 536 }, getrennt: true, eingerastet: undefined });
    });

    it("🔴 T12.2 und T12.3 Loslassen ist EINE Operation mit jedem Ende am Ort und seiner Revision; ein eingerastetes Ende steht nicht darin", () => {
        const zug: Zug = zugAus(start, losgelassen({ x: 458, y: 536 }, false));
        expect(bewegung(start, zug, "op-1")).toEqual({
            operationId: "op-1",
            baseRevision: 7,
            to: { x: 460, y: 535.64 },
            pathEnds: [
                { pathId: WEG_A, end: "start", baseRevision: 3, to: { x: 460, y: 535.64 } },
                { pathId: WEG_B, end: "end", baseRevision: 5, to: { x: 460, y: 535.64 } },
            ],
        } satisfies PlaceMoveBody);
        expect(quittungAus(start, zug, quittung(8))).toEqual({
            revision: 8,
            mitgezogen: 2,
            eingerastet: true,
            liegen: 0,
        });
    });

    it("🔴 T12.4 getrennt lässt die Operation alle Enden liegen; die Quittung zählt sie", () => {
        const zug = zugAus(start, losgelassen({ x: 430, y: 520 }, true));
        expect(bewegung(start, zug, "op-2").pathEnds).toEqual([]);
        expect(quittungAus(start, zug, quittung(8))).toMatchObject({ mitgezogen: 0, liegen: 2, eingerastet: false });
    });
});

describe("T12.8 Entwurf auf neuem Stand", () => {
    it("🔴 die eigenen Felder bleiben, alles andere ist der neue Stand", () => {
        const vorher = ort(7);
        const jetzt = ort(8, { hidden: true, position: { x: 460, y: 535.64 } });
        const entwurf = setzeText(entwurfAus(vorher), "einwohner", "2.500");
        const neu = aufNeuenStand(vorher, jetzt, entwurf);
        expect(neu.texte.einwohner).toEqual({ wert: "2.500", wiki: false });
        expect(neu.hidden).toBe(true);
    });

    it("🔴 nach dem Verschieben rückt die Bearbeitung ihre Basis vor und behält den Entwurf: Speichern sendet Revision 8, kein Selbstkonflikt", async () => {
        const gelesen = [ort(7), ort(8, { position: { x: 460, y: 535.64 } })];
        const gesendet: unknown[] = [];
        const api: OrtApi = {
            ort: () => Promise.resolve(gelesen.length > 1 ? gelesen.shift()! : gelesen[0]!),
            speichereOrt: (_id, body) => {
                gesendet.push(body);
                return Promise.resolve({ ok: true, quittung: quittung(9) });
            },
        };
        const bearbeitung = createOrtBearbeitung(ORT, api, () => "op-3");
        await vi.waitFor(() => expect(bearbeitung.zustand.value.art).toBe("bereit"));
        bearbeitung.aendere((e) => setzeText(e, "einwohner", "2.500"));
        await bearbeitung.nachVerschieben();
        expect(bearbeitung.detail.value?.revision).toBe(8);
        expect(bearbeitung.ungespeichert.value).toBe(true);
        await bearbeitung.speichern();
        expect(gesendet).toEqual([
            { operationId: "op-3", baseRevision: 8, changes: { einwohner: { value: "2.500" } } },
        ]);
    });
});

describe("Der Stand des Entwurfs auf der Karte", () => {
    it("🔴 EDIT-0003 G4 ohne Stand liegt alles am Start; mit Stand sitzt der Ort dort und die Enden hängen an ihm", () => {
        expect(ortTeile(start)[0]!.punkte).toEqual([start.von]);
        const stand: Zug = { ort: { x: 430, y: 520 }, getrennt: false, eingerastet: undefined };
        expect(ortTeile(start, stand)[0]!.punkte).toEqual([{ x: 430, y: 520 }]);
        expect(ortNachbarn(start, stand).map((n) => n.punkte)).toEqual([
            [
                { x: 452, y: 540 },
                { x: 430, y: 520 },
            ],
            [
                { x: 445, y: 530 },
                { x: 430, y: 520 },
            ],
        ]);
    });

    it("🔴 EDIT-0003 G4 ein gelöster Stand (Strg) lässt die Enden an der Ausgangslage liegen", () => {
        const stand: Zug = { ort: { x: 430, y: 520 }, getrennt: true, eingerastet: undefined };
        expect(ortTeile(start, stand)[0]!.punkte).toEqual([{ x: 430, y: 520 }]);
        expect(ortNachbarn(start, stand).map((n) => n.punkte[1])).toEqual([start.von, start.von]);
    });
});

describe("Steuerung", () => {
    function aufbau(antwort: Awaited<ReturnType<VerschiebeApi["verschiebe"]>>, nachher = ort(7)) {
        const gesendet: PlaceMoveBody[] = [];
        let losgelassen: ((zug: Zug) => void) | undefined;
        const aus = vi.fn();
        let zugLaeuft = false;
        const abbrechen = vi.fn(() => zugLaeuft);
        const setze = vi.fn();
        const sperre = vi.fn();
        const geaendert = vi.fn();
        const gelesen = [ort(7), nachher];
        const api: VerschiebeApi = {
            ort: () => Promise.resolve(gelesen.length > 1 ? gelesen.shift()! : gelesen[0]!),
            ziele: () => Promise.resolve({ radius: 50, freeEnds: frei } satisfies EditorMoveTargets),
            verschiebe: (_id, body) => {
                gesendet.push(body);
                return Promise.resolve(antwort);
            },
        };
        const karte: VerschiebeKarte = {
            zeige: vi.fn(),
            ein: (_start, los) => {
                losgelassen = los;
                return { abbrechen, setze, sperre, aus };
            },
            geaendert,
            zentriere: vi.fn(),
        };
        const steuerung = createOrtVerschieben({ api, karte, ladefehler: "nicht geladen", neueKennung: () => "op-9" });
        return {
            steuerung,
            gesendet,
            los: (zug: Zug) => losgelassen?.(zug),
            zugLaeuft: (an: boolean) => (zugLaeuft = an),
            aus,
            abbrechen,
            setze,
            sperre,
            geaendert,
            karte,
        };
    }
    const zug = zugAus(start, losgelassen({ x: 430, y: 520 }, false));
    const zug2 = zugAus(start, losgelassen({ x: 440, y: 525 }, false));
    const getrennt = zugAus(start, losgelassen({ x: 458, y: 536 }, true));
    const lage = (t: ReturnType<typeof aufbau>) => {
        const jetzt = t.steuerung.laufend.value;
        return jetzt?.art === "zieht" || jetzt?.art === "speichert" ? jetzt.lage : undefined;
    };

    it("🔴 EDIT-0003 G4 Start liest Ort und Ziele; Loslassen schreibt nichts, es ist ein Schritt, und der Modus bleibt offen", async () => {
        const t = aufbau({ ok: true, quittung: quittung(8) });
        await t.steuerung.starte("f1", ORT);
        expect(t.steuerung.laufend.value?.art).toBe("zieht");
        expect(t.karte.zeige).toHaveBeenCalledOnce();
        expect(lage(t)).toMatchObject({ ungespeichert: 0, zurueck: false, wieder: false, frage: false });
        t.los(zug);
        expect(t.gesendet).toEqual([]);
        expect(t.steuerung.laufend.value?.art).toBe("zieht");
        expect(lage(t)).toMatchObject({ ungespeichert: 1, zurueck: true });
        expect(t.aus).not.toHaveBeenCalled();
        expect(t.geaendert).not.toHaveBeenCalled();
    });

    it("🔴 T12.2 EDIT-0003 G4 „Fertig“ schreibt EINE Operation mit der LETZTEN Lage (zweimal gezogen); danach Quittung, Modus aus, Karte neu, Kamera zentriert", async () => {
        const t = aufbau({ ok: true, quittung: quittung(8) });
        await t.steuerung.starte("f1", ORT);
        t.los(zug);
        t.los(zug2);
        expect(lage(t)).toMatchObject({ ungespeichert: 2 });
        await t.steuerung.fertig();
        expect(t.gesendet).toHaveLength(1);
        expect(t.gesendet[0]).toMatchObject({ operationId: "op-9", baseRevision: 7, to: { x: 440, y: 525 } });
        expect(t.gesendet[0]!.pathEnds).toHaveLength(2);
        expect(t.steuerung.laufend.value).toBeUndefined();
        expect(t.steuerung.meldung.value).toMatchObject({ art: "quittung", fenster: "f1", quittung: { revision: 8 } });
        expect(t.aus).toHaveBeenCalledOnce();
        // Die Karte lädt Orte und Wege mit der Kachelrevision der Quittung neu (E13).
        expect(t.geaendert).toHaveBeenCalledWith(57);
        // Danach zentriert die Kamera auf die neue Lage, im Fenster, das verschob (Betreiber 2026-10-11).
        expect(t.karte.zentriere).toHaveBeenCalledWith({ x: 440, y: 525 }, "f1");
    });

    it("🔴 EDIT-0003 G4 ↶ ↷ gehen durch die Züge und setzen den Stand auf der Karte; „Verwerfen“ stellt die Ausgangslage her, der Modus bleibt", async () => {
        const t = aufbau({ ok: true, quittung: quittung(8) });
        await t.steuerung.starte("f1", ORT);
        t.los(zug);
        t.los(zug2);
        t.steuerung.zurueck();
        expect(lage(t)).toMatchObject({ ungespeichert: 1, wieder: true });
        expect(t.setze).toHaveBeenLastCalledWith(zug);
        t.steuerung.wieder();
        expect(t.setze).toHaveBeenLastCalledWith(zug2);
        expect(lage(t)).toMatchObject({ ungespeichert: 2, wieder: false });
        t.steuerung.verwerfen();
        expect(lage(t)).toMatchObject({ ungespeichert: 0 });
        expect(t.setze).toHaveBeenLastCalledWith({ ort: start.von, getrennt: false, eingerastet: undefined });
        expect(t.steuerung.laufend.value?.art).toBe("zieht");
        expect(t.gesendet).toEqual([]);
        expect(t.aus).not.toHaveBeenCalled();
    });

    it("EDIT-0003 G4 ein Zug an dieselbe Stelle ist kein Schritt; nach ↶ fällt, was vorn lag, weg", async () => {
        const t = aufbau({ ok: true, quittung: quittung(8) });
        await t.steuerung.starte("f1", ORT);
        t.los(zug);
        t.los(zug);
        expect(lage(t)).toMatchObject({ ungespeichert: 1 });
        t.steuerung.zurueck();
        t.los(zug2);
        expect(lage(t)).toMatchObject({ ungespeichert: 1, wieder: false });
        await t.steuerung.fertig();
        expect(t.gesendet[0]).toMatchObject({ to: { x: 440, y: 525 } });
    });

    it("🔴 EDIT-0003 G4 „Fertig“ ohne Schritte, oder mit dem Ort wieder am Start, beendet den Modus still und schreibt nichts", async () => {
        const leer = aufbau({ ok: true, quittung: quittung(8) });
        await leer.steuerung.starte("f1", ORT);
        await leer.steuerung.fertig();
        expect(leer.gesendet).toEqual([]);
        expect(leer.steuerung.laufend.value).toBeUndefined();
        expect(leer.steuerung.meldung.value).toBeUndefined();
        expect(leer.aus).toHaveBeenCalledOnce();

        const zurueckAmStart = aufbau({ ok: true, quittung: quittung(8) });
        await zurueckAmStart.steuerung.starte("f1", ORT);
        zurueckAmStart.los(zug);
        zurueckAmStart.los(zugAus(start, losgelassen({ x: start.von.x, y: start.von.y }, false)));
        await zurueckAmStart.steuerung.fertig();
        expect(zurueckAmStart.gesendet).toEqual([]);
        expect(zurueckAmStart.steuerung.laufend.value).toBeUndefined();
    });

    it("🔴 T12.4 EDIT-0003 G4 gilt der letzte Zug als gelöst (Strg), bleiben alle Enden liegen; ein späterer Zug ohne Strg nimmt sie mit", async () => {
        const gelost = aufbau({ ok: true, quittung: quittung(8) });
        await gelost.steuerung.starte("f1", ORT);
        gelost.los(zug);
        gelost.los(getrennt);
        await gelost.steuerung.fertig();
        expect(gelost.gesendet[0]!.pathEnds).toEqual([]);
        expect(gelost.steuerung.meldung.value).toMatchObject({ quittung: { liegen: 2, mitgezogen: 0 } });

        const mit = aufbau({ ok: true, quittung: quittung(8) });
        await mit.steuerung.starte("f1", ORT);
        mit.los(getrennt);
        mit.los(zug);
        await mit.steuerung.fertig();
        expect(mit.gesendet[0]!.pathEnds).toHaveLength(2);
    });

    it("🔴 T12.6 EDIT-0003 G4 Esc im Zug bricht nur den Zug ab; ohne Schritte beendet Esc den Modus, nichts wird gesendet", async () => {
        const t = aufbau({ ok: true, quittung: quittung(8) });
        await t.steuerung.starte("f1", ORT);
        t.zugLaeuft(true);
        expect(t.steuerung.abbrechen()).toBe(true);
        expect(t.abbrechen).toHaveBeenCalledOnce();
        expect(t.steuerung.laufend.value?.art).toBe("zieht");
        expect(t.aus).not.toHaveBeenCalled();

        t.zugLaeuft(false);
        expect(t.steuerung.abbrechen()).toBe(true);
        expect(t.aus).toHaveBeenCalledOnce();
        expect(t.gesendet).toEqual([]);
        expect(t.steuerung.laufend.value).toBeUndefined();
        expect(t.steuerung.abbrechen()).toBe(false);
        // Abgebrochen: Die Ansicht bleibt, wie sie ist.
        expect(t.karte.zentriere).not.toHaveBeenCalled();
    });

    it("🔴 EDIT-0003 G4 Esc mit Schritten fragt (R2): „Weiter bearbeiten“ bleibt, ein zweites Esc verwirft und endet, „Speichern“ schreibt", async () => {
        const t = aufbau({ ok: true, quittung: quittung(8) });
        await t.steuerung.starte("f1", ORT);
        t.los(zug);
        expect(t.steuerung.abbrechen()).toBe(true);
        expect(lage(t)).toMatchObject({ frage: true, ungespeichert: 1 });
        expect(t.steuerung.laufend.value?.art).toBe("zieht");
        await t.steuerung.antworte("weiter");
        expect(lage(t)).toMatchObject({ frage: false, ungespeichert: 1 });
        expect(t.aus).not.toHaveBeenCalled();

        t.steuerung.abbrechen();
        expect(lage(t)).toMatchObject({ frage: true });
        expect(t.steuerung.abbrechen()).toBe(true);
        expect(t.steuerung.laufend.value).toBeUndefined();
        expect(t.gesendet).toEqual([]);

        const speichern = aufbau({ ok: true, quittung: quittung(8) });
        await speichern.steuerung.starte("f1", ORT);
        speichern.los(zug);
        speichern.steuerung.abbrechen();
        await speichern.steuerung.antworte("speichern");
        expect(speichern.gesendet).toHaveLength(1);
        expect(speichern.steuerung.laufend.value).toBeUndefined();

        const verwerfen = aufbau({ ok: true, quittung: quittung(8) });
        await verwerfen.steuerung.starte("f1", ORT);
        verwerfen.los(zug);
        verwerfen.steuerung.abbrechen();
        await verwerfen.steuerung.antworte("verwerfen");
        expect(verwerfen.gesendet).toEqual([]);
        expect(verwerfen.steuerung.laufend.value).toBeUndefined();
    });

    it("🔴 EDIT-0003 G4 während des Schreibens packt niemand den Griff und Esc tut nichts; ein zweites „Fertig“ schreibt nicht noch einmal", async () => {
        const t = aufbau({ ok: true, quittung: quittung(8) });
        await t.steuerung.starte("f1", ORT);
        t.los(zug);
        const erstes = t.steuerung.fertig();
        expect(t.steuerung.laufend.value?.art).toBe("speichert");
        expect(t.sperre).toHaveBeenCalledWith(true);
        expect(t.steuerung.abbrechen()).toBe(false);
        void t.steuerung.fertig();
        await erstes;
        expect(t.gesendet).toHaveLength(1);
    });

    it("🔴 EDIT-0003 G4 Schließen des Fensters beendet den Modus nur über `beende`; Enter schreibt, Strg+Z und Strg+Y gehen zurück und vor, nie im Textfeld", async () => {
        const hoerer: ((event: KeyboardEvent) => void)[] = [];
        vi.stubGlobal("document", {
            addEventListener: (_art: string, f: (event: KeyboardEvent) => void) => hoerer.push(f),
            removeEventListener: (_art: string, f: (event: KeyboardEvent) => void) => {
                hoerer.splice(hoerer.indexOf(f), 1);
            },
        });
        try {
            const t = aufbau({ ok: true, quittung: quittung(8) });
            await t.steuerung.starte("f1", ORT);
            expect(hoerer).toHaveLength(1);
            const druecke = (
                key: string,
                ueber: Partial<Omit<KeyboardEvent, "target">> & { target?: unknown } = {},
            ): { verhindert: boolean } => {
                const ergebnis = { verhindert: false };
                hoerer[0]!({
                    key,
                    ctrlKey: false,
                    metaKey: false,
                    altKey: false,
                    shiftKey: false,
                    target: null,
                    preventDefault: () => (ergebnis.verhindert = true),
                    ...ueber,
                } as unknown as KeyboardEvent);
                return ergebnis;
            };
            t.los(zug);
            t.los(zug2);
            expect(druecke("z", { ctrlKey: true }).verhindert).toBe(true);
            expect(lage(t)).toMatchObject({ ungespeichert: 1 });
            expect(druecke("y", { ctrlKey: true }).verhindert).toBe(true);
            expect(lage(t)).toMatchObject({ ungespeichert: 2 });
            // Im Textfeld und auf einem Knopf gehört die Taste dem Feld beziehungsweise dem Knopf.
            const feld = { closest: (wahl: string) => (wahl.includes("input") ? {} : null) };
            expect(druecke("z", { ctrlKey: true, target: feld }).verhindert).toBe(false);
            expect(druecke("Enter", { target: feld }).verhindert).toBe(false);
            const knopf = {
                closest: (wahl: string) => (wahl.includes("button") && !wahl.includes("input") ? {} : null),
            };
            expect(druecke("Enter", { target: knopf }).verhindert).toBe(false);
            expect(t.gesendet).toEqual([]);
            expect(druecke("Enter").verhindert).toBe(true);
            await vi.waitFor(() => expect(t.steuerung.laufend.value).toBeUndefined());
            expect(t.gesendet).toHaveLength(1);
            // Mit dem Modus sind die Tasten wieder frei.
            expect(hoerer).toHaveLength(0);
        } finally {
            vi.unstubAllGlobals();
        }

        const offen = aufbau({ ok: true, quittung: quittung(8) });
        await offen.steuerung.starte("f1", ORT);
        offen.los(zug);
        offen.steuerung.beende();
        expect(offen.steuerung.laufend.value).toBeUndefined();
        expect(offen.gesendet).toEqual([]);
        expect(offen.aus).toHaveBeenCalledOnce();
    });

    it("🔴 EDIT-0003 G4 ein neuer Start verwirft keinen Entwurf mit Schritten still", async () => {
        const t = aufbau({ ok: true, quittung: quittung(8) });
        await t.steuerung.starte("f1", ORT);
        t.los(zug);
        await t.steuerung.starte("f2", WEG_C);
        expect(t.steuerung.laufend.value).toMatchObject({ fenster: "f1", publicId: ORT, art: "zieht" });
        expect(t.aus).not.toHaveBeenCalled();
    });

    it("🔴 T12.9 Konflikt beim „Fertig“: Modus aus (der Ort steht wieder beim Server), die Meldung nennt Person und Revision; ein Weg-Konflikt sagt es", async () => {
        const konflikt = {
            ok: false as const,
            status: 409,
            fehler: {
                code: "edit_conflict",
                message: "Jemand hat das gerade geändert.",
                details: {
                    currentRevision: 8,
                    changedAt: "2026-10-11T09:00:00Z",
                    changedBy: { id: "p", displayName: "Thomas" },
                },
            },
        };
        const t = aufbau(konflikt, ort(8));
        await t.steuerung.starte("f1", ORT);
        t.los(zug);
        await t.steuerung.fertig();
        expect(t.steuerung.meldung.value).toMatchObject({ art: "konflikt", wer: "Thomas", revision: 8, weg: false });
        expect(t.steuerung.laufend.value).toBeUndefined();
        expect(t.aus).toHaveBeenCalledOnce();
        expect(t.geaendert).not.toHaveBeenCalled();

        // Ein Weg am Ort wurde geändert, der Ort selbst nicht: Er hat noch Revision 7.
        const weg = aufbau(konflikt, ort(7));
        await weg.steuerung.starte("f1", ORT);
        weg.los(zug);
        await weg.steuerung.fertig();
        expect(weg.steuerung.meldung.value).toMatchObject({ art: "konflikt", weg: true, revision: 7 });
    });

    it("EDIT-0003 G4 eine Ablehnung (423, 503) steht mit dem Satz des Servers da und lässt den Entwurf stehen: Der Modus bleibt, der Griff ist wieder frei", async () => {
        const t = aufbau({
            ok: false,
            status: 423,
            fehler: { code: "map_editing_off", message: "Bearbeiten ist bis zum Umstieg gesperrt." },
        });
        await t.steuerung.starte("f1", ORT);
        t.los(zug);
        await t.steuerung.fertig();
        expect(t.steuerung.meldung.value).toMatchObject({
            art: "abgelehnt",
            satz: "Bearbeiten ist bis zum Umstieg gesperrt.",
        });
        expect(t.steuerung.laufend.value?.art).toBe("zieht");
        expect(lage(t)).toMatchObject({ ungespeichert: 1 });
        expect(t.sperre).toHaveBeenLastCalledWith(false);
        expect(t.aus).not.toHaveBeenCalled();
    });
});

describe("Sperre", () => {
    /** Eine Attrappe der Sperre des Orts: Sie hält Zählung, und `verloren` löst den Zuhörer aus. */
    function sperreMit(nimmt: () => Awaited<ReturnType<OrtSperre["nimm"]>>) {
        const hoerer: ((id: string) => void)[] = [];
        const angebote: FreigabeAngebot[] = [];
        const sperre: OrtSperre = {
            nimm: vi.fn(() => Promise.resolve(nimmt())),
            gib: vi.fn(),
            beiVerlust: (f) => {
                hoerer.push(f);
                return () => undefined;
            },
            biete: (_id, angebot) => {
                angebote.push(angebot);
                return () => undefined;
            },
        };
        return { sperre, verloren: () => hoerer.forEach((f) => f(ORT)), angebote };
    }
    const GENOMMEN = { art: "genommen", sperre: { kind: "place", id: ORT } } as never;

    function mitSperre(antwort: Awaited<ReturnType<VerschiebeApi["verschiebe"]>>, sperre: OrtSperre) {
        const gesendet: PlaceMoveBody[] = [];
        let losgelassen: ((zug: Zug) => void) | undefined;
        const aus = vi.fn();
        const api: VerschiebeApi = {
            ort: () => Promise.resolve(ort(7)),
            ziele: () => Promise.resolve({ radius: 50, freeEnds: frei } satisfies EditorMoveTargets),
            verschiebe: (_id, body) => {
                gesendet.push(body);
                return Promise.resolve(antwort);
            },
        };
        const karte: VerschiebeKarte = {
            zeige: vi.fn(),
            ein: (_start, los) => {
                losgelassen = los;
                return { abbrechen: () => false, setze: vi.fn(), sperre: vi.fn(), aus };
            },
            geaendert: vi.fn(),
        };
        const steuerung = createOrtVerschieben({
            api,
            karte,
            ladefehler: "nicht geladen",
            neueKennung: () => "op-9",
            sperre: {
                ort: sperre,
                gesperrt: () => "gesperrt",
                fehler: "keine Verbindung",
                verloren: "Die Sperre ist verloren.",
            },
        });
        return { steuerung, gesendet, los: (zug: Zug) => losgelassen?.(zug), aus };
    }
    const zug = zugAus(start, losgelassen({ x: 430, y: 520 }, false));

    it("🔴 EDIT-0003 G4 geht die Sperre ohne Schritte verloren, endet der Modus mit der Meldung; mit Schritten bleibt der Entwurf, und „Fertig“ nimmt sie neu", async () => {
        const ohne = sperreMit(() => GENOMMEN);
        const a = mitSperre({ ok: true, quittung: quittung(8) }, ohne.sperre);
        await a.steuerung.starte("f1", ORT);
        ohne.verloren();
        expect(a.steuerung.laufend.value).toBeUndefined();
        expect(a.steuerung.meldung.value).toMatchObject({ art: "abgelehnt", satz: "Die Sperre ist verloren." });

        const mit = sperreMit(() => GENOMMEN);
        const b = mitSperre({ ok: true, quittung: quittung(8) }, mit.sperre);
        await b.steuerung.starte("f1", ORT);
        b.los(zug);
        mit.verloren();
        expect(b.steuerung.laufend.value?.art).toBe("zieht");
        expect(b.steuerung.meldung.value).toMatchObject({ art: "abgelehnt", satz: "Die Sperre ist verloren." });
        await b.steuerung.fertig();
        expect(mit.sperre.nimm).toHaveBeenCalledTimes(2);
        expect(b.gesendet).toHaveLength(1);
        expect(b.steuerung.laufend.value).toBeUndefined();
    });

    it("🔴 EDIT-0003 G4 hält beim „Fertig“ nach verlorener Sperre ein anderer den Ort, schreibt nichts: Der Entwurf bleibt, die Meldung nennt den Grund", async () => {
        let antwort: unknown = GENOMMEN;
        const mit = sperreMit(() => antwort as never);
        const t = mitSperre({ ok: true, quittung: quittung(8) }, mit.sperre);
        await t.steuerung.starte("f1", ORT);
        t.los(zug);
        mit.verloren();
        antwort = { art: "gesperrt", sperre: { kind: "place", id: ORT } };
        await t.steuerung.fertig();
        expect(t.gesendet).toEqual([]);
        expect(t.steuerung.laufend.value?.art).toBe("zieht");
        expect(t.steuerung.meldung.value).toMatchObject({ art: "abgelehnt", satz: "gesperrt" });
    });

    it("🔴 WI-0262 Bittet ein anderer um den Ort, schreibt der Entwurf wie „Fertig“; ohne Schritte endet der Modus einfach", async () => {
        const mit = sperreMit(() => GENOMMEN);
        const t = mitSperre({ ok: true, quittung: quittung(8) }, mit.sperre);
        await t.steuerung.starte("f1", ORT);
        t.los(zug);
        expect(await mit.angebote[0]!.speichere()).toEqual({ ok: true });
        expect(t.gesendet).toHaveLength(1);
        expect(t.steuerung.laufend.value).toBeUndefined();

        const leer = sperreMit(() => GENOMMEN);
        const u = mitSperre({ ok: true, quittung: quittung(8) }, leer.sperre);
        await u.steuerung.starte("f1", ORT);
        expect(await leer.angebote[0]!.speichere()).toEqual({ ok: true });
        expect(u.gesendet).toEqual([]);
        expect(u.steuerung.laufend.value).toBeUndefined();
    });

    it("WI-0262 scheitert das Schreiben, bleibt alles, wie es war, und der Satz geht als Grund zurück", async () => {
        const mit = sperreMit(() => GENOMMEN);
        const t = mitSperre(
            { ok: false, status: 503, fehler: { code: "map_import_running", message: "Ein Import läuft." } },
            mit.sperre,
        );
        await t.steuerung.starte("f1", ORT);
        t.los(zug);
        expect(await mit.angebote[0]!.speichere()).toEqual({ ok: false, grund: "Ein Import läuft." });
        expect(t.steuerung.laufend.value?.art).toBe("zieht");
    });
});
