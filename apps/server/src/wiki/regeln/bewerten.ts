import { leseLage, type LageLesung } from "./lage.ts";
import type { GliedAnalyse, Baustein, InneresGlied, NegierterTeil, RegelWissen } from "./lesen.ts";
import { bausteine, gliedAnalyse, innerste, leseFeld, muster, negierterTeil } from "./lesen.ts";

/**
 * Die Bewertung eines Vorkommens für die Regelvorschläge (WI-0253 Scheibe Regelvorschläge, §24): Nachbau von `bewertung.py` der Regelbuch-Analyse. Je Glied: Was lässt sich als Bedingung einer Regel
 * oder als Ortszeile fassen (`cap`), was nicht (`miss`, `hard`), was braucht eine Rückfrage (`modes`)? Daraus der Zustand des Glieds (`auto`, `rueckfrage`, `teil`, `hand` …) und der des ganzen
 * Eintrags (`voll`, `teilweise`, `keine`, `nur_lebensraum`, `ohne_aussage`). REIN.
 *
 * Die Fähigkeiten `F` der Regelsprache (Python `STUFEN`): `ohne` (F1, Vali 2026-10-27: die dritte Verknüpfung), `katalog` (F4: Eine Region des Wikis ohne Fläche in der Karte wird eine offene
 * Bedingung, die Regel wartet) und `lage` (WI-0254: „südlich von Gareth“, „zwischen Riva und Al'Anfa“ als Lage zu einer Linie, immer mit Rückfrage). Die Stufe K der Analyse hat nur `ohne`; die
 * Messung rechnet mit mehr.
 */

export const FAEHIGKEITEN: ReadonlySet<string> = new Set(["ohne", "katalog", "lage"]);

/** Ein Glied, das auf „Positiv“ umschaltet, gehört nicht mehr zur Reichweite einer Verneinung davor (Python `POSITIV_MARKER`). */
const POSITIV_MARKER = muster("^\\s*(auch|vor allem|v\\. ?a\\.|besonders|insbesondere|häufig|sowie|und)\\b", "iu");

export interface Auswertung {
    cap: string[];
    miss: string[];
    modes: string[];
    notes: string[];
    hard: string[];
}

/** Python `eval_bausteine`. */
export function bewerteBausteine(
    bs: readonly Baustein[],
    f: ReadonlySet<string>,
    quals: ReadonlySet<string>,
    extraModus: string | null,
    lrTypen: boolean,
): Auswertung {
    const cap: string[] = [];
    const miss: string[] = [];
    const modes: string[] = [];
    const notes: string[] = [];
    const hard: string[] = [];
    const mitArt = lrTypen || bs.some((b) => b.art === "typ");
    for (const b of bs) {
        const a = b.art;
        if (["fremd", "platzhalter", "je_nach_art", "mikro", "zusatz"].includes(a)) continue;
        if (a === "flaeche") {
            if (b.bezug === true) {
                miss.push("bezugspunkt");
                continue;
            }
            cap.push("flaeche");
            modes.push(b.q);
            if ((b.n ?? 1) > 1 && b.freitext !== true) notes.push("mehrere Flächen je Schlüssel");
        } else if (a === "ortszeile") {
            if (b.bezug === true) miss.push("bezugspunkt");
            else {
                cap.push("ortszeile");
                modes.push("auto");
            }
        } else if (a === "typ") {
            cap.push("typ");
            modes.push(b.q);
        } else if (a === "klima") {
            if (b.q === "vage") miss.push("klima_vage");
            else {
                cap.push("klima");
                modes.push("rueckfrage");
            }
        } else if (a === "luecke_gebiet") {
            if (!mitArt) {
                cap.push("ortszeile"); // ohne Art reicht die Ortszeile (Treffer auf dem Herrschaftsgebiet)
                modes.push("auto");
                continue;
            }
            (f.has("gebiet") ? cap : miss).push("gebiet");
            if (f.has("gebiet")) modes.push("auto");
        } else if (a === "luecke_gewaesser" || a === "luecke_fluss") {
            (f.has("fluss") ? cap : miss).push("fluss");
            if (f.has("fluss")) modes.push(a === "luecke_fluss" ? "rueckfrage" : "auto");
        } else if (a === "luecke_siedlung") {
            (f.has("siedlung") ? cap : miss).push("siedlung");
            if (f.has("siedlung")) modes.push("rueckfrage");
        } else if (a === "luecke_region_ohne_flaeche") {
            if (f.has("katalog")) {
                cap.push("katalog");
                modes.push("auto");
            } else miss.push("katalog");
        } else {
            miss.push(a.replace("luecke_", ""));
        }
    }
    if (quals.has("linie")) hard.push("linie");
    if (quals.has("teilflaeche")) hard.push("teilflaeche");
    if (quals.has("bezugspunkt") && !quals.has("teilflaeche") && !quals.has("linie")) hard.push("bezugspunkt");
    if (quals.has("historisch")) {
        if (f.has("zeit")) {
            modes.push("rueckfrage");
            notes.push("Zeitstatus");
        } else hard.push("historisch");
    }
    if (quals.has("hoehe")) {
        if (f.has("hoehe")) {
            modes.push("rueckfrage");
            notes.push("Höhenband");
        } else miss.push("hoehe");
    }
    if (quals.has("tiefe") && !cap.includes("typ")) miss.push("unterwelt");
    for (const k of ["rand", "naehe", "unsicher", "magisch"]) {
        if (quals.has(k)) {
            modes.push("rueckfrage");
            notes.push(k);
        }
    }
    if (quals.has("haeufigkeit")) notes.push(f.has("gewicht") ? "Gewicht" : "Gewicht verloren");
    if (extraModus !== null) modes.push(extraModus);
    return { cap, miss, modes, notes, hard };
}

export type Ergebnis = "hand" | "teil" | "auto" | "rueckfrage" | "leer";

/** Python `ergebnis`. */
export function ergebnisVon(
    cap: readonly string[],
    miss: readonly string[],
    modes: readonly string[],
    hard: readonly string[],
): Ergebnis {
    if (hard.length > 0) return "hand";
    if (cap.length === 0 && miss.length > 0) return "hand";
    if (cap.length > 0 && miss.length > 0) return "teil";
    if (cap.length > 0) return modes.every((m) => m === "auto") ? "auto" : "rueckfrage";
    return "leer";
}

/** Ein innerstes Glied, gelesen und mit seinen Bausteinen. */
export interface GliedEintrag extends InneresGlied {
    bausteine: Baustein[];
    negiert: (NegierterTeil & { bausteine: Baustein[] }) | null;
    /** Das Glied sagt eine Lage zu einer Linie („südlich von Festum“, „zwischen A und B“) und kennt alle Orte (WI-0254); fehlt, wo es keine sagt. Nur ohne Verneinung, nie am Kontextglied. */
    lage?: LageLesung;
}

export type GliedUrteil = "hand" | "teil" | "auto" | "rueckfrage" | "leer" | "fremd" | "platzhalter" | "je_nach_art";

export interface GliedErgebnis {
    res: GliedUrteil;
    gruende: string[];
    notes: string[];
    /** Die Bausteine, auf denen das Urteil beruht (bei einer Verneinung der positive Teil davor). */
    bs: Baustein[];
    /** Bei einer Verneinung: die Bausteine hinter dem Verneinungswort. */
    negBs: Baustein[] | null;
    /** Das Glied folgt auf eine Verneinung im selben Zweig und gehört vielleicht noch dazu. */
    nachVerneinung: boolean;
    /**
     * Das Glied setzt die Liste einer Verneinung fort, die selbst keinen positiven Teil hat („überall, ausgenommen A, B, C“): Seine Flächen sind ebenfalls ausgenommen. Gilt nur, wo das Glied nichts als
     * Flächen nennt; die Reichweite bleibt eine Rückfrage.
     */
    ausnahme?: boolean;
    /** Das Glied ist eine Lage zu einer Linie (immer mit Rückfrage `lage`): die Lesung und die Merkmale von Vorsatz und Schluss; `bs` sind dann deren Bausteine. */
    lage?: { lesung: LageLesung; quals: ReadonlySet<string> };
}

const ueberallOderGanz = /überall|ganz/u;

/** Die Bausteine, die Vorsatz und Schluss einer Lage tragen dürfen: eine Fläche, Landschaftsarten, ein Klimawort, was nichts sagt. Alles andere (ein Ort, ein freies Wort …) ist keine ganz gelesene Lage. */
const LAGE_BAUSTEINE: ReadonlySet<string> = new Set([
    "flaeche",
    "luecke_region_ohne_flaeche",
    "typ",
    "klima",
    "mikro",
    "zusatz",
]);

/**
 * Vorsatz und Schluss einer Lage als Glieder gelesen und bewertet (WI-0254): Beide müssen sich ohne Lücke und ohne harte Aussage lesen lassen, dürfen höchstens EINE Fläche nennen und nichts verneinen;
 * sonst ist das Glied keine Lage (`null`) und bleibt, was es heute ist. Die Bausteine beider gehen in die Bedingung (Fläche, Arten, Klima), ihre Merkmale in die Rückfragen.
 */
function bewerteLage(
    lesung: LageLesung,
    f: ReadonlySet<string>,
    lrTypen: boolean,
    wissen: RegelWissen,
): { bs: Baustein[]; quals: Set<string>; notes: string[] } | null {
    const bs: Baustein[] = [];
    const quals = new Set<string>();
    const notes: string[] = [];
    for (const roh of [lesung.vorsatzRoh, lesung.schlussRoh]) {
        if (roh === "") continue;
        const analyse = gliedAnalyse(roh, wissen);
        const teil = bausteine(analyse, false, wissen);
        const e = bewerteBausteine(teil, f, analyse.quals, null, lrTypen);
        if (e.miss.length > 0 || e.hard.length > 0 || analyse.quals.has("negation")) return null;
        if (teil.some((b) => !LAGE_BAUSTEINE.has(b.art) || b.bezug === true)) return null;
        bs.push(...teil);
        for (const merkmal of analyse.quals) quals.add(merkmal);
        notes.push(...e.notes);
    }
    if (bs.filter((b) => b.art === "flaeche" || b.art === "luecke_region_ohne_flaeche").length > 1) return null;
    return { bs, quals, notes };
}

/** Python `eval_glied`. */
export function bewerteGlied(
    gl: GliedEintrag,
    f: ReadonlySet<string>,
    nachNegation: boolean,
    lrTypen: boolean,
    wissen: RegelWissen,
    /** „zwischen A und B“ sind zwei Bedingungen mit UND und nur als erste Gruppe der Kette richtig: ob dieses Glied das sein darf (`bewerteEintrag` entscheidet). */
    zwischenErlaubt = true,
): GliedErgebnis {
    const quals = gl.glied.quals;
    if (gl.negiert !== null) {
        const ng = gl.negiert;
        const vor = ng.vor !== "" ? gliedAnalyse(ng.vor, wissen) : null;
        let bsVor = vor === null ? [] : bausteine(vor, gl.fremdKontext, wissen);
        const qVor: ReadonlySet<string> = vor === null ? new Set() : vor.quals;
        if (bsVor.length === 0 && ueberallOderGanz.test(ng.vor.toLowerCase())) {
            const av = wissen.flaechen("Aventurien");
            bsVor = [
                {
                    art: "flaeche",
                    wert: "Aventurien",
                    q: "rueckfrage",
                    grund: "",
                    flaechen: av,
                    offen: av.length === 0,
                    n: 1,
                },
            ];
        }
        if (!f.has("ohne"))
            return { res: "hand", gruende: ["negation"], notes: [], bs: bsVor, negBs: null, nachVerneinung: false };
        const e1 = bewerteBausteine(bsVor, f, qVor, null, lrTypen);
        const e2 = bewerteBausteine(ng.bausteine, f, ng.analyse.quals, null, false);
        const modes = [...e1.modes, ...e2.modes, "rueckfrage"];
        let res: Ergebnis = ergebnisVon([...e1.cap, ...e2.cap], [...e1.miss, ...e2.miss], modes, [
            ...e1.hard,
            ...e2.hard,
        ]);
        if (e2.cap.length === 0) res = e1.cap.length > 0 ? "teil" : "hand";
        return {
            res,
            gruende: [...e1.miss, ...e2.miss, ...e1.hard, ...e2.hard],
            notes: [...e1.notes, ...e2.notes, "ohne"],
            bs: bsVor,
            negBs: ng.bausteine,
            nachVerneinung: false,
        };
    }
    if (gl.lage !== undefined && f.has("lage") && !nachNegation && !gl.fremdKontext) {
        if (gl.lage.form !== "zwischen" || zwischenErlaubt) {
            const lage = bewerteLage(gl.lage, f, lrTypen, wissen);
            // Ohne Fläche im Vorsatz gilt die Fläche der Ebene davor. Stand dort etwas, das keine Fläche der Karte ist („Südaventurien: südlich von …“), wäre „überall“ geraten: Das Glied bleibt, was es ist.
            const ohneRahmen =
                lage !== null &&
                !lage.bs.some((b) => b.art === "flaeche" || b.art === "luecke_region_ohne_flaeche") &&
                gl.tiefe > 1 &&
                gl.kontext.length === 0;
            if (lage !== null && !ohneRahmen)
                return {
                    res: "rueckfrage",
                    gruende: [],
                    notes: [...lage.notes, "Lage"],
                    bs: lage.bs,
                    negBs: null,
                    nachVerneinung: false,
                    lage: { lesung: gl.lage, quals: lage.quals },
                };
        }
    }
    let bs = gl.bausteine;
    if (bs.length > 0 && bs.every((b) => b.art === "fremd"))
        return { res: "fremd", gruende: [], notes: [], bs, negBs: null, nachVerneinung: false };
    if (bs.length > 0 && bs.every((b) => b.art === "platzhalter"))
        return { res: "platzhalter", gruende: [], notes: [], bs, negBs: null, nachVerneinung: false };
    if (bs.length > 0 && bs.every((b) => b.art === "je_nach_art"))
        return { res: "je_nach_art", gruende: [], notes: [], bs, negBs: null, nachVerneinung: false };
    if (bs.length === 0 && quals.has("ganz")) {
        const av = wissen.flaechen("Aventurien");
        bs = [
            {
                art: "flaeche",
                wert: "Aventurien",
                q: "rueckfrage",
                grund: "",
                flaechen: av,
                offen: av.length === 0,
                n: 1,
            },
        ];
    }
    const e = bewerteBausteine(bs, f, quals, nachNegation ? "rueckfrage" : null, lrTypen);
    const hard = [...e.hard];
    if (quals.has("negation") && !f.has("ohne")) hard.push("negation");
    const res = ergebnisVon(e.cap, e.miss, e.modes, hard);
    return {
        res,
        gruende: [...e.miss, ...hard],
        notes: [...e.notes, ...(nachNegation ? ["Reichweite der Verneinung"] : [])],
        bs,
        negBs: null,
        nachVerneinung: nachNegation,
    };
}

/** Ein Glied des Lebensraums. */
export interface LebensraumGlied {
    glied: GliedAnalyse;
    bausteine: Baustein[];
}

export type LebensraumUrteil = "kein_feld" | "leer" | "auto" | "rueckfrage" | "teil" | "hand";

/** Python `eval_lebensraum`. */
export function bewerteLebensraum(
    lr: readonly LebensraumGlied[] | null,
    f: ReadonlySet<string>,
): {
    res: LebensraumUrteil;
    gruende: string[];
    typen: Baustein[];
    orte: Baustein[];
    je: { glied: LebensraumGlied; res: Ergebnis; gruende: string[] }[];
} {
    if (lr === null) return { res: "kein_feld", gruende: [], typen: [], orte: [], je: [] };
    const outs: Ergebnis[] = [];
    const gr: string[] = [];
    const typen: Baustein[] = [];
    const orte: Baustein[] = [];
    const je: { glied: LebensraumGlied; res: Ergebnis; gruende: string[] }[] = [];
    for (const t of lr) {
        const bs = t.bausteine;
        if (bs.length === 0) continue;
        if (bs.every((b) => ["je_nach_art", "platzhalter", "fremd", "mikro", "zusatz"].includes(b.art))) continue;
        const e = bewerteBausteine(bs, f, t.glied.quals, null, false);
        const hard = [...e.hard];
        if (t.glied.quals.has("negation") && !f.has("ohne")) hard.push("negation");
        const res = ergebnisVon(e.cap, e.miss, e.modes, hard);
        outs.push(res);
        gr.push(...e.miss, ...hard);
        typen.push(...bs.filter((b) => b.art === "typ"));
        orte.push(...bs.filter((b) => b.art === "flaeche"));
        je.push({ glied: t, res, gruende: [...e.miss, ...hard] });
    }
    if (outs.length === 0) return { res: "leer", gruende: [], typen, orte, je };
    if (outs.every((o) => o === "auto" || o === "rueckfrage"))
        return { res: outs.every((o) => o === "auto") ? "auto" : "rueckfrage", gruende: gr, typen, orte, je };
    if (outs.some((o) => o === "auto" || o === "rueckfrage" || o === "teil"))
        return { res: "teil", gruende: gr, typen, orte, je };
    return { res: "hand", gruende: gr, typen, orte, je };
}

export type EintragStatus = "voll" | "teilweise" | "keine" | "nur_lebensraum" | "ohne_aussage";

export interface EintragBewertung {
    status: EintragStatus;
    /** Bei `voll`: `auto` oder `rueckfrage`. */
    modus: "auto" | "rueckfrage" | "";
    /** Bei `ohne_aussage`: warum (`fremd`, `platzhalter`, `je_nach_art`, `leer`). */
    ohneAussage: string;
    /** Je Ortsfeld und Glied: das Urteil. */
    felder: Map<string, { eintrag: GliedEintrag; urteil: GliedErgebnis }[]>;
    lebensraum: ReturnType<typeof bewerteLebensraum>;
    lebensraumGlieder: LebensraumGlied[] | null;
}

/** Ein Ortsfeld, gelesen: seine Glieder mit Bausteinen. */
export function leseOrtsfeld(
    roh: string,
    wissen: RegelWissen,
): { eintraege: GliedEintrag[]; zweige: GliedAnalyse[][][] } {
    const zweige = leseFeld(roh, wissen);
    const eintraege = innerste(zweige).map((inner): GliedEintrag => {
        const neg = negierterTeil(inner.glied, wissen);
        // Eine Lage zu einer Linie nur an einem Glied ohne Verneinung und nie am Kontextglied (dessen Fläche rahmt die Glieder dahinter).
        const lage =
            neg === null && inner.rolle !== "kontextglied" && !inner.glied.quals.has("negation")
                ? leseLage(inner.glied, wissen)
                : null;
        return {
            ...inner,
            bausteine: bausteine(inner.glied, inner.fremdKontext, wissen),
            negiert: neg === null ? null : { ...neg, bausteine: bausteine(neg.analyse, false, wissen) },
            ...(lage === null ? {} : { lage }),
        };
    });
    return { eintraege, zweige };
}

/** Der Lebensraum (`Vorkommen`), gelesen: Glied für Glied ohne Rahmen. */
export function leseLebensraum(
    roh: string,
    wissen: RegelWissen,
): { glieder: LebensraumGlied[]; zweige: GliedAnalyse[][][] } {
    const zweige = leseFeld(roh, wissen);
    const glieder: LebensraumGlied[] = [];
    for (const zweig of zweige)
        for (const ebene of zweig)
            for (const g of ebene) glieder.push({ glied: g, bausteine: bausteine(g, false, wissen) });
    return { glieder, zweige };
}

/** Python `eval_eintrag`: der Status des ganzen Eintrags. `ortsfelder` in der Reihenfolge der Beziehungen der Art. */
export function bewerteEintrag(
    ortsfelder: ReadonlyMap<string, GliedEintrag[]>,
    lebensraum: readonly LebensraumGlied[] | null,
    f: ReadonlySet<string>,
    wissen: RegelWissen,
): EintragBewertung {
    const lrHas = lebensraum?.some((t) => t.bausteine.some((b) => b.art === "typ")) ?? false;
    const gouts: GliedUrteil[] = [];
    const felder = new Map<string, { eintrag: GliedEintrag; urteil: GliedErgebnis }[]>();
    for (const [beziehung, glieder] of ortsfelder) {
        const negZweig = new Set<number>();
        // Zweige, in denen eine Verneinung ohne eigenen positiven Teil stand („ausgenommen A“): Die folgenden Flächen führen die Liste fort.
        const ausnahmeZweig = new Set<number>();
        const liste: { eintrag: GliedEintrag; urteil: GliedErgebnis }[] = [];
        // „zwischen A und B“ (zwei Bedingungen mit UND) rückt in der Kette nach vorn und gilt nur einmal je Beziehung; steht eine Verneinung in der Kette, nur als allererstes Glied (sonst zöge das Vorrücken
        // sie von der Verneinung weg). Sonst bleibt der Satzteil ein Teil wie ohne Lage.
        const verneint = glieder.some((g) => g.negiert !== null || g.glied.quals.has("negation"));
        let zwischenVergeben = false;
        for (const [stelle, gl] of glieder.entries()) {
            const nn = negZweig.has(gl.zweig) && !POSITIV_MARKER.test(gl.glied.text) && gl.negiert === null;
            const urteil = bewerteGlied(
                gl,
                f,
                nn && f.has("ohne"),
                lrHas,
                wissen,
                !zwischenVergeben && (!verneint || stelle === 0),
            );
            if (urteil.lage?.lesung.form === "zwischen") zwischenVergeben = true;
            const nurFlaechen =
                gl.bausteine.length > 0 &&
                gl.bausteine.every((b) => ["flaeche", "luecke_region_ohne_flaeche", "ortszeile"].includes(b.art)) &&
                gl.bausteine.some((b) => b.art !== "ortszeile");
            if (nn && ausnahmeZweig.has(gl.zweig) && nurFlaechen && f.has("ohne")) urteil.ausnahme = true;
            if (gl.negiert !== null && gl.negiert.vor === "") ausnahmeZweig.add(gl.zweig);
            if (gl.negiert !== null || gl.glied.quals.has("negation")) negZweig.add(gl.zweig);
            if (nn && !f.has("ohne") && ["auto", "rueckfrage", "teil"].includes(urteil.res)) {
                urteil.res = "hand";
                urteil.gruende.push("nach_verneinung");
            }
            gouts.push(urteil.res);
            liste.push({ eintrag: gl, urteil });
        }
        felder.set(beziehung, liste);
    }
    const lr = bewerteLebensraum(lebensraum, f);
    const inhalt = gouts.filter((o) => !["leer", "fremd", "platzhalter", "je_nach_art"].includes(o));
    const ktxAv = [...felder.values()].some((liste) => liste.some((e) => e.eintrag.kontext.includes("Aventurien")));
    const nurFremd = gouts.length > 0 && gouts.includes("fremd") && !ktxAv && lr.orte.length === 0;
    let status: EintragStatus;
    let modus: "auto" | "rueckfrage" | "" = "";
    let ohneAussage = "";
    if (inhalt.length === 0 && nurFremd) {
        status = "ohne_aussage";
        ohneAussage = "fremd";
    } else if (inhalt.length === 0) {
        if (["auto", "rueckfrage", "teil"].includes(lr.res) && (lr.typen.length > 0 || lr.orte.length > 0)) {
            if (lr.orte.length > 0 || ktxAv) {
                status = lr.res !== "teil" ? "voll" : "teilweise";
                modus = "rueckfrage";
            } else {
                status = "nur_lebensraum";
                modus = "rueckfrage";
            }
        } else if (lr.res === "hand") {
            status = "keine";
        } else {
            status = "ohne_aussage";
            ohneAussage =
                felder.size === 0
                    ? "leer"
                    : gouts.every((o) => o === "fremd")
                      ? "fremd"
                      : gouts.includes("platzhalter")
                        ? "platzhalter"
                        : gouts.includes("je_nach_art")
                          ? "je_nach_art"
                          : "fremd";
        }
    } else {
        const lrOk = ["kein_feld", "leer", "auto", "rueckfrage"].includes(lr.res);
        if (inhalt.every((o) => o === "auto" || o === "rueckfrage") && lrOk) {
            status = "voll";
            modus =
                inhalt.every((o) => o === "auto") && ["kein_feld", "leer", "auto"].includes(lr.res)
                    ? "auto"
                    : "rueckfrage";
        } else if (
            inhalt.some((o) => ["auto", "rueckfrage", "teil"].includes(o)) ||
            ["auto", "rueckfrage", "teil"].includes(lr.res)
        ) {
            status = "teilweise";
        } else {
            status = "keine";
        }
    }
    return {
        status,
        modus,
        ohneAussage,
        felder,
        lebensraum: lr,
        lebensraumGlieder: lebensraum ? [...lebensraum] : null,
    };
}
