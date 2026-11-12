/**
 * Der Auftrag an den Generatoradapter (WI-0250 Phase B): WAS gerechnet wird, nicht WIE GEMESSEN wird. Zwei Aufträge, die dasselbe Ergebnis
 * verlangen, haben denselben Fingerabdruck (`auftragFingerprint`); er ist, mit dem Commit, der Schlüssel des Zwischenspeichers der Läufe.
 * Messoptionen (Wiederholungen, Phasenproben, Arbeiter) gehören nicht hinein.
 *
 * Aufbau (JSON):
 *
 *   {
 *     "name": "blutzinnen-2x",                       // frei, nur für Anzeige und Dateinamen
 *     "gebirge": { "fixture": "blutzinnen" },         // oder { "datei": "pfad/zu/fall.json" } (Form wie die Fixtures)
 *     "typ": "kettengebirge",                         // Gebirgstyp (Presets, Typwerte des Rückennetzes); null = Vorgabe
 *     "reglerQuelle": "fixture",                      // "fixture": Regler der Fixture | "preset": Regler des Typs aus dem Rezept
 *     "regler": { "erosion": 7 },                     // Überschreibungen der V12-Regler (über der Quelle)
 *     "modell": { "talboden": 0.4 },                  // Abweichungen des Reiters „Gebirge“ (grat, gratBreite, talboden)
 *     "saat": 12345,                                  // überschreibt die Saat der Fixture
 *     "stufe": "vorschau",                            // "vorschau" | "saat" | "endgelaende-lokal"
 *     "vorschau": { "aufloesung": 2, "kante": 640, "talboden": "typ" },
 *     "endgelaende": { "rand": 6, "zwischenstaende": false, "schnappschuss": "C:/…/snap" },
 *     "rezept": { "fassung": 19, "ueberlagerung": { "regler": {…}, "rezept": {…}, "presets": {…} }, "roh": {…} }
 *   }
 *
 * `rezept.ueberlagerung` ist die Form von „19 (Test)“ (`HoehenmodellTestWerte`, geprüft von `mitTest`). `rezept.roh` legt Werte ungeprüft
 * über das Rezept (Tiefe zusammengeführt); nur für Proben mit kleinen Größen und für Werte außerhalb des Katalogs. Der Lauf vermerkt es.
 */
import { createHash } from "node:crypto";

export const STUFEN = ["vorschau", "saat", "endgelaende-lokal"] as const;
export type Stufe = (typeof STUFEN)[number];

export type TalbodenWahl = "typ" | "ableiten" | number;

export interface VorschauAuftrag {
    aufloesung: 1 | 2 | 4;
    /** Zellen je längerer Kante bei Auflösung 1 (`VORSCHAU_KANTE_FEIN` der Oberfläche). */
    kante: number;
    /** „typ“: der Talboden des Typs; „ableiten“: aus dem Band gesucht (langsam); Zahl: fester Talboden (Anteil der Kammhöhe). */
    talboden: TalbodenWahl;
}

export interface EndgelaendeAuftrag {
    /** Rand um den Rahmen des Gebirges in E, der in die Ausgabe kommt. */
    rand: number;
    /** Das Höhenfeld nach jeder Phase des Generators mitschreiben (Beobachter); rechnet über den Nachbau des lokalen Ablaufs. */
    zwischenstaende: boolean;
    /** Ordner mit `inputs.json`, `seeds.u16`, `master.u16`, `master.json`, `gebirge.json`; leer: `<Labor>/schnappschuss/aktuell`. */
    schnappschuss: string | null;
    /** Kennung (area) des Gebirges in den Saaten des Schnappschusses; leer: `area` der Fixture. */
    gebirgeId: string | null;
}

export interface RezeptAuftrag {
    /** Fassung des Rezepts; leer: die vorgegebene Fassung der Datei `config/terrain/aventuria.json`. */
    fassung: number | null;
    ueberlagerung: Record<string, unknown> | null;
    roh: Record<string, unknown> | null;
}

export type GebirgeQuelle = { fixture: string } | { datei: string };

export interface Auftrag {
    name: string;
    gebirge: GebirgeQuelle;
    typ: string | null;
    reglerQuelle: "fixture" | "preset";
    regler: Record<string, number>;
    modell: Partial<Record<"grat" | "gratBreite" | "talboden", number>>;
    saat: number | null;
    stufe: Stufe;
    vorschau: VorschauAuftrag | null;
    endgelaende: EndgelaendeAuftrag | null;
    rezept: RezeptAuftrag;
}

export class AuftragFehler extends Error {}

type Objekt = Record<string, unknown>;

const istObjekt = (wert: unknown): wert is Objekt => typeof wert === "object" && wert !== null && !Array.isArray(wert);

function objekt(wert: unknown, pfad: string): Objekt {
    if (!istObjekt(wert)) throw new AuftragFehler(`${pfad}: Objekt erwartet`);
    return wert;
}

function zahl(wert: unknown, pfad: string): number {
    if (typeof wert !== "number" || !Number.isFinite(wert)) throw new AuftragFehler(`${pfad}: Zahl erwartet`);
    return wert;
}

function nurSchluessel(o: Objekt, erlaubt: readonly string[], pfad: string): void {
    for (const k of Object.keys(o))
        if (!erlaubt.includes(k)) throw new AuftragFehler(`${pfad}.${k}: unbekannter Schlüssel`);
}

function zahlenMap(wert: unknown, pfad: string, erlaubt?: readonly string[]): Record<string, number> {
    const o = objekt(wert ?? {}, pfad);
    if (erlaubt) nurSchluessel(o, erlaubt, pfad);
    const aus: Record<string, number> = {};
    for (const k of Object.keys(o).sort()) aus[k] = zahl(o[k], `${pfad}.${k}`);
    return aus;
}

/** Prüft einen Auftrag aus JSON und füllt die Vorgaben; wirft `AuftragFehler` mit Pfad der Stelle. */
export function normalisiere(roh: unknown, vorgabeName = "auftrag"): Auftrag {
    const o = objekt(roh, "auftrag");
    nurSchluessel(
        o,
        [
            "name",
            "gebirge",
            "typ",
            "reglerQuelle",
            "regler",
            "modell",
            "saat",
            "stufe",
            "vorschau",
            "endgelaende",
            "rezept",
        ],
        "auftrag",
    );
    const g = objekt(o["gebirge"], "gebirge");
    nurSchluessel(g, ["fixture", "datei"], "gebirge");
    let gebirge: GebirgeQuelle;
    if (typeof g["fixture"] === "string" && g["datei"] === undefined) {
        if (!/^[a-z0-9][a-z0-9-]*$/.test(g["fixture"]))
            throw new AuftragFehler("gebirge.fixture: nur Kleinbuchstaben, Ziffern, Bindestrich");
        gebirge = { fixture: g["fixture"] };
    } else if (typeof g["datei"] === "string" && g["fixture"] === undefined) {
        gebirge = { datei: g["datei"] };
    } else throw new AuftragFehler("gebirge: genau eines von fixture oder datei");

    const stufe = o["stufe"];
    if (typeof stufe !== "string" || !(STUFEN as readonly string[]).includes(stufe))
        throw new AuftragFehler(`stufe: eines von ${STUFEN.join(", ")}`);
    const typ = o["typ"] ?? null;
    if (typ !== null && typeof typ !== "string") throw new AuftragFehler("typ: Text oder null");
    const reglerQuelle = o["reglerQuelle"] ?? "fixture";
    if (reglerQuelle !== "fixture" && reglerQuelle !== "preset")
        throw new AuftragFehler('reglerQuelle: "fixture" oder "preset"');
    const saat = o["saat"] ?? null;
    if (saat !== null) zahl(saat, "saat");
    const modell = zahlenMap(o["modell"], "modell", ["grat", "gratBreite", "talboden"]) as Auftrag["modell"];

    let vorschau: VorschauAuftrag | null = null;
    if (stufe === "vorschau") {
        const v = objekt(o["vorschau"] ?? {}, "vorschau");
        nurSchluessel(v, ["aufloesung", "kante", "talboden"], "vorschau");
        const aufloesung = v["aufloesung"] ?? 1;
        if (aufloesung !== 1 && aufloesung !== 2 && aufloesung !== 4)
            throw new AuftragFehler("vorschau.aufloesung: 1, 2 oder 4");
        const kante = v["kante"] ?? 640;
        if (!Number.isInteger(kante) || (kante as number) < 8)
            throw new AuftragFehler("vorschau.kante: ganze Zahl ab 8");
        const talboden = v["talboden"] ?? "typ";
        if (talboden !== "typ" && talboden !== "ableiten") {
            const t = zahl(talboden, "vorschau.talboden");
            if (t < 0 || t > 1) throw new AuftragFehler('vorschau.talboden: "typ", "ableiten" oder Zahl von 0 bis 1');
        }
        vorschau = { aufloesung, kante: kante as number, talboden: talboden as TalbodenWahl };
    } else if (o["vorschau"] !== undefined) throw new AuftragFehler('vorschau: nur bei stufe "vorschau"');

    let endgelaende: EndgelaendeAuftrag | null = null;
    if (stufe === "endgelaende-lokal") {
        const e = objekt(o["endgelaende"] ?? {}, "endgelaende");
        nurSchluessel(e, ["rand", "zwischenstaende", "schnappschuss", "gebirgeId"], "endgelaende");
        const rand = zahl(e["rand"] ?? 6, "endgelaende.rand");
        if (rand < 0) throw new AuftragFehler("endgelaende.rand: nicht negativ");
        const zw = e["zwischenstaende"] ?? false;
        if (typeof zw !== "boolean") throw new AuftragFehler("endgelaende.zwischenstaende: Ja/Nein");
        const sn = e["schnappschuss"] ?? null;
        const id = e["gebirgeId"] ?? null;
        if ((sn !== null && typeof sn !== "string") || (id !== null && typeof id !== "string"))
            throw new AuftragFehler("endgelaende.schnappschuss und gebirgeId: Text oder null");
        endgelaende = { rand, zwischenstaende: zw, schnappschuss: sn, gebirgeId: id };
    } else if (o["endgelaende"] !== undefined)
        throw new AuftragFehler('endgelaende: nur bei stufe "endgelaende-lokal"');

    const r = objekt(o["rezept"] ?? {}, "rezept");
    nurSchluessel(r, ["fassung", "ueberlagerung", "roh"], "rezept");
    const fassung = r["fassung"] ?? null;
    if (fassung !== null && (!Number.isInteger(fassung) || (fassung as number) < 1))
        throw new AuftragFehler("rezept.fassung: ganze Zahl ab 1");
    const ueberlagerung =
        r["ueberlagerung"] === undefined || r["ueberlagerung"] === null
            ? null
            : objekt(r["ueberlagerung"], "rezept.ueberlagerung");
    const rohRezept = r["roh"] === undefined || r["roh"] === null ? null : objekt(r["roh"], "rezept.roh");

    const name = typeof o["name"] === "string" && o["name"] !== "" ? o["name"] : vorgabeName;
    if (!/^[A-Za-z0-9._-]+$/.test(name))
        throw new AuftragFehler("name: nur Buchstaben, Ziffern, Punkt, Unter- und Bindestrich");
    return {
        name,
        gebirge,
        typ,
        reglerQuelle,
        regler: zahlenMap(o["regler"], "regler"),
        modell,
        saat: saat as number | null,
        stufe: stufe as Stufe,
        vorschau,
        endgelaende,
        rezept: { fassung: fassung as number | null, ueberlagerung, roh: rohRezept },
    };
}

/** JSON mit sortierten Schlüsseln: gleicher Inhalt, gleiche Zeichen. */
export function kanonisch(wert: unknown): string {
    if (Array.isArray(wert)) return `[${wert.map(kanonisch).join(",")}]`;
    if (istObjekt(wert))
        return `{${Object.keys(wert)
            .sort()
            .filter((k) => wert[k] !== undefined)
            .map((k) => `${JSON.stringify(k)}:${kanonisch(wert[k])}`)
            .join(",")}}`;
    return JSON.stringify(wert);
}

/** Inhalte, die der Auftrag nennt, aber nicht trägt; ihr Hash geht in den Fingerabdruck ein, damit eine geänderte Datei einen neuen Schlüssel gibt. */
export interface Inhalte {
    /** Hash der Datei des Gebirges (bei `datei`); bei `fixture` leer, denn die Fixture gehört zum Commit. */
    gebirgeDatei: string | null;
    /** Fingerabdruck des Schnappschusses (nur Endgelände). */
    schnappschuss: string | null;
}

/**
 * `name` ist nur eine Anzeige und zählt nicht, ebenso wenig die Pfade zu Datei und Schnappschuss: Für sie zählt der Inhalt (`inhalte`).
 * Alles andere zählt.
 */
export function auftragFingerprint(auftrag: Auftrag, inhalte: Inhalte): string {
    const schluessel = {
        gebirge: "fixture" in auftrag.gebirge ? { fixture: auftrag.gebirge.fixture } : { datei: true },
        typ: auftrag.typ,
        reglerQuelle: auftrag.reglerQuelle,
        regler: auftrag.regler,
        modell: auftrag.modell,
        saat: auftrag.saat,
        stufe: auftrag.stufe,
        vorschau: auftrag.vorschau,
        endgelaende: auftrag.endgelaende === null ? null : { ...auftrag.endgelaende, schnappschuss: null },
        rezept: auftrag.rezept,
        inhalte,
    };
    return createHash("sha256").update(kanonisch(schluessel)).digest("hex");
}
