import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildMountainRaster, kammPunktHoehen, rueckennetzRegler, GEBIRGS_PRESETS_VORGABE } from "@avesmaps3d/shared";
import type { GebirgsNetzStand, V12Input } from "@avesmaps3d/shared";
import type { GebirgsEntwurf } from "../src/landschaftseditor/gebirge-stand";
import { vorschauPixel } from "../src/landschaftseditor/gebirge-vorschau-bild";
import {
    FEIN_OHNE_GROB_MS,
    festeSkala,
    festerTalboden,
    netzOhnePunktHoehen,
    nurPunkthoeheGeaendert,
    skalaSchluessel,
    talbodenArtSchluessel,
    talbodenSchluessel,
} from "../src/landschaftseditor/gebirge-vorschau-schluessel";

/**
 * Die Vorschau des Gebirges bei einer geänderten Punkthöhe (WI-0249 P9; Betreiber 2026-10-25, Stage: „kammhöhen, lassen sich nicht in der
 * höhe verschieben. das gebirge drumrum senkt sich ab“). Problemfälle: Mit dem Netz samt Punkthöhen im Schlüssel des Talboden-Speichers fand
 * die grobe Vorschau nach jedem Ziehen keinen gemerkten Talboden mehr und rechnete mit dem des Typs (Blutzinnen: 0,2 statt 0,85, das Gelände
 * fern vom Punkt im Mittel 527 Schritt tiefer); das Ende der Höhenskala wanderte mit dem höchsten Punkt, und eine Zelle mit unveränderter
 * Höhe wurde dunkler (Blauanteil 142 → 102) und flacher geschummert (Überhöhung 1,73 → 1,18).
 */

const netz = (h: number | null, hoehen?: (number | null)[]): GebirgsNetzStand => ({
    kaemme: [
        {
            punkte: [
                [500, 510],
                [505, 511],
                [510, 512],
            ],
            rang: "haupt",
            ...(hoehen === undefined ? {} : { hoehen }),
        },
        {
            punkte: [
                [510, 512],
                [505, 505],
            ],
            rang: "tal",
        },
    ],
    nebengipfel: [{ x: 505, y: 505, h }],
    mulden: [{ x: 520, y: 520, h }],
});
const entwurf = (n: GebirgsNetzStand | undefined, mehr: Partial<GebirgsEntwurf> = {}): GebirgsEntwurf => ({
    typ: "kettengebirge",
    werte: {},
    muster: null,
    kammhoehe: 2300,
    modell: {},
    ...(n === undefined ? {} : { netz: n }),
    revision: 3,
    ...mehr,
});
const eingabe = { peaks: [{ x: 1, y: 2, h: 2300 }], saat: 4711 };

describe("Schlüssel der Vorschau: Punkthöhen zählen nicht, alles andere schon", () => {
    it("🔴 eine andere Höhe an Kammpunkt, Nebengipfel oder Mulde ändert keinen der beiden Schlüssel", () => {
        const a = entwurf(netz(null));
        const b = entwurf(netz(2800, [2300, 3400, null]));
        expect(talbodenSchluessel(b)).toBe(talbodenSchluessel(a));
        expect(skalaSchluessel(b, eingabe, 2300)).toBe(skalaSchluessel(a, eingabe, 2300));
        // Das Netz ohne Höhen trägt weder die Liste der Linie noch ein `h`.
        expect(netzOhnePunktHoehen(netz(2800, [2300, 3400, null])).kaemme[0]).not.toHaveProperty("hoehen");
        expect(netzOhnePunktHoehen(netz(2800)).nebengipfel[0]!.h).toBeNull();
    });

    it("🔴 Lage, Anzahl und Rang der Punkte, Typ, Gratwerte und ein fehlendes Netz ändern den Talboden-Schlüssel", () => {
        const basis = talbodenSchluessel(entwurf(netz(null)));
        const verschoben = netz(null);
        verschoben.kaemme[0]!.punkte[1] = [505, 512];
        expect(talbodenSchluessel(entwurf(verschoben))).not.toBe(basis);
        const mehr = netz(null);
        mehr.nebengipfel.push({ x: 506, y: 506, h: null });
        expect(talbodenSchluessel(entwurf(mehr))).not.toBe(basis);
        const rang = netz(null);
        rang.kaemme[0]!.rang = "neben";
        expect(talbodenSchluessel(entwurf(rang))).not.toBe(basis);
        expect(talbodenSchluessel(entwurf(netz(null), { typ: "plateau" as never }))).not.toBe(basis);
        expect(talbodenSchluessel(entwurf(netz(null), { modell: { grat: 0.3 } }))).not.toBe(basis);
        expect(talbodenSchluessel(entwurf(undefined))).not.toBe(basis);
    });

    it("🔴 die Skala bleibt nur bei gleichem Gebirge stehen: Kammhöhe, Werte, Saat, Gipfel und Grundhöhe ändern ihren Schlüssel", () => {
        const basis = skalaSchluessel(entwurf(netz(null)), eingabe, 2300);
        expect(skalaSchluessel(entwurf(netz(null), { kammhoehe: 3000 }), eingabe, 2300)).not.toBe(basis);
        expect(skalaSchluessel(entwurf(netz(null), { werte: { rauschen: 0.7 } }), eingabe, 2300)).not.toBe(basis);
        expect(skalaSchluessel(entwurf(netz(null)), { ...eingabe, saat: 1 }, 2300)).not.toBe(basis);
        expect(skalaSchluessel(entwurf(netz(null)), { ...eingabe, peaks: [{ x: 1, y: 2, h: 2900 }] }, 2300)).not.toBe(
            basis,
        );
        expect(skalaSchluessel(entwurf(netz(null)), eingabe, 2900)).not.toBe(basis);
        const verschoben = netz(null);
        verschoben.kaemme[0]!.punkte[0] = [499, 510];
        expect(skalaSchluessel(entwurf(verschoben), eingabe, 2300)).not.toBe(basis);
    });

    it("das gemerkte Ende der Skala gilt nur unter seinem Schlüssel", () => {
        const gemerkt = { schluessel: "a", hoechste: 2317 };
        expect(festeSkala(gemerkt, "a")).toBe(2317);
        expect(festeSkala(gemerkt, "b")).toBeUndefined();
        expect(festeSkala(undefined, "a")).toBeUndefined();
    });

    it("🔴 nach einer Änderung nur der Punkthöhen rechnet die Vorschau gleich fein (Talboden bekannt, Rechnung rasch), sonst wie zuvor grob und fein", () => {
        const gemerkt = { schluessel: "a", hoechste: 2317, talboden: 0.85, ms: 1900 };
        expect(nurPunkthoeheGeaendert(gemerkt, "a")).toBe(true);
        expect(festerTalboden(gemerkt, "a")).toBe(0.85);
        // Anderer Schlüssel (Netz, Typ, Kammhöhe …): wie zuvor.
        expect(nurPunkthoeheGeaendert(gemerkt, "b")).toBe(false);
        expect(festerTalboden(gemerkt, "b")).toBeUndefined();
        // Ohne bekannten Talboden (V12) oder nach einer langen Rechnung bleibt das grobe Zwischenbild.
        expect(nurPunkthoeheGeaendert({ schluessel: "a", hoechste: 2317 }, "a")).toBe(false);
        expect(nurPunkthoeheGeaendert({ ...gemerkt, ms: FEIN_OHNE_GROB_MS + 1 }, "a")).toBe(false);
        expect(nurPunkthoeheGeaendert(undefined, "a")).toBe(false);
    });

    it("🔴 der Talboden der letzten feinen Rechnung gilt für das geänderte Netz derselben Art; Teilfläche, Typ und Gratwerte trennen", () => {
        const art = talbodenArtSchluessel("f1", entwurf(netz(null)));
        const verschoben = netz(null);
        verschoben.kaemme[0]!.punkte[1] = [505, 512];
        verschoben.nebengipfel.push({ x: 506, y: 506, h: null });
        expect(talbodenArtSchluessel("f1", entwurf(verschoben))).toBe(art);
        expect(talbodenArtSchluessel("f2", entwurf(netz(null)))).not.toBe(art);
        expect(talbodenArtSchluessel("f1", entwurf(netz(null), { typ: "plateau" as never }))).not.toBe(art);
        expect(talbodenArtSchluessel("f1", entwurf(netz(null), { modell: { gratBreite: 0.9 } }))).not.toBe(art);
    });
});

describe("Höhenskala der Vorschau an Blutzinnen: ein höherer Punkt dunkelt das übrige Gebirge nicht ab", () => {
    // Echte Kämme (Fixture des Rückennetzes): der Hauptkamm mit einem Punkt genau auf dem Nebengipfel 3 (so rastet der Editor ein), der
    // Punkt und der Nebengipfel um 1.200 Schritt gehoben (der Editor setzt jeden deckungsgleichen Punkt).
    const fall = JSON.parse(
        readFileSync(new URL("../../server/test/fixtures/rueckennetz/blutzinnen.json", import.meta.url), "utf8"),
    ) as { input: V12Input; kaemmeLang: { punkte: [number, number][]; rang: "haupt" | "neben" }[] };
    const neben = fall.input.nebengipfel![3]!;
    const regler = rueckennetzRegler(GEBIRGS_PRESETS_VORGABE, "kettengebirge", {});
    const raster = (zus: number) => {
        const kaemme = fall.kaemmeLang.map((k) => ({ ...k, punkte: k.punkte.map((p) => [...p] as [number, number]) }));
        const abstand = (s: number): number =>
            Math.hypot(kaemme[0]!.punkte[s]![0] - neben.x, kaemme[0]!.punkte[s]![1] - neben.y);
        let nah = 0;
        kaemme[0]!.punkte.forEach((_, s) => {
            if (abstand(s) < abstand(nah)) nah = s;
        });
        kaemme[0]!.punkte[nah] = [neben.x, neben.y];
        const vorgabe = kammPunktHoehen(
            kaemme,
            [...fall.input.peaks, ...fall.input.nebengipfel!].map((p) => ({
                x: p.x,
                y: p.y,
                h: Number(p.h) > 0 ? Number(p.h) : 2300,
            })),
            2300,
            0.92,
        )[0]!;
        const hoehen = kaemme[0]!.punkte.map(
            (_, s) => Math.round(s === nah ? Number(neben.h) : vorgabe[s]!) + (s === nah ? zus : 0),
        );
        const r = buildMountainRaster({
            ...fall.input,
            zelle: 0.5,
            kaemme: kaemme.map((k, i) => (i === 0 ? { ...k, hoehen } : k)),
            nebengipfel: fall.input.nebengipfel!.map((n, i) => (i === 3 ? { ...n, h: Number(n.h) + zus } : n)),
            rueckennetz: regler,
        });
        return {
            w: r.w,
            hh: r.hh,
            cell: r.cell,
            bounds: r.bounds,
            eigen: r.eigen,
            h: Float32Array.from(r.h),
            ms: 0,
            nah: kaemme[0]!.punkte[nah]!,
        };
    };

    it("🔴 mit festem Ende der Skala bleibt die Farbe einer unveränderten Zelle stehen, ohne wandert sie", () => {
        const vorher = raster(0);
        const nachher = raster(1200);
        const [px, py] = vorher.nah;
        // Eine Zelle fern vom Punkt, deren Höhe sich nicht (über das Rauschen der Erosion hinaus) ändert.
        let ref = -1;
        for (let k = 0; k < vorher.h.length && ref < 0; k++) {
            if (!vorher.eigen[k]) continue;
            const i = k % vorher.w;
            const j = (k - i) / vorher.w;
            const d = Math.hypot(
                vorher.bounds.min_x + i * vorher.cell - px,
                vorher.bounds.min_y + j * vorher.cell - py,
            );
            if (d > 15 && vorher.h[k]! > 1700 && vorher.h[k]! < 2100 && Math.abs(nachher.h[k]! - vorher.h[k]!) < 12)
                ref = k;
        }
        expect(ref).toBeGreaterThanOrEqual(0);
        const farbe = (p: ReturnType<typeof vorschauPixel>) => {
            const i = ref % vorher.w;
            const j = (ref - i) / vorher.w;
            const o = ((vorher.hh - 1 - j) * vorher.w + i) * 4;
            return [p.rgba[o]!, p.rgba[o + 1]!, p.rgba[o + 2]!];
        };
        const alt = vorschauPixel(vorher);
        // Ohne festes Ende: Das Ende der Skala folgt dem höchsten Punkt, die Zelle wird sichtbar dunkler.
        const wandert = vorschauPixel(nachher);
        expect(wandert.hoechste).toBeGreaterThan(alt.hoechste + 500);
        expect(Math.abs(farbe(wandert)[2]! - farbe(alt)[2]!)).toBeGreaterThan(25);
        // Mit dem gemerkten Ende der feinen Rechnung davor bleibt Farbe und Überhöhung der Schummerung, wo die Höhe bleibt.
        const fest = vorschauPixel(nachher, festeSkala({ schluessel: "x", hoechste: alt.hoechste }, "x"));
        expect(fest.hoechste).toBe(alt.hoechste);
        expect(fest.ueberhoehung).toBe(alt.ueberhoehung);
        for (let c = 0; c < 3; c++) expect(Math.abs(farbe(fest)[c]! - farbe(alt)[c]!)).toBeLessThanOrEqual(6);
    }, 120_000);
});
