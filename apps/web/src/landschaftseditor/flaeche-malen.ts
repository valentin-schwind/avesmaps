import { shallowRef, watch, type ShallowRef } from "vue";
import type { LandscapeBrushMode } from "@avesmaps3d/shared";
import type { Entwurf } from "../fenster/entwurf-kern";
import { FLAECHE } from "../map/geometrie/arten";
import type { Bild } from "../map/geometrie/bild";
import { bereitVon, startStand, type FlaechenQuelle, type FormBearbeitung } from "../map/geometrie/flaechen-quelle";
import type { FormStand } from "../map/geometrie/formentwurf";
import type { Punkt, Teil } from "../map/geometrie/geometrie";
import type { Umriss } from "../map/geometrie/kamera";
import { landschaftFlaechen, type LandschaftFlaechenOptionen } from "./landschaft-flaechen";

/**
 * „Fläche malen“ und „Fläche radieren“ (Werkzeug 6 der Derographie; EDIT-0003 T34 (4) zwei Einträge, T41 (5): Betreiber 2026-10-17
 * „Ja, Alt und Zeichen (Empfohlen)“; Vorlage Probierseite Variante A; Legacy `map-features-ecosystem-brush.js`).
 *
 * - **Pinsel wie Legacy:** ein Kreis am Zeiger, Radius 6 bis 400 Bildpunkte, Vorgabe 40, Strg+Mausrad × 1,18. Ein Strich ist die Spur
 *   des Zeigers vom Drücken bis zum Loslassen, verdünnt auf einen Punkt je 0,55 × Radius (Legacys Stempelabstand).
 * - **Gerechnet in PostGIS** (`POST …/brush`, nichts geschrieben): Malen vereinigt die gepufferte Spur mit der Teilfläche, wie sie im Entwurf
 *   steht, Radieren zieht sie ab; ganz wegradieren geht nicht (Legacy), der Hinweis sagt es.
 * - **Ein Entwurf** (O3): Jeder Strich ist ein Schritt der Bearbeitung der Landschaft (↶ ↷, Strg+Z je Strich, „Verwerfen“); „Fertig“
 *   schreibt `landscape.update`. Ein Strich kann Stücke und Löcher anlegen: Die neuen Teile tragen ihr Stück (`Teil.stueck`), damit „Fertig“
 *   die Ringe richtig zu Polygonen fasst (der gemerkte Aufbau kennt nur den gelesenen Stand).
 * - **Alt halten** gibt das Gegenwerkzeug, solange die Taste gedrückt ist (nie mitten im Strich); das Zeichen am Kreis wechselt mit.
 * - **Auch an einer Teilfläche einer Sprache** (WI-0261 Stufe 2): mit ihrer Quelle beim Start (`map/geometrie/flaechen-quelle.ts`); der Strich rechnet
 *   dort `POST …/sprachen/:id/flaechen/:flaeche/brush`, „Fertig“ schreibt `sprache_flaeche.reshape`. Ohne Quelle gilt die Landschaft.
 */

export type PinselArt = LandscapeBrushMode;

export const PINSEL = { MIN: 6, MAX: 400, VORGABE: 40, SCHRITT: 1.18, WEG: 0.55 } as const;

/** Die Ecken eines Kreises nach seiner Größe in Bildpunkten (Legacy `brushVertexCount`): 10 px → 8, 40 px → 17, ab ~130 px → 32. */
export function pinselEcken(radiusPx: number): number {
    return Math.max(8, Math.min(32, Math.round(8 * Math.pow(Math.max(1, radiusPx) / 10, 0.55))));
}

/** Abschnitte je Viertelkreis für `ST_Buffer` (2 bis 8). */
export const viertelAbschnitte = (radiusPx: number): number =>
    Math.max(2, Math.min(8, Math.round(pinselEcken(radiusPx) / 4)));

/** Der nächste Radius mit Strg+Mausrad, multiplikativ wie Legacy, in den Grenzen. */
export function naechsterRadius(radiusPx: number, groesser: boolean): number {
    const neu = groesser ? radiusPx * PINSEL.SCHRITT : radiusPx / PINSEL.SCHRITT;
    return Math.max(PINSEL.MIN, Math.min(PINSEL.MAX, neu));
}

export const gegenteil = (art: PinselArt): PinselArt => (art === "malen" ? "radieren" : "malen");

/** Die Spur verdünnt: ein Punkt erst, wenn der Zeiger `abstand` weiter ist; der letzte bleibt immer. */
export function verduennt(spur: readonly Punkt[], abstand: number): Punkt[] {
    const raus: Punkt[] = [];
    for (const p of spur) {
        const letzter = raus.at(-1);
        if (letzter === undefined || Math.hypot(p.x - letzter.x, p.y - letzter.y) >= abstand) raus.push(p);
    }
    const ende = spur.at(-1);
    if (ende !== undefined && raus.at(-1) !== ende) raus.push(ende);
    return raus;
}

/**
 * Die Polygone einer Teilfläche aus den Teilen des Entwurfs: nach ihrem Stück, wenn ein Strich sie gelegt hat, sonst nach dem Aufbau des
 * gelesenen Stands (Ringe je Polygon). Ringe ohne Schlusspunkt.
 */
export function polygoneAusTeilen(
    teile: readonly Teil[],
    areaId: string,
    aufbau: readonly number[] | undefined,
): [number, number][][][] {
    const ringe = teile.filter((teil) => teil.objekt === areaId).sort((a, b) => a.nr - b.nr);
    const alsRing = (teil: Teil): [number, number][] => teil.punkte.map((p) => [p.x, p.y]);
    if (ringe.length > 0 && ringe.every((teil) => teil.stueck !== undefined)) {
        const stuecke = new Map<number, [number, number][][]>();
        for (const teil of ringe) stuecke.set(teil.stueck!, [...(stuecke.get(teil.stueck!) ?? []), alsRing(teil)]);
        return [...stuecke.entries()].sort(([a], [b]) => a - b).map(([, polygon]) => polygon);
    }
    const raus: [number, number][][][] = [];
    let nr = 0;
    for (const anzahl of aufbau ?? [ringe.length]) {
        raus.push(ringe.slice(nr, nr + anzahl).map(alsRing));
        nr += anzahl;
    }
    return raus;
}

/** Die Teile einer Teilfläche aus den Polygonen eines Strichs, jedes mit seinem Stück; Name und Revision bleiben die der Vorlage. */
export function teileAusPolygonen(
    polygone: readonly (readonly (readonly [number, number])[])[][],
    vorlage: Teil,
): Teil[] {
    let nr = 0;
    return polygone.flatMap((polygon, stueck) =>
        polygon.map((ring) => ({
            objekt: vorlage.objekt,
            name: vorlage.name,
            nr: nr++,
            art: vorlage.art,
            punkte: ring.map(([x, y]) => ({ x, y })),
            revision: vorlage.revision,
            stueck,
        })),
    );
}

const ring = (punkte: readonly Punkt[]): readonly Punkt[] => (punkte.length > 0 ? [...punkte, punkte[0]!] : punkte);

/** Die Vorschau: die Teilfläche, wie sie im Entwurf steht, als Kante. */
export function malenBild(jetzt: readonly Teil[], areaId: string): Bild {
    return {
        linien: jetzt
            .filter((teil) => teil.objekt === areaId)
            .map((teil) => ({
                coords: FLAECHE.rundung(ring(teil.punkte), teil),
                rolle: "kante" as const,
                objekt: teil.objekt,
                nr: teil.nr,
            })),
        anfasser: [],
        andock: [],
        ringe: [],
    };
}

export interface MalenLauf {
    readonly id: string;
    readonly areaId: string;
    readonly name: string;
    readonly phase: "laedt" | "bereit";
    /** Das Werkzeug aus dem Menü. */
    readonly art: PinselArt;
    /** Alt gehalten: das Gegenwerkzeug. */
    readonly gegen: boolean;
    /** Der Radius in Bildpunkten der Karte. */
    readonly radius: number;
    /** Ein Strich wird gerechnet: Bis die Antwort da ist, beginnt kein neuer, und ↶ ↷ warten. */
    readonly rechnet: boolean;
    readonly bearbeitung: FormBearbeitung | undefined;
    /** Woher die Fläche kommt (die Landschaft oder die Teilfläche einer Sprache). */
    readonly quelle: FlaechenQuelle;
}

/** Das Werkzeug, das jetzt wirkt. */
export const wirksam = (lauf: Pick<MalenLauf, "art" | "gegen">): PinselArt =>
    lauf.gegen ? gegenteil(lauf.art) : lauf.art;

export type MalenMeldung =
    | { readonly art: "ohneFlaeche"; readonly name: string }
    | { readonly art: "ladefehler" }
    | { readonly art: "grenze"; readonly satz: string }
    | { readonly art: "gespeichert"; readonly name: string };

export interface MalenKarte {
    /** Die Vorschau der Teilfläche; ohne Karte `undefined`. */
    an(bild: () => Bild): { aktualisiere(): void; aus(): void } | undefined;
    zeige(teile: readonly Umriss[]): Promise<unknown> | void;
}

/** Die Landschaft als Quelle ohne Angabe beim Start (`landschaft-flaechen.ts`, mit ihrem Strich `POST …/brush`) und die Karte. */
export interface MalenOptionen extends LandschaftFlaechenOptionen {
    readonly strich: NonNullable<LandschaftFlaechenOptionen["strich"]>;
    readonly karte: MalenKarte;
}

export interface FlaecheMalen {
    readonly laufend: Readonly<ShallowRef<MalenLauf | undefined>>;
    readonly meldung: Readonly<ShallowRef<MalenMeldung | undefined>>;
    /** Ohne `quelle` an der Landschaft (aus den Optionen). */
    starte(regionId: string, areaId: string, art: PinselArt, quelle?: FlaechenQuelle): Promise<void>;
    stand(): FormStand | undefined;
    /** Darf jetzt ein Strich beginnen (bereit, nichts in Rechnung, keine Frage, kein Schreiben)? */
    frei(): boolean;
    setzeRadius(px: number): void;
    /** Alt gedrückt oder losgelassen. */
    gegen(an: boolean): void;
    /** Ein fertiger Strich: die Spur in Kartenkoordinaten und die Karteneinheiten je Bildpunkt beim Malen. */
    strich(spur: readonly Punkt[], massstab: number): Promise<void>;
    zurueck(): void;
    wieder(): void;
    abbrechen(): boolean;
    beende(): void;
    destroy(): void;
}

export function createFlaecheMalen(optionen: MalenOptionen): FlaecheMalen {
    const { karte } = optionen;
    const landschaft = landschaftFlaechen(optionen);
    const laufend = shallowRef<MalenLauf | undefined>(undefined);
    const meldung = shallowRef<MalenMeldung | undefined>(undefined);
    let sicht: Entwurf<FormStand> | undefined;
    let modus: { aktualisiere(): void; aus(): void } | undefined;
    let abbruch: AbortController | undefined;
    let stopSpeichern: (() => void) | undefined;
    /** Ringe je Polygon der Teilfläche, wie sie gelesen wurde. */
    let aufbau: readonly number[] | undefined;
    /** Der Radius überlebt das Ende des Modus (Legacy: derselbe Pinsel beim nächsten Mal). */
    let radius: number = PINSEL.VORGABE;
    let lauf = 0;

    const bild = (): Bild => {
        const jetzt = sicht?.jetzt();
        const l = laufend.value;
        return jetzt === undefined || l === undefined
            ? { linien: [], anfasser: [], andock: [], ringe: [] }
            : malenBild(jetzt.teile, l.areaId);
    };

    function setze(neu: Partial<MalenLauf>): void {
        if (laufend.value !== undefined) laufend.value = { ...laufend.value, ...neu };
        modus?.aktualisiere();
    }

    function frei(): boolean {
        const jetzt = laufend.value;
        const bearbeitung = jetzt?.bearbeitung;
        if (jetzt?.phase !== "bereit" || jetzt.rechnet || bearbeitung === undefined) return false;
        return bearbeitung.zustand.value.art !== "speichert" && !bearbeitung.lage.value.frage;
    }

    function beende(): void {
        lauf += 1;
        abbruch?.abort();
        abbruch = undefined;
        modus?.aus();
        modus = undefined;
        const alt = sicht;
        sicht = undefined;
        alt?.leere();
        aufbau = undefined;
        laufend.value = undefined;
    }

    async function starte(
        regionId: string,
        areaId: string,
        art: PinselArt,
        quelle: FlaechenQuelle = landschaft,
    ): Promise<void> {
        const bearbeitung = quelle.bearbeitung(regionId);
        if (bearbeitung === undefined) return;
        beende();
        const meiner = lauf;
        const steuer = new AbortController();
        abbruch = steuer;
        meldung.value = undefined;
        laufend.value = {
            id: regionId,
            areaId,
            name: "",
            phase: "laedt",
            art,
            gegen: false,
            radius,
            rechnet: false,
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
        const flaeche = detail.flaechen.find((f) => f.id === areaId);
        if (flaeche === undefined) {
            beende();
            meldung.value = { art: "ohneFlaeche", name: detail.name };
            return;
        }
        aufbau = flaeche.polygons.map((polygon) => polygon.length);
        const g0 = startStand(detail);
        sicht = bearbeitung.formEntwurf({
            zurueck: () => malen.zurueck(),
            wieder: () => malen.wieder(),
            verwerfen: () => {
                sicht?.verwerfen();
                modus?.aktualisiere();
            },
            abbrechen: () => malen.abbrechen(),
            beende,
        });
        sicht.beginne(g0);
        modus = karte.an(bild);
        if (modus === undefined) {
            beende();
            return;
        }
        laufend.value = { ...laufend.value, name: detail.name, phase: "bereit" };
        stopSpeichern?.();
        let mitForm = false;
        stopSpeichern = watch(
            () => bearbeitung.zustand.value.art,
            (zustand) => {
                if (zustand === "speichert") mitForm = laufend.value !== undefined;
                else if (zustand === "gespeichert" && mitForm)
                    meldung.value = { art: "gespeichert", name: detail.name };
                if (zustand !== "speichert") mitForm = false;
            },
            { flush: "sync" },
        );
        modus.aktualisiere();
        const start = sicht.jetzt() ?? g0;
        void karte.zeige(start.teile.filter((teil) => teil.objekt === areaId));
    }

    async function strich(spur: readonly Punkt[], massstab: number): Promise<void> {
        const jetzt = laufend.value;
        const e = sicht?.jetzt();
        const rechne = jetzt?.quelle.strich;
        if (jetzt === undefined || e === undefined || rechne === undefined || spur.length === 0 || !frei()) return;
        const vorlage = e.teile.find((teil) => teil.objekt === jetzt.areaId);
        if (vorlage === undefined) return;
        const radiusKarte = jetzt.radius * massstab;
        const linie = verduennt(spur, radiusKarte * PINSEL.WEG);
        const meiner = lauf;
        setze({ rechnet: true });
        const antwort = await rechne(jetzt.id, jetzt.areaId, {
            mode: wirksam(jetzt),
            polygons: polygoneAusTeilen(e.teile, jetzt.areaId, aufbau),
            line: linie.map((p) => [p.x, p.y]),
            radius: radiusKarte,
            quadSegs: viertelAbschnitte(jetzt.radius),
        });
        if (meiner !== lauf || laufend.value === undefined) return;
        if (!antwort.ok) {
            meldung.value = { art: "grenze", satz: antwort.satz };
            setze({ rechnet: false });
            return;
        }
        const neu = teileAusPolygonen(antwort.polygons, vorlage);
        sicht?.schritt({ ...e, teile: [...e.teile.filter((teil) => teil.objekt !== jetzt.areaId), ...neu] });
        setze({ rechnet: false });
    }

    const malen: FlaecheMalen = {
        laufend,
        meldung,
        starte,
        stand: () => sicht?.jetzt(),
        frei,
        setzeRadius(px) {
            radius = Math.max(PINSEL.MIN, Math.min(PINSEL.MAX, px));
            setze({ radius });
        },
        gegen(an) {
            if (laufend.value === undefined || laufend.value.gegen === an) return;
            setze({ gegen: an });
        },
        strich,
        zurueck() {
            if (laufend.value?.phase !== "bereit" || laufend.value.rechnet || sicht?.zurueck() !== true) return;
            modus?.aktualisiere();
        },
        wieder() {
            if (laufend.value?.phase !== "bereit" || laufend.value.rechnet || sicht?.wieder() !== true) return;
            modus?.aktualisiere();
        },
        abbrechen() {
            const jetzt = laufend.value;
            if (jetzt === undefined) return false;
            if (jetzt.phase === "laedt") {
                beende();
                return true;
            }
            if (jetzt.rechnet || jetzt.bearbeitung?.zustand.value.art === "speichert") return true;
            if (sicht?.esc() === "ende") beende();
            else modus?.aktualisiere();
            return true;
        },
        beende,
        destroy() {
            beende();
            stopSpeichern?.();
        },
    };
    return malen;
}
