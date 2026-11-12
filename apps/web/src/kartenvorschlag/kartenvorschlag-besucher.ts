import { shallowRef, type ShallowRef } from "vue";
import { STATUS_SCHLUESSEL_MUSTER } from "@avesmaps3d/shared";

/**
 * Die Steuerung von „Karte vorschlagen“ auf der Besucherseite (WI-0275 Stufe C): EIN Fenster zur Zeit, entweder das Formular oder die Statusseite `/kartenvorschlag#…`. Klein gehalten, weil sie im Start
 * liegt (Infopanel und Kartensammlung rufen sie auf); das Fenster selbst (`kartenvorschlag-fenster.vue`) lädt erst beim ersten Öffnen nach (`nachladen.ts`, WI-0235).
 *
 * - **Der Ort** ist der Gegenstand, dessen Kartensammlung gemeint ist (öffentliche Kennung und Name), samt der Auskunft, ob dort schon Karten liegen („Für die erste Karte von …“). Ohne Ort schlägt das Formular
 *   eine Karte für die Sammlung im Allgemeinen vor.
 * - **Das Fenster ist modal** und steht über der Kartensammlung, aus der es geöffnet wurde: Schließt es, liegt die Sammlung wieder offen darunter.
 * - Jedes Öffnen zählt `nr` hoch; ein zweites Öffnen bei offenem Formular beginnt ein frisches (neue Kennung, neuer Schlüssel), das Fenster hängt am `nr`.
 */

/** Der Ort, für dessen Kartensammlung vorgeschlagen wird. `id` ist die öffentliche Kennung des Ortes; `hatKarten` sagt, ob die Sammlung schon etwas enthält. */
export interface VorschlagOrt {
    readonly id?: string | undefined;
    readonly name: string;
    readonly hatKarten: boolean;
}

export type KartenvorschlagAnzeige =
    | { readonly art: "formular"; readonly nr: number; readonly ort?: VorschlagOrt | undefined }
    /** `schluessel` ist `null`, wenn der Link keinen trug oder einen verstümmelten: Das Fenster sagt es, ohne den Server zu fragen. */
    | { readonly art: "status"; readonly nr: number; readonly schluessel: string | null };

export interface KartenvorschlagSteuerung {
    readonly anzeige: Readonly<ShallowRef<KartenvorschlagAnzeige | undefined>>;
    oeffne(ort?: VorschlagOrt): void;
    oeffneStatus(schluessel: string | null | undefined): void;
    schliesse(): void;
}

export function erzeugeKartenvorschlagSteuerung(): KartenvorschlagSteuerung {
    const anzeige = shallowRef<KartenvorschlagAnzeige | undefined>(undefined);
    let nr = 0;
    return {
        anzeige,
        oeffne: (ort) => {
            anzeige.value = { art: "formular", nr: ++nr, ...(ort === undefined ? {} : { ort }) };
        },
        oeffneStatus: (schluessel) => {
            const gueltig =
                typeof schluessel === "string" && new RegExp(STATUS_SCHLUESSEL_MUSTER, "u").test(schluessel);
            anzeige.value = { art: "status", nr: ++nr, schluessel: gueltig ? schluessel : null };
        },
        schliesse: () => {
            anzeige.value = undefined;
        },
    };
}

export const kartenvorschlagBesucher: KartenvorschlagSteuerung = erzeugeKartenvorschlagSteuerung();
export const oeffneKartenvorschlagStatus = (schluessel: string | null | undefined): void =>
    kartenvorschlagBesucher.oeffneStatus(schluessel);
