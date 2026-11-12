import type { SubjectFactLink, SubjectKind, SubjectLink, SubjectListLink, SubjectRef } from "@avesmaps3d/shared";
import { formatNumber, isMessageKey, t, type MessageKey } from "../i18n/i18n";
import type { TextPart } from "./panel-types";

/** Kleine Texthelfer des Panelmodells: Art als Wort, Satzvorlage mit Link, Text mit Verweisen, Anteil. Reine Funktionen. */

/** Der Name einer Art aus einer Sprachtafel (`place.dorf`, `landscape.type.wald`, `path.Strasse`, `peak.berggipfel`); unbekannt: der Schlüssel. */
export function typeLabel(kind: SubjectKind, key: string): string {
    const prefixes: Partial<Record<SubjectKind, string[]>> = {
        place: ["place."],
        area: ["landscape.type."],
        peak: ["peak.", "landscape.type."],
        path: ["path."],
        routeStage: ["path."],
    };
    for (const prefix of prefixes[kind] ?? []) {
        const name = `${prefix}${key}`;
        if (isMessageKey(name)) return t(name);
    }
    return key;
}

const NAME_MARK = "\u0001";

/**
 * Eine Satzvorlage mit `{name}` als Teile, deren Name ein Link ist („Hauptstadt von <Königreich Garetien>“). Die Vorlage steht in
 * der Sprachtafel, nicht im Bauteil: Sie lässt sich übersetzen, und der Name bleibt trotzdem ein eigener Link.
 */
export function namedParts(key: MessageKey, name: string, ref: SubjectRef): TextPart[] {
    const [before = "", after = ""] = t(key, { name: NAME_MARK }).split(NAME_MARK);
    return [
        ...(before === "" ? [] : [{ text: before }]),
        { text: name, ref },
        ...(after === "" ? [] : [{ text: after }]),
    ];
}

/** Dieselbe Satzvorlage mit mehreren Namen, jeder ein eigener Link, durch „, “ getrennt („Hauptstadt von <A>, <B>, <C>“). */
export function listedParts(key: MessageKey, links: readonly SubjectLink[]): TextPart[] {
    const [before = "", after = ""] = t(key, { name: NAME_MARK }).split(NAME_MARK);
    return [
        ...(before === "" ? [] : [{ text: before }]),
        ...links.flatMap((link, index) => [...(index > 0 ? [{ text: ", " }] : []), { text: link.name, ref: link.ref }]),
        ...(after === "" ? [] : [{ text: after }]),
    ];
}

/**
 * Ein Text, in dem Namen auf andere Subjects zeigen („Reichsstraßen 2 und 3, Gardel“): Der Text bleibt, wie er ist, die Namen der
 * Verweise werden Links, in der Reihenfolge ihres Vorkommens. Ein Verweis, dessen Text nicht (mehr) darin steht, fällt weg - es gibt
 * keinen Link ohne Stelle.
 *
 * Nennt der Verweis seine Stelle (`at`, Wiki-Texte: derselbe Name steht auch ungelinkt davor, „Alt-Gareth · Gareth“), gilt genau sie; ohne
 * Stelle sucht der Text von links nach der Reihenfolge der Verweise (Verkehrswege).
 */
export function partsOfLinked(value: string, links: readonly SubjectFactLink[]): TextPart[] {
    const parts: TextPart[] = [];
    let from = 0;
    for (const link of links) {
        const at = link.at === undefined ? value.indexOf(link.text, from) : link.at;
        if (at < from || !value.startsWith(link.text, at)) continue;
        if (at > from) parts.push({ text: value.slice(from, at) });
        parts.push({ text: link.text, ref: link.ref });
        from = at + link.text.length;
    }
    if (from < value.length) parts.push({ text: value.slice(from) });
    return parts;
}

/** Ein Wert einer Liste (die Nachbarn): sein Text, in dem die Namen mit Verweis Links sind; ohne Verweise ein einziges Stück Text. */
export function partsOfListValue(
    value: string,
    position: number,
    links: readonly SubjectListLink[] | undefined,
): TextPart[] {
    const own = (links ?? [])
        .filter((link) => link.value === position)
        .map((link): SubjectFactLink => ({ text: link.text, ref: link.ref, at: link.at }));
    return own.length === 0 ? [{ text: value }] : partsOfLinked(value, own);
}

/** Ein Satzzeichen am Anfang eines Textes samt allem bis zum nächsten Leerraum: „,“ in „, B“, „).“ in „). Danach“. */
const LEADING_PUNCTUATION = /^\p{P}\S*/u;

/**
 * Hängt das Satzzeichen, das im Text unmittelbar auf einen Link folgt, an den Link (`tail`), bis zum nächsten Leerraum; der Rest bleibt
 * Text. Aus „<Heiliges … zu Gareth>“ „, “ „<Königreich Garetien>“ wird „<Heiliges … zu Gareth,>“ „ “ „<Königreich Garetien>“.
 *
 * 🔴 Warum (Abnahmeblatt `review/bildbezug/blatt.png`, Gareth): Ein Link ist ein Knopf und damit ein Kasten (`inline-block`, auch mit
 * `display: inline`). Hinter einem Kasten darf der Browser immer umbrechen, auch vor einem Komma, und ein Name, der in sich umbricht,
 * füllt die ganze Breite - das Komma stand dann am Anfang der nächsten Zeile. Eine `nowrap`-Hülle um Kasten und Komma hilft dort
 * nicht: Das Komma hinge rechts neben dem breiten Kasten, weit hinter dem letzten Wort (gemessen). Nur im Kasten steht es direkt
 * hinter dem Namen. Text, Abstände und Umbruch sonst bleiben, wie sie waren; das Modell bleibt unberührt.
 */
export function withTrailingPunctuation(parts: readonly TextPart[]): TextPart[] {
    const glued: TextPart[] = [];
    for (const part of parts) {
        const link = glued.at(-1);
        const tail =
            link?.ref !== undefined && link.bearing === undefined && part.ref === undefined && part.breakBefore !== true
                ? LEADING_PUNCTUATION.exec(part.text)?.[0]
                : undefined;
        if (link === undefined || tail === undefined) {
            glued.push(part);
            continue;
        }
        glued[glued.length - 1] = { ...link, tail: `${link.tail ?? ""}${tail}` };
        const rest = part.text.slice(tail.length);
        if (rest !== "" || part.swatch !== undefined || part.bearing !== undefined) glued.push({ ...part, text: rest });
    }
    return glued;
}

/** „ (83 %)“, ganz gerundet; ohne Anteil leer. */
export function percentOf(share: number | undefined): string {
    return share === undefined ? "" : ` (${formatNumber(Math.round(share * 100), 0)} %)`;
}

/** Der Text einer Zeile nach der Länge: „A → B → …“ in seine Stationen zerlegt (Legacy trennt am Pfeil). */
export const stationsOf = (value: string): string[] =>
    value
        .split(" → ")
        .map((station) => station.trim())
        .filter((station) => station !== "");
