import { Type, type Static } from "@sinclair/typebox";

/**
 * Die Links der Katalogfenster „Kartensammlung“ und „Literatur“ (WI-0118; Legacy `advLinkMeta`/`advNormalizeLinks`, Mirror
 * `cbe278210`, `js/map-features/map-features-place-extras.js`): EIN Link ist Beschriftung, Adresse und - dreiwertig - ob er
 * Geld kostet. Alles, was ein Mensch daran liest, entscheidet der Server hier, an EINER Stelle; der Client zeichnet nur.
 *
 * 🔴 Die Beschriftung kommt aus dem HOST, nicht aus dem, was ein Redakteur einmal als Titel getippt hat: Die Fundstellen der
 * Kartensammlung heißen im Bestand fast alle „Karte“ (gemessen 502 von 565), und „Karte ↗“ neben „Karte ↗“ sagt dem Leser nicht,
 * wohin der Link führt. Legacy benennt vier Hosts (Ulisses eBook, F-Shop, Wiki Aventurica, Dt. Nationalbibliothek) und lässt
 * alles Übrige bei seinem Titel; hier bekommen auch die häufigsten übrigen Hosts ihren Namen, und ein Link ohne Namen heißt wie
 * sein Host.
 *
 * 🪤 `paid` ist DREIWERTIG: Ein fehlender Wert heißt UNBEKANNT, nie „frei“ (Legacy `cityMapIsPaid`, `citymaps.yaml`). Nur
 * Ulisses eBook und F-Shop gelten, wie in Legacy, immer als kostenpflichtig - sie verkaufen. Ein bekannt freier Link trägt
 * `paid: false`; der Filter „kostenlos“ fragt genau das (Legacy `avesmapsCitymapHasFreeAccess`).
 */

const strict = { additionalProperties: false } as const;

export const CatalogLink = Type.Object(
    {
        /** Wohin der Link führt, in Worten („Wiki Aventurica“, „F-Shop“). */
        label: Type.String({ minLength: 1 }),
        /** Nur http(s): alles andere käme nie als Adresse beim Leser an. */
        url: Type.String({ pattern: "^https?://" }),
        /** Kostet es Geld? Fehlt der Wert, ist es unbekannt. */
        paid: Type.Optional(Type.Boolean()),
    },
    strict,
);
export type CatalogLink = Static<typeof CatalogLink>;

interface HostRule {
    /** Der Host oder seine Endung; `wiki-aventurica.de` trifft auch `de.wiki-aventurica.de`. */
    host: string;
    label: string;
    /** Gesetzt nur, wo der Host immer verkauft. */
    paid?: true;
    /** Legacys Klickreihenfolge (kleiner zuerst): Ulisses eBook, F-Shop, Wiki Aventurica, DNB; alles Übrige danach. */
    rank: number;
}

/** Die vier Hosts, die Legacy kennt (`advLinkMeta`), in seiner Rangfolge. */
const LEGACY_HOSTS: readonly HostRule[] = [
    { host: "ulisses-ebooks.de", label: "Ulisses eBook", paid: true, rank: 1 },
    { host: "f-shop.de", label: "F-Shop", paid: true, rank: 2 },
    { host: "wiki-aventurica.de", label: "Wiki Aventurica", rank: 3 },
    { host: "portal.dnb.de", label: "Dt. Nationalbibliothek", rank: 4 },
];

/** Die Rangzahl aller übrigen Links - nach den vier benannten. */
const OTHER_RANK = 5;

/**
 * Weitere Hosts mit einem Namen, den ein Mensch kennt. Er gilt nur, wo der Bestand keinen eigenen Titel führt: Ein sprechender
 * Titel („Ulisses Spiele Downloads“) gewinnt. Sie ändern nichts an der Reihenfolge (Rang 5, stabil).
 */
const NAMED_HOSTS: readonly (readonly [host: string, label: string])[] = [
    ["deviantart.com", "deviantArt"],
    ["artstation.com", "ArtStation"],
    ["reddit.com", "Reddit"],
    ["orkenspalter.de", "Orkenspalter"],
    ["inkarnate.com", "Inkarnate"],
    ["ulisses-spiele.de", "Ulisses Spiele"],
    ["uhrwerk-verlag.de", "Uhrwerk Verlag"],
    ["phileasson-projekt.de", "Phileasson-Projekt"],
];

/** Titel, die nichts sagen: „Karte“ heißt jede Fundstelle, „Link“ ist Legacys Rückfall. */
const GENERIC_LABELS: ReadonlySet<string> = new Set(["karte", "link"]);

function hostOf(url: string): string {
    try {
        return new URL(url).hostname.toLowerCase();
    } catch {
        return "";
    }
}

const hostMatches = (host: string, rule: string): boolean => host === rule || host.endsWith(`.${rule}`);

export interface CatalogLinkMeta {
    label: string;
    paid?: boolean;
    rank: number;
}

/**
 * Beschriftung, Kostenpflicht und Rang eines Links aus seinem Host (Legacy `advLinkMeta`).
 * `stored` ist, was der Bestand an der Zeile führt: sein Titel und sein dreiwertiges `is_paid`.
 */
export function catalogLinkMeta(
    url: string,
    stored: { label?: string | null | undefined; paid?: boolean | null | undefined } = {},
): CatalogLinkMeta {
    const host = hostOf(url);
    const known = LEGACY_HOSTS.find((rule) => hostMatches(host, rule.host));
    if (known !== undefined) {
        const paid = known.paid ?? stored.paid ?? undefined;
        return { label: known.label, ...(paid === undefined ? {} : { paid }), rank: known.rank };
    }
    const named = NAMED_HOSTS.find(([rule]) => hostMatches(host, rule));
    const title = (stored.label ?? "").trim();
    const label =
        title !== "" && !GENERIC_LABELS.has(title.toLowerCase())
            ? title
            : (named?.[1] ?? (host.replace(/^www\./, "") || "Link"));
    const paid = stored.paid ?? undefined;
    return { label, ...(paid === undefined ? {} : { paid }), rank: OTHER_RANK };
}

/**
 * Die Links eines Eintrags, fertig für den Leser: nur http(s), jede Adresse einmal (die erste gewinnt), nach Legacys
 * Klickreihenfolge sortiert und innerhalb eines Rangs in der Reihenfolge des Bestands.
 */
export function catalogLinks(
    raw: readonly { url: string; label?: string | null | undefined; paid?: boolean | null | undefined }[],
): CatalogLink[] {
    const seen = new Set<string>();
    const rows: { link: CatalogLink; rank: number }[] = [];
    for (const entry of raw) {
        const url = entry.url.trim();
        if (!/^https?:\/\//i.test(url) || seen.has(url)) continue;
        seen.add(url);
        const { label, paid, rank } = catalogLinkMeta(url, entry);
        rows.push({ link: { label, url, ...(paid === undefined ? {} : { paid }) }, rank });
    }
    // `Array.prototype.sort` ist stabil: gleicher Rang behält die Reihenfolge des Bestands.
    return rows.sort((left, right) => left.rank - right.rank).map((row) => row.link);
}

/**
 * Die Titelsuche der Deutschen Nationalbibliothek (Legacy `avesmapsGameLiteratureLinks`): ohne ISBN - der Bestand führt keine -
 * wird nach dem Titel gesucht. PHPs `rawurlencode` maskiert auch `!'()*`, JavaScripts `encodeURIComponent` nicht; hier gleich.
 */
export function dnbSearchUrl(query: string): string {
    const encoded = encodeURIComponent(query).replace(
        /[!'()*]/g,
        (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
    );
    return `https://portal.dnb.de/opac/simpleSearch?query=${encoded}`;
}
