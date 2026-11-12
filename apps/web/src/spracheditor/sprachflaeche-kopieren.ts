import type { InjectionKey } from "vue";
import type { SpracheEditorListe } from "@avesmaps3d/shared";
import type { MessageKey } from "../i18n/i18n";
import { NEUE_FARBE } from "./sprache-felder";

/**
 * Das Blatt „Fläche kopieren“ an einer Teilfläche einer Sprache (WI-0261 Stufe 3; wie Werkzeug 8 der Derographie, `landschaftseditor/landschaft-kopieren.ts`,
 * Betreiber 2026-10-19 dort: „wie legacy B mit haken“): die Regeln ohne Oberfläche, damit sie sich prüfen lassen.
 *
 * - **Ziel** ist eine ANDERE aktive Sprache (Editor-Orchestrierung 2026-10-31: „Kopieren“ bezieht sich auf eine andere Sprache als Ziel) oder eine neue
 *   (Betreiber 2026-10-31: „Ja, auch neue“; Eintrag „Neue Sprache …“). Vorgewählt ist keine: Eine geratene Sprache bekäme eine Fläche, die niemand gemeint hat.
 * - **Eine neue Sprache** braucht nur ihren Namen, mit derselben Regel wie „✚ Neue Sprache“ (`sprache-anlegen.vue`: ohne Namen geht es nicht, „Der Name
 *   fehlt.“); ihre Farbe ist die Vorgabe neuer Sprachen (`NEUE_FARBE`), Legende und Wiki-Artikel kommen danach im Fenster. Angelegt wird sie in DERSELBEN
 *   Operation wie die Kopie (`sprache_flaeche.copy`).
 * - **„Originalfläche löschen“** steht zuerst aus; mit Haken wird die Teilfläche in der Quelle stillgelegt (Umziehen). Die Sprache der Quelle bleibt, auch ohne
 *   Teilfläche (wie „Teilfläche entfernen …“): Anders als an der Landschaft geht mit der letzten Teilfläche nichts weiter.
 */

/** Der Eintrag „Neue Sprache …“ in der Wahl der Zielsprache (keine Kennung einer Sprache sieht so aus). */
export const NEUE_SPRACHE = "+neu";

export interface SprachKopierWahl {
    /** Die Zielsprache, `NEUE_SPRACHE` für eine neue; leer: noch keine gewählt. */
    readonly ziel: string;
    /** Der Name einer neuen Zielsprache. */
    readonly name: string;
    readonly loeschen: boolean;
}

export const START_WAHL: SprachKopierWahl = { ziel: "", name: "", loeschen: false };

/** Die Zielsprache: eine bestehende oder eine neue (Name und Farbe). */
export type SprachZiel =
    { readonly targetId: string } | { readonly neueSprache: { readonly name: string; readonly farbe: string } };

/**
 * Das Ziel „Sprache“ im Blatt „Fläche kopieren“ der Derographie (WI-0261; Betreiber 2026-10-31: „Ja, bauen“; `landschaftseditor/landschaft-kopieren.vue`): `app.vue`
 * gibt es über `provide(SPRACH_KOPIE, …)` aus dem Spracheditor (`kopieAusLandschaft` in `spracheditor-anbindung.ts`). Ohne Anbindung oder ohne Recht an den
 * Sprachen bietet das Blatt kein Ziel „Sprachen“ an.
 */
export interface SprachKopieAnbindung {
    /** Darf diese Sitzung Sprachen schreiben (Recht und `MAP_EDITING`)? */
    darf(): boolean;
    /** Die aktiven Sprachen nach Namen, als Ziele. */
    sprachen(): readonly { readonly id: string; readonly name: string }[];
    /** Die Liste der Sprachen laden, falls sie noch fehlt (das Blatt fragt beim Wechsel auf „Sprachen“). */
    lade(): void;
    /**
     * Die Teilfläche der Landschaft als EINE neue Teilfläche in die Sprache kopieren (`sprache.flaeche_aus_landschaft`); danach steht der Spracheditor an der
     * Zielsprache mit der neuen Teilfläche gewählt, und der Hinweis nennt sie. Ohne Erfolg der Satz.
     */
    kopiere(
        quelle: { readonly regionId: string; readonly areaId: string },
        ziel: SprachZiel,
    ): Promise<{ readonly ok: true } | { readonly ok: false; readonly satz: string }>;
}

export const SPRACH_KOPIE: InjectionKey<SprachKopieAnbindung> = Symbol("sprachKopie");

/** Was das Blatt schickt: eine bestehende Zielsprache oder eine neue; Kennung, Teilfläche und Revision setzt die Steuerung. */
export type SprachKopierZiel =
    | { readonly targetId: string; readonly deleteSource: boolean }
    | { readonly neueSprache: { readonly name: string; readonly farbe: string }; readonly deleteSource: boolean };

/** Die Sprachen, die eine Kopie aufnehmen können: aktiv, nicht die Quelle, nach Namen. */
export function zielSprachen(
    zeilen: SpracheEditorListe["zeilen"],
    quelle: string,
    sprache?: string,
): { readonly id: string; readonly name: string }[] {
    return zeilen
        .flatMap((zeile) =>
            zeile.art === "sprache" && zeile.aktiv && zeile.id !== quelle ? [{ id: zeile.id, name: zeile.name }] : [],
        )
        .sort((a, b) => a.name.localeCompare(b.name, sprache));
}

/** Der Plan oder der Satz, warum es so nicht geht (geprüft, BEVOR etwas geschrieben wird). */
export function sprachKopierPlan(wahl: SprachKopierWahl): { ziel: SprachKopierZiel } | { fehler: MessageKey } {
    if (wahl.ziel === "") return { fehler: "spracheditor.kopieren.zielFehlt" };
    if (wahl.ziel !== NEUE_SPRACHE) return { ziel: { targetId: wahl.ziel, deleteSource: wahl.loeschen } };
    const name = wahl.name.trim();
    if (name === "") return { fehler: "spracheditor.grund.name" };
    return { ziel: { neueSprache: { name, farbe: NEUE_FARBE }, deleteSource: wahl.loeschen } };
}
