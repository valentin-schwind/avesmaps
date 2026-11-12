import { shallowRef, watch, type ShallowRef, type WatchStopHandle } from "vue";
import type { Entwurf } from "../fenster/entwurf-kern";
import { FLAECHE } from "../map/geometrie/arten";
import type { Bild } from "../map/geometrie/bild";
import { bereitVon, startStand, type FlaechenQuelle, type FormBearbeitung } from "../map/geometrie/flaechen-quelle";
import type { FormStand } from "../map/geometrie/formentwurf";
import type { Punkt, Teil } from "../map/geometrie/geometrie";
import type { Umriss } from "../map/geometrie/kamera";
import type { GeometrieModus } from "../map/geometrie/modus";
import { deckungsgleich, schluessel } from "../map/geometrie/rechnung";
import { vereinfachteIndizes } from "../map/geometrie/vereinfachen";
import { VEREINFACHEN_HOECHSTENS, VEREINFACHEN_VORGABE } from "../wegeditor/wegkurve";
import { landschaftFlaechen, type LandschaftFlaechenOptionen } from "./landschaft-flaechen";

/**
 * „Fläche vereinfachen“ an einer Landschaft (WI-0233; Thomas 4.1, Werkzeug 4 im Plan der Derographie; EDIT-0003 G4, T27 (4), (7), T44):
 * dieselbe Rechnung und dieselbe Bedienung wie „Wegkurve vereinfachen“ (`wegeditor/wegkurve.ts`, Regel 7), an den Ringen der Teilflächen.
 *
 * - **Ein Entwurf** (O3): Der Modus hängt sich als Formbesitzer an die EINE Bearbeitung der Landschaft (`bearbeitung.formEntwurf`), wie
 *   „Ecken bearbeiten“. Jedes Loslassen des Reglers ist ein Schritt (↶ ↷), „Fertig“ der Bearbeitung schreibt die Form mit den Feldern als
 *   `landscape.update`. Einen eigenen Schreibweg hat er nicht. Liegt schon eine Form im Entwurf (nach „Ecken bearbeiten“), wird sie vereinfacht.
 * - **Stärke** wie bei den Wegen: 0 bis 20, Vorgabe 4, gemessen in Bildpunkten der Karte nach der Landung der Kamera (`massstab`).
 *   Legacy stellte die Zahl der Punkte ein (`map-features-ecosystem-simplify.js`); die Wege haben die Stärke, und sie gilt hier.
 * - 🔴 **Gemeinsame Ecken bleiben fest** (Befund an die Derographie 2026-10-19, „Keine Einwände“): Ecken, die eine Teilfläche mit einer
 *   Nachbarin derselben Ebene teilt, und Ecken auf einem Stützpunkt eines Flusses. Vereinfacht wird nur dazwischen. So bleibt die gemeinsame
 *   Grenze auf beiden Seiten gleich, es entsteht keine Lücke, und keine Nachbarin wird geschrieben oder gesperrt. Legacy vereinfachte jeden
 *   Ring für sich und riss so Lücken. Kanten anderer Ebenen sind nicht fest: Ebenen liegen übereinander.
 * - 🔴 **Kein Umriss, der sich kreuzt** (`kreuztSich`): Kreuzt sich ein Ring einer Teilfläche mit sich oder mit einem anderen ihrer Ringe,
 *   wird die Stellung kein Schritt; der Regler geht zurück, und der Hinweis sagt es. Der Server prüft die Form inzwischen auch (`ST_IsValid`).
 * - **Vorschau** mit der gemeinsamen Schicht des Geometrie-Moduls: der alte Umriss gestrichelt, der neue als Kante, die bleibenden Ecken als
 *   Punkte (feste groß), die wegfallenden als leere Ringe. Beim Ziehen zeigt die Karte sofort, was wegfiele; Schritt erst beim Loslassen.
 * - **Auch an einer Teilfläche einer Sprache** (WI-0261 Stufe 2): mit ihrer Quelle beim Start (`map/geometrie/flaechen-quelle.ts`); ohne Nachbarn
 *   und Flüsse ist dort keine Ecke fest, „Fertig“ schreibt `sprache_flaeche.reshape`. Ohne Quelle gilt die Landschaft (`landschaft-flaechen.ts`).
 */

export { VEREINFACHEN_HOECHSTENS, VEREINFACHEN_VORGABE };

/** Was der Modus von der Karte braucht. */
export interface VereinfachenKarte {
    /** Die Vorschau ohne Anfasser zum Ziehen; ohne Karte `undefined`. */
    vorschau(bild: () => Bild): GeometrieModus | undefined;
    /** Die Fläche in die freie Fläche holen, wenn sie nicht frei sichtbar ist (Hausregel „Kamera fliegt immer“). */
    zeige(teile: readonly Umriss[]): Promise<unknown> | void;
    /** Karteneinheiten je Bildpunkt um diese Punkte, wie die Karte jetzt steht. */
    massstab(punkte: readonly Punkt[]): number;
}

export interface VereinfachenLauf {
    /** Die Landschaft (an einer Sprache die Kennung ihrer Teilfläche, `laufKennung` in `spracheditor/sprachflaeche-form.ts`). */
    readonly id: string;
    /** Ihr Name; leer, solange sie lädt. */
    readonly name: string;
    readonly phase: "laedt" | "bereit";
    readonly staerke: number;
    /** Stützpunkte beim Start und jetzt, über alle Ringe. */
    readonly vorher: number;
    readonly nachher: number;
    /** Wie viele davon fest sind. */
    readonly fest: number;
    /**
     * Jede Ecke ist fest (mit Nachbarflächen oder Flüssen verbunden): Der Regler kann nichts tun, er ist gesperrt, und ein Satz sagt warum
     * (Orchestrierung 2026-10-19 nach der Probe der Hauptorchestrierung an Vorderkosch: „richtig, aber rätselhaft“).
     */
    readonly allesFest: boolean;
    /** Die Bearbeitung der Landschaft: Ihr gehören Schritte, Frage und „Fertig“. */
    readonly bearbeitung: FormBearbeitung | undefined;
    /** Woher die Fläche kommt (die Landschaft oder die Teilfläche einer Sprache). */
    readonly quelle: FlaechenQuelle;
}

export type VereinfachenMeldung =
    | { readonly art: "ohneFlaeche"; readonly name: string }
    | { readonly art: "ladefehler" }
    /** Bei dieser Stärke kreuzte sich der Umriss: Es blieb bei `gilt`. */
    | { readonly art: "kreuzt"; readonly staerke: number; readonly gilt: number }
    /** „Fertig“ hat geschrieben. */
    | { readonly art: "gespeichert"; readonly name: string; readonly vorher: number; readonly nachher: number };

export interface FlaecheVereinfachen {
    readonly laufend: Readonly<ShallowRef<VereinfachenLauf | undefined>>;
    readonly meldung: Readonly<ShallowRef<VereinfachenMeldung | undefined>>;
    /** Ohne `quelle` an der Landschaft (aus den Optionen). */
    starte(regionId: string, quelle?: FlaechenQuelle): Promise<void>;
    /** Der Regler: beim Ziehen (`endgueltig` falsch) nur die Vorschau, beim Loslassen ein Schritt im Entwurf. */
    staerke(wert: number, endgueltig: boolean): void;
    zurueck(): void;
    wieder(): void;
    /** Esc: fragt bei Ungeschriebenem, sonst endet der Modus. Gibt zurück, ob etwas lief. */
    abbrechen(): boolean;
    beende(): void;
    destroy(): void;
}

/** Die Landschaft als Quelle ohne Angabe beim Start (`landschaft-flaechen.ts`) und die Karte. */
export interface VereinfachenOptionen extends Omit<LandschaftFlaechenOptionen, "strich"> {
    readonly karte: VereinfachenKarte;
}

/** Der Trenner der Teile eines Gestensatzes und der Zahlen der Leiste („Regler: Stärke · … · Esc fragt“). */
const TEIL = " · ";

/**
 * Ein Satz der Leiste ohne seinen Teil zu den festen Ecken, für eine Art ohne Nachbarn und Flüsse (`FlaechenQuelle.mitNachbarn`; Editor-Orchestrierung
 * 2026-10-31: „Der Gestensatz nennt nur, was an der Art gilt“, aus den vorhandenen Bausteinen, ohne neuen Text). In allen Tafeln steht dieser Teil an
 * zweiter Stelle: in `landschaftseditor.vereinfachen.gesten` „groß: fest (…)“, in `…gestenFinger` „Ecken … bleiben fest“, in `…zahlen` „{fest} fest“.
 * Der Test `sprachflaeche-werkzeuge.test.ts` hält das für jede Tafel fest.
 */
export function ohneFesteEcken(satz: string): string {
    return satz
        .split(TEIL)
        .filter((_, stelle) => stelle !== 1)
        .join(TEIL);
}

/** Die Ecken jedes Rings, die bleiben: geteilt mit einer Nachbarin oder auf einem Stützpunkt eines Flusses. */
export function festeEcken(teile: readonly Teil[], nachbarn: readonly Teil[], fluesse: readonly Punkt[]): number[][] {
    const halt = new Set([...nachbarn.flatMap((teil) => teil.punkte), ...fluesse].map(schluessel));
    return teile.map((teil) => teil.punkte.flatMap((p, i) => (halt.has(schluessel(p)) ? [i] : [])));
}

/** Die Ringe vereinfacht, je Ring mit seinen festen Ecken; jeder Ring behält mindestens drei. */
export function vereinfachteTeile(
    teile: readonly Teil[],
    fest: readonly (readonly number[])[],
    toleranz: number,
): Teil[] {
    return teile.map((teil, k) => ({
        ...teil,
        punkte: vereinfachteIndizes(teil.punkte, toleranz, { geschlossen: true, fest: fest[k] ?? [] }).map(
            (i) => teil.punkte[i]!,
        ),
    }));
}

const kreuz = (a: Punkt, b: Punkt, c: Punkt): number => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);

/** Schneiden sich die Strecken a–b und c–d im Inneren (nicht nur an einem gemeinsamen Ende)? */
function schneiden(a: Punkt, b: Punkt, c: Punkt, d: Punkt): boolean {
    const d1 = kreuz(c, d, a);
    const d2 = kreuz(c, d, b);
    const d3 = kreuz(a, b, c);
    const d4 = kreuz(a, b, d);
    return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

/**
 * Kreuzt sich ein Ring einer Teilfläche mit sich oder mit einem anderen Ring derselben Teilfläche (ein Loch über den Rand)? Strecken, die
 * sich nur an einem Ende berühren, zählen nicht.
 */
export function kreuztSich(teile: readonly Teil[]): boolean {
    const nachFlaeche = new Map<string, Teil[]>();
    for (const teil of teile) nachFlaeche.set(teil.objekt, [...(nachFlaeche.get(teil.objekt) ?? []), teil]);
    for (const ringe of nachFlaeche.values()) {
        const strecken = ringe.flatMap((ring) =>
            ring.punkte.map((p, i) => [p, ring.punkte[(i + 1) % ring.punkte.length]!] as const),
        );
        for (let i = 0; i < strecken.length; i++)
            for (let j = i + 1; j < strecken.length; j++) {
                const [a, b] = strecken[i]!;
                const [c, d] = strecken[j]!;
                if (schneiden(a, b, c, d)) return true;
            }
    }
    return false;
}

const zahl = (teile: readonly Teil[]): number => teile.reduce((summe, teil) => summe + teil.punkte.length, 0);

/** Dieselben Ringe mit denselben Ecken (auf fünf Stellen)? */
function gleicheRinge(a: readonly Teil[], b: readonly Teil[]): boolean {
    return (
        a.length === b.length &&
        a.every((teil, k) => {
            const anderer = b[k]!.punkte;
            return (
                teil.punkte.length === anderer.length &&
                teil.punkte.every((p, i) => schluessel(p) === schluessel(anderer[i]!))
            );
        })
    );
}
const ring = (punkte: readonly Punkt[]): readonly Punkt[] => (punkte.length > 0 ? [...punkte, punkte[0]!] : punkte);

/** Die Vorschau: der alte Umriss gestrichelt, der neue als Kante, die bleibenden Ecken (feste groß), die wegfallenden als leere Ringe. */
export function vereinfachenBild(
    start: readonly Teil[],
    jetzt: readonly Teil[],
    fest: readonly (readonly number[])[],
): Bild {
    const feste = start.flatMap((teil, k) => (fest[k] ?? []).map((i) => teil.punkte[i]!));
    const bleiben = new Set(jetzt.flatMap((teil) => teil.punkte).map(schluessel));
    return {
        linien: [
            ...start.map((teil) => ({
                coords: FLAECHE.rundung(ring(teil.punkte), teil),
                rolle: "alt" as const,
                objekt: teil.objekt,
                nr: teil.nr,
            })),
            ...jetzt.map((teil) => ({
                coords: FLAECHE.rundung(ring(teil.punkte), teil),
                rolle: "kante" as const,
                objekt: teil.objekt,
                nr: teil.nr,
            })),
        ],
        anfasser: jetzt.flatMap((teil) =>
            teil.punkte.map((at, index) => ({
                at,
                ende: feste.some((f) => deckungsgleich(f, at)),
                stelle: { objekt: teil.objekt, nr: teil.nr, index },
            })),
        ),
        andock: start.flatMap((teil) => teil.punkte).filter((p) => !bleiben.has(schluessel(p))),
        ringe: [],
    };
}

export function createFlaecheVereinfachen(optionen: VereinfachenOptionen): FlaecheVereinfachen {
    const { karte } = optionen;
    const landschaft = landschaftFlaechen(optionen);
    const laufend = shallowRef<VereinfachenLauf | undefined>(undefined);
    const meldung = shallowRef<VereinfachenMeldung | undefined>(undefined);
    /** Die Sicht der Bearbeitung auf die Form (O3). */
    let sicht: Entwurf<FormStand> | undefined;
    let modus: GeometrieModus | undefined;
    let abbruch: AbortController | undefined;
    let stopSpeichern: WatchStopHandle | undefined;
    /** Die Form, wie sie beim Start lag, und ihre festen Ecken je Ring. */
    let basis: FormStand | undefined;
    let fest: number[][] = [];
    /** Beim Ziehen des Reglers: was die Karte zeigt, ohne Schritt im Entwurf. */
    let vorschau: { stand: FormStand; staerke: number } | undefined;
    /** Welche Stärke einen Stand ergab (↶ ↷ holen den Stand zurück, der Regler folgt ihm). */
    let staerkeVon = new WeakMap<FormStand, number>();
    let lauf = 0;

    const gezeigt = (): FormStand | undefined => vorschau?.stand ?? sicht?.jetzt();
    const staerkeJetzt = (): number => {
        if (vorschau !== undefined) return vorschau.staerke;
        const jetzt = sicht?.jetzt();
        return jetzt === undefined ? 0 : (staerkeVon.get(jetzt) ?? 0);
    };

    function bild(): Bild {
        const jetzt = gezeigt();
        if (basis === undefined || jetzt === undefined) return { linien: [], anfasser: [], andock: [], ringe: [] };
        return vereinfachenBild(basis.teile, jetzt.teile, fest);
    }

    function zeige(): void {
        const jetzt = laufend.value;
        const e = gezeigt();
        if (jetzt !== undefined && basis !== undefined && e !== undefined)
            laufend.value = {
                ...jetzt,
                staerke: staerkeJetzt(),
                vorher: zahl(basis.teile),
                nachher: zahl(e.teile),
                fest: fest.reduce((summe, ecken) => summe + ecken.length, 0),
                allesFest: fest.reduce((summe, ecken) => summe + ecken.length, 0) === zahl(basis.teile),
            };
        modus?.aktualisiere();
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
        vorschau = undefined;
        fest = [];
        staerkeVon = new WeakMap();
        laufend.value = undefined;
    }

    function staerke(wert: number, endgueltig: boolean): void {
        const jetzt = laufend.value;
        const e = sicht?.jetzt();
        const bearbeitung = jetzt?.bearbeitung;
        if (jetzt?.phase !== "bereit" || bearbeitung === undefined || e === undefined || basis === undefined) return;
        if (bearbeitung.zustand.value.art === "speichert" || bearbeitung.lage.value.frage) return;
        const neu = Math.max(0, Math.min(VEREINFACHEN_HOECHSTENS, Math.round(wert)));
        const toleranz = neu * karte.massstab(basis.teile.flatMap((teil) => teil.punkte));
        const stand: FormStand = { teile: vereinfachteTeile(basis.teile, fest, toleranz), nachbarn: e.nachbarn };
        if (!endgueltig) {
            vorschau = { stand, staerke: neu };
            zeige();
            return;
        }
        vorschau = undefined;
        const bisher = staerkeVon.get(e) ?? 0;
        if (neu !== bisher) {
            // Fällt bei dieser Stärke nichts weg, ist es kein Schritt: Ein Entwurf ohne Änderung zeigt „0 ungespeichert“, und
            // „Trotzdem schließen?“ fragt später nicht umsonst (Probe an Vorderkosch: „204 → 204 Stützpunkte“, aber „1 ungespeichert“).
            if (gleicheRinge(stand.teile, e.teile)) staerkeVon.set(e, neu);
            else if (kreuztSich(stand.teile)) meldung.value = { art: "kreuzt", staerke: neu, gilt: bisher };
            else {
                staerkeVon.set(stand, neu);
                sicht?.schritt(stand);
                meldung.value = undefined;
            }
        }
        zeige();
    }

    async function starte(regionId: string, quelle: FlaechenQuelle = landschaft): Promise<void> {
        const bearbeitung = quelle.bearbeitung(regionId);
        if (bearbeitung === undefined) return;
        beende();
        const meiner = lauf;
        const steuer = new AbortController();
        abbruch = steuer;
        meldung.value = undefined;
        laufend.value = {
            id: regionId,
            name: "",
            phase: "laedt",
            staerke: 0,
            vorher: 0,
            nachher: 0,
            fest: 0,
            allesFest: false,
            bearbeitung,
            quelle,
        };
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
        if (detail.flaechen.length === 0) {
            beende();
            meldung.value = { art: "ohneFlaeche", name: detail.name };
            return;
        }
        const g0 = startStand(detail);
        sicht = bearbeitung.formEntwurf({
            zurueck: () => vereinfachen.zurueck(),
            wieder: () => vereinfachen.wieder(),
            verwerfen: () => {
                sicht?.verwerfen();
                zeige();
            },
            abbrechen: () => vereinfachen.abbrechen(),
            beende,
        });
        // Die Form hängt an; liegt schon eine im Entwurf (nach „Ecken bearbeiten“), gilt sie. Die Sperre nimmt die Bearbeitung.
        sicht.beginne(g0);
        basis = sicht.jetzt() ?? g0;
        fest = festeEcken(basis.teile, basis.nachbarn, detail.fluesse);
        staerkeVon.set(basis, 0);
        modus = karte.vorschau(bild);
        if (modus === undefined) {
            beende();
            return;
        }
        laufend.value = { ...laufend.value, name: detail.name, phase: "bereit" };
        // Hat „Fertig“ mit der Form geschrieben, sagt der Hinweis, wie viele Stützpunkte es wurden.
        let zahlen: { vorher: number; nachher: number } | undefined;
        // Der Hinweis überlebt das Ende des Modus: „Fertig“ beendet ihn, bevor die Bearbeitung „gespeichert“ meldet (wie „Ecken bearbeiten“).
        stopSpeichern?.();
        stopSpeichern = watch(
            () => bearbeitung.zustand.value.art,
            (art) => {
                const jetzt = laufend.value;
                if (art === "speichert" && jetzt !== undefined)
                    zahlen = { vorher: jetzt.vorher, nachher: jetzt.nachher };
                else if (art === "gespeichert" && zahlen !== undefined)
                    meldung.value = { art: "gespeichert", name: detail.name, ...zahlen };
                if (art !== "speichert") zahlen = undefined;
            },
            { flush: "sync" },
        );
        zeige();
        const flug = karte.zeige(basis.teile);
        // Die Vorgabe erst nach der Landung: Die Stärke misst in Bildpunkten der Karte, wie sie dann steht.
        await flug;
        if (meiner !== lauf) return;
        staerke(VEREINFACHEN_VORGABE, true);
    }

    const vereinfachen: FlaecheVereinfachen = {
        laufend,
        meldung,
        starte,
        staerke,
        zurueck() {
            if (laufend.value?.phase !== "bereit" || sicht?.zurueck() !== true) return;
            vorschau = undefined;
            zeige();
        },
        wieder() {
            if (laufend.value?.phase !== "bereit" || sicht?.wieder() !== true) return;
            vorschau = undefined;
            zeige();
        },
        abbrechen() {
            const jetzt = laufend.value;
            if (jetzt === undefined) return false;
            if (jetzt.phase === "laedt") {
                beende();
                return true;
            }
            // Während geschrieben wird, hält Esc nichts an: Die Antwort kommt gleich.
            if (jetzt.bearbeitung?.zustand.value.art === "speichert") return true;
            vorschau = undefined;
            if (sicht?.esc() === "ende") beende();
            else zeige();
            return true;
        },
        beende,
        destroy() {
            beende();
            stopSpeichern?.();
        },
    };
    return vereinfachen;
}
