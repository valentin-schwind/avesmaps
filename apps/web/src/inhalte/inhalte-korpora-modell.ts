import type {
    InhalteKorpusEintrag,
    InhalteKorpusFelder,
    InhalteKorpusForm,
    InhalteKorpusVorgabe,
    InhalteLizenzAussage,
    SourceType,
} from "@avesmaps3d/shared";
import type { Kreis } from "../editor-liste/liste-modell";

/**
 * Der Entwurf eines Korpus im Reiter „Korpora“ des Fensters „Inhalte bearbeiten“ (WI-0254, Runde 4) als reine Rechnung ohne Vue: der Stand der Mitte
 * (Angaben und Vorgabe des Korpus), die Änderungen daran und der Körper von `corpus.update`, den „Speichern“ daraus macht.
 *
 * - **Ein Stand, ein Schritt** (`Entwurf<KorpusStand>`, `fenster/entwurf-kern.ts`): Der Stand ist unveränderlich, jede Änderung gibt einen neuen. Die Quellen
 *   der Domain gehören nicht zum Entwurf: Sie ändern sich nur durch das Durchschreiben beim Speichern (der Server rechnet es in EINER Operation).
 * - 🔴 **Wirkung (Vali, WI-0254 §5):** Bei der Anzeigeform Belegstelle schreibt eine Änderung an Art, „offiziell“, Lizenz oder Namensnennung auf ALLE Quellen
 *   der Domain durch („überall heißt überall“, keine Ausnahmen je Quelle). Bei Werk und unentschiedener Form sind diese vier Felder am Korpus gesperrt: Sie
 *   bleiben an der Quelle. Wechselt der Entwurf die Form weg von der Belegstelle, nimmt er die vier Felder auf den gespeicherten Stand zurück, damit der
 *   Körper nie etwas verlangt, das der Server ablehnen müsste.
 * - Der Schlüssel (die Domain) ist die Identität und steht nicht im Entwurf: Er lässt sich nach dem Anlegen nicht ändern.
 */

export interface KorpusFelder {
    /** Der Name des Angebots; leer heißt noch keiner (die Domain steht dann vorn). */
    label: string;
    form: InhalteKorpusForm;
    /** Die Vorgabe für die Art der Quellen; `null`: keine Vorgabe. */
    sourceType: SourceType | null;
    /** Die Vorgabe für „offiziell“; `null`: nicht eingestuft. */
    isOfficial: boolean | null;
    lizenzAussage: InhalteLizenzAussage;
    lizenzKey: string | null;
    attribution: string;
    editorNote: string;
}

export interface KorpusStand {
    readonly felder: KorpusFelder;
}

/** Die vier Felder der Vorgabe in den Worten des Servers (`INHALTE_KORPUS_VORGABEN`). */
export type VorgabeFeld = InhalteKorpusVorgabe;

/** Der Stand, mit dem ein Entwurf beginnt: genau das, was der Server liefert. */
export function standAusKorpus(korpus: InhalteKorpusEintrag): KorpusStand {
    return {
        felder: {
            label: korpus.label,
            form: korpus.form,
            sourceType: korpus.sourceType,
            isOfficial: korpus.isOfficial,
            lizenzAussage: korpus.lizenzAussage,
            lizenzKey: korpus.lizenzKey,
            attribution: korpus.attribution ?? "",
            editorNote: korpus.editorNote ?? "",
        },
    };
}

/** Schreibt dieser Stand die Vorgabe auf die Quellen durch? Nur die Belegstelle tut es. */
export const schreibtDurch = (felder: Pick<KorpusFelder, "form">): boolean => felder.form === "belegstelle";

export function setzeFeld<K extends keyof KorpusFelder>(
    stand: KorpusStand,
    feld: K,
    wert: KorpusFelder[K],
): KorpusStand {
    if (stand.felder[feld] === wert) return stand;
    const felder: KorpusFelder = { ...stand.felder, [feld]: wert };
    // Die Lizenz gehört zusammen: ohne Aussage „Lizenz“ gibt es keinen Schlüssel.
    if (feld === "lizenzAussage" && wert !== "license") felder.lizenzKey = null;
    return { ...stand, felder };
}

/**
 * Die Anzeigeform setzen. Weg von der Belegstelle nimmt der Entwurf Art, „offiziell“, Lizenz und Namensnennung auf den gespeicherten Stand (`start`) zurück:
 * Am Korpus sind sie dann gesperrt, und eine Änderung dort wäre ohne Wirkung auf die Quellen.
 */
export function setzeForm(stand: KorpusStand, form: InhalteKorpusForm, start: KorpusStand): KorpusStand {
    if (stand.felder.form === form) return stand;
    if (form === "belegstelle") return { ...stand, felder: { ...stand.felder, form } };
    const a = start.felder;
    return {
        ...stand,
        felder: {
            ...stand.felder,
            form,
            sourceType: a.sourceType,
            isOfficial: a.isOfficial,
            lizenzAussage: a.lizenzAussage,
            lizenzKey: a.lizenzKey,
            attribution: a.attribution,
        },
    };
}

/** Die Aussage und der Schlüssel der Lizenz als ein Wert der Auswahl: `license:<key>` oder die Aussage. */
export function lizenzWert(felder: Pick<KorpusFelder, "lizenzAussage" | "lizenzKey">): string {
    return felder.lizenzAussage === "license" && felder.lizenzKey !== null
        ? `license:${felder.lizenzKey}`
        : felder.lizenzAussage;
}

export function setzeLizenz(stand: KorpusStand, wert: string): KorpusStand {
    if (wert.startsWith("license:")) {
        const key = wert.slice("license:".length);
        if (stand.felder.lizenzAussage === "license" && stand.felder.lizenzKey === key) return stand;
        return { ...stand, felder: { ...stand.felder, lizenzAussage: "license", lizenzKey: key } };
    }
    if (wert !== "unrecorded" && wert !== "public_domain" && wert !== "unfree") return stand;
    if (stand.felder.lizenzAussage === wert && stand.felder.lizenzKey === null) return stand;
    return { ...stand, felder: { ...stand.felder, lizenzAussage: wert, lizenzKey: null } };
}

const leerAlsNull = (text: string): string | null => (text.trim() === "" ? null : text.trim());

/**
 * Was „Speichern“ schickt: der Unterschied zwischen dem Stand des Servers (`start`) und dem Entwurf (`jetzt`). `undefined`, wenn es keinen gibt.
 * Die Vorgabe (Art, „offiziell“, Lizenz, Nennung) geht nur mit, solange die Form die Belegstelle ist; sonst ist sie am Korpus gesperrt.
 */
export function entwurfAlsKoerper(start: KorpusStand, jetzt: KorpusStand): { fields: InhalteKorpusFelder } | undefined {
    const fields: InhalteKorpusFelder = {};
    const a = start.felder;
    const b = jetzt.felder;
    if (a.label.trim() !== b.label.trim()) fields.label = b.label.trim();
    if (a.form !== b.form) fields.form = b.form;
    if (schreibtDurch(b)) {
        if (a.sourceType !== b.sourceType) fields.sourceType = b.sourceType;
        if (a.isOfficial !== b.isOfficial) fields.isOfficial = b.isOfficial;
        if (a.lizenzAussage !== b.lizenzAussage || a.lizenzKey !== b.lizenzKey) {
            fields.lizenzAussage = b.lizenzAussage;
            fields.lizenzKey = b.lizenzKey;
        }
        if (leerAlsNull(a.attribution) !== leerAlsNull(b.attribution)) fields.attribution = leerAlsNull(b.attribution);
    }
    if (leerAlsNull(a.editorNote) !== leerAlsNull(b.editorNote)) fields.editorNote = leerAlsNull(b.editorNote);
    return Object.keys(fields).length === 0 ? undefined : { fields };
}

/** Wie viele Änderungen der Entwurf gegenüber dem Server-Stand trägt (für „n ungespeichert“); Lizenz und Schlüssel zählen als eine. */
export function zaehleAenderungen(start: KorpusStand, jetzt: KorpusStand): number {
    const fields = entwurfAlsKoerper(start, jetzt)?.fields ?? {};
    return Object.keys(fields).length - (fields.lizenzKey !== undefined ? 1 : 0);
}

/** Welche Felder der Vorgabe der Entwurf gegenüber dem Server-Stand ändert (und damit auf die Quellen durchschriebe). */
export function geaenderteVorgaben(start: KorpusStand, jetzt: KorpusStand): VorgabeFeld[] {
    const fields = entwurfAlsKoerper(start, jetzt)?.fields ?? {};
    const feld: VorgabeFeld[] = [];
    if (fields.sourceType !== undefined) feld.push("sourceType");
    if (fields.isOfficial !== undefined) feld.push("isOfficial");
    if (fields.lizenzAussage !== undefined) feld.push("lizenz");
    if (fields.attribution !== undefined) feld.push("attribution");
    return feld;
}

/** Die Felder, die ein gespeicherter Korpus den Quellen seiner Domain vorgibt: nur bei einer Belegstelle und nur, was gesetzt ist („nicht erfasst“ und leer geben nichts vor). */
export function vorgegebeneFelder(
    korpus: Pick<InhalteKorpusEintrag, "schreibtDurch" | "sourceType" | "isOfficial" | "lizenzAussage" | "attribution">,
): VorgabeFeld[] {
    if (!korpus.schreibtDurch) return [];
    const felder: VorgabeFeld[] = [];
    if (korpus.sourceType !== null) felder.push("sourceType");
    if (korpus.isOfficial !== null) felder.push("isOfficial");
    if (korpus.lizenzAussage !== "unrecorded") felder.push("lizenz");
    if (korpus.attribution !== null && korpus.attribution.trim() !== "") felder.push("attribution");
    return felder;
}

/** Der Kreis einer Zeile der Liste: ● aus Legacy, ◐ von der Redaktion angelegt oder geändert. Einen stillgelegten Korpus gibt es nicht. */
export const kreisDesKorpus = (zeile: { herkunft: "legacy" | "editor" }): Kreis =>
    zeile.herkunft === "editor" ? "halb" : "voll";

/** Der Filter der Liste nach Anzeigeform („alle“ ist kein Filter). */
export const ANZEIGEFORM_FILTER = ["alle", "belegstelle", "werk", "unentschieden"] as const;
export type AnzeigeformFilter = (typeof ANZEIGEFORM_FILTER)[number];

/** Die Anzeigeform eines Korpus als Wert der Liste: die leere Form heißt unentschieden. */
export const anzeigeformVon = (form: InhalteKorpusForm): Exclude<AnzeigeformFilter, "alle"> =>
    form === "" ? "unentschieden" : form;

/** Die Form aus dem Wert der Auswahl (leer: unentschieden). */
export const formAusWert = (wert: string): InhalteKorpusForm => (wert === "werk" || wert === "belegstelle" ? wert : "");

/** Der Domain-Schlüssel, wie Legacy und der Server ihn rechnen: klein, ohne Leerraum, ohne Schlusspunkt (die endgültige Prüfung ist die des Servers). */
export const bereinigeSchluessel = (roh: string): string => roh.trim().toLowerCase().replace(/\.$/u, "");

/** Sieht der Schlüssel wie eine registrierbare Domain aus (ohne Schema, ohne Pfad, ohne www, mindestens zwei Teile)? Der Server prüft ihn darüber hinaus gegen die Regel, die ihn aus Adressen rechnet. */
export const schluesselSiehtGutAus = (roh: string): boolean =>
    /^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/u.test(bereinigeSchluessel(roh)) && !bereinigeSchluessel(roh).startsWith("www.");
