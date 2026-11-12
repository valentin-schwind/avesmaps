import {
    GEBIRGS_HOEHENSTUFEN,
    GEBIRGS_KAMMHOEHE,
    GEBIRGS_MUSTER,
    GEBIRGS_WERT_GRENZEN,
    GEBIRGS_WERTE,
    GEBIRGSTYPEN,
    HOEHENMODELL_KATALOG,
    HOEHENMODELL_REGLER,
    katalogWert,
    landschaftsKacheln,
    RUECKENNETZ_TYPWERTE,
    rueckennetzTyp,
    typwert,
    typwertGrenze,
    type AdminHoehenmodell,
    type HoehenmodellBereich,
    type KatalogKachel,
    type KatalogWert,
    type GebirgsPresetGruppe,
    type Gebirgstyp,
    type HoehenmodellTest,
    type HoehenmodellTestWerte,
} from "@avesmaps3d/shared";
import { formatDecimal, t, tPlural, type MessageKey } from "../i18n/i18n";
import { grundProblem } from "./betriebszustand";
import { landschaftName, reglerName } from "./hoehenmodell";
import { leseZahl } from "./wegfindung";

/**
 * Die Werte von „19 (Test)“ in der Systemsteuerung (WI-0240; Betreiber 2026-10-19: „wir ändern eigenschaften von test 19 live auf der
 * stage bis das modell brauchbare ergebnisse liefert“; Entwurf abgenommen mit V1 „Typ wählen“). Was die Oberfläche rechnet, steht hier;
 * wie es aussieht, in `verwaltung-hoehenmodell-test.vue`.
 *
 * - **Eine flache Tafel** je Stand: `r:<regler>`, `p:<typ>:<wert>`, `m:<typ>` (Grundmuster), `n:<typ>:<typwert>` (Rückennetz, WI-0246),
 *   `s:<höhenstufe>`. Gespeichert ist die Datei
 *   mit den Werten darüber (`test.regler`, `test.presets`), die Datei selbst steht daneben (`reglerDatei`, `presetsDatei`).
 * - **Getippt ist nicht gespeichert:** Die Felder halten nur, was jemand gerade ändert. Speichern schickt den ganzen neuen Stand (der Server
 *   streicht, was der Datei gleicht); ↺ an einer Zeile trägt den Wert der Datei ein.
 * - **Ein Auslöser oben** (Hausregel „Seiten mit vielen Einstellungen“): Grund, Verwerfen, Speichern. Speichern rechnet die Karte neu, auch
 *   wenn sich nur Höhenstufen ändern (sie gehören zum Inhalt der Fassung; ohne Lauf gälte der Master als älterer Stand).
 * - **Verlauf** je Revision alt → neu; Zurücknehmen trägt die alten Werte ein, gespeichert wird danach mit Grund.
 */

export type TestWert = number | string;
export type Tafel = ReadonlyMap<string, TestWert>;

const REGLER_EINHEIT: Readonly<Record<string, MessageKey>> = {
    saturation: "admin.terrain.test.unit.perRound",
    iterations: "admin.terrain.test.unit.rounds",
    continentalHeight: "admin.terrain.test.unit.paces",
    detailAmplitude: "admin.terrain.test.unit.paces",
    fineDetailAmplitude: "admin.terrain.test.unit.paces",
    flankGrade: "admin.terrain.test.unit.grade",
    maximumGrade: "admin.terrain.test.unit.grade",
};

/** „Fassung 19 (Test)“ in der Sprache der Seite. */
export const testName = (test: HoehenmodellTest): string =>
    t("admin.terrain.version", { n: t("admin.terrain.test.short", { n: test.version }) });

/** Die Datei des offenen Stands, wie das Repository sie nennt. */
export const dateiName = (version: number): string => `${String(version)}.json`;

/** Die flache Tafel aus Reglern, den übrigen Werten des Katalogs (`w:<pfad>`) und Presets. */
export function flach(
    regler: Readonly<Record<string, number | null>>,
    presets: GebirgsPresetGruppe | null,
    rezept: Readonly<Record<string, number>> = {},
): Tafel {
    const tafel = new Map<string, TestWert>();
    for (const r of HOEHENMODELL_REGLER) {
        const wert = regler[r.id];
        if (wert !== null && wert !== undefined) tafel.set(`r:${r.id}`, wert);
    }
    for (const [pfad, wert] of Object.entries(rezept)) tafel.set(`w:${pfad}`, wert);
    if (presets !== null) {
        for (const typ of GEBIRGSTYPEN) {
            const preset = presets.typen[typ];
            for (const w of GEBIRGS_WERTE) tafel.set(`p:${typ}:${w}`, preset.werte[w]);
            tafel.set(`m:${typ}`, preset.muster);
            const rueckennetz = rueckennetzTyp(presets, typ);
            for (const { id } of RUECKENNETZ_TYPWERTE) tafel.set(`n:${typ}:${id}`, typwert(rueckennetz, id));
        }
        for (const s of GEBIRGS_HOEHENSTUFEN) tafel.set(`s:${s}`, presets.hoehenstufen[s]);
    }
    return tafel;
}

/** Die Datei mit Werten darüber (für den Verlauf: davor und danach). */
export function mitWerten(datei: Tafel, werte: HoehenmodellTestWerte): Tafel {
    const tafel = new Map(datei);
    for (const [id, wert] of Object.entries(werte.regler ?? {})) tafel.set(`r:${id}`, wert);
    for (const [pfad, wert] of Object.entries(werte.rezept ?? {})) tafel.set(`w:${pfad}`, wert);
    for (const [typ, preset] of Object.entries(werte.presets?.typen ?? {})) {
        for (const [w, wert] of Object.entries(preset.werte ?? {})) tafel.set(`p:${typ}:${w}`, wert);
        if (preset.muster !== undefined) tafel.set(`m:${typ}`, preset.muster);
        for (const [id, wert] of Object.entries(preset.rueckennetz ?? {})) tafel.set(`n:${typ}:${id}`, wert);
    }
    for (const [s, wert] of Object.entries(werte.presets?.hoehenstufen ?? {})) tafel.set(`s:${s}`, wert);
    return tafel;
}

/** Was von der Datei abweicht, als Werte für den Server. */
export function werteAus(tafel: Tafel, datei: Tafel): HoehenmodellTestWerte {
    const regler: Record<string, number> = {};
    const rezept: Record<string, number> = {};
    const typen: Record<
        string,
        {
            werte?: Record<string, number>;
            muster?: (typeof GEBIRGS_MUSTER)[number];
            rueckennetz?: Record<string, number>;
        }
    > = {};
    const hoehenstufen: Record<string, number> = {};
    for (const [key, wert] of tafel) {
        if (datei.get(key) === wert) continue;
        const [art, a, b] = key.split(":") as [string, string, string | undefined];
        if (art === "r" && typeof wert === "number") regler[a] = wert;
        else if (art === "w" && typeof wert === "number") rezept[a] = wert;
        else if (art === "p" && typeof wert === "number" && b !== undefined)
            (typen[a] ??= {}).werte = { ...typen[a]?.werte, [b]: wert };
        else if (art === "n" && typeof wert === "number" && b !== undefined)
            (typen[a] ??= {}).rueckennetz = { ...typen[a]?.rueckennetz, [b]: wert };
        else if (art === "m" && typeof wert === "string")
            (typen[a] ??= {}).muster = wert as (typeof GEBIRGS_MUSTER)[number];
        else if (art === "s" && typeof wert === "number") hoehenstufen[a] = wert;
    }
    const presets = {
        ...(Object.keys(typen).length > 0 ? { typen } : {}),
        ...(Object.keys(hoehenstufen).length > 0 ? { hoehenstufen } : {}),
    };
    return {
        ...(Object.keys(regler).length > 0 ? { regler } : {}),
        ...(Object.keys(rezept).length > 0 ? { rezept } : {}),
        ...(Object.keys(presets).length > 0 ? { presets } : {}),
    };
}

export const gespeichert = (test: HoehenmodellTest): Tafel => flach(test.regler, test.presets, test.rezept);
export const datei = (test: HoehenmodellTest): Tafel => flach(test.reglerDatei, test.presetsDatei, test.rezeptDatei);

// --- Namen, Sätze, Grenzen -----------------------------------------------------------------------------------------------------------

const teile = (key: string): [string, string, string] => {
    const [art = "", a = "", b = ""] = key.split(":");
    return [art, a, b];
};

/** Name und Satz eines Katalogwerts: Landschaftsfelder und Bruchstücke je Feld, Spannen (min–max) je Grundwert mit „von“/„bis“. */
function katalogText(pfad: string): { name: string; satz: string } {
    const teil = pfad.split(".");
    if (teil[0] === "topographie" || teil[0] === "vegetation") {
        const feld = teil.slice(2).join(".");
        return {
            name: t(`admin.terrain.test.lw.${feld}` as MessageKey),
            satz: t(`admin.terrain.test.lwSatz.${feld}` as MessageKey),
        };
    }
    const bruch = pfad.match(/^mountainMorphology.(?:interior.)?fragments.(.+)$/u);
    if (bruch) {
        return {
            name: t(`admin.terrain.test.fragment.${bruch[1]!}` as MessageKey),
            satz: t(`admin.terrain.test.fragmentSatz.${bruch[1]!}` as MessageKey),
        };
    }
    const spanne = pfad.match(/^(.+.(?:summit|volcano).[^.]+).(minimum|maximum)$/u);
    if (spanne) {
        const ende = t(spanne[2] === "minimum" ? "admin.terrain.test.von" : "admin.terrain.test.bis");
        return {
            name: `${t(`admin.terrain.test.w.${spanne[1]!}` as MessageKey)} · ${ende}`,
            satz: t(`admin.terrain.test.wSatz.${spanne[1]!}` as MessageKey),
        };
    }
    return {
        name: t(`admin.terrain.test.w.${pfad}` as MessageKey),
        satz: t(`admin.terrain.test.wSatz.${pfad}` as MessageKey),
    };
}

/** Die Kachel, in der ein Pfad steht (für den langen Namen in Verlauf und Vorleser). */
function kachelVon(pfad: string): string {
    const teil = pfad.split(".");
    if (teil[0] === "topographie" || teil[0] === "vegetation") return landschaftName(teil[1]!);
    for (const [bereich, kacheln] of Object.entries(HOEHENMODELL_KATALOG))
        for (const kachel of kacheln)
            if (kachel.werte.some((w) => w.pfad === pfad)) return kachelName(bereich as HoehenmodellBereich, kachel.id);
    return "";
}
const typName = (typ: string): string => t(`landschaftseditor.gebirge.typ.${typ}` as MessageKey);
/**
 * Zwei Werte der V12 bedeuten mit und ohne gezeichnete Kämme etwas anderes (P4-Befund 3 bis 5): `plateau` ist ohne Kämme der Anteil der
 * Hochfläche, mit ihnen die Kammschärfe; `bergform` ist ohne Kämme der Radius der Gipfelkegel, mit ihnen die Spitze des Rückens. In der Liste
 * der Feinarbeit tragen sie beide Namen (der Reiter „Gebirge“ des Landschaftseditors behält seinen). Die Hypsometrie heißt dort Massigkeit wie der
 * Regler oben, hat aber eine andere Skala (0 bis 0,7 gegen 0 bis 1): Sie heißt hier, was sie ist.
 */
const DOPPELT = new Set(["plateau", "bergform", "hypsometrie"]);
const wertName = (wert: string): string =>
    DOPPELT.has(wert)
        ? t(`admin.terrain.test.regler.fein.${wert}` as MessageKey)
        : t(`landschaftseditor.gebirge.wert.${wert}` as MessageKey);
const stufeName = (stufe: string): string => t(`landschaftseditor.gebirge.stufe.${stufe}` as MessageKey);

/** Der Name in der Zeile („Taltiefe“) und der lange Name für Verlauf und Vorleser („Kammgebirge · Taltiefe“). */
export function namen(key: string): { name: string; lang: string } {
    const [art, a, b] = teile(key);
    if (art === "r") return { name: reglerName(a), lang: reglerName(a) };
    if (art === "w") {
        const name = katalogText(a).name;
        const kachel = kachelVon(a);
        return { name, lang: kachel === "" ? name : `${kachel} · ${name}` };
    }
    if (art === "p") return { name: wertName(b), lang: `${typName(a)} · ${wertName(b)}` };
    if (art === "n") {
        const name = t(`admin.terrain.test.rueckennetz.wert.${b}` as MessageKey);
        return { name, lang: `${typName(a)} · ${name}` };
    }
    if (art === "m") {
        const name = t("landschaftseditor.gebirge.muster.titel");
        return { name, lang: `${typName(a)} · ${name}` };
    }
    return { name: stufeName(a), lang: t("admin.terrain.test.level.long", { stufe: stufeName(a) }) };
}

export function grenze(key: string): { min: number; max: number | null; ganz: boolean } {
    const [art, a, b] = teile(key);
    if (art === "r") {
        const r = HOEHENMODELL_REGLER.find((entry) => entry.id === a);
        return { min: r?.min ?? 0, max: r?.max ?? null, ganz: r?.ganz ?? false };
    }
    if (art === "p") {
        const g = GEBIRGS_WERT_GRENZEN[b as keyof typeof GEBIRGS_WERT_GRENZEN];
        return { min: g.min, max: g.max, ganz: g.schritt === 1 };
    }
    if (art === "n") {
        const g = typwertGrenze(b);
        return { min: g?.min ?? 0, max: g?.max ?? null, ganz: g?.schritt === 1 };
    }
    if (art === "w") {
        const g = katalogWert(a);
        return { min: g?.min ?? 0, max: g?.max ?? null, ganz: g?.ganz ?? false };
    }
    return { min: GEBIRGS_KAMMHOEHE.min, max: GEBIRGS_KAMMHOEHE.max, ganz: false };
}

/** Was hinter dem Feld steht: Einheit oder Spanne. Der Radius nennt seine Meilen (1 E = 3 Meilen). */
export function einheit(key: string, wert: TestWert | undefined): string {
    const [art, a, b] = teile(key);
    if (art === "r") {
        if (a === "radius")
            return typeof wert === "number"
                ? t("admin.terrain.test.unit.radius", { n: formatDecimal(wert * 3, 2) })
                : t("admin.terrain.test.unit.e");
        const k = REGLER_EINHEIT[a];
        return k === undefined ? "" : t(k);
    }
    if (art === "s") return t("admin.terrain.test.unit.paces");
    if (art === "w") {
        const g = katalogWert(a);
        return g === undefined || g.max === null
            ? ""
            : t("admin.terrain.test.unit.range", { min: formatDecimal(g.min, 2), max: formatDecimal(g.max, 2) });
    }
    if (art === "n") {
        const g = typwertGrenze(b);
        return g === undefined
            ? ""
            : t("admin.terrain.test.unit.range", { min: formatDecimal(g.min, 2), max: formatDecimal(g.max, 2) });
    }
    if (art !== "p") return "";
    if (b === "einschnitt") return t("admin.terrain.test.unit.paces");
    if (b === "talbreite") return t("admin.terrain.test.unit.e");
    const g = GEBIRGS_WERT_GRENZEN[b as keyof typeof GEBIRGS_WERT_GRENZEN];
    return t(b === "erosion" ? "admin.terrain.test.unit.level" : "admin.terrain.test.unit.range", {
        min: formatDecimal(g.min, 2),
        max: formatDecimal(g.max, 2),
    });
}

/** Der Satz unter der Zeile und seine Folge. */
export function satz(key: string): string {
    const [art, a, b] = teile(key);
    if (art === "r") return t(`admin.terrain.test.reglerSatz.${a}` as MessageKey);
    if (art === "w") return katalogText(a).satz;
    // Jeder Wert hat seinen Satz in Alltagssprache, in dieser Ansicht eigens geschrieben (nicht die kurze Zeile des Reiters „Gebirge“).
    if (art === "p") return t(`admin.terrain.test.wert.p.${b}` as MessageKey);
    if (art === "m") return t("landschaftseditor.gebirge.muster.satz");
    if (art === "n") return t(`admin.terrain.test.wert.n.${b}` as MessageKey);
    return t("admin.terrain.test.level.satz", { stufe: stufeName(a) });
}

export const folge = (key: string): string =>
    t(
        key.startsWith("s:")
            ? "admin.terrain.test.follows.level"
            : key.startsWith("n:")
              ? "admin.terrain.test.follows.ridges"
              : "admin.terrain.test.follows.map",
    );

/** Ein Wert, wie er dasteht: Zahl in der Sprache der Seite, Muster mit Namen. */
export function text(key: string, wert: TestWert | undefined): string {
    if (wert === undefined) return "–";
    if (typeof wert === "string") return t(`landschaftseditor.gebirge.muster.${wert}` as MessageKey);
    return formatDecimal(wert, 6);
}

/** Warum ein getippter Wert nicht geht; `undefined`, wenn er geht. */
export function problem(key: string, getippt: string): string | undefined {
    if (key.startsWith("m:")) return undefined;
    const wert = leseZahl(getippt);
    if (wert === null) return t("admin.terrain.invalid.number");
    const g = grenze(key);
    if (g.ganz && !Number.isInteger(wert)) return t("admin.terrain.invalid.whole");
    if (wert < g.min || (g.max !== null && wert > g.max))
        return g.max === null
            ? t("admin.terrain.invalid.min", { min: formatDecimal(g.min, 4) })
            : t("admin.terrain.invalid.range", { min: formatDecimal(g.min, 4), max: formatDecimal(g.max, 4) });
    return undefined;
}

// --- Die Felder ----------------------------------------------------------------------------------------------------------------------

/** Was gerade getippt ist, je Schlüssel; ein Muster als sein Name (`rauschen`). */
export type Felder = Readonly<Record<string, string>>;

const getippt = (key: string, felder: Felder): TestWert | null | undefined => {
    const roh = felder[key];
    if (roh === undefined) return undefined;
    if (key.startsWith("m:")) return roh;
    return problem(key, roh) === undefined ? leseZahl(roh) : null;
};

/** Der Stand nach den Feldern: gespeichert, darüber, was getippt und gültig ist. */
export function neu(test: HoehenmodellTest, felder: Felder): Tafel {
    const tafel = new Map(gespeichert(test));
    for (const key of Object.keys(felder)) {
        const wert = getippt(key, felder);
        if (wert !== undefined && wert !== null) tafel.set(key, wert);
    }
    return tafel;
}

/** Die Schlüssel mit einer gültigen Änderung gegen den gespeicherten Stand. */
export function offen(test: HoehenmodellTest, felder: Felder): string[] {
    const vorher = gespeichert(test);
    return Object.keys(felder).filter((key) => {
        const wert = getippt(key, felder);
        return wert !== undefined && wert !== null && wert !== vorher.get(key);
    });
}

export const fehlerhaft = (felder: Felder): string[] =>
    Object.keys(felder).filter((key) => getippt(key, felder) === null);

/** Was im Feld steht, wenn niemand tippt: der gespeicherte Wert. */
export const feldText = (test: HoehenmodellTest, felder: Felder, key: string): string =>
    felder[key] ?? text(key, gespeichert(test).get(key));

/** Der Wert, den ↺ einträgt: der der Datei (als Text im Feld; ein Muster als Name). */
export function zurueckText(test: HoehenmodellTest, key: string): string {
    const wert = datei(test).get(key);
    return typeof wert === "string" ? wert : text(key, wert);
}

export interface TestZeile {
    key: string;
    name: string;
    lang: string;
    muster: boolean;
    feld: string;
    einheit: string;
    satz: string;
    folge: string;
    problem: string | undefined;
    /** Gültig geändert, noch nicht gespeichert. */
    geaendert: boolean;
    /** Der Wert (getippt oder gespeichert) weicht von der Datei ab. */
    abweichend: boolean;
    /** „statt 0,08“: der gespeicherte Wert, wenn getippt und gültig. */
    statt: string | null;
    /** „Datei: 0,015“: wo der Wert von der Datei abweicht (und, wenn getippt, auch der gespeicherte anders ist). */
    datei: string | null;
    dateiText: string;
    ruecksetzbar: boolean;
}

export function zeile(test: HoehenmodellTest, felder: Felder, key: string): TestZeile {
    const vorher = gespeichert(test).get(key);
    const vonDatei = datei(test).get(key);
    const roh = felder[key];
    const wert = getippt(key, felder);
    const fehler = roh === undefined ? undefined : problem(key, roh);
    const jetzt = wert === undefined ? vorher : wert;
    const geaendert = wert !== undefined && wert !== null && wert !== vorher;
    const abweichend = fehler === undefined && jetzt !== null && jetzt !== undefined && jetzt !== vonDatei;
    const dateiText = text(key, vonDatei);
    const n = namen(key);
    return {
        key,
        name: n.name,
        lang: n.lang,
        muster: key.startsWith("m:"),
        // Das Grundmuster wählt im Segmentschalter nach seinem Wert (`rauschen`), nicht nach dem Namen.
        feld: key.startsWith("m:") ? (felder[key] ?? String(vorher ?? "")) : feldText(test, felder, key),
        einheit: einheit(key, jetzt ?? vorher),
        satz: satz(key),
        folge: folge(key),
        problem: fehler,
        geaendert,
        abweichend,
        statt: geaendert ? t("admin.terrain.test.row.instead", { wert: text(key, vorher) }) : null,
        datei:
            abweichend && (!geaendert || vorher !== vonDatei)
                ? t("admin.terrain.test.row.file", { wert: dateiText })
                : null,
        dateiText,
        ruecksetzbar: !test.gesperrt && (abweichend || fehler !== undefined),
    };
}

// --- Panele ----------------------------------------------------------------------------------------------------------------------------

export type PanelEintrag = { abschnitt: string } | { key: string };

export interface TestPanel {
    id: string;
    titel: string;
    wirkung: string;
    eintraege: PanelEintrag[];
}

// --- Bereiche mit Kacheln (Betreiber 2026-10-20: „selbes tab-layout wie bei den gebirgspresets - wenn schon dann richtig“) -------------

/** Der Name einer Kachel: Landschaften nach ihrer Art, sonst aus der Tafel. */
export const kachelName = (bereich: HoehenmodellBereich, id: string): string =>
    bereich === "landschaften"
        ? landschaftName(id.split(".")[1] ?? id)
        : t(`admin.terrain.test.kachel.${bereich}.${id}` as MessageKey);

const kachelSatz = (bereich: HoehenmodellBereich, id: string): string =>
    bereich === "landschaften"
        ? t("admin.terrain.test.kachelSatz.landschaft", { art: landschaftName(id.split(".")[1] ?? id) })
        : t(`admin.terrain.test.kachelSatz.${bereich}.${id}` as MessageKey);

/** Der Schlüssel eines Katalogwerts in der Tafel: ein Regler als `r:<id>`, alles andere als `w:<pfad>`. */
export const schluesselVon = (wert: KatalogWert): string =>
    wert.regler !== undefined ? `r:${wert.regler}` : `w:${wert.pfad}`;

/** Die Kacheln eines Bereichs mit den Werten, die die Fassung führt (ohne regionale Rückverteilung fallen Radius und Sättigung weg). */
export function bereichKacheln(test: HoehenmodellTest, bereich: HoehenmodellBereich): KatalogKachel[] {
    const roh = bereich === "landschaften" ? landschaftsKacheln(test.rezeptDatei) : HOEHENMODELL_KATALOG[bereich];
    return roh
        .map((kachel) => ({
            id: kachel.id,
            werte: kachel.werte.filter((w) =>
                w.regler !== undefined ? test.reglerDatei[w.regler] != null : w.pfad in test.rezeptDatei,
            ),
        }))
        .filter((kachel) => kachel.werte.length > 0);
}

export interface BereichKarte {
    id: HoehenmodellBereich;
    titel: string;
    wirkung: string;
    kacheln: { id: string; name: string; titel: string; marke: string | null; offen: boolean }[];
    /** Die gewählte Kachel (sonst die erste) mit ihrem Satz und ihren Werten. */
    gewaehlt: string;
    satz: string;
    keys: string[];
}

/** Eine Karte je Bereich: Kacheln mit der Zahl geänderter oder abweichender Werte, darunter die Werte der gewählten Kachel. */
export function bereichKarte(
    test: HoehenmodellTest,
    felder: Felder,
    bereich: HoehenmodellBereich,
    wahl: string | undefined,
): BereichKarte {
    const alle = bereichKacheln(test, bereich);
    const gewaehlt = alle.find((kachel) => kachel.id === wahl)?.id ?? alle[0]?.id ?? "";
    return {
        id: bereich,
        titel: t(`admin.terrain.test.bereich.${bereich}` as MessageKey),
        wirkung: t(`admin.terrain.test.bereichWirkung.${bereich}` as MessageKey),
        kacheln: alle.map((kachel) => {
            const keys = kachel.werte.map(schluesselVon);
            const geaendert = keys.filter((key) => zeile(test, felder, key).geaendert).length;
            const abweichend = keys.filter((key) => zeile(test, felder, key).abweichend).length;
            return {
                id: kachel.id,
                name: kachelName(bereich, kachel.id),
                titel: kachelSatz(bereich, kachel.id),
                marke:
                    geaendert > 0
                        ? t("admin.terrain.test.presets.changed", { n: geaendert })
                        : abweichend > 0
                          ? t("admin.terrain.test.presets.deviating", { n: abweichend })
                          : null,
                offen: geaendert > 0,
            };
        }),
        gewaehlt,
        satz: gewaehlt === "" ? "" : kachelSatz(bereich, gewaehlt),
        keys: (alle.find((kachel) => kachel.id === gewaehlt)?.werte ?? []).map(schluesselVon),
    };
}

export const stufenPanel = (): TestPanel => ({
    id: "stufen",
    titel: t("admin.terrain.test.panel.levels"),
    wirkung: t("admin.terrain.test.panel.levelsWhen"),
    eintraege: GEBIRGS_HOEHENSTUFEN.map((s) => ({ key: `s:${s}` })),
});

const rueckennetzSchluessel = (typ: string): string[] => RUECKENNETZ_TYPWERTE.map(({ id }) => `n:${typ}:${id}`);
const typSchluessel = (typ: string): string[] => [
    ...GEBIRGS_WERTE.map((w) => `p:${typ}:${w}`),
    `m:${typ}`,
    ...rueckennetzSchluessel(typ),
];

/** Die Kacheln der Gebirgstypen mit der Zahl geänderter oder abweichender Werte. */
export function kacheln(
    test: HoehenmodellTest,
    felder: Felder,
): { typ: Gebirgstyp; name: string; titel: string; marke: string | null; offen: boolean }[] {
    return GEBIRGSTYPEN.map((typ) => {
        const keys = typSchluessel(typ);
        const geaendert = keys.filter((key) => zeile(test, felder, key).geaendert).length;
        const abweichend = keys.filter((key) => zeile(test, felder, key).abweichend).length;
        return {
            typ,
            name: typName(typ),
            titel: `${typName(typ)}: ${t(`landschaftseditor.gebirge.satz.${typ}` as MessageKey)}`,
            marke:
                geaendert > 0
                    ? t("admin.terrain.test.presets.changed", { n: geaendert })
                    : abweichend > 0
                      ? t("admin.terrain.test.presets.deviating", { n: abweichend })
                      : null,
            offen: geaendert > 0,
        };
    });
}

/** Die Werte eines Typs: das Grundmuster, die starken Werte, dann die Feinabstimmung. */
export function typWerte(
    test: HoehenmodellTest,
    felder: Felder,
    typ: Gebirgstyp,
): { titel: string; hinweis: string; form: string[]; fein: string[]; rueckennetz: string[] } {
    const abweichend = typSchluessel(typ).filter((key) => zeile(test, felder, key).abweichend).length;
    const gruppe = (g: "form" | "fein") =>
        GEBIRGS_WERTE.filter((w) => GEBIRGS_WERT_GRENZEN[w].gruppe === g).map((w) => `p:${typ}:${w}`);
    return {
        titel:
            abweichend === 0
                ? t("admin.terrain.test.presets.values", { typ: typName(typ) })
                : t("admin.terrain.test.presets.valuesDeviating", { typ: typName(typ), n: abweichend }),
        hinweis: t("landschaftseditor.gebirge.typ.hinweis", {
            typ: typName(typ),
            satz: t(`landschaftseditor.gebirge.satz.${typ}` as MessageKey),
        }),
        form: [`m:${typ}`, ...gruppe("form")],
        fein: gruppe("fein"),
        rueckennetz: rueckennetzSchluessel(typ),
    };
}

// --- Die Leiste oben ---------------------------------------------------------------------------------------------------------------------

export interface TestLeiste {
    /** Die Sätze untereinander, der erste ist der Zustand. */
    saetze: string[];
    /** Der erste Satz in Akzentfarbe (ungespeichert). */
    offen: boolean;
    /** Grund und Verwerfen zeigen (es gibt etwas zu speichern oder zu richten). */
    formular: boolean;
    /** Warum Speichern ruht; `undefined`, wenn es geht. */
    sperre: string | undefined;
    gesperrt: boolean;
}

/** Die Leiste: Zustand links, der EINE Auslöser rechts. `kette` ist der Satz der laufenden Kette (`ketteSatz`), falls es eine gibt. */
export function leiste(
    stand: AdminHoehenmodell,
    test: HoehenmodellTest,
    felder: Felder,
    grund: string,
    kette: string | null,
    zeit: (iso: string) => string,
): TestLeiste {
    const name = testName(test);
    const file = dateiName(test.version);
    const ueber = [...gespeichert(test)].filter(([key, wert]) => datei(test).get(key) !== wert).length;
    const abweichSatz =
        ueber === 0
            ? t("admin.terrain.test.bar.fileOnly", { datei: file })
            : tPlural("admin.terrain.test.bar.deviating", ueber, { n: ueber, datei: file });
    if (test.gesperrt) {
        const abnahme = stand.fassungen.find((entry) => entry.version === test.version)?.abnahme ?? null;
        return {
            saetze: [
                t("admin.terrain.test.bar.locked"),
                [
                    abnahme === null ? null : t("admin.terrain.acceptedAt", { time: zeit(abnahme.am) }),
                    abnahme?.wer ?? null,
                    abnahme?.grund == null ? null : t("admin.system.quoted", { text: abnahme.grund }),
                    t("admin.terrain.test.revision", { r: test.revision }),
                ]
                    .filter((part): part is string => part !== null)
                    .join(" · "),
                t("admin.terrain.test.bar.testStays", { datei: file }),
            ],
            offen: false,
            formular: false,
            sperre: "",
            gesperrt: true,
        };
    }
    const n = offen(test, felder).length;
    const f = fehlerhaft(felder).length;
    const saetze: string[] = [];
    if (n > 0 || f > 0) {
        saetze.push(
            [
                tPlural("admin.terrain.test.bar.unsaved", n, { n }),
                f > 0 ? t("admin.terrain.test.bar.invalid", { n: f }) : null,
                // Nur Typwerte des Rückennetzes: Sie rechnen allein Gebirge mit gezeichneten Kämmen neu (WI-0246).
                offen(test, felder).every((key) => key.startsWith("n:"))
                    ? t("admin.terrain.test.bar.recomputesRidges")
                    : t("admin.terrain.test.bar.recomputes"),
            ]
                .filter((part): part is string => part !== null)
                .join(" · "),
            test.revision === 0
                ? t("admin.terrain.test.bar.untilFile", { datei: file })
                : t("admin.terrain.test.bar.until", { r: test.revision }),
        );
        if (kette !== null) saetze.push(kette);
    } else if (test.revision === 0) {
        saetze.push(t("admin.terrain.test.bar.nothingSaved", { datei: file }));
    } else {
        const gewaehlt = stand.eingestellt.version === test.version;
        const folgeSatz = !gewaehlt
            ? t("admin.terrain.test.bar.notActive", { name })
            : kette !== null
              ? kette
              : test.gerechnet === test.revision
                ? t("admin.terrain.test.bar.computed")
                : t("admin.terrain.test.bar.otherState");
        saetze.push(`${t("admin.terrain.test.bar.saved", { r: test.revision })} · ${folgeSatz}`);
        const wann = [
            test.geaendertAm === null ? null : zeit(test.geaendertAm),
            test.wer,
            test.grund === null ? null : t("admin.system.quoted", { text: test.grund }),
        ].filter((part): part is string => part !== null && part !== "");
        if (wann.length > 0) saetze.push(wann.join(" · "));
    }
    // Ohne gespeicherte Werte sagt der erste Satz schon, dass die Datei gilt.
    if (test.revision > 0 || ueber > 0) saetze.push(abweichSatz);
    const fehltGrund = grundProblem(grund, true);
    return {
        saetze,
        offen: n > 0 || f > 0,
        formular: n > 0 || f > 0,
        sperre:
            n === 0 && f === 0
                ? t("admin.terrain.test.bar.nothing")
                : f > 0
                  ? t("admin.terrain.invalid.fix")
                  : fehltGrund === undefined
                    ? undefined
                    : t(fehltGrund),
        gesperrt: false,
    };
}

/** Die Unterzeile der offenen Fassung in der Liste: Revision und wie viele Werte über der Datei liegen. */
export function testUnter(test: HoehenmodellTest): string {
    if (test.revision === 0) return t("admin.terrain.test.underFile");
    const n = [...gespeichert(test)].filter(([key, wert]) => datei(test).get(key) !== wert).length;
    return tPlural("admin.terrain.test.under", n, { n, r: test.revision });
}

/** Warum „Abnehmen“ an der offenen Fassung ruht: Ungespeichertes, oder die Kette rechnet noch mit ihr. */
export function abnehmenSperre(stand: AdminHoehenmodell, felder: Felder): string | undefined {
    const test = stand.test;
    if (test === undefined) return undefined;
    if (offen(test, felder).length > 0 || fehlerhaft(felder).length > 0) return t("admin.terrain.test.acceptUnsaved");
    if (stand.kette !== null && stand.eingestellt.version === test.version)
        return t("admin.terrain.test.acceptWaits", { r: test.revision });
    return undefined;
}

// --- Verlauf -------------------------------------------------------------------------------------------------------------------------

export interface VerlaufEintrag {
    revision: number;
    kopf: string;
    unter: string;
    aenderungen: { key: string; name: string; alt: string; neu: string }[];
    /** Was seither geändert wurde und das Zurücknehmen verhindert; leer: geht. */
    konflikt: string[];
    /** Die Werte, die Zurücknehmen einträgt (Text im Feld). */
    zurueck: Record<string, string>;
}

export function verlauf(test: HoehenmodellTest, zeit: (iso: string) => string): VerlaufEintrag[] {
    const basis = datei(test);
    const geaendert = (e: HoehenmodellTest["verlauf"][number]): string[] => {
        const vorher = mitWerten(basis, e.vorher);
        const nachher = mitWerten(basis, e.werte);
        return [...nachher.keys()].filter((key) => vorher.get(key) !== nachher.get(key));
    };
    return test.verlauf.map((e) => {
        const vorher = mitWerten(basis, e.vorher);
        const nachher = mitWerten(basis, e.werte);
        const keys = geaendert(e);
        const spaeter = new Set(test.verlauf.filter((x) => x.revision > e.revision).flatMap(geaendert));
        return {
            revision: e.revision,
            kopf:
                e.grund === null
                    ? t("admin.terrain.test.revision", { r: e.revision })
                    : t("admin.terrain.test.history.entry", { r: e.revision, grund: e.grund }),
            unter: [zeit(e.am), e.wer].filter((part): part is string => part !== null && part !== "").join(" · "),
            aenderungen: keys.map((key) => ({
                key,
                name: namen(key).lang,
                alt: text(key, vorher.get(key)),
                neu: text(key, nachher.get(key)),
            })),
            konflikt: keys.filter((key) => spaeter.has(key)).map((key) => namen(key).lang),
            zurueck: Object.fromEntries(
                keys.map((key) => {
                    const alt = vorher.get(key);
                    return [key, typeof alt === "string" ? alt : text(key, alt)];
                }),
            ),
        };
    });
}
