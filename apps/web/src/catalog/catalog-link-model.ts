import type { CatalogLink } from "@avesmaps3d/shared";

/**
 * Die Links einer Zeile im Verzeichnis (WI-0118; Legacy `advRowLinkMarkup`, Mirror `cbe278210`): Beschriftung, Adresse und ein
 * Wort, wenn der Link Geld kostet. Die Beschriftung entscheidet der Server (`catalogLinkMeta` in `@avesmaps3d/shared`: aus dem
 * Host); hier steht nur, was der Leser daraus macht.
 *
 * 🔴 „(kostenpflichtig)“ steht nur bei einem bekannten JA - bei unbekannt steht nichts, denn „unbekannt“ ist eine gültige Antwort
 * und nie ein erfundenes „frei“ (Legacy: „§3.1“). Ein Prüfzustand (online, offline) steht bewusst nicht da: ein eigener Linkprüfer
 * ist ein eigenes Paket.
 */

export interface LinkLine {
    url: string;
    label: string;
    /** Ein bekanntes JA: der Link führt in einen Laden. */
    paid: boolean;
}

export const linkLinesOf = (links: readonly CatalogLink[] | undefined): LinkLine[] =>
    (links ?? []).map((link) => ({ url: link.url, label: link.label, paid: link.paid === true }));

/**
 * „Gibt es einen freien Weg zu diesem Eintrag?“ - NICHT „ist er kostenlos“ (Legacy `avesmapsCitymapHasFreeAccess`): Eine Karte,
 * die im Laden verkauft wird UND auf ihrer Wiki-Seite frei lesbar ist, hat einen freien Weg und bleibt unter „kostenlos“ sichtbar.
 * Nur ein belegtes `paid: false` zählt; unbekannt ist kein Beleg für frei.
 */
export const hasFreeWay = (links: readonly CatalogLink[] | undefined): boolean =>
    (links ?? []).some((link) => link.paid === false);
