import type { InhalteVorkommen } from "@avesmaps3d/shared";
import { wikiKreis, type KlappQuelle, type KlappWiki } from "../fenster/quellen-klappbox-modell";
import type { EntwurfQuelle } from "./inhalte-vorkommen-modell";
import { wikiAnzeige, wikiKlartext } from "./wiki-klartext";

/**
 * Der Übergang vom Entwurf des Reiters „Vorkommen“ zur Quellen-Klappbox (`fenster/quellen-klappbox.vue`, WI-0254 `--weiter`).
 *
 * 🔴 **Herkunft ist der Vergleich mit dem Wiki** (WI-0254 §12; Vali: „ist egal, wo er sie her hat, vergleich mit dem wiki, alles andere ist manuell“), wie in den Editoren der Karte: Der Kreis ist ○ für eine Quelle,
 * die nicht aktiv ist (unterdrückt oder gelöst), ● wenn der Wiki-Artikel des Eintrags sie mit derselben Art, denselben Seiten und derselben Notiz zitiert, sonst ◐ (abweichend oder nicht im Wiki). Gibt es keinen Lauf
 * des WikiSync mit Zitaten der Vorkommen, fehlt der Kreis einer aktiven Quelle (die Herkunft ist unbekannt). Er wird mit den Werten des ENTWURFS gerechnet, damit er sofort folgt: Wer die Fundstelle auf die des Wikis
 * ändert oder „↺ Wiki-Wert“ drückt, sieht ● noch vor dem Speichern.
 */

/** Was das Wiki an den Quellen EINES Eintrags zitiert, so wie der Server es zuletzt las (nicht der Entwurf). */
export interface QuellenWiki {
    /** Gibt es einen Lauf des WikiSync mit Zitaten der Vorkommen? Sonst ist die Herkunft unbekannt: kein Kreis, und ein Satz sagt es einmal. */
    readonly lauf: boolean;
    /** Das Zitat je Quelle (Kennung der Quelle); fehlt eine, zitiert der Artikel sie nicht. */
    readonly zitate: ReadonlyMap<string, KlappWiki>;
}

/** Kein Lauf: nichts zu vergleichen. */
export const KEIN_WIKI: QuellenWiki = { lauf: false, zitate: new Map() };

/** Der Vergleichsstand aus dem Eintrag, den der Server lieferte (`quellenWiki` oben, `wiki` je Quelle). */
export function quellenWikiAus(eintrag: Pick<InhalteVorkommen, "quellen" | "quellenWiki">): QuellenWiki {
    if (eintrag.quellenWiki === undefined) return KEIN_WIKI;
    const zitate = new Map<string, KlappWiki>();
    for (const quelle of eintrag.quellen) {
        if (quelle.wiki === undefined || quelle.wiki === null) continue;
        zitate.set(quelle.sourceId, {
            art: quelle.wiki.art,
            seiten: quelle.wiki.seiten ?? "",
            notiz: quelle.wiki.notiz ?? "",
        });
    }
    return { lauf: true, zitate };
}

/**
 * Eine Quelle des Eintrags in der Form der Klappbox. \`notiz\` ist die Notiz zur Anzeige (der Text statt der Vorlagen des Wikis, \`wikiAnzeige\`), nicht der gespeicherte Rohwert: Den rechnet der Aufrufer, denn er kennt
 * den Stand des Servers, gegen den ein getippter Text zu vergleichen ist. Der Kreis vergleicht dagegen den ROHEN Wert des Entwurfs (\`quelle.note\`) mit dem Zitat des Wikis, das ebenfalls roh ist.
 */
export function quelleAlsKlapp(quelle: EntwurfQuelle, notiz: string, wiki: QuellenWiki = KEIN_WIKI): KlappQuelle {
    const zitat = wiki.zitate.get(quelle.sourceId);
    return {
        id: quelle.sourceId,
        titel: quelle.title,
        art: quelle.referenceKind,
        seiten: quelle.pages,
        notiz,
        typ: quelle.sourceType,
        offiziell: quelle.offiziell,
        url: quelle.url,
        kreis: wikiKreis({
            state: quelle.state,
            lauf: wiki.lauf,
            art: quelle.referenceKind,
            seiten: quelle.pages,
            notiz: quelle.note,
            wiki: zitat === undefined ? null : { art: zitat.art, seiten: zitat.seiten, notiz: zitat.notiz },
        }),
        state: quelle.state,
        neu: quelle.neu,
        ...(quelle.korpus === undefined ? {} : { korpus: quelle.korpus }),
        // Mit Lauf trägt jede Zeile das Zitat oder `null` (nicht zitiert); ohne Lauf gibt es keinen Vergleich.
        ...(wiki.lauf ? { wiki: zitat ?? null } : {}),
    };
}

/** Die Angaben, die „↺ Wiki-Wert“ in den Entwurf setzt: Art, Fundstelle und Notiz des Zitats (roh; die Notiz zeigt das Feld als Text). */
export const wikiAngaben = (zitat: KlappWiki): Pick<EntwurfQuelle, "referenceKind" | "pages" | "note"> => ({
    referenceKind: zitat.art,
    pages: zitat.seiten,
    note: zitat.notiz,
});

/**
 * Die Notiz zur Anzeige im Feld: der Text statt der Vorlagen, solange der Entwurf den gespeicherten Rohwert hält (`wikiAnzeige`) oder den des Zitats – nach „↺ Wiki-Wert“ steht dort der Rohwert des Wikis, der dem
 * gespeicherten gleichen kann oder nicht. Sobald jemand das Feld ändert, zeigt es genau seinen Text und rechnet ihn nicht mehr um. `gespeichert` ist `undefined`, wo es keinen Stand des Servers gibt (eine im Entwurf
 * neu angehängte Quelle).
 */
export function quellenNotiz(
    quelle: Pick<EntwurfQuelle, "note">,
    gespeichert: string | undefined,
    zitat: KlappWiki | undefined,
): string {
    return zitat !== undefined && quelle.note === zitat.notiz
        ? wikiKlartext(quelle.note)
        : wikiAnzeige(quelle.note, gespeichert);
}
