import { t } from "../i18n/i18n";
import type { KraftlinienDaten } from "./kraftlinien-daten";

/**
 * „Kraftlinienpunkt entfernen“ im Kartenmenü (WI-0205 K10; EDIT-0003 T52): legt einen Kraftlinienpunkt still, als EINE Operation
 * `nodix.retire` gegen seine Revision (die Nodices nennen sie, `EditorPowerlineTarget.revision`). Nur ohne Linie: Das Menü sperrt den
 * Eintrag, solange eine gezeichnete Linie an ihm endet, und der Server weist auch eine abgenommene ab (sein Satz kommt als Hinweis).
 * Danach zeichnet die Karte ohne ihn (die Kachelrevision der Quittung). Ein zweiter Auftrag, solange einer läuft, tut nichts.
 */

export interface KraftlinienpunktEntfernenOptionen {
    readonly daten: Pick<KraftlinienDaten, "nodices" | "entfernePunkt">;
    /** Nach dem Schreiben: Karte mit der Revision der Quittung neu. */
    readonly geaendert: (revision: number | undefined) => void;
    readonly melde: (text: string, ton: "success" | "warning") => void;
    readonly neueKennung?: () => string;
}

export function createKraftlinienpunktEntfernen(optionen: KraftlinienpunktEntfernenOptionen): {
    entferne(id: string): Promise<boolean>;
} {
    const neueKennung = optionen.neueKennung ?? ((): string => crypto.randomUUID());
    let laeuft = false;
    return {
        async entferne(id) {
            if (laeuft) return false;
            laeuft = true;
            try {
                const punkt = (await optionen.daten.nodices(new AbortController().signal))?.targets.find(
                    (ziel) => ziel.id === id && ziel.kind === "nodix",
                );
                if (punkt?.revision === undefined) {
                    optionen.melde(t("kraftlinieneditor.punkt.fehlt"), "warning");
                    return false;
                }
                const antwort = await optionen.daten.entfernePunkt(id, {
                    operationId: neueKennung(),
                    baseRevision: punkt.revision,
                });
                if (!antwort.ok) {
                    optionen.melde(antwort.fehler.message, "warning");
                    return false;
                }
                optionen.geaendert(antwort.quittung.mapRevision);
                optionen.melde(t("kraftlinieneditor.punkt.entfernt"), "success");
                return true;
            } finally {
                laeuft = false;
            }
        },
    };
}
