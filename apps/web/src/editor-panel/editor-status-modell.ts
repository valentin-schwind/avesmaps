import {
    hauptGegenstand,
    type BesuchEditor,
    type MapHistoryEntry,
    type MapHistoryObjectKind,
} from "@avesmaps3d/shared";
import { eintragsTitel } from "../aenderungen/aenderung-titel";
import type { Kreis } from "../editor-liste/liste-modell";
import { formatNumber, t, tPlural } from "../i18n/i18n";

/**
 * Was die Editorenliste aus den Angaben einer Person rechnet (WI-0276). Rein, damit es ohne Vue zu prüfen ist.
 */

/** ● bearbeitet gerade etwas · ◐ online · ○ nicht da. Eine Sperre zählt auch, wenn die Sitzung gerade nichts meldet: Sie schlägt, solange jemand arbeitet. */
export function editorKreis(
    person: Pick<BesuchEditor, "bearbeitet" | "online">,
): Extract<Kreis, "voll" | "halb" | "leer"> {
    if (person.bearbeitet) return "voll";
    return person.online ? "halb" : "leer";
}

/** Wie lange die Sperre schon gilt: „seit 12 Min.“, ab einer Stunde „seit 2 Std.“. Unter einer Minute steht eine, damit nie „seit 0 Min.“ dasteht. */
export function seitText(seit: string, jetzt: Date): string {
    const minuten = Math.max(1, Math.floor((jetzt.getTime() - new Date(seit).getTime()) / 60_000));
    if (minuten < 60) return t("editoren.seit.minuten", { n: formatNumber(minuten, 0) });
    return t("editoren.seit.stunden", { n: formatNumber(Math.floor(minuten / 60), 0) });
}

/** Das Siegel einer Person: der erste Buchstabe ihres Namens, auch wenn er aus zwei Zeichen im Sinne von JavaScript besteht. */
export function siegelVon(name: string, sprache: string): string {
    return Array.from(name.trim())[0]?.toLocaleUpperCase(sprache) ?? "";
}

export interface LetzteZeile {
    readonly schluessel: string;
    readonly art: MapHistoryObjectKind | undefined;
    readonly id: string | undefined;
    readonly name: string | undefined;
    /** Was geschah: der Titel der Operation, bei mehreren in Folge ihre Zahl. */
    readonly was: string;
    /** Die jüngste Operation der Zeile. */
    readonly am: string;
}

/**
 * Die letzten Änderungen einer Person als kurze Zeilen. Folgen mehrere Änderungen am selben Objekt aufeinander, stehen sie als eine Zeile mit ihrer Zahl da: Wer eine Linie
 * zurechtzieht, hat sonst drei gleiche Zeilen und sieht nichts anderes mehr.
 */
export function letzteZeilen(eintraege: readonly MapHistoryEntry[], wieviele: number): readonly LetzteZeile[] {
    const gruppen: { schluessel: string; eintraege: MapHistoryEntry[] }[] = [];
    for (const eintrag of eintraege) {
        const gegenstand = hauptGegenstand(eintrag.objects);
        const schluessel = gegenstand === undefined ? eintrag.operationId : `${gegenstand.kind}:${gegenstand.id}`;
        const davor = gruppen[gruppen.length - 1];
        if (davor?.schluessel === schluessel) davor.eintraege.push(eintrag);
        else {
            if (gruppen.length === wieviele) break;
            gruppen.push({ schluessel, eintraege: [eintrag] });
        }
    }
    return gruppen.map(({ schluessel, eintraege: gruppe }) => {
        const neueste = gruppe[0]!;
        const gegenstand = hauptGegenstand(neueste.objects);
        return {
            schluessel,
            art: gegenstand?.kind,
            id: gegenstand?.id,
            name: gegenstand?.name,
            was:
                gruppe.length > 1
                    ? tPlural("editoren.aenderungenZahl", gruppe.length, { n: formatNumber(gruppe.length, 0) })
                    : eintragsTitel(neueste),
            am: neueste.at,
        };
    });
}
