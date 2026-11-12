import type { Map as MapLibreMap } from "maplibre-gl";
import type { VerschiebeStart, Zug } from "../../ortseditor/verschieben";
import type { MapInteractionCoordinator } from "../interaction/types";
import { ORT } from "./arten";
import type { Aenderung, Teil, Ziel } from "./geometrie";
import { installGeometrieModus } from "./modus";
import { deckungsgleich } from "./rechnung";

/**
 * „✥ Ort verschieben“ auf dem gemeinsamen Geometrie-Modul (WI-0177 Stufe 4; EDIT-0003 T12, G4, G12; EDIT-0001 §4.4): dieselbe Hülle,
 * derselbe Kringel, derselbe Fangradius und derselbe EINE Besitzer `geometry-edit` wie Wegkurve, Ecken und Kurve. Was der Ortseditor
 * beim Start weiß (`VerschiebeStart`: der Ort, die Enden an ihm, die freien Enden im Umkreis), wird hier zu Teilen, Nachbarn und Zielen
 * des Moduls; die fertige Handbewegung wird wieder ein `Zug` für die eine Operation `place.move` (`ortseditor/ort-verschieben.ts`).
 *
 * - **Ein Entwurf, kein Sofortschreiben** (EDIT-0003 G4, Vali 2026-10-31): Jedes Loslassen meldet den Zug und lässt den Modus offen; man
 *   zieht mehrmals. Die Lage, die der Modus zeichnet, ist der jüngste Stand des Entwurfs (`stand`): der Ort dort, die Enden am Ort, bei
 *   Strg an der Ausgangslage. ↶ ↷ und „Verwerfen“ setzen den Stand von außen (`setze`). Geschrieben wird erst mit „Fertig“.
 * - **Der Ort** ist ein Teil aus einem Punkt; sein Anfasser ist der Griff.
 * - **Die Enden am Ort** sind Nachbarn: je Ende eine Strecke vom Nachbarpunkt des Wegs zum Ort. Ihr Endpunkt liegt genau auf dem Ort
 *   (das Ende hängt im Kasten ±0,5 am Ort, `place.move` setzt es ohnehin auf die neue Lage); so zieht das Modul sie mit, und Strg löst.
 * - **Die freien Enden** im Umkreis sind die Ziele (Zielart `ecke`); eingerastet sitzt der Ort genau auf dem Ende.
 * - 🔴 **Klick und Rechtsklick am Griff** gehören dem Modus (O2, Betreiber 2026-10-15): Ein Klick ohne Bewegung fällt nicht zum Ort
 *   darunter durch, der Rechtsklick öffnet kein Kartenmenü. Dafür meldet die Anbindung einen Rechtsklick an, der nichts zeigt.
 */

const ORT_TEIL = 0;

/** Der Ort als Teil des Moduls, an der Stelle des Entwurfs (`stand`), sonst am Start. */
export function ortTeile(start: VerschiebeStart, stand?: Zug): Teil[] {
    return [
        {
            objekt: start.publicId,
            name: start.name,
            nr: ORT_TEIL,
            art: "punkt",
            punkte: [stand?.ort ?? start.von],
            revision: start.revision,
        },
    ];
}

/**
 * Die Enden am Ort als Nachbarn: je Ende eine Strecke vom Nachbarpunkt zum Ort, mit der Revision des Wegs. Im Entwurf hängen sie am Ort
 * (`stand.ort`); war der Stand gelöst (Strg), liegen sie an der Ausgangslage.
 */
export function ortNachbarn(start: VerschiebeStart, stand?: Zug): Teil[] {
    const ende = stand === undefined || stand.getrennt ? start.von : stand.ort;
    return start.enden.map((e, nr) => ({
        objekt: e.pathId,
        name: e.name,
        nr,
        art: "linie",
        punkte: [e.neighbor, ende],
        revision: e.revision,
    }));
}

/** Die freien Wegenden im Umkreis als Ziele. */
export function ortZiele(start: VerschiebeStart): Ziel[] {
    return start.frei.map((ende) => ({
        art: "ecke",
        at: { x: ende.x, y: ende.y },
        objekt: ende.pathId,
        name: ende.name,
    }));
}

/** Die fertige Handbewegung als Zug des Ortseditors: wo der Ort landet, ob gelöst, an welchem freien Ende eingerastet. */
export function zugAus(start: VerschiebeStart, aenderung: Aenderung): Zug {
    const ort = aenderung.teile.find((teil) => teil.objekt === start.publicId)?.punkte[0] ?? start.von;
    const ziel = aenderung.treffer?.ziel;
    const eingerastet =
        ziel === undefined
            ? undefined
            : start.frei.find(
                  (ende) => ende.pathId === ziel.objekt && deckungsgleich({ x: ende.x, y: ende.y }, ziel.at),
              );
    return { ort, getrennt: aenderung.getrennt, eingerastet };
}

export interface OrtVerschiebenEingabe {
    readonly start: VerschiebeStart;
    /**
     * Losgelassen nach einer Bewegung: der Zug. Der Modus bleibt offen und zeichnet den Zug als jüngsten Stand; geschrieben wird erst mit
     * „Fertig“ (`ort-verschieben.ts`).
     */
    losgelassen(zug: Zug): void;
    /** Der Fangradius in Bildpunkten (Karteneinstellung `fangradius`, G12). */
    fangradius(): number;
    /** Das Werkzeug, aus dessen Fenster der Modus kam (Liste beim Modus, `besitzer.ts`). */
    readonly werkzeug?: string | undefined;
}

export interface OrtVerschiebenModus {
    /** Bricht einen laufenden Zug ab; der Ort geht zurück. Gibt zurück, ob gerade gezogen wurde. */
    abbrechen(): boolean;
    /** Setzt den Stand von außen (↶ ↷, „Verwerfen“): der Ort dort, die Enden an ihm; `undefined` ist die Ausgangslage. */
    setze(stand: Zug | undefined): void;
    /** Während gespeichert wird, packt niemand den Griff. */
    sperre(gesperrt: boolean): void;
    aus(): void;
}

/** Schaltet „Ort verschieben“ auf der Karte ein; läuft schon ein Modus des Moduls, `undefined` (der Hinweis kommt aus `besitzer.ts`). */
export function installOrtVerschieben(
    map: MapLibreMap,
    interaction: MapInteractionCoordinator,
    eingabe: OrtVerschiebenEingabe,
): OrtVerschiebenModus | undefined {
    const { start } = eingabe;
    const ziele = ortZiele(start);
    /** Der jüngste Stand des Entwurfs; `undefined`: noch nichts gezogen. */
    let stand: Zug | undefined;
    const modus = installGeometrieModus(map, interaction, {
        art: ORT,
        teile: () => ortTeile(start, stand),
        nachbarn: () => ortNachbarn(start, stand),
        ziele: () => ziele,
        // Am Ort selbst zieht das Modul sonst nichts mit; hier ist der Ort das, was gezogen wird.
        orte: () => [],
        fangradius: eingabe.fangradius,
        handbewegung(aenderung) {
            if (aenderung.art !== "ziehen") return;
            const zug = zugAus(start, aenderung);
            stand = zug;
            modus?.aktualisiere();
            eingabe.losgelassen(zug);
        },
        kontext: () => undefined,
        werkzeug: eingabe.werkzeug,
    });
    if (modus === undefined) return undefined;
    return {
        abbrechen: () => modus.abbrechen(),
        setze(neu) {
            stand = neu;
            modus.aktualisiere();
        },
        sperre: (an) => modus.sperre(an),
        aus: () => modus.aus(),
    };
}
