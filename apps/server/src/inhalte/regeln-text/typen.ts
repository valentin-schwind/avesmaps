import type {
    InhalteRegelTextOption,
    InhalteRegelTextProblem,
    InhalteVorkommenArt,
    InhalteVorkommenBeziehung,
    WikisyncLageRichtung,
} from "@avesmaps3d/shared";

/**
 * Die inneren Formen des Lesers „Regeln als Text“ (WI-0254 §13): was `lies` aus dem Text macht, bevor `ergebnis.ts` es in die Vertragsform (`InhalteRegelTextErgebnis`) übersetzt.
 * Zeilen sind 0-basiert, `bis` ist ausschließlich (wie im Vertrag).
 */

export type Verknuepfung = "und" | "oder" | "ohne";

/** Der Befund an einer Stelle des Texts; dieselbe Form wie im Vertrag. */
export type Problem = InhalteRegelTextProblem;
export type Option = InhalteRegelTextOption;

// ---- Zeichen des Lexers ------------------------------------------------------------------------------------------------

export interface OpZeichen {
    art: "op";
    zeichen: ";" | "," | ":" | "außer" | "ohne";
    von: number;
    bis: number;
    zeile: number;
}
/** `bis` steht hinter „]]“, `ende` hinter den angehängten Buchstaben (`[[Steppe]]n`). */
export interface LinkZeichen {
    art: "link";
    ziel: string;
    anzeige: string | null;
    kennung: string | null;
    von: number;
    bis: number;
    ende: number;
    zeile: number;
}
export interface KlammerZeichen {
    art: "klammer";
    text: string;
    von: number;
    bis: number;
    zeile: number;
}
export interface WortZeichen {
    art: "wort";
    text: string;
    von: number;
    bis: number;
    zeile: number;
}
/** Ein „[[…“ oder „(…“, das nicht geschlossen wird; der Rest der Zeile gehört dazu. */
export interface KaputtZeichen {
    art: "kaputt";
    was: "link" | "klammer";
    text: string;
    von: number;
    bis: number;
    zeile: number;
}
export type Zeichen = OpZeichen | LinkZeichen | KlammerZeichen | WortZeichen | KaputtZeichen;

/** Ein Glied roh: die Verknüpfung mit dem vorigen, das trennende Zeichen und die Zeichen des Glieds. */
export interface GliedRoh {
    v: Verknuepfung;
    op: OpZeichen | null;
    tokens: Zeichen[];
}
/** Eine Regel roh: ihre Glieder und das „;“ davor. */
export interface RegelRoh {
    glieder: GliedRoh[];
    davor: OpZeichen | null;
}

// ---- Bedingungen -------------------------------------------------------------------------------------------------------

export type FlaecheInnen =
    | { offen: false; kennung: string; name: string | null }
    /** `gespeichert`: der Titel, wie der Eintrag ihn schon trägt (er geht so in den Fingerabdruck). */
    | { offen: true; titel: string; name: string; gespeichert: string | null };

export interface BedingungInnen {
    v: Verknuepfung;
    arten: { ebene: string; art: string }[];
    flaeche: FlaecheInnen | null;
    klima: { von: string; bis: string } | null;
    lage: { richtung: WikisyncLageRichtung; orte: { id: string; name: string }[] } | null;
    ok: boolean;
    text: string;
    zeile: number;
    /** Die Fläche ist stillgelegt oder fehlt im Katalog und kommt nur aus einer vorhandenen Regel des Eintrags: lesbar, aber nicht neu anlegbar. */
    stillgelegt: { name: string } | null;
}

// ---- Eintrag, Regel, Quelle --------------------------------------------------------------------------------------------

export type RegelStatus = "neu" | "schon" | "rueckfrage" | "fehler";
export type EintragStatus = "ok" | "rueckfrage" | "fehler";

export interface RegelInnen {
    zeile: number;
    zeileBis: number;
    relation: InhalteVorkommenBeziehung | null;
    status: RegelStatus;
    schon: { grund: "bestehend" | "stapel"; zeile?: number } | null;
    /** Der Eintrag ist offen, die Regel wartet darauf (keine eigene Rückfrage). */
    wartet: boolean;
    fingerabdruck: string | null;
    bedingungen: BedingungInnen[];
    probleme: Problem[];
    text: string;
}

/** Eine Zeile „| Beziehung = …“ samt Fortsetzungen und ihre Regeln. */
export interface BlockInnen {
    zeile: number;
    zeileBis: number;
    /** Der Anfang der Zeile bis hinter das „=“, so wie er im Text steht (mit einem Leerzeichen dahinter). */
    praefix: string;
    regeln: RegelInnen[];
}

export interface QuelleInnen {
    zeile: number;
    text: string;
    titel: string;
    seiten: string;
    id: string | null;
    typ: string;
    status: EintragStatus;
    probleme: Problem[];
    /** „Quelle: –“ */
    beendet: boolean;
}

export interface EintragInnen {
    zeile: number;
    text: string;
    name: string;
    /** Die Kategorie, wie sie im Text steht (vor der Auflösung). */
    kategorie: string | null;
    kind: InhalteVorkommenArt | null;
    wikiTitel: string;
    neuAnlegen: boolean;
    id: string | null;
    titel: string;
    status: EintragStatus;
    probleme: Problem[];
    quelle: QuelleInnen | null;
    regeln: RegelInnen[];
    bloecke: BlockInnen[];
}

/** Was `lies` zurückgibt. */
export interface Gelesen {
    eintraege: EintragInnen[];
    quellen: QuelleInnen[];
    lose: Problem[];
    fehler: Problem[];
    zahlen: { eintraege: number; neu: number; schon: number; rueckfragen: number; fehler: number };
}
