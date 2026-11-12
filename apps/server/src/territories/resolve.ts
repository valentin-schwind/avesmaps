/**
 * Welches Gebiet zeigt eine Fläche in welchem Band? (WI-0062, ADR-0014, Betreiberentscheidung F2 „wie Legacy“)
 *
 * 🔴 REINE Rechnung, ohne Datenbank: Sie ist die eine Stelle für Ableitung und Prüfer, und sie ist Legacys Regel
 * (`avesmapsPoliticalResolveLayerDisplayTerritoryId`, `territories-layer.php`, avesmaps@ce24bbff0), nicht unsere
 * Erfindung. Lücken im Zoombereich und Überlappungen sind ein BEFUND, keine Korrektur (AGENTS.md: keine
 * dauerhaften Kartenänderungen vor dem Cutover).
 */

/** Ein Gebiet, wie die Rechnung es braucht. */
export interface TerritoryNode {
    id: number;
    publicId: string;
    name: string;
    parentId: number | null;
    minZoom: number | null;
    maxZoom: number | null;
    /** `null` heißt offen (Legacys 9999 ist beim Import schon `null` geworden). */
    validFromBf: number | null;
    validToBf: number | null;
}

/** Eine Quellfläche, wie die Rechnung sie braucht (ohne Geometrie). */
export interface AreaNode {
    id: number;
    publicId: string;
    territoryId: number;
    validFromBf: number | null;
    validToBf: number | null;
    minZoom: number | null;
    maxZoom: number | null;
}

/** Gilt eine Gültigkeit im Jahr? `null` an einem Ende heißt unbegrenzt. */
export function isValidAt(fromBf: number | null, toBf: number | null, yearBf: number): boolean {
    return (fromBf === null || fromBf <= yearBf) && (toBf === null || toBf >= yearBf);
}

/** Enthält das Zoomband [min, max] das Band? `null` heißt unbegrenzt. */
export function bandContains(min: number | null, max: number | null, band: number): boolean {
    return (min === null || min <= band) && (max === null || max >= band);
}

/**
 * Sammelknoten ohne eigene Bedeutung („unabhängig“, „umstritten“, „ungeklärt“): Legacy nimmt sie aus jeder Kette
 * und zeigt nie ihre Vereinigung (`avesmapsPoliticalIsGenericHierarchyRootName`). Im Bestand vom 2026-09-29 gibt
 * es keinen; die Regel steht hier, damit ein späterer sich nicht als Reich verkleidet.
 */
export function isGenericGroupName(name: string): boolean {
    const trimmed = name.trim();
    return /^unabh.*ngig\b/iu.test(trimmed) || /^umstritten\b/iu.test(trimmed) || /^ungekl.*rt\b/iu.test(trimmed);
}

/**
 * Die wirksame Kette eines Gebiets von der Wurzel bis zu ihm: nur Gebiete, die im Anzeigejahr gelten (Legacy holt
 * nur diese und bricht die Kette an einem abgelaufenen Elter ab), ohne Sammelknoten, ohne Zyklus.
 */
export function effectiveChain(
    territoryId: number,
    byId: ReadonlyMap<number, TerritoryNode>,
    yearBf: number,
): TerritoryNode[] {
    const chain: TerritoryNode[] = [];
    const seen = new Set<number>();
    let current = byId.get(territoryId);
    while (current && !seen.has(current.id) && isValidAt(current.validFromBf, current.validToBf, yearBf)) {
        // Ein Sammelknoten über dem Gebiet endet die Kette: das Gebiet gilt als Reich (Legacy `parentIds`).
        if (current.id !== territoryId && isGenericGroupName(current.name)) break;
        seen.add(current.id);
        chain.unshift(current);
        current = current.parentId === null ? undefined : byId.get(current.parentId);
    }
    return chain;
}

/**
 * Das Anzeigegebiet eines Bandes aus einer Kette: unter den Gliedern, deren Band das Band enthält, die engste
 * Spanne (`max ?? 99` − `min ?? 0`); bei Gleichstand das tiefere Glied. `undefined`, wo keines passt.
 */
export function pickDisplayTerritory(chain: readonly TerritoryNode[], band: number): TerritoryNode | undefined {
    let best: TerritoryNode | undefined;
    let bestWidth = Number.POSITIVE_INFINITY;
    let bestDepth = -1;
    chain.forEach((candidate, depth) => {
        if (!bandContains(candidate.minZoom, candidate.maxZoom, band)) return;
        if (isGenericGroupName(candidate.name)) return;
        const width = (candidate.maxZoom ?? 99) - (candidate.minZoom ?? 0);
        if (best === undefined || width < bestWidth || (width === bestWidth && depth > bestDepth)) {
            best = candidate;
            bestWidth = width;
            bestDepth = depth;
        }
    });
    return best;
}

/**
 * Welche Flächen eines Gebiets gelten im Jahr? Legacys Regel („aktuelle Form“): die Fläche beginnt spätestens im
 * Jahr (fehlt ihr Beginn, gilt der des Gebiets), und sie endet nicht davor - es sei denn, keine jüngere Fläche
 * desselben Gebiets löst sie ab. So verschwindet ein lebendes Gebiet nicht an einem veralteten Ende.
 */
export function currentAreas(
    areas: readonly AreaNode[],
    territory: TerritoryNode,
    yearBf: number,
): readonly AreaNode[] {
    return areas.filter((area) => {
        const from = area.validFromBf ?? territory.validFromBf;
        if (from !== null && from > yearBf) return false;
        if (area.validToBf === null || area.validToBf >= yearBf) return true;
        const areaFrom = area.validFromBf ?? 0;
        // Abgelöst nur von einer jüngeren Fläche, die im Jahr schon gilt.
        return !areas.some(
            (other) =>
                other.id !== area.id && (other.validFromBf ?? 0) <= yearBf && (other.validFromBf ?? 0) > areaFrom,
        );
    });
}

/** Warum eine gültige Fläche in einem Band nicht erscheint. */
export type NotShownReason = "no_band" | "own_band";

export interface Assignment {
    band: number;
    areaId: number;
    territoryId: number;
}

export interface NotShown {
    band: number;
    areaId: number;
    reason: NotShownReason;
}

export interface AssignmentResult {
    assignments: Assignment[];
    /** Gültige Flächen, die ein Band nicht zeigt: Lücken im Zoombereich (Befund, F2). */
    notShown: NotShown[];
    /** Flächen, die im Anzeigejahr gar nicht gelten (Gebiet oder Fläche abgelaufen, noch nicht begonnen). */
    notCurrent: number;
}

/**
 * Jede im Jahr geltende Fläche in jedem Band 0 bis `maxBand`: das Anzeigegebiet aus der Kette ihres Gebiets, mit
 * Legacys Zusatz für die Fläche, die sich selbst zeigt und ein eigenes Band trägt (dann muss auch dieses passen).
 */
export function assignAreasToBands(
    territories: readonly TerritoryNode[],
    areas: readonly AreaNode[],
    yearBf: number,
    maxBand: number,
): AssignmentResult {
    const byId = new Map(territories.map((territory) => [territory.id, territory]));
    const areasByTerritory = new Map<number, AreaNode[]>();
    for (const area of areas) {
        const list = areasByTerritory.get(area.territoryId);
        if (list) list.push(area);
        else areasByTerritory.set(area.territoryId, [area]);
    }
    const assignments: Assignment[] = [];
    const notShown: NotShown[] = [];
    let notCurrent = 0;
    const chains = new Map<number, TerritoryNode[]>();
    for (const [territoryId, own] of areasByTerritory) {
        const territory = byId.get(territoryId);
        if (!territory || !isValidAt(territory.validFromBf, territory.validToBf, yearBf)) {
            notCurrent += own.length;
            continue;
        }
        const current = currentAreas(own, territory, yearBf);
        notCurrent += own.length - current.length;
        let chain = chains.get(territoryId);
        if (!chain) {
            chain = effectiveChain(territoryId, byId, yearBf);
            chains.set(territoryId, chain);
        }
        for (const area of current) {
            for (let band = 0; band <= maxBand; band += 1) {
                const display = pickDisplayTerritory(chain, band);
                if (!display) {
                    notShown.push({ band, areaId: area.id, reason: "no_band" });
                } else if (display.id === territoryId && !bandContains(area.minZoom, area.maxZoom, band)) {
                    notShown.push({ band, areaId: area.id, reason: "own_band" });
                } else {
                    assignments.push({ band, areaId: area.id, territoryId: display.id });
                }
            }
        }
    }
    const order = (left: { band: number; areaId: number }, right: { band: number; areaId: number }): number =>
        left.band - right.band || left.areaId - right.areaId;
    assignments.sort(order);
    notShown.sort(order);
    return { assignments, notShown, notCurrent };
}

/** Ein gezeigtes Gebiet in einem Band, mit seiner wirksamen Kette (für Hüllen und Grenzen). */
export interface DisplayedTerritory {
    band: number;
    territoryId: number;
    /** Wirksamer Elter im Anzeigejahr (`null` bei einem Reich). */
    parentId: number | null;
    /** Tiefe in der wirksamen Kette: 0 = Reich. */
    depth: number;
    /** Die Kette von der Wurzel bis zum Gebiet selbst. */
    chainIds: number[];
}

/** Aus den Zuordnungen die gezeigten Gebiete je Band, mit Kette, Elter und Tiefe. */
export function displayedTerritories(
    assignments: readonly Assignment[],
    territories: readonly TerritoryNode[],
    yearBf: number,
): DisplayedTerritory[] {
    const byId = new Map(territories.map((territory) => [territory.id, territory]));
    const seen = new Set<string>();
    const result: DisplayedTerritory[] = [];
    for (const { band, territoryId } of assignments) {
        const key = `${String(band)}:${String(territoryId)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const chain = effectiveChain(territoryId, byId, yearBf);
        const parent = chain.length >= 2 ? (chain[chain.length - 2] as TerritoryNode) : undefined;
        result.push({
            band,
            territoryId,
            parentId: parent?.id ?? null,
            depth: Math.max(0, chain.length - 1),
            chainIds: chain.map((node) => node.id),
        });
    }
    return result;
}
