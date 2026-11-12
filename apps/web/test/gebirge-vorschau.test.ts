import { describe, expect, it } from "vitest";
import { GEBIRGS_PRESETS_VORGABE, typVorschlag, type GebirgsPresetGruppe } from "@avesmaps3d/shared";
import type { VorschauAuftrag, VorschauErgebnis } from "../src/gebirge-vorschau/auftrag";
import { rechneVorschau } from "../src/gebirge-vorschau/rechnen";
import { vorschauWarteschlange } from "../src/gebirge-vorschau/warteschlange";

// Ein kleines Gebirge ohne Gipfel und Wasser: ein Quadrat von 20 × 20 Karteneinheiten mit einer Kammlinie quer hindurch.
const eingabe: VorschauAuftrag["eingabe"] = {
    bounds: { min_x: 100, min_y: 200, max_x: 120, max_y: 220 },
    geometry: {
        type: "Polygon",
        coordinates: [
            [
                [100, 200],
                [120, 200],
                [120, 220],
                [100, 220],
                [100, 200],
            ],
        ],
    },
    peaks: [],
    kurve: [
        [102, 210],
        [118, 210],
    ],
    fluesse: [],
    seen: [],
    saat: 4711,
};
const auftrag = (preset: VorschauAuftrag["preset"], kante = 48): VorschauAuftrag => ({
    eingabe,
    preset,
    stand: { werte: {}, muster: null, kammhoehe: 2000 },
    grundhoehe: 1000,
    kante,
});

describe("Gebirge-Vorschau: Rechnung (WI-0226)", () => {
    it("rechnet die Grundform grob: Zellweite aus der Kante, Höhen in der Fläche, maßstäblich", () => {
        const e = rechneVorschau(auftrag(GEBIRGS_PRESETS_VORGABE.typen.kammgebirge));
        expect(e.cell).toBeCloseTo(20 / 48, 9);
        expect(e.w * e.hh).toBe(e.h.length);
        let drin = 0;
        let hoechste = 0;
        for (let k = 0; k < e.h.length; k++) {
            if (!e.eigen[k]) continue;
            drin++;
            hoechste = Math.max(hoechste, e.h[k] as number);
        }
        expect(drin).toBeGreaterThan(0.8 * e.h.length);
        expect(hoechste).toBeGreaterThan(500);
        expect(hoechste).toBeLessThanOrEqual(2000 * 1.5);
    });

    it("nie feiner als 0,25 E, auch bei vielen Zellen je Kante", () => {
        expect(rechneVorschau(auftrag(null, 1000)).cell).toBe(0.25);
    });

    it("Bergland (Zellen) sieht anders aus als Kammgebirge (Rauschen)", () => {
        const kamm = rechneVorschau(auftrag(GEBIRGS_PRESETS_VORGABE.typen.kammgebirge));
        const berg = rechneVorschau(auftrag(GEBIRGS_PRESETS_VORGABE.typen.bergland));
        let unterschied = 0;
        for (let k = 0; k < kamm.h.length; k++) unterschied += Math.abs((kamm.h[k] as number) - (berg.h[k] as number));
        expect(unterschied / kamm.h.length).toBeGreaterThan(10);
    });
});

// Ein Ersatz für den Worker: merkt sich die Aufträge, antwortet erst auf Zuruf.
function ersatzWorker() {
    const auftraege: { nr: number; auftrag: VorschauAuftrag }[] = [];
    const worker = {
        onmessage: null as ((ereignis: MessageEvent) => void) | null,
        postMessage: (nachricht: { nr: number; auftrag: VorschauAuftrag }) => void auftraege.push(nachricht),
        terminate: () => {},
    };
    const antworte = (ergebnis: Partial<VorschauErgebnis>) => {
        const letzter = auftraege[auftraege.length - 1]!;
        worker.onmessage?.({ data: { nr: letzter.nr, ergebnis } } as MessageEvent);
    };
    return { worker: worker as unknown as Worker, auftraege, antworte };
}

describe("Gebirge-Vorschau: Rückennetz (WI-0245 D4)", () => {
    const mitKamm = (talbodenFest?: number, ableiten = false): VorschauAuftrag => ({
        ...auftrag(GEBIRGS_PRESETS_VORGABE.typen.kammgebirge),
        rueckennetz: {
            kaemme: [
                {
                    punkte: [
                        [103, 205],
                        [110, 212],
                        [117, 208],
                    ],
                    rang: "haupt",
                },
            ],
            nebengipfel: [{ x: 108, y: 216, h: null }],
            typ: "kammgebirge",
            gruppe: GEBIRGS_PRESETS_VORGABE,
            modell: {},
            talbodenFest,
            ableiten,
        },
    });

    it("eine reine Mulde rechnet das Rückennetz und ihre Bodenhöhe erreicht den Worker", () => {
        const basis = mitKamm(0.4);
        const r = basis.rueckennetz!;
        const mulde = rechneVorschau({
            ...basis,
            kante: 80,
            rueckennetz: { ...r, kaemme: [], nebengipfel: [], mulden: [{ x: 110, y: 210, h: 0 }] },
        });
        const hoch = rechneVorschau({
            ...basis,
            kante: 80,
            rueckennetz: { ...r, kaemme: [], nebengipfel: [], mulden: [{ x: 110, y: 210, h: 700 }] },
        });
        expect(mulde.talboden).toBe(0.4);
        const i =
            Math.round((210 - mulde.bounds.min_y) / mulde.cell) * mulde.w +
            Math.round((110 - mulde.bounds.min_x) / mulde.cell);
        expect(mulde.h[i]).toBe(0);
        expect(hoch.h[i]).toBeCloseTo(700, 0);
    });

    it("🔴 mit gezeichneten Kämmen rechnet die Vorschau das Rückennetz: anderes Bild als die V12, mit wirksamem Talboden", () => {
        const v12 = rechneVorschau(auftrag(GEBIRGS_PRESETS_VORGABE.typen.kammgebirge));
        const netz = rechneVorschau(mitKamm());
        expect(netz.talboden).toBeTypeOf("number");
        expect(v12.talboden).toBeUndefined();
        expect([...netz.h]).not.toEqual([...v12.h]);
    });

    it("🔴 ein fester Talboden (eigener oder gemerkter) gilt; ohne Kämme bleibt es die V12", () => {
        expect(rechneVorschau(mitKamm(0.42)).talboden).toBeCloseTo(0.42, 9);
        const ohne = { ...mitKamm(), rueckennetz: { ...mitKamm().rueckennetz!, kaemme: [] } };
        expect([...rechneVorschau(ohne).h]).toEqual([
            ...rechneVorschau(auftrag(GEBIRGS_PRESETS_VORGABE.typen.kammgebirge)).h,
        ]);
    });

    it("🔴 mit Köpfen des Typs (WI-0249 P2) rechnet die Vorschau auch nur mit Nebengipfeln das Rückennetz, ohne sie die V12", () => {
        const vorschlag = typVorschlag("kammgebirge");
        const kammgebirge = {
            ...GEBIRGS_PRESETS_VORGABE.typen.kammgebirge,
            rueckennetz: { ...vorschlag, form: { ...vorschlag.form, kopf: 0.06 } },
        };
        const mitKoepfen: GebirgsPresetGruppe = {
            ...GEBIRGS_PRESETS_VORGABE,
            typen: { ...GEBIRGS_PRESETS_VORGABE.typen, kammgebirge },
        };
        const nurPunkte = (gruppe: GebirgsPresetGruppe): VorschauAuftrag => ({
            ...mitKamm(0.4),
            rueckennetz: { ...mitKamm(0.4).rueckennetz!, kaemme: [], gruppe },
        });
        const v12 = rechneVorschau(auftrag(GEBIRGS_PRESETS_VORGABE.typen.kammgebirge));
        expect([...rechneVorschau(nurPunkte(GEBIRGS_PRESETS_VORGABE)).h]).toEqual([...v12.h]);
        const netz = rechneVorschau(nurPunkte(mitKoepfen));
        expect(netz.talboden).toBeCloseTo(0.4, 9);
        expect([...netz.h]).not.toEqual([...v12.h]);
    });

    it("🔴 Ausschnitt fein: nur der Rahmen (samt Rand), die Zellweite aus dem Rahmen, nicht aus dem ganzen Gebirge", () => {
        const rahmen = { min_x: 104, min_y: 204, max_x: 112, max_y: 212 };
        const ganz = rechneVorschau(mitKamm(0.4));
        const teil = rechneVorschau({ ...mitKamm(0.4), kante: 16, ausschnitt: rahmen });
        expect(teil.cell).toBeCloseTo(8 / 16, 9);
        expect(teil.cell).toBeGreaterThan(ganz.cell);
        // Der Rand des Moduls (4 E) bleibt in der Fläche: Der Ausschnitt liegt im Rahmen des Gebirges, aber nicht über ihm.
        expect(teil.bounds.min_x).toBeGreaterThanOrEqual(100);
        expect(teil.bounds.max_x).toBeLessThanOrEqual(120);
        expect(teil.bounds.max_x - teil.bounds.min_x).toBeLessThan(20);
    });
});

describe("Gebirge-Vorschau: Warteschlange (WI-0226)", () => {
    it("eine Rechnung zur Zeit; ein neuer Auftrag ersetzt den wartenden, der ersetzte endet mit null", async () => {
        const ersatz = ersatzWorker();
        let gestartet = 0;
        const vorschau = vorschauWarteschlange(() => (gestartet++, ersatz.worker));
        const erster = vorschau.rechne(auftrag(null, 10));
        const zweiter = vorschau.rechne(auftrag(null, 20));
        const dritter = vorschau.rechne(auftrag(null, 30));
        expect(gestartet).toBe(1);
        expect(ersatz.auftraege.map((a) => a.auftrag.kante)).toEqual([10]);
        ersatz.antworte({ ms: 1 });
        expect(await erster).toEqual({ ms: 1 });
        expect(await zweiter).toBeNull();
        expect(ersatz.auftraege.map((a) => a.auftrag.kante)).toEqual([10, 30]);
        ersatz.antworte({ ms: 3 });
        expect(await dritter).toEqual({ ms: 3 });
    });

    it("🔴 mit Vorrang wartet ein Auftrag nicht: der laufende endet mit null, ein neuer Worker rechnet sofort (WI-0249 Leistung)", async () => {
        const ersatz = ersatzWorker();
        let gestartet = 0;
        let beendet = 0;
        const worker = ersatz.worker as unknown as { terminate: () => void };
        worker.terminate = () => void beendet++;
        const vorschau = vorschauWarteschlange(() => (gestartet++, ersatz.worker));
        const langer = vorschau.rechne(auftrag(null, 10));
        const wartender = vorschau.rechne(auftrag(null, 20));
        const neuer = vorschau.rechne(auftrag(null, 30), { vorrang: true });
        expect(await langer).toBeNull();
        expect(await wartender).toBeNull();
        expect(beendet).toBe(1);
        expect(gestartet).toBe(2);
        expect(ersatz.auftraege.map((a) => a.auftrag.kante)).toEqual([10, 30]);
        ersatz.antworte({ ms: 3 });
        expect(await neuer).toEqual({ ms: 3 });
        // Ohne laufenden Auftrag ist Vorrang dasselbe wie ohne.
        const danach = vorschau.rechne(auftrag(null, 40), { vorrang: true });
        expect(beendet).toBe(1);
        ersatz.antworte({ ms: 4 });
        expect(await danach).toEqual({ ms: 4 });
    });

    it("beenden: offene Aufträge enden mit null", async () => {
        const ersatz = ersatzWorker();
        const vorschau = vorschauWarteschlange(() => ersatz.worker);
        const offen = vorschau.rechne(auftrag(null));
        vorschau.beenden();
        expect(await offen).toBeNull();
    });
});
