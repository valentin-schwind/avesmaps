/**
 * Vom Auftrag zur Eingabe des Generators (WI-0250 Phase B): das Gebirge aus Fixture oder Datei, das Rezept (Fassung, Überlagerung „19 (Test)“,
 * ungeprüfte Rohwerte) und die Regler. Rein; die einzigen Generatorfunktionen sind `gebirgsRegler`, `rueckennetzRegler` und `mitTest`.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import type { Auftrag } from "./auftrag.ts";
import { FIXTURE_ORDNER } from "./pfade.ts";
import type { Eingabe, Generator, Rezept } from "./generator.ts";

export interface Gebirgsfall {
    name: string;
    /** Kennung der Fläche (area), die Saaten tragen sie; die Fixtures nennen sie. */
    area: string | null;
    input: Eingabe & {
        bounds: { min_x: number; min_y: number; max_x: number; max_y: number };
        regler: Record<string, unknown>;
    };
    paesse: unknown[];
    /** SHA-256 der Datei. */
    quelle_sha256: string;
}

/** Liest Fixture (`<wurzel>/apps/server/test/fixtures/rueckennetz/<name>.json`) oder Datei. */
export function ladeGebirge(auftrag: Auftrag, wurzel: string): Gebirgsfall {
    const pfad =
        "fixture" in auftrag.gebirge
            ? join(wurzel, FIXTURE_ORDNER, `${auftrag.gebirge.fixture}.json`)
            : isAbsolute(auftrag.gebirge.datei)
              ? auftrag.gebirge.datei
              : resolve(auftrag.gebirge.datei);
    const text = readFileSync(pfad);
    const json = JSON.parse(text.toString("utf8")) as {
        name?: string;
        area?: string;
        input?: Gebirgsfall["input"];
        paesse?: unknown[];
    };
    if (!json.input?.bounds || !json.input.regler)
        throw new Error(`${pfad}: kein Gebirge (input.bounds und input.regler erwartet)`);
    return {
        name: json.name ?? ("fixture" in auftrag.gebirge ? auftrag.gebirge.fixture : pfad),
        area: json.area ?? null,
        input: json.input,
        paesse: json.paesse ?? [],
        quelle_sha256: createHash("sha256").update(text).digest("hex"),
    };
}

/** Hash der Datei eines Gebirges (für den Fingerabdruck des Auftrags); Fixtures gehören zum Commit und zählen nicht. */
export function dateiHash(auftrag: Auftrag): string | null {
    if ("fixture" in auftrag.gebirge) return null;
    return createHash("sha256")
        .update(readFileSync(resolve(auftrag.gebirge.datei)))
        .digest("hex");
}

function tiefMischen(ziel: Record<string, unknown>, quelle: Record<string, unknown>): void {
    for (const [k, v] of Object.entries(quelle)) {
        const z = ziel[k];
        if (
            typeof v === "object" &&
            v !== null &&
            !Array.isArray(v) &&
            typeof z === "object" &&
            z !== null &&
            !Array.isArray(z)
        )
            tiefMischen(z as Record<string, unknown>, v as Record<string, unknown>);
        else ziel[k] = structuredClone(v);
    }
}

export interface AufgeloestesRezept {
    rezept: Rezept;
    fassung: number;
    /** `recipeFingerprint` des wirksamen Rezepts (nach Überlagerung und Rohwerten). */
    fingerprint: string;
    basis_fingerprint: string;
    ueberlagert: boolean;
    roh_angewendet: boolean;
}

/** Die Fassung, darüber die Überlagerung (`mitTest`, geprüft), darüber die Rohwerte (ungeprüft, Tiefenmischung). */
export function loeseRezept(gen: Generator, auftrag: Auftrag): AufgeloestesRezept {
    const fassung = auftrag.rezept.fassung ?? gen.rezepte.vorgabeFassung;
    const basis = gen.rezepte.alle.get(fassung);
    if (!basis)
        throw new Error(
            `Rezept: Fassung ${String(fassung)} gibt es im Stand nicht (vorhanden: ${[...gen.rezepte.alle.keys()].join(", ")})`,
        );
    let rezept = basis;
    const ueberlagerung = auftrag.rezept.ueberlagerung;
    if (ueberlagerung !== null) {
        if (!gen.rezepte.mitTest) throw new Error("Schnittstelle fehlt im Stand: mitTest (Überlagerung „19 (Test)“)");
        rezept = gen.rezepte.mitTest(basis, ueberlagerung);
    }
    if (auftrag.rezept.roh !== null) {
        rezept = structuredClone(rezept);
        tiefMischen(rezept as unknown as Record<string, unknown>, auftrag.rezept.roh);
    }
    return {
        rezept,
        fassung,
        fingerprint: gen.rezepte.fingerprint(rezept),
        basis_fingerprint: gen.rezepte.fingerprint(basis),
        ueberlagert: ueberlagerung !== null,
        roh_angewendet: auftrag.rezept.roh !== null,
    };
}

export interface GebirgsEingabe {
    /** Die V12-Eingabe mit Reglern und Saat des Auftrags (noch ohne Auflösung). */
    eingabe: Eingabe;
    /** Die V12-Regler (Fixture oder Preset, darüber die Überschreibungen). */
    regler: Record<string, unknown>;
    saat: number;
    /** Die Regler des Rückennetzes (Typwerte der Fassung mit den Abweichungen). */
    rueckennetz: ReturnType<Generator["gebirge"]["rueckennetzRegler"]>;
}

function pruefeTyp(rezept: Rezept, typ: string | null): void {
    const typen = rezept.gebirgsPresets?.typen;
    if (typ !== null && typen && !(typ in typen))
        throw new Error(
            `typ ${typ}: unbekannt (Fassung ${String(rezept.version)} kennt ${Object.keys(typen).join(", ")})`,
        );
}

export function baueGebirgsEingabe(
    gen: Generator,
    auftrag: Auftrag,
    fall: Gebirgsfall,
    rezept: Rezept,
): GebirgsEingabe {
    pruefeTyp(rezept, auftrag.typ);
    let regler: Record<string, unknown>;
    if (auftrag.reglerQuelle === "preset") {
        const preset =
            (rezept.gebirgsPresets?.typen as Record<string, unknown> | undefined)?.[auftrag.typ ?? "kettengebirge"] ??
            null;
        const werte: Record<string, number> = { ...auftrag.regler };
        const eigeneKammhoehe = werte["maximalhoehe"];
        delete werte["maximalhoehe"];
        const kammhoehe = eigeneKammhoehe ?? (fall.input.regler["maximalhoehe"] as number | undefined) ?? null;
        regler = gen.gebirge.gebirgsRegler(preset, { werte, muster: null, kammhoehe }, null);
    } else {
        regler = { ...fall.input.regler, ...auftrag.regler };
    }
    const saat = auftrag.saat ?? Number(fall.input.saat);
    const eingabe: Eingabe = { ...fall.input, regler, saat };
    const rueckennetz = gen.gebirge.rueckennetzRegler(rezept.gebirgsPresets ?? null, auftrag.typ, auftrag.modell, null);
    return { eingabe, regler, saat, rueckennetz };
}
