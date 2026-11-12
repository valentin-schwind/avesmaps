import {
    AVENTURIA_POLITICAL_CARTOGRAPHY,
    BEWERTUNG_GRENZEN,
    aventurischesDatumHeute,
    normalisiereAventurischesDatum,
    type BewertungBody,
    type BewertungGrund,
    type BewertungMeldenBody,
} from "@avesmaps3d/shared";
import type { MessageKey } from "../i18n/de";
import { kuerzeZeichen, zeichenZahl, type FormularKennung } from "./api";

/**
 * Was die Fenster „Bewertung schreiben“ und „Bewertung melden“ rechnen (WI-0269 C10; Bedienkonzept §6.3), ohne Browser: Pflichtfelder samt Grund der Sperre, Sternwahl mit den Pfeiltasten,
 * der Rumpf der Anfrage. Wie es aussieht, steht in `bewertung-fenster.vue` und `bewertung-melden-fenster.vue`.
 *
 * - **Pflicht ist nur die Wertung** (1 bis 5 ganze Sterne); Text (höchstens 200), Name (höchstens 80) und aventurisches Datum sind freiwillig. Ein falsches Datum sperrt mit Grund, leer
 *   ist erlaubt (dann gilt der heutige Tag im Kalender der Anwendung).
 * - Das freiwillige Mailfeld für den Änderungslink (E8) gibt es noch nicht: Es braucht den Mailweg (Umsetzungsplan C6).
 */

export interface BewertungsEntwurf {
    /** 0: noch nichts gewählt. */
    sterne: number;
    text: string;
    name: string;
    datum: string;
    /** Das Honigtopf-Feld: Ein Mensch sieht es nie, ein einfacher Bot füllt es. */
    honig: string;
}

export function leererBewertungsEntwurf(sterne = 0): BewertungsEntwurf {
    return { sterne: sterne >= 1 && sterne <= 5 ? Math.round(sterne) : 0, text: "", name: "", datum: "", honig: "" };
}

/** Warum „Bewertung absenden“ gerade gesperrt ist, als Sprachschlüssel; `undefined`, wenn alles da ist. */
export function bewertungSperrGrund(entwurf: BewertungsEntwurf): MessageKey | undefined {
    if (entwurf.sterne < 1 || entwurf.sterne > 5) return "bewertungen.schreiben.sperre.sterne";
    // Der Server zählt in Codepunkten (WI-0291): ein Emoji ist ein Zeichen.
    if (zeichenZahl(entwurf.text.trim()) > BEWERTUNG_GRENZEN.textMax) return "bewertungen.schreiben.sperre.text";
    if (normalisiereAventurischesDatum(entwurf.datum) === null) return "bewertungen.schreiben.sperre.datum";
    return undefined;
}

/** Der Platzhalter am Datumsfeld: der heutige Tag im aventurischen Kalender („leer: heute, 30. Travia 1049 BF“). */
export const datumHeute = (jetzt: Date = new Date()): string =>
    aventurischesDatumHeute(jetzt, AVENTURIA_POLITICAL_CARTOGRAPHY.displayYearBf);

/**
 * Die Sternwahl mit der Tastatur (Radiogruppe nach WAI-ARIA): ← und ↓ senken, → und ↑ erhöhen, Pos1 und Ende springen an die Ränder; die Wahl bleibt in 1 bis 5. Gibt `undefined`, wenn die Taste
 * nichts bedeutet.
 */
export function sterneNachTaste(sterne: number, taste: string): number | undefined {
    const aktuell = sterne >= 1 && sterne <= 5 ? sterne : 0;
    switch (taste) {
        case "ArrowRight":
        case "ArrowUp":
            return Math.min(5, aktuell + 1);
        case "ArrowLeft":
        case "ArrowDown":
            return Math.max(1, aktuell === 0 ? 1 : aktuell - 1);
        case "Home":
            return 1;
        case "End":
            return 5;
        default:
            return undefined;
    }
}

/** Der Rumpf der Anfrage. Wirft, wo `bewertungSperrGrund` etwas meldet: Der Aufrufer prüft zuerst. Leere Felder fehlen im Rumpf. */
export function bewertungsBody(
    kennung: Pick<FormularKennung, "operationId">,
    ortId: string,
    entwurf: BewertungsEntwurf,
    dauerMs: number,
): BewertungBody {
    if (bewertungSperrGrund(entwurf) !== undefined) throw new Error("Formular unvollständig");
    const text = entwurf.text.trim();
    const name = entwurf.name.trim();
    const datum = normalisiereAventurischesDatum(entwurf.datum) ?? "";
    return {
        operationId: kennung.operationId,
        ort: ortId,
        sterne: entwurf.sterne,
        ...(text === "" ? {} : { text }),
        ...(name === "" ? {} : { name: kuerzeZeichen(name, BEWERTUNG_GRENZEN.nameMax) }),
        ...(datum === "" ? {} : { datum }),
        falle: { feld: entwurf.honig, dauerMs: Math.max(0, Math.round(dauerMs)) },
    };
}

// --- Melden ---------------------------------------------------------------------------------------------------------------------------

export interface MeldeEntwurfBewertung {
    grund: BewertungGrund | "";
    text: string;
    honig: string;
}

export const leererMeldeEntwurf = (): MeldeEntwurfBewertung => ({ grund: "", text: "", honig: "" });

export function meldeSperrGrund(entwurf: MeldeEntwurfBewertung): MessageKey | undefined {
    if (entwurf.grund === "") return "bewertungen.melden.sperre.grund";
    if (zeichenZahl(entwurf.text.trim()) > BEWERTUNG_GRENZEN.beschreibungMax) return "bewertungen.melden.sperre.text";
    return undefined;
}

export function meldeBody(
    kennung: FormularKennung,
    entwurf: MeldeEntwurfBewertung,
    dauerMs: number,
): BewertungMeldenBody {
    if (entwurf.grund === "" || meldeSperrGrund(entwurf) !== undefined) throw new Error("Formular unvollständig");
    const text = entwurf.text.trim();
    return {
        operationId: kennung.operationId,
        schluessel: kennung.schluessel,
        grund: entwurf.grund,
        ...(text === "" ? {} : { text }),
        falle: { feld: entwurf.honig, dauerMs: Math.max(0, Math.round(dauerMs)) },
    };
}
