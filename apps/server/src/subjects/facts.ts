import type {
    MediaPublicView,
    SubjectCanon,
    SubjectFact,
    SubjectFactField,
    SubjectFactLink,
    SubjectMedia,
    SubjectProvenance,
    SubjectRef,
    SubjectWikiLine,
} from "@avesmaps3d/shared";
import { corpusKeyOfUrl } from "../migration/subject-details.ts";
import type { SubjectIndex } from "./subject-index.ts";

/**
 * Die Bausteine der Detailantwort, die ohne Datenbank auskommen: ein Wert eines Feldes mit seiner Provenienz, die Wikizeile,
 * die Medien und der Kanon. Alles hier lässt Leeres weg (WI-0063 5.3): ein Wert ohne Inhalt wird nie zu einer Zeile.
 *
 * 🔴 Es gibt keinen „wirksamen Wert“ mehr, der Nest und direkten Wert zu EINEM verschmilzt (WI-0063 27.8, Betreiber 2026-10-04:
 * „aussehn wie legacy“): Nestwert und direkter Wert sind getrennte Fakten (`layer: "direct"`); was Legacy nicht zeigt, trägt
 * `legacyHidden`. Welche Fakten das Panel zeigt, entscheidet die Anzeigeregel in `packages/shared/src/subject-display.ts`.
 */

/** Ein Zeitstempel als ISO-8601-Text; die Datenbank liefert `Date`, ein Test darf Text liefern. */
export function isoOf(value: Date | string | null | undefined): string | undefined {
    if (value === null || value === undefined) return undefined;
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

/** Die Provenienz eines Wiki-Schnappschusses: Adresse und Stempel des Abgleichs (die Kraftlinien-Nester tragen keinen). */
export function wikiProvenance(wikiUrl: string | null, syncedAt?: Date | string | null): SubjectProvenance {
    const stamp = isoOf(syncedAt);
    return {
        kind: "wiki",
        ...(wikiUrl === null || wikiUrl === "" ? {} : { wikiUrl }),
        ...(stamp === undefined ? {} : { syncedAt: stamp }),
    };
}

export const EDITORIAL: SubjectProvenance = { kind: "editorial" };

/** Ein direkt am Objekt gesetzter Wert mit der Herkunft, die Legacy je Feld stempelt (`wiki`, `manual`, unbekannt). */
export interface DirectValue {
    value: string | null;
    origin: "wiki" | "manual" | null;
}

export interface WikiValue {
    value: string | null;
    wikiUrl: string | null;
    syncedAt: Date | string | null;
}

/** Ein Wert mit der Provenienz, die mit ihm reist. */
export interface ProvenancedValue {
    value: string;
    provenance: SubjectProvenance;
}

/** Der Wiki-Wert mit Adresse und Stempel des Abgleichs; leer ist nichts. */
export function wikiValue(wiki: WikiValue | null): ProvenancedValue | null {
    if (wiki === null || wiki.value === null || wiki.value === "") return null;
    return { value: wiki.value, provenance: wikiProvenance(wiki.wikiUrl, wiki.syncedAt) };
}

/**
 * Ein direkt am Objekt gesetzter Wert. Herkunft `wiki` ist eine ins Objekt übernommene Wiki-Angabe (Adresse, kein Stempel), Herkunft
 * `manual` oder keine Angabe ein redaktioneller Wert.
 */
export function directValue(direct: DirectValue, wikiUrl: string | null): ProvenancedValue | null {
    if (direct.value === null || direct.value === "") return null;
    return { value: direct.value, provenance: direct.origin === "wiki" ? wikiProvenance(wikiUrl) : EDITORIAL };
}

/**
 * Die `lage` des Wiki-Nests: Zusammensetzung aus Region und Staat, `join(' · ', eindeutig(region, staat))` (Vertrag: alle 1.934
 * gefüllten Nest-Werte sind genau das). Sie wird nie gespeichert und nie geparst; der Leser bildet sie.
 */
export function composeLage(region: string | null, staat: string | null): string | null {
    const parts: string[] = [];
    for (const part of [region, staat]) {
        if (part !== null && part.trim() !== "" && !parts.includes(part)) parts.push(part);
    }
    return parts.length > 0 ? parts.join(" · ") : null;
}

/** Die Markierung eines Fakts, den Legacys Infobox nicht zeigt (`legacyHidden`), als Teil von `extra`. */
export const LEGACY_HIDDEN = { legacyHidden: true as const };

/** Eine Faktenzeile, oder nichts (ein Wert ohne Inhalt ist keine Zeile). */
export function textFact(
    field: SubjectFactField,
    value: ProvenancedValue | null,
    extra: { ref?: SubjectRef; links?: SubjectFactLink[]; layer?: "direct"; legacyHidden?: true } = {},
): SubjectFact[] {
    if (value === null) return [];
    return [
        {
            field,
            value: value.value,
            ...(extra.ref === undefined ? {} : { ref: extra.ref }),
            ...(extra.links === undefined || extra.links.length === 0 ? {} : { links: extra.links }),
            provenance: value.provenance,
            ...(extra.layer === undefined ? {} : { layer: extra.layer }),
            ...(extra.legacyHidden === true ? LEGACY_HIDDEN : {}),
        },
    ];
}

/** Eine Zeile nur mit Wiki-Text (Felder ohne direktes Gegenstück). */
export function wikiFact(
    field: SubjectFactField,
    wiki: WikiValue | null,
    extra: { links?: SubjectFactLink[]; legacyHidden?: true } = {},
): SubjectFact[] {
    return textFact(field, wikiValue(wiki), extra);
}

/**
 * Eine Zeile aus dem direkten Wert am Objekt (`place_detail`, `layer: "direct"`); `hidden` markiert sie als bei Legacy verborgen.
 * `wikiUrl` ist die Adresse, die ein direkter Wert mit Herkunft `wiki` als Provenienz trägt.
 */
export function directFact(
    field: SubjectFactField,
    direct: DirectValue,
    wikiUrl: string | null,
    hidden: boolean,
): SubjectFact[] {
    return textFact(field, directValue(direct, wikiUrl), { layer: "direct", ...(hidden ? LEGACY_HIDDEN : {}) });
}

/**
 * Die Wikizeile („Quelle: Wiki Aventurica“): Adresse und Titel der Zuordnung samt Korpus, Lizenz und Namensnennung aus dem
 * gemeinsamen Katalog (`source_corpus`, `license_catalog`). Eine Adresse ohne erkennbaren Korpus nennt ihren Host.
 */
export function wikiLine(
    index: Pick<SubjectIndex, "corpora">,
    url: string | null | undefined,
    title?: string | null,
): SubjectWikiLine | undefined {
    if (url === null || url === undefined || url.trim() === "") return undefined;
    let key = corpusKeyOfUrl(url);
    if (key === "") {
        try {
            key = new URL(url).hostname;
        } catch {
            return undefined;
        }
        if (key === "") return undefined;
    }
    const corpus = index.corpora.get(key);
    return {
        url,
        ...(title === null || title === undefined || title.trim() === "" ? {} : { title }),
        corpus: { key, ...(corpus && corpus.label !== "" ? { label: corpus.label } : {}) },
        ...(corpus?.license
            ? {
                  license: {
                      name: corpus.license.name,
                      ...(corpus.license.uri === null ? {} : { uri: corpus.license.uri }),
                  },
              }
            : {}),
        ...(corpus?.attribution ? { attribution: corpus.attribution } : {}),
    };
}

/**
 * Wappen und Kopfbilder aus dem Media-Resolver; ohne beides fehlt der Block. Zum Kopf gehören auch die Reisebilder eines Ortes (Rolle `photobox`, WI-0272 S5): Der Resolver reiht sie hinter die
 * Kopfbilder und liefert sie nur, wo der Aufrufer sie verlangt (`PlaceMediaOptions.reisebilder`); ihr Bildbezug `reisebild` sagt der Oberfläche, was sie sind.
 */
export function subjectMedia(
    views: readonly MediaPublicView[],
    typbilder: readonly MediaPublicView[] = [],
): SubjectMedia | undefined {
    const coat = views.find((view) => view.role === "coat");
    const header = views.filter((view) => view.role === "header" || view.role === "photobox");
    if (coat === undefined && header.length === 0) return undefined;
    return {
        ...(coat === undefined ? {} : { coat }),
        ...(header.length === 0 ? {} : { header }),
        ...(typbilder.length === 0 ? {} : { typbilder: [...typbilder] }),
    };
}

export interface CanonRow {
    canon: string;
    designator_type: string | null;
    designator_count: number | null;
    designator_label: string | null;
}

/** Der Kanon einer abgeleiteten Zeile (D1): Bezeichner nur, wo sie gesetzt sind. */
export function canonOf(row: CanonRow | undefined): SubjectCanon | undefined {
    if (row === undefined) return undefined;
    if (row.canon !== "official" && row.canon !== "unofficial" && row.canon !== "unlabelled") return undefined;
    return {
        canon: row.canon,
        ...(row.designator_type === null ? {} : { designatorType: row.designator_type }),
        ...(row.designator_count === null ? {} : { designatorCount: row.designator_count }),
        ...(row.designator_label === null ? {} : { designatorLabel: row.designator_label }),
    };
}
