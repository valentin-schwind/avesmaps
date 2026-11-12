import { t } from "../i18n/i18n";
import type { KraftlinienDaten } from "./kraftlinien-daten";

/**
 * „Hier hinzufügen › Neuer Kraftlinienpunkt“ (WI-0205 K9; Blatt Kraftlinien R7 und Frage 4: Kraftlinienpunkte entstehen hier, nicht beim
 * Klick ins Leere): setzt den Punkt an der Stelle des Menüs als EINE Operation `nodix.create`. Danach zeichnet die Karte ihn (die
 * Kachelrevision der Quittung), und er ist sofort ein Ziel für „Neue Kraftlinie“. Kein Modus: Die Stelle steht mit dem Rechtsklick fest.
 * Ein zweiter Auftrag, solange einer läuft, tut nichts.
 */

export interface KraftlinienpunktSetzenOptionen {
    readonly daten: Pick<KraftlinienDaten, "setzePunkt">;
    /** Nach dem Speichern: Karte mit der Revision der Quittung neu. */
    readonly geaendert: (revision: number | undefined) => void;
    readonly melde: (text: string, ton: "success" | "warning") => void;
    readonly neueKennung?: () => string;
}

export function createKraftlinienpunktSetzen(optionen: KraftlinienpunktSetzenOptionen): {
    setze(punkt: { x: number; y: number }): Promise<boolean>;
} {
    const neueKennung = optionen.neueKennung ?? ((): string => crypto.randomUUID());
    let laeuft = false;
    return {
        async setze(punkt) {
            if (laeuft) return false;
            laeuft = true;
            try {
                const antwort = await optionen.daten.setzePunkt({ operationId: neueKennung(), x: punkt.x, y: punkt.y });
                if (!antwort.ok) {
                    optionen.melde(antwort.fehler.message, "warning");
                    return false;
                }
                optionen.geaendert(antwort.quittung.mapRevision);
                optionen.melde(t("kraftlinieneditor.punkt.gesetzt"), "success");
                return true;
            } finally {
                laeuft = false;
            }
        },
    };
}
