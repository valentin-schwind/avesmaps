/**
 * Legacys Anzeigeregel der politischen Karte (WI-0209): welches Gebiet eine Fläche bei welchem Band zeigt. EINE Regel für drei Leser:
 * den Nachweis gegen Legacys Export (N1, `apps/server/src/territories/verify-legacy-bands.ts`), denselben Nachweis auf unseren Tafeln
 * nach jeder Ableitung (N2) und den Reiter „Hierarchie“ des Gebietseditors (A3; mit D2 auch die Vorschau im Entwurf).
 *
 * Nachgebaut aus Legacys öffentlichem Layer, nicht aus unserer Ableitung (`apps/server/src/territories/resolve.ts`), damit ein Fehler,
 * der in beiden gleich stünde, nicht unentdeckt bleibt. Quelle (Mirror 5ff58118):
 *
 * - `api/_internal/political/territories-layer.php`: `avesmapsPoliticalReadLayer` (welche Gebiete und Flächen im Jahr gelten, die
 *   „aktuelle Form“), `avesmapsPoliticalFetchLayerTerritories`, `avesmapsPoliticalBuildEffectiveLayerParentIds`,
 *   `avesmapsPoliticalResolveLayerDisplayTerritoryId` (engste Spanne, bei Gleichstand das tiefere Glied, sonst vom tiefsten aufwärts
 *   das erste passende), `avesmapsPoliticalBuildResolvedLayerFeatures` (ein Sammelknoten zeigt nie eine Vereinigung),
 *   `avesmapsPoliticalLayerRowToFeature` (das Band der Kachel: das eigene der Fläche, sonst das des Gebiets),
 *   `avesmapsPoliticalClampLayerRequestZoom` (über 6 gilt 6);
 * - `api/_internal/political/territories-read.php`: `avesmapsPoliticalIsGenericHierarchyRootName`;
 * - `js/map-features/map-features-political-territory-loader.js:545-560`: die Karte blendet eine Fläche aus, deren Band den Zoom nicht
 *   enthält.
 *
 * Wie der Export gelesen wird, steht beim Server (`legacy-oracle.ts`); was davon die Regel nicht trägt, nennt der Nachweis.
 */

/** Legacy klemmt jede Gebietsanfrage auf diesen Zoom (`avesmapsPoliticalClampLayerRequestZoom`). */
export const LEGACY_LAYER_MAX_ZOOM = 6;
const OFFEN = 9999;

export interface OracleTerritory {
    publicId: string;
    name: string;
    shortName: string;
    parentPublicId: string | null;
    minZoom: number | null;
    maxZoom: number | null;
    validFromBf: number | null;
    validToBf: number | null;
}

export interface OracleGeometry {
    publicId: string;
    territoryPublicId: string;
    minZoom: number | null;
    maxZoom: number | null;
    validFromBf: number | null;
    validToBf: number | null;
}

export interface OracleInput {
    territories: OracleTerritory[];
    geometries: OracleGeometry[];
}

/** Je Band: Fläche (`public_id`) → das Gebiet, unter dem die Karte sie zeigt. Was fehlt, zeigt die Karte nicht. */
export type OracleBand = Map<string, string>;

const offen = (bis: number | null): boolean => bis === null || bis === OFFEN;
const lebt = (von: number | null, bis: number | null, jahr: number): boolean =>
    (von === null || von <= jahr) && (offen(bis) || (bis as number) >= jahr);
/** Enthält die Spanne den Zoom? Eine fehlende Grenze ist offen. */
export const legacyInZoom = (min: number | null, max: number | null, zoom: number): boolean =>
    (min === null || min <= zoom) && (max === null || max >= zoom);

/** `avesmapsPoliticalNormalizeHierarchyRootKey`: klein, ß → ss, Umlaute fallen weg (wie Legacys ASCII-Faltung), nur a–z und 0–9. */
function wurzelSchluessel(wert: string): string {
    return wert
        .trim()
        .toLowerCase()
        .replace(/ß/g, "ss")
        .replace(/[äöü]/g, "")
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .replace(/[^a-z0-9]+/g, "");
}

/** `avesmapsPoliticalIsGenericHierarchyRootName`: „unabhängig“, „umstritten“, „ungeklärt“ sammeln nur, sie herrschen nicht. */
export function isLegacyGenericRootName(name: string): boolean {
    const n = name.trim();
    if (!n) return false;
    if (/^unabh.*ngig\b/iu.test(n) || /^umstritten\b/iu.test(n) || /^ungekl.*rt\b/iu.test(n)) return true;
    return ["unabhangig", "unabhngig", "umstritten", "ungeklart", "ungeklrt"].includes(wurzelSchluessel(n));
}
const sammelknoten = (t: OracleTerritory): boolean =>
    isLegacyGenericRootName(t.name) || isLegacyGenericRootName(t.shortName);

export interface OracleYear {
    /** Die Gebiete, die im Jahr gelten (`avesmapsPoliticalFetchLayerTerritories`). */
    territories: Map<string, OracleTerritory>;
    /** Der wirksame Elter: der gespeicherte, wenn er im Jahr gilt, nicht das Gebiet selbst und kein Sammelknoten ist. */
    parents: Map<string, string>;
    /** Die Flächen, die im Jahr gelten, samt der „aktuellen Form“ (`avesmapsPoliticalReadLayer`). */
    geometries: OracleGeometry[];
}

export function legacyYear(input: OracleInput, yearBf: number): OracleYear {
    const territories = new Map(
        input.territories.filter((t) => lebt(t.validFromBf, t.validToBf, yearBf)).map((t) => [t.publicId, t]),
    );
    const parents = new Map<string, string>();
    for (const t of territories.values()) {
        const p = t.parentPublicId ? territories.get(t.parentPublicId) : undefined;
        if (p && p.publicId !== t.publicId && !sammelknoten(p)) parents.set(t.publicId, p.publicId);
    }
    const jeGebiet = new Map<string, OracleGeometry[]>();
    for (const g of input.geometries) {
        const list = jeGebiet.get(g.territoryPublicId) ?? [];
        list.push(g);
        jeGebiet.set(g.territoryPublicId, list);
    }
    const geometries = input.geometries.filter((g) => {
        const t = territories.get(g.territoryPublicId);
        if (!t) return false;
        const von = g.validFromBf ?? t.validFromBf;
        if (von !== null && von > yearBf) return false;
        if (offen(g.validToBf) || (g.validToBf as number) >= yearBf) return true;
        // Abgelaufen: nur die AKTUELLE Form bleibt, die von keiner jüngeren Fläche desselben Gebiets verdrängt ist.
        const eigenesVon = g.validFromBf ?? 0;
        return !(jeGebiet.get(g.territoryPublicId) ?? []).some(
            (g2) => g2.publicId !== g.publicId && (g2.validFromBf ?? 0) <= yearBf && (g2.validFromBf ?? 0) > eigenesVon,
        );
    });
    return { territories, parents, geometries };
}

/** `avesmapsPoliticalResolveLayerDisplayTerritoryId`: die Kette von der Wurzel bis zum Gebiet, das engste passende Glied. */
export function legacyDisplayTerritory(year: OracleYear, sourcePublicId: string, zoom: number): string | null {
    const chain: string[] = [];
    const seen = new Set<string>();
    for (
        let id: string | undefined = sourcePublicId;
        id && year.territories.has(id) && !seen.has(id);
        id = year.parents.get(id)
    ) {
        seen.add(id);
        chain.unshift(id);
    }
    if (!chain.length) return null;
    let best: string | null = null,
        bestWidth = 0,
        bestDepth = 0;
    for (const [depth, id] of chain.entries()) {
        const t = year.territories.get(id) as OracleTerritory;
        if (!legacyInZoom(t.minZoom, t.maxZoom, zoom) || sammelknoten(t)) continue;
        const width = (t.maxZoom ?? 99) - (t.minZoom ?? 0);
        if (best === null || width < bestWidth || (width === bestWidth && depth > bestDepth)) {
            best = id;
            bestWidth = width;
            bestDepth = depth;
        }
    }
    if (best !== null) return best;
    for (let i = chain.length - 1; i >= 0; i--) {
        const t = year.territories.get(chain[i] as string) as OracleTerritory;
        if (legacyInZoom(t.minZoom, t.maxZoom, zoom)) return t.publicId;
    }
    return null;
}

/** Legacy-Zoom eines Bandes: Band = Legacy-Zoom (ADR-0014 §4), über 6 klemmt Legacy auf 6. */
export const legacyZoomForBand = (band: number): number => Math.max(0, Math.min(band, LEGACY_LAYER_MAX_ZOOM));

/**
 * Je Band 0..maxBand: was die Karte zeigt. Eine Fläche, deren Gebiet sich selbst zeigt, braucht dazu auch ihr eigenes Band (das der
 * Fläche, sonst das des Gebiets, je Grenze für sich: PHPs `??`); zeigt sie ein Obergebiet, gilt dessen Band. Ein Sammelknoten als
 * Anzeigegebiet: die Fläche zeigt sich selbst, wenn ihr eigenes Band passt, sonst gar nicht.
 *
 * `zoomFuerBand` ist Legacys Klemme auf 6. Für unsere eigenen Tafeln (N2, Spannen bis 8) rechnet der Aufrufer mit dem Band, das unsere
 * Karte zeigt (über dem obersten abgeleiteten: dieses); die Regel selbst ist dieselbe (ADR-0014 §4).
 */
export function legacyDisplayByBand(
    input: OracleInput,
    yearBf: number,
    maxBand: number,
    zoomFuerBand: (band: number) => number = legacyZoomForBand,
): OracleBand[] {
    const year = legacyYear(input, yearBf);
    const bands: OracleBand[] = [];
    for (let band = 0; band <= maxBand; band++) {
        const zoom = zoomFuerBand(band);
        const shown: OracleBand = new Map();
        for (const g of year.geometries) {
            const source = year.territories.get(g.territoryPublicId) as OracleTerritory;
            let display = legacyDisplayTerritory(year, source.publicId, zoom);
            if (
                display !== null &&
                display !== source.publicId &&
                sammelknoten(year.territories.get(display) as OracleTerritory)
            ) {
                display = legacyInZoom(g.minZoom ?? source.minZoom, g.maxZoom ?? source.maxZoom, zoom)
                    ? source.publicId
                    : null;
            }
            if (display === null) continue;
            const shownMin =
                display === source.publicId
                    ? (g.minZoom ?? source.minZoom)
                    : (year.territories.get(display) as OracleTerritory).minZoom;
            const shownMax =
                display === source.publicId
                    ? (g.maxZoom ?? source.maxZoom)
                    : (year.territories.get(display) as OracleTerritory).maxZoom;
            if (!legacyInZoom(shownMin, shownMax, zoom)) continue;
            shown.set(g.publicId, display);
        }
        bands.push(shown);
    }
    return bands;
}
