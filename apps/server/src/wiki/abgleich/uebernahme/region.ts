import { isTerrainFrame } from "@avesmaps3d/shared";
import type { MapAuditEntry } from "../../../editor/map-operation.ts";
import { LANDSCHAFTS_STAND, schreibeLandschaftsStand } from "./landschafts-stand.ts";
import { regionArtikelSchreiber } from "./region-artikel.ts";
import type { BefundSchritt, FeldSchritt, Schreiber } from "./schreiber.ts";

/**
 * Der Schreiber der Landschaften (WI-0253 D-2; die Derographie: Gebirge, Wälder, Meere … `region`). Ein Objekt ist eine Landschaft (`region`); mehrere Landschaften können sich einen
 * Artikel teilen (die Teile), und der Wiki-Stand `wiki_region_snapshot` hängt am Schlüssel der Landschaft (`region.wiki_region_key`). Geschrieben werden:
 *
 * - **Wirksam** nur der Name (`region.name`), an jeder Landschaft, deren Name dem Wiki FOLGT (Vermerk „wiki“ in `field_origin`, Art `landscape`). Ebene, Art, Klicksperre, Kurve und Form bleiben beim Editor.
 * - **Der Wiki-Wert** (↺): Name, Art, Region, Staat, Einwohner, Sprache, Vegetation, Verkehrswege, Beschreibung, Kontinent (aus dem Wiki-Teil) und die acht Nachbarn.
 *   - Die Art steht im Wiki-Stand roh mit dem Rest der Mehrwertigkeit hinter `|` (Legacy liest die erste Komponente): Die Übernahme ersetzt die erste Komponente und lässt den Rest stehen.
 *   - Die Nachbarn stehen als Zeilen (`wiki_region_snapshot_neighbor`, je Richtung geordnet); eine Richtung wird als Ganzes ersetzt, die Namen so getrennt, wie der Leser sie verbindet.
 *
 * 🔴 **Der Name geht an die Beschriftungen, die ihm folgen**, in derselben Operation und mit demselben Muster wie der Editor (`landscape-update.ts`): `text_follows_name` oder, ungefüllt, wer bisher genau
 * den alten Namen trug; jede Beschriftung zählt ihre Revision und steht als eigener Eintrag im Fachprotokoll (`label.renamed`). Die Rücknahme stellt sie zurück, wo der Text noch der der Übernahme ist
 * (`folgenZuruecknehmen`). Der Kontinent Aventurien rahmt das Gelände: Sein Name bleibt (`name_gesperrt`). Der Name wird nie geleert.
 *
 * Der Name löst die Schriftläufe der Landschaft neu aus (`label_runs`); alles andere (der Wiki-Stand) geht in keine Ableitung ein (`leitetAb`). Die Sperre ist die des Editors
 * (`FOR NO KEY UPDATE`, wie `landscape-update.ts`): Ein gleichzeitiges Speichern wartet und scheitert danach an der Revision (409).
 */

const WIRKSAM = { name: "name" } as const;

const SCHNAPPSCHUSS: Readonly<Record<string, string>> = { ...LANDSCHAFTS_STAND, continent: "continent" };

export const regionSchreiber: Schreiber = {
    bereich: "region",
    neben: regionArtikelSchreiber,
    protokollArt: "region",
    objektArt: "region",
    affectedArt: "landscape",
    eintragZiel: (id) => ({ regionId: id }),
    zielSpalte: "region_public_id",
    wirksameSpalten: WIRKSAM,
    schnappschussSpalten: SCHNAPPSCHUSS,
    leitetAb: (schritte) => schritte.some((schritt) => schritt.feld === "name" && schritt.wirksam !== undefined),

    async sperre(tx, ids) {
        if (ids.length === 0) return new Map();
        const zeilen = await tx<{ id: string; revision: number }[]>`
            SELECT public_id::text AS id, revision::int AS revision
              FROM region
             WHERE public_id = ANY(${[...ids]}::uuid[]) AND is_active
             ORDER BY public_id
               FOR NO KEY UPDATE
        `;
        await tx`
            SELECT s.id
              FROM wiki_region_snapshot s
             WHERE s.is_active AND s.wiki_key IN (
                       SELECT r.wiki_region_key FROM region r WHERE r.public_id = ANY(${[...ids]}::uuid[]) AND r.wiki_region_key IS NOT NULL
                   )
             ORDER BY s.id
               FOR NO KEY UPDATE
        `;
        return new Map(zeilen.map((zeile) => [zeile.id, zeile.revision]));
    },

    async schnappschussIds(tx, ids) {
        if (ids.length === 0) return new Map();
        const zeilen = await tx<{ id: string; snapshot: string }[]>`
            SELECT r.public_id::text AS id, s.id::text AS snapshot
              FROM region r
              JOIN wiki_region_snapshot s ON s.wiki_key = r.wiki_region_key AND s.is_active
             WHERE r.public_id = ANY(${[...ids]}::uuid[]) AND r.is_active
        `;
        return new Map(zeilen.map((zeile) => [zeile.id, zeile.snapshot]));
    },

    async pruefe(tx, schritte) {
        const namen = schritte.filter((schritt) => schritt.feld === "name" && schritt.wirksam !== undefined);
        if (namen.length === 0) return { schritte: [...schritte], befunde: [] };
        const befunde: BefundSchritt[] = [];
        const nurSnapshot = new Set<FeldSchritt>();
        const ablehnen = (schritt: FeldSchritt, art: BefundSchritt["befund"], grund: string): void => {
            nurSnapshot.add(schritt);
            befunde.push({
                objektId: schritt.objekt.id,
                objektArt: "region",
                objektName: schritt.objekt.name,
                feld: "name",
                befund: art,
                grund,
            });
        };
        for (const schritt of namen) {
            if ((schritt.wirksam?.nachher ?? "").trim() === "")
                ablehnen(schritt, "name_leer", "Der Name wird nie geleert");
        }
        const frei = namen.filter((schritt) => !nurSnapshot.has(schritt));
        if (frei.length > 0) {
            const zeilen = await tx<{ id: string; name: string; layer: string; type: string | null }[]>`
                SELECT public_id::text AS id, name, region_layer AS layer, region_type AS type
                  FROM region WHERE public_id = ANY(${frei.map((schritt) => schritt.objekt.id)}::uuid[])
            `;
            const vonId = new Map(zeilen.map((zeile) => [zeile.id, zeile]));
            for (const schritt of frei) {
                const zeile = vonId.get(schritt.objekt.id);
                if (zeile !== undefined && isTerrainFrame({ name: zeile.name, layer: zeile.layer, type: zeile.type }))
                    ablehnen(schritt, "name_gesperrt", "Der Kontinent rahmt das Gelände: Sein Name bleibt");
            }
        }
        const bleibt = schritte.flatMap((schritt): FeldSchritt[] => {
            if (!nurSnapshot.has(schritt)) return [schritt];
            return schritt.schnappschuss === undefined
                ? []
                : [{ objekt: schritt.objekt, feld: schritt.feld, schnappschuss: schritt.schnappschuss }];
        });
        return { schritte: bleibt, befunde };
    },

    async schreibeObjekt(tx, id, spalten) {
        const namen = Object.keys(spalten);
        const [zeile] =
            namen.length === 0
                ? await tx<{ revision: number }[]>`
                      UPDATE region SET revision = revision WHERE public_id = ${id}::uuid AND is_active RETURNING revision::int AS revision
                  `
                : await tx<{ revision: number }[]>`
                      UPDATE region SET ${tx(spalten as Record<string, string | null>, ...namen)}, revision = revision
                       WHERE public_id = ${id}::uuid AND is_active RETURNING revision::int AS revision
                  `;
        if (zeile === undefined)
            throw new Error(`Landschaft ${id}: nicht zu schreiben (nicht gesperrt oder nicht aktiv)`);
        return zeile.revision;
    },

    schreibeSchnappschuss: (tx, schnappschussId, spalten) => schreibeLandschaftsStand(tx, schnappschussId, spalten),

    async folgen(tx, schritte) {
        const entries: MapAuditEntry[] = [];
        const affected: { kind: string; id: string; revision: number }[] = [];
        for (const schritt of schritte) {
            if (schritt.feld !== "name" || schritt.wirksam === undefined) continue;
            const alt = schritt.wirksam.vorher ?? "";
            const neu = schritt.wirksam.nachher ?? "";
            const labels = await tx<
                { id: string; public_id: string; revision: number; name: string; text_follows_name: boolean | null }[]
            >`
                SELECT l.id::text AS id, l.public_id::text AS public_id, l.revision::int AS revision, l.name, l.text_follows_name
                  FROM map_label l JOIN region r ON r.id = l.region_id
                 WHERE r.public_id = ${schritt.objekt.id}::uuid AND l.is_active
                 ORDER BY l.public_id
                   FOR NO KEY UPDATE OF l
            `;
            for (const label of labels) {
                // Der Text folgt dem Namen; ungefüllt folgt, wer bisher genau den alten Namen trug (wie `landscape-update.ts`).
                const folgt =
                    label.text_follows_name === true || (label.text_follows_name === null && label.name === alt);
                if (!folgt || label.name === neu) continue;
                const [danach] = await tx<{ revision: number }[]>`
                    UPDATE map_label SET name = ${neu} WHERE id = ${label.id}::bigint RETURNING revision::int AS revision
                `;
                entries.push({
                    action: "label.renamed",
                    regionId: schritt.objekt.id,
                    labelId: label.public_id,
                    revisionBefore: label.revision,
                    revisionAfter: danach!.revision,
                    changes: { text: { before: label.name, after: neu } },
                });
                affected.push({ kind: "label", id: label.public_id, revision: danach!.revision });
            }
        }
        return { entries, affected };
    },

    async folgenZuruecknehmen(tx, operationId) {
        const entries: MapAuditEntry[] = [];
        const affected: { kind: string; id: string; revision: number }[] = [];
        const befunde: BefundSchritt[] = [];
        const alte = await tx<
            { label: string; region: string | null; changes: { text?: { before?: unknown; after?: unknown } } }[]
        >`
            SELECT e.map_label_public_id::text AS label, e.region_public_id::text AS region, e.changes
              FROM map_audit_event e
             WHERE e.operation_id = ${operationId}::uuid AND e.action = 'label.renamed' AND e.map_label_public_id IS NOT NULL
             ORDER BY e.id
        `;
        for (const alt of alte) {
            const vorher = alt.changes.text?.before;
            const nachher = alt.changes.text?.after;
            if (typeof vorher !== "string" || typeof nachher !== "string") continue;
            const [label] = await tx<{ id: string; revision: number; name: string }[]>`
                SELECT id::text AS id, revision::int AS revision, name FROM map_label
                 WHERE public_id = ${alt.label}::uuid AND is_active FOR NO KEY UPDATE
            `;
            if (label === undefined || label.name !== nachher) {
                befunde.push({
                    objektId: alt.region ?? alt.label,
                    objektArt: "region",
                    objektName: null,
                    feld: "name",
                    befund: "seit_uebernahme_geaendert",
                    grund: "Die Beschriftung wurde seit der Übernahme geändert",
                });
                continue;
            }
            const [danach] = await tx<{ revision: number }[]>`
                UPDATE map_label SET name = ${vorher} WHERE id = ${label.id}::bigint RETURNING revision::int AS revision
            `;
            entries.push({
                action: "label.renamed",
                ...(alt.region === null ? {} : { regionId: alt.region }),
                labelId: alt.label,
                revisionBefore: label.revision,
                revisionAfter: danach!.revision,
                changes: { text: { before: nachher, after: vorher } },
            });
            affected.push({ kind: "label", id: alt.label, revision: danach!.revision });
        }
        return { entries, affected, befunde };
    },
};
