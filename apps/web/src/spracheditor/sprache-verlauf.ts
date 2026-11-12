import { editorSpracheVerlaufUrl, type SpracheEditorDetail } from "@avesmaps3d/shared";
import { istSprache } from "../aenderungen/aenderung-ruecknahme";
import type { SchreibAntwort } from "../fenster/entwurf-senden";
import type { Ruecknahme, VerlaufsArt } from "../fenster/entwurf-verlauf";
import { t } from "../i18n/i18n";

/**
 * Der Verlauf einer Sprache im Fenster (WI-0261 S5d2; gemeinsamer Verlauf `fenster/entwurf-verlauf.ts`, Muster
 * `kraftlinieneditor/kraftlinie-verlauf.ts`): jede Operation, die die Sprache nennt (`GET /api/editor/sprachen/:id/history`), mit ihren
 * Teilflächen.
 *
 * **Zurücknehmen über den Server** (WI-0265 B6e): Alles, was an der Sprache zurückgeht, nimmt `POST /api/editor/sprachen/:id/restore-series` zurück: Vorprüfung, Rückfrage, EINE Rücknahme
 * (`aenderungen/aenderung-ruecknahme.vue`, dieselbe wie im Reiter „Änderungen“), einzeln oder als ganze Arbeitsserie. Das sind Name, Legende, Farbe und Reihenfolge, die Wiki-Artikel (auch der,
 * der einer anderen Sprache genommen wurde), Stilllegen und Zurückholen der Sprache und ihrer Teilflächen, die Form und die Werkzeuge an Teilflächen (auch das Kopieren in eine neue Sprache).
 * Dieser Anschluss spielt nichts mehr selbst zurück (`ruecknahme` sagt immer `nicht`); `ruecknahmeZiel` nennt dem Verlauf die Adresse. Das frühere ↺ im Client (Felder, Sprache und Teilfläche
 * zurückholen, mit den alten Werten über den gewöhnlichen Schreibweg und die Sperre der Sprache) entfällt: Der Server nimmt es ohne eigene Sperre und als EINE Operation zurück.
 *
 * **Nicht zurücknehmbar:** das Anlegen einer Sprache und einer Teilfläche und „Fläche der Derographie in eine Sprache kopieren“ (`sprache.flaeche_aus_landschaft`).
 */

const NICHT = { art: "nicht" } as const;

/** Es gibt keine Rücknahme, die dieser Anschluss selbst schriebe: Der Server nimmt alles zurück. */
type KeineRuecknahme = never;

/** Ein Text für die Werte des Verlaufs, die keine Zeichenkette sind: die Pillen mit ihren Titeln, der Stand, die Form. */
export function sprachVerlaufWert(feld: string, wert: unknown): string | undefined {
    if (feld === "wiki" && Array.isArray(wert))
        return wert.length === 0
            ? t("spracheditor.verlauf.keinArtikel")
            : wert
                  .map((pille) => (pille as { titel?: unknown }).titel)
                  .filter((titel) => typeof titel === "string")
                  .join(", ");
    if (feld === "active" && typeof wert === "boolean")
        return wert ? t("spracheditor.stand.aktiv") : t("spracheditor.stand.stillgelegt");
    if (feld === "geometry") return wert === null || wert === undefined ? "–" : t("spracheditor.verlauf.form");
    // Kopiert aus einer Fläche der Derographie (WI-0261): ihr Name.
    if (feld === "kopiertAus") {
        const name = (wert as { name?: unknown } | null | undefined)?.name;
        return typeof name === "string" ? name : "–";
    }
    return undefined;
}

/** Die Namen der Felder im Verlauf (und im Konflikt eines ↺). */
export function sprachVerlaufFeldName(feld: string): string {
    switch (feld) {
        case "name":
            return t("spracheditor.feld.name");
        case "legende":
            return t("spracheditor.feld.legende");
        case "farbe":
            return t("spracheditor.feld.farbe");
        case "reihenfolge":
            return t("spracheditor.feld.reihenfolge");
        case "wiki":
            return t("spracheditor.kasten.wiki");
        case "active":
            return t("verlauf.aktiv");
        case "geometry":
            return t("spracheditor.verlauf.form");
        case "herkunft":
            return t("spracheditor.feld.herkunft");
        case "quelleRevision":
            return t("spracheditor.verlauf.quelleRevision");
        case "kopiertAus":
            return t("spracheditor.verlauf.kopiertAus");
        default:
            return feld;
    }
}

/** Was der Anschluss vom Fenster der Sprache braucht: wen er nach einer Rücknahme durch den Server benachrichtigt (das Fenster vergisst dann die in dieser Sitzung stillgelegten Teilflächen, die zurück sind). */
export interface SpracheVerlaufOptionen {
    nachRuecknahme?(quittung: {
        readonly affected?: readonly { readonly kind: string; readonly id: string }[] | undefined;
    }): void;
}

export function createSpracheVerlaufsArt(
    optionen: SpracheVerlaufOptionen = {},
): VerlaufsArt<SpracheEditorDetail, KeineRuecknahme> {
    return {
        ...(optionen.nachRuecknahme === undefined ? {} : { nachRuecknahme: optionen.nachRuecknahme }),
        url: editorSpracheVerlaufUrl,
        gehoert: (gegenstand, d) =>
            (gegenstand.kind === "sprache" && gegenstand.id === d.id) || gegenstand.kind === "sprache_flaeche",
        ruecknahme: (): Ruecknahme<KeineRuecknahme> => NICHT,
        // Jeder Eintrag, den der Server zurücknimmt und der diese Sprache nennt (sie selbst oder eine ihrer Teilflächen), hängt hier an ihr. Das Kopieren in eine andere Sprache nennt beide: In
        // jedem der beiden Verläufe hängt es an der Sprache dieses Verlaufs.
        ruecknahmeZiel: (eintrag, id) =>
            istSprache(
                eintrag.operation,
                eintrag.objects.map((gegenstand) => gegenstand.action),
            ) &&
            eintrag.objects.some(
                (gegenstand) =>
                    (gegenstand.kind === "sprache" && gegenstand.id === id) ||
                    (gegenstand.kind === "sprache_flaeche" && gegenstand.sprache?.id === id),
            )
                ? { familie: "sprache", id }
                : undefined,
        // Unerreichbar: `ruecknahme` bietet nie etwas an, das hier geschrieben würde.
        schreibe: (): Promise<SchreibAntwort> =>
            Promise.resolve({
                ok: false,
                status: 0,
                fehler: { code: "not_revertable", message: "Der Server nimmt Sprachen zurück." },
            }),
        feldFolge: ["name", "legende", "farbe", "reihenfolge", "wiki", "active", "geometry", "herkunft"],
    };
}
