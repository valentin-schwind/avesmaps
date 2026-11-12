import { shallowRef } from "vue";
import type { EditorGebirge } from "@avesmaps3d/shared";
import type { GebirgsNetz, NetzPunkt, NetzStelle } from "./kamm-netz";
import type { Gewaesser } from "./kamm-netz-wasser";

/**
 * Der Weg vom Höhenprofil im Reiter „Gebirge“ zum laufenden Kammeditor (WI-0259, OPS-071; Vali 2026-10-30: „wir haben im editor doch schon
 * längsschnitte. wenn du clever bist kannst du da die punkte die den fluss bilden mit hoch-runter-pfeil … verwenden“): Solange „Kämme zeichnen“
 * läuft, steht hier der Zugriff auf SEINEN Entwurf, wie `gebirge-anzeige.ts` die Anzeige teilt. Das Profil liest daraus das Netz mit den
 * Höhen (auch während eines Zugs), die gemeinsame Auswahl und die Gewässer; es schreibt über `ziehe`, `entferne` und `setze` in denselben
 * Entwurf, damit ↶, „Verwerfen“ und „Fertig“ gelten. Außerhalb des Modus ist der Zugriff leer, und das Profil zeigt eigene Höhen nur.
 */
export interface KammNetzProfil {
    /** Die Teilfläche, an der der Modus läuft. */
    flaeche(): string | undefined;
    /** Das Netz, wie es der Entwurf hält; während eines Zugs mit dem Wert unter dem Zeiger. */
    netz(): GebirgsNetz;
    /** Die Flüsse und Seen der Fläche. */
    gewaesser(): Gewaesser;
    /** Die Eingabe der Fläche, die der Modus selbst gelesen hat. */
    eingabe(): EditorGebirge["eingabe"] | undefined;
    /** Die gewählten Punkte als `nr:index`. */
    gewaehlt(): ReadonlySet<string>;
    /** Eine Stelle wählen (mit Umschalt: in die Auswahl aufnehmen oder aus ihr herausnehmen). */
    waehle(stelle: NetzStelle, umschalt: boolean): void;
    /** Läuft gerade ein Zug aus dem Profil? */
    zugLaeuft(): boolean;
    /** Ein Zug: der Punkt trägt die Höhe unter dem Zeiger (noch kein Schritt im Entwurf). */
    ziehe(punkt: NetzPunkt, h: number): void;
    /** Loslassen: EIN Schritt im Entwurf mit dem Wert des Zugs. */
    zugEnde(): void;
    /** Abbrechen (Esc, oder die Geste ging an die Seite): der Wert davor. */
    zugAb(): void;
    /** Die eigene Höhe eines Punkts wegnehmen (Doppelklick): ein Schritt. */
    entferne(punkt: NetzPunkt): void;
    /** Die Höhe eines Punkts setzen (Tastatur): in Folge EIN Schritt, bis `abschluss`. */
    setzeHoehe(punkt: NetzPunkt, h: number): void;
    /** Ein Tippen in Folge ist zu Ende (der Griff verliert den Fokus): der nächste Wert ist ein neuer Schritt. */
    abschluss(): void;
}

/** Der Zugriff des laufenden Kammeditors; leer, solange „Kämme zeichnen“ nicht läuft. 🪤 `shallowRef`: Die Funktionen bleiben ohne reaktive Hülle. */
export const kammNetzProfil = shallowRef<KammNetzProfil | undefined>(undefined);
