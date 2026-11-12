import { inject, type InjectionKey, type Ref } from "vue";
import type { MapHistoryEntry, MapHistoryObject, RuecknahmeKonflikt, RuecknahmeReceipt } from "@avesmaps3d/shared";
import type { SerienZeile } from "./aenderung-modell";
import type { RuecknahmeAngebot } from "./aenderung-ruecknahme";
import type { AenderungenDaten } from "./aenderungen-daten";

/**
 * Was die Zeilen der Liste von „Änderungen“ vom Reiter brauchen (WI-0265 B10): welche Zeile offen ist, die Angebote des ↺, die Wege des ⊕ und der Sprünge. Der Reiter hält den Zustand und die Fenster; die Bauteile der Zeilen
 * (`aenderung-eintrag.vue`, `aenderung-serie.vue`, `aenderung-buendel.vue`) stehen in einer Schiene in der anderen und würden sonst ein Dutzend Eigenschaften und Ereignisse durchreichen. Eingehängt wird es mit `provide`.
 */
export interface AenderungenKontext {
    /** Vorsilbe der Test-Kennungen und der Besitzer der Überlagerung auf der Karte (`editorpanel-aenderung`). */
    readonly kennung: string;
    readonly daten: AenderungenDaten;
    readonly phone: Readonly<Ref<boolean>>;
    /** Die Liste zeigt „Meine“: Dann steht die Person nirgends. */
    readonly meine: Readonly<Ref<boolean>>;
    readonly rechte: Readonly<Ref<readonly string[]>>;

    // --- Auf- und Zuklappen
    ist(schluessel: string): boolean;
    /** Klappt eine Zeile auf oder zu; `hauptliste` für die Zeilen der Liste selbst (am Telefon ersetzt ihr Detail die Liste), nicht für die in einer Schiene. */
    schalte(schluessel: string, hauptliste: boolean): void;

    // --- Zurücknehmen
    angebotFuer(eintrag: MapHistoryEntry): RuecknahmeAngebot | undefined;
    angebotFuerSerie(zeile: SerienZeile): RuecknahmeAngebot | undefined;
    /** Das ↺ am Zeilenende: öffnet die Zeile und bittet die Rückfrage darin um den Anfang (schreibt nie). */
    stosseAn(schluessel: string): void;
    anstossFuer(schluessel: string): number | undefined;
    angestossen(): void;
    zurueckgenommen(quittung: RuecknahmeReceipt): void;
    neuLesen(): void;
    konfliktPruefen(konflikt: RuecknahmeKonflikt, ziel: RuecknahmeAngebot["ziel"]): void;

    // --- Verweise
    kenntOperation(operationId: string): boolean;
    zeige(operationId: string): Promise<boolean>;
    springeZumObjekt(eintrag: MapHistoryEntry, kennung: string): void;
    nurObjekt(gegenstand: MapHistoryObject): void;

    // --- Karte
    /** ⊕ an einer Zeile mit genau einem Ort: den Ort wählen und zeigen. */
    ortZeigen(publicId: string): void;
    /** ⊕ an einer anderen Zeile (B9): die Karte fliegt hin, ohne dass ein Detail offen ist. */
    zeigeEintragAufKarte(eintrag: MapHistoryEntry): void;
    zeigeSerieAufKarte(besitzer: string, mitglieder: readonly MapHistoryEntry[]): void;
}

export const AENDERUNGEN_KONTEXT: InjectionKey<AenderungenKontext> = Symbol("aenderungen-kontext");

/** Der Kontext des Reiters; ohne ihn steht die Zeile außerhalb des Reiters, und das ist ein Fehler. */
export function useAenderungenKontext(): AenderungenKontext {
    const kontext = inject(AENDERUNGEN_KONTEXT);
    if (kontext === undefined) throw new Error("Die Zeile von „Änderungen“ steht außerhalb des Reiters.");
    return kontext;
}
