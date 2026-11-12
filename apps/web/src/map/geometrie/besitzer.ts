import { shallowRef, type ShallowRef } from "vue";
import { showToast } from "../../feedback/toast";
import { t } from "../../i18n/i18n";
import type { Claim, InteractionOwner, MapInteractionCoordinator } from "../interaction/types";

/**
 * Die Belegung des Geometrie-Moduls und die Anmeldung des EINEN Besitzers `geometry-edit` (G11) für beide Modi, „Geometrie
 * bearbeiten“ (`modus.ts`) und „Anlegen“ (`anlegen-modus.ts`), in jedem Editor (Wegkurve, Gebietsform, Kurve der Kraftlinie, Neuer
 * Weg …).
 *
 * - **Ein Modus zur Zeit** (Editor-Orchestrierung 2026-10-17): Startet einer, während schon einer läuft, wird der neue Start
 *   abgewiesen, der laufende bleibt, und ein Hinweis sagt es („Erst den laufenden Bearbeiten-Modus beenden.“). Nichts wirft. Die Frage
 *   „Speichern · Verwerfen · Weiter“ (R2) kommt später mit dem Fensterrumpf O3. Ein Modus belegt das Modul, bevor er etwas auf die Karte
 *   legt (`belegeGeometrie`), und gibt es mit seinem Ende frei; auch eine Vorschau ohne Anfasser (Wegkurve vereinfachen) belegt es.
 * - **Liste beim Modus** (EDIT-0003, Regel 7): Die Belegung nennt das Werkzeug, aus dessen Fenster der Modus kam (`geometrieModus`).
 *   `app.vue` zieht damit EINMAL für alle Modi des Moduls die Liste des angedockten Fensters ein (`listeImModus`) und stellt sie am Ende
 *   her; kein Editor braucht dafür einen eigenen Aufruf.
 * - 🔴 **Strg gehört dem Modus** (Vali 2026-11-06: „Die Strg-Taste ist jetzt doppelt belegt“, „Deaktiviert die Umschaltung auf 3D, wenn Gebiete
 *   gesetzt werden“, auf Rückfrage für alle Modi): Solange das Modul belegt ist (`geometrieBelegt`), dreht Strg + Ziehen die Karte nicht
 *   (`map/camera/pointer-controls.ts`). Im Modus heißt Strg „trennen“ oder „rastet nicht ein“; wer mit gehaltenem Strg schnell Punkte setzt, drehte
 *   sonst bei jedem verwackelten Klick die Karte. Die Mitteltaste dreht immer.
 * - **Nachlauf:** Ein Modus darf nach seinem Ende kurz angemeldet bleiben (`nachlaufen`: den zweiten Klick eines Doppelklicks halten);
 *   das Modul ist dann schon frei, und beginnt ein neuer, endet der Nachlauf vorher. 🪤 Der Koordinator nimmt eine Kennung nur einmal
 *   an und wirft sonst.
 */

let belegt: object | undefined;

/** Der laufende Modus des Moduls, mit dem Werkzeug, aus dem er kam (`undefined`: keiner läuft). */
export interface LaufenderGeometrieModus {
    readonly werkzeug: string | undefined;
}

const laufend = shallowRef<LaufenderGeometrieModus | undefined>(undefined);

/** Der laufende Modus, reaktiv: für „Liste beim Modus“ in `app.vue`. */
export const geometrieModus: Readonly<ShallowRef<LaufenderGeometrieModus | undefined>> = laufend;

/** Läuft gerade ein Modus des Moduls (Form, Anlegen oder eine Vorschau)? */
export const geometrieBelegt = (): boolean => belegt !== undefined;

/** Der Hinweis, dass erst der laufende Modus enden muss. */
export function meldeBelegt(): void {
    showToast(t("geometrie.belegt"), "warning");
}

/**
 * Belegt das Modul für einen Modus; läuft schon einer, `undefined` und der Hinweis. `frei` gibt es wieder frei (einmal). `werkzeug`
 * nennt das Werkzeug, dessen Fenster seine Liste einzieht, solange der Modus läuft (ein Modus der Form; Anlegen nennt keins).
 */
export function belegeGeometrie(werkzeug?: string): { frei(): void } | undefined {
    if (belegt !== undefined) {
        meldeBelegt();
        return undefined;
    }
    const meins = {};
    belegt = meins;
    laufend.value = { werkzeug };
    return {
        frei() {
            if (belegt !== meins) return;
            belegt = undefined;
            laufend.value = undefined;
        },
    };
}

let nachlauf: { ab: () => void; zeit: ReturnType<typeof setTimeout> } | undefined;

function beendeNachlauf(): void {
    if (nachlauf === undefined) return;
    clearTimeout(nachlauf.zeit);
    nachlauf.ab();
    nachlauf = undefined;
}

export interface GeometrieAnmeldung {
    /** Sofort abmelden. */
    ab(): void;
    /** Noch `ms` angemeldet bleiben, dann abmelden; ein neuer Modus beendet das vorher. */
    nachlaufen(ms: number): void;
}

export function meldeGeometrieAn<C extends Claim>(
    interaction: MapInteractionCoordinator,
    owner: InteractionOwner<C>,
): GeometrieAnmeldung {
    beendeNachlauf();
    const ab = interaction.register(owner as InteractionOwner);
    let fertig = false;
    const einmal = (): void => {
        if (fertig) return;
        fertig = true;
        ab();
    };
    return {
        ab() {
            if (nachlauf?.ab === einmal) beendeNachlauf();
            else einmal();
        },
        nachlaufen(ms) {
            beendeNachlauf();
            const zeit = setTimeout(() => {
                if (nachlauf?.zeit === zeit) nachlauf = undefined;
                einmal();
            }, ms);
            nachlauf = { ab: einmal, zeit };
        },
    };
}
