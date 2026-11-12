import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { Value } from "@sinclair/typebox/value";
import { describe, expect, it } from "vitest";
import {
    buildMountainRaster,
    durchhangAnteil,
    durchhangProfil,
    durchhangTiefen,
    kopfRadius,
    rasterSamples,
    rechneRueckennetz,
    rechnetRueckennetz,
    rueckennetzRegler,
    rueckennetzVorgabe,
    typVorschlag,
    GEBIRGS_PRESETS_VORGABE,
    GEBIRGSTYPEN,
    GebirgsPresetGruppeSchema,
    KAMM_FANG_E,
    nebengipfelVorgabe,
    type Kamm,
    type Pass,
    type RueckenErgebnis,
    type V12Input,
} from "@avesmaps3d/shared";
import { AVENTURIA_TERRAIN_RECIPES } from "../src/terrain/domain/recipes.ts";
import { rueckennetzGitter } from "../src/terrain/inputs.ts";
import { findeKopf, flussAnstieg, flussZellen, zelleAn } from "./support/gebirge-form.ts";
import { random } from "./support/invariants.ts";

/**
 * Das Rückennetz-Modell (WI-0246) an fünf Gebirgen aus dem Entwurf: die Tore des Entwurfs (`tor.ts` im Notizordner der Topographie)
 * als Fälle. Die Prüfsummen hat das Entwurfsmodul gerechnet, aus dem das Paket übertragen ist (2026-10-20, 14 von 14 Fällen gleich).
 * Kämme und Nebengipfel sind Beispiele der Topographie, nicht die des Betreibers.
 *
 * 🪤 Seit dem 21.10. (Gipfel als weiche Höhenconstraints in der Grundform, Flanken erodieren mit; Commits 333e2ac7c bis 7c9d2c986) ist die
 * Rechnung nicht mehr die des Entwurfsmoduls: Die Prüfsummen unten sind Stände DIESER Rechnung (neu gesetzt 2026-10-23, WI-0249 P0; auf
 * `origin/master` 0c4c85c70 waren fünf der vierzehn Fälle rot, nicht durch P0). Wer die Rechnung ändert, setzt sie bewusst neu und zählt
 * `RUECKENNETZ_QUELLE` hoch.
 */

interface Fall {
    name: string;
    input: V12Input;
    kaemmeLang?: Kamm[];
    paesse?: Pass[];
}
const fall = (name: string): Fall =>
    JSON.parse(readFileSync(new URL(`./fixtures/rueckennetz/${name}.json`, import.meta.url), "utf8")) as Fall;
const blutzinnen = fall("blutzinnen");
const trollzacken = fall("trollzacken");
const grimmfrost = fall("grimmfrostoede-massiv");
const nordwalser = fall("nordwalser-hoehen");
const schwert = fall("ehernes-schwert");

const sha = (h: Float64Array) =>
    createHash("sha1")
        .update(Buffer.from(h.buffer, h.byteOffset, h.byteLength))
        .digest("hex")
        .slice(0, 12);
/** Vergleicht die gespeicherten Schritt-Höhen: Float64-Rundung unterscheidet sich je Node-/Betriebssystem. */
const entwurfsSha = (ergebnis: RueckenErgebnis): string =>
    createHash("sha1")
        .update(rasterSamples({ ...ergebnis, leer: false }))
        .digest("hex")
        .slice(0, 12);
const ohneNetz = (input: V12Input): V12Input => {
    const rest = { ...input };
    delete rest.kaemme;
    delete rest.nebengipfel;
    return rest;
};
const kammhoehe = (input: V12Input) => Number(input.regler.maximalhoehe) || 1500;

interface ToreOptionen {
    paesse?: readonly Pass[];
    /** So viele gesetzte Nebengipfel dürfen ohne eigenen Kopf bleiben (bekannte Grenze, `NEBEN_KOPFLOS_BLUTZINNEN`); sonst keiner. */
    nebenKopflos?: number;
    /**
     * So viele gesetzte Nebengipfel dürfen als Einsenkung enden (bekannte Grenze, Paket P2): Steht einer niedriger als der ganze Kamm um
     * ihn, bleibt seine feste Zelle unter allen Nachbarn, statt eine Erhebung zu tragen. Sonst keiner.
     */
    nebenEinsenkung?: number;
    /** Ein kanonischer Gipfel trägt einen Kopf (Vorgabe ja); neben einem höheren Nebengipfel darf er zur Schulter werden. */
    gipfelKopf?: boolean;
}

/**
 * Die Tore des Entwurfs, die für jede Rechnung gelten (ohne Grat und HI-Band). Die Form der Gipfel prüft das Ergebnisraster (WI-0249
 * P0, `support/gebirge-form.ts`): kanonische Gipfel stehen EXAKT auf ihrer Höhe und tragen einen Kopf (Gipfelzelle mit messbarer
 * Prominenz im Umkreis von zwei Zellen); jeder gesetzte Nebengipfel steht auf seiner Höhe und trägt ebenfalls einen Kopf, außer den
 * bekannten Fällen (`nebenKopflos`). Die Erosion rundet seit dem 21.10. die Spitzen, die alte strenge Form („lokales Maximum im Umkreis
 * von 1 E“) gilt nicht mehr. Nebengipfel auf einem Flusslauf fehlen in der Prüfung: Der Fluss geht vor (Flüsse fließen talwärts), und
 * eine Zelle, die ein kanonischer Gipfel oder ein späterer Nebengipfel belegt, gehört diesem.
 */
function tore(input: V12Input, e: RueckenErgebnis, optionen: ToreOptionen = {}): string[] {
    const { paesse = [], nebenKopflos = 0, nebenEinsenkung = 0, gipfelKopf = true } = optionen;
    const befunde: string[] = [];
    const lage = (x: number, y: number) => zelleAn(e, x, y);
    const gipfelZellen = new Set<number>();
    for (const p of input.peaks) {
        const k = lage(p.x, p.y);
        if (k < 0) continue;
        gipfelZellen.add(k);
        const ziel = Number(p.h) > 0 ? Number(p.h) : kammhoehe(input);
        if (e.h[k] !== ziel) befunde.push(`Gipfel ${ziel} steht auf ${String(e.h[k])}`);
        if (gipfelKopf && !findeKopf(e, k)) befunde.push(`Gipfel ${ziel} ohne Kopf`);
    }
    const laufZellen = flussZellen(e, input.fluesse);
    const letzteAnZelle = new Map<number, number>();
    e.nebengipfel.forEach((n, i) => letzteAnZelle.set(lage(n.x, n.y), i));
    const ohneKopf: string[] = [];
    e.nebengipfel.forEach((n, i) => {
        const k = lage(n.x, n.y);
        if (k < 0 || laufZellen.has(k) || gipfelZellen.has(k) || letzteAnZelle.get(k) !== i) return;
        const hier = e.h[k] as number;
        if (Math.abs(hier - n.h) > 1) befunde.push(`Nebengipfel ${n.h} steht auf ${hier.toFixed(0)}`);
        if (!findeKopf(e, k)) ohneKopf.push(`${n.h} bei ${n.x.toFixed(1)}/${n.y.toFixed(1)}`);
    });
    if (ohneKopf.length > nebenKopflos)
        befunde.push(`${ohneKopf.length} Nebengipfel ohne Kopf (erlaubt ${nebenKopflos}): ${ohneKopf.join(", ")}`);
    for (let k = 0; k < e.h.length; k++) {
        const v = e.h[k] as number;
        if (!Number.isFinite(v) || v < 0) befunde.push("NaN oder unter 0");
        if (!e.eigen[k] && v !== 0) befunde.push("außerhalb nicht 0");
    }
    // Keine undokumentierten inneren Senken (eine Zelle ohne tieferen Nachbarn, nicht am Rand, kein See, keine Talachse). Die Zelle eines
    // gesetzten Nebengipfels, die unter allen Nachbarn liegt, ist eine Einsenkung statt einer Erhebung und zählt für sich.
    const nebenZellen = new Set(e.nebengipfel.map((n) => lage(n.x, n.y)));
    const einsenkungen: string[] = [];
    let senken = 0;
    for (let j = 1; j < e.hh - 1; j++)
        for (let i = 1; i < e.w - 1; i++) {
            const k = j * e.w + i;
            if (!e.eigen[k] || e.senke[k]) continue;
            let innen = true;
            let tiefer = false;
            for (let dj = -1; dj <= 1; dj++)
                for (let di = -1; di <= 1; di++) {
                    const m = (j + dj) * e.w + i + di;
                    if (m === k) continue;
                    if (!e.eigen[m]) innen = false;
                    else if ((e.h[m] as number) < (e.h[k] as number)) tiefer = true;
                }
            if (!innen || tiefer) continue;
            if (nebenZellen.has(k)) einsenkungen.push(`${String(e.h[k])} bei ${i}/${j}`);
            else senken++;
        }
    if (senken > 0) befunde.push(`${senken} undokumentierte innere Senken`);
    if (einsenkungen.length > nebenEinsenkung)
        befunde.push(
            `${einsenkungen.length} Nebengipfel als Einsenkung (erlaubt ${nebenEinsenkung}): ${einsenkungen.join(", ")}`,
        );
    // Flüsse fallen: in Fließrichtung kein Anstieg über 1 Schritt, auch durch gesetzte Nebengipfel hindurch.
    for (const fluss of input.fluesse) if (flussAnstieg(e, fluss) > 1) befunde.push(`Fluss ${fluss.n} steigt`);
    // Pässe höchstens 30 % (+2 % für die Senkenfüllung), je Messschritt der Zelle.
    for (const pass of paesse) {
        let vorher: number | null = null;
        let max = 0;
        for (let s = 1; s < pass.punkte.length; s++) {
            const [ax, ay] = pass.punkte[s - 1]!;
            const [bx, by] = pass.punkte[s]!;
            const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / e.cell));
            for (let t = s === 1 ? 0 : 1; t <= n; t++) {
                const k = lage(ax + ((bx - ax) * t) / n, ay + ((by - ay) * t) / n);
                if (k < 0) continue;
                const h = e.h[k] as number;
                if (vorher !== null)
                    max = Math.max(max, Math.abs(h - vorher) / ((Math.hypot(bx - ax, by - ay) / n) * 3000));
                vorher = h;
            }
        }
        if (max > 0.32) befunde.push(`Pass ${pass.name ?? "?"} steiler als 30 % (${Math.round(max * 100)} %)`);
    }
    // Gabelungen und Vereinigungen liegen auf einem Punkt beider Stränge.
    const strangPunkte = new Set(
        e.netz.kanten.flatMap((k) => k.punkte.map(([x, y]) => `${x.toFixed(9)}/${y.toFixed(9)}`)),
    );
    for (const kn of e.netz.knoten)
        if (kn.art !== "ast" && !strangPunkte.has(`${kn.x.toFixed(9)}/${kn.y.toFixed(9)}`))
            befunde.push(`Knoten ${kn.art} ohne Strangpunkt`);
    return [...new Set(befunde)];
}

describe("Rückennetz wie im Entwurf", () => {
    it("eigene Höhen an allen Stützpunkten verändern Netz und Gelände; ohne Wert bleibt die Rangvorgabe", () => {
        // Seit WI-0249 P9 je Stützpunkt; die Höhe je Linie (0216) liest der Server als dieselbe Höhe an allen Punkten.
        const linie = blutzinnen.kaemmeLang![0]!;
        const rechne = (h: number) =>
            rechneRueckennetz({ ...blutzinnen.input, zelle: 0.5 }, "kettengebirge", {
                kaemme: [{ ...linie, hoehen: linie.punkte.map(() => h) }],
                talbodenFest: 0.1,
            });
        const tief = rechne(1000);
        const hoch = rechne(5000);
        expect(hoch.netz.kanten.find((k) => k.quelle === "gezeichnet")!.gewicht[0]).toBeCloseTo(
            5000 / kammhoehe(blutzinnen.input),
        );
        expect(sha(tief.h)).not.toBe(sha(hoch.h));
        expect(Math.max(...hoch.h)).toBeGreaterThan(Math.max(...tief.h));
    });
    it("rechnet die Blutzinnen aus kurzen Kämmen, langen Kämmen mit Pass und ohne Kamm auf den gepinnten Ständen der Rechnung", () => {
        const input = blutzinnen.input;
        const kurz = rechneRueckennetz(input, "kettengebirge");
        expect(entwurfsSha(kurz)).toBe("bb192a8c31de");
        const veraendert = { ...kurz, h: kurz.h.slice() };
        const innen = kurz.eigen.findIndex((wert) => wert === 1);
        expect(innen).toBeGreaterThanOrEqual(0);
        veraendert.h[innen] = kurz.h[innen]! + 1;
        expect(entwurfsSha(veraendert)).not.toBe(entwurfsSha(kurz));
        expect(entwurfsSha(rechneRueckennetz(input, "plateaugebirge"))).toBe("a1447e9afbd6");
        expect(entwurfsSha(rechneRueckennetz(input, "kettengebirge", { stufe: "grundform" }))).toBe("fa76542a4393");
        expect(entwurfsSha(rechneRueckennetz(input, "kettengebirge", { talbodenFest: 0.33 }))).toBe("d38f2de0a656");
        const lang = rechneRueckennetz(input, "kettengebirge", {
            kaemme: blutzinnen.kaemmeLang!,
            paesse: blutzinnen.paesse!,
        });
        expect(entwurfsSha(lang)).toBe("dcecf6ac19dc");
        const rueckfall = rechneRueckennetz({ ...input, kaemme: [] }, "kettengebirge");
        expect([entwurfsSha(rueckfall), rueckfall.netz.kanten.length]).toEqual(["128dfba7bd28", 48]);
    }, 60_000);

    it("rechnet Trollzacken, Grimmfrostöde und Nordwalser Höhen auf den gepinnten Ständen der Rechnung", () => {
        const tz = rechneRueckennetz(trollzacken.input, "plateaugebirge");
        expect([entwurfsSha(tz), tz.talboden.toFixed(4)]).toEqual(["9e773ffd8427", "0.8500"]);
        const gf = rechneRueckennetz(grimmfrost.input, "massengebirge");
        expect([entwurfsSha(gf), gf.talboden.toFixed(4)]).toEqual(["97982ec2666e", "0.8500"]);
        expect(entwurfsSha(rechneRueckennetz(nordwalser.input, "bergland"))).toBe("76ccf1737efb");
    }, 60_000);
});

/**
 * Bekannte Grenze (WI-0249, Paket P2 Formerhaltung): Ein gesetzter Nebengipfel, der niedriger ist als sein höherer Nachbar am Hang,
 * trägt in den runderen Typen nur eine Schulter und keinen eigenen Kopf, auch nicht im Umkreis von zwei Zellen. Gemessen am 2026-10-23
 * an den Blutzinnen (0,5 E, ohne Hypsometrie; 17 von 18 Nebengipfeln liegen in der Fläche); in den übrigen sechs Typen hat jeder dieser
 * 17 einen Kopf im Umkreis. Die Zahl sinkt, wenn die Formerhaltung greift; steigen darf sie nicht.
 */
const NEBEN_KOPFLOS_BLUTZINNEN: Readonly<Record<string, number>> = {
    kuppengebirge: 1,
    massengebirge: 1,
    plateaugebirge: 1,
    schild: 1,
    karst: 2,
};
/** Dazu in den Blutzinnen: Der Nebengipfel 1950 bei 447,5/691,5 liegt im Plateau-Typ unter allen Nachbarn (Einsenkung, siehe `tore`). */
const NEBEN_EINSENKUNG_BLUTZINNEN: Readonly<Record<string, number>> = { plateaugebirge: 1 };

/** Der Vorschlag eines Typs mit Köpfen (WI-0249 P2, `koepfe.ts`): Mindestprominenz 6 % der Kammhöhe, wie Fassung 19. */
const mitKopf = (typ: string, kopf = 0.06) => {
    const t = typVorschlag(typ);
    return { struktur: t.struktur, form: { ...t.form, kopf } };
};

describe("Rückennetz: Tore", () => {
    it("hält an den Blutzinnen in allen elf Typen Gipfel, Nebengipfel, Senken, Flüsse, Pass und Knoten (0,5 E)", () => {
        const input = { ...blutzinnen.input, zelle: 0.5 };
        for (const typ of GEBIRGSTYPEN) {
            const e = rechneRueckennetz(input, typ, { paesse: blutzinnen.paesse!, hypsometrie: false });
            // Jeder gesetzte Nebengipfel zählt: keiner geht verloren (früher fielen die nahen an Gipfel und Fluss weg).
            expect([typ, e.nebengipfel.length]).toEqual([typ, input.nebengipfel!.length]);
            const befunde = tore(input, e, {
                paesse: blutzinnen.paesse!,
                nebenKopflos: NEBEN_KOPFLOS_BLUTZINNEN[typ] ?? 0,
                nebenEinsenkung: NEBEN_EINSENKUNG_BLUTZINNEN[typ] ?? 0,
            });
            expect([typ, befunde]).toEqual([typ, []]);
        }
    }, 60_000);

    it("hält mit Köpfen an den Blutzinnen in allen elf Typen jeden Nebengipfel als Kopf, ohne Einsenkung (WI-0249 P2)", () => {
        const input = { ...blutzinnen.input, zelle: 0.5 };
        for (const typ of GEBIRGSTYPEN) {
            const e = rechneRueckennetz(input, mitKopf(typ), {
                paesse: blutzinnen.paesse!,
                hypsometrie: false,
                bandVon: typ,
            });
            expect([typ, e.nebengipfel.length]).toEqual([typ, input.nebengipfel!.length]);
            expect([typ, tore(input, e, { paesse: blutzinnen.paesse! })]).toEqual([typ, []]);
            // Positionen bleiben; ein Nebengipfel steigt höchstens über eine Mulde (Talboden über ihm), sinkt nie.
            e.nebengipfel.forEach((n, i) => {
                const roh = input.nebengipfel![i]!;
                expect([n.x, n.y]).toEqual([roh.x, roh.y]);
                if (roh.h !== null) expect(n.h).toBeGreaterThanOrEqual(roh.h);
            });
        }
    }, 120_000);

    it("hält mit Köpfen auch Nebengipfel nahe dem Gipfel auf ihrer Zielhöhe, in Grundform und Landschaft (P3-Befund)", () => {
        // `setzeGipfel` setzt die kanonischen Gipfel zuletzt und verschiebt Nebengipfel bis 5 E daneben mit (ohne Köpfe +9 bis +18).
        const input = {
            ...blutzinnen.input,
            zelle: 0.5,
            regler: { ...blutzinnen.input.regler, muster: "zellen" as const },
        };
        const gipfel = input.peaks[0]!;
        const nahe = input.nebengipfel!.filter((n) => n.h !== null && Math.hypot(n.x - gipfel.x, n.y - gipfel.y) < 5);
        expect(nahe.length).toBeGreaterThanOrEqual(2);
        const abweichung = (e: RueckenErgebnis) =>
            nahe.map((n) => (e.h[zelleAn(e, n.x, n.y)] as number) - (n.h as number)).filter((d) => d !== 0);
        const alt = rechneRueckennetz(input, "kettengebirge", { stufe: "grundform", talbodenFest: 0.33 });
        expect(abweichung(alt).length).toBeGreaterThan(0);
        for (const stufe of ["grundform", "landschaft"] as const) {
            const e = rechneRueckennetz(input, mitKopf("kettengebirge"), { stufe, talbodenFest: 0.33 });
            expect([stufe, abweichung(e)]).toEqual([stufe, []]);
        }
    }, 60_000);

    it("lässt mit Muster am Kamm 0 die gezeichneten Kämme auf ihrer Höhe, auch mit Zellen (P3-Befund)", () => {
        // Zellen haben einen Mittelwert von −0,44: ohne Dämpfung liegt die Kammlinie im Median auf 0,88 der Höhe ohne Muster.
        const regler = { ...blutzinnen.input.regler, rauschen: 0.5, muster: "zellen" as const };
        const input = { ...blutzinnen.input, regler, zelle: 0.5 };
        const zellen = blutzinnen.input.kaemme!.flatMap((k) => {
            const [[ax, ay], [bx, by]] = k.punkte as [[number, number], [number, number]];
            const l = Math.hypot(bx - ax, by - ay);
            const z: [number, number][] = [];
            for (let u = 0.5; u < l - 0.5; u += 0.25) z.push([ax + ((bx - ax) * u) / l, ay + ((by - ay) * u) / l]);
            return z;
        });
        const verhaeltnis = (kammMuster: number | undefined) => {
            const t = typVorschlag("kettengebirge");
            const form = { ...t.form, ...(kammMuster === undefined ? {} : { kammMuster }) };
            const optionen = { stufe: "grundform" as const, talbodenFest: 0.33 };
            const mit = rechneRueckennetz(input, { struktur: t.struktur, form }, optionen);
            const ohne = rechneRueckennetz(
                { ...input, regler: { ...regler, rauschen: 0 } },
                { struktur: t.struktur, form },
                optionen,
            );
            const r = zellen
                .map(([x, y]) => zelleAn(mit, x, y))
                .filter((k) => k >= 0)
                .map((k) => (mit.h[k] as number) / Math.max(1, ohne.h[k] as number))
                .sort((a, b) => a - b);
            return r[Math.floor(r.length / 2)]!;
        };
        expect(verhaeltnis(undefined)).toBeLessThan(0.95);
        expect(verhaeltnis(0)).toBeCloseTo(1, 3);
    }, 60_000);

    it("meldet die Phasen der Rechnung und rechnet mit dem Rückruf Zeichen für Zeichen gleich (WI-0249 P6)", () => {
        const input = { ...blutzinnen.input, zelle: 0.5 };
        const phasen: [string, number][] = [];
        const ohne = rechneRueckennetz(input, mitKopf("kettengebirge"), { paesse: blutzinnen.paesse! });
        const mit = rechneRueckennetz(input, mitKopf("kettengebirge"), {
            paesse: blutzinnen.paesse!,
            phase: (name, ms) => phasen.push([name, ms]),
        });
        expect(entwurfsSha(mit)).toBe(entwurfsSha(ohne));
        expect(mit.talboden).toBe(ohne.talboden);
        expect(phasen.map(([name]) => name)).toEqual([
            "raster",
            "talboden",
            "netz",
            "hebung",
            "koepfe",
            "senken",
            "naehe",
            "landschaft/taeler",
            "landschaft/erosion",
            "landschaft/erhalt",
            "landschaft/paesse",
            "landschaft/koepfe",
            "landschaft/senken",
        ]);
        expect(phasen.every(([, ms]) => ms >= 0)).toBe(true);
    }, 60_000);

    it("leitet den Talboden ohne Köpfe und Muster am Kamm ab: Die Werte des Formerhalts steuern die Massigkeit nicht um", () => {
        // Trollzacken mit Rauschen 0,95: Ohne Musterbuckel auf dem Kamm hielt der Grat vorher einen viel höheren Talboden aus.
        const input = { ...trollzacken.input, zelle: 0.5 };
        const t = typVorschlag("kettengebirge");
        const vorher = rechneRueckennetz(input, "kettengebirge");
        const mit = rechneRueckennetz(
            input,
            { struktur: t.struktur, form: { ...t.form, kopf: 0.06, kammMuster: 0 } },
            {
                bandVon: "kettengebirge",
            },
        );
        expect(mit.talboden).toBe(vorher.talboden);
    }, 120_000);

    it("rechnet ohne Typwert `form.kopf` und mit 0 Zeichen für Zeichen wie vor WI-0249 P2", () => {
        const input = { ...blutzinnen.input, zelle: 0.5 };
        const ohne = rechneRueckennetz(input, "kettengebirge", { hypsometrie: false });
        expect(entwurfsSha(rechneRueckennetz(input, mitKopf("kettengebirge", 0), { hypsometrie: false }))).toBe(
            entwurfsSha(ohne),
        );
        const t = typVorschlag("kettengebirge");
        const kammMusterEins = { struktur: t.struktur, form: { ...t.form, kammMuster: 1 } };
        expect(entwurfsSha(rechneRueckennetz(input, kammMusterEins, { hypsometrie: false }))).toBe(entwurfsSha(ohne));
        expect(entwurfsSha(rechneRueckennetz(input, mitKopf("kettengebirge"), { hypsometrie: false }))).not.toBe(
            entwurfsSha(ohne),
        );
    }, 60_000);

    it("rechnet ein Gebirge nur mit Nebengipfeln mit Köpfen aus dem Rückennetz, ohne Köpfe mit der V12", () => {
        const input = { ...blutzinnen.input, kaemme: [], zelle: 0.5 };
        const regler = rueckennetzRegler(null, "kettengebirge", {});
        const v12 = buildMountainRaster(ohneNetz(input));
        expect(sha(buildMountainRaster({ ...input, rueckennetz: regler }).h)).toBe(sha(v12.h));
        expect(rechnetRueckennetz(input, regler.form.kopf)).toBe(false);
        const mitKoepfen = { ...regler, form: { ...regler.form, kopf: 0.06 } };
        expect(rechnetRueckennetz(input, mitKoepfen.form.kopf)).toBe(true);
        const netz = buildMountainRaster({ ...input, rueckennetz: mitKoepfen });
        expect(sha(netz.h)).not.toBe(sha(v12.h));
        // Die Kämme spannen die Punkte auf: Gipfel und Nebengipfel als Spannbaum, jede Kante von Punkt zu Punkt.
        const e = rechneRueckennetz(input, mitKopf("kettengebirge"), { hypsometrie: false });
        expect(e.netz.kanten.filter((k) => k.quelle === "gezeichnet")).toHaveLength(input.nebengipfel!.length);
        expect(tore(input, e)).toEqual([]);
    }, 60_000);

    it("hält dieselben Tore an Trollzacken, Grimmfrostöde, Nordwalser Höhen und ohne gezeichneten Kamm", () => {
        const faelle: [V12Input, string][] = [
            [{ ...trollzacken.input, zelle: 0.5 }, "kettengebirge"],
            [{ ...grimmfrost.input, zelle: 0.5 }, "massengebirge"],
            [{ ...nordwalser.input, zelle: 0.5 }, "bergland"],
            [{ ...blutzinnen.input, kaemme: [], zelle: 0.5 }, "rumpfgebirge"],
        ];
        for (const [input, typ] of faelle) {
            const e = rechneRueckennetz(input, typ, { hypsometrie: false });
            expect([typ, e.nebengipfel.length]).toEqual([typ, input.nebengipfel?.length ?? 0]);
            expect([typ, tore(input, e)]).toEqual([typ, []]);
        }
    }, 60_000);

    it("schlagen an, wenn ein Gipfel fehlt, außen Höhe steht oder eine Senke bleibt", () => {
        const input = { ...trollzacken.input, zelle: 0.5 };
        const e = rechneRueckennetz(input, "kettengebirge", { hypsometrie: false });
        const h = e.h.slice();
        const gipfel = input.peaks[0]!;
        const k =
            Math.round((gipfel.y - e.bounds.min_y) / e.cell) * e.w + Math.round((gipfel.x - e.bounds.min_x) / e.cell);
        h[k] = 0;
        const aussen = e.eigen.indexOf(0);
        h[aussen] = 5;
        const befunde = tore(input, { ...e, h });
        expect(befunde.some((b) => b.startsWith("Gipfel"))).toBe(true);
        expect(befunde).toContain("außerhalb nicht 0");
        expect(befunde.some((b) => b.endsWith("undokumentierte innere Senken"))).toBe(true);
    }, 60_000);

    it("rechnet mit gleicher Saat bytegleich und mit anderer anders", () => {
        const input = { ...trollzacken.input, zelle: 0.5 };
        const a = rechneRueckennetz(input, "kettengebirge", { hypsometrie: false });
        expect(sha(rechneRueckennetz(input, "kettengebirge", { hypsometrie: false }).h)).toBe(sha(a.h));
        expect(
            sha(rechneRueckennetz({ ...input, saat: input.saat + 1 }, "kettengebirge", { hypsometrie: false }).h),
        ).not.toBe(sha(a.h));
    }, 60_000);
});

/**
 * Jeder gesetzte Nebengipfel zählt (Betreiber 2026-10-23, WI-0249): Die Rechnung filtert keinen mehr nach Nähe zu einem Gipfel, einem
 * Fluss oder einem anderen Nebengipfel (früher fielen die unter 2 E zu einem kanonischen Gipfel und unter 1 E zu einem Fluss weg). Eng
 * benachbarte Punkte bilden gemeinsame Flanken, schmale Sättel oder ein Massiv, ohne Warnung; gesetzte Positionen bleiben, kanonische
 * Gipfel behalten ihre exakte Höhe, und ein Fluss fließt weiter talwärts. Geprüft wird die Form im Ergebnisraster (0,25 E wie die Vorschau
 * kleiner Gebirge), nicht eine Zusicherung: Gipfelzelle, Prominenz, Kopf im Umkreis von zwei Zellen (`support/gebirge-form.ts`).
 */
describe("Rückennetz: Nebengipfel ohne Nähefilter (WI-0249)", () => {
    // Ein kleines Gebirge ohne die Zufälle der Fixtures: ein Hauptkamm West–Ost mit einem kanonischen Gipfel (2400 bei 14/15) und ein Fluss
    // von Nord nach Süd, der ihn bei 26/15 quert. Zellmitten liegen auf ganzen Viertel-E; alle Punkte unten liegen darauf, damit 0,5 E
    // genau zwei und 0,4 E genau zwei Zellen sind (20,0 und 20,4 runden auf 80 und 82).
    const gipfel = { x: 14, y: 15, h: 2400 };
    const klein = (nebengipfel: NonNullable<V12Input["nebengipfel"]>, zelle = 0.25): V12Input => ({
        bounds: { min_x: 0, min_y: 0, max_x: 40, max_y: 30 },
        geometry: {
            type: "Polygon",
            coordinates: [
                [
                    [0, 0],
                    [40, 0],
                    [40, 30],
                    [0, 30],
                    [0, 0],
                ],
            ],
        },
        peaks: [gipfel],
        kurve: null,
        fluesse: [
            {
                n: "Teststrom",
                bach: false,
                dir: "forward",
                p: [
                    [26, 30],
                    [26.4, 24],
                    [25.8, 18],
                    [26.2, 12],
                    [25.9, 6],
                    [26, 0],
                ],
            },
        ],
        seen: [],
        regler: {
            koernung: 9,
            stufen: 4,
            erosion: 3,
            maximalhoehe: 2400,
            rauschen: 0.3,
            sattel: 0.85,
            talbreite: 1.6,
            einschnitt: 450,
        },
        saat: 4711,
        zelle,
        kaemme: [
            {
                punkte: [
                    [3, 15],
                    [14, 15],
                    [36, 15],
                ],
                rang: "haupt",
            },
        ],
        nebengipfel,
    });
    const rechneKlein = (nebengipfel: NonNullable<V12Input["nebengipfel"]>, zelle?: number) => {
        const input = klein(nebengipfel, zelle);
        return { input, e: rechneRueckennetz(input, "kettengebirge", { hypsometrie: false }) };
    };
    /** Was in jeder Lage gilt: alle Punkte bleiben an ihrem Platz, Gipfel und Nebengipfel stehen auf ihrer Höhe, der Fluss fällt. */
    const haelt = (input: V12Input, e: RueckenErgebnis, gipfelKopf = true, nebenEinsenkung = 0) => {
        expect(e.nebengipfel.map(({ x, y }) => [x, y])).toEqual(input.nebengipfel!.map(({ x, y }) => [x, y]));
        expect(tore(input, e, { nebenKopflos: Infinity, nebenEinsenkung, gipfelKopf })).toEqual([]);
    };

    it.each([
        {
            name: "gleich hoch wie der Gipfel (Doppelgipfel)",
            h: 2400,
            eigenerKopf: true,
            gipfelKopf: true,
            einsenkung: 0,
        },
        { name: "höher als der Gipfel", h: 2800, eigenerKopf: true, gipfelKopf: false, einsenkung: 0 },
        // Bekannte Grenze (Paket P2): Unter dem Kamm um ihn setzt die Rechnung die feste Zelle als Einsenkung, nicht als Erhebung.
        { name: "viel niedriger als der Kamm um ihn", h: 1700, eigenerKopf: false, gipfelKopf: true, einsenkung: 1 },
        { name: "ohne Höhe (Vorgabe 80 %)", h: null, eigenerKopf: false, gipfelKopf: true, einsenkung: 1 },
    ])(
        "behält einen Nebengipfel 0,5 E neben dem kanonischen Gipfel: $name",
        ({ h, eigenerKopf, gipfelKopf, einsenkung }) => {
            const punkt = { x: gipfel.x + 0.5, y: gipfel.y, h };
            const { input, e } = rechneKlein([punkt]);
            haelt(input, e, gipfelKopf, einsenkung);
            const soll = h ?? nebengipfelVorgabe(gipfel.h, e.talboden);
            expect(e.nebengipfel).toEqual([{ ...punkt, h: soll }]);
            const kNeben = zelleAn(e, punkt.x, punkt.y);
            const kGipfel = zelleAn(e, gipfel.x, gipfel.y);
            expect(kNeben - kGipfel).toBe(2);
            expect(e.h[kGipfel]).toBe(gipfel.h);
            expect(e.h[kNeben]).toBe(soll);
            // Eigener Kopf, wo die Form ihn trägt; sonst teilen beide eine Flanke, und im Umkreis steht der Kopf des Gipfels.
            if (eigenerKopf) expect(findeKopf(e, kNeben)?.zelle).toBe(kNeben);
            else expect(findeKopf(e, kNeben)).not.toBeNull();
        },
        60_000,
    );

    it("behält einen Nebengipfel 0,3 E neben dem Fluss als Erhebung; der Fluss fließt weiter talwärts", () => {
        const punkt = { x: 26.3, y: 15, h: 2000 };
        const { input, e } = rechneKlein([punkt]);
        haelt(input, e);
        const k = zelleAn(e, punkt.x, punkt.y);
        expect(e.h[k]).toBe(2000);
        expect(findeKopf(e, k)?.zelle).toBe(k);
        // Der Lauf in der Nähe liegt unter der Erhebung und fällt.
        const nahe = [...flussZellen(e, input.fluesse)].filter(
            (z) =>
                Math.hypot(((z % e.w) - (k % e.w)) * e.cell, (Math.floor(z / e.w) - Math.floor(k / e.w)) * e.cell) <= 1,
        );
        expect(nahe.length).toBeGreaterThan(0);
        for (const z of nahe) expect(e.h[z]).toBeLessThan(2000);
        expect(flussAnstieg(e, input.fluesse[0]!)).toBeLessThanOrEqual(1);
    }, 60_000);

    it("lässt auf dem Lauf des Flusses selbst den Fluss gelten: Der Punkt bleibt gesetzt, der Fluss steigt nicht", () => {
        const auf = klein([]).fluesse[0]!.p[2]!;
        const { input, e } = rechneKlein([{ x: auf[0], y: auf[1], h: 2000 }]);
        haelt(input, e);
        expect(e.nebengipfel).toEqual([{ x: auf[0], y: auf[1], h: 2000 }]);
        expect(e.h[zelleAn(e, auf[0], auf[1])]).toBeLessThan(2000);
        expect(flussAnstieg(e, input.fluesse[0]!)).toBeLessThanOrEqual(1);
    }, 60_000);

    it("gibt mit Kopfneigung einem Nebengipfel einen Kegel nach dem Gipfelmodell: Radius aus der Prominenz, breiter Kopf (WI-0249 P2)", () => {
        // Betreiber 2026-10-24: „sieht mehr aus wie kleine spitzen … bei normalen gipfeln … ragen wirklich heraus“.
        const punkt = { x: 24, y: 15, h: 2300 };
        const input = klein([punkt]);
        const t = typVorschlag("kettengebirge");
        const rechne = (kopfNeigung?: number) =>
            rechneRueckennetz(
                input,
                { struktur: t.struktur, form: { ...t.form, kopf: 0.1, ...(kopfNeigung ? { kopfNeigung } : {}) } },
                { hypsometrie: false },
            );
        const prominenz = 0.1 * 2400;
        expect(kopfRadius(prominenz, 0.08)).toBeCloseTo(1, 10);
        expect(kopfRadius(prominenz, 1)).toBe(0.75);
        /** Radius (E) der zusammenhängenden Fläche über halber Prominenz um den Punkt: wie breit der Kopf oben ist. */
        const obereHaelfte = (e: RueckenErgebnis) => {
            const k0 = zelleAn(e, punkt.x, punkt.y);
            const grenze = (e.h[k0] as number) - prominenz / 2;
            const zu = new Set([k0]);
            const stapel = [k0];
            while (stapel.length) {
                const k = stapel.pop()!;
                for (const kk of [k - 1, k + 1, k - e.w, k + e.w])
                    if (kk >= 0 && kk < e.h.length && e.eigen[kk] && !zu.has(kk) && (e.h[kk] as number) > grenze) {
                        zu.add(kk);
                        stapel.push(kk);
                    }
            }
            return Math.sqrt((zu.size * e.cell * e.cell) / Math.PI);
        };
        const spitz = rechne();
        const kegel = rechne(0.08);
        for (const e of [spitz, kegel]) {
            const k = zelleAn(e, punkt.x, punkt.y);
            expect(e.h[k]).toBe(punkt.h);
            expect(findeKopf(e, k)?.zelle).toBe(k);
            expect(findeKopf(e, k)!.prominenz).toBeGreaterThan(0.8 * prominenz);
        }
        expect(obereHaelfte(kegel)).toBeGreaterThan(1.2 * obereHaelfte(spitz));
        // Ohne Kopfneigung Zeichen für Zeichen wie zuvor.
        expect(entwurfsSha(rechne(0))).toBe(entwurfsSha(spitz));
    }, 60_000);

    it("behält zwei Nebengipfel 0,4 E auseinander: gleich hoch zwei Köpfe mit Sattel, ungleich einen Kopf und eine gemeinsame Flanke", () => {
        const gleich = [
            { x: 20, y: 8, h: 1700 },
            { x: 20.4, y: 8, h: 1700 },
        ];
        const a = rechneKlein(gleich);
        haelt(a.input, a.e);
        const [k1, k2] = gleich.map((p) => zelleAn(a.e, p.x, p.y)) as [number, number];
        expect(k2 - k1).toBe(2);
        expect(findeKopf(a.e, k1)?.zelle).toBe(k1);
        expect(findeKopf(a.e, k2)?.zelle).toBe(k2);
        expect(a.e.h[k1 + 1]).toBeLessThan(1700);

        const ungleich = [
            { x: 20, y: 20, h: 1800 },
            { x: 20.4, y: 20, h: 2000 },
        ];
        const b = rechneKlein(ungleich);
        haelt(b.input, b.e);
        const hoeher = zelleAn(b.e, 20.4, 20);
        expect(findeKopf(b.e, hoeher)?.zelle).toBe(hoeher);
        // Der niedrigere steht auf der Flanke des höheren: Im Umkreis von zwei Zellen trägt dessen Kopf die Erhebung.
        expect(findeKopf(b.e, zelleAn(b.e, 20, 20))).not.toBeNull();
    }, 60_000);

    it("behält zwei Nebengipfel 0,4 E auseinander auch unter der Rasterauflösung (0,5 E): Zellen benachbart, Höhen exakt", () => {
        const punkte = [
            { x: 20, y: 8, h: 1800 },
            { x: 20.4, y: 8, h: 2000 },
        ];
        const { input, e } = rechneKlein(punkte, 0.5);
        haelt(input, e);
        const [k1, k2] = punkte.map((p) => zelleAn(e, p.x, p.y)) as [number, number];
        expect(k2 - k1).toBe(1);
        expect([e.h[k1], e.h[k2]]).toEqual([1800, 2000]);
        expect(findeKopf(e, k2)).not.toBeNull();
    }, 60_000);

    it("rechnet viele dicht gesetzte Nebengipfel an Gipfeln, Flüssen und aufeinander ohne Ausfall (Trollzacken, 0,5 E)", () => {
        const next = random(2026);
        const punkte: { x: number; y: number; h: number | null }[] = [];
        // Rund um jeden kanonischen Gipfel und jeden Fluss dicht gesetzt, alle niedriger als die Gipfel (die höheren prüft der Fall oben).
        for (const p of trollzacken.input.peaks)
            for (let i = 0; i < 6; i++) {
                const winkel = next() * 2 * Math.PI;
                const abstand = next() * 1.2;
                punkte.push({
                    x: p.x + Math.cos(winkel) * abstand,
                    y: p.y + Math.sin(winkel) * abstand,
                    h: 1400 + Math.round(next() * 600),
                });
            }
        for (const fluss of trollzacken.input.fluesse)
            for (let i = 0; i < 2; i++) {
                const s = 1 + Math.floor(next() * (fluss.p.length - 1));
                const [ax, ay] = fluss.p[s - 1]!;
                const [bx, by] = fluss.p[s]!;
                const t = next();
                const winkel = next() * 2 * Math.PI;
                const abstand = next() * 0.5;
                punkte.push({
                    x: ax + (bx - ax) * t + Math.cos(winkel) * abstand,
                    y: ay + (by - ay) * t + Math.sin(winkel) * abstand,
                    h: 1400 + Math.round(next() * 600),
                });
            }
        const gipfel0 = trollzacken.input.peaks[0]!;
        const flusspunkt = trollzacken.input.fluesse[0]!.p[1]!;
        // Genau auf einem Gipfel (der Gipfel gewinnt die Zelle), genau auf einem Flusspunkt (der Fluss gewinnt) und doppelt gesetzt.
        punkte.push(
            { x: gipfel0.x, y: gipfel0.y, h: 1800 },
            { x: flusspunkt[0], y: flusspunkt[1], h: 1500 },
            { x: 640, y: 535, h: 1800 },
            { x: 640, y: 535, h: 1900 },
        );
        const input = { ...trollzacken.input, zelle: 0.5, nebengipfel: punkte };
        const e = rechneRueckennetz(input, "kettengebirge", { hypsometrie: false });
        expect(e.nebengipfel.map(({ x, y }) => [x, y])).toEqual(punkte.map(({ x, y }) => [x, y]));
        expect(tore(input, e, { nebenKopflos: Infinity, nebenEinsenkung: Infinity, gipfelKopf: false })).toEqual([]);
        for (const p of input.peaks) expect(e.h[zelleAn(e, p.x, p.y)]).toBe(p.h);
    }, 60_000);

    // Paket P2 (Formerhaltung, Typwert `form.kopf`): Ein Nebengipfel dicht am viel höheren Gipfel wird keine Einsenkung mehr (ohne Köpfe
    // eine, siehe oben), sondern steht exakt auf seiner Höhe als Schulter des Massivs (eng benachbarte Gipfel dürfen ein Massiv bilden).
    it.each([
        { name: "viel niedriger als der Kamm um ihn", h: 1700 },
        { name: "ohne Höhe (Vorgabe 80 %)", h: null },
    ])(
        "hält mit Köpfen einen Nebengipfel 0,5 E neben dem Gipfel auf seiner Höhe, ohne Einsenkung: $name",
        ({ h }) => {
            const punkt = { x: gipfel.x + 0.5, y: gipfel.y, h };
            const input = klein([punkt]);
            const e = rechneRueckennetz(input, mitKopf("kettengebirge"), { hypsometrie: false });
            expect(tore(input, e)).toEqual([]);
            const kNeben = zelleAn(e, punkt.x, punkt.y);
            const kGipfel = zelleAn(e, gipfel.x, gipfel.y);
            expect(e.h[kGipfel]).toBe(gipfel.h);
            expect(findeKopf(e, kGipfel)?.zelle).toBe(kGipfel);
            // Die Position und die Zielhöhe bleiben (P3: `setzeGipfel` verschob sie bis 5 E um einen Gipfel); im Umkreis steht der Kopf des Gipfels.
            const soll = h ?? nebengipfelVorgabe(gipfel.h, e.talboden);
            expect(e.nebengipfel[0]).toEqual({ ...punkt, h: soll });
            expect(e.h[kNeben]).toBe(soll);
            expect(findeKopf(e, kNeben)).not.toBeNull();
        },
        60_000,
    );

    it("gibt mit Köpfen einem Nebengipfel auf der Flanke eines höheren Kamms einen Kopf mit Sattel, ohne ihn anzuheben", () => {
        // 0,75 E neben dem Hauptkamm, der Kamm steigt dort über ihn hinaus; nach außen fällt die Flanke ab. Ohne Köpfe ist er Schulter.
        const punkt = { x: 20, y: 15.75, h: 1800 };
        const input = klein([punkt]);
        const e = rechneRueckennetz(input, mitKopf("kettengebirge"), { hypsometrie: false });
        expect(tore(input, e)).toEqual([]);
        const k = zelleAn(e, punkt.x, punkt.y);
        expect(e.nebengipfel[0]).toEqual(punkt);
        const kopf = findeKopf(e, k);
        expect(kopf?.zelle).toBe(k);
        // Die Prominenz erreicht die Vorgabe (6 % der Kammhöhe) bis auf die Senkenfüllung.
        expect(kopf!.prominenz).toBeGreaterThan(0.06 * 2400 * 0.5);
        const ohne = rechneRueckennetz(input, "kettengebirge", { hypsometrie: false });
        expect(findeKopf(ohne, k)?.zelle).not.toBe(k);
    }, 60_000);

    it("setzt einem Nebengipfel ohne Höhe die Vorgabe: 80 % der Kammhöhe, mindestens 10 % über dem Talboden", () => {
        // Seit dem 21.10. begrenzt kein Sockel unter den kanonischen Gipfeln mehr: Die Vorgabe darf höher liegen als ein niedriger Gipfel.
        const input = { ...trollzacken.input, zelle: 0.5 };
        const e = rechneRueckennetz(input, "kettengebirge", { hypsometrie: false });
        expect(e.nebengipfel).toHaveLength(input.nebengipfel!.length);
        for (const n of e.nebengipfel) expect(n.h).toBe(nebengipfelVorgabe(kammhoehe(input), e.talboden));
        expect(nebengipfelVorgabe(1000, 0.2)).toBe(800);
        expect(nebengipfelVorgabe(1000, 0.85)).toBe(950);
    }, 60_000);
});

describe("Rückennetz: Durchhang zwischen den Kammpunkten (WI-0249 P2)", () => {
    // Betreiber 2026-10-23: „X\_/X\_/X\_/X“. Ein Hauptkamm West–Ost mit Punkten bei x = 4, 10, 20, 22, 34 (Segmente 6, 10, 2 und 12 E),
    // an beiden Enden ein Nebengipfel 2000; ein Nebenkamm zweigt bei x = 20 nach Norden ab und endet frei. Ohne Rauschen und ohne den
    // Durchhang der V12 (Sattel 1), damit das Profil allein den neuen Durchhang zeigt.
    const input: V12Input = {
        bounds: { min_x: 0, min_y: 0, max_x: 40, max_y: 30 },
        geometry: {
            type: "Polygon",
            coordinates: [
                [
                    [0, 0],
                    [40, 0],
                    [40, 30],
                    [0, 30],
                    [0, 0],
                ],
            ],
        },
        peaks: [],
        kurve: null,
        fluesse: [],
        seen: [],
        regler: { koernung: 9, stufen: 4, erosion: 3, maximalhoehe: 2400, rauschen: 0, sattel: 1 },
        saat: 4711,
        zelle: 0.25,
        kaemme: [
            {
                punkte: [
                    [4, 15],
                    [10, 15],
                    [20, 15],
                    [22, 15],
                    [34, 15],
                ],
                rang: "haupt",
            },
            {
                punkte: [
                    [20, 15],
                    [20, 24],
                    [20, 27],
                ],
                rang: "neben",
            },
        ],
        nebengipfel: [
            { x: 4, y: 15, h: 2000 },
            { x: 34, y: 15, h: 2000 },
        ],
    };
    const t = typVorschlag("kettengebirge");
    const rechne = (durchhang?: number, durchhangNeben?: number, talboden = 0.3) =>
        rechneRueckennetz(
            input,
            {
                struktur: t.struktur,
                form: {
                    ...t.form,
                    kammMuster: 0,
                    ...(durchhang === undefined ? {} : { durchhang }),
                    ...(durchhangNeben === undefined ? {} : { durchhangNeben }),
                },
            },
            { stufe: "grundform", talbodenFest: talboden, hypsometrie: false },
        );
    const hoehe = (e: RueckenErgebnis, x: number, y = 15) => e.h[zelleAn(e, x, y)] as number;
    /** Tiefster Punkt im Inneren eines Segments (ohne 0,5 E an den Punkten): Lage als Anteil und Tiefe unter dem Mittel der Punkte. */
    const sattel = (e: RueckenErgebnis, a: number, b: number) => {
        let tief = { x: a, h: Infinity };
        for (let x = a + 0.5; x <= b - 0.5; x += 0.25) if (hoehe(e, x) < tief.h) tief = { x, h: hoehe(e, x) };
        const mitte = (hoehe(e, a) + hoehe(e, b)) / 2;
        return { lage: (tief.x - a) / (b - a), tiefe: (mitte - tief.h) / mitte };
    };

    it("rechnet ohne Durchhang und mit 0 Zeichen für Zeichen wie zuvor", () => {
        expect(entwurfsSha(rechne(0, 0))).toBe(entwurfsSha(rechne()));
        expect(entwurfsSha(rechne(0.15, 0.2))).not.toBe(entwurfsSha(rechne()));
    }, 60_000);

    it("hängt zwischen den Kammpunkten durch: Sattel etwa in der Mitte, lange Segmente deutlich, kurze kaum, Punkte bleiben", () => {
        const ohne = rechne();
        const mit = rechne(0.15, 0.2);
        // Die Punkte behalten ihre Höhe.
        for (const x of [10, 20, 22]) expect(Math.abs(hoehe(mit, x) - hoehe(ohne, x))).toBeLessThan(2);
        // Ohne Durchhang läuft der Kamm zwischen zwei inneren Punkten gerade (kein Sattel unter den Punkten); an einem Nebengipfel
        // senkt schon dessen Kopf das Segment vor ihm (`setzeGipfel`).
        expect(sattel(ohne, 10, 20).tiefe).toBeLessThan(0.02);
        // Lange Segmente (10 und 12 E) hängen um gut den Durchhang des Typs durch, der Sattel liegt in der Mitte.
        for (const [a, b] of [
            [10, 20],
            [22, 34],
        ] as const) {
            const s = sattel(mit, a, b);
            expect(s.tiefe).toBeGreaterThan(0.1);
            expect(s.tiefe).toBeLessThan(0.2);
            expect(s.lage).toBeGreaterThan(0.35);
            expect(s.lage).toBeLessThan(0.65);
        }
        // Kurz (2 E): kaum.
        expect(sattel(mit, 20, 22).tiefe).toBeLessThan(0.05);
        // Der Punkt bei x = 10 ist entlang des Kamms ein Maximum; das Längsprofil hat keine Stufe (Schritt je 0,25 E unter 3 %).
        for (const d of [0.5, 1, 2]) {
            expect(hoehe(mit, 10)).toBeGreaterThan(hoehe(mit, 10 - d));
            expect(hoehe(mit, 10)).toBeGreaterThan(hoehe(mit, 10 + d));
        }
        for (let x = 10; x < 20; x += 0.25)
            expect(Math.abs(hoehe(mit, x + 0.25) - hoehe(mit, x))).toBeLessThan(0.03 * hoehe(mit, 10));
        // Das Querprofil im Sattel bleibt konvex: die Achse am höchsten, nach außen fallend.
        const x = 10 + 10 * sattel(mit, 10, 20).lage;
        for (const d of [0.5, 1]) {
            expect(hoehe(mit, x, 15)).toBeGreaterThan(hoehe(mit, x, 15 + d));
            expect(hoehe(mit, x, 15)).toBeGreaterThan(hoehe(mit, x, 15 - d));
        }
        expect(hoehe(mit, x, 14.5) + hoehe(mit, x, 15.5) - 2 * hoehe(mit, x, 15)).toBeLessThan(0);
    }, 60_000);

    it("hängt über einem hohen Talboden flacher durch, bleibt über dem Boden und gewölbt (Blutzinnen: Talboden 0,85)", () => {
        // Über einem hohen Sockel steht der Kamm nur wenig über dem Boden: Der Sattel sinkt höchstens 80 % davon, in seiner Form.
        const ohne = rechne(undefined, undefined, 0.85);
        const mit = rechne(0.15, 0.2, 0.85);
        const boden = 0.85 * 2400;
        const s = sattel(mit, 10, 20);
        expect(s.tiefe).toBeGreaterThan(0.03);
        expect(s.lage).toBeGreaterThan(0.35);
        expect(s.lage).toBeLessThan(0.65);
        const x = 10 + 10 * s.lage;
        expect(hoehe(mit, x)).toBeGreaterThan(boden + 0.15 * (hoehe(ohne, x) - boden));
        for (const d of [0.5, 1, 2]) {
            expect(hoehe(mit, x, 15)).toBeGreaterThan(hoehe(mit, x, 15 + d));
            expect(hoehe(mit, x, 15)).toBeGreaterThan(hoehe(mit, x, 15 - d));
        }
        for (const v of [10, 20]) expect(Math.abs(hoehe(mit, v) - hoehe(ohne, v))).toBeLessThan(2);
    }, 60_000);

    it("hängt nur zwischen tragenden Punkten durch: nicht am freien Kammende, kurz wenig, Nebenkämme mit ihrem Wert", () => {
        const tiefen = durchhangTiefen(
            input.kaemme!,
            input.nebengipfel!.map(({ x, y }) => ({ x, y })),
            { haupt: 0.15, neben: 0.2 },
        );
        expect(tiefen[0]![1]).toBeCloseTo(0.15 * durchhangAnteil(10), 10);
        expect(tiefen[0]![2]).toBeCloseTo(0.15 * durchhangAnteil(2), 10);
        expect(tiefen[0]![2]).toBeLessThan(0.04);
        // Der Nebenkamm rastet am Hauptkamm ein (trägt), sein letztes Segment endet frei.
        expect(tiefen[1]![0]).toBeCloseTo(0.2 * durchhangAnteil(9), 10);
        expect(tiefen[1]![1]).toBe(0);
        // Das Profil: 0 an den Punkten, 1 in der Mitte, symmetrisch und ohne Knick am Punkt.
        expect(durchhangProfil(0, 10)).toBeCloseTo(0, 10);
        expect(durchhangProfil(1, 10)).toBeCloseTo(0, 10);
        expect(durchhangProfil(0.5, 10)).toBeCloseTo(1, 10);
        expect(durchhangProfil(0.3, 10)).toBeCloseTo(durchhangProfil(0.7, 10), 10);
        expect(durchhangProfil(0.001, 10) / 0.001).toBeLessThan(0.1);
    });
});

describe("Rückennetz im Gelände", () => {
    it("rechnet buildMountainRaster mit Kamm aus dem Rückennetz, ohne Kamm mit der V12", () => {
        const input = { ...blutzinnen.input, zelle: 0.5 };
        const regler = rueckennetzRegler(null, "kettengebirge", {});
        const mitNetz = buildMountainRaster({ ...input, rueckennetz: regler });
        const direkt = rechneRueckennetz(input, regler, { band: regler.band, gratMin: regler.gratMin });
        expect(sha(mitNetz.h)).toBe(sha(direkt.h));
        expect(mitNetz.leer).toBe(false);
        const v12 = buildMountainRaster(ohneNetz(input));
        expect(sha(v12.h)).toBe(sha(buildMountainRaster({ ...ohneNetz(input), kaemme: [] }).h));
        expect(sha(v12.h)).not.toBe(sha(mitNetz.h));
    }, 60_000);

    it("hält die Eingabe eines Gebirges ohne Kamm Zeichen für Zeichen gleich (Fingerabdruck)", () => {
        expect(Object.keys(ohneNetz(blutzinnen.input))).toEqual([
            "bounds",
            "geometry",
            "peaks",
            "kurve",
            "fluesse",
            "seen",
            "regler",
            "saat",
        ]);
    });

    it("legt die Saat mit dem Gitter des Geländes Zelle für Zelle auf dessen Zellmitten (WI-0249 P2)", () => {
        const regler = rueckennetzRegler(null, "kettengebirge", { talboden: 0.5 });
        const input = { ...trollzacken.input };
        const ohne = buildMountainRaster({ ...input, rueckennetz: regler });
        expect(ohne.bounds).toEqual(input.bounds);
        const gitter = { zelle: 0.25, mitte: 0.125 };
        const mit = buildMountainRaster({ ...input, rueckennetz: { ...regler, gitter } });
        // Die Zellmitten liegen auf 0,125 + k · 0,25 wie die des groben Domänengitters; der Rahmen umfasst die Fläche.
        for (const v of [mit.bounds.min_x, mit.bounds.min_y, mit.bounds.max_x, mit.bounds.max_y])
            expect(
                Math.abs((v - gitter.mitte) / gitter.zelle - Math.round((v - gitter.mitte) / gitter.zelle)),
            ).toBeLessThan(1e-9);
        expect(mit.bounds.min_x).toBeLessThanOrEqual(input.bounds.min_x);
        expect(mit.bounds.max_y).toBeGreaterThanOrEqual(input.bounds.max_y);
        expect(mit.bounds.min_x).toBeGreaterThan(input.bounds.min_x - gitter.zelle);
        // Eine andere Zellweite (Vorschau, Talboden-Suche auf 0,5 E) bleibt am Rahmen der Fläche.
        const grob = buildMountainRaster({ ...input, zelle: 0.5, rueckennetz: { ...regler, gitter } });
        expect(grob.bounds).toEqual(input.bounds);
        // Das Gelände setzt das Gitter nur mit dem Formerhalt der Fassung (`mountainMorphology.rueckennetz`).
        const f18 = AVENTURIA_TERRAIN_RECIPES.get(18)!;
        expect(rueckennetzGitter(f18)).toBeNull();
        const mitFormerhalt = { ...f18, mountainMorphology: { ...f18.mountainMorphology, rueckennetz: {} } };
        expect(rueckennetzGitter(mitFormerhalt)).toEqual(gitter);
    }, 60_000);

    it("nimmt die Durchschnittshöhe als Ziel des Talbodens", () => {
        const input = { ...trollzacken.input, zelle: 0.5 };
        const niedrig = rechneRueckennetz(input, "kettengebirge", { mittelZiel: 300 });
        const hoch = rechneRueckennetz(input, "kettengebirge", { mittelZiel: 1200 });
        expect(hoch.talboden).toBeGreaterThan(niedrig.talboden);
    }, 60_000);
});

describe("Rückennetz: Ausschnitt", () => {
    it("rechnet im Ausschnitt die Grundform wie im ganzen Gebirge, mit Netz und Rand der ganzen Fläche", () => {
        const input = { ...schwert.input, zelle: 1 };
        const ganz = rechneRueckennetz(input, "kettengebirge", { stufe: "grundform", talbodenFest: 0.3 });
        const rahmen = {
            min_x: input.bounds.min_x + 60,
            min_y: input.bounds.min_y + 120,
            max_x: input.bounds.min_x + 110,
            max_y: input.bounds.min_y + 170,
        };
        const teil = rechneRueckennetz(input, "kettengebirge", {
            stufe: "grundform",
            talbodenFest: 0.3,
            ausschnitt: rahmen,
        });
        expect(teil.w).toBeLessThan(ganz.w);
        expect(teil.bounds.min_x).toBeLessThanOrEqual(rahmen.min_x);
        expect(teil.bounds.max_x).toBeGreaterThanOrEqual(rahmen.max_x);
        expect(teil.netz.kanten.length).toBe(ganz.netz.kanten.length);
        const i0 = Math.round((teil.bounds.min_x - ganz.bounds.min_x) / ganz.cell);
        const j0 = Math.round((teil.bounds.min_y - ganz.bounds.min_y) / ganz.cell);
        let abweichend = 0;
        for (let j = 0; j < teil.hh; j++)
            for (let i = 0; i < teil.w; i++)
                if (teil.h[j * teil.w + i] !== ganz.h[(j0 + j) * ganz.w + i0 + i]) abweichend++;
        expect(abweichend).toBe(0);
        expect(() =>
            rechneRueckennetz(input, "kettengebirge", { ausschnitt: { min_x: 0, min_y: 0, max_x: 1, max_y: 1 } }),
        ).toThrow(RangeError);
    }, 60_000);
});

describe("Rückennetz: Werte", () => {
    it("löst Typwerte, Abweichungen und die Preset-Spalte auf", () => {
        const regler = rueckennetzRegler(null, "plateaugebirge", { grat: 0.2, talboden: 0.5 }, 1800);
        expect(regler.form.grat).toBe(0.2);
        expect(regler.form.gratBreite).toBe(typVorschlag("plateaugebirge").form.gratBreite);
        expect([regler.talbodenFest, regler.mittelZiel]).toEqual([0.5, 1800]);
        expect(rueckennetzRegler(null, null, {}).struktur).toEqual(typVorschlag("kettengebirge").struktur);
        expect(rueckennetzVorgabe(null, "schild")).toEqual({
            grat: 0.14,
            gratBreite: 0.45,
            talboden: 0.7,
            // Kein Preset je Typ: Die Erosionsfestigkeit (WI-0249) steht ohne eigenen Wert auf 0 %.
            erosionsfestigkeit: 0,
        });
        expect(KAMM_FANG_E).toBe(0.5);
    });

    it("nimmt die Typwerte aus der Fassung, wenn sie sie führt", () => {
        const vorgabe = GEBIRGS_PRESETS_VORGABE;
        const schild = { ...vorgabe.typen.schild, rueckennetz: { ...typVorschlag("schild"), gratMin: 0.07 } };
        const gruppe = { ...vorgabe, typen: { ...vorgabe.typen, schild } };
        expect(Value.Check(GebirgsPresetGruppeSchema, gruppe)).toBe(true);
        expect(Value.Check(GebirgsPresetGruppeSchema, vorgabe)).toBe(true);
        expect(rueckennetzRegler(gruppe, "schild", {}).gratMin).toBe(0.07);
        expect(rueckennetzRegler(gruppe, "karst", {}).gratMin).toBe(typVorschlag("karst").gratMin);
    });
});
