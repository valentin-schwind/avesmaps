import type { DeriveInputs, HullMember } from "./derive.ts";
import type { DisplayedTerritory } from "./resolve.ts";

/**
 * Was ein Teillauf der Gebietsableitung rechnen muss (WI-0283 §4; Legacy `avesmapsPoliticalReadDerivedGeometryPlan`: geändertes Gebiet, Untergebiete, Vorfahren).
 * Reine Rechnung ohne Datenbank.
 *
 * 🔴 **Nicht aus dem Auftrag, aus dem Vergleich:** Der Abdruck des letzten Laufs (`territory_state.derive_inputs`) und die heutigen Eingaben ergeben je Band das
 * ganze Bild, und verglichen wird das Bild. So zählt jede zusammengelegte Speicherung, auch ein Umhängen (alter und neuer Baum), und kein Schreibweg muss etwas
 * melden. Was zwischen den Teilen liegt, steht in der Rechnung selbst:
 *
 * - **Form** eines Gebiets im Band: seine Flächen mit Prüfsumme, seine ganze Kette (sie entscheidet über Eigner und Tiefe) und die Schraffur, die unter ihm erscheint.
 * - **Hülle** eines Vorfahren: seine Mitglieder mit ihren Formen. Darum zieht eine geänderte Fläche ihre Vorfahren mit, nur das Band, das sie zeigt.
 * - **Namenslinie:** Name, Hülle und die Menge der Vorfahren. Ob sich dazu die Außengrenze eines Vorfahren in Reichweite geändert hat, sieht erst die Ableitung.
 * - **Innengrenzen** rechnet `derive-inner-borders.ts` aus den geänderten Formen, denn wer dort betroffen ist, ist eine Frage der Geometrie.
 */

/** So alt darf der letzte volle Lauf höchstens sein: Production hat keine Züge mehr, ein Fehler im Teillauf dürfte sich nicht ansammeln. */
export const VOLLER_LAUF_SPAETESTENS_MS = 24 * 60 * 60 * 1000;
/** Ab diesem Anteil geänderter Formen ist der volle Lauf der einfachere Weg zum selben Ergebnis. */
export const TEILLAUF_HOECHSTENS_ANTEIL = 0.4;

/** Der Abdruck in `territory_state.derive_inputs`. */
export interface DeriveAbdruck {
    /** `TERRITORY_DERIVE_VERSION`: Mit einer neuen Fassung der Ableitung gilt kein alter Stand. */
    version: number;
    /** Was die Grenzen sonst bestimmt (`ableitungsKonfig`). */
    konfig: string;
    /** Die Revision, zu der dieser Abdruck gehört: Hat ein älterer Stand danach gerechnet, passt sie nicht mehr. */
    revision: string;
    yearBf: number;
    maxBand: number;
    /** Wann zuletzt voll gerechnet wurde (ISO). */
    vollAm: string;
    inputs: DeriveInputs;
}

/** Alles, was je Band gezeigt wird; `derive.ts` rechnet es für den Abdruck und für heute gleich. */
export interface AbleitungsBild {
    assignments: readonly { band: number; areaId: number; territoryId: number }[];
    displayed: readonly DisplayedTerritory[];
    members: readonly HullMember[];
    nameOwners: readonly { band: number; owner: number }[];
    ancestors: readonly { band: number; owner: number; ancestor: number }[];
}

export interface BandAenderung {
    /** Gebiete, deren Form im Band neu entsteht oder wegfällt. */
    formen: number[];
    /** Vorfahren, deren Hülle und Außengrenze neu entstehen. */
    huellen: number[];
    /** Gebiete, deren Namenslinie neu entsteht, ohne die, die erst die Geometrie ergibt. */
    namen: number[];
}

export interface TeilPlan {
    bands: BandAenderung[];
    /** Geänderte Formen über alle Bänder (für den Bericht). */
    formen: number;
}

export type PlanErgebnis = { art: "teil"; plan: TeilPlan } | { art: "voll"; grund: string };

const stelle = (band: number, id: number): string => `${String(band)}/${String(id)}`;

/** Der Schlüssel der Form je Band und Gebiet. */
export function formSchluessel(bild: AbleitungsBild, inputs: DeriveInputs): Map<string, string> {
    const flaechen = new Map(inputs.areas.map((area) => [area.id, area]));
    const idVon = new Map(inputs.territories.map((territory) => [territory.publicId, territory.id]));
    const beansprucht = new Set(inputs.claims.flatMap((claim) => idVon.get(claim.territoryPublicId) ?? []));

    const jeForm = new Map<string, { areaId: number; hash: string; owner: number }[]>();
    /** Band → Eigner mit Anspruch → seine Flächen und das Gebiet, unter dem die Schraffur erscheint (wie `deriveClaimShapes`). */
    const schraffur = new Map<number, Map<number, { display: number; flaechen: string[] }>>();
    for (const { band, areaId, territoryId } of bild.assignments) {
        const area = flaechen.get(areaId);
        if (area === undefined) continue;
        const key = stelle(band, territoryId);
        const liste = jeForm.get(key) ?? [];
        liste.push({ areaId, hash: area.geomHash, owner: area.territoryId });
        jeForm.set(key, liste);
        if (!beansprucht.has(area.territoryId)) continue;
        const jeEigner = schraffur.get(band) ?? new Map<number, { display: number; flaechen: string[] }>();
        const zeile = jeEigner.get(area.territoryId) ?? { display: territoryId, flaechen: [] };
        zeile.display = Math.min(zeile.display, territoryId);
        zeile.flaechen.push(`${String(areaId)}:${area.geomHash}`);
        jeEigner.set(area.territoryId, zeile);
        schraffur.set(band, jeEigner);
    }
    const unterGebiet = new Map<string, string[]>();
    for (const [band, jeEigner] of schraffur) {
        for (const [owner, zeile] of jeEigner) {
            const key = stelle(band, zeile.display);
            const liste = unterGebiet.get(key) ?? [];
            liste.push(`${String(owner)}=${zeile.flaechen.sort().join(",")}`);
            unterGebiet.set(key, liste);
        }
    }
    const schluessel = new Map<string, string>();
    for (const shown of bild.displayed) {
        const key = stelle(shown.band, shown.territoryId);
        const liste = [...(jeForm.get(key) ?? [])].sort((a, b) => a.areaId - b.areaId);
        schluessel.set(
            key,
            JSON.stringify([
                shown.parentId,
                shown.depth,
                shown.chainIds,
                liste.map((eintrag) => [eintrag.areaId, eintrag.hash, eintrag.owner]),
                [...(unterGebiet.get(key) ?? [])].sort(),
            ]),
        );
    }
    return schluessel;
}

function huellenSchluessel(bild: AbleitungsBild, formen: ReadonlyMap<string, string>): Map<string, string> {
    const jeHuelle = new Map<string, { parent: number | null; depth: number; mitglieder: string[] }>();
    for (const member of bild.members) {
        const key = stelle(member.band, member.owner);
        const eintrag = jeHuelle.get(key) ?? { parent: member.parent, depth: member.depth, mitglieder: [] };
        eintrag.mitglieder.push(`${String(member.member)}=${formen.get(stelle(member.band, member.member)) ?? ""}`);
        jeHuelle.set(key, eintrag);
    }
    return new Map(
        [...jeHuelle].map(([key, eintrag]) => [
            key,
            JSON.stringify([eintrag.parent, eintrag.depth, eintrag.mitglieder.sort()]),
        ]),
    );
}

function namenSchluessel(
    bild: AbleitungsBild,
    inputs: DeriveInputs,
    huellen: ReadonlyMap<string, string>,
): Map<string, string> {
    const namen = new Map(inputs.territories.map((territory) => [territory.id, territory.name]));
    const vorfahren = new Map<string, number[]>();
    for (const eintrag of bild.ancestors) {
        const key = stelle(eintrag.band, eintrag.owner);
        const liste = vorfahren.get(key) ?? [];
        liste.push(eintrag.ancestor);
        vorfahren.set(key, liste);
    }
    return new Map(
        bild.nameOwners.map(({ band, owner }) => {
            const key = stelle(band, owner);
            return [
                key,
                JSON.stringify([
                    namen.get(owner) ?? "",
                    [...(vorfahren.get(key) ?? [])].sort((a, b) => a - b),
                    huellen.get(key) ?? "",
                ]),
            ];
        }),
    );
}

/** Die Stellen, an denen sich zwei Schlüsseltafeln unterscheiden, je Band sortiert. */
function unterschiede(alt: ReadonlyMap<string, string>, neu: ReadonlyMap<string, string>, maxBand: number): number[][] {
    const bands: Set<number>[] = Array.from({ length: maxBand + 1 }, () => new Set<number>());
    const merke = (key: string): void => {
        const [band, id] = key.split("/");
        bands[Number(band)]?.add(Number(id));
    };
    for (const [key, wert] of neu) if (alt.get(key) !== wert) merke(key);
    for (const key of alt.keys()) if (!neu.has(key)) merke(key);
    return bands.map((band) => [...band].sort((a, b) => a - b));
}

export function vergleicheBilder(
    alt: { inputs: DeriveInputs; bild: AbleitungsBild },
    neu: { inputs: DeriveInputs; bild: AbleitungsBild },
    maxBand: number,
): TeilPlan {
    const formenAlt = formSchluessel(alt.bild, alt.inputs);
    const formenNeu = formSchluessel(neu.bild, neu.inputs);
    const huellenAlt = huellenSchluessel(alt.bild, formenAlt);
    const huellenNeu = huellenSchluessel(neu.bild, formenNeu);
    const formen = unterschiede(formenAlt, formenNeu, maxBand);
    const huellen = unterschiede(huellenAlt, huellenNeu, maxBand);
    const namen = unterschiede(
        namenSchluessel(alt.bild, alt.inputs, huellenAlt),
        namenSchluessel(neu.bild, neu.inputs, huellenNeu),
        maxBand,
    );
    return {
        bands: formen.map((liste, band) => ({
            formen: liste,
            huellen: huellen[band] ?? [],
            namen: namen[band] ?? [],
        })),
        formen: formen.reduce((summe, liste) => summe + liste.length, 0),
    };
}

/**
 * Teillauf oder voller Lauf? `bildVon` rechnet das Bild des Abdrucks; es läuft erst, wenn die einfachen Prüfungen durch sind. Der voll gerechnete Stand bleibt der
 * Maßstab: Jeder Zweifel an den Voraussetzungen führt zum vollen Lauf, und der Grund steht im Ergebnis des Auftrags.
 */
export function planeTeillauf(eingabe: {
    abdruck: DeriveAbdruck | null;
    /** Stehen Kanten der Innengrenzen in der Tafel? Eine Kopie ohne sie hätte sonst Innengrenzen nur im geänderten Bereich. */
    kantenDa: boolean;
    derivedRevision: string | null;
    version: number;
    konfig: string;
    yearBf: number;
    maxBand: number;
    nowMs: number;
    neu: { inputs: DeriveInputs; bild: AbleitungsBild };
    bildVon: (inputs: DeriveInputs) => AbleitungsBild;
}): PlanErgebnis {
    const { abdruck, maxBand } = eingabe;
    if (abdruck === null) return { art: "voll", grund: "kein_abdruck" };
    if (abdruck.revision !== eingabe.derivedRevision) return { art: "voll", grund: "abdruck_alt" };
    if (abdruck.version !== eingabe.version || abdruck.konfig !== eingabe.konfig) {
        return { art: "voll", grund: "fassung" };
    }
    if (abdruck.yearBf !== eingabe.yearBf || abdruck.maxBand !== maxBand)
        return { art: "voll", grund: "jahr_oder_band" };
    if (!eingabe.kantenDa) return { art: "voll", grund: "keine_kanten" };
    const vollAm = Date.parse(abdruck.vollAm);
    if (!Number.isFinite(vollAm) || eingabe.nowMs - vollAm >= VOLLER_LAUF_SPAETESTENS_MS) {
        return { art: "voll", grund: "tageslauf" };
    }
    const plan = vergleicheBilder(
        { inputs: abdruck.inputs, bild: eingabe.bildVon(abdruck.inputs) },
        eingabe.neu,
        maxBand,
    );
    if (plan.formen > eingabe.neu.bild.displayed.length * TEILLAUF_HOECHSTENS_ANTEIL) {
        return { art: "voll", grund: "breite_aenderung" };
    }
    return { art: "teil", plan };
}
