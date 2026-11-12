import { computed, shallowRef, type ComputedRef } from "vue";
import type { Werkzeugfenster } from "../editor-panel/werkzeugfenster";
import type { FensterBox } from "../fenster/fenster-lage";
import type { KorrekturEingabe } from "./medien-einreichung-modell";
import { medienOffen } from "./medien-oeffnen";

/**
 * „Stelle auf der Karte wählen“ in der Korrektur einer Reisebild-Einreichung (WI-0272 S3, Aufgabe 18): EINE Stelle für den Weg, den die Medienverwaltung nicht selbst
 * gehen kann, weil sie modal ist und die Karte ruht. Ablauf:
 *
 * 1. Der Kasten „Prüfen“ sagt „Stelle auf der Karte wählen“; das Fenster merkt sich das Asset (`starte`) und geht zu, damit die Karte frei ist.
 * 2. Die Karte nimmt den nächsten Klick als Stelle (`map/…`: `medien-stelle-layer.ts`), Esc bricht ab; ein Hinweis oben sagt es (`medien-stelle-hinweis.vue`).
 * 3. Danach geht die Medienverwaltung wieder auf, beim selben Asset, und der Kasten öffnet die Korrektur gleich mit der neuen Stelle (`ergebnis`, das er
 *    mit `verwerfe` abholt).
 * 4. 🔴 **Nichts geht dabei verloren** (Review S3 I2): Was in der Korrektur schon stand (Beschreibung, Ort, Bezug, Suchtext, eine frühere Stelle), geht mit `starte` in den
 *    Entwurf und kommt nach der Wahl UND nach dem Abbruch mit Esc zurück (`entwurf`, bis `verwerfe`). War die Medienverwaltung ein Werkzeugfenster, kommt auch sie
 *    in Lage und Größe zurück (`nimmFenster`, `holeMedienFensterZurueck`; `app.vue` hängt es ein): Beim Schließen verwirft die Seite das Werkzeugfenster.
 *
 * Wie „Stelle ändern“ im Formular der Besucher (`photobox/stelle-layer.ts`), nur für das andere Fenster; beide laufen nie zugleich. Die Stelle wird gezeigt, nie
 * gespeichert: Gespeichert wird sie erst mit „Korrektur speichern“ (`correct`).
 */

export interface GewaehlteStelle {
    /** Das Asset, dessen Einreichung korrigiert wird (`public_id`). */
    asset: string;
    lage: { x: number; y: number };
}

/** Was in der Korrektur stand, als die Wahl auf der Karte begann: Der Kasten spielt es nach der Wahl und nach dem Abbruch zurück. */
export interface KorrekturEntwurf {
    beschreibung: string;
    /** Eine Stelle, die schon früher gewählt war (die Wahl überstimmt sie); `undefined`, solange keine angefasst ist. */
    lage: { x: number; y: number } | undefined;
    ort: KorrekturEingabe["ort"];
    bezug: KorrekturEingabe["bezug"];
    suche: string;
}

/** Wo das Werkzeugfenster der Medienverwaltung stand, als die Wahl begann (nur, wenn es eines war; das modale Fenster hat keine Lage). */
export interface FensterVorWahl {
    lage: "angedockt" | "geloest";
    box: FensterBox | undefined;
}

const laeuft = shallowRef<{ asset: string } | undefined>(undefined);
const gewaehlt = shallowRef<GewaehlteStelle | undefined>(undefined);
const gemerkt = shallowRef<{ asset: string; entwurf: KorrekturEntwurf } | undefined>(undefined);
let fensterVorher: FensterVorWahl | undefined;

export interface MedienStelle {
    /** Läuft gerade die Wahl? Dann ist die Medienverwaltung zu und die Karte nimmt den nächsten Klick. */
    readonly waehlen: ComputedRef<boolean>;
    /** Die zuletzt gewählte Stelle, bis der Kasten sie abgeholt hat. */
    readonly ergebnis: Readonly<{ value: GewaehlteStelle | undefined }>;
    /** Der Entwurf der Korrektur von vor der Wahl, auch nach einem Abbruch, bis der Kasten ihn abgeholt hat (`verwerfe`). */
    readonly entwurf: Readonly<{ value: { asset: string; entwurf: KorrekturEntwurf } | undefined }>;
    /** Beginnt die Wahl für dieses Asset: das Fenster geht zu, die Karte wird frei. Entwurf und Lage des Werkzeugfensters kommen mit zurück. */
    starte(asset: string, entwurf?: KorrekturEntwurf, fenster?: FensterVorWahl): void;
    /** Die Karte meldet die Stelle: Die Wahl ist zu, die Medienverwaltung geht wieder auf. */
    setze(lage: { x: number; y: number }): void;
    /** Abbruch (Esc, „Abbrechen“): zurück zur Medienverwaltung, ohne Stelle. */
    beende(): void;
    /** Der Kasten hat Stelle und Entwurf abgeholt. */
    verwerfe(): void;
    /** Wo das Werkzeugfenster vor der Wahl stand (einmal abholbar): `app.vue` stellt es damit wieder hin, bevor die Medienverwaltung aufgeht. */
    nimmFenster(): FensterVorWahl | undefined;
}

export const medienStelle: MedienStelle = {
    waehlen: computed(() => laeuft.value !== undefined),
    ergebnis: gewaehlt,
    entwurf: gemerkt,
    starte(asset, entwurf, fenster) {
        laeuft.value = { asset };
        gewaehlt.value = undefined;
        gemerkt.value = entwurf === undefined ? undefined : { asset, entwurf };
        fensterVorher = fenster;
        medienOffen.value = false;
    },
    setze(lage) {
        const jetzt = laeuft.value;
        if (jetzt === undefined) return;
        laeuft.value = undefined;
        gewaehlt.value = { asset: jetzt.asset, lage };
        medienOffen.value = true;
    },
    beende() {
        if (laeuft.value === undefined) return;
        laeuft.value = undefined;
        medienOffen.value = true;
    },
    verwerfe() {
        gewaehlt.value = undefined;
        gemerkt.value = undefined;
    },
    nimmFenster() {
        const fenster = fensterVorher;
        fensterVorher = undefined;
        return fenster;
    },
};

/**
 * Das Werkzeugfenster der Medienverwaltung wieder hinstellen, wo es vor der Wahl stand: `app.vue` verwirft es, sobald die Medienverwaltung zugeht, und ohne Eintrag käme sie als modales Fenster
 * zurück. Steht schon ein Eintrag da (jemand hat sie inzwischen anders geöffnet), bleibt er, wie er ist.
 */
export function holeMedienFensterZurueck(
    werkzeugfenster: Pick<Werkzeugfenster, "stand" | "oeffne" | "setzeLage">,
    vorher: FensterVorWahl,
    titel: string,
): void {
    if (werkzeugfenster.stand.value.fenster.some((fenster) => fenster.werkzeug === "medien")) return;
    const id = werkzeugfenster.oeffne(
        { werkzeug: "medien", gegenstand: "medien", titel, nurLesen: false },
        vorher.lage,
    );
    werkzeugfenster.setzeLage(id, vorher.lage, vorher.box);
}
