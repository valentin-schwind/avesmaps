import type { WikiNamespaceTafel } from "@avesmaps3d/shared";
import { wikiNamespaceZeile } from "@avesmaps3d/shared";
import type { ZielInfo } from "../abgleich/ortsrolle.ts";
import type { Produkt, PublikationsKatalog } from "../abgleich/quellen.ts";
import { infoboxName } from "../infobox/block.ts";
import { entitaetDerSeite, klassifiziere, type Entitaet } from "../infobox/lesen.ts";
import { leseProdukt } from "../infobox/literatur.ts";
import { landmarkenArtDerSeite } from "../infobox/landmarke.ts";
import { gehoertZurFlaechenliste } from "../infobox/region-artikel.ts";
import { koennteWindSein } from "../infobox/wind.ts";
import { istSprachInfobox } from "../infobox/sprache.ts";
import { artDerInfobox } from "../infobox/vorkommen.ts";
import { leseProduktseite } from "../infobox/publikationen.ts";
import { analysiere } from "../infobox/seite.ts";
import { schluesselform } from "../infobox/text.ts";
import { publikationsSchluessel, weiterleitungsZiel } from "../schluessel.ts";
import { leseDump } from "./leser.ts";
import { eigeneKopie, type DumpKopf } from "./xml.ts";
import { zielInfoVonSeite } from "./ziel-info.ts";

/**
 * Ein Durchgang über den Dump für den Abgleich (WI-0253 C): hält von den GESUCHTEN Titeln (den Adressen der Zuordnungen) den Wikitext, und von allen
 * anderen Seiten in einem Einsammel-Raum der Tafel nur Titel, Raum und die Art ihrer Infobox – damit ein neuer Artikel erkannt wird, ohne dass der Dump im
 * Speicher steht (rund 253.000 Seiten, 315 MB entpackt; gehalten werden ein paar tausend Texte und ein paar zehntausend kurze Zeilen).
 *
 * Verglichen wird der Titel wörtlich, wie der Dump ihn führt; hier wird kein Key gerechnet. Ein Titel, der zweimal vorkommt, ist ein Befund (mehrdeutig),
 * nie eine stille Wahl.
 */

export interface GelesenerDumpArtikel {
    titel: string;
    ns: number;
    /** Das Ziel einer Weiterleitung; `null` bei einem Artikel. */
    weiterleitung: string | null;
    /** Der Wikitext; leer bei einer Weiterleitung. */
    text: string;
}

export interface KandidatNeuerArtikel {
    titel: string;
    ns: number;
    /** Der Name der Infobox („Siedlung“); bei einem Werk mit seiner Art („Produkt (Gruppenabenteuer)“). */
    infobox: string;
    /** Die Art der Karte, wie Legacy sie einsortiert, oder `literatur`: ein Werk der Spielliteratur (`{{Infobox Produkt}}`), das Legacy in den Katalog genommen hätte. */
    art: Exclude<Entitaet, ""> | "literatur" | "vorkommen";
}

/** Eine Seite für die Orts-Artikel (WI-0295): der Artikel mit seiner Seitennummer; `null`, wo der Dump keine nennt. */
export interface OrtArtikelSeite extends GelesenerDumpArtikel {
    id: number | null;
}

/** Eine Seite des Dumps mit ihrer Nummer (`<id>` der Seite, nicht der Revision): die Brücke zur Datei `dump_categorylinks.sql.gz` (`cl_from`, WI-0294). */
export interface SeiteImDump {
    id: number;
    ns: number;
    /** Die Seite ist eine Weiterleitung: Sie hat keine eigenen Kategorien, die des Ziels zählen. */
    weiterleitung: boolean;
}

export interface SeitenErgebnis {
    seiten: number;
    vollstaendig: boolean;
    kopf: DumpKopf | null;
    neuesteRevision: string | null;
    /** Alle Seiten mit einem gesuchten Titel; mehr als eine je Titel macht ihn mehrdeutig. */
    gefunden: ReadonlyMap<string, readonly GelesenerDumpArtikel[]>;
    /** Seiten je Namensraum (alle, auch die unbekannten). */
    namensraeume: ReadonlyMap<number, number>;
    /**
     * Artikel in Einsammel-Räumen mit einer Infobox, die Legacy als Karten-Art kennt – gleich, ob die Karte sie schon hat –, und Werke der Spielliteratur, die Legacys
     * Literatur-Abgleich in den Katalog genommen hätte (Art der Spielliteratur und eine Ortsliste, `leseProdukt`).
     */
    kandidaten: readonly KandidatNeuerArtikel[];
    /**
     * Die Produktseiten und Weiterleitungen des Dumps (nur mit der Option `katalog`, für den Bereich `quelle`): Legacys Katalogschritt (`avesmapsPublicationBuildCatalogStep`: jede Seite eines
     * Inhaltsraums mit der Infobox `Produkt`, ohne Weiterleitung) und seine Tafel der Aliase (`avesmapsWikiDumpCollectRedirectAliases`: jede Weiterleitung jedes Raums, die letzte gewinnt).
     */
    katalog?: PublikationsKatalog;
    /**
     * Nur mit der Option `vorkommen` (für den Bereich `vorkommen`) oder `regionArtikel` (WI-0284: die Welt eines Eintrags): was der Dump über mögliche Linkziele der Ortszeilen weiß (Weiterleitung, zählende Infobox
     * und Kategorien, Elternkette), je Titel einer Seite des Hauptraums und des Objektraums. Daraus entscheidet die Rolle eines Links (`abgleich/ortsrolle.ts`).
     */
    ziele?: ReadonlyMap<string, ZielInfo>;
    /**
     * Nur mit der Option `sprachen` (für den Bereich `sprachen`, WI-0261 S3): ALLE Artikel mit `{{Infobox Sprache}}` als erster Infobox in einem Einsammel-Raum der Tafel, mit ihrem Text
     * (rund 150 Seiten), gleich ob die Karte sie kennt und ob sie aventurisch sind: Der Bereich ist artikelzentriert, der Plan entscheidet über Anlegen, Ändern und Stilllegen.
     */
    sprachen?: readonly GelesenerDumpArtikel[];
    /**
     * Nur mit der Option `landmarken` (für den Bereich `landmarken`, WI-0271 L7): ALLE Landmarken-Artikel (`{{Infobox Region}}` mit einer Art der Abbildung oder die Kategorie
     * Süßwasserquelle, `infobox/landmarke.ts`) in einem Einsammel-Raum, mit ihrem Text (einige hundert Seiten), gleich ob eine Landmarke der Karte sie trägt: Der Plan entscheidet.
     */
    landmarken?: readonly GelesenerDumpArtikel[];
    /** Nur mit der Option `regionArtikel` (für den Bereich `region`, WI-0284): ALLE Artikel, die als Wiki-Eintrag in die Liste der Derographie gehören (`infobox/region-artikel.ts`), mit ihrem Text, gleich ob eine Fläche sie trägt: Der Plan entscheidet. */
    regionArtikel?: readonly GelesenerDumpArtikel[];
    /**
     * Nur mit der Option `ortArtikel` (für den Bereich `ort`, WI-0295): ALLE Seiten eines Einsammel-Raums, deren erste Infobox eine der Bauwerke oder der Siedlungen ist (`klassifiziere`), mit Text und
     * Seitennummer (die Brücke zur Kategorien-Datei), gleich ob die Karte sie kennt: Der Plan entscheidet (`abgleich/ort-artikel.ts`). Rund 7.000 Seiten, 12 MB Text (lokaler Dump vom 11.10.).
     */
    ortArtikel?: readonly OrtArtikelSeite[];
    /**
     * Nur mit der Option `kategorien` (WI-0294): die Verbindung zur Kategorien-Datei. `titelJeId` nennt zu den VERLANGTEN Seitennummern den Titel (auch einer Kategorieseite, Namensraum 14),
     * `seiteJeTitel` zu den GESUCHTEN Titeln die Seite. Nie ein Verzeichnis aller Titel (siehe `titel-sammler.ts`); eine Nummer oder ein Titel, den der Dump nicht kennt, fehlt einfach.
     */
    kategorien?: {
        titelJeId: ReadonlyMap<number, string>;
        seiteJeTitel: ReadonlyMap<string, SeiteImDump>;
    };
}

/** Die Namensräume, in denen Legacy Vorkommen liest (`avesmapsWikiNamespaceCarriesEntities`; WI-0253 §17): der Hauptraum und die Objekte. */
const VORKOMMEN_RAEUME: ReadonlySet<number> = new Set([0, 222]);

export async function sammleSeiten(
    pfad: string,
    gesucht: ReadonlySet<string>,
    tafel: WikiNamespaceTafel,
    optionen: {
        bzip2?: string | undefined;
        beiFortschritt?: ((seiten: number) => void) | undefined;
        /** Auch die Produktseiten und Weiterleitungen sammeln (die Quellen brauchen sie; der Durchgang bleibt einer). */
        katalog?: boolean | undefined;
        /** Auch die Auskunft über mögliche Linkziele sammeln und die Artikel mit einer Vorkommen-Infobox als Kandidaten merken (der Bereich `vorkommen` braucht sie; der Durchgang bleibt einer). */
        vorkommen?: boolean | undefined;
        /** Auch die Sprachartikel mit ihrem Text sammeln (der Bereich `sprachen` braucht sie; der Durchgang bleibt einer). */
        sprachen?: boolean | undefined;
        /** Auch die Landmarken-Artikel mit ihrem Text sammeln (der Bereich `landmarken` braucht sie; der Durchgang bleibt einer). */
        landmarken?: boolean | undefined;
        /** Auch die Wiki-Einträge ohne Fläche mit ihrem Text sammeln (der Bereich `region` braucht sie; der Durchgang bleibt einer). */
        regionArtikel?: boolean | undefined;
        /** Auch die Orts- und Bauwerk-Artikel mit Text und Seitennummer sammeln (der Bereich `ort` braucht sie, WI-0295; der Durchgang bleibt einer). */
        ortArtikel?: boolean | undefined;
        /** Auch die Seitennummern sammeln, die die Kategorien-Datei braucht: Titel zu den verlangten Nummern, Nummer zu den gesuchten Titeln (der Durchgang bleibt einer). */
        kategorien?: { ids: ReadonlySet<number> } | undefined;
    } = {},
): Promise<SeitenErgebnis> {
    const produkte = new Map<string, Produkt>();
    const weiterleitungen = new Map<string, string>();
    const gefunden = new Map<string, GelesenerDumpArtikel[]>();
    const namensraeume = new Map<number, number>();
    const kandidaten: KandidatNeuerArtikel[] = [];
    const ziele = new Map<string, ZielInfo>();
    const sprachen: GelesenerDumpArtikel[] = [];
    const landmarken: GelesenerDumpArtikel[] = [];
    const regionArtikel: GelesenerDumpArtikel[] = [];
    const ortArtikel: OrtArtikelSeite[] = [];
    const titelJeId = new Map<number, string>();
    const seiteJeTitel = new Map<string, SeiteImDump>();
    // Die Einsammel-Räume der Tafel, einmal gelesen.
    const einsammeln = new Map<number, boolean>();
    const sammelt = (ns: number): boolean => {
        const bekannt = einsammeln.get(ns);
        if (bekannt !== undefined) return bekannt;
        const wert = wikiNamespaceZeile(tafel, ns)?.einsammeln === true;
        einsammeln.set(ns, wert);
        return wert;
    };
    // Die Auskunft über Linkziele brauchen die Vorkommen (Rollen), die Wiki-Einträge ohne Fläche (Welt) und die Orts-Artikel (Welt, Weiterleitungen der Standort-Kette).
    const mitZielen = optionen.vorkommen === true || optionen.regionArtikel === true || optionen.ortArtikel === true;
    let kopf: DumpKopf | null = null;
    let vollstaendig = false;
    let seiten = 0;
    let neueste: string | null = null;

    for await (const teil of leseDump(pfad, { mitText: true, bzip2: optionen.bzip2 })) {
        if (teil.art === "kopf") {
            kopf = teil.kopf;
            continue;
        }
        if (teil.art === "ende") {
            vollstaendig = teil.vollstaendig;
            continue;
        }
        const { seite } = teil;
        seiten += 1;
        namensraeume.set(seite.ns, (namensraeume.get(seite.ns) ?? 0) + 1);
        const zeit = seite.revision?.zeit ?? null;
        if (zeit !== null && (neueste === null || zeit > neueste)) neueste = zeit;
        if (optionen.kategorien !== undefined && seite.id !== null) {
            if (optionen.kategorien.ids.has(seite.id)) titelJeId.set(seite.id, seite.titel);
            if (gesucht.has(seite.titel) && !seiteJeTitel.has(seite.titel)) {
                seiteJeTitel.set(seite.titel, {
                    id: seite.id,
                    ns: seite.ns,
                    weiterleitung: seite.weiterleitung !== null,
                });
            }
        }
        if (gesucht.has(seite.titel)) {
            const liste = gefunden.get(seite.titel) ?? [];
            liste.push({
                titel: seite.titel,
                ns: seite.ns,
                weiterleitung: seite.weiterleitung,
                // Eigene Kopie: Der Text lebt bis zum Vergleich, ein Ausschnitt hielte den Lesepuffer fest (`dump/xml.ts`, `eigeneKopie`).
                text: seite.weiterleitung === null ? eigeneKopie(seite.text) : "",
            });
            gefunden.set(seite.titel, liste);
        }
        if (optionen.katalog === true) {
            if (seite.weiterleitung !== null) {
                const alias = publikationsSchluessel(seite.titel);
                const ziel = weiterleitungsZiel(seite.weiterleitung);
                if (alias !== "" && ziel !== "") weiterleitungen.set(alias, ziel);
            } else if (wikiNamespaceZeile(tafel, seite.ns) !== undefined) {
                const produkt = leseProduktseite(seite.titel, seite.text);
                const schluessel = produkt === null ? "" : publikationsSchluessel(seite.titel);
                if (produkt !== null && schluessel !== "") {
                    produkte.set(schluessel, {
                        seite: seite.titel,
                        ns: seite.ns,
                        titel: eigeneKopie(produkt.titel),
                        adresse: produkt.adresse === null ? null : eigeneKopie(produkt.adresse),
                        quellenart: eigeneKopie(produkt.quellenart),
                    });
                }
            }
        }
        if (mitZielen && VORKOMMEN_RAEUME.has(seite.ns)) {
            const auskunft = zielInfoVonSeite(seite);
            if (auskunft !== undefined) ziele.set(seite.titel, auskunft);
        }
        if (optionen.vorkommen === true && VORKOMMEN_RAEUME.has(seite.ns)) {
            // Ein Artikel mit einer der vier Infoboxen: ein Vorkommen (Legacy erkennt allein den Namen der ersten Infobox). Ob die Karte ihn schon kennt, entscheidet der Plan.
            if (seite.weiterleitung === null && seite.text.includes("{{")) {
                const kasten = infoboxName(seite.text);
                if (artDerInfobox(kasten) !== null)
                    kandidaten.push({
                        titel: seite.titel,
                        ns: seite.ns,
                        infobox: eigeneKopie(kasten),
                        art: "vorkommen",
                    });
            }
        }
        // Ein Sprachartikel: erste Infobox `Sprache`, nur in den Einsammel-Räumen (Hauptraum und Inoffiziell; der Raum „Die Schwarze Katze“ und die Hilfe der Vorlage bleiben draußen).
        if (
            optionen.sprachen === true &&
            seite.weiterleitung === null &&
            sammelt(seite.ns) &&
            seite.text.includes("{{") &&
            istSprachInfobox(infoboxName(seite.text))
        ) {
            sprachen.push({ titel: seite.titel, ns: seite.ns, weiterleitung: null, text: eigeneKopie(seite.text) });
        }
        // Ein Landmarken-Artikel: zuerst billig (Infobox Region oder die Kategorie im Text), dann die Regel selbst (`landmarkenArtDerSeite`, dieselbe wie im Plan).
        if (optionen.landmarken === true && seite.weiterleitung === null && sammelt(seite.ns)) {
            const region = seite.text.includes("{{") && schluesselform(infoboxName(seite.text)).includes("region");
            if (
                (region || seite.text.includes("Süßwasserquelle")) &&
                landmarkenArtDerSeite(analysiere(seite.titel, seite.text)) !== null
            ) {
                landmarken.push({
                    titel: seite.titel,
                    ns: seite.ns,
                    weiterleitung: null,
                    text: eigeneKopie(seite.text),
                });
            }
        }
        // Ein Wiki-Eintrag ohne Fläche (WI-0284): zuerst billig die Infobox (oder Infobox und Kategorie eines Winds, WI-0288 Stufe 6), dann die Regel selbst (dieselbe wie im Plan).
        if (
            optionen.regionArtikel === true &&
            seite.weiterleitung === null &&
            sammelt(seite.ns) &&
            ((seite.text.includes("{{") && schluesselform(infoboxName(seite.text)).includes("region")) ||
                koennteWindSein(seite.text)) &&
            gehoertZurFlaechenliste(analysiere(seite.titel, seite.text))
        ) {
            regionArtikel.push({
                titel: seite.titel,
                ns: seite.ns,
                weiterleitung: null,
                text: eigeneKopie(seite.text),
            });
        }
        // Ein Orts- oder Bauwerk-Artikel (WI-0295): die erste Infobox nach Legacys Klassifikator; ob er dazugehört, entscheidet der Plan mit den Kategorien.
        if (
            optionen.ortArtikel === true &&
            seite.weiterleitung === null &&
            sammelt(seite.ns) &&
            seite.text.includes("{{")
        ) {
            const art = klassifiziere(schluesselform(infoboxName(seite.text)));
            if (art === "bauwerk" || art === "ort") {
                ortArtikel.push({
                    titel: seite.titel,
                    ns: seite.ns,
                    weiterleitung: null,
                    text: eigeneKopie(seite.text),
                    id: seite.id,
                });
            }
        }
        if (seite.weiterleitung === null && sammelt(seite.ns)) {
            const name = infoboxName(seite.text);
            if (name !== "" && schluesselform(name) === "produkt") {
                // Ein Werk: nur, wenn Legacy es in den Katalog genommen hätte (sonst wäre jedes Hörbuch und jeder Regelband ein „Artikel ohne Werk“).
                const werk = leseProdukt(analysiere(seite.titel, seite.text));
                if (werk.ok && werk.katalog) {
                    kandidaten.push({
                        titel: seite.titel,
                        ns: seite.ns,
                        infobox: eigeneKopie(`${name} (${werk.art})`),
                        art: "literatur",
                    });
                }
            } else if (name !== "") {
                const schluessel = schluesselform(name);
                let art = klassifiziere(schluessel);
                // Ein Wasserlauf mit Landform-Art gilt als Landschaft; nur dafür muss die Seite ganz zerlegt werden.
                if (art === "weg") art = entitaetDerSeite(analysiere(seite.titel, seite.text));
                if (art !== "") kandidaten.push({ titel: seite.titel, ns: seite.ns, infobox: eigeneKopie(name), art });
            }
        }
        if (seiten % 1000 === 0) optionen.beiFortschritt?.(seiten);
    }
    return {
        seiten,
        vollstaendig,
        kopf,
        neuesteRevision: neueste,
        gefunden,
        namensraeume,
        kandidaten,
        ...(optionen.katalog === true ? { katalog: { produkte, weiterleitungen } } : {}),
        ...(mitZielen ? { ziele } : {}),
        ...(optionen.sprachen === true ? { sprachen } : {}),
        ...(optionen.landmarken === true ? { landmarken } : {}),
        ...(optionen.regionArtikel === true ? { regionArtikel } : {}),
        ...(optionen.ortArtikel === true ? { ortArtikel } : {}),
        ...(optionen.kategorien !== undefined ? { kategorien: { titelJeId, seiteJeTitel } } : {}),
    };
}
