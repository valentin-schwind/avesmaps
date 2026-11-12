import type {
    ApiErrorBody,
    OperationReceipt,
    WikiBoxArt,
    WikiBoxStand,
    WikiBoxSyncGrund,
    WikiTreffer,
} from "@avesmaps3d/shared";
import type { WikiFeldLage } from "./wiki-feld";

/**
 * Die Rechnung der Wiki-Box (WI-0253, Scheibe „Objekt-Sync am WikiFeld“; Entwurf `review/wi-0253/wikifeld-sync-mockup.html`, abgenommen 2026-10-25): wann welcher der drei Knöpfe gesperrt ist und warum, welche
 * Zeile den Stand nennt und welche Felder ein Sync ändern würde. Reine Rechnung ohne Vue und ohne Texte, damit Vitest sie prüft; das Bauteil (`wiki-box.vue`) setzt die Sätze.
 *
 * - **Drei Knöpfe, EIN Satz für die Gruppe:** Zuweisen (bzw. Ändern), Sync aktualisieren, Entfernen. Zuweisen und Entfernen wirken SOFORT auf dem Server, ohne „Speichern“; ein Entwurf des Fensters ginge
 *   beim Neulesen verloren. Darum sperren bei ungespeicherten Änderungen alle drei (Entwurf, vom Betreiber mit abgenommen).
 * - **Bei einer Drosselung (429)** ist nur der Sync bis zum genannten Zeitpunkt gesperrt („Später erneut“); Zuweisen und Entfernen bleiben.
 * - **Lokal gibt es keinen Abruf** (409 `abruf_gesperrt`): Der Sync ist gesperrt und nennt den Grund; Zuweisen und Entfernen wirken trotzdem.
 * - **Läuft ein Sync**, sperrt Zuweisen und Entfernen („Der Sync läuft noch“), und der Sync-Knopf macht der Fortschrittsanzeige Platz.
 */

/** Warum ein Knopf gerade nichts tut. Die Oberfläche macht daraus einen Satz. */
export type WikiBoxSperrGrund =
    | { readonly art: "ungespeichert" }
    | { readonly art: "beschaeftigt" }
    | { readonly art: "laeuft" }
    | { readonly art: "drossel"; readonly bis: Date }
    | { readonly art: "sync"; readonly grund: WikiBoxSyncGrund };

export interface WikiBoxLage {
    /** Gibt es die Knöpfe überhaupt? Nur mit Schreibrecht und eingeschaltetem Bearbeiten. */
    readonly knoepfe: boolean;
    /** Der Grund je Knopf; fehlt er, ist der Knopf frei. */
    readonly zuweisen: WikiBoxSperrGrund | undefined;
    readonly sync: WikiBoxSperrGrund | undefined;
    readonly entfernen: WikiBoxSperrGrund | undefined;
    /** Zeigt die Zeile „Sync“ den Knopf, oder läuft der Sync und die Fortschrittsanzeige steht an seiner Stelle? */
    readonly syncKnopf: boolean;
    /** Die Aufschrift des Sync-Knopfs ist „Später erneut“ (der letzte Versuch scheiterte). */
    readonly spaeter: boolean;
    /** Gibt es einen Artikel, an dem Sync und Entfernen etwas tun? */
    readonly artikel: boolean;
}

export interface WikiBoxLageEingabe {
    readonly darf: boolean;
    /** Hat das Formular des Fensters ungespeicherte Änderungen? */
    readonly ungespeichert: boolean;
    /** Die Box wartet auf den Server (eine eigene Anfrage läuft). */
    readonly beschaeftigt: boolean;
    readonly stand: WikiBoxStand | undefined;
    /** Jetzt in Unix-Millisekunden; nur Tests geben sie vor. */
    readonly jetzt: number;
}

/** Ist die Pause des Wikis (429) noch nicht vorbei? Dann der Zeitpunkt, sonst `undefined`. */
export function drosselBis(stand: WikiBoxStand | undefined, jetzt: number): Date | undefined {
    const frei = stand?.sync.fehler?.freiAb;
    if (frei === null || frei === undefined) return undefined;
    const bis = new Date(frei);
    return Number.isNaN(bis.getTime()) || bis.getTime() <= jetzt ? undefined : bis;
}

export function wikiBoxLage(eingabe: WikiBoxLageEingabe): WikiBoxLage {
    const { stand } = eingabe;
    const hatArtikel = stand?.artikel !== null && stand?.artikel !== undefined;
    const laeuft = stand?.sync.laeuft === true;
    const bis = drosselBis(stand, eingabe.jetzt);
    const gruppe: WikiBoxSperrGrund | undefined = eingabe.ungespeichert
        ? { art: "ungespeichert" }
        : eingabe.beschaeftigt
          ? { art: "beschaeftigt" }
          : undefined;
    const waehrendSync: WikiBoxSperrGrund | undefined = laeuft ? { art: "laeuft" } : undefined;
    let sync: WikiBoxSperrGrund | undefined = gruppe;
    if (sync === undefined && stand !== undefined && !stand.sync.moeglich) {
        sync = { art: "sync", grund: stand.sync.grund ?? "kein_artikel" };
    }
    if (sync === undefined && bis !== undefined) sync = { art: "drossel", bis };
    return {
        knoepfe: eingabe.darf,
        zuweisen: gruppe ?? waehrendSync,
        sync,
        entfernen: gruppe ?? waehrendSync,
        syncKnopf: hatArtikel && !laeuft,
        spaeter: stand?.sync.fehler !== null && stand?.sync.fehler !== undefined,
        artikel: hatArtikel,
    };
}

/** Ein Feld des Objekts, wie die Box es zum Rechnen braucht: Name, Zustand des Wiki-Felds und ob sein Wert dem Wiki folgt. */
export interface WikiBoxFeld {
    /** Der Schlüssel im Fenster (`einwohner`, `subtype` …). */
    readonly id: string;
    /** Die Felder im Plan des Servers, die dieses Feld meinen (`subtype` ist `settlement_class`); sie stehen im Ergebnis des letzten Syncs. */
    readonly plan: readonly string[];
    readonly name: string;
    readonly lage: WikiFeldLage;
    /** Der Wert folgt dem Wiki (Herkunft `wiki`): Ein Sync darf ihn ändern. Sonst ist er ein eigener und bleibt. */
    readonly folgt: boolean;
    /** Der Wert im Fenster, für die Zeile „vorher → nachher“. */
    readonly eigen?: string | undefined;
    /** Ein Text über mehrere Zeilen: Die Änderung nennt „Text geändert“ statt der Werte. */
    readonly mehrzeilig?: boolean | undefined;
}

const mitWikiGegenstueck = (feld: WikiBoxFeld): boolean =>
    feld.lage.zustand !== "ohne" && feld.lage.zustand !== "unbekannt";

/** Felder, die ein Sync ändern würde: Der Wiki-Wert weicht ab, und der Wert gehört dem Wiki. */
export const veraltete = (felder: readonly WikiBoxFeld[]): WikiBoxFeld[] =>
    felder.filter((feld) => mitWikiGegenstueck(feld) && feld.lage.abweichend && feld.folgt);

/** Felder mit eigenem Wert, der abweicht: Ein Sync lässt sie stehen. */
export const eigene = (felder: readonly WikiBoxFeld[]): WikiBoxFeld[] =>
    felder.filter((feld) => mitWikiGegenstueck(feld) && feld.lage.abweichend && !feld.folgt);

export type WikiBoxStandArt = "aktuell" | "neuer" | "teil";

export interface WikiBoxStandZeile {
    readonly art: WikiBoxStandArt;
    /** Der Kreis ○ ◐ ●: nur dort, wo er einen Zustand zeigt. */
    readonly fuellung: "halb" | "voll";
    /** Bei `teil`: wie viele Felder dem Wiki folgen, von wie vielen. */
    readonly folgen?: number;
    readonly von?: number;
}

/** Die Zeile des Stands, wenn kein Sync läuft: aktuell · das Wiki ist neuer · n von m Feldern folgen dem Wiki. */
export function standZeile(felder: readonly WikiBoxFeld[]): WikiBoxStandZeile {
    if (veraltete(felder).length > 0) return { art: "neuer", fuellung: "halb" };
    const eigen = eigene(felder);
    if (eigen.length > 0) {
        const von = felder.filter(mitWikiGegenstueck).length;
        return { art: "teil", fuellung: "halb", folgen: von - eigen.length, von };
    }
    return { art: "aktuell", fuellung: "voll" };
}

/** Die Namen der Felder im Plan des Servers, die ein Feld des Fensters meint, zu den Namen der Felder des Fensters (für die Zeile „Übernommen: …“). */
export function feldNamenZu(plan: readonly string[], felder: readonly WikiBoxFeld[]): string[] {
    const namen: string[] = [];
    for (const feld of felder) {
        if (feld.plan.some((name) => plan.includes(name)) && !namen.includes(feld.name)) namen.push(feld.name);
    }
    return namen;
}

/**
 * Der Schlüssel des Artikels, wie ihn die Box zeigt: Gebiete führen ihn mit der Vorsilbe `wiki:` (die Tafel X2 kennt Artikel mehrerer Arten unter EINEM Raum); die Vorsilbe ist ein Merkmal der Ablage,
 * keine Angabe über den Artikel, und steht darum nicht in der Anzeige.
 */
export const schluesselText = (key: string): string => (key.startsWith("wiki:") ? key.slice("wiki:".length) : key);

// ── Die Daten: ein Port, damit das Bauteil ohne Netz prüfbar bleibt ─────────────────────────────────────────────────────────

export type ApiFehler = ApiErrorBody["error"];
export type SchreibErgebnis =
    | { readonly ok: true; readonly quittung: OperationReceipt }
    | { readonly ok: false; readonly status: number; readonly fehler: ApiFehler };

export interface WikiBoxDaten {
    stand(art: WikiBoxArt, id: string, signal: AbortSignal): Promise<WikiBoxStand | null>;
    suche(art: WikiBoxArt, id: string, q: string, signal: AbortSignal): Promise<readonly WikiTreffer[]>;
    weise(art: WikiBoxArt, id: string, key: string): Promise<SchreibErgebnis>;
    entferne(art: WikiBoxArt, id: string): Promise<SchreibErgebnis>;
    sync(art: WikiBoxArt, id: string): Promise<SchreibErgebnis>;
}

/** Wie oft die Box nachfragt, solange ein Sync wartet oder läuft (der Auftrag wartet auf den Takt von 20 Sekunden). */
export const NACHFRAGE_MS = 3000;
/** Nach so langer Zeit gibt die Box das Nachfragen auf (der Auftrag steckt dann); ein Klick auf das Fenster fragt wieder. */
export const NACHFRAGE_HOECHSTENS_MS = 15 * 60_000;
