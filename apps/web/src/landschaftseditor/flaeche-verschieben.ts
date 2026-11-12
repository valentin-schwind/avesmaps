import { shallowRef, watch, type ShallowRef } from "vue";
import type { Entwurf } from "../fenster/entwurf-kern";
import { FLAECHE } from "../map/geometrie/arten";
import type { Bild } from "../map/geometrie/bild";
import { bereitVon, startStand, type FlaechenQuelle, type FormBearbeitung } from "../map/geometrie/flaechen-quelle";
import type { FormStand } from "../map/geometrie/formentwurf";
import type { Punkt, Teil } from "../map/geometrie/geometrie";
import type { Umriss } from "../map/geometrie/kamera";
import { landschaftFlaechen, type LandschaftFlaechenOptionen } from "./landschaft-flaechen";

/**
 * „Verschieben“ einer ganzen Teilfläche (Werkzeug 7 der Derographie; Betreiber 2026-10-19, „A“: „Entwurf, „Fertig“ speichert, gemeinsame
 * Ecken lösen sich, Nachbarn bleiben, vor „Fertig“ verwerfbar“; Legacy `geometry-ops.js#L763-L820`).
 *
 * - **Wie Legacy** hängt die Teilfläche ab der Stelle des Kartenmenüs an der Maus (`griff`), und der nächste Klick setzt sie ab. Legacy
 *   speicherte dann sofort; hier ist das Absetzen ein **Schritt im Entwurf** der Bearbeitung der Landschaft (O3, wie „Ecken bearbeiten“
 *   und „Fläche vereinfachen“): ↶ ↷, „Verwerfen“ und „Fertig“ gehören ihr, „Fertig“ schreibt die Form als `landscape.update`.
 * - Ein Klick auf die abgesetzte Teilfläche hebt sie wieder auf; der nächste Klick setzt sie erneut ab (ein weiterer Schritt).
 * - 🔴 **Gemeinsame Ecken lösen sich, die Nachbarn bleiben stehen**: Es wandert nur diese Teilfläche, mit allen Stücken und Löchern;
 *   keine Nachbarin wird geschrieben oder gesperrt. Andere Teilflächen derselben Landschaft bleiben, wo sie sind.
 * - **Vorschau** in der gemeinsamen Schicht des Geometrie-Moduls: wo die Teilfläche lag, gestrichelt; wo sie jetzt steht, als Kante.
 * - **Auch an einer Teilfläche einer Sprache** (WI-0261 Stufe 2): mit ihrer Quelle beim Start (`map/geometrie/flaechen-quelle.ts`); „Fertig“ schreibt
 *   dort `sprache_flaeche.reshape`. Ohne Quelle gilt die Landschaft (`landschaft-flaechen.ts`).
 */

/** Was der Modus von der Karte braucht. */
export interface VerschiebenKarte {
    /** Die Vorschau samt Zeiger: zeichnet `bild()`, meldet Zeigen und Klick in Kartenkoordinaten. Ohne Karte `undefined`. */
    an(
        bild: () => Bild,
        zeiger: { bewege(punkt: Punkt): void; klick(punkt: Punkt): void },
    ): { aktualisiere(): void; aus(): void } | undefined;
    /** Die Teilfläche in die freie Fläche holen, wenn sie nicht frei zu sehen ist (Hausregel „Kamera fliegt immer“). */
    zeige(teile: readonly Umriss[]): Promise<unknown> | void;
}

export interface VerschiebenLauf {
    /** Die Landschaft (an einer Sprache die Kennung ihrer Teilfläche) und die Teilfläche, die wandert. */
    readonly id: string;
    readonly areaId: string;
    readonly name: string;
    readonly phase: "laedt" | "bereit";
    /** Die Teilfläche hängt an der Maus (bis zum nächsten Klick). */
    readonly haengt: boolean;
    readonly bearbeitung: FormBearbeitung | undefined;
    /** Woher die Fläche kommt (die Landschaft oder die Teilfläche einer Sprache). */
    readonly quelle: FlaechenQuelle;
}

export type VerschiebenMeldung =
    | { readonly art: "ohneFlaeche"; readonly name: string }
    | { readonly art: "ladefehler" }
    | { readonly art: "gespeichert"; readonly name: string };

export interface FlaecheVerschieben {
    readonly laufend: Readonly<ShallowRef<VerschiebenLauf | undefined>>;
    readonly meldung: Readonly<ShallowRef<VerschiebenMeldung | undefined>>;
    /** `griff`: die Stelle des Kartenmenüs (Kartenkoordinaten); dort hängt die Teilfläche an der Maus. Ohne `quelle` an der Landschaft. */
    starte(regionId: string, areaId: string, griff: Punkt, quelle?: FlaechenQuelle): Promise<void>;
    /** Die Form, wie die Karte sie zeigt (hängend oder abgesetzt). */
    stand(): FormStand | undefined;
    zurueck(): void;
    wieder(): void;
    /** Esc: fragt bei Ungeschriebenem, sonst endet der Modus. Gibt zurück, ob etwas lief. */
    abbrechen(): boolean;
    beende(): void;
    destroy(): void;
}

/** Die Landschaft als Quelle ohne Angabe beim Start (`landschaft-flaechen.ts`) und die Karte. */
export interface VerschiebenOptionen extends Omit<LandschaftFlaechenOptionen, "strich"> {
    readonly karte: VerschiebenKarte;
}

/** Die Teile dieser Teilfläche um den Versatz verschoben, alle anderen unverändert (Legacy `ecosystemMoveGeometry`). */
export function verschobeneTeile(teile: readonly Teil[], areaId: string, dx: number, dy: number): Teil[] {
    return teile.map((teil) =>
        teil.objekt === areaId ? { ...teil, punkte: teil.punkte.map((p) => ({ x: p.x + dx, y: p.y + dy })) } : teil,
    );
}

/** Liegt der Punkt im Ring (Strahl nach rechts, offener oder geschlossener Ring)? */
function imRing(punkte: readonly Punkt[], punkt: Punkt): boolean {
    let drin = false;
    for (let i = 0, j = punkte.length - 1; i < punkte.length; j = i++) {
        const a = punkte[i]!;
        const b = punkte[j]!;
        if (a.y > punkt.y !== b.y > punkt.y && punkt.x < ((b.x - a.x) * (punkt.y - a.y)) / (b.y - a.y) + a.x)
            drin = !drin;
    }
    return drin;
}

/**
 * Liegt der Punkt in dieser Teilfläche (in einem ihrer Stücke, nicht in einem Loch)? Gerade-Ungerade über alle ihre Ringe: Die Teile
 * zählen ihre Ringe nur durch (`teileAus`), welcher Ring ein Loch ist, steht im Aufbau; bei einer gültigen Form kommt dasselbe heraus.
 */
export function inTeilflaeche(teile: readonly Teil[], areaId: string, punkt: Punkt): boolean {
    return teile.filter((teil) => teil.objekt === areaId && imRing(teil.punkte, punkt)).length % 2 === 1;
}

const ring = (punkte: readonly Punkt[]): readonly Punkt[] => (punkte.length > 0 ? [...punkte, punkte[0]!] : punkte);

/** Die Vorschau: wo die Teilfläche lag (gestrichelt), wo sie jetzt steht (Kante). */
export function verschiebenBild(start: readonly Teil[], jetzt: readonly Teil[], areaId: string): Bild {
    const linien = (teile: readonly Teil[], rolle: "alt" | "kante") =>
        teile
            .filter((teil) => teil.objekt === areaId)
            .map((teil) => ({
                coords: FLAECHE.rundung(ring(teil.punkte), teil),
                rolle,
                objekt: teil.objekt,
                nr: teil.nr,
            }));
    return { linien: [...linien(start, "alt"), ...linien(jetzt, "kante")], anfasser: [], andock: [], ringe: [] };
}

export function createFlaecheVerschieben(optionen: VerschiebenOptionen): FlaecheVerschieben {
    const { karte } = optionen;
    const landschaft = landschaftFlaechen(optionen);
    const laufend = shallowRef<VerschiebenLauf | undefined>(undefined);
    const meldung = shallowRef<VerschiebenMeldung | undefined>(undefined);
    let sicht: Entwurf<FormStand> | undefined;
    let modus: { aktualisiere(): void; aus(): void } | undefined;
    let abbruch: AbortController | undefined;
    let stopSpeichern: (() => void) | undefined;
    /** Die Form beim Start (für den gestrichelten Umriss). */
    let basis: FormStand | undefined;
    /** Solange die Teilfläche an der Maus hängt: wo sie gefasst wurde, der Stand davor und was die Karte zeigt. */
    let gefasst: { griff: Punkt; von: FormStand; zeigt: FormStand } | undefined;
    let lauf = 0;

    const gezeigt = (): FormStand | undefined => gefasst?.zeigt ?? sicht?.jetzt();

    function bild(): Bild {
        const jetzt = gezeigt();
        const lauf = laufend.value;
        if (basis === undefined || jetzt === undefined || lauf === undefined)
            return { linien: [], anfasser: [], andock: [], ringe: [] };
        return verschiebenBild(basis.teile, jetzt.teile, lauf.areaId);
    }

    function setze(neu: Partial<VerschiebenLauf>): void {
        if (laufend.value !== undefined) laufend.value = { ...laufend.value, ...neu };
        modus?.aktualisiere();
    }

    /** Darf die Geste etwas ändern? Nicht beim Laden, nicht während „Fertig“ schreibt, nicht während die Frage steht. */
    function frei(): FormBearbeitung | undefined {
        const jetzt = laufend.value;
        const bearbeitung = jetzt?.bearbeitung;
        if (jetzt?.phase !== "bereit" || bearbeitung === undefined) return undefined;
        if (bearbeitung.zustand.value.art === "speichert" || bearbeitung.lage.value.frage) return undefined;
        return bearbeitung;
    }

    function bewege(punkt: Punkt): void {
        const jetzt = laufend.value;
        if (gefasst === undefined || jetzt === undefined || frei() === undefined) return;
        const { griff, von } = gefasst;
        gefasst = {
            ...gefasst,
            zeigt: { ...von, teile: verschobeneTeile(von.teile, jetzt.areaId, punkt.x - griff.x, punkt.y - griff.y) },
        };
        modus?.aktualisiere();
    }

    function klick(punkt: Punkt): void {
        const jetzt = laufend.value;
        const e = sicht?.jetzt();
        if (jetzt === undefined || e === undefined || frei() === undefined) return;
        if (gefasst === undefined) {
            // Abgesetzt: Ein Klick auf die Teilfläche hebt sie wieder auf.
            if (!inTeilflaeche(e.teile, jetzt.areaId, punkt)) return;
            gefasst = { griff: punkt, von: e, zeigt: e };
            setze({ haengt: true });
            return;
        }
        const { griff, von } = gefasst;
        gefasst = undefined;
        const dx = punkt.x - griff.x;
        const dy = punkt.y - griff.y;
        // Ein Klick an derselben Stelle setzt nur ab: kein Schritt, „0 ungespeichert“ bleibt wahr.
        if (Math.hypot(dx, dy) > 1e-9)
            sicht?.schritt({ ...von, teile: verschobeneTeile(von.teile, jetzt.areaId, dx, dy) });
        setze({ haengt: false });
    }

    function beende(): void {
        lauf += 1;
        abbruch?.abort();
        abbruch = undefined;
        modus?.aus();
        modus = undefined;
        const alt = sicht;
        sicht = undefined;
        // Die Form hängt ab; der Entwurf bleibt im Fenster der Landschaft.
        alt?.leere();
        basis = undefined;
        gefasst = undefined;
        laufend.value = undefined;
    }

    async function starte(
        regionId: string,
        areaId: string,
        griff: Punkt,
        quelle: FlaechenQuelle = landschaft,
    ): Promise<void> {
        const bearbeitung = quelle.bearbeitung(regionId);
        if (bearbeitung === undefined) return;
        beende();
        const meiner = lauf;
        const steuer = new AbortController();
        abbruch = steuer;
        meldung.value = undefined;
        laufend.value = { id: regionId, areaId, name: "", phase: "laedt", haengt: false, bearbeitung, quelle };
        let detail;
        try {
            const [gelesen, bereit] = await Promise.all([
                quelle.lade(regionId, bearbeitung, steuer.signal),
                bereitVon(bearbeitung),
            ]);
            detail = bereit ? gelesen : null;
        } catch {
            detail = undefined;
        }
        if (meiner !== lauf) return;
        if (detail === undefined || detail === null) {
            beende();
            meldung.value = { art: "ladefehler" };
            return;
        }
        if (!detail.flaechen.some((flaeche) => flaeche.id === areaId)) {
            beende();
            meldung.value = { art: "ohneFlaeche", name: detail.name };
            return;
        }
        const g0 = startStand(detail);
        sicht = bearbeitung.formEntwurf({
            zurueck: () => verschieben.zurueck(),
            wieder: () => verschieben.wieder(),
            verwerfen: () => {
                gefasst = undefined;
                sicht?.verwerfen();
                setze({ haengt: false });
            },
            abbrechen: () => verschieben.abbrechen(),
            beende,
        });
        // Die Form hängt an; liegt schon eine im Entwurf (nach „Ecken bearbeiten“), gilt sie. Die Sperre nimmt die Bearbeitung.
        sicht.beginne(g0);
        basis = sicht.jetzt() ?? g0;
        modus = karte.an(bild, { bewege, klick });
        if (modus === undefined) {
            beende();
            return;
        }
        // Wie Legacy hängt die Teilfläche ab der Stelle des Kartenmenüs an der Maus.
        gefasst = { griff, von: basis, zeigt: basis };
        laufend.value = { ...laufend.value, name: detail.name, phase: "bereit", haengt: true };
        stopSpeichern?.();
        let mitForm = false;
        stopSpeichern = watch(
            () => bearbeitung.zustand.value.art,
            (art) => {
                if (art === "speichert") mitForm = laufend.value !== undefined;
                else if (art === "gespeichert" && mitForm) meldung.value = { art: "gespeichert", name: detail.name };
                if (art !== "speichert") mitForm = false;
            },
            { flush: "sync" },
        );
        modus.aktualisiere();
        void karte.zeige(basis.teile.filter((teil) => teil.objekt === areaId));
    }

    const verschieben: FlaecheVerschieben = {
        laufend,
        meldung,
        starte,
        stand: gezeigt,
        zurueck() {
            if (laufend.value?.phase !== "bereit" || sicht?.zurueck() !== true) return;
            gefasst = undefined;
            setze({ haengt: false });
        },
        wieder() {
            if (laufend.value?.phase !== "bereit" || sicht?.wieder() !== true) return;
            gefasst = undefined;
            setze({ haengt: false });
        },
        abbrechen() {
            const jetzt = laufend.value;
            if (jetzt === undefined) return false;
            if (jetzt.phase === "laedt") {
                beende();
                return true;
            }
            if (jetzt.bearbeitung?.zustand.value.art === "speichert") return true;
            // Hängt die Teilfläche noch an der Maus, fällt sie an ihren Platz zurück (das Hängen ist kein Schritt); dann wie immer:
            // Ohne Ungeschriebenes endet der Modus, sonst fragt die Bearbeitung.
            gefasst = undefined;
            if (sicht?.esc() === "ende") beende();
            else setze({ haengt: false });
            return true;
        },
        beende,
        destroy() {
            beende();
            stopSpeichern?.();
        },
    };
    return verschieben;
}

/**
 * Wo in den Gestensätzen von „Verschieben“ der Teil zu den gemeinsamen Ecken steht („gemeinsame Ecken lösen sich“): in allen Tafeln an derselben Stelle,
 * in `landschaftseditor.verschieben.gesten` an fünfter, in `…gestenFinger` an dritter. Eine Art ohne Nachbarn (`FlaechenQuelle.mitNachbarn`, die Sprache)
 * lässt ihn weg (Editor-Orchestrierung 2026-10-31: „nur nennen, was an der Art gilt“, aus den vorhandenen Bausteinen, ohne neuen Text).
 */
export const GEMEINSAME_ECKEN_STELLE = { gesten: 4, gestenFinger: 2 } as const;

/** Ein Gestensatz ohne seinen Teil an `stelle` (die Teile trennt „ · “). */
export function ohneTeil(satz: string, stelle: number): string {
    return satz
        .split(" · ")
        .filter((_, an) => an !== stelle)
        .join(" · ");
}
