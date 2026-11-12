import { gleichDemWiki, SOURCE_REFERENCE_KINDS, type SourceReferenceKind, type SourceType } from "@avesmaps3d/shared";
import type { Kreis } from "../editor-liste/liste-modell";

/**
 * Die Rechnung der Quellen-Klappbox (`quellen-klappbox.vue`, WI-0254 `--weiter`, Betreiber 2026-10-27/28: „wir bräuchten glaub ein mockup für quellen, damit man diese besser erkennt
 * (klappbox?)“, dann: „Klappbox Quellen zum Aufklappen -> ja“) ohne Vue: was die Box zeigt, wenn gesucht, gefiltert und sortiert wird, wie die Gruppen nach Art des Belegs heißen und
 * wie viele Quellen in welche fallen.
 *
 * - **Eine Form für jede Quellenliste:** `KlappQuelle` ist, was die Box braucht, gleich woher die Quelle kommt (der Entwurf des Reiters „Vorkommen“, die Quellen eines
 *   Ortes, Gebiets, einer Landschaft oder eines Wegs). Der Aufrufer rechnet den Kreis (nach dem Wiki, `wikiKreis`; `null`, wo die Herkunft unbekannt ist) und die Notiz zur Anzeige (ohne Vorlagen,
 *   `inhalte/wiki-klartext.ts`); die Box ändert nichts, sie meldet.
 * - **Art des Belegs** (`SourceReferenceKind`) ist die Gruppe: Ausführlich, Ergänzend, Erwähnung, dann die ohne Art (eine echte Quelle, die nichts über die Ausführlichkeit sagt).
 * - **Suche** ist die Regel jeder Liste im Haus (jedes Wort muss vorkommen) über einem Suchschlüssel, der Groß- und Kleinschreibung, Umlaute, ß und Akzente gleichsetzt: „Müller“, „mueller“
 *   und „Muller“ finden dieselbe Quelle. Gesucht wird im Titel.
 * - **Stille Quellen** (unterdrückt oder gelöst) stehen nur da, wenn man sie zeigen lässt; sie sortieren hinter die aktiven ihrer Gruppe.
 */

/** Der Zustand einer Verknüpfung, wie die Verträge ihn führen (`InhalteVorkommenZustand`). */
export type KlappZustand = "active" | "retired" | "suppressed";

/** Eine Quelle, wie die Box sie zeigt. */
export interface KlappQuelle {
    /** Die Kennung, unter der die Box Zeilen auf- und zuklappt und Änderungen meldet. */
    readonly id: string;
    readonly titel: string;
    /** Die Art des Belegs; `null`: eine Quelle ohne Angabe. */
    readonly art: SourceReferenceKind | null;
    readonly seiten: string;
    /** Die Notiz zur Anzeige (Vorlagen und Links des Wikis als Text). */
    readonly notiz: string;
    /** Der Typ der Quelle im Katalog; `null`, wo er (noch) nicht bekannt ist. */
    readonly typ: SourceType | null;
    /** Ob die Quelle offiziell ist; `null`, wo erst der Server es weiß (eine eben angehängte). */
    readonly offiziell: boolean | null;
    readonly url: string | null;
    /** ○ nicht aktiv, ● das Wiki zitiert dasselbe, sonst ◐ (`wikiKreis`); `null`, wo es keinen Lauf mit Zitaten gibt (die Herkunft ist unbekannt). */
    readonly kreis: Kreis | null;
    readonly state: KlappZustand;
    /** Im Entwurf angehängt, noch nicht gespeichert. */
    readonly neu: boolean;
    /**
     * Was das Wiki an diesem Gegenstand zu der Quelle zitiert (WI-0254 §12: Editoren der Karte und Reiter Vorkommen); fehlt oder `null`, wo es keinen Lauf gibt oder das Wiki die Quelle nicht zitiert.
     * Weicht es ab (Kreis ◐), nennt die offene Box „Im Wiki: …“, und bearbeitbar steht „↺ Wiki-Wert“ dabei.
     */
    readonly wiki?: KlappWiki | null | undefined;
    /** Die Zeile wird gerade gespeichert (ein Schreiben pro Handlung, ohne Speichern-Knopf): Alle ihre Felder und Knöpfe sind kurz gesperrt. */
    readonly schreibt?: boolean | undefined;
    /** Der Satz, warum die letzte Handlung an dieser Zeile nicht ging (der Wert bleibt im Feld stehen). */
    readonly fehler?: string | undefined;
    /** Nur bei den Publikationen einer Karte (WI-0287): die Adresse des Umschlagbilds; fehlt oder `null`, steht ein leerer Platz da. */
    readonly bild?: string | null | undefined;
    /** Der Name des Korpus der Quelle (WI-0277); steht statt „Im Shop“ am Link. Fehlt oder `null`, wo sie keinen hat. */
    readonly korpus?: string | null | undefined;
}

/** Das Zitat des Wikis: Art des Belegs, Seiten und Notiz (roh, mit Vorlagen; die Box zeigt den Text). */
export interface KlappWiki {
    readonly art: SourceReferenceKind | null;
    readonly seiten: string;
    readonly notiz: string;
}

/** Was die Rechnung des Kreises braucht (Editoren der Karte). */
export interface KreisEingabe {
    readonly state: KlappZustand;
    /** Gibt es einen Lauf des WikiSync, aus dem Zitate stammen? Ohne ihn ist die Herkunft unbekannt: kein Kreis. */
    readonly lauf: boolean;
    /** Die gespeicherten Angaben der Verknüpfung (nicht, was gerade im Feld steht). */
    readonly art: SourceReferenceKind | null;
    readonly seiten: string | null;
    readonly notiz: string | null;
    /** Das Zitat des Wikis; `null`: Das Wiki zitiert die Quelle an diesem Gegenstand nicht. */
    readonly wiki: {
        readonly art: string | null;
        readonly seiten: string | null;
        readonly notiz: string | null;
    } | null;
    /** Beim Weg entscheidet der Server über die Straße als Ganzes (`abschnitte.gleichDemWiki`: voll nur, wenn jeder ihrer Abschnitte dem Zitat gleicht); dann zählt dies statt des Vergleichs oben. */
    readonly abschnitteGleich?: boolean | undefined;
}

/**
 * Der Kreis einer Verknüpfung nach dem Vergleich mit dem Wiki (WI-0254 §12; Vali 2026-10-27: „ist egal, wo er sie her hat, vergleich mit dem wiki, alles andere ist manuell“):
 * ○ nicht aktiv (unterdrückt oder gelöst) · kein Kreis (`null`), wo es keinen Lauf gibt, also nichts zu vergleichen · ● das Wiki zitiert dieselbe Quelle mit derselben Art, denselben Seiten und derselben Notiz
 * (`gleichDemWiki`: nach dem Kürzen, leer ist nichts) · sonst ◐ (manuell: auch Legacy ohne Zitat im Wiki und jede abweichende Angabe).
 */
export function wikiKreis(eingabe: KreisEingabe): Kreis | null {
    if (eingabe.state !== "active") return "leer";
    if (!eingabe.lauf) return null;
    if (eingabe.wiki === null) return "halb";
    const gleich =
        eingabe.abschnitteGleich ??
        gleichDemWiki(
            { art: eingabe.art, seiten: eingabe.seiten, notiz: eingabe.notiz },
            { art: eingabe.wiki.art, seiten: eingabe.wiki.seiten, notiz: eingabe.wiki.notiz },
        );
    return gleich ? "voll" : "halb";
}

/**
 * Was die Box meldet, wenn jemand die Angaben DIESER Verwendung ändert: die Art des Belegs (`null`: eine Quelle ohne Angabe), die Fundstelle oder die Notiz. Genau eines je Meldung. Die Namen sind die
 * des Vertrags (`InhalteVorkommenQuelleAenderung`), damit der Aufrufer sie durchreicht.
 */
export interface KlappAngaben {
    referenceKind?: SourceReferenceKind | null;
    pages?: string;
    note?: string;
}

/** Die Gruppe einer Quelle im Filter und in den Köpfen: die Art des Belegs oder `ohne`. */
export type ArtWahl = SourceReferenceKind | "ohne";

/** Die Gruppen in der Folge, in der sie stehen. */
export const KLAPP_ARTEN: readonly ArtWahl[] = [...SOURCE_REFERENCE_KINDS, "ohne"];

export const KLAPP_SORTIERUNGEN = ["art", "wiki", "titel"] as const;
/** `art`: gruppiert nach Art des Belegs, darin nach Titel · `wiki`: in der Folge, in der die Quellen kommen (die des Artikels) · `titel`: A–Z. */
export type KlappSortierung = (typeof KLAPP_SORTIERUNGEN)[number];

export const artWahl = (quelle: Pick<KlappQuelle, "art">): ArtWahl => quelle.art ?? "ohne";

/**
 * Der Suchschlüssel eines Textes: kleingeschrieben, ohne Akzente, ß als ss, Umlaut-Umschreibungen (ue, oe, ae) wie der Umlaut selbst, alles außer Buchstaben und Ziffern ein Leerzeichen.
 * 🪤 Auf Text und Suche gleich angewandt; allein ist er kein lesbarer Text („Quelle“ wird zu „qulle“).
 */
export function suchSchluessel(text: string | null | undefined): string {
    return (text ?? "")
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .toLowerCase()
        .replace(/ß/g, "ss")
        .replace(/ue/g, "u")
        .replace(/oe/g, "o")
        .replace(/ae/g, "a")
        .replace(/[^a-z0-9]+/g, " ")
        .trim();
}

/** Trifft die Suche den Titel? Jedes Wort der Suche muss im Titel vorkommen; eine leere Suche trifft alles. */
export function trifftSuche(titel: string, suche: string): boolean {
    const wortSchluessel = suchSchluessel(suche);
    if (wortSchluessel === "") return true;
    const text = suchSchluessel(titel);
    return wortSchluessel.split(" ").every((wort) => text.includes(wort));
}

/** Was die Box gerade zeigen soll. */
export interface KlappAnsicht {
    suche: string;
    arten: readonly ArtWahl[];
    typen: readonly SourceType[];
    sortierung: KlappSortierung;
    stilleZeigen: boolean;
    /** Die Sprache der Sortierung nach Titel; ohne Angabe Deutsch. */
    sprache?: string | undefined;
}

export const istZeigbar = (quelle: Pick<KlappQuelle, "state">, stilleZeigen: boolean): boolean =>
    quelle.state === "active" || stilleZeigen;

/** Die Quellen, die zur Ansicht passen, in der Folge der Sortierung. Die Liste selbst bleibt unberührt. */
export function sichtbare(liste: readonly KlappQuelle[], ansicht: KlappAnsicht): KlappQuelle[] {
    const treffer = liste.filter(
        (quelle) =>
            istZeigbar(quelle, ansicht.stilleZeigen) &&
            trifftSuche(quelle.titel, ansicht.suche) &&
            (ansicht.arten.length === 0 || ansicht.arten.includes(artWahl(quelle))) &&
            (ansicht.typen.length === 0 || (quelle.typ !== null && ansicht.typen.includes(quelle.typ))),
    );
    if (ansicht.sortierung === "wiki") return treffer;
    const sammler = new Intl.Collator(ansicht.sprache ?? "de");
    const aktivZuerst = (a: KlappQuelle, b: KlappQuelle): number =>
        Number(b.state === "active") - Number(a.state === "active");
    if (ansicht.sortierung === "titel") {
        return [...treffer].sort((a, b) => aktivZuerst(a, b) || sammler.compare(a.titel, b.titel));
    }
    return [...treffer].sort(
        (a, b) =>
            KLAPP_ARTEN.indexOf(artWahl(a)) - KLAPP_ARTEN.indexOf(artWahl(b)) ||
            aktivZuerst(a, b) ||
            sammler.compare(a.titel, b.titel),
    );
}

/** Eine Gruppe der Box: die Art des Belegs, ihre Quellen in der Folge der Eingabe und deren Zahl. */
export interface KlappGruppe {
    readonly art: ArtWahl;
    readonly quellen: readonly KlappQuelle[];
    readonly zahl: number;
}

/** Die Quellen in Gruppen nach Art des Belegs, in der Folge Ausführlich, Ergänzend, Erwähnung, ohne Art; eine Gruppe ohne Quelle fehlt. */
export function gruppenNachArt(liste: readonly KlappQuelle[]): KlappGruppe[] {
    return KLAPP_ARTEN.map((art) => {
        const quellen = liste.filter((quelle) => artWahl(quelle) === art);
        return { art, quellen, zahl: quellen.length };
    }).filter((gruppe) => gruppe.zahl > 0);
}

/** Wie viele Quellen der Liste je Art des Belegs und je Typ da sind (für die Zahlen im Filter); nur, was zeigbar ist. */
export interface KlappFilterZahlen {
    readonly arten: Readonly<Record<ArtWahl, number>>;
    readonly typen: Readonly<Partial<Record<SourceType, number>>>;
}

export function filterZahlen(liste: readonly KlappQuelle[], stilleZeigen: boolean): KlappFilterZahlen {
    const arten: Record<ArtWahl, number> = { ausfuehrlich: 0, ergaenzend: 0, erwaehnung: 0, ohne: 0 };
    const typen: Partial<Record<SourceType, number>> = {};
    for (const quelle of liste) {
        if (!istZeigbar(quelle, stilleZeigen)) continue;
        arten[artWahl(quelle)] += 1;
        if (quelle.typ !== null) typen[quelle.typ] = (typen[quelle.typ] ?? 0) + 1;
    }
    return { arten, typen };
}

/** Schränkt die Ansicht etwas ein (Suche oder Filter)? Dann steht „n von m“ da. */
export const istEingeschraenkt = (ansicht: Pick<KlappAnsicht, "suche" | "arten" | "typen">): boolean =>
    ansicht.suche.trim() !== "" || ansicht.arten.length > 0 || ansicht.typen.length > 0;

// --- Auf und zu ---

/** Eine Zeile auf- oder zuklappen; gibt eine neue Menge, die alte bleibt unberührt. */
export function schalteZeile(offen: ReadonlySet<string>, id: string): Set<string> {
    const neu = new Set(offen);
    if (neu.has(id)) neu.delete(id);
    else neu.add(id);
    return neu;
}

/** Stehen alle diese Zeilen offen? Ohne Zeilen: nein (der Knopf bietet dann „aufklappen“, nicht „zuklappen“). */
export const alleOffen = (ids: readonly string[], offen: ReadonlySet<string>): boolean =>
    ids.length > 0 && ids.every((id) => offen.has(id));

/** Alle diese Zeilen aufklappen; stehen sie schon alle offen, zuklappen. Andere Zeilen bleiben, wie sie sind. */
export function schalteAlle(offen: ReadonlySet<string>, ids: readonly string[]): Set<string> {
    const neu = new Set(offen);
    const zu = alleOffen(ids, offen);
    for (const id of ids) {
        if (zu) neu.delete(id);
        else neu.add(id);
    }
    return neu;
}
