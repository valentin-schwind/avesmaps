import { GEBIRGS_WERT_GRENZEN, typwertGrenze, type Gebirgstyp, type HoehenmodellTest } from "@avesmaps3d/shared";
import { formatDecimal, t, type MessageKey } from "../i18n/i18n";
import {
    MASSIGKEIT_TALBODEN_MAX,
    reglerSchreibt,
    reglerWert,
    TALBREITE_GRUND_E,
    TALBREITE_JE_SCHRITT,
    type ReglerDef,
    type ReglerId,
    type Zugbereich,
} from "./hoehenmodell-regler";
import { datei, neu, type Tafel, type TestWert } from "./hoehenmodell-test";
import {
    schemaAeste,
    schemaFlanke,
    schemaKamm,
    schemaQuer,
    schemaRand,
    schemaSattel,
    schemaWelle,
    type FormParameter,
} from "./hoehenmodell-vorschau-form";
import {
    kopfRadiusE,
    schemaDiffusion,
    schemaDurchhang,
    schemaErhalt,
    schemaErosion,
    schemaHuegel,
    schemaKopf,
    schemaRinnen,
    schemaTal,
    type HuegelRezept,
    type SchemaFigur,
} from "./hoehenmodell-vorschau-schema";

/**
 * Die Vorschau neben den Werten von „19 (Test)“ (WI-0249; Betreiber 2026-10-23, wörtlich: „bei den einstellungen war die frage ob ein
 * preview einer gebirgsfunktion oder eines schematas […] neben den entsprechenden einstellungen besser visualisieren und anzeigen könnte, was
 * die einstellungen bewirken“; 2026-10-24: „ich glaub die editoren wollen doch nur ‚Schema‘. direkt den slider im schema wirken zu sehen ist
 * außerordentlich hilfreich“ – darum ein Schema, keine Mini-Rechnung). Dies ist ein Entwurf zum Ausprobieren im Panel „19 (Test)“: Er ersetzt
 * keine Erklärung unter der Zeile, er kommt dazu.
 *
 * Was die Vorschau für einen Wert braucht, steht hier rein: der Bereich, in dem man am Wert ziehen darf, das Schema dazu (dieselben Formeln wie
 * die Rechnung, im Eindimensionalen; sonst ehrlich vereinfacht) und der Satz in Alltagssprache. Die Vorschauen der dreizehn Regler der
 * Gebirgs-Presets (`hoehenmodell-regler.ts`) entstehen in `vorschauFuerRegler`, die jedes einzelnen Werts (Liste der Feinarbeit, Ausgleich der
 * Hänge, Hügel) in `vorschauFuerWert`. Gezeichnet wird in `hoehenmodell-vorschau.vue`, die Zeichnungen stehen in `…-schema.ts` und `…-form.ts`.
 */

export interface VorschauModell {
    /** Kennung für die Prüfkennungen der Zeichnung: der Schlüssel des Werts, bei einem Regler `regler:<id>`. */
    key: string;
    /** Der Name des Werts für Vorleser („Kettengebirge · Durchhang der Hauptkämme“). */
    name: string;
    /** Der Wert jetzt (getippt und gültig, sonst gespeichert). */
    wert: number;
    /** Der Wert der Datei, für die Marke am Regler. */
    datei: number | null;
    /** Der Zugbereich des Reglers unter der Zeichnung; `null` bei einer Wahl (Grundmuster), die keinen Schieber hat. */
    zug: Zugbereich | null;
    /** Das Schema für diesen Wert. */
    schema: (wert: number) => SchemaFigur;
    /** Der Satz in Alltagssprache für diesen Wert; ohne ihn bleibt der Satz an der Zeile. */
    satz: ((wert: number) => string) | null;
    /** Was die Zeichnung zeigt (Unterschrift) und was gestrichelt steht (`null`: nichts Gestricheltes). */
    unterschrift: { schema: string; vorher: string | null };
}

const zahlAus = (tafel: Tafel, key: string, vorgabe: number): number => {
    const wert = tafel.get(key);
    return typeof wert === "number" && Number.isFinite(wert) ? wert : vorgabe;
};
const klemme = (wert: number, min: number, max: number): number => Math.max(min, Math.min(max, wert));

/** Die Tafel mit anderen Werten darüber (unverändertes Original). */
export function mitWerten(tafel: Tafel, werte: Readonly<Record<string, TestWert>>): Tafel {
    const aus = new Map(tafel);
    for (const [key, wert] of Object.entries(werte)) aus.set(key, wert);
    return aus;
}

/** Was das Wasser im Gelände tut, soweit die Schemata es brauchen: Runden und Zeitschritt des Ausgleichs (Vorgaben wie die Fassung 19). */
export function wasserAusTafel(tafel: Tafel): { runden: number; zeitschritt: number } {
    return {
        runden: Math.max(0, Math.min(400, Math.round(zahlAus(tafel, "r:iterations", 20)))),
        zeitschritt: zahlAus(tafel, "w:generator.timeStep", 1),
    };
}

const HUEGEL_PFAD = "w:topographie.huegelland.landform";
const HUEGEL_BREITE = `${HUEGEL_PFAD}.hills.radiusAtMinimum`;
const HUEGEL_HOEHEN = `${HUEGEL_PFAD}.hills.heightExponent`;

/** Die Werte der Landform „Hügel“ der Landschaftsart Hügelland; `null`, wenn die Fassung sie nicht führt. */
export function huegelAusTafel(tafel: Tafel): HuegelRezept | null {
    const lies = (feld: string): number | null => {
        const wert = tafel.get(`${HUEGEL_PFAD}.${feld}`);
        return typeof wert === "number" && Number.isFinite(wert) ? wert : null;
    };
    const werte = {
        minimum: lies("minimum"),
        maximum: lies("maximum"),
        wavelength: lies("wavelength"),
        attempts: lies("hills.attempts"),
        radiusAtMinimum: lies("hills.radiusAtMinimum"),
        heightExponent: lies("hills.heightExponent"),
        overlapPower: lies("hills.overlapPower"),
    };
    if (Object.values(werte).some((wert) => wert === null) || werte.minimum! <= 0 || werte.maximum! <= werte.minimum!)
        return null;
    return werte as HuegelRezept;
}

/** Die Form des Rückens aus der Tafel, wie die Rechnung des Rückennetzes sie liest (Schärfe, Rauschen, Körnung aus dem Preset der V12). */
export function formParameter(tafel: Tafel, typ: Gebirgstyp): FormParameter {
    const nz = (id: string, vorgabe: number): number => zahlAus(tafel, `n:${typ}:${id}`, vorgabe);
    const pz = (wert: string, vorgabe: number): number => zahlAus(tafel, `p:${typ}:${wert}`, vorgabe);
    return {
        breite: nz("form.breite", 1.2),
        schaerfe: pz("plateau", nz("form.schaerfe", 0.5)),
        talboden: nz("form.talboden", 0.2),
        bergform: pz("bergform", 0.7),
        rauschen: pz("rauschen", nz("form.rauschen", 0.15)),
        koernung: pz("koernung", 14),
        stufen: pz("stufen", 4),
        muster: tafel.get(`m:${typ}`) === "zellen" ? "zellen" : "rauschen",
        grat: nz("form.grat", 0.15),
        gratBreite: nz("form.gratBreite", 0.45),
        randBreite: nz("form.randBreite", 3),
        kammMuster: nz("form.kammMuster", 1),
    };
}

const prozent = (anteil: number): string => formatDecimal(Math.round(anteil * 100), 0);

/** Der Satz in Alltagssprache; die Stufen (kaum, deutlich, tief …) sind Schwellen am Wert. */
export const stufe = (wert: number, schwellen: readonly number[]): number => schwellen.filter((s) => wert >= s).length;

const wortVon = (art: string, nummer: number): string =>
    t(`admin.terrain.test.vorschau.wort.${art}.${String(nummer)}` as MessageKey);

/** Die Sätze, die zu mehreren Wegen gehören: Durchhang, Kopf, Erosion im Gelände. */
function satzGebirge(art: "durchhang" | "kopf" | "gelaendeErosion"): (wert: number) => string {
    switch (art) {
        case "durchhang":
            return (wert) =>
                t("admin.terrain.test.vorschau.satz.durchhang", {
                    prozent: prozent(wert),
                    wort: wortVon("durchhang", wert <= 0 ? 0 : 1 + stufe(wert, [0.08, 0.2, 0.35])),
                });
        case "kopf":
            return (wert) =>
                wert <= 0
                    ? t("admin.terrain.test.vorschau.satz.kopfNull")
                    : t("admin.terrain.test.vorschau.satz.kopf", {
                          prozent: prozent(wert),
                          wort: wortVon("kopf", stufe(wert, [0.06, 0.15])),
                      });
        case "gelaendeErosion":
            return (wert) =>
                t("admin.terrain.test.vorschau.satz.gelaendeErosion", {
                    prozent: prozent(wert),
                    wort: wortVon("gelaendeErosion", wert <= 0 ? 0 : 1 + stufe(wert, [0.45, 0.85])),
                });
    }
}

/** Die Zugbereiche der einzelnen Werte: Grenzen des Katalogs, wo ein Wert sonst am Rand klebte (Ausgleich, Körnung) enger oder gröber. */
function zugVon(key: string): Zugbereich | null {
    const [art, , b] = key.split(":") as [string, string, string | undefined];
    if (key === "r:diffusion") return { min: 0, max: 0.1, schritt: 0.001 };
    if (key === HUEGEL_BREITE) return { min: 0.3, max: 3, schritt: 0.05 };
    if (key === HUEGEL_HOEHEN) return { min: 1, max: 12, schritt: 0.5 };
    if (art === "p" && b !== undefined) {
        const g = GEBIRGS_WERT_GRENZEN[b as keyof typeof GEBIRGS_WERT_GRENZEN];
        return { min: g.min, max: g.max, schritt: b === "koernung" ? 0.5 : g.schritt };
    }
    if (art === "n" && b !== undefined) {
        const g = typwertGrenze(b);
        return g === undefined ? null : { min: g.min, max: g.max, schritt: g.schritt };
    }
    return null;
}

/** Die halbe Talbreite (E), die der Regler zum Einschnitt setzt. */
const talbreiteFuer = (einschnitt: number): number =>
    Math.round((TALBREITE_GRUND_E + TALBREITE_JE_SCHRITT * einschnitt) * 10) / 10;
/** Der Talboden, den das Gelände aus dem Ziel der Hypsometrie ableitet (die Massigkeit der Regler, Gerade durch 0,15 und 0,4). */
const talbodenAusZiel = (h: number): number =>
    klemme(((h - 0.15) / 0.25) * MASSIGKEIT_TALBODEN_MAX, 0, MASSIGKEIT_TALBODEN_MAX);

/** Die Durchläufe des Rinnennetzes zu einer Stufe (`ECOSYSTEM_HYDRO_EROSIONSSTUFEN`). */
const RINNEN_SCHRITTE = [0, 40, 90, 150, 240, 360] as const;
const rinnenSchritte = (stufeWert: number): number =>
    RINNEN_SCHRITTE[Math.max(0, Math.min(RINNEN_SCHRITTE.length - 1, Math.round(stufeWert)))] as number;

const satzRinnen = (v: number): string =>
    t("admin.terrain.test.vorschau.satz.rinnen", {
        durchgaenge: formatDecimal(rinnenSchritte(v), 0),
        wort: wortVon("rinnen", stufe(Math.round(v), [1, 3, 5])),
    });

/** Das Zeichnen eines einzelnen Werts: das Schema und die Schlüssel der Unterschriften. */
interface Zeichner {
    schema: (wert: number) => SchemaFigur;
    /** Schlüssel unter `admin.terrain.test.vorschau.schema.`; `vorher`: unter `….vorher.` (`null`: nichts Gestricheltes). */
    unterschrift: { schema: string; vorher: string | null };
    satz?: (wert: number) => string;
}

/**
 * Wie ein einzelner Wert gezeichnet wird: `p:<typ>:<wert>` (V12), `n:<typ>:<typwert>` (Rückennetz), der Ausgleich der Hänge und die Hügel.
 * `null` für einen Wert ohne Schema (die Mindestschärfe des Grats: Sie gehört zur Suche des Talbodens, nichts, das man zeichnen könnte).
 * Wo die Rechnung zwei Werte für dasselbe führt (V12 und Rückennetz), zeigt das Schema den, der heute gilt, und der Satz der Zeile sagt es.
 */
function zeichnerFuer(key: string, tafel: Tafel, typ: Gebirgstyp): Zeichner | null {
    const form = (werte: Record<string, TestWert>): FormParameter => formParameter(mitWerten(tafel, werte), typ);
    const p = (wert: string): string => `p:${typ}:${wert}`;
    const n = (id: string): string => `n:${typ}:${id}`;
    type Werte = (v: number) => Record<string, TestWert>;
    const quer = (mit: Werte, vergleich: Werte, vorher: string): Zeichner => ({
        schema: (v) => schemaQuer(form(mit(v)), form(vergleich(v))),
        unterschrift: { schema: "quer", vorher },
    });
    const flanke = (mit: Werte, vergleich: Werte, vorher: string): Zeichner => ({
        schema: (v) => schemaFlanke(form(mit(v)), form(vergleich(v))),
        unterschrift: { schema: "flanke", vorher },
    });
    const ohneRauschen: Werte = () => ({ [p("rauschen")]: 0, [n("form.rauschen")]: 0 });
    const typZahl = (id: string): number => zahlAus(tafel, n(id), 0);
    switch (key) {
        case p("hypsometrie"):
        case n("band.ziel"):
            return quer(
                (v) => ({ [n("form.talboden")]: talbodenAusZiel(v) }),
                () => ({ [n("form.talboden")]: 0 }),
                "ohneSockel",
            );
        case n("form.talboden"):
            return quer(
                (v) => ({ [n("form.talboden")]: v }),
                () => ({ [n("form.talboden")]: 0 }),
                "ohneSockel",
            );
        case p("plateau"):
        case n("form.schaerfe"):
            return quer(
                (v) => ({ [p("plateau")]: v }),
                () => ({ [p("plateau")]: 0 }),
                "null",
            );
        case p("bergform"):
            return quer(
                (v) => ({ [p("bergform")]: v }),
                () => ({ [p("bergform")]: 0 }),
                "null",
            );
        case n("form.breite"):
            return quer(
                (v) => ({ [n("form.breite")]: v }),
                () => ({ [n("form.breite")]: 0.3 }),
                "schmal",
            );
        case n("form.grat"):
            return quer(
                (v) => ({ [n("form.grat")]: v }),
                () => ({ [n("form.grat")]: 0 }),
                "null",
            );
        case n("form.gratBreite"):
            return quer(
                (v) => ({ [n("form.gratBreite")]: v }),
                () => ({ [n("form.grat")]: 0 }),
                "ohneGrat",
            );
        case n("form.randBreite"):
            return {
                schema: (v) => schemaRand(v, klemme(typZahl("form.talboden") || 0.6, 0.2, 0.95), 0.5),
                unterschrift: { schema: "rand", vorher: "rand" },
            };
        case p("rauschen"):
        case n("form.rauschen"):
            return flanke(
                (v) => ({ [p("rauschen")]: v }),
                () => ({ [p("rauschen")]: 0 }),
                "ohneUnruhe",
            );
        case p("koernung"):
            return flanke((v) => ({ [p("koernung")]: v }), ohneRauschen, "ohneUnruhe");
        case n("form.koernung"):
            // Der Typwert ist die Zellweite in E; die Rechnung der V12 macht sie aus der Zahl (Seite / Zahl).
            return flanke(
                (v) => ({ [p("koernung")]: klemme(24 / Math.max(0.5, v), 1, 100) }),
                ohneRauschen,
                "ohneUnruhe",
            );
        case p("stufen"):
            return flanke(
                (v) => ({ [p("stufen")]: v }),
                () => ({ [p("stufen")]: 1 }),
                "eineStufe",
            );
        case n("form.kammMuster"):
            return {
                schema: (v) => schemaKamm(form({ [n("form.kammMuster")]: v }), form({ [n("form.kammMuster")]: 0 })),
                unterschrift: { schema: "kamm", vorher: "null" },
            };
        case p("sattel"):
            return { schema: (v) => schemaSattel(v), unterschrift: { schema: "sattel", vorher: "sattel" } };
        case n("struktur.welle"):
            return { schema: (v) => schemaWelle(v), unterschrift: { schema: "welle", vorher: "welle" } };
        case n("struktur.astAbstand"):
            return {
                schema: (v) => schemaAeste(v, typZahl("struktur.astLaenge")),
                unterschrift: { schema: "aeste", vorher: null },
            };
        case n("struktur.astLaenge"):
            return {
                schema: (v) => schemaAeste(typZahl("struktur.astAbstand"), v),
                unterschrift: { schema: "aeste", vorher: null },
            };
        case p("erosion"):
        case n("form.erosion"):
            return {
                schema: (v) => schemaRinnen(v, typZahl("form.erhalt")),
                unterschrift: { schema: "rinnen", vorher: "rinnen" },
                satz: satzRinnen,
            };
        case n("form.erhalt"):
            return { schema: (v) => schemaErhalt(v), unterschrift: { schema: "erhalt", vorher: "erhalt" } };
        case p("einschnitt"):
            return {
                schema: (v) => schemaTal(v, zahlAus(tafel, p("talbreite"), 1.5)),
                unterschrift: { schema: "tal", vorher: "tal" },
            };
        case p("talbreite"):
            return {
                schema: (v) => schemaTal(zahlAus(tafel, p("einschnitt"), 500), v),
                unterschrift: { schema: "tal", vorher: "tal" },
            };
        case n("form.kopf"):
            return {
                schema: (v) => schemaKopf(v, typZahl("form.kopfNeigung")),
                unterschrift: { schema: "kopf", vorher: "kopf" },
                satz: satzGebirge("kopf"),
            };
        case n("form.kopfNeigung"):
            return {
                schema: (v) => schemaKopf(typZahl("form.kopf"), v, 0),
                unterschrift: { schema: "kopf", vorher: "neigung" },
            };
        case n("form.durchhang"):
        case n("form.durchhangNeben"):
            return {
                schema: (v) => schemaDurchhang(v),
                unterschrift: { schema: "durchhang", vorher: "durchhang" },
                satz: satzGebirge("durchhang"),
            };
        case n("form.gelaendeErosion"):
            return {
                schema: (v) => schemaErosion(v),
                unterschrift: { schema: "gelaendeErosion", vorher: "gelaendeErosion" },
                satz: satzGebirge("gelaendeErosion"),
            };
        case "r:diffusion": {
            const wasser = wasserAusTafel(tafel);
            return {
                schema: (v) => schemaDiffusion(v, wasser.runden, wasser.zeitschritt),
                unterschrift: { schema: "hangdiffusion", vorher: "hangdiffusion" },
                satz: (v) => {
                    // Wie weit eine Kante in den Runden verschwimmt: die Streuung des Ausgleichs in Zellen (√(2 · D · Runden)).
                    const breite = Math.sqrt(2 * v * wasser.zeitschritt * wasser.runden);
                    return t("admin.terrain.test.vorschau.satz.hangdiffusion", {
                        runden: formatDecimal(wasser.runden, 0),
                        wort: wortVon("hangdiffusion", stufe(breite, [0.25, 0.8, 2])),
                    });
                },
            };
        }
        case HUEGEL_BREITE:
        case HUEGEL_HOEHEN: {
            const huegel = huegelAusTafel(tafel);
            if (huegel === null) return null;
            const breite = key === HUEGEL_BREITE;
            return {
                schema: (v) =>
                    schemaHuegel({ ...huegel, ...(breite ? { radiusAtMinimum: v } : { heightExponent: v }) }),
                unterschrift: { schema: "huegel", vorher: null },
                satz: breite
                    ? (v) =>
                          t("admin.terrain.test.vorschau.satz.huegelBreite", {
                              klein: formatDecimal(Math.round(2 * v * 10) / 10, 1),
                              gross: formatDecimal(
                                  Math.round(((2 * v * huegel.maximum) / huegel.minimum) * 10) / 10,
                                  1,
                              ),
                          })
                    : (v) =>
                          t("admin.terrain.test.vorschau.satz.huegelHoehen", {
                              anteil: formatDecimal(Math.round(100 * 0.5 ** (1 / Math.max(1, v))), 0),
                              wort: wortVon("huegelHoehen", stufe(v, [1.5, 4])),
                          }),
            };
        }
        default:
            return null;
    }
}

/**
 * Das Modell der Vorschau für den einzelnen Wert `key`; `null`, wenn er kein Schema trägt oder die Fassung die nötigen Werte nicht führt.
 * `typ` ist der Typ, den die Seite gewählt hat (für die Werte des Rückennetzes und der V12).
 */
export function vorschauFuerWert(
    test: HoehenmodellTest,
    key: string,
    typ: Gebirgstyp,
    tafel: Tafel,
    name: string,
): VorschauModell | null {
    const zeichner = zeichnerFuer(key, tafel, typ);
    const zug = zugVon(key);
    if (zeichner === null || zug === null) return null;
    const wert = zahlAus(tafel, key, Number.NaN);
    if (!Number.isFinite(wert)) return null;
    const dateiWert = datei(test).get(key);
    return {
        key,
        name,
        wert,
        datei: typeof dateiWert === "number" && Number.isFinite(dateiWert) ? dateiWert : null,
        zug,
        schema: zeichner.schema,
        satz: zeichner.satz ?? null,
        unterschrift: zeichner.unterschrift,
    };
}

/** Das Modell für einen globalen Wert (Ausgleich der Hänge, Hügel) in der Form der Bereiche; `null`, wenn er keine Vorschau trägt. */
export function vorschauFuer(
    test: HoehenmodellTest,
    felder: Readonly<Record<string, string>>,
    key: string,
    typ: Gebirgstyp,
    name: string,
    tafel: Tafel = neu(test, felder),
): VorschauModell | null {
    return key === "r:diffusion" || key === HUEGEL_BREITE || key === HUEGEL_HOEHEN
        ? vorschauFuerWert(test, key, typ, tafel, name)
        : null;
}

// --- Die Vorschauen der Regler ------------------------------------------------------------------------------------------------------

/** Die Schlüssel der Unterschriften je Regler (Schema und Gestricheltes). */
const REGLER_UNTERSCHRIFT: Readonly<Record<ReglerId, { schema: string; vorher: string | null }>> = {
    massigkeit: { schema: "quer", vorher: "null" },
    kammschaerfe: { schema: "quer", vorher: "null" },
    rueckenbreite: { schema: "quer", vorher: "schmal" },
    gipfelform: { schema: "quer", vorher: "null" },
    unruhe: { schema: "flanke", vorher: "ohneUnruhe" },
    koernung: { schema: "flanke", vorher: "ohneUnruhe" },
    muster: { schema: "flanke", vorher: "anderes" },
    durchhang: { schema: "durchhang", vorher: "durchhang" },
    prominenz: { schema: "kopf", vorher: "kopf" },
    neigung: { schema: "kopf", vorher: "neigung" },
    rinnen: { schema: "rinnen", vorher: "rinnen" },
    taleinschnitt: { schema: "tal", vorher: "tal" },
    gelaendeErosion: { schema: "gelaendeErosion", vorher: "gelaendeErosion" },
};

/** Was der Vergleich (gestrichelt) schreibt: der neutrale Wert; bei der Körnung ohne Unruhe, beim Grundmuster das andere. */
function vergleichSchreibt(def: ReglerDef, wert: number, typ: Gebirgstyp): Record<string, TestWert> {
    switch (def.id) {
        case "rueckenbreite":
            return reglerSchreibt(def, def.zug.min, typ);
        case "koernung":
            return { [`p:${typ}:rauschen`]: 0, [`n:${typ}:form.rauschen`]: 0 };
        case "muster":
            return reglerSchreibt(def, wert >= 0.5 ? 0 : 1, typ);
        case "durchhang":
        case "prominenz":
        case "gelaendeErosion":
            return {};
        default:
            // Massigkeit, Schärfe, Gipfelform, Unruhe, Steilheit, Rinnen, Taleinschnitt: derselbe Wert mit 0.
            return reglerSchreibt(def, 0, typ);
    }
}

function satzRegler(def: ReglerDef, tafel: Tafel, typ: Gebirgstyp): (wert: number) => string {
    const s = (id: string, werte?: Record<string, string | number>): string =>
        t(`admin.terrain.test.vorschau.satz.${id}` as MessageKey, werte);
    switch (def.id) {
        case "massigkeit":
            return (m) =>
                s("massigkeit", { prozent: prozent(0.85 * m), wort: wortVon("massigkeit", stufe(m, [0.3, 0.6, 0.9])) });
        case "kammschaerfe":
            return (v) => s("kammschaerfe", { wort: wortVon("kammschaerfe", stufe(v, [0.15, 0.4, 0.7])) });
        case "rueckenbreite":
            return (w) =>
                s("rueckenbreite", {
                    breit: formatDecimal(Math.round(4 * w * 10) / 10, 1),
                    wort: wortVon("rueckenbreite", stufe(w, [0.7, 1.5, 2.5])),
                });
        case "gipfelform":
            return (b) =>
                formParameter(tafel, typ).schaerfe <= 0.001
                    ? s("gipfelformRund")
                    : s("gipfelform", { wort: wortVon("gipfelform", stufe(b, [0.5, 2, 5])) });
        case "unruhe":
            return (r) => s("unruhe", { wort: wortVon("unruhe", stufe(r, [0.01, 0.2, 0.5])) });
        case "koernung":
            return (k) =>
                formParameter(tafel, typ).rauschen <= 0.001
                    ? s("koernungGlatt")
                    : s("koernung", {
                          n: formatDecimal(Math.round(k), 0),
                          wort: wortVon("koernung", stufe(k, [6, 20])),
                      });
        case "muster":
            return (m) => s(m >= 0.5 ? "musterZellen" : "musterRauschen");
        case "durchhang":
            return satzGebirge("durchhang");
        case "prominenz":
            return satzGebirge("kopf");
        case "neigung":
            return (neigung) => {
                const kopf = zahlAus(tafel, `n:${typ}:form.kopf`, 0);
                if (kopf <= 0) return s("neigungKeinKopf");
                if (neigung <= 0) return s("neigungNull", { radius: formatDecimal(kopfRadiusE(kopf, 0), 2) });
                const radius = kopfRadiusE(kopf, neigung);
                return s("neigung", {
                    radius: formatDecimal(Math.round(radius * 100) / 100, 2),
                    wort: wortVon("neigung", radius >= 1.6 ? 0 : radius >= 1 ? 1 : 2),
                });
            };
        case "rinnen":
            return satzRinnen;
        case "taleinschnitt":
            return (e) =>
                s("taleinschnitt", {
                    tiefe: formatDecimal(Math.round(e), 0),
                    breit: formatDecimal(Math.round(2 * talbreiteFuer(e) * 10) / 10, 1),
                });
        case "gelaendeErosion":
            return satzGebirge("gelaendeErosion");
    }
}

/**
 * Das Modell der Vorschau für einen Regler der Gebirgs-Presets; `tafel` ist die Tafel mit den getippten Werten (`neu`). Jede Vorschau legt
 * die Werte, die der Regler schreiben würde, über die Tafel und zeichnet damit: Was sie zeigt, ist das, was ein Zug am Regler bewirkt.
 */
export function vorschauFuerRegler(
    test: HoehenmodellTest,
    def: ReglerDef,
    typ: Gebirgstyp,
    tafel: Tafel,
    name: string,
): VorschauModell | null {
    if (test.presets === null) return null;
    const wert = reglerWert(def, tafel, typ);
    if (!Number.isFinite(wert)) return null;
    const dateiWert = reglerWert(def, datei(test), typ);
    const mit = (v: number): Tafel => mitWerten(tafel, reglerSchreibt(def, v, typ));
    const vergleich = (v: number): Tafel => mitWerten(mit(v), vergleichSchreibt(def, v, typ));
    const typZahl = (id: string): number => zahlAus(tafel, `n:${typ}:${id}`, 0);
    const schema = (v: number): SchemaFigur => {
        switch (def.id) {
            case "massigkeit":
            case "kammschaerfe":
            case "rueckenbreite":
            case "gipfelform":
                return schemaQuer(formParameter(mit(v), typ), formParameter(vergleich(v), typ));
            case "unruhe":
            case "koernung":
            case "muster":
                return schemaFlanke(formParameter(mit(v), typ), formParameter(vergleich(v), typ));
            case "durchhang":
                return schemaDurchhang(v);
            case "prominenz":
                // Beide Regler zeigen denselben Kopf: Höhe und Steilheit zusammen; jeder verstellt seine Hälfte.
                return schemaKopf(v, typZahl("form.kopfNeigung"));
            case "neigung":
                return schemaKopf(typZahl("form.kopf"), v, 0);
            case "gelaendeErosion":
                return schemaErosion(v);
            case "rinnen":
                return schemaRinnen(v, typZahl("form.erhalt"));
            case "taleinschnitt":
                return schemaTal(v, talbreiteFuer(v));
        }
    };
    return {
        key: `regler:${def.id}`,
        name,
        wert,
        datei: Number.isFinite(dateiWert) ? dateiWert : null,
        zug: def.art === "muster" ? null : def.zug,
        schema,
        satz: satzRegler(def, tafel, typ),
        unterschrift: REGLER_UNTERSCHRIFT[def.id],
    };
}
