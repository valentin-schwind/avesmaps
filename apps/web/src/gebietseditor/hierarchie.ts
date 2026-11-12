import {
    AVENTURIA_POLITICAL_CARTOGRAPHY,
    legacyDisplayByBand,
    legacyInZoom,
    legacyYear,
    territoryDefaultZoomRange,
    type EditorTerritoryHierarchy,
    type EditorTerritoryHierarchyTerritory,
    type OracleInput,
} from "@avesmaps3d/shared";
import type { DarstellungStand } from "./zoombaender";

/**
 * Der Reiter „Hierarchie“ des Gebietseditors, gerechnet (WI-0209 A3; EDIT-0005 §3; EDIT-0003 T23): je Gebiet ab dem gewählten abwärts,
 * was die Karte in jedem Band zeigt. 🔴 Dieselbe Regel wie der Nachweis N2 (`territory-display-rule.ts` in `packages/shared`), mit dem
 * Band, das die Karte zeigt: über dem obersten abgeleiteten dieses (Gebietszeiger `maxBand`). Was hier „gezeigt“ heißt, steht also auf
 * der Karte, solange N2 nach der Ableitung grün ist.
 *
 * - **gezeigt:** Eine Fläche des Gebiets oder eines Untergebiets steht in diesem Band unter ihm auf der Karte.
 * - **verdeckt:** Die Spanne enthält das Band, und unter dem Gebiet liegt eine Fläche, aber ein Gebiet mit engerer Spanne gewinnt (Legacys
 *   Regel, ADR-0014 §4).
 * - **aus:** außerhalb der Spanne, ohne Fläche darunter, oder das Gebiet gilt im Anzeigejahr nicht.
 * - **∅ Lücke:** In diesem Band zeigt eine eigene Fläche gar nichts (keine Spanne der Kette enthält es, oder die Fläche hat ein eigenes
 *   Band). Ein Befund, nie eine Sperre.
 * - **∩ Überlappung:** Legacys Warnung im Territoriumseditor (`js/territory/territory-editor-embedded.js` 2712–2752, Mirror 5ff58118):
 *   Die geschlossene Spanne trifft die eines Obergebiets (vom Elter aufwärts) oder eines Kindes. Ebenso nur ein Hinweis.
 *
 * Die Daten eines Gebiets tragen auch jeden Nachfahren als Wurzel: Seine Kette steht darin, sein Teilbaum und dessen Flächen auch.
 *
 * Mit D2 dazu je Zeile die **Vorgabe nach Tiefe** (`territoryDefaultZoomRange`, gepunktet), die **Geschwister** im Reiter (für ⇉) und
 * die Revision, gegen die „Zoombänder bearbeiten“ schreibt; `mitEntwurf` legt den Entwurf über die Daten, wie der Server schreibt.
 */

export type Stufe = "gezeigt" | "verdeckt" | "aus";

export interface Ueberlappung {
    readonly id: string;
    readonly name: string;
    readonly von: number;
    readonly bis: number;
    readonly richtung: "oben" | "unten";
}

export interface HierarchieZeile {
    readonly id: string;
    readonly name: string;
    readonly art: string | undefined;
    readonly farbe: string;
    /** 0 ist das gewählte Gebiet. */
    readonly tiefe: number;
    /** Der Elter im Reiter; fehlt am gewählten Gebiet. */
    readonly eltern: string | undefined;
    readonly kinder: readonly string[];
    readonly min: number | undefined;
    readonly max: number | undefined;
    readonly imJahr: boolean;
    /** Je Band 0 bis `maxBand`. */
    readonly stufen: readonly Stufe[];
    readonly luecken: readonly number[];
    readonly ueber: readonly Ueberlappung[];
    /** Die Vorgabe nach Tiefe (D2, T23 Frage 7): Länge der Kette durch das Gebiet, Stelle darin. */
    readonly vorgabe: { readonly min: number; readonly max: number };
    /** Die übrigen Kinder seines Elters, soweit der Reiter sie trägt (⇉); an der Wurzel keine. */
    readonly geschwister: readonly string[];
    /** Der Stand, gegen den „Fertig“ schreibt. */
    readonly revision: number | undefined;
}

export interface Hierarchie {
    readonly wurzel: string;
    /** In der Folge des Baums: Tiefensuche, Geschwister nach Reihenfolge, dann Name. */
    readonly zeilen: readonly HierarchieZeile[];
    /** Das oberste Band, das die Karte zeigt; ohne Ableitung (`derivedMaxBand` −1) das oberste der Regel. */
    readonly kartenBand: number;
    readonly abgeleitet: boolean;
}

/** Trägt die Hierarchie dieses Gebiets das Gebiet als Wurzel (es selbst oder ein Nachfahre)? */
export function traegtWurzel(daten: EditorTerritoryHierarchy, id: string): boolean {
    return daten.territories.some((t) => t.id === id && t.above !== true);
}

function zuRegel(daten: EditorTerritoryHierarchy): OracleInput {
    return {
        territories: daten.territories.map((t) => ({
            publicId: t.id,
            name: t.name,
            shortName: t.shortName ?? "",
            parentPublicId: t.parent ?? null,
            minZoom: t.minZoom ?? null,
            maxZoom: t.maxZoom ?? null,
            validFromBf: t.validFromBf ?? null,
            validToBf: t.validToBf ?? null,
        })),
        geometries: daten.areas.map((a) => ({
            publicId: a.id,
            territoryPublicId: a.territory,
            minZoom: a.minZoom ?? null,
            maxZoom: a.maxZoom ?? null,
            validFromBf: a.validFromBf ?? null,
            validToBf: a.validToBf ?? null,
        })),
    };
}

const geschlossen = (
    t: EditorTerritoryHierarchyTerritory,
): t is EditorTerritoryHierarchyTerritory & {
    minZoom: number;
    maxZoom: number;
} => t.minZoom !== undefined && t.maxZoom !== undefined;

export function hierarchieVon(
    daten: EditorTerritoryHierarchy,
    wurzel: string,
    maxBand: number = AVENTURIA_POLITICAL_CARTOGRAPHY.maxBand,
): Hierarchie | undefined {
    const nachId = new Map(daten.territories.map((t) => [t.id, t]));
    const start = nachId.get(wurzel);
    if (start === undefined || start.above === true) return undefined;

    const abgeleitet = daten.derivedMaxBand >= 0;
    const kartenBand = abgeleitet ? Math.min(daten.derivedMaxBand, maxBand) : maxBand;
    const zoomFuer = (band: number): number => Math.max(0, Math.min(band, kartenBand));
    const regel = zuRegel(daten);
    const baender = legacyDisplayByBand(regel, daten.yearBf, maxBand, zoomFuer);
    const jahr = legacyYear(regel, daten.yearBf);

    const gezeigt = new Map<string, Set<number>>();
    baender.forEach((band, b) => {
        for (const anzeige of band.values()) {
            const menge = gezeigt.get(anzeige) ?? new Set<number>();
            menge.add(b);
            gezeigt.set(anzeige, menge);
        }
    });
    const luecken = new Map<string, Set<number>>();
    const mitFlaeche = new Set<string>();
    for (const g of jahr.geometries) {
        mitFlaeche.add(g.territoryPublicId);
        baender.forEach((band, b) => {
            if (band.has(g.publicId)) return;
            const menge = luecken.get(g.territoryPublicId) ?? new Set<number>();
            menge.add(b);
            luecken.set(g.territoryPublicId, menge);
        });
    }

    const kinderVon = new Map<string, EditorTerritoryHierarchyTerritory[]>();
    for (const t of daten.territories) {
        if (t.parent === undefined || t.parent === t.id) continue;
        const liste = kinderVon.get(t.parent) ?? [];
        liste.push(t);
        kinderVon.set(t.parent, liste);
    }
    for (const liste of kinderVon.values())
        liste.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, "de") || a.id.localeCompare(b.id));

    /** Liegt unter dem Gebiet (es selbst oder ein Nachfahre) eine Fläche im Anzeigejahr? */
    const traegt = new Map<string, boolean>();
    const hatFlaeche = (id: string, kette = new Set<string>()): boolean => {
        const fertig = traegt.get(id);
        if (fertig !== undefined) return fertig;
        if (kette.has(id)) return false;
        kette.add(id);
        const ja = mitFlaeche.has(id) || (kinderVon.get(id) ?? []).some((k) => hatFlaeche(k.id, kette));
        traegt.set(id, ja);
        return ja;
    };

    const ueberlappungen = (t: EditorTerritoryHierarchyTerritory): Ueberlappung[] => {
        if (!geschlossen(t)) return [];
        const trifft = (
            o: EditorTerritoryHierarchyTerritory,
        ): o is EditorTerritoryHierarchyTerritory & {
            minZoom: number;
            maxZoom: number;
        } => geschlossen(o) && t.minZoom <= o.maxZoom && o.minZoom <= t.maxZoom;
        const aus: Ueberlappung[] = [];
        const gesehen = new Set<string>([t.id]);
        for (let p = t.parent; p !== undefined && !gesehen.has(p); p = nachId.get(p)?.parent) {
            gesehen.add(p);
            const o = nachId.get(p);
            if (o === undefined) break;
            if (trifft(o)) aus.push({ id: o.id, name: o.name, von: o.minZoom, bis: o.maxZoom, richtung: "oben" });
        }
        for (const k of kinderVon.get(t.id) ?? [])
            if (trifft(k)) aus.push({ id: k.id, name: k.name, von: k.minZoom, bis: k.maxZoom, richtung: "unten" });
        return aus;
    };

    /** Wie viele Glieder über dem Gebiet stehen (Kette über `parent`, auch über dem gewählten). */
    const vorfahren = (t: EditorTerritoryHierarchyTerritory): number => {
        let n = 0;
        const gesehen = new Set<string>([t.id]);
        for (let p = t.parent; p !== undefined && !gesehen.has(p) && nachId.has(p); p = nachId.get(p)?.parent) {
            gesehen.add(p);
            n += 1;
        }
        return n;
    };
    /** Die längste Kette unter dem Gebiet (Legacys Länge der Kette bis zum Blatt). */
    const hoehen = new Map<string, number>();
    const hoehe = (id: string, kette = new Set<string>()): number => {
        const fertig = hoehen.get(id);
        if (fertig !== undefined) return fertig;
        if (kette.has(id)) return 0;
        kette.add(id);
        const h = Math.max(0, ...(kinderVon.get(id) ?? []).map((k) => 1 + hoehe(k.id, kette)));
        hoehen.set(id, h);
        return h;
    };

    const zeilen: HierarchieZeile[] = [];
    const besucht = new Set<string>();
    const gehe = (t: EditorTerritoryHierarchyTerritory, tiefe: number, eltern: string | undefined): void => {
        if (besucht.has(t.id)) return;
        besucht.add(t.id);
        const kinder = (kinderVon.get(t.id) ?? []).filter((k) => !besucht.has(k.id));
        const imJahr = jahr.territories.has(t.id);
        const zeigt = gezeigt.get(t.id) ?? new Set<number>();
        const darunter = imJahr && hatFlaeche(t.id);
        const oben = vorfahren(t);
        const geschwister =
            eltern === undefined
                ? []
                : (kinderVon.get(eltern) ?? []).filter((k) => k.id !== t.id && k.above !== true).map((k) => k.id);
        zeilen.push({
            id: t.id,
            name: t.name,
            art: t.type,
            farbe: t.color,
            tiefe,
            eltern,
            kinder: kinder.map((k) => k.id),
            min: t.minZoom,
            max: t.maxZoom,
            imJahr,
            stufen: Array.from({ length: maxBand + 1 }, (_, b): Stufe =>
                zeigt.has(b)
                    ? "gezeigt"
                    : darunter && legacyInZoom(t.minZoom ?? null, t.maxZoom ?? null, zoomFuer(b))
                      ? "verdeckt"
                      : "aus",
            ),
            luecken: [...(luecken.get(t.id) ?? [])].sort((a, b) => a - b),
            ueber: ueberlappungen(t),
            vorgabe: territoryDefaultZoomRange(oben + 1 + hoehe(t.id), oben),
            geschwister,
            revision: t.revision,
        });
        for (const k of kinder) gehe(k, tiefe + 1, t.id);
    };
    gehe(start, 0, undefined);
    return { wurzel, zeilen, kartenBand, abgeleitet };
}

/** Ohne eigene Spanne (beide Grenzen offen). */
const ohneSpanne = <T extends { minZoom?: number; maxZoom?: number }>(x: T): Omit<T, "minZoom" | "maxZoom"> =>
    Object.fromEntries(Object.entries(x).filter(([k]) => k !== "minZoom" && k !== "maxZoom")) as Omit<
        T,
        "minZoom" | "maxZoom"
    >;

/**
 * Die Daten mit dem Entwurf von „Farben und Zoombänder“ (D2, D4): die neuen Spannen und Farben, und die Flächen eines Gebiets mit neuer
 * Spanne ohne eigenes Band, wie der Server schreibt (Legacy `avesmapsPoliticalUpdateTerritoryZoomRange`). So zeigt der Reiter, was die
 * Karte nach „Fertig“ und der Ableitung zeigt.
 */
export function mitEntwurf(daten: EditorTerritoryHierarchy, stand: DarstellungStand): EditorTerritoryHierarchy {
    if (stand.size === 0) return daten;
    return {
        ...daten,
        territories: daten.territories.map((t) => {
            const d = stand.get(t.id);
            if (d === undefined) return t;
            const s = d.spanne;
            return {
                ...(s === undefined ? t : ohneSpanne(t)),
                ...(s?.min === undefined ? {} : { minZoom: s.min }),
                ...(s?.max === undefined ? {} : { maxZoom: s.max }),
                ...(d.farbe === undefined ? {} : { color: d.farbe }),
            };
        }),
        areas: daten.areas.map((a) => {
            return stand.get(a.territory)?.spanne !== undefined ? ohneSpanne(a) : a;
        }),
    };
}

/** Die Befunde im Teilbaum für die Leiste des Modus: in welchen Bändern Lücken stehen, bei wie vielen Gebieten, wie viele Überlappungen. */
export function befundeVon(hierarchie: Hierarchie): { baender: number[]; gebiete: number; ueberlappungen: number } {
    const baender = new Set<number>();
    let gebiete = 0;
    let ueberlappungen = 0;
    for (const zeile of hierarchie.zeilen) {
        if (zeile.luecken.length > 0) gebiete += 1;
        for (const b of zeile.luecken) baender.add(b);
        if (zeile.ueber.length > 0) ueberlappungen += 1;
    }
    return { baender: [...baender].sort((a, b) => a - b), gebiete, ueberlappungen };
}
