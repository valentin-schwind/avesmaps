import {
    wetterAufloesungKlasse,
    wetterBildrateKlasse,
    wetterGpuFamilie,
    wetterSpitzeKlasse,
    wetterStartKlasse,
    type WetterMetrik,
} from "@avesmaps3d/shared";

/**
 * Die Messung des experimentellen Wetters für die anonyme Besucherstatistik (WI-0288; Betreiber 2026-11-08: „insbesondere die
 * frametimes, fps der leute - ob sie das feature nutzen usw.“). Sie liegt im nachgeladenen Teil: Wer das Wetter nie einschaltet, lädt
 * sie nie. Was auch der Fehler beim Nachladen braucht, steht in `wetter-schalter.ts` (`meldeWetterMetrik`).
 *
 * - **Nutzung und Start**: sobald die Engine zum ersten Mal `bereit` meldet, einmal je Seitenaufruf. Der Start ist die Dauer vom ersten
 *   Einschalten (Beginn des Nachladens) bis dahin.
 * - **Leistung**: einmal je Seitenaufruf, wenn das Wetter nach `bereit` `FENSTER_MS` am Stück lief UND die Seite sichtbar war. Gemessen
 *   werden die Abstände der Bilder der Karte; das Wetter zeichnet ohnehin in jedem Bild neu, hier wird nichts zum Zeichnen gezwungen.
 *   Wird die Seite verborgen oder das Wetter ausgeschaltet, fällt das Fenster weg und beginnt beim nächsten Lauf neu.
 *
 * 🔴 **Nur Klassen, nie Messwerte** (`besucher-wetter.ts`): Median und 95. Perzentil bleiben im Browser, gemeldet wird der Korb.
 */

/** So lange muss das Wetter nach `bereit` am Stück laufen, sichtbar, bevor die Leistung zählt. */
export const MESSFENSTER_MS = 20_000;
/** Weniger Bilder als diese in einem Fenster sind keine Verteilung (die Seite stand): Das Fenster beginnt neu, gemeldet wird nichts. */
const MINDESTBILDER = 10;
/** Mehr Abstände behält ein Fenster nicht; bei 60 Bildern je Sekunde sind es 20 s mit Luft. */
const MAX_ABSTAENDE = 4000;

/** Was die Messung von der Engine braucht (`WetterEngine.stand()`). */
export interface MessStand {
    readonly bereit: boolean;
    readonly anteil: number;
    readonly gpu: string;
}

export interface MessUmgebung {
    /** Die Uhr in Millisekunden (`performance.now()`); der Test führt sie von Hand. */
    jetzt: () => number;
    /** Ist die Seite sichtbar (`document.visibilityState === "visible"`)? */
    sichtbar: () => boolean;
    /** Rechnet das Wetter gerade (ein Schalter im Auge ist an)? Die Griffe des Editors allein zählen nicht. */
    laeuft: () => boolean;
    stand: () => MessStand;
    /** Wann das Wetter zum ersten Mal anlief (derselbe Takt wie `jetzt`); ohne Angabe wird kein Start gemeldet. */
    startBeginn: () => number | undefined;
    melde: (metrik: WetterMetrik, klasse?: string) => void;
}

/** Der Wert beim Anteil `p` (0..1) einer aufsteigend sortierten, nicht leeren Liste (nächster Rang). */
function perzentil(sortiert: readonly number[], p: number): number {
    return sortiert[Math.min(sortiert.length - 1, Math.max(0, Math.ceil(p * sortiert.length) - 1))]!;
}

export interface WetterMessung {
    /** Ein Bild der Karte wurde gezeichnet (`map.on("render")`). */
    bild(): void;
    /** Im Takt aufrufen (halbe Sekunde): prüft `bereit`, die Sichtbarkeit und das Fenster. */
    tick(): void;
}

export function erzeugeWetterMessung(umgebung: MessUmgebung): WetterMessung {
    let nutzungGemeldet = false;
    let leistungGemeldet = false;
    /** Beginn des laufenden Fensters; `undefined`, solange keines läuft. */
    let fensterStart: number | undefined;
    let letztesBild: number | undefined;
    let abstaende: number[] = [];

    const verwirf = (): void => {
        fensterStart = undefined;
        letztesBild = undefined;
        abstaende = [];
    };

    return {
        bild(): void {
            if (fensterStart === undefined) return;
            const jetzt = umgebung.jetzt();
            // Der erste Abstand eines Fensters gehört zum Bild davor und zählt nicht.
            if (letztesBild !== undefined && abstaende.length < MAX_ABSTAENDE) abstaende.push(jetzt - letztesBild);
            letztesBild = jetzt;
        },
        tick(): void {
            if (nutzungGemeldet && leistungGemeldet) return;
            const jetzt = umgebung.jetzt();
            const stand = umgebung.stand();
            if (!stand.bereit) {
                verwirf();
                return;
            }
            if (!nutzungGemeldet) {
                nutzungGemeldet = true;
                umgebung.melde("wetter_lauf");
                const beginn = umgebung.startBeginn();
                if (beginn !== undefined) umgebung.melde("wetter_start", wetterStartKlasse(jetzt - beginn));
            }
            if (leistungGemeldet) return;
            // Nur ein Lauf, den die Person sieht, zählt: verborgene Seite oder ausgeschaltetes Wetter beenden das Fenster.
            if (!umgebung.sichtbar() || !umgebung.laeuft()) {
                verwirf();
                return;
            }
            if (fensterStart === undefined) {
                fensterStart = jetzt;
                return;
            }
            if (jetzt - fensterStart < MESSFENSTER_MS) return;
            if (abstaende.length < MINDESTBILDER) {
                verwirf();
                return;
            }
            const sortiert = [...abstaende].sort((a, b) => a - b);
            const median = perzentil(sortiert, 0.5);
            leistungGemeldet = true;
            verwirf();
            umgebung.melde("wetter_bildrate", wetterBildrateKlasse(1000 / Math.max(median, 0.001)));
            umgebung.melde("wetter_spitze", wetterSpitzeKlasse(perzentil(sortiert, 0.95)));
            umgebung.melde("wetter_aufloesung", wetterAufloesungKlasse(stand.anteil));
            umgebung.melde("wetter_gpu", wetterGpuFamilie(String(stand.gpu ?? "")));
        },
    };
}
