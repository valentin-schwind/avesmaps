import {
    WIKISYNC_BEREICHE,
    type WikiNamespaceTafel,
    type WikisyncBereich,
    type WikisyncBereichZahlen,
} from "@avesmaps3d/shared";
import type { GelesenerDumpArtikel } from "../dump/seiten-sammler.ts";
import { berechnePlan, kandidatenTitel, type PlanObjekt, type PlanZeile } from "../abgleich/plan.ts";

/**
 * Der Vergleich EINES Wiki-Artikels mit der Karte (WI-0253 D-2, „Artikel vergleichen“): derselbe Plan wie die Vorschau (`berechnePlan`), nur mit der einen Seite, die die MediaWiki-API lieferte, statt
 * des Dumps, und nur für die Objekte, die an diesem Artikel hängen. REIN: keine Datenbank, keine Anfrage. Der Vergleich schreibt nichts; er sagt, was eine Übernahme mit diesem Artikel täte.
 *
 * Was der Vergleich NICHT kennt, ist, was erst eine Vorlage im Wiki setzt (Ortsgröße, Bauwerkart, Kontinent): Das braucht Kategorie-Abfragen, den Wiki-Teil. Und neue Artikel gibt es hier nicht (ein
 * Einzelartikel ist immer einer, den jemand benannt hat).
 */

/** Die Seite, wie die API sie lieferte (nach der Weiterleitung, wenn es eine gab). */
export interface ApiSeite {
    titel: string;
    ns: number;
    text: string;
}

export interface VergleichEingabe {
    /** Der Titel, den die Person nannte (Unterstriche wie Leerzeichen). */
    gefragt: string;
    seite: ApiSeite;
    /** Hat das Wiki den genannten Titel weitergeleitet? Dann steht hier, woher und wohin. */
    weiterleitung: { von: string; nach: string } | null;
    /** Alle Objekte der Karte mit Wiki-Zuordnung (aller Bereiche); der Vergleich nimmt, was an diesem Artikel hängt. */
    objekte: readonly PlanObjekt[];
    tafel: WikiNamespaceTafel;
    /** Die Bereiche, die in dieser Umgebung dem WikiSync gehören; die übrigen sind „nur Vorschau“ (Eigentümer legacy). */
    wikisyncBereiche: ReadonlySet<WikisyncBereich>;
}

export interface VergleichErgebnis {
    bereiche: WikisyncBereich[];
    zeilen: PlanZeile[];
    zahlen: Partial<Record<WikisyncBereich, WikisyncBereichZahlen>>;
    /** Wie viele Objekte an dem Artikel hängen. */
    objekte: number;
}

/** Höchstens so viele Zeilen hält ein Vergleich (die Zahl daneben ist ungekappt). */
export const MAX_VERGLEICH_ZEILEN = 500;

const schluessel = (titel: string): string => titel.replaceAll("_", " ").trim().toLowerCase();

/** Hängt das Objekt an einem der Titel? Wörtlich oder mit großem Anfangsbuchstaben (MediaWiki stellt ihn frei). */
function haengtAn(objekt: PlanObjekt, titel: ReadonlySet<string>): boolean {
    return kandidatenTitel(objekt.adresse).some((kandidat) => titel.has(schluessel(kandidat)));
}

export function rechneVergleich(eingabe: VergleichEingabe): VergleichErgebnis {
    const titel = new Set([schluessel(eingabe.gefragt), schluessel(eingabe.seite.titel)]);
    const objekte = eingabe.objekte.filter((objekt) => haengtAn(objekt, titel));
    const bereiche = WIKISYNC_BEREICHE.filter((bereich) => objekte.some((objekt) => objekt.bereich === bereich));
    // Die Seite, wie der Dump sie führt: unter ihrem Titel, und eine Weiterleitung unter dem Titel, der weitergeleitet hat.
    const gefunden = new Map<string, GelesenerDumpArtikel[]>();
    const artikel: GelesenerDumpArtikel = {
        titel: eingabe.seite.titel,
        ns: eingabe.seite.ns,
        weiterleitung: null,
        text: eingabe.seite.text,
    };
    gefunden.set(artikel.titel, [artikel]);
    if (eingabe.weiterleitung !== null && eingabe.weiterleitung.von !== artikel.titel) {
        gefunden.set(eingabe.weiterleitung.von, [
            { titel: eingabe.weiterleitung.von, ns: artikel.ns, weiterleitung: eingabe.weiterleitung.nach, text: "" },
        ]);
    }
    const plan = berechnePlan({
        bereiche,
        objekte,
        dump: { gefunden, kandidaten: [] },
        tafel: eingabe.tafel,
        legacyBereiche: new Set(WIKISYNC_BEREICHE.filter((bereich) => !eingabe.wikisyncBereiche.has(bereich))),
        bekannteTitel: new Set(),
    });
    return {
        bereiche,
        zeilen: plan.zeilen.slice(0, MAX_VERGLEICH_ZEILEN),
        zahlen: plan.zahlen,
        objekte: objekte.length,
    };
}
