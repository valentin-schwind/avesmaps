import {
    KANON_BEZEICHNER_MAX,
    KANON_OBJEKTART_VORGABE,
    WIKI_NAMESPACE_VORGABE,
    bezeichnerLaenge,
    normalisiereBezeichner,
    type KanonObjektart,
    type KanonObjektartZeile,
    type WikiKanon,
    type WikiNamespaceZeile,
    type WikisyncNamensraumZeile,
    type WikisyncObjektartZeile,
    type WikisyncTafelNamensraum,
    type WikisyncTafelObjektart,
} from "@avesmaps3d/shared";
import type { CanonPill } from "../info-panel/panel-types";

/**
 * Die zwei Tafeln des Kanon-Etiketts im Reiter (WI-0253 UI-1; Mockup, Abschnitte „Namensräume“ und „Ohne Wiki-Artikel und ohne Quelle“), ohne Vue:
 * Zeilen, Wirkung und was eine Änderung schickt. Seit 2026-10-27 gibt es keinen Entwurf mehr (Vali: „warum muss man speichern, warum speichert der klick
 * nicht?“): Jede Änderung einer Zeile geht gleich als EINE Zeile an den Server (`wikisync-sofort.ts`). Die Wirkung zählt nur, was die Zahlen des Servers
 * hergeben (Objekte je Raum, Objekte je Art ohne Kanon-Zeile), nichts wird geschätzt.
 */

export interface NsZeile {
    ns: number;
    praefix: string;
    kanon: WikiKanon;
    einsammeln: boolean;
    bezeichner: string;
    objekte: number | null;
}

export interface OhneZeile {
    art: KanonObjektart;
    anzeigen: boolean;
    bezeichner: string;
    objekte: number | null;
}

export const nsVorgabe = (ns: number): WikiNamespaceZeile | undefined =>
    WIKI_NAMESPACE_VORGABE.find((zeile) => zeile.ns === ns);
export const ohneVorgabe = (art: KanonObjektart): KanonObjektartZeile =>
    KANON_OBJEKTART_VORGABE.find((zeile) => zeile.art === art)!;

export const nsAusServer = (zeilen: readonly WikisyncTafelNamensraum[]): NsZeile[] =>
    zeilen.map(({ ns, praefix, kanon, einsammeln, bezeichner, objekte }) => ({
        ns,
        praefix,
        kanon,
        einsammeln,
        bezeichner,
        objekte,
    }));

export const ohneAusServer = (zeilen: readonly WikisyncTafelObjektart[]): OhneZeile[] =>
    zeilen.map(({ art, anzeigen, bezeichner, objekte }) => ({ art, anzeigen, bezeichner, objekte }));

/** Der Bezeichner ohne Leerraum an den Rändern; leer heißt: das Etikett bleibt rund. */
export const bez = (text: string): string => normalisiereBezeichner(text);

export function pille(kanon: WikiKanon, bezeichner: string): CanonPill {
    const by = bez(bezeichner);
    return { state: kanon === "offiziell" ? "official" : "unofficial", ...(by === "" ? {} : { by }) };
}

/** Ein Bezeichner, der zu lang ist (Codepunkte, wie der Server zählt). */
export const bezZuLang = (text: string): boolean => bezeichnerLaenge(bez(text)) > KANON_BEZEICHNER_MAX;

export const gleichNs = (a: NsZeile, b: NsZeile): boolean =>
    a.kanon === b.kanon &&
    bez(a.bezeichner) === bez(b.bezeichner) &&
    a.einsammeln === b.einsammeln &&
    a.praefix === b.praefix;

/** Weicht die Zeile von der Vorgabe ab (dann steht ↺ daneben)? Ein hinzugefügter Raum hat keine Vorgabe. */
export function nsWeichtAb(zeile: NsZeile): boolean {
    const vorgabe = nsVorgabe(zeile.ns);
    return vorgabe !== undefined && !gleichNs(zeile, { ...vorgabe, objekte: null });
}

export function nsAufVorgabe(zeile: NsZeile): NsZeile {
    const vorgabe = nsVorgabe(zeile.ns);
    return vorgabe === undefined ? zeile : { ...zeile, ...vorgabe };
}

export interface NsUebergang {
    von: CanonPill;
    nach: CanonPill;
    n: number;
    nurBezeichner: boolean;
}

export interface NsAenderung {
    ns: number;
    praefix: string;
    art: "neu" | "weg" | "geaendert";
    kanonVon?: WikiKanon;
    kanonNach?: WikiKanon;
    bezVon?: string;
    bezNach?: string;
    einsammelnVon?: boolean;
    einsammelnNach?: boolean;
    kanonWechsel: boolean;
    bezWechsel: boolean;
    einsammelnWechsel: boolean;
    /** Die Objekte, die ihr Etikett wechseln (Kanon oder Bezeichner); leer, wenn keine Objekte betroffen sind. */
    uebergang: NsUebergang | null;
    /** Objekte mit Zuweisung in diesem Raum; `null`: unbekannt. */
    objekte: number | null;
}

export function nsAenderungen(gespeichert: readonly NsZeile[], entwurf: readonly NsZeile[]): NsAenderung[] {
    const aus: NsAenderung[] = [];
    for (const zeile of entwurf) {
        const alt = gespeichert.find((kandidat) => kandidat.ns === zeile.ns);
        if (alt === undefined) {
            aus.push({
                ns: zeile.ns,
                praefix: zeile.praefix,
                art: "neu",
                kanonNach: zeile.kanon,
                bezNach: bez(zeile.bezeichner),
                einsammelnNach: zeile.einsammeln,
                kanonWechsel: false,
                bezWechsel: false,
                einsammelnWechsel: zeile.einsammeln,
                uebergang: null,
                objekte: null,
            });
            continue;
        }
        const kanonWechsel = alt.kanon !== zeile.kanon;
        const bezWechsel = bez(alt.bezeichner) !== bez(zeile.bezeichner);
        const einsammelnWechsel = alt.einsammeln !== zeile.einsammeln;
        if (!kanonWechsel && !bezWechsel && !einsammelnWechsel) continue;
        const n = alt.objekte ?? 0;
        aus.push({
            ns: zeile.ns,
            praefix: zeile.praefix,
            art: "geaendert",
            kanonVon: alt.kanon,
            kanonNach: zeile.kanon,
            bezVon: bez(alt.bezeichner),
            bezNach: bez(zeile.bezeichner),
            einsammelnVon: alt.einsammeln,
            einsammelnNach: zeile.einsammeln,
            kanonWechsel,
            bezWechsel,
            einsammelnWechsel,
            uebergang:
                (kanonWechsel || bezWechsel) && n > 0
                    ? {
                          von: pille(alt.kanon, alt.bezeichner),
                          nach: pille(zeile.kanon, zeile.bezeichner),
                          n,
                          nurBezeichner: !kanonWechsel,
                      }
                    : null,
            objekte: alt.objekte,
        });
    }
    for (const alt of gespeichert) {
        if (entwurf.some((zeile) => zeile.ns === alt.ns)) continue;
        aus.push({
            ns: alt.ns,
            praefix: alt.praefix,
            art: "weg",
            kanonVon: alt.kanon,
            einsammelnVon: alt.einsammeln,
            kanonWechsel: false,
            bezWechsel: false,
            einsammelnWechsel: alt.einsammeln,
            uebergang: null,
            objekte: alt.objekte,
        });
    }
    return aus;
}

export interface NsSumme {
    kanonObjekte: number;
    bezObjekte: number;
    etikettRaeume: number;
    einsammelnRaeume: number;
}

export function nsSumme(aenderungen: readonly NsAenderung[]): NsSumme {
    const summe: NsSumme = { kanonObjekte: 0, bezObjekte: 0, etikettRaeume: 0, einsammelnRaeume: 0 };
    for (const aenderung of aenderungen) {
        if (aenderung.kanonWechsel || aenderung.bezWechsel) summe.etikettRaeume += 1;
        if (aenderung.einsammelnWechsel) summe.einsammelnRaeume += 1;
        if (aenderung.uebergang === null) continue;
        if (aenderung.uebergang.nurBezeichner) summe.bezObjekte += aenderung.uebergang.n;
        else summe.kanonObjekte += aenderung.uebergang.n;
    }
    return summe;
}

/** Die Zeile, wie die Route sie annimmt (ohne die Zahl der Objekte). */
export const nsKoerperZeile = ({ ns, praefix, kanon, einsammeln, bezeichner }: NsZeile): WikisyncNamensraumZeile => ({
    ns,
    praefix,
    kanon,
    einsammeln,
    bezeichner: bez(bezeichner),
});

/** Das Präfix aus dem Formular: ohne Doppelpunkt am Ende, wie der Server es speichert („Elf:“ → „Elf“). */
export const praefixWort = (text: string): string => text.trim().replace(/:$/u, "").trim();

// ── Ohne Wiki-Artikel und ohne Quelle ─────────────────────────────────────────────────────────────────────────────────────────────

export const gleichOhne = (a: OhneZeile, b: OhneZeile): boolean =>
    a.anzeigen === b.anzeigen && bez(a.bezeichner) === bez(b.bezeichner);

export function ohneWeichtAb(zeile: OhneZeile): boolean {
    return !gleichOhne(zeile, { ...ohneVorgabe(zeile.art), objekte: null });
}

export interface OhneAenderung {
    art: KanonObjektart;
    anzeigenVon: boolean;
    anzeigenNach: boolean;
    bezVon: string;
    bezNach: string;
    anzeigenWechsel: boolean;
    bezWechsel: boolean;
    von: CanonPill | null;
    nach: CanonPill | null;
    /** bekommen (nein → ja), verlieren (ja → nein), nurBez (bleibt ja), still (bleibt nein: kein Objekt ändert sich). */
    wirkung: "bekommen" | "verlieren" | "nurBez" | "still";
    n: number | null;
}

const ohnePille = (zeile: OhneZeile): CanonPill | null =>
    zeile.anzeigen ? pille("inoffiziell", zeile.bezeichner) : null;

export function ohneAenderungen(gespeichert: readonly OhneZeile[], entwurf: readonly OhneZeile[]): OhneAenderung[] {
    return entwurf.flatMap((zeile) => {
        const alt = gespeichert.find((kandidat) => kandidat.art === zeile.art);
        if (alt === undefined) return [];
        const anzeigenWechsel = alt.anzeigen !== zeile.anzeigen;
        const bezWechsel = bez(alt.bezeichner) !== bez(zeile.bezeichner);
        if (!anzeigenWechsel && !bezWechsel) return [];
        const von = ohnePille(alt);
        const nach = ohnePille(zeile);
        const wirkung =
            von === null && nach !== null
                ? "bekommen"
                : von !== null && nach === null
                  ? "verlieren"
                  : von !== null
                    ? "nurBez"
                    : "still";
        return [
            {
                art: zeile.art,
                anzeigenVon: alt.anzeigen,
                anzeigenNach: zeile.anzeigen,
                bezVon: bez(alt.bezeichner),
                bezNach: bez(zeile.bezeichner),
                anzeigenWechsel,
                bezWechsel,
                von,
                nach,
                wirkung,
                n: alt.objekte,
            },
        ];
    });
}

export function ohneSumme(
    aenderungen: readonly OhneAenderung[],
): Record<"bekommen" | "verlieren" | "nurBez", number> & { obergrenze: boolean } {
    const summe = { bekommen: 0, verlieren: 0, nurBez: 0, obergrenze: false };
    for (const aenderung of aenderungen) {
        if (aenderung.wirkung === "still") continue;
        summe[aenderung.wirkung] += aenderung.n ?? 0;
        if (aenderung.art === "path") summe.obergrenze = true;
    }
    return summe;
}

/** Die Zeile, wie die Route sie annimmt (ohne die Zahl der Objekte). */
export const ohneKoerperZeile = ({ art, anzeigen, bezeichner }: OhneZeile): WikisyncObjektartZeile => ({
    art,
    anzeigen,
    bezeichner: bez(bezeichner),
});
