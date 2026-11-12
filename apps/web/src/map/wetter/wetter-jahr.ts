import {
    AVENTURIA_TRAVEL_MODEL,
    WETTER_JAHR_SPALTEN,
    wetterJahreswerte,
    wetterSchneegrenzen,
    type DepartureMonth,
    type WetterJahreswerte,
    type WetterPresetWerte,
} from "@avesmaps3d/shared";
import type { WetterEngine } from "./engine/wetter-engine";

/**
 * Die Jahreszeit des Wetters (WI-0288): Die 14 Presets halten die Werte, die sich mit dem Datum ändern; zwischen zwei Presets wird weich
 * übergeblendet (`wetterGeltung` im geteilten Paket, `packages/shared/src/wetter/jahr.ts`). Alle übrigen Werte gelten das ganze Jahr.
 *
 * - Seit Stufe 2 kommen die Presets aus dem Leseweg (`wetter-daten.ts`); ohne Antwort gelten ihre Vorgaben, die Jahrestafel des Prototyps
 *   an den 13 Tagen und `WETTER_UNBESTIMMT` für „unbestimmt“.
 * - **Das Datum** (Stufe 5, `wetterDatum` in `wetter-schalter.ts`) ist der Reisebeginn des Planers, während eines Replays plus die vergangenen Reisetage. Ohne
 *   Reisebeginn gilt das unbestimmte Preset, der Kartenstandard, auch im Replay.
 * - **Kleine Schritte folgt es sofort** (`FOLGEN_TAGE`, das Replay rückt je Bild um Bruchteile eines Tags vor): Die Werte gleiten mit dem
 *   Reisedatum, ohne Sprung je Tag und ohne Zeitraffer, und die Simulation läuft weiter. Ein Sprung (neuer Reisebeginn, Ende des Replays,
 *   Ziehen an der Leiste) gleitet über `GLEITEN_MS`, und das Wetter holt derweil im Zeitraffer auf. Neue Presets (`neuePresets`) blenden
 *   ebenso, ohne Zeitraffer.
 * - **Die Schneefallgrenze** je Klimazone kommt aus der Wegfindung (`wetterSchneegrenzen`) und folgt dem Datum mit `SCHNEE_TAU_MS`: Die
 *   Tafel rundet auf 100 Schritt, das Replay soll die Linie trotzdem nicht springen sehen. In Ruhe steht genau der Wert der Wegfindung.
 */

type Wetter = WetterEngine;

/** Der Reisebeginn des Planers (`PlannerOptions.departure`); `null` heißt „unbestimmt“. */
export type Reisebeginn = { month: DepartureMonth; day: number } | null;

/** Der Sprung zwischen zwei Daten in Tagen, über den Jahreswechsel hinweg; von und nach „unbestimmt“ zählt er als 15 Tage. */
export function tageZwischen(von: number | null, nach: number | null): number {
    if (von === null || nach === null) return von === nach ? 0 : 15;
    const abstand = Math.abs(nach - von);
    return Math.min(abstand, 365 - abstand);
}

const GLEITEN_MS = 2500;
/** Bis zu diesem Schritt folgt das Wetter dem Datum ohne Überblendung: Ein Replay rückt je Bild um Bruchteile eines Tags vor. */
export const FOLGEN_TAGE = 1;
/** So schnell folgt die Schneefallgrenze der Wegfindung: nach rund 2,5 s steht sie auf 2 % am Ziel, wie die Presets nach `GLEITEN_MS`. */
const SCHNEE_TAU_MS = 650;
/** Ab dieser Änderung rechnet die Engine das Himmelslicht neu (es kostet Millisekunden); darunter sieht man keinen Unterschied. */
const SONNE_SCHWELLE = { sunEl: 0.02, sunPower: 0.002 } as const;

export interface Jahreslauf {
    /** In jedem Bild: folgt dem Datum, gleitet nach einem Sprung und führt die Schneefallgrenze nach. */
    jeBild(): void;
    /** Die Presets haben sich geändert (neu gelesen): Die Jahreswerte gleiten vom jetzigen Stand zu den neuen. */
    neuePresets(): void;
}

/**
 * Die Schneefallgrenze je Rasterwert gleitet zum Ziel (`ziel`, Schritt; −1 heißt keine Grenze, dann gilt sofort das Ziel). `dt` in ms.
 * Gibt zurück, ob noch etwas gleitet. Ab einem halben Schritt Abstand steht das Ziel genau.
 */
export function gleiteSchneegrenzen(jetzt: Float32Array, ziel: readonly number[], dt: number): boolean {
    const k = 1 - Math.exp(-Math.max(0, dt) / SCHNEE_TAU_MS);
    let laeuft = false;
    for (let i = 0; i < ziel.length && i < jetzt.length; i++) {
        const z = ziel[i] as number;
        const j = jetzt[i] as number;
        if (z < 0 || j < 0 || Math.abs(z - j) < 0.5) jetzt[i] = z;
        else {
            jetzt[i] = j + (z - j) * k;
            laeuft = true;
        }
    }
    return laeuft;
}

/**
 * Setzt die Jahreswerte in die Engine und hält sie am Datum (`datum`, Tag im Jahr mit Bruchteil oder `null`). `presets` liefert den
 * jeweils gültigen Stand. `nachSturm` läuft, wenn sich die Sturmstärke ändert: Die Wirbelsymbole tragen sie in ihre Stärke
 * (`wetter-symbole.ts`).
 */
export function erzeugeJahreslauf(
    w: Wetter,
    datum: () => number | null,
    nachSturm: () => void,
    presets: () => readonly WetterPresetWerte[],
): Jahreslauf {
    let letzterTag: number | null | undefined;
    let gleiten: { von: WetterJahreswerte; start: number } | null = null;
    let sonne = { sunEl: Number.NaN, sunPower: Number.NaN };
    let schneeZiel: number[] = [];
    let schneeGleitet = false;
    let letztesBild = performance.now();

    const jetzige = (): WetterJahreswerte =>
        Object.fromEntries(WETTER_JAHR_SPALTEN.map((k) => [k, w.cfg[k]])) as WetterJahreswerte;

    const setzeWerte = (tag: number | null, e = 1, von: WetterJahreswerte | null = null): void => {
        const sturm = w.cfg.stuerme;
        const ziel = wetterJahreswerte(presets(), tag);
        for (const k of WETTER_JAHR_SPALTEN) w.cfg[k] = von ? von[k] + (ziel[k] - von[k]) * e : ziel[k];
        if (w.cfg.stuerme !== sturm) nachSturm();
        if (
            !(Math.abs(w.cfg.sunEl - sonne.sunEl) < SONNE_SCHWELLE.sunEl) ||
            !(Math.abs(w.cfg.sunPower - sonne.sunPower) < SONNE_SCHWELLE.sunPower)
        ) {
            sonne = { sunEl: w.cfg.sunEl, sunPower: w.cfg.sunPower };
            w.sonneGeaendert();
        }
    };

    const gleiteWeiter = (): void => {
        if (!gleiten) return;
        const f = Math.min(1, (performance.now() - gleiten.start) / GLEITEN_MS);
        setzeWerte(letzterTag ?? null, f * f * (3 - 2 * f), gleiten.von);
        if (f >= 1) gleiten = null;
    };

    const zielSchnee = (tag: number | null): void => {
        schneeZiel = wetterSchneegrenzen(AVENTURIA_TRAVEL_MODEL, tag);
        schneeGleitet = true;
    };

    // Ohne Zeitraffer liefe das Wetter einem Sprung minutenlang hinterher. Ab 15 Tagen (oder von und nach „unbestimmt“) bekommt es so viele
    // Schritte wie beim Einschwingen, darunter anteilig, verteilt etwas länger als die Überblendung der Werte.
    const pruefeTag = (): void => {
        const tag = datum();
        if (tag === letzterTag) return;
        const ersterLauf = letzterTag === undefined;
        const vorher = letzterTag ?? null;
        letzterTag = tag;
        zielSchnee(tag);
        if (ersterLauf) {
            setzeWerte(tag);
            w.sg.fill(-1);
            gleiteSchneegrenzen(w.sg, schneeZiel, Number.POSITIVE_INFINITY);
            schneeGleitet = false;
            return;
        }
        const tage = tageZwischen(vorher, tag);
        if (vorher !== null && tag !== null && tage <= FOLGEN_TAGE) {
            // Ein Replay: Läuft schon eine Überblendung, folgt deren Ziel dem Datum (`gleiteWeiter` liest `letzterTag`).
            if (!gleiten) setzeWerte(tag);
            return;
        }
        gleiten = { von: jetzige(), start: performance.now() };
        if (tage > 0) w.zeitraffer(Math.ceil(320 * Math.min(1, tage / 15)), GLEITEN_MS + 500);
    };

    pruefeTag();
    return {
        jeBild(): void {
            const jetzt = performance.now();
            pruefeTag();
            gleiteWeiter();
            if (schneeGleitet) schneeGleitet = gleiteSchneegrenzen(w.sg, schneeZiel, jetzt - letztesBild);
            letztesBild = jetzt;
        },
        neuePresets(): void {
            gleiten = { von: jetzige(), start: performance.now() };
        },
    };
}
