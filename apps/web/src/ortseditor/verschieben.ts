import type {
    EditorFreePathEnd,
    EditorPathEnd,
    EditorPlaceDetail,
    OperationReceipt,
    PlaceMoveBody,
} from "@avesmaps3d/shared";

/**
 * „✥ Ort verschieben“ als reine Rechnung (WI-0128 E12; EDIT-0001 §4.4, D11, G4; Gesamtmockup Version 7): was der Modus beim Start weiß,
 * die eine Operation mit „Fertig“ und die Quittung. Ohne Vue und ohne Karte, damit Vitest sie prüft. Ziehen, Einrasten, Mitziehen
 * und Strg rechnet das gemeinsame Geometrie-Modul (WI-0177 Stufe 4, `map/geometrie/ort.ts`), die Steuerung (`ort-verschieben.ts`)
 * sendet.
 *
 * - **Einrasten:** Liegt ein freies Wegende im Fangradius (Karteneinstellung, G12) neben dem gezogenen Ort, sitzt der Ort genau darauf;
 *   nach dem Speichern hängt das Ende am Ort (Kasten ±0,5 wie Legacys `ENDPOINT_BOX`). Die Ziele kommen einmal beim Start vom Server.
 * - **Mitziehen:** Die Wegenden am Ort ziehen mit; die Vorschau ist je Ende eine Strecke vom Nachbarpunkt des Wegs zum Ort.
 * - **Strg trennt** (D11): einmal während des Zugs gedrückt, bleiben die Wegenden an der Ausgangslage liegen und nichts rastet ein, bis
 *   zum Loslassen (klebrig wie Legacys `map-features-location-detach-edit.js:80`).
 * - **„Fertig“** (nach beliebig vielen Zügen) ist EINE Operation `place.move` mit der letzten Lage und allen mitgezogenen Enden; ein
 *   eingerastetes Ende braucht keine Änderung, es liegt schon dort, wo der Ort landet. Bei Strg im letzten Zug bleiben alle Enden liegen.
 */

export interface Punkt {
    readonly x: number;
    readonly y: number;
}

/** Was der Modus beim Start weiß: der Ort mit Revision, die Enden an ihm und die freien Enden im Umkreis. */
export interface VerschiebeStart {
    readonly publicId: string;
    readonly name: string;
    readonly subtype: string;
    readonly revision: number;
    readonly von: Punkt;
    readonly enden: readonly EditorPathEnd[];
    readonly frei: readonly EditorFreePathEnd[];
}

/** Der Stand während des Zugs. */
export interface Zug {
    /** Wo der Ort jetzt gezeichnet ist (auf dem eingerasteten Ende, sonst unter dem Zeiger). */
    readonly ort: Punkt;
    readonly getrennt: boolean;
    readonly eingerastet: EditorFreePathEnd | undefined;
}

export function startAus(ort: EditorPlaceDetail, frei: readonly EditorFreePathEnd[]): VerschiebeStart {
    // Ein Ort ohne Lage (E16) wird gesetzt, nicht verschoben; der Abschnitt „Lage“ bietet das Verschieben dann gar nicht an.
    if (ort.position === undefined) throw new Error(`${ort.name} hat keine Lage zum Verschieben`);
    return {
        publicId: ort.publicId,
        name: ort.name,
        subtype: ort.subtype,
        revision: ort.revision,
        von: ort.position,
        enden: ort.pathEnds,
        frei,
    };
}

/** Die eine Operation mit „Fertig“: Ort und, ohne Strg beim letzten Zug, jedes Ende am Ort an die letzte Lage. */
export function bewegung(start: VerschiebeStart, zug: Zug, operationId: string): PlaceMoveBody {
    return {
        operationId,
        baseRevision: start.revision,
        to: { x: zug.ort.x, y: zug.ort.y },
        pathEnds: zug.getrennt
            ? []
            : start.enden.map((ende) => ({
                  pathId: ende.pathId,
                  end: ende.end,
                  baseRevision: ende.revision,
                  to: { x: zug.ort.x, y: zug.ort.y },
              })),
    };
}

/** Die Teile der Quittung (Gesamtmockup): Revision, mitgezogen, eingerastet, liegen geblieben. */
export interface Quittung {
    readonly revision: number;
    readonly mitgezogen: number;
    readonly eingerastet: boolean;
    readonly liegen: number;
    /** Wo die Enden liegen blieben (die Lage davor): „Zum nächsten“ im Befund „offene Wegenden“ (E20). */
    readonly liegenBei?: Punkt;
}

export function quittungAus(start: VerschiebeStart, zug: Zug, antwort: OperationReceipt): Quittung {
    const ort = antwort.affected.find((x) => x.kind === "place" && x.id === start.publicId);
    return {
        revision: ort?.revision ?? start.revision + 1,
        mitgezogen: zug.getrennt ? 0 : start.enden.length,
        eingerastet: zug.eingerastet !== undefined,
        liegen: zug.getrennt ? start.enden.length : 0,
        ...(zug.getrennt && start.enden.length > 0 ? { liegenBei: start.von } : {}),
    };
}
