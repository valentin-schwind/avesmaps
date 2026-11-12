import {
    AVENTURIA_POLITICAL_CARTOGRAPHY,
    legacyDisplayByBand,
    type EditorTerritoryParentConsequences,
    type EditorTerritoryRef,
    type OracleInput,
} from "@avesmaps3d/shared";
import type { Database } from "../database.ts";
import { ApiError } from "../http/api-error.ts";
import { oracleInputFromDatabase } from "../territories/verify-legacy-bands.ts";

/**
 * Die Folgen von „Umhängen“, bevor es in den Entwurf geht (WI-0209 D1; EDIT-0003 R13; EDIT-0005 §7 D1, Probierblatt `umhaengFolgen`):
 * je Band, unter welchem Gebiet die Karte die Flächen des umgehängten Teilbaums danach zeigt statt vorher.
 *
 * - **Dieselbe Regel wie N2** (`territory-display-rule.ts`, Legacys Anzeige nach der engsten Spanne, Spannen bis 8 ohne Legacys Klemme):
 *   Was das Blatt sagt, zeigt der Nachweis nach der Ableitung genauso. Gerechnet auf den gespeicherten Gebieten des Anzeigejahrs, einmal
 *   wie sie sind und einmal mit dem neuen Elter.
 * - Gleiche Wechsel in mehreren Bändern stehen in einer Zeile; `areas` zählt die Flächen, die so wechseln.
 * - `kreis`: Das neue Obergebiet ist das Gebiet selbst oder eines seiner Untergebiete; dann keine Folgen, geschrieben wird es nie
 *   (`territory.update` weist es ab).
 * - Nur lesend, keine Sperre: Das Blatt darf jeder sehen, der den Editor sieht.
 */
export async function readParentConsequences(
    database: Database,
    territoryId: string,
    parent: string,
    mapDomainId = "aventuria",
    yearBf: number = AVENTURIA_POLITICAL_CARTOGRAPHY.displayYearBf,
): Promise<EditorTerritoryParentConsequences | undefined> {
    const input = await oracleInputFromDatabase(database, mapDomainId);
    const nachId = new Map(input.territories.map((t) => [t.publicId, t]));
    const gebiet = nachId.get(territoryId);
    if (gebiet === undefined) return undefined;
    const ziel = parent === "" ? null : parent;
    if (ziel !== null && !nachId.has(ziel))
        throw new ApiError(400, "validation_failed", "Dieses Obergebiet gibt es nicht.", { field: "parent" });

    const kinder = new Map<string, string[]>();
    for (const t of input.territories)
        if (t.parentPublicId !== null)
            kinder.set(t.parentPublicId, [...(kinder.get(t.parentPublicId) ?? []), t.publicId]);
    const teilbaum = new Set<string>([territoryId]);
    const offen = [territoryId];
    while (offen.length > 0)
        for (const kind of kinder.get(offen.pop()!) ?? [])
            if (!teilbaum.has(kind)) {
                teilbaum.add(kind);
                offen.push(kind);
            }

    const ref = (id: string | null | undefined): EditorTerritoryRef | undefined =>
        id === null || id === undefined ? undefined : { id, name: nachId.get(id)?.name ?? "" };
    const von = ref(gebiet.parentPublicId);
    const nach = ref(ziel);
    const kopf = {
        id: territoryId,
        name: gebiet.name,
        ...(von === undefined ? {} : { from: von }),
        ...(nach === undefined ? {} : { to: nach }),
        kreis: ziel !== null && teilbaum.has(ziel),
        descendants: teilbaum.size - 1,
    };
    if (kopf.kreis) return { ...kopf, changes: [] };

    const maxBand = AVENTURIA_POLITICAL_CARTOGRAPHY.maxBand;
    const umgehaengt: OracleInput = {
        ...input,
        territories: input.territories.map((t) => (t.publicId === territoryId ? { ...t, parentPublicId: ziel } : t)),
    };
    const vorher = legacyDisplayByBand(input, yearBf, maxBand, (band) => band);
    const nachher = legacyDisplayByBand(umgehaengt, yearBf, maxBand, (band) => band);
    const flaechen = input.geometries.filter((g) => teilbaum.has(g.territoryPublicId));
    const wechsel = new Map<string, { von?: string; nach?: string; baender: Set<number>; flaechen: Set<string> }>();
    for (let band = 0; band <= maxBand; band++)
        for (const f of flaechen) {
            const a = vorher[band]?.get(f.publicId);
            const n = nachher[band]?.get(f.publicId);
            if (a === n) continue;
            const schluessel = `${a ?? ""}|${n ?? ""}`;
            const eintrag = wechsel.get(schluessel) ?? {
                ...(a === undefined ? {} : { von: a }),
                ...(n === undefined ? {} : { nach: n }),
                baender: new Set<number>(),
                flaechen: new Set<string>(),
            };
            eintrag.baender.add(band);
            eintrag.flaechen.add(f.publicId);
            wechsel.set(schluessel, eintrag);
        }
    const changes = [...wechsel.values()]
        .map((w) => {
            const a = ref(w.von);
            const n = ref(w.nach);
            return {
                bands: [...w.baender].sort((x, y) => x - y),
                ...(a === undefined ? {} : { from: a }),
                ...(n === undefined ? {} : { to: n }),
                areas: w.flaechen.size,
            };
        })
        .sort((x, y) => x.bands[0]! - y.bands[0]! || (x.to?.name ?? "").localeCompare(y.to?.name ?? "", "de"));
    return { ...kopf, changes };
}
