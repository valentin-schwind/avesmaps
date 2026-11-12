import {
    catmullRomLine,
    endenAufeinander,
    LEGACY_CATMULL,
    SMOOTH_NET_OPTIONS,
    smoothLine,
    WEG_MINDESTENS,
} from "@avesmaps3d/shared";
import type { AnlegenArt } from "./anlegen";
import type { GeometrieArt, Punkt, Stelle, Teil, Ziel } from "./geometrie";
import { deckungsgleich } from "./rechnung";

/**
 * Die Arten des Geometrie-Moduls (Tafel im Kopf von `geometrie.ts`): der Weg (WI-0177), der Fluss als Weg, der überall einrastet
 * (`flussArt`, `FLUSS_ANLEGEN`), und die Fläche (WI-0178 C1) mit ihrer
 * Chaikin-Rundung aus `@avesmaps3d/shared`, das Herrschaftsgebiet (WI-0209 C1) eckig, der Ort (WI-0177 Stufe 4, Ort verschieben). Dazu
 * die Arten des
 * Modus „Anlegen“ (Tafel im Kopf von `anlegen.ts`): der neue Weg (`WEG_ANLEGEN`), die neue Fläche und das neue Gebiet (`FLAECHE_ANLEGEN`,
 * `GEBIET_ANLEGEN`, C3). Dazu das Gebirgsnetz der Derographie (WI-0245 D2): `GEBIRGSNETZ`, `KAMM_ANLEGEN`, `NEBENGIPFEL_SETZEN`.
 */

const istEnde = (stelle: Stelle, teil: Teil): boolean => stelle.index === 0 || stelle.index === teil.punkte.length - 1;

/**
 * Der Weg (Betreiber 2026-10-15, Auftrag und Blatt „1 ja, 2 ja, 3 ja“): eine Linie durch die Stützpunkte, als Catmull-Rom gezeichnet
 * (`LEGACY_CATMULL`, dieselbe Kurve wie die Karte). Nur die Enden rasten ein, an Orten und an Stützpunkten anderer Wege, nie an der
 * Strecke dazwischen und nie am Ziel des anderen Endes (Anfang und Ende dürfen nicht aufeinander liegen). Die Enden bleiben beim
 * Löschen, ein Weg behält zwei Punkte. Jede Handbewegung ist ein Schritt im Entwurf, geschrieben wird erst mit „Fertig“ (EDIT-0003
 * G4, Vali 2026-10-31); deckungsgleiche Punkte anderer Wege am Knoten ohne Ort ziehen mit. Die Hülle des Fangradius steht schon in
 * Ruhe an beiden Enden. Geländemarken (`gipfel`) nennt der Aufrufer nur einem Fluss oder Bach als Ziel (OPS-000088).
 */
export const WEG: GeometrieArt = {
    id: "weg",
    teilart: "linie",
    rundung: (punkte) => catmullRomLine(punkte),
    ziele: (stelle, teil) => (istEnde(stelle, teil) ? ["ort", "ecke", "gipfel"] : []),
    zielErlaubt: (ziel, stelle, teil) => {
        const anderes = stelle.index === 0 ? teil.punkte.at(-1) : teil.punkte[0];
        // Anfang und Ende liegen nie aufeinander (`weg-regeln.ts`, dieselbe Regel prüft der Server in `path-edit.ts`).
        return anderes === undefined || !deckungsgleich(ziel.at, anderes);
    },
    mindestens: WEG_MINDESTENS,
    loeschbar: (stelle, teil) => !istEnde(stelle, teil) && teil.punkte.length > WEG_MINDESTENS,
    einfuegen: true,
    speichern: { art: "sofort" },
    mitziehen: true,
    huelleInRuhe: (stelle, teil) => istEnde(stelle, teil),
};

/**
 * Der Fluss und der Bach (Vali 2026-11-08: „dass beim Editieren von Flussverläufen in der Derographie Flüsse an Seen, anderen Flächen
 * und anderen Flüssen "andocken" können - sprich dass der normale Snap wie bei der Wegbearbeitung erscheint“): ein Weg, an dem JEDER
 * Stützpunkt einrastet, an Ecken und Kanten der Flächen (auch Seeufer) und an Stützpunkten und Strecken anderer Flüsse, eine Ecke vor
 * einer Kante wie überall. Die Enden rasten dazu wie beim Weg an Orten, Stützpunkten anderer Wege und Geländemarken (OPS-000088) ein,
 * innere Punkte nie an einem Landweg (`amWasser` sagt, welche Ecke zu einem Fluss oder einer Fläche gehört). Zeichen, Kringel, Hülle und
 * „Strg löst“ sind die des Geometrie-Moduls, wie beim Weg. Gespeichert wird nur die Lage, keine Verbindung „mündet in“.
 */
export function flussArt(amWasser: (ziel: Ziel) => boolean): GeometrieArt {
    return {
        ...WEG,
        id: "fluss",
        ziele: (stelle, teil) => (istEnde(stelle, teil) ? ["ort", "ecke", "gipfel", "kante"] : ["ecke", "kante"]),
        zielErlaubt: (ziel, stelle, teil) =>
            istEnde(stelle, teil) ? WEG.zielErlaubt(ziel, stelle, teil) : ziel.art === "kante" || amWasser(ziel),
    };
}

/**
 * Ein geschlossener Ring (der erste Punkt am Ende wiederholt) gerundet wie die Karte rundet: dasselbe Rezept (`SMOOTH_NET_OPTIONS`,
 * drei Durchgänge Chaikin, ein halber Bildpunkt bei Zoom 8), für den Ring allein. Die Karte rechnet das Netz aller Flächen, in dem
 * gemeinsame Grenzen an den Stellen fest bleiben, wo drei Flächen zusammenstoßen; die Vorschau rundet den Ring durch und weicht nur
 * an diesen Stellen ab (WI-0178 C1). Gespeichert wird ohnehin der eckige Umriss; die Karte rundet danach selbst.
 */
export function rundeRing(punkte: readonly Punkt[]): Punkt[] {
    if (punkte.length < 4) return [...punkte];
    const roh = new Float64Array(punkte.length * 2);
    punkte.forEach((p, i) => {
        roh[2 * i] = p.x;
        roh[2 * i + 1] = p.y;
    });
    const rund = smoothLine(roh, SMOOTH_NET_OPTIONS.passes, false, SMOOTH_NET_OPTIONS.resolution, 4);
    const aus: Punkt[] = [];
    for (let i = 0; i + 1 < rund.length; i += 2) aus.push({ x: rund[i]!, y: rund[i + 1]! });
    return aus;
}

/**
 * Die Fläche (WI-0178 C1; EDIT-0004 §2.3, B4, G4; EDIT-0003 T27 (6)): Ringe je Teilfläche samt Löchern, je Ring mindestens drei
 * Ecken. Jede Ecke rastet an Ecken und Kanten anderer Flächen und an Stützpunkten der Flüsse ein, eine Ecke vor einer Kante (Legacy,
 * Owner 2026-07-29), nie an der eigenen Teilfläche. Gemeinsame Ecken anderer Flächen ziehen mit (Strg löst). Doppelklick auf die
 * Kante setzt eine Ecke, auf eine Ecke löscht sie, solange drei bleiben. Die Vorschau ist die fertige Rundung, die Ecken dünn dazu;
 * gespeichert wird der eckige Umriss, erst mit „Fertig“ (T27 (4), EDIT-0003 G4). Die Angabe `speichern` (gebündelt, 800 ms) liest
 * kein Verbraucher mehr.
 */
export const FLAECHE: GeometrieArt = {
    id: "flaeche",
    teilart: "ring",
    rundung: (punkte) => rundeRing(punkte),
    ziele: () => ["ecke", "kante"],
    zielErlaubt: (ziel, _stelle, teil) => ziel.objekt !== teil.objekt,
    mindestens: 3,
    loeschbar: (_stelle, teil) => teil.punkte.length > 3,
    einfuegen: true,
    speichern: { art: "gebuendelt", ms: 800 },
    mitziehen: true,
    huelleInRuhe: () => false,
    eckenZeigen: true,
    markieren: true,
};

/**
 * Das Herrschaftsgebiet (WI-0209 C1; EDIT-0005 §9 „C1“, T23): wie die Fläche, aber ohne Rundung, denn die Karte zeichnet Gebiete eckig
 * (`territory_fill_render`). Eingerastet wird an Ecken und Kanten der Flächen anderer Gebiete, gemeinsame Ecken ziehen mit (Strg löst),
 * die eigene Teilfläche ist nie ein Ziel. Ein Entwurf, „Fertig“ schreibt (C2).
 */
export const GEBIET: GeometrieArt = {
    ...FLAECHE,
    id: "gebiet",
    rundung: (punkte) => [...punkte],
    eckenZeigen: false,
    teilLoeschbar: true,
};

/**
 * EINE Punkt-Strategie für Ort, Gipfel und Landmarke (WI-0271 L4; Editor-Orchestrierung 2026-10-31: „EINE Punkt-Strategie im
 * Geometrie-Modul mit Optionen (Mitziehen der Wegenden nur beim Ort) statt der heutigen zwei Punkt-Arten … und keiner dritten“): ein Punkt
 * im Fangradius aller Editoren, die Hülle schon in Ruhe um ihn (der Griffring). Nichts wird gesetzt oder gelöscht; jede Handbewegung ist ein
 * Schritt im Entwurf (man zieht mehrmals), „Fertig“ schreibt EINE Operation mit der letzten Lage (EDIT-0003 G4, Vali 2026-10-31).
 * `speichern: sofort` heißt nur, dass der Modus jede Handbewegung gleich meldet; geschrieben wird nie beim Loslassen.
 *
 * Die eine Option `amWegnetz`: Der Punkt rastet an freien Wegenden ein (Zielart `ecke`, die Enden kommen als Ziele vom Aufrufer), und die
 * Wegenden an ihm ziehen mit (der Aufrufer reicht sie als Nachbarn, je Ende eine Strecke vom Nachbarpunkt zum Punkt); Strg und der lange
 * Druck am Finger lösen sie. Ohne sie (Gipfel, Landmarke) rastet nichts ein und nichts zieht mit.
 */
export function punktArt(optionen: { readonly id: string; readonly amWegnetz: boolean }): GeometrieArt {
    return {
        id: optionen.id,
        teilart: "punkt",
        // Die Nachbarn sind Strecken zum Punkt: gerade gezeichnet wie bisher die gestrichelte Vorschau (E12).
        rundung: (punkte) => [...punkte],
        ziele: () => (optionen.amWegnetz ? ["ecke"] : []),
        zielErlaubt: () => optionen.amWegnetz,
        mindestens: 1,
        loeschbar: () => false,
        einfuegen: false,
        speichern: { art: "sofort" },
        mitziehen: optionen.amWegnetz,
        huelleInRuhe: () => true,
        ...(optionen.amWegnetz ? {} : { loesen: false as const }),
    };
}

/** Der Ort (WI-0177 Stufe 4; EDIT-0001 §4.4, G4, G12; EDIT-0003 T12): am Wegnetz; „Fertig“ schreibt `place.move`. */
export const ORT: GeometrieArt = punktArt({ id: "ort", amWegnetz: true });

/** Gipfel und jede Landmarke (WI-0178 P2, WI-0271 L4): ohne Einrasten und Mitziehen; „Fertig“ schreibt `peak.update` oder `peak.create`. */
export const LANDMARKE: GeometrieArt = punktArt({ id: "landmarke", amWegnetz: false });

/**
 * Der neue Weg (WI-0177 „Neuer Weg“; EDIT-0003 T40 (3), R12; Probierentwurf P5): Punkt für Punkt, gezeichnet wie die Karte (Catmull-Rom).
 * Jeder Klick rastet an Orten und an Stützpunkten anderer Wege ein, nie an der Strecke dazwischen (wie die Wegkurve, WI-0177 §5). Am Ort
 * beendet der Klick („Weg hier abschließen“), am Stützpunkt eines anderen Wegs rastet er nur ein, und es geht weiter (P5, R12: „Weg am
 * Ort“). Fertig ab zwei Punkten, nie mit dem Ende auf dem Anfang (wie Legacy: „Start und Ziel sind identisch.“). Einem Fluss oder Bach nennt der Aufrufer auch Geländemarken (OPS-000088);
 * an ihnen rastet er ein, und es geht weiter.
 */
export const WEG_ANLEGEN: AnlegenArt = {
    id: "weg",
    teilart: "linie",
    rundung: (punkte) => catmullRomLine(punkte),
    ziele: () => ["ort", "ecke", "gipfel"],
    amZiel: (ziel) => (ziel.art === "ort" ? "beenden" : "einrasten"),
    mindestens: WEG_MINDESTENS,
    // Wie der Server beim Anlegen (`path-create.ts`), mit denselben Regeln aus `weg-regeln.ts`.
    pruefe(punkte) {
        if (punkte.length < WEG_MINDESTENS) return "zuWenig";
        return endenAufeinander(punkte) ? "aufeinander" : undefined;
    },
};

/**
 * Der neue Fluss oder Bach (Vali 2026-11-08, wie `flussArt`): gezeichnet wie der neue Weg, jeder Klick rastet dazu an Ecken und Kanten
 * der Flächen und an Strecken anderer Flüsse ein, und es geht weiter; nur ein Ort beendet.
 */
export const FLUSS_ANLEGEN: AnlegenArt = {
    ...WEG_ANLEGEN,
    id: "fluss",
    ziele: () => ["ort", "ecke", "gipfel", "kante"],
};

/**
 * Die neue Fläche (C3 „Neue Fläche“, `neue-flaeche.ts`; EDIT-0003 T47, R12; Spalte „Fläche“ der Tafel im Kopf von `anlegen.ts`): ein Ring
 * Ecke für Ecke, gezeichnet wie die Karte (Chaikin, `rundeRing`). Jeder Klick rastet an Ecken und Kanten anderer Flächen ein, eine Ecke
 * vor einer Kante (wie `FLAECHE`); nur der eigene erste Punkt beendet, ab drei Ecken (`schliesst`, R12: „die Fläche am ersten Punkt“).
 * Strg löst das Einrasten für diesen Klick.
 */
export const FLAECHE_ANLEGEN: AnlegenArt = {
    id: "flaeche",
    teilart: "ring",
    rundung: (punkte) => rundeRing(punkte),
    ziele: () => ["ecke", "kante"],
    amZiel: () => "einrasten",
    schliesst: true,
    mindestens: 3,
    pruefe: (punkte) => (punkte.length < 3 ? "zuWenig" : undefined),
};

/** Das neue Herrschaftsgebiet (C3; Spalte „Gebiet“ der Tafel in `anlegen.ts`): wie die neue Fläche, aber eckig wie die Karte (`GEBIET`). */
export const GEBIET_ANLEGEN: AnlegenArt = {
    ...FLAECHE_ANLEGEN,
    id: "gebiet",
    rundung: (punkte) => [...punkte],
};

/**
 * Die Teilfläche einer Sprache (WI-0261 S5d2; E2, E4; Betreiber 2026-10-30: „flächen dürfen sich überlappen und sind unabhängig voneinander“):
 * ein Ring wie das Herrschaftsgebiet, eckig wie die Karte die Sprachflächen zeichnet (`sprache_flaeche_render`), aber 🔴 **ohne Einrasten**
 * und **ohne Mitziehen**: Keine Ecke rastet an einer anderen Sprache (oder sonst irgendwo) ein, und keine fremde Ecke zieht mit. Löschen
 * und Einfügen wie bei der Fläche; der Server prüft nur die eigene Form (`packages/shared/src/sprachen-editor.ts`).
 */
export const SPRACHE: GeometrieArt = {
    ...GEBIET,
    id: "sprache",
    teilLoeschbar: false,
    ziele: () => [],
    zielErlaubt: () => false,
    mitziehen: false,
};

/** Die neue Teilfläche einer Sprache (WI-0261 S5d2): Ecke für Ecke, eckig, ohne Einrasten; nur der eigene erste Punkt schließt. */
export const SPRACHE_ANLEGEN: AnlegenArt = {
    ...GEBIET_ANLEGEN,
    id: "sprache",
    ziele: () => [],
};

/**
 * Ein Fluss im Kammeditor (WI-0259, OPS-071; Vali 2026-10-30: „flüsse werden glaub via catlmull rom geglättet“): gezeichnet wie auf der Karte,
 * als Catmull-Rom (`LEGACY_CATMULL`) durch die Stützpunkte. Liegt das Stück mitten im Flussweg, gehen seine Nachbarn davor und dahinter in die
 * Tangenten der Enden ein (`Teil.anschluss`), damit die Kurve an der Grenze der Fläche dieselbe ist wie auf der Karte; gezeichnet wird nur das Stück.
 */
function flussKurve(punkte: readonly Punkt[], teil: Teil): Punkt[] {
    const vor = teil.anschluss?.vor;
    const nach = teil.anschluss?.nach;
    const kurve = catmullRomLine([...(vor ? [vor] : []), ...punkte, ...(nach ? [nach] : [])]);
    // Je Abschnitt zwischen zwei Stützpunkten `samples` Punkte: Der Abschnitt zum Nachbarn davor und der zum Nachbarn dahinter fallen weg.
    const je = LEGACY_CATMULL.samples;
    return kurve.slice(vor ? je : 0, nach ? kurve.length - je : undefined);
}

/**
 * Das Gebirgsnetz (WI-0245 D2, EDIT-0003 §6 „Gebirgsnetz“, Variante A; Bauvorlage Gebirge-Entwurf V16): EIN Objekt je Gebirgsfläche, seine
 * Teile sind die Kämme (Linien) und die Nebengipfel (Punkte, `Teil.art` `punkt`). Gerade gezeichnet: Das Netz ist kein Weg (nur die Flüsse zum Wählen, `Teil.fest`, sind wie auf der Karte gerundet, `flussKurve`). Kammenden rasten
 * an Gipfeln und Nebengipfeln (`gipfel`) und an Punkten anderer Kämme (`ecke`) ein, nie am eigenen Kamm; innere Punkte und Nebengipfel
 * rasten nicht. Deckungsgleiche Punkte im Netz ziehen mit (ein Knoten bleibt ein Knoten), Strg löst. Doppelklick auf die Kante setzt einen
 * Punkt, auf einen Punkt eines Kamms mit mehr als zwei Punkten löscht ihn; Nebengipfel löscht die Leiste. Strg über einem Kamm teilt ihn
 * nicht in vier (`strgTeilt: false`, Betreiber 2026-10-25); Strg beim Ziehen löst weiter. Der Aufrufer schreibt jede Handbewegung in den
 * EINEN Entwurf der Landschaft; „Fertig“ schreibt.
 */
export const GEBIRGSNETZ: GeometrieArt = {
    id: "gebirgsnetz",
    teilart: "linie",
    rundung: (punkte, teil) => (teil?.fest === true && teil.art === "linie" ? flussKurve(punkte, teil) : [...punkte]),
    ziele: (stelle, teil) => (teil.art === "linie" && istEnde(stelle, teil) ? ["gipfel", "ecke"] : []),
    zielErlaubt: (ziel, _stelle, teil) => ziel.stelle === undefined || ziel.stelle.nr !== teil.nr,
    mindestens: 2,
    loeschbar: (_stelle, teil) => teil.art === "linie" && teil.punkte.length > 2,
    einfuegen: true,
    strgTeilt: false,
    speichern: { art: "sofort" },
    mitziehen: true,
    huelleInRuhe: () => false,
};

/**
 * Ein neuer Kamm im Gebirgsnetz (WI-0245 D2; Spalte „Kamm“ der Tafel in `anlegen.ts`): Punkt für Punkt, gerade. Jeder Klick rastet an
 * Gipfeln, Nebengipfeln und Punkten anderer Kämme ein, und es geht weiter: Ein Kamm läuft über einen Gipfel hinweg, er endet mit
 * Doppelklick, Enter oder „Fertig“ (R3), ab zwei Punkten.
 */
export const KAMM_ANLEGEN: AnlegenArt = {
    id: "kamm",
    teilart: "linie",
    rundung: (punkte) => [...punkte],
    ziele: () => ["gipfel", "ecke"],
    amZiel: () => "einrasten",
    mindestens: 2,
    pruefe: (punkte) => (punkte.length < 2 ? "zuWenig" : undefined),
};

/**
 * Ein Nebengipfel im Gebirgsnetz (WI-0245 D2): ein einzelner Punkt ohne Einrasten. Der Aufrufer beendet nach dem ersten Klick
 * (`fertig()`) und setzt den Nebengipfel mit der Vorgabe-Höhe des Modells.
 */
export const NEBENGIPFEL_SETZEN: AnlegenArt = {
    id: "nebengipfel",
    teilart: "linie",
    rundung: (punkte) => [...punkte],
    ziele: () => [],
    amZiel: () => "einrasten",
    mindestens: 1,
    pruefe: (punkte) => (punkte.length < 1 ? "zuWenig" : undefined),
};
