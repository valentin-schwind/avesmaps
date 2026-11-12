import { amOrt as amOrtGemeinsam, aufeinander, punktSchluessel } from "@avesmaps3d/shared";
import type { Eingefuegt, Pixel, Punkt, Stelle, Teil, Treffer, Ziel, Zielart } from "./geometrie";

/**
 * Die reine Rechnung des Geometrie-Moduls (WI-0177): ohne Karte und ohne Vue, damit Vitest sie prüft. `schirm` rechnet einen
 * Kartenpunkt in Bildpunkte um (an der Karte `map.project`); alles, was „nah“ heißt, wird am Schirm gemessen (Betreiber 2026-10-15:
 * „achtung screenspace-dimensionen nehmen“).
 */

/** Fünf Nachkommastellen: dieselbe Genauigkeit wie der Server und die Wegfindung (Betreiber 2026-10-10; `weg-regeln.ts` im gemeinsamen Code). */
export const schluessel = (p: Punkt): string => punktSchluessel(p.x, p.y);

/** Liegen zwei Punkte auf fünf Stellen aufeinander? Die Regel des gemeinsamen Codes (`aufeinander`), die auch der Server prüft. */
export const deckungsgleich: (a: Punkt, b: Punkt) => boolean = aufeinander;

const abstand = (a: Pixel, b: Pixel): number => Math.hypot(a.x - b.x, a.y - b.y);

/** Der Fußpunkt von `p` auf der Strecke `a` bis `b`, auf die Strecke beschränkt; `t` ist der Anteil von `a` aus. */
export function fussAufStrecke(p: Pixel, a: Pixel, b: Pixel): { t: number; x: number; y: number } {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const laenge = dx * dx + dy * dy;
    const t = laenge > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / laenge)) : 0;
    return { t, x: a.x + t * dx, y: a.y + t * dy };
}

/** Eine Ecke oder ein Ort geht vor einer Kante (Legacys Gebietseditor: „vertex wins“); bei gleichem Rang die Nähe. */
const RANG: Readonly<Record<Zielart, number>> = { ort: 0, label: 0, ecke: 0, gipfel: 0, kante: 1 };

/**
 * Woran ein Punkt unter dem Zeiger einrastet: das beste Ziel der erlaubten Arten innerhalb `radius` Bildpunkten, oder keins.
 * `zulassen` sortiert einzelne Ziele aus (etwa das am anderen Ende desselben Wegs).
 */
export function einrasten(
    zeiger: Pixel,
    ziele: readonly Ziel[],
    erlaubt: readonly Zielart[],
    radius: number,
    schirm: (p: Punkt) => Pixel,
    zulassen: (ziel: Ziel) => boolean = () => true,
): Treffer | undefined {
    if (erlaubt.length === 0) return undefined;
    let bester: Treffer | undefined;
    let besterRang = Infinity;
    for (const ziel of ziele) {
        if (!erlaubt.includes(ziel.art) || !zulassen(ziel)) continue;
        let at: Punkt = ziel.at;
        let weite: number;
        if (ziel.art === "kante" && ziel.bis !== undefined) {
            const fuss = fussAufStrecke(zeiger, schirm(ziel.at), schirm(ziel.bis));
            weite = abstand(fuss, zeiger);
            at = { x: ziel.at.x + fuss.t * (ziel.bis.x - ziel.at.x), y: ziel.at.y + fuss.t * (ziel.bis.y - ziel.at.y) };
        } else {
            weite = abstand(schirm(ziel.at), zeiger);
        }
        if (weite > radius) continue;
        const rang = RANG[ziel.art];
        if (bester === undefined || rang < besterRang || (rang === besterRang && weite < bester.abstand)) {
            bester = { ziel, at, abstand: weite };
            besterRang = rang;
        }
    }
    return bester;
}

/** Die Ziele, die um den Zeiger als Andockpunkte markiert werden: erlaubt und höchstens `umkreis` Bildpunkte entfernt. */
export function andockziele(
    zeiger: Pixel,
    ziele: readonly Ziel[],
    erlaubt: readonly Zielart[],
    umkreis: number,
    schirm: (p: Punkt) => Pixel,
    zulassen: (ziel: Ziel) => boolean = () => true,
): Ziel[] {
    if (erlaubt.length === 0) return [];
    return ziele.filter(
        (ziel) =>
            erlaubt.includes(ziel.art) &&
            ziel.art !== "kante" &&
            zulassen(ziel) &&
            abstand(schirm(ziel.at), zeiger) <= umkreis,
    );
}

/**
 * Wo ein Doppelklick auf die Kante einen Punkt einfügt: hinter dem nächsten geraden Abschnitt des Kontrollpolygons, gemessen in
 * Bildpunkten (Legacy `findNearestSegmentInsertIndex`). Die Rückgabe ist die Position des neuen Punkts (1 bis Länge; bei einem Ring
 * auch hinter dem letzten, also auf der schließenden Strecke).
 */
export function einfuegePosition(
    punkte: readonly Punkt[],
    zeiger: Pixel,
    schirm: (p: Punkt) => Pixel,
    geschlossen: boolean,
): number {
    const n = punkte.length;
    const strecken = geschlossen ? n : n - 1;
    let beste = 1;
    let besterAbstand = Infinity;
    for (let i = 0; i < strecken; i += 1) {
        const a = schirm(punkte[i]!);
        const b = schirm(punkte[(i + 1) % n]!);
        const weite = abstand(fussAufStrecke(zeiger, a, b), zeiger);
        if (weite < besterAbstand) {
            besterAbstand = weite;
            beste = i + 1;
        }
    }
    return beste;
}

export const mitPunkt = (punkte: readonly Punkt[], position: number, at: Punkt): Punkt[] => [
    ...punkte.slice(0, position),
    at,
    ...punkte.slice(position),
];

export const ohnePunkt = (punkte: readonly Punkt[], index: number): Punkt[] => punkte.filter((_, i) => i !== index);

/**
 * Strg + Klick auf eine Kante setzt mehrere Punkte auf einmal (Betreiber 2026-10-20 über die Editor-Orchestrierung: „wir hatten in
 * legacy eine coole funktion wo man mit strg auf eine kante 4 weitere punkte hinzufügen konnte“). Legacy
 * `map-features-region-vertex-detach-edit.js` (zur Laufzeit gültig) und `map-features-ecosystem-edit.js`: vier Punkte, gleichmäßig auf
 * der geraden Strecke zwischen zwei Ecken, nicht am Zeiger („a straight segment needs to become a curve“).
 */
export const TEILUNG_ANZAHL = 4;
/** So nah muss der Zeiger an der Strecke sein (Legacy `REGION_EDIT_EDGE_HIT_TOLERANCE_PX`, `ECOSYSTEM_EDIT_SUBDIVIDE_HIT_PIXELS`). */
export const TEILUNG_KANTE_PX = 22;
/**
 * Liegt eine Ecke so nah am Zeiger, gehört Strg ihr (trennen beim Ziehen), und die Kante zeigt nichts (Legacy
 * `REGION_EDIT_VERTEX_DETACH_HIT_TOLERANCE_PX`: die Ecke geht vor der Kante).
 */
export const TEILUNG_ECKE_PX = 14;

/** Die Strecke unter dem Zeiger, auf die Strg + Klick die Punkte setzt, und die Punkte selbst. */
export interface Teilung {
    readonly objekt: string;
    readonly nr: number;
    /** Wo die Punkte in den Teil kommen: hinter `position - 1`. */
    readonly position: number;
    readonly von: Punkt;
    readonly bis: Punkt;
    readonly punkte: readonly Punkt[];
}

/** `anzahl` Punkte gleichmäßig zwischen `a` und `b`, ohne die Enden (1/5 … 4/5 bei vier). */
export function teilungsPunkte(a: Punkt, b: Punkt, anzahl = TEILUNG_ANZAHL): Punkt[] {
    return Array.from({ length: anzahl }, (_, i) => {
        const t = (i + 1) / (anzahl + 1);
        return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    });
}

/**
 * Die Strecke eines Teils unter dem Zeiger (Bildpunkte der Karte) für Strg + Klick: die nächste im Umkreis von `TEILUNG_KANTE_PX`,
 * keine, wenn eine Ecke näher als `TEILUNG_ECKE_PX` liegt. Gemessen an der geraden Strecke zwischen zwei gespeicherten Ecken, nicht an
 * der gerundeten Vorschau: Dort landen die Punkte.
 */
export function teilungUnter(
    teile: readonly Teil[],
    zeiger: Pixel,
    schirm: (p: Punkt) => Pixel,
    anzahl = TEILUNG_ANZAHL,
): Teilung | undefined {
    let beste: { teil: Teil; i: number; weite: number } | undefined;
    for (const teil of teile) {
        if (teil.art === "punkt" || teil.punkte.length < 2) continue;
        const bild = teil.punkte.map(schirm);
        if (bild.some((p) => abstand(p, zeiger) <= TEILUNG_ECKE_PX)) return undefined;
        const strecken = teil.art === "ring" ? bild.length : bild.length - 1;
        for (let i = 0; i < strecken; i += 1) {
            const weite = abstand(fussAufStrecke(zeiger, bild[i]!, bild[(i + 1) % bild.length]!), zeiger);
            if (weite <= TEILUNG_KANTE_PX && (beste === undefined || weite < beste.weite)) beste = { teil, i, weite };
        }
    }
    if (beste === undefined) return undefined;
    const { teil, i } = beste;
    const von = teil.punkte[i]!;
    const bis = teil.punkte[(i + 1) % teil.punkte.length]!;
    return { objekt: teil.objekt, nr: teil.nr, position: i + 1, von, bis, punkte: teilungsPunkte(von, bis, anzahl) };
}

/** Wie nah neben der Kante ein Doppelklick noch zur Fläche zählt (Legacy `regionEditDoubleClickSetsCorner`, dieselbe Toleranz). */
export const SAUM_PX = TEILUNG_KANTE_PX;

/** Liegt `p` in den Ringen (gerade-ungerade: Löcher zählen nicht dazu, Teilflächen schon)? */
function innerhalb(p: Pixel, ringe: readonly (readonly Pixel[])[]): boolean {
    let drin = false;
    for (const ring of ringe)
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
            const a = ring[i]!;
            const b = ring[j]!;
            if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) drin = !drin;
        }
    return drin;
}

/**
 * Wohin ein Doppelklick in eine bearbeitete Fläche den neuen Punkt setzt (EDIT-0003 T59, OPS-000043; der Betreiber wählte 2026-10-20
 * „A Wie Legacy (Empfehlung)“): in die nächste Kante über ALLE Ringe des Objekts, Löcher eingeschlossen, wenn der Zeiger in der Fläche
 * liegt (ohne Schranke) oder bis `saum` Bildpunkte neben einer Kante. Weiter draußen: keine. Legacy `handleEditableRegionDoubleClick`
 * (`findNearestEditedRegionEdge(…, Infinity)`) und `regionEditDoubleClickSetsCorner`; gemessen an den geraden Strecken wie die
 * Strg-Kante. Liegen mehrere Objekte im Modus (Sammelbearbeitung), gilt das Objekt, in dem der Zeiger liegt.
 */
export function flaechenKanteUnter(
    teile: readonly Teil[],
    zeiger: Pixel,
    schirm: (p: Punkt) => Pixel,
    saum = SAUM_PX,
): { objekt: string; nr: number; position: number } | undefined {
    const ringe = teile
        .filter((t) => t.art === "ring" && t.punkte.length >= 3)
        .map((teil) => ({ teil, bild: teil.punkte.map(schirm) }));
    const naechste = (auswahl: typeof ringe): { teil: Teil; position: number; weite: number } | undefined => {
        let beste: { teil: Teil; position: number; weite: number } | undefined;
        for (const { teil, bild } of auswahl)
            for (let i = 0; i < bild.length; i += 1) {
                const weite = abstand(fussAufStrecke(zeiger, bild[i]!, bild[(i + 1) % bild.length]!), zeiger);
                if (beste === undefined || weite < beste.weite) beste = { teil, position: i + 1, weite };
            }
        return beste;
    };
    const objekte = [...new Set(ringe.map((r) => r.teil.objekt))];
    const drin = objekte.find((objekt) =>
        innerhalb(
            zeiger,
            ringe.filter((r) => r.teil.objekt === objekt).map((r) => r.bild),
        ),
    );
    const beste = drin === undefined ? naechste(ringe) : naechste(ringe.filter((r) => r.teil.objekt === drin));
    if (beste === undefined || (drin === undefined && beste.weite > saum)) return undefined;
    return { objekt: beste.teil.objekt, nr: beste.teil.nr, position: beste.position };
}

/**
 * Wohin neue Punkte `at` an der Stelle `position` des Rings `teil` auch in die Nachbarn kommen (Thomas 2026-10-19, 5.2;
 * Flächen-Konzept „gemeinsame Kanten“): in jede Kante eines Nachbarrings, deren beide Enden auf den Enden der Kante liegen, auf der er
 * eingefügt wird, in welcher Richtung auch immer. So entsteht keine Lücke und keine Überlappung, und ein späteres Ziehen nimmt den
 * Nachbarn mit wie an jeder gemeinsamen Ecke. Nur Ringe: Wege teilen Knoten, keine Kanten. Wer einen Nachbarn nicht mitnehmen darf (ein
 * anderer hält ihn), reicht ihn nicht als Nachbarn.
 *
 * Mehrere Punkte (Strg + Klick, `teilungUnter`) kommen in der Richtung der Nachbarkante, in der Reihenfolge von `a` nach `b`. Jede Stelle
 * zählt nach dem Einfügen ALLER Punkte; eingefügt wird von vorn (`standNach`).
 */
export function aufGemeinsamerKante(
    teil: Teil,
    position: number,
    at: Punkt | readonly Punkt[],
    nachbarn: readonly Teil[],
): Eingefuegt[] {
    if (teil.art !== "ring") return [];
    const neue: readonly Punkt[] = "x" in at ? [at] : at;
    const a = teil.punkte[position - 1];
    const b = teil.punkte[position % teil.punkte.length];
    if (a === undefined || b === undefined) return [];
    const raus: Eingefuegt[] = [];
    for (const nachbar of nachbarn) {
        if (nachbar.art !== "ring") continue;
        const n = nachbar.punkte.length;
        let davor = 0;
        for (let i = 0; i < n; i += 1) {
            const p = nachbar.punkte[i]!;
            const q = nachbar.punkte[(i + 1) % n]!;
            const gleich = deckungsgleich(p, a) && deckungsgleich(q, b);
            if (!gleich && !(deckungsgleich(p, b) && deckungsgleich(q, a))) continue;
            const folge = gleich ? neue : [...neue].reverse();
            folge.forEach((punkt, k) =>
                raus.push({
                    stelle: { objekt: nachbar.objekt, nr: nachbar.nr, index: i + 1 + davor + k },
                    revision: nachbar.revision,
                    at: punkt,
                }),
            );
            davor += neue.length;
        }
    }
    return raus;
}

export const verschoben = (punkte: readonly Punkt[], index: number, at: Punkt): Punkt[] =>
    punkte.map((p, i) => (i === index ? at : p));

/** Alle Stellen in diesen Teilen, die genau (fünf Stellen) auf `at` liegen: was ein Anfasser an dieser Stelle trägt. */
export function stellenAn(at: Punkt, teile: readonly Teil[]): (Stelle & { revision: number })[] {
    const raus: (Stelle & { revision: number })[] = [];
    for (const teil of teile) {
        teil.punkte.forEach((p, index) => {
            if (deckungsgleich(p, at)) raus.push({ objekt: teil.objekt, nr: teil.nr, index, revision: teil.revision });
        });
    }
    return raus;
}

/**
 * Steht an diesem Punkt ein Ort? Dann hängen die Wege am Ort, und nichts zieht mit (WI-0177 §5, Betreiber 2026-10-15). Die Regel des
 * gemeinsamen Codes (`amOrt`, `ORT_NAEHE`), die auch der Server prüft (`path-edit.ts`).
 */
export const amOrt: (at: Punkt, orte: readonly Punkt[]) => boolean = amOrtGemeinsam;

/**
 * Was mitzieht, wenn der Punkt `von` nach `nach` geht: die deckungsgleichen Punkte der Nachbarn, außer an einem Ort und außer
 * gelöst (Strg). Jeder mit der Revision seines Objekts, gegen die gespeichert wird.
 */
export function mitziehende(
    von: Punkt,
    nach: Punkt,
    nachbarn: readonly Teil[],
    orte: readonly Punkt[],
    getrennt: boolean,
): { stelle: Stelle; revision: number; von: Punkt; nach: Punkt }[] {
    if (getrennt || amOrt(von, orte)) return [];
    return stellenAn(von, nachbarn).map(({ revision, ...stelle }) => ({ stelle, revision, von, nach }));
}

/** Die übrigen markierten Ecken eines Zugs (`GeometrieArt.markieren`): jede um dieselbe Strecke wie die gezogene. */
export function gruppeVerschoben(
    gruppe: readonly { readonly stelle: Stelle; readonly revision: number; readonly von: Punkt }[],
    dx: number,
    dy: number,
): { stelle: Stelle; revision: number; von: Punkt; nach: Punkt }[] {
    return gruppe.map(({ stelle, revision, von }) => ({
        stelle,
        revision,
        von,
        nach: { x: von.x + dx, y: von.y + dy },
    }));
}

/** `mitziehende` für mehrere Züge auf einmal; jede Stelle eines Nachbarn einmal (zwei markierte Ecken können auf derselben liegen). */
export function mitziehendeAller(
    zuege: readonly { readonly von: Punkt; readonly nach: Punkt }[],
    nachbarn: readonly Teil[],
    orte: readonly Punkt[],
    getrennt: boolean,
): { stelle: Stelle; revision: number; von: Punkt; nach: Punkt }[] {
    const gesehen = new Set<string>();
    return zuege
        .flatMap(({ von, nach }) => mitziehende(von, nach, nachbarn, orte, getrennt))
        .filter(({ stelle }) => {
            const schluessel = `${stelle.objekt} ${String(stelle.nr)} ${String(stelle.index)}`;
            if (gesehen.has(schluessel)) return false;
            gesehen.add(schluessel);
            return true;
        });
}

/**
 * Was beim Lösen (Strg, langer Druck) liegen bleibt: der Ausgangspunkt `von`, wenn dort Punkte von Nachbarn liegen, die sonst
 * mitzögen; nichts an einem Ort (dort hängen sie am Ort) und nichts ohne Lösen. Gezeichnet als Bernstein-Ring (G9: „hängt an nichts“,
 * wie Legacys Bedienprobe des Orts, D11), für alle Arten gleich.
 */
export function liegenBleibende(
    von: Punkt,
    nachbarn: readonly Teil[],
    orte: readonly Punkt[],
    getrennt: boolean,
): Punkt[] {
    if (!getrennt || amOrt(von, orte)) return [];
    return stellenAn(von, nachbarn).length > 0 ? [von] : [];
}

/** Die Teile ohne `teil`, wenn sein Objekt danach noch einen Teil hat und `teil` nur noch die Mindestzahl an Punkten; sonst `undefined` (`GeometrieArt.teilLoeschbar`). */
export function ohneTeil(teile: readonly Teil[], teil: Teil, mindestens: number): Teil[] | undefined {
    if (teil.punkte.length > mindestens) return undefined;
    const uebrig = teile.filter((t) => t !== teil);
    return uebrig.some((t) => t.objekt === teil.objekt) ? uebrig : undefined;
}

/** Ein Teil mit dem Punkt `index` an neuer Stelle; die übrigen Teile unverändert. */
export const teilMit = (teil: Teil, punkte: readonly Punkt[]): Teil => ({ ...teil, punkte });
