import type { WikisyncBereich, WikisyncUebernahmeBefund } from "@avesmaps3d/shared";
import type { Queryable } from "../../../database.ts";
import type { MapAuditEntry, MapAuditKind, MapChange } from "../../../editor/map-operation.ts";
import type { PlanObjekt } from "../plan.ts";
import type { VorschauZeile } from "./protokoll.ts";

/**
 * Der Schreiber eines Bereichs (WI-0253 D-1): die EINE Stelle, an der die Übernahme und die Rücknahme in die Fachtafeln eines Bereichs schreiben. Die Entscheidung,
 * WAS geschrieben wird (`entscheiden.ts`), und das Protokoll (`uebernehmen.ts`, `zuruecknehmen.ts`) sind für alle Bereiche dieselben; was je Bereich verschieden ist,
 * steht hier: welche Spalte ein Feld ist, wo sein Wiki-Wert (der Schnappschuss) steht, wie ein Objekt gesperrt und berührt wird und welche Regeln der Bereich
 * zusätzlich kennt (bei den Kraftlinien: der Name bindet die Abschnitte).
 *
 * Ein Feld hat bis zu ZWEI Stellen, die die Übernahme schreibt:
 * - **wirksam**: die Spalte am Objekt, die die Karte zeigt (`powerline.description`). Nur Felder, die das Objekt selbst führt (`LOKALE_FELDER`), und nur, wo der Wert dem Wiki
 *   FOLGT: Er trägt den Vermerk „wiki“ (`field_origin`, bei Orten und Gebieten an ihrer eigenen Stelle). Ein leeres Feld hat keinen eigenen Wert zu pflegen: Der Leser zeigt
 *   dann den Wiki-Wert (`powerline.description`: „Leer heißt: folgt dem Wiki“), es genügt der Schnappschuss. Den Vermerk selbst liest die Übernahme, sie schreibt ihn nie.
 * - **schnappschuss**: der Wiki-Wert hinter ↺ (`wiki_*_snapshot`). Den schreibt die Übernahme IMMER, die wirksame Spalte nur bei Herkunft wiki.
 *
 * Ein Bereich OHNE Wiki-Stand (die Literatur: ein Werk ist sein eigener Stand, `fuelltLeereFelder`) hat nur die wirksame Spalte. Dort gibt es keinen Leser, der auf
 * einen Wiki-Wert zurückfällt; ein leeres Feld, das dem Wiki gehört, füllt die Übernahme deshalb in der Spalte selbst, und der Schreiber setzt dabei den Vermerk
 * „wiki“ (sonst wäre der Wert beim nächsten Lauf unbelegt).
 *
 * 🔴 Ein Schreiber ändert nie eine Zuordnung (Adresse, Zustand, Herkunft der Zuordnung) und legt für ein Objekt keinen Schnappschuss an (ein Wiki-Eintrag ohne Fläche, `region-artikel.ts`, ist selbst das Objekt): Eine Zuordnung ändert dieser Abgleich nie
 * (Work Item §3a). Mit jedem Bereich, den eine spätere Scheibe anschließt, wächst `SCHREIBER` und `WIKISYNC_ANGESCHLOSSEN` (`packages/shared`).
 */

/**
 * Ein Feld an einem Objekt, wie die Übernahme es ändert: jede Stelle nur, wenn sie sich ändert. `unbekannt`: Der Wiki-Wert war im Schnappschuss als unbekannt geführt
 * (Legacy lieferte ihn nie: ein Override verdeckte ihn, die Ortsgröße war geraten); mit dem Schreiben ist er bekannt, und die Rücknahme stellt die Marke wieder her.
 */
export interface FeldSchritt {
    objekt: PlanObjekt;
    feld: string;
    wirksam?: { vorher: string | null; nachher: string | null };
    schnappschuss?: { vorher: string | null; nachher: string | null; unbekannt?: boolean };
}

/** Ein Feld, das nicht geschrieben wird, mit dem Grund. */
export interface BefundSchritt {
    objektId: string;
    objektArt: string;
    objektName: string | null;
    feld: string | null;
    befund: WikisyncUebernahmeBefund;
    grund: string;
}

export type StellenName = "wirksam" | "schnappschuss" | "unbekannt";

/**
 * Wie heißt eine Stelle eines Felds im Fachprotokoll (`changes`)? wirksam: das Feld selbst (oder, wo das Fachprotokoll es anders nennt, `namen[feld]`: die Ortsgröße
 * `settlement_class` heißt dort `subtype`); der Wiki-Wert: `wiki<Feld>`; die Marke „Wiki-Wert unbekannt“: `wiki<Feld>Unbekannt`.
 */
export function auditSchluessel(feld: string, stelle: StellenName, namen?: Readonly<Record<string, string>>): string {
    if (stelle === "wirksam") return namen?.[feld] ?? feld;
    const grund = `wiki${feld
        .split("_")
        .map((teil) => teil.charAt(0).toUpperCase() + teil.slice(1))
        .join("")}`;
    return stelle === "schnappschuss" ? grund : `${grund}Unbekannt`;
}

/** Welche Marken „Wiki-Wert unbekannt“ ein Schreiben löscht (`bekannt`) und die Rücknahme wieder setzt (`unbekannt`), als Feldnamen des Plans. */
export interface SchnappschussMarken {
    bekannt: readonly string[];
    unbekannt: readonly string[];
}

/** Das Ergebnis von `pruefe`: die Schritte, die bleiben, die Befunde zu denen, die fallen, (der Schnappschuss bleibt). */
export interface PruefErgebnis {
    schritte: FeldSchritt[];
    befunde: BefundSchritt[];
}

/** Was ein Listen-Schreiber aus den Zeilen seiner Liste macht: Schritte, Befunde und wie oft schon alles stimmte. */
export interface ListenErgebnis<S> {
    schritte: S[];
    befunde: BefundSchritt[];
    schonGleich: number;
}

/**
 * Eine LISTE an einem Objekt, deren Einträge keine Spalten sind (die Ortsliste eines Werks, WI-0253 Scheibe Ortslisten): Ihre Zeilen in der Vorschau tragen ein eigenes Feld
 * (`ort_<Stelle>`), die Übernahme gibt sie hierher statt an `entscheiden.ts`. Im Fachprotokoll steht die Liste vorher und nachher unter EINEM Schlüssel (`auditSchluessel`),
 * daraus nimmt die Rücknahme zurück.
 */
export interface ListenSchreiber<S extends { objekt: PlanObjekt }> {
    /**
     * Gehört eine Zeile (ihr Feld) zu dieser Liste? Meist entscheidet das Feld allein; die Sprachen (WI-0261 S3) entscheiden über die Zeile: Die Zeilen eines Artikels, den der Bestand noch
     * nicht hat, hängen an einer Platzhalter-Kennung und gehören dem Listen-Schreiber, der ihn anlegt.
     */
    feldGehoert(feld: string, zeile: VorschauZeile): boolean;
    /** Der Schlüssel im Fachprotokoll (`MAP_AUDIT_FIELDS`), unter dem die Liste vorher und nachher steht. */
    readonly auditSchluessel: string;
    /** Entscheidet die Zeilen gegen den Stand von jetzt (rein, unter der Sperre der Objekte gerufen). */
    entscheide(zeilen: readonly VorschauZeile[], objekte: ReadonlyMap<string, PlanObjekt>): ListenErgebnis<S>;
    /** Schreibt die Schritte; liefert je Objekt den Eintrag fürs Fachprotokoll (nur, wo sich die Liste änderte). */
    schreibe(tx: Queryable, schritte: readonly S[]): Promise<Map<string, MapChange>>;
    /**
     * Nach allen Schreibzugriffen der Übernahme (wo die Liste Objekte ANLEGT, die es beim Entscheiden noch nicht gab, oder eine Folge hat, die erst nach den Schritten aller Objekte zu rechnen ist, das Etikett
     * der Träger bei den Quellen): liefert die Einträge fürs Fachprotokoll und die Gegenstände der Quittung, dazu Zahlen fürs Protokoll der Übernahme.
     */
    schliesseAb?(
        tx: Queryable,
        schritte: readonly S[],
    ): Promise<{
        entries: MapAuditEntry[];
        affected: { kind: string; id: string; revision: number }[];
        zahlen?: Record<string, number>;
    }>;
    /**
     * Nimmt den Eintrag einer Übernahme an EINEM Objekt zurück, bedingt auf den Stand der Übernahme. `eintrag` ist der ganze Eintrag des Fachprotokolls dieses Objekts (alle Schlüssel), wo die Rücknahme mehr
     * braucht als die Liste (bei den Quellen: ob die Übernahme die Quelle angelegt hat).
     */
    nimmZurueck(
        tx: Queryable,
        objektId: string,
        wechsel: MapChange,
        objekt: PlanObjekt | undefined,
        eintrag?: Readonly<Record<string, MapChange>>,
    ): Promise<{ change: MapChange | null; befunde: BefundSchritt[]; anzahl: number }>;
}

/** Die Schreiber eines Bereichs: meist nur er selbst, sonst er und sein `neben`. */
export const schreiberDes = (schreiber: Schreiber): readonly Schreiber[] =>
    schreiber.neben === undefined ? [schreiber] : [schreiber, schreiber.neben];

/** Die Zeilen eines Laufs, die einem der Schreiber des Bereichs gehören; hat der Bereich nur einen, alle. Zeilen ohne Objekt (ein Artikel als Befund) schreibt ohnehin keiner. */
export const zeilenDes = <Z extends { objektArt: string }>(
    zeilen: readonly Z[],
    schreiber: Schreiber,
    teil: Schreiber,
): readonly Z[] =>
    schreiber.neben === undefined ? zeilen : zeilen.filter((zeile) => zeile.objektArt === teil.objektArt);

export interface Schreiber {
    readonly bereich: WikisyncBereich;
    /** Die Art des Gegenstands im Fachprotokoll (`MAP_AUDIT_FIELDS`), im Namen der Einträge und in der Quittung. */
    readonly protokollArt: MapAuditKind;
    /** Die Art in `PlanZeile.objektArt` (`powerline`). */
    readonly objektArt: string;
    /** Wie die Quittung den Gegenstand nennt (`affected[].kind`, `powerline`). */
    readonly affectedArt: string;
    /** Das Ziel eines Eintrags im Fachprotokoll (`{ powerlineId }`) und die Spalte, in der es steht (`powerline_public_id`). */
    eintragZiel(
        id: string,
    ): Pick<
        MapAuditEntry,
        | "powerlineId"
        | "placeId"
        | "pathId"
        | "territoryId"
        | "peakId"
        | "regionId"
        | "workId"
        | "sourceId"
        | "loreId"
        | "spracheArtikelId"
        | "landmarkeArtikelId"
        | "regionArtikelId"
        | "ortArtikelId"
    >;
    readonly zielSpalte: string;
    /** Feld → Spalte am Objekt, für die Felder, die das Objekt selbst führt. */
    readonly wirksameSpalten: Readonly<Record<string, string>>;
    /** Feld → Spalte im Schnappschuss, für alle Felder, die der Bereich schreibt. */
    readonly schnappschussSpalten: Readonly<Record<string, string>>;
    /** Nennt das Fachprotokoll ein wirksames Feld anders als der Plan? Feld → Schlüssel in `MAP_AUDIT_FIELDS` (Ortsgröße: `settlement_class` → `subtype`). */
    readonly auditNamen?: Readonly<Record<string, string>>;
    /** Felder, deren Wiki-Wert der Schnappschuss als unbekannt führen kann: Mit dem Schreiben des Werts wird die Marke gelöscht (`schreibeSchnappschuss`). */
    readonly unbekanntFelder?: ReadonlySet<string>;
    /**
     * Hat der Bereich keinen Wiki-Stand hinter dem Objekt (die Literatur)? Dann schreibt die Übernahme ein LEERES Feld, das dem Wiki gehört (kein Vermerk, kein Wert),
     * in die wirksame Spalte, und `schreibeObjekt` setzt für einen geschriebenen Wert den Vermerk „wiki“. Ohne Angabe: nein (der Leser zeigt dann den Wiki-Stand).
     */
    readonly fuelltLeereFelder?: boolean;
    /** Eine Liste am Objekt, deren Zeilen nicht über Spalten gehen (die Ortsliste der Literatur). */
    readonly liste?: ListenSchreiber<{ objekt: PlanObjekt }>;
    /**
     * Ein zweiter Schreiber im selben Bereich, wo ein Bereich zwei Fachtafeln führt (die Landmarken, WI-0271: die platzierten und die Kandidaten ohne Landmarke auf der Karte). Ein Lauf bleibt EINE Operation und
     * EINE Zeile im Protokoll der Übernahme; die Zeilen und Einträge gehen je `objektArt` und `zielSpalte` an ihren Schreiber (`schreiberDes`).
     */
    readonly neben?: Schreiber;
    /** Die Objekte, die dieser Schreiber führt, wo sie nicht der Lader des Bereichs liefert (die Kandidaten der Landmarken). */
    objekte?(db: Queryable): Promise<PlanObjekt[]>;
    /**
     * Gehen die geschriebenen Felder in ein abgeleitetes Ergebnis ein (Wegnamen auf der Karte, Beschriftungen, Gebietsableitung)? `false`: kein Auftrag danach, nur die
     * Kachelrevision. Ohne Angabe gilt `true` (im Zweifel rechnet die Ableitung neu).
     */
    leitetAb?(schritte: readonly FeldSchritt[]): boolean;

    /**
     * Sperrt die Objekte (in fester Reihenfolge, gegen jeden Editor und jeden zweiten Lauf) samt den Schnappschüssen, an denen sie hängen, und liefert die Revision
     * je Objekt. Ein Objekt, das nicht (mehr) aktiv ist, fehlt.
     */
    sperre(tx: Queryable, ids: readonly string[]): Promise<ReadonlyMap<string, number>>;
    /** Die Schnappschuss-Kennung je Objekt (das Objekt hängt an genau einem); fehlt, wenn es keinen hat. */
    schnappschussIds(tx: Queryable, ids: readonly string[]): Promise<ReadonlyMap<string, string>>;
    /** Prüft die Regeln des Bereichs gegen die Schritte; liefert die Schritte, die bleiben, und die Befunde zu denen, die fallen (der Schnappschuss bleibt). */
    pruefe(tx: Queryable, schritte: readonly FeldSchritt[]): Promise<PruefErgebnis>;
    /** Schreibt die Spalten EINES Objekts (leer: berührt es nur) und liefert seine neue Revision. Genau ein UPDATE: Die Revision zählt einmal. */
    schreibeObjekt(tx: Queryable, id: string, spalten: Readonly<Record<string, string | null>>): Promise<number>;
    /** Schreibt Spalten EINES Schnappschusses und setzt oder löscht die Marken „Wiki-Wert unbekannt“. */
    schreibeSchnappschuss(
        tx: Queryable,
        schnappschussId: string,
        spalten: Readonly<Record<string, string | null>>,
        marken?: SchnappschussMarken,
    ): Promise<void>;
    /**
     * Folgen am Objekt, die ein geschriebener Wert nach sich zieht und die der Editor in derselben Operation mitschreibt (der Name einer Landschaft geht an die Beschriftungen,
     * die ihm folgen). Wird nach den Schreibzugriffen gerufen; liefert die Einträge des Fachprotokolls und die Gegenstände, die die Quittung nennt.
     */
    folgen?(
        tx: Queryable,
        schritte: readonly FeldSchritt[],
        revisionen: ReadonlyMap<string, number>,
    ): Promise<{ entries: MapAuditEntry[]; affected: { kind: string; id: string; revision: number }[] }>;
    /** Nimmt `folgen` einer Übernahme zurück, wo der Istwert noch dem Stand der Übernahme entspricht; liefert Einträge, Gegenstände und Befunde. */
    folgenZuruecknehmen?(
        tx: Queryable,
        operationId: string,
    ): Promise<{
        entries: MapAuditEntry[];
        affected: { kind: string; id: string; revision: number }[];
        befunde: BefundSchritt[];
    }>;
}
