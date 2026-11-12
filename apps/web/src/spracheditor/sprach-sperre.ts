import type { EditorLock, EditorLockTarget } from "@avesmaps3d/shared";
import type { EditorSperre, NimmErgebnis } from "../editor-sperre/sperre";

/**
 * Die EINE Sperre einer Sprache, geteilt von allen, die an ihr schreiben (WI-0261 S5d2; Vertrag: „Eine Sprache wird als Ganzes gesperrt“,
 * jede Operation an ihr und an ihren Teilflächen verlangt sie, sonst 409 `lock_required`). Muster: die Sperre der Orte
 * (`ortseditor/ort-sperre.ts`), dort halten „Ort verschieben“ und die Entwürfe der Fenster einen Ort gemeinsam.
 *
 * Hier halten sie: die Bearbeitung der Felder (Teil `felder`), „◇ Fläche bearbeiten“ (Teil `form`), „✚ Teilfläche zeichnen“ beim Schreiben,
 * die Knöpfe „Stilllegen“ und „Zurückholen“ und ↺ im Verlauf. Jeder bekommt einen eigenen **Halter** (`halter()`): Er nimmt und gibt nur
 * für sich, frei wird die Sprache erst, wenn keiner mehr hält. Sonst gäbe das Ende von „Fläche bearbeiten“ die Sperre frei, während die
 * Felder noch ungeschrieben im Entwurf stehen, und ihr „Fertig“ bekäme 409 `lock_required`.
 *
 * - Fragen zwei zugleich, geht EINE Frage an den Server.
 * - Geht die Sperre verloren (15 Minuten ohne Herzschlag, ein Admin hebt sie auf), gilt sie für alle Halter als verloren; jeder erfährt es
 *   über sein `beiVerlust` und nimmt sie beim nächsten Schreiben neu.
 * - Andere Arten reicht der Halter unverändert an die Sperre der Seite weiter.
 */

export type SperrHalter = Pick<EditorSperre, "nimm" | "gib" | "beiVerlust" | "liste"> &
    Partial<Pick<EditorSperre, "bieteFreigabe">>;

export interface SprachSperre {
    /** Ein neuer Halter; jeder Nutzer (Bearbeitung, Modus, Knopf) nimmt einen eigenen. */
    halter(): SperrHalter;
    /** Hält irgendein Halter dieser Seite die Sprache? */
    haelt(id: string): boolean;
    /**
     * Schreibt einmal unter der Sperre: nimmt sie (Teil `felder`), schreibt und gibt sie wieder ab. Hält ein anderer die Sprache, kommt
     * `gesperrt` mit der Sperre, ohne Verbindung `fehler`.
     */
    unter<T>(id: string, schreibe: () => Promise<T>): Promise<T | Exclude<NimmErgebnis, { art: "genommen" }>>;
    destroy(): void;
}

const ART = "sprache";
const istSprache = (ziel: EditorLockTarget): boolean => ziel.kind === ART;

export function createSprachSperre(sperre: SperrHalter): SprachSperre {
    const halter = new Map<string, Set<object>>();
    const gehalten = new Map<string, EditorLock>();
    const fragt = new Map<string, Promise<NimmErgebnis>>();
    // Zuerst die eigene Buchhaltung: Wer danach vom Verlust hört, findet die Sprache schon frei.
    const abmelden = sperre.beiVerlust((ziel) => {
        if (!istSprache(ziel)) return;
        gehalten.delete(ziel.id);
        halter.delete(ziel.id);
    });

    async function nimm(ziel: EditorLockTarget, teil: Parameters<SperrHalter["nimm"]>[1], wer: object) {
        const schon = gehalten.get(ziel.id);
        if (schon !== undefined) {
            halter.get(ziel.id)?.add(wer);
            return { art: "genommen", sperre: schon } as const;
        }
        let frage = fragt.get(ziel.id);
        if (frage === undefined) {
            frage = sperre.nimm(ziel, teil);
            fragt.set(ziel.id, frage);
        }
        const ergebnis = await frage;
        if (fragt.get(ziel.id) === frage) fragt.delete(ziel.id);
        if (ergebnis.art === "genommen") {
            gehalten.set(ziel.id, ergebnis.sperre);
            const menge = halter.get(ziel.id) ?? new Set<object>();
            menge.add(wer);
            halter.set(ziel.id, menge);
        }
        return ergebnis;
    }

    function gib(ziel: EditorLockTarget, wer: object): void {
        const menge = halter.get(ziel.id);
        if (menge === undefined || !menge.delete(wer) || menge.size > 0) return;
        halter.delete(ziel.id);
        gehalten.delete(ziel.id);
        sperre.gib(ziel);
    }

    function neuerHalter(): SperrHalter {
        const wer = {};
        return {
            nimm: (ziel, teil) => (istSprache(ziel) ? nimm(ziel, teil, wer) : sperre.nimm(ziel, teil)),
            gib: (ziel) => (istSprache(ziel) ? gib(ziel, wer) : sperre.gib(ziel)),
            beiVerlust: (zuhoerer) => sperre.beiVerlust(zuhoerer),
            liste: (art) => sperre.liste(art),
            ...(sperre.bieteFreigabe === undefined
                ? {}
                : { bieteFreigabe: (ziel, angebot) => sperre.bieteFreigabe!(ziel, angebot) }),
        };
    }

    return {
        halter: neuerHalter,
        haelt: (id) => gehalten.has(id),
        async unter(id, schreibe) {
            const einer = neuerHalter();
            const ziel = { kind: ART, id } as const;
            const ergebnis = await einer.nimm(ziel, "felder");
            if (ergebnis.art !== "genommen") return ergebnis;
            try {
                return await schreibe();
            } finally {
                einer.gib(ziel);
            }
        },
        destroy() {
            abmelden();
            halter.clear();
            gehalten.clear();
            fragt.clear();
        },
    };
}
