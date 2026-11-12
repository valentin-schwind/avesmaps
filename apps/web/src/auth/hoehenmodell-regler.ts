import { GEBIRGS_WERT_GRENZEN, typwertGrenze, type Gebirgstyp, type HoehenmodellTest } from "@avesmaps3d/shared";
import { formatDecimal, t, type MessageKey } from "../i18n/i18n";
import {
    datei,
    gespeichert,
    namen,
    neu,
    text,
    zeile,
    zurueckText,
    type Felder,
    type Tafel,
    type TestWert,
    type TestZeile,
} from "./hoehenmodell-test";
import { leseZahl } from "./wegfindung";

/**
 * Die dreizehn Regler der Gebirgs-Presets von „19 (Test)“ (WI-0249 P8, Neuordnung; Betreiber 2026-10-24, wörtlich: „die gebirgseinstellungen zu
 * haben sind alle super, aber wir sind mit der anzahl überfordert, deswegen bitten wir dich sie für uns zu ändern - oder ggf. zu ergänzen“).
 * Statt 31 Werten je Typ (ein Muster, zehn Werte der V12, zwanzig Typwerte des Rückennetzes) stehen drei Bereiche mit wenigen Reglern da, jeder mit
 * einer Vorschau. Die gespeicherten Felder bleiben dieselben (`p:`, `n:`, `m:` der flachen Tafel, `hoehenmodell-test.ts`); ein Regler, der
 * mehrere zusammenfasst, schreibt sie nach der festen Abbildung unten. Kein neues Datenmodell, keine Migration.
 *
 * **Die Abbildung** (jeder Regler: sein Leitwert, der gelesen und angezeigt wird, und was er sonst noch schreibt):
 *
 * | Regler | Leitwert (gelesen) | schreibt zusätzlich |
 * |---|---|---|
 * | Massigkeit M (0 bis 1) | `p:hypsometrie` = 0,15 + 0,25 · M | `n:band.ziel` = dasselbe; `n:form.talboden` = 0,85 · M |
 * | Kammschärfe | `p:plateau` | `n:form.schaerfe` = dasselbe |
 * | Rückenbreite | `n:form.breite` | – |
 * | Gipfelform | `p:bergform` | – |
 * | Unruhe | `p:rauschen` | `n:form.rauschen` = dasselbe, höchstens 0,5 (sein Höchstwert) |
 * | Körnung | `p:koernung` (Zahl der Erhebungen) | – (der Typwert ist eine Zellweite in E, aus der Zahl und der Länge des Gebirges ergibt sie sich erst dort) |
 * | Grundmuster | `m:<typ>` | – |
 * | Durchhang | `n:form.durchhang` | `n:form.durchhangNeben` = 4/3 davon (so stehen die Presets der Fassung 19) |
 * | Höhe der Nebengipfel (Prominenz) | `n:form.kopf` | – |
 * | Steilheit der Nebengipfel (Neigung) | `n:form.kopfNeigung` | – |
 * | Rinnenerosion (Stufe 0 bis 5) | `p:erosion` | `n:form.erosion` = dasselbe |
 * | Taleinschnitt (Schritt) | `p:einschnitt` | `p:talbreite` = 0,7 + 0,0016 · Einschnitt (halbe Breite in E, auf 0,1 gerundet) |
 * | Erosion im Gelände | `n:form.gelaendeErosion` | – |
 *
 * **Warum diese Zahlen.** Massigkeit: Im Rückennetz leitet das Gelände den Talboden aus dem Ziel der Hypsometrie ab; wirksam ist nur der Bereich 0,15
 * (Talboden 0) bis 0,4 (Talboden 0,85, der höchste, den die Ableitung setzt), darüber deckelt er (P4-Befund 3.2: Blutzinnen 0,2 → 0,17, 0,3 → 0,53, 0,35 → 0,68,
 * 0,4 → 0,85). Die Abbildung legt M auf genau diese Gerade; die grobe Vorschau, die den Talboden direkt rechnet, zeigt damit dasselbe wie das Gelände.
 * Schärfe, Rauschen und Erosion: Das Preset der V12 übersteuert heute den Typwert des Rückennetzes (seit `333e2ac7c`, P4-Befund 4); ein Regler setzt
 * beide gleich, damit sich nichts widerspricht. Durchhang: Nebenkämme hängen in den Presets 4/3 so stark durch wie die Hauptkämme. Taleinschnitt: Tiefe
 * und Breite wachsen zusammen (angepasst an Kamm- und Karstgebirge, 550 → 1,6 und 1.925 → 3,8). Alle Zahlen sind VORSCHLÄGE zur Ansicht.
 *
 * Wer einen der zusammengefassten Werte einzeln braucht, findet ihn unter „Alle Werte (für Feinarbeit)“, unverändert.
 */

export const REGLER_BEREICHE = ["form", "rinnen", "gelaende"] as const;
export type ReglerBereich = (typeof REGLER_BEREICHE)[number];

/** Die Regler in der Folge der Bereiche. */
export const REGLER_FOLGE: Readonly<Record<ReglerBereich, readonly ReglerId[]>> = {
    form: [
        "massigkeit",
        "kammschaerfe",
        "rueckenbreite",
        "gipfelform",
        "unruhe",
        "koernung",
        "muster",
        "durchhang",
        "prominenz",
        "neigung",
    ],
    rinnen: ["rinnen", "taleinschnitt"],
    gelaende: ["gelaendeErosion"],
};

export type ReglerId =
    | "massigkeit"
    | "kammschaerfe"
    | "rueckenbreite"
    | "gipfelform"
    | "unruhe"
    | "koernung"
    | "muster"
    | "durchhang"
    | "prominenz"
    | "neigung"
    | "rinnen"
    | "taleinschnitt"
    | "gelaendeErosion";

export const REGLER_IDS: readonly ReglerId[] = Object.values(REGLER_FOLGE).flat();

/** Der Bereich, in dem man am Wert ziehen darf. */
export interface Zugbereich {
    min: number;
    max: number;
    schritt: number;
}

/** Ein Wert, der unter einem Regler noch einzeln steht, und wohin der Regler ihn setzen würde. */
export interface Begleiter {
    key: string;
    soll: number;
    /** Wie weit der Wert vom Soll abweichen darf, ohne dass es auffällt (halber Schritt der Rundung). */
    toleranz: number;
}

export interface ReglerDef {
    id: ReglerId;
    bereich: ReglerBereich;
    /** Das Grundmuster ist keine Zahl, sondern eine Wahl; sein Regler ist der Segmentschalter. */
    art: "zahl" | "muster";
    zug: Zugbereich;
    /** Wie viele Stellen der Wert im Feld zeigt. */
    dezimalen: number;
    /** Hier steht der Leitwert: von ihm liest der Regler, wohin er steht. */
    leit: (typ: Gebirgstyp) => string;
    /** Der Reglerwert aus dem Leitwert, und zurück. */
    ausLeit: (leit: number) => number;
    inLeit: (wert: number) => number;
    /** Was der Regler sonst noch schreibt (Schlüssel und Soll für diesen Reglerwert). */
    begleiter: (wert: number, typ: Gebirgstyp) => Begleiter[];
    /** Das Preset der V12 übersteuert heute den Typwert des Rückennetzes: Der Regler setzt beide gleich (Vorschlag, für Vali sichtbar markiert). */
    vorschlag: boolean;
}

const runde = (wert: number, stellen: number): number => {
    const f = 10 ** stellen;
    return Math.round(wert * f) / f;
};
const klemme = (wert: number, min: number, max: number): number => Math.max(min, Math.min(max, wert));

const p = (typ: Gebirgstyp, wert: string): string => `p:${typ}:${wert}`;
const n = (typ: Gebirgstyp, id: string): string => `n:${typ}:${id}`;

const zugN = (id: string): Zugbereich => {
    const g = typwertGrenze(id);
    return { min: g?.min ?? 0, max: g?.max ?? 1, schritt: g?.schritt ?? 0.01 };
};
const zugP = (wert: keyof typeof GEBIRGS_WERT_GRENZEN): Zugbereich => {
    const g = GEBIRGS_WERT_GRENZEN[wert];
    return { min: g.min, max: g.max, schritt: g.schritt };
};

/** Massigkeit: Die Hypsometrie wirkt im Rückennetz von 0,15 (Talboden 0) bis 0,4 (Talboden `TALBODEN_MAX`). */
export const MASSIGKEIT_HYPSOMETRIE_AB = 0.15;
export const MASSIGKEIT_HYPSOMETRIE_SPANNE = 0.25;
/** Der höchste Talboden, den die Ableitung setzt (`TALBODEN_GRENZE`, `rechne.ts`). */
export const MASSIGKEIT_TALBODEN_MAX = 0.85;
/** Nebenkämme hängen in den Presets 4/3 so stark durch wie Hauptkämme (0,12 → 0,16 und so fort). */
export const DURCHHANG_NEBEN_FAKTOR = 4 / 3;
/** Taleinschnitt: Die halbe Talbreite (E) wächst mit der Tiefe (Schritt). */
export const TALBREITE_GRUND_E = 0.7;
export const TALBREITE_JE_SCHRITT = 0.0016;

// Auf drei Stellen: Mit zwei Stellen hätte die Hypsometrie nur 25 Stufen, der Regler käme beim Ziehen nicht auf seinen Wert zurück (0,5 → 0,52).
const hypsometrieFuer = (m: number): number => runde(MASSIGKEIT_HYPSOMETRIE_AB + MASSIGKEIT_HYPSOMETRIE_SPANNE * m, 3);

export const REGLER: Readonly<Record<ReglerId, ReglerDef>> = {
    massigkeit: {
        id: "massigkeit",
        bereich: "form",
        art: "zahl",
        zug: { min: 0, max: 1, schritt: 0.01 },
        dezimalen: 2,
        leit: (typ) => p(typ, "hypsometrie"),
        ausLeit: (h) => runde(klemme((h - MASSIGKEIT_HYPSOMETRIE_AB) / MASSIGKEIT_HYPSOMETRIE_SPANNE, 0, 1), 3),
        inLeit: hypsometrieFuer,
        begleiter: (m, typ) => [
            { key: n(typ, "form.talboden"), soll: runde(MASSIGKEIT_TALBODEN_MAX * m, 3), toleranz: 0.03 },
            { key: n(typ, "band.ziel"), soll: hypsometrieFuer(m), toleranz: 0.03 },
        ],
        vorschlag: true,
    },
    kammschaerfe: {
        id: "kammschaerfe",
        bereich: "form",
        art: "zahl",
        zug: zugP("plateau"),
        dezimalen: 2,
        leit: (typ) => p(typ, "plateau"),
        ausLeit: (v) => v,
        inLeit: (v) => v,
        begleiter: (v, typ) => [{ key: n(typ, "form.schaerfe"), soll: v, toleranz: 0.03 }],
        vorschlag: true,
    },
    rueckenbreite: {
        id: "rueckenbreite",
        bereich: "form",
        art: "zahl",
        zug: zugN("form.breite"),
        dezimalen: 2,
        leit: (typ) => n(typ, "form.breite"),
        ausLeit: (v) => v,
        inLeit: (v) => v,
        begleiter: () => [],
        vorschlag: false,
    },
    gipfelform: {
        id: "gipfelform",
        bereich: "form",
        art: "zahl",
        zug: zugP("bergform"),
        dezimalen: 1,
        leit: (typ) => p(typ, "bergform"),
        ausLeit: (v) => v,
        inLeit: (v) => v,
        begleiter: () => [],
        vorschlag: false,
    },
    unruhe: {
        id: "unruhe",
        bereich: "form",
        art: "zahl",
        zug: zugP("rauschen"),
        dezimalen: 2,
        leit: (typ) => p(typ, "rauschen"),
        ausLeit: (v) => v,
        inLeit: (v) => v,
        begleiter: (v, typ) => [
            { key: n(typ, "form.rauschen"), soll: Math.min(v, zugN("form.rauschen").max), toleranz: 0.03 },
        ],
        vorschlag: true,
    },
    koernung: {
        id: "koernung",
        bereich: "form",
        art: "zahl",
        zug: { ...zugP("koernung"), schritt: 0.5 },
        dezimalen: 1,
        leit: (typ) => p(typ, "koernung"),
        ausLeit: (v) => v,
        inLeit: (v) => v,
        begleiter: () => [],
        vorschlag: false,
    },
    muster: {
        id: "muster",
        bereich: "form",
        art: "muster",
        zug: { min: 0, max: 1, schritt: 1 },
        dezimalen: 0,
        leit: (typ) => `m:${typ}`,
        ausLeit: (v) => v,
        inLeit: (v) => v,
        begleiter: () => [],
        vorschlag: false,
    },
    durchhang: {
        id: "durchhang",
        bereich: "form",
        art: "zahl",
        zug: zugN("form.durchhang"),
        dezimalen: 2,
        leit: (typ) => n(typ, "form.durchhang"),
        ausLeit: (v) => v,
        inLeit: (v) => v,
        begleiter: (v, typ) => [
            {
                key: n(typ, "form.durchhangNeben"),
                soll: runde(Math.min(v * DURCHHANG_NEBEN_FAKTOR, zugN("form.durchhangNeben").max), 2),
                toleranz: 0.015,
            },
        ],
        vorschlag: false,
    },
    prominenz: {
        id: "prominenz",
        bereich: "form",
        art: "zahl",
        zug: zugN("form.kopf"),
        dezimalen: 2,
        leit: (typ) => n(typ, "form.kopf"),
        ausLeit: (v) => v,
        inLeit: (v) => v,
        begleiter: () => [],
        vorschlag: false,
    },
    neigung: {
        id: "neigung",
        bereich: "form",
        art: "zahl",
        zug: { min: 0, max: 0.5, schritt: 0.01 },
        dezimalen: 2,
        leit: (typ) => n(typ, "form.kopfNeigung"),
        ausLeit: (v) => v,
        inLeit: (v) => v,
        begleiter: () => [],
        vorschlag: false,
    },
    rinnen: {
        id: "rinnen",
        bereich: "rinnen",
        art: "zahl",
        zug: zugP("erosion"),
        dezimalen: 0,
        leit: (typ) => p(typ, "erosion"),
        ausLeit: (v) => v,
        inLeit: (v) => Math.round(v),
        begleiter: (v, typ) => [{ key: n(typ, "form.erosion"), soll: Math.round(v), toleranz: 0.5 }],
        vorschlag: true,
    },
    taleinschnitt: {
        id: "taleinschnitt",
        bereich: "rinnen",
        art: "zahl",
        zug: zugP("einschnitt"),
        dezimalen: 0,
        leit: (typ) => p(typ, "einschnitt"),
        ausLeit: (v) => v,
        inLeit: (v) => v,
        begleiter: (v, typ) => [
            {
                key: p(typ, "talbreite"),
                soll: klemme(runde(TALBREITE_GRUND_E + TALBREITE_JE_SCHRITT * v, 1), 0.1, zugP("talbreite").max),
                toleranz: 0.2,
            },
        ],
        vorschlag: false,
    },
    gelaendeErosion: {
        id: "gelaendeErosion",
        bereich: "gelaende",
        art: "zahl",
        zug: zugN("form.gelaendeErosion"),
        dezimalen: 2,
        leit: (typ) => n(typ, "form.gelaendeErosion"),
        ausLeit: (v) => v,
        inLeit: (v) => v,
        begleiter: () => [],
        vorschlag: false,
    },
};

// --- Lesen und Schreiben -------------------------------------------------------------------------------------------------------------

/** Der Reglerwert in einer Tafel; `NaN`, wenn der Leitwert fehlt oder das Grundmuster gemeint ist (dort gilt `musterIn`). */
export function reglerWert(def: ReglerDef, tafel: Tafel, typ: Gebirgstyp): number {
    if (def.art === "muster") return tafel.get(def.leit(typ)) === "zellen" ? 1 : 0;
    const roh = tafel.get(def.leit(typ));
    return typeof roh === "number" && Number.isFinite(roh) ? def.ausLeit(roh) : Number.NaN;
}

/** Alle Felder, die dieser Regler schreibt: der Leitwert zuerst, dann die Begleiter. */
export const reglerSchluessel = (def: ReglerDef, typ: Gebirgstyp): string[] => [
    def.leit(typ),
    ...def.begleiter(0, typ).map((b) => b.key),
];

/** Was der Regler bei diesem Wert in die Tafel schreibt (Zahlen; das Grundmuster als Name). */
export function reglerSchreibt(def: ReglerDef, wert: number, typ: Gebirgstyp): Record<string, TestWert> {
    if (def.art === "muster") return { [def.leit(typ)]: wert >= 0.5 ? "zellen" : "rauschen" };
    const geklemmt = klemme(wert, def.zug.min, def.zug.max);
    return {
        [def.leit(typ)]: runde(def.inLeit(geklemmt), 6),
        ...Object.fromEntries(def.begleiter(geklemmt, typ).map((b) => [b.key, runde(b.soll, 6)])),
    };
}

export interface ReglerAbweichung {
    key: string;
    ist: number;
    soll: number;
}

/** Begleiter, die anders stehen, als der Regler sie setzen würde (die Presets führen sie einzeln; ein Zug am Regler setzt sie neu). */
export function reglerAbweichungen(def: ReglerDef, tafel: Tafel, typ: Gebirgstyp): ReglerAbweichung[] {
    const wert = reglerWert(def, tafel, typ);
    if (!Number.isFinite(wert)) return [];
    const aus: ReglerAbweichung[] = [];
    for (const b of def.begleiter(wert, typ)) {
        const ist = tafel.get(b.key);
        if (typeof ist === "number" && Math.abs(ist - b.soll) > b.toleranz) aus.push({ key: b.key, ist, soll: b.soll });
    }
    return aus;
}

/** Ein Wert im Feld: Zahl mit den Stellen des Reglers in der Sprache der Seite. */
export const reglerText = (def: ReglerDef, wert: number): string => formatDecimal(wert, def.dezimalen);

/** Warum ein getippter Reglerwert nicht geht; `undefined`, wenn er geht. */
export function reglerProblem(def: ReglerDef, getippt: string): string | undefined {
    const wert = leseZahl(getippt);
    if (wert === null) return t("admin.terrain.invalid.number");
    if (wert < def.zug.min || wert > def.zug.max)
        return t("admin.terrain.invalid.range", {
            min: formatDecimal(def.zug.min, 4),
            max: formatDecimal(def.zug.max, 4),
        });
    return undefined;
}

/**
 * Die Felder, die nach dem Tippen eines Reglerwerts zu setzen sind (`text` je Schlüssel); leer, wenn der Wert ungültig ist oder
 * dem Reglerwert gleicht, den die Tafel schon führt (dann bliebe sonst jeder Begleiter beim bloßen Anfassen überschrieben).
 */
export function reglerTippt(def: ReglerDef, tafel: Tafel, typ: Gebirgstyp, getippt: string): Record<string, string> {
    if (reglerProblem(def, getippt) !== undefined) return {};
    const wert = leseZahl(getippt)!;
    const jetzt = reglerWert(def, tafel, typ);
    if (Number.isFinite(jetzt) && Math.abs(jetzt - wert) < 10 ** -(def.dezimalen + 1) / 2) return {};
    return Object.fromEntries(
        Object.entries(reglerSchreibt(def, wert, typ)).map(([key, v]) => [
            key,
            typeof v === "string" ? v : formatDecimal(v, 6),
        ]),
    );
}

/** Die Werte, die ↺ einträgt: alle Felder des Reglers zurück auf die Datei. */
export const reglerZurueck = (test: HoehenmodellTest, def: ReglerDef, typ: Gebirgstyp): Record<string, string> =>
    Object.fromEntries(reglerSchluessel(def, typ).map((key) => [key, zurueckText(test, key)]));

// --- Die Zeile ---------------------------------------------------------------------------------------------------------------------

const reglerKey = (def: ReglerDef): string => `regler:${def.id}`;
const nameVon = (id: ReglerId): string => t(`admin.terrain.test.regler.name.${id}` as MessageKey);

/** Die Einheit hinter dem Feld: die Spanne des Reglers, beim Taleinschnitt Schritt, bei den Rinnen die Stufen. */
export function reglerEinheit(def: ReglerDef): string {
    if (def.id === "taleinschnitt") return t("admin.terrain.test.unit.paces");
    const min = formatDecimal(def.zug.min, 2);
    const max = formatDecimal(def.zug.max, 2);
    return t(def.id === "rinnen" ? "admin.terrain.test.unit.level" : "admin.terrain.test.unit.range", { min, max });
}

/** Die Folge einer Änderung: Schreibt der Regler nur Typwerte des Rückennetzes, rechnet nur die Gebirge mit gezeichneten Kämmen neu. */
export const reglerFolge = (def: ReglerDef, typ: Gebirgstyp): string =>
    t(
        reglerSchluessel(def, typ).every((key) => key.startsWith("n:"))
            ? "admin.terrain.test.follows.ridges"
            : "admin.terrain.test.follows.map",
    );

/**
 * Die Zeile eines Zahlenreglers in der Form der Wertzeile (`hoehenmodell-wertzeile.vue`): das Feld zeigt den Reglerwert oder, solange
 * jemand tippt, den getippten Text (`roh`); „geändert“, „abweichend“ und ↺ gelten für alle Felder des Reglers zusammen.
 */
export function reglerZeile(
    test: HoehenmodellTest,
    felder: Felder,
    def: ReglerDef,
    typ: Gebirgstyp,
    roh: string | undefined,
): TestZeile {
    const tafel = neu(test, felder);
    const wert = reglerWert(def, tafel, typ);
    const vorher = reglerWert(def, gespeichert(test), typ);
    const vonDatei = reglerWert(def, datei(test), typ);
    const zeilen = reglerSchluessel(def, typ).map((key) => zeile(test, felder, key));
    // Das getippte Feld bleibt stehen, solange es ungültig ist oder zum Wert passt (höchstens einen Schritt davon); sonst zeigt die Zeile den Wert.
    const getippt = roh === undefined ? null : leseZahl(roh);
    const zeigeRoh = roh !== undefined && (getippt === null || Math.abs(getippt - wert) <= def.zug.schritt);
    const problem = zeigeRoh ? reglerProblem(def, roh) : undefined;
    const geaendert = zeilen.some((z) => z.geaendert);
    const abweichend = problem === undefined && zeilen.some((z) => z.abweichend);
    const dateiText = reglerText(def, vonDatei);
    const name = nameVon(def.id);
    return {
        key: reglerKey(def),
        name,
        lang: `${t(`landschaftseditor.gebirge.typ.${typ}` as MessageKey)} · ${name}`,
        muster: false,
        feld: zeigeRoh ? roh : reglerText(def, wert),
        einheit: reglerEinheit(def),
        satz: t(`admin.terrain.test.regler.satz.${def.id}` as MessageKey),
        folge: reglerFolge(def, typ),
        problem,
        geaendert,
        abweichend,
        statt: geaendert ? t("admin.terrain.test.row.instead", { wert: reglerText(def, vorher) }) : null,
        datei:
            abweichend && (!geaendert || vorher !== vonDatei)
                ? t("admin.terrain.test.row.file", { wert: dateiText })
                : null,
        dateiText,
        ruecksetzbar: !test.gesperrt && (abweichend || problem !== undefined),
    };
}

export interface ReglerHinweis {
    art: "wirkt" | "vorschlag" | "abweichung";
    text: string;
}

/**
 * Die Zeilen unter einem Regler: wo er wirkt, der Vorschlag (V12-Wert und Rückennetz-Typwert gleich gesetzt) und die Einzelwerte, die anders
 * stehen, als der Regler sie setzen würde.
 */
export function reglerHinweise(def: ReglerDef, tafel: Tafel, typ: Gebirgstyp): ReglerHinweis[] {
    const zeilen: ReglerHinweis[] = [
        { art: "wirkt", text: t(`admin.terrain.test.regler.wirkt.${def.id}` as MessageKey) },
    ];
    if (def.vorschlag) zeilen.push({ art: "vorschlag", text: t("admin.terrain.test.regler.vorschlag") });
    const abweichungen = reglerAbweichungen(def, tafel, typ);
    if (abweichungen.length > 0)
        zeilen.push({
            art: "abweichung",
            text: t("admin.terrain.test.regler.abweichung", {
                liste: abweichungen
                    .map((a) =>
                        t("admin.terrain.test.regler.abweichungEintrag", {
                            name: namen(a.key).name,
                            ist: text(a.key, a.ist),
                            soll: text(a.key, a.soll),
                        }),
                    )
                    .join(", "),
            }),
        });
    return zeilen;
}
