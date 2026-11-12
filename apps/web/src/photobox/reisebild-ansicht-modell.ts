import type { ReisebildKarte } from "@avesmaps3d/shared";
import type { BezugOrt } from "../community/meldung-modell";
import type { MessageKey } from "../i18n/de";
import { BLICK_RICHTUNGEN, stelleText, type Uebersetzer } from "./stelle-text";

/**
 * Die Zeile unter dem Bild der Bildansicht (WI-0272 S4, Aufgabe 30; Probierseite `zeichneAnsicht`): Titel, die Nennung, dann Entstehung · Stelle · Blick, die Lizenz als Link. Reine Funktion, damit
 * Vitest die Texte ohne Browser prüft.
 *
 * - **Die Nennung** gehört zum Bild und steht immer da: „Bild von {Name}“, ohne freiwilligen Namen „anonym“ (WI §12 Frage 2). Sie ist hervorgehoben (Rahmen und Schrift im Akzent).
 * - **Entstehung:** aus der Tafel des Formulars; ein KI-Bild heißt ausdrücklich „KI-Bild“.
 * - **Stelle:** „in Gareth“ oder „nordöstlich von Gareth“, aus dem Ort des Bildes oder, ohne, aus dem nächsten Ort (`naechsterOrt`, einmal gefragt). Fehlt beides, fehlt der Teil.
 * - **Kein Datum:** Das Datum steht nicht auf der Liste der Antwortfelder (Plan S4, Entscheidung 11).
 * - **Lizenz:** nur bei CC BY (`bild.lizenz` steht nur dort); der Name als Link auf die Adresse der Lizenz, wo der Server sie nennt.
 */

export interface AnsichtZeile {
    readonly titel: string;
    readonly nennung: string;
    /** Entstehung, Stelle, Blick: in dieser Reihenfolge, was fehlt, fehlt. */
    readonly teile: readonly string[];
    readonly lizenz?: { readonly text: string; readonly uri?: string };
}

/** Der Ort des Bildes als Bezug, wie `stelleText` ihn liest. */
export function ortBezug(bild: Pick<ReisebildKarte, "ort">): BezugOrt | undefined {
    const ort = bild.ort;
    return ort === undefined ? undefined : { id: ort.id, name: ort.name, typ: ort.subtype, lage: ort.lage };
}

export function ansichtZeile(
    bild: ReisebildKarte,
    uebersetze: Uebersetzer,
    naechsterOrt?: BezugOrt | undefined,
): AnsichtZeile {
    const name = bild.name?.trim();
    const ort = ortBezug(bild) ?? naechsterOrt;
    const teile: string[] = [uebersetze(`photobox.entstehung.${bild.entstehung}` as MessageKey)];
    if (ort !== undefined) teile.push(stelleText(bild.lage, ort, uebersetze));
    const richtung = bild.blickrichtung === undefined ? undefined : BLICK_RICHTUNGEN[bild.blickrichtung];
    if (richtung !== undefined) {
        teile.push(
            uebersetze("photobox.blick.hinweisNach", {
                richtung: uebersetze(`photobox.blickNach.${richtung}` as MessageKey),
            }),
        );
    }
    return {
        titel: bild.beschreibung,
        nennung: uebersetze("photobox.karte.bildVon", {
            name: name === undefined || name === "" ? uebersetze("photobox.karte.anonym") : name,
        }),
        teile,
        ...(bild.lizenz === undefined
            ? {}
            : {
                  lizenz: {
                      text: uebersetze("photobox.karte.lizenz", { name: bild.lizenz.name }),
                      ...(bild.lizenz.uri === undefined ? {} : { uri: bild.lizenz.uri }),
                  },
              }),
    };
}
