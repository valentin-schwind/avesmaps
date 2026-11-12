import { KARTE_LINK_LABEL_VORGABE, type MamKarteDetail, type MamKarteLinksBody } from "@avesmaps3d/shared";
import { t } from "../i18n/i18n";
import type { Dreiwert } from "./medien-karte-bearbeiten-modell";

/**
 * Was der Kasten „Fundstellen“ einer Karte der Kartensammlung rechnet (WI-0287 Stufe 1, Punkt 3, Entwurf Fassung 5: `leseLinks`, `links-speichern`). Reine Funktionen,
 * damit Vitest sie ohne Browser prüft.
 *
 * - Eine Zeile ist Beschriftung, Adresse und „Kostenpflichtig“ (🔴 dreiwertig: unbekannt ist eine eigene Wahl, nie „nein“). Die Folge der Zeilen ist die Folge der Fundstellen,
 *   die erste ist der Karten-Link; das entscheidet der Server (`citymap.links`).
 * - Eine ganz leere Zeile (weder Beschriftung noch Adresse) fällt weg. Eine leere Beschriftung wird „Karte“ (0069).
 * - Befunde je Zeile: die Adresse beginnt nicht mit http oder https, oder sie steht schon in einer Zeile davor.
 */

export interface LinkZeile {
    text: string;
    url: string;
    /** `Dreiwert`; als Text, weil das Auswahlfeld Text liefert. */
    bezahlt: string;
}

/** Wie der Server: http oder https, danach etwas ohne Leerraum. */
export const HTTP_ADRESSE = /^https?:\/\/\S+$/i;

const dreiwert = (wert: boolean | null): Dreiwert => (wert === null ? "" : wert ? "ja" : "nein");
const ausDreiwert = (wert: string): boolean | null => (wert === "ja" ? true : wert === "nein" ? false : null);

export const leereLinkZeile = (): LinkZeile => ({ text: "", url: "", bezahlt: "" });

/** Die Zeilen aus dem Detail; ohne Link steht eine leere Zeile bereit, in die man gleich tippt. */
export function linkZeilenAus(karte: Pick<MamKarteDetail, "links">): LinkZeile[] {
    return karte.links.length === 0
        ? [leereLinkZeile()]
        : karte.links.map((link) => ({ text: link.label, url: link.url, bezahlt: dreiwert(link.isPaid) }));
}

/** Die Zeilen, die wirklich eine Fundstelle sind (weder Beschriftung noch Adresse leer = weg), getrimmt. */
function genutzt(zeilen: readonly LinkZeile[]): { zeile: LinkZeile; index: number }[] {
    return zeilen
        .map((zeile, index) => ({
            zeile: { text: zeile.text.trim(), url: zeile.url.trim(), bezahlt: zeile.bezahlt },
            index,
        }))
        .filter(({ zeile }) => zeile.url !== "" || zeile.text !== "");
}

export interface LinksAnfrage {
    /** `undefined`, wenn nichts zu senden ist (ein Befund oder unverändert). */
    anfrage: Omit<MamKarteLinksBody, "operationId" | "baseRevision">["links"] | undefined;
    /** Der Satz je Zeile des Kastens (Index der Zeile), in der Sprache der Oberfläche. */
    befunde: ReadonlyMap<number, string>;
    /** Es gibt nichts zu speichern: Die Liste ist so, wie sie am Eintrag steht. */
    unveraendert: boolean;
}

export function linksAnfrage(karte: Pick<MamKarteDetail, "links">, zeilen: readonly LinkZeile[]): LinksAnfrage {
    const befunde = new Map<number, string>();
    const gesehen = new Set<string>();
    const links: { url: string; label: string; isPaid: boolean | null }[] = [];
    for (const { zeile, index } of genutzt(zeilen)) {
        if (!HTTP_ADRESSE.test(zeile.url)) {
            befunde.set(index, t("medien.karten.links.adresseFalsch"));
            continue;
        }
        if (gesehen.has(zeile.url)) {
            befunde.set(index, t("medien.karten.links.doppelt"));
            continue;
        }
        gesehen.add(zeile.url);
        links.push({
            url: zeile.url,
            label: zeile.text === "" ? KARTE_LINK_LABEL_VORGABE : zeile.text,
            isPaid: ausDreiwert(zeile.bezahlt),
        });
    }
    if (befunde.size > 0) return { anfrage: undefined, befunde, unveraendert: false };
    const alt = karte.links.map((link) => ({ url: link.url, label: link.label, isPaid: link.isPaid }));
    const unveraendert = JSON.stringify(alt) === JSON.stringify(links);
    return { anfrage: unveraendert ? undefined : links, befunde, unveraendert };
}

/**
 * Nach „↺ Neu laden“ bei offenem Kasten: Hat die Redakteurin die Zeilen seit dem Öffnen nicht angefasst (gleich dem Stand von damals), folgen sie dem neuen Stand; ihre eigenen
 * Eingaben bleiben. Sonst schickte das nächste Speichern die alte Liste mit und überschriebe still, was die andere Person gerade geändert hat.
 */
export function linkZeilenNachladen(
    alt: readonly LinkZeile[],
    eigen: readonly LinkZeile[],
    neu: readonly LinkZeile[],
): LinkZeile[] {
    return JSON.stringify(alt) === JSON.stringify(eigen)
        ? neu.map((zeile) => ({ ...zeile }))
        : eigen.map((zeile) => ({ ...zeile }));
}
