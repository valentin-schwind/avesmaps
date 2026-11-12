import { randomUUID } from "node:crypto";
import {
    LANDMARKEN_ORTSMERKMALE,
    landmarkenArtVorschlag,
    wikiLinkKey,
    type LandmarkenMerkmal,
    type OperationReceipt,
    type PlaceInLandmarkeBody,
    type PlaceInLandmarkeReceipt,
} from "@avesmaps3d/shared";
import type { Sql } from "../auth/session-store.ts";
import type { Database } from "../database.ts";
import { ApiError } from "../http/api-error.ts";
import { aktualisiereKanon } from "../inhalte/kanon-folgen.ts";
import { exactKey } from "../routing/topology.ts";
import { schreibeX2 } from "../wiki/objekt/anschluss.ts";
import { titelAusWikiAdresse } from "../wiki/vorschau/adresse.ts";
import { GIPFEL_ART } from "./gelaende-folgen.ts";
import { pruefeLinienSperre } from "./kraftlinien-schreiben.ts";
import { vorDemCutoff } from "./legacy-cutoff.ts";
import { mapOperation, type MapActor, type MapAuditEntry } from "./map-operation.ts";
import {
    domainOf,
    lockedPlace,
    pathEndsAt,
    pruefeFremdeOrtssperre,
    readPlace,
    verschiebeOrtIn,
    type PlaceRow,
} from "./place-edit.ts";
import { loescheOrt } from "./place-removal.ts";
import { pruefeStaetten } from "./place-removal-regeln.ts";
import { merkmaleGeordnet } from "./peak-update.ts";
import { UMWANDLUNG_OPERATION } from "./ruecknahme-arten.ts";

/**
 * „In Landmarke umwandeln …“ an einem Ort (WI-0271 L8, §7.3; Vali 2026-11-01 über die Editor-Orchestrierung): ein natürliches Bauwerk (Höhle, Wasserfall, Quelle …, heute `place` mit `subtype = 'gebaeude'`)
 * wird eine Landmarke, einzeln durch einen Editor, als EINE Operation `landmarke.umwandeln` mit vollem Vorher und Nachher. Rücknahme: `ruecknahme-umwandlung.ts`.
 *
 * 🔴 **Gesperrt bis zum Cutoff der Orte** (`vorDemCutoff`: die Kategorienliste in `ABGLEICHE`; 409 `vor_cutoff`, nichts geschrieben): Der Legacy-Zug brächte die Stätte sonst zurück, und die Landmarke stünde doppelt. Nur in Production; Stage und
 * lokal sind Testwelten. Stage: Der tägliche Zug belebt den Legacy-Ort und setzt die Bezüge zurück, die Testwelt legt die Landmarke still (`testwelt.ts`, Punkt 8).
 *
 * Was mitgeht und wie:
 * - **Lage, Name.** Die Art schlägt `landmarkenArtVorschlag` vor; der Editor ändert sie danach im Fenster der Landmarke, das sich öffnet.
 * - **Merkmale** (WI-0271 §17; Vali 2026-11-02): verborgen, Nodix, unterirdisch, entrückt und ungefähr gehen mit (`merkmaleAusOrt`). Ruine und Seehafen gibt es an einer Landmarke nicht: Sie bleiben am stillen Ort, ↺ bringt sie zurück.
 *   Ein Bauwerk mit Ruine oder Seehafen darf trotzdem umgewandelt werden; das Blatt sagt, was bleibt.
 * - **Kraftlinien** (§17): Ein Ende am Ort zeigt danach auf die Landmarke, auf der Karte und von ihr genommen, gelöschte nicht (wie `nodix.retire`). Je Abschnitt eine Zeile im Protokoll (`powerline.updated`); die Rücknahme hängt genau sie zurück. Die Lage bleibt, die Bahn auch.
 * - **Wegenden am Ort:** Die Wege hingen am Knoten des Orts (Kasten ±0,5, `routing/topology.ts`). Ohne Ort verbindet sie nur noch ein gemeinsamer Punkt auf fünf Stellen, ein technischer Knoten. Enden, die
 *   nicht schon dort liegen, rücken darum auf die Lage des Orts (`path.endpoint_moved`, derselbe Weg wie beim Verschieben). Ein einzelnes Ende bleibt liegen: Es verbindet nichts.
 * - **Wiki-Zuordnung:** Der Artikel hängt an der Landmarke (`address_only` und X2, wie ein gesetzter Kandidat, L7); den Wiki-Stand der Siedlung kann die Landmarke nicht tragen. Die Zeilen am Ort bleiben, wie beim
 *   Löschen; der Artikel steht trotzdem nicht unter „Nicht auf der Karte“ (`wiki-settlement-rows.ts`).
 * - **Quellen:** als Kopie an der Landmarke (`terrain_peak_source`), die Zeilen am Ort bleiben, wie beim Löschen; das Etikett rechnet neu.
 * - **Vorkommen und Abenteuer:** Die Treffer (`lore_place_target`) und Ortszeilen (`adventure_place`) zeigen auf die Landmarke. Ihre Kennungen stehen im Protokoll; die Rücknahme stellt genau sie zurück.
 * - **Verlauf und Bilder:** bleiben am Ort, die Landmarke liest sie über den Verweis (`terrain_peak_bezug`, Rolle `umgewandelt_aus`; `peakHistory`, `detail-peak.ts`).
 * - **Stätten** des Orts gehen still wie beim Löschen (`loescheOrt`) und kommen mit der Rücknahme zurück.
 *
 * Es bleibt am stillgelegten Ort: Einzelheiten (`place_detail`), Stadtpläne (`citymap_place`), Bewertungen, wie beim Löschen.
 *
 * 🔴 Abgewiesen (400, nichts geschrieben): ein innerorts-Punkt (`pruefeStaetten`), die Hauptstadt oder der Sitz eines Gebiets, ein Ort, der kein Bauwerk ist oder nicht auf der Karte steht.
 * Kein Massenlauf: Die Route nimmt genau einen Ort.
 */

/** Die Aktionen im Fachprotokoll, je Richtung und Gegenstand: Die Rücknahme liest an ihnen, was sie umkehrt. */
export const AKTION_ORT_UMGEWANDELT = "place.in_landmarke";
export const AKTION_ORT_ZURUECK = "place.aus_landmarke";
export const AKTION_LANDMARKE_UMGEWANDELT = "peak.aus_ort";
export const AKTION_LANDMARKE_ZURUECK = "peak.zum_ort";

/** Die Ortsart, die umgewandelt werden kann: Bauwerk. Welches Bauwerk natürlich ist, entscheidet der Editor (Festung und Höhle sind beide `gebaeude`). */
export const UMWANDELBARE_ORTSART = "gebaeude";

export const VOR_CUTOFF_SATZ =
    "Das geht erst nach dem Cutoff der Orte: Sonst brächte der Legacy-Zug den Ort zurück und die Landmarke stünde doppelt.";

/** Die Merkmale des Orts, die eine Landmarke tragen kann (`LANDMARKEN_ORTSMERKMALE`). Ruine und Seehafen nicht. */
export function merkmaleAusOrt(
    ort: Pick<PlaceRow, "is_hidden" | "is_nodix" | "is_underground" | "is_withdrawn" | "is_approximate">,
): LandmarkenMerkmal[] {
    return merkmaleGeordnet([
        ...(ort.is_hidden ? ["verborgen"] : []),
        ...(ort.is_nodix ? ["nodix"] : []),
        ...(ort.is_underground ? ["unterirdisch"] : []),
        ...(ort.is_withdrawn ? ["entrueckt"] : []),
        ...(ort.is_approximate ? ["ungefaehr"] : []),
    ]);
}

/** Die Merkmale einer Landmarke, die wieder aus einem Ort entsteht: was sie sonst trug, bleibt; die des Orts gelten vom Stand von jetzt. */
const mitMerkmalenDesOrts = (bisher: readonly string[], ausOrt: readonly string[]): LandmarkenMerkmal[] =>
    merkmaleGeordnet([...bisher.filter((m) => !(LANDMARKEN_ORTSMERKMALE as readonly string[]).includes(m)), ...ausOrt]);

/**
 * Die Enden der Kraftlinien vom Ort auf die Landmarke (WI-0271 §17). Dieselbe Lage: Die Bahn bleibt. Eine Linie, die gerade jemand bearbeitet, hält die Umwandlung an wie ein gesperrter Ort.
 */
async function haengeKraftlinienUm(
    tx: Sql,
    actor: MapActor,
    ortId: string,
    peakId: string,
): Promise<{ affected: OperationReceipt["affected"]; entries: MapAuditEntry[] }> {
    const linien = await tx<{ id: string; von: string; nach: string; revision: number }[]>`
        SELECT public_id::text AS id, from_public_id::text AS von, to_public_id::text AS nach, revision::int AS revision
          FROM powerline
         WHERE (is_active OR off_map) AND (from_public_id = ${ortId}::uuid OR to_public_id = ${ortId}::uuid)
         ORDER BY public_id
           FOR UPDATE
    `;
    if (linien.length === 0) return { affected: [], entries: [] };
    await pruefeLinienSperre(
        tx,
        actor,
        linien.map((linie) => linie.id),
    );
    const affected: OperationReceipt["affected"] = [];
    const entries: MapAuditEntry[] = [];
    for (const linie of linien) {
        const [neu] = await tx<{ revision: number }[]>`
            UPDATE powerline
               SET from_public_id = CASE WHEN from_public_id = ${ortId}::uuid THEN ${peakId}::uuid ELSE from_public_id END,
                   to_public_id = CASE WHEN to_public_id = ${ortId}::uuid THEN ${peakId}::uuid ELSE to_public_id END
             WHERE public_id = ${linie.id}::uuid
            RETURNING revision::int AS revision
        `;
        affected.push({ kind: "powerline", id: linie.id, revision: neu!.revision });
        entries.push({
            action: "powerline.updated",
            powerlineId: linie.id,
            revisionBefore: linie.revision,
            revisionAfter: neu!.revision,
            changes: {
                ...(linie.von === ortId ? { from: { before: ortId, after: peakId } } : {}),
                ...(linie.nach === ortId ? { to: { before: ortId, after: peakId } } : {}),
            },
        });
    }
    return { affected, entries };
}

/** Die Landmarke und ihr Verweis auf den Ort. Der Index `terrain_peak_bezug_einmal` hält nur aktive Zeilen, darum erst beleben, sonst anlegen. */
async function setzeVerweis(tx: Sql, peakId: string, ortId: string): Promise<void> {
    const belebt = await tx<{ id: string }[]>`
        UPDATE terrain_peak_bezug b SET is_active = TRUE, updated_at = now()
          FROM terrain_peak t
         WHERE t.id = b.terrain_peak_id AND t.public_id = ${peakId}::uuid
           AND b.ziel_art = 'place' AND b.ziel_public_id = ${ortId}::uuid AND b.rolle = 'umgewandelt_aus'
        RETURNING b.id::text AS id
    `;
    if (belebt.length > 0) return;
    await tx`
        INSERT INTO terrain_peak_bezug (terrain_peak_id, ziel_art, ziel_public_id, rolle)
        SELECT id, 'place', ${ortId}::uuid, 'umgewandelt_aus' FROM terrain_peak WHERE public_id = ${peakId}::uuid
    `;
}

/** Der Artikel des Orts an der Landmarke; `undefined`, wenn der Ort keinen hat. */
async function nimmArtikelMit(tx: Sql, row: PlaceRow, peakId: string): Promise<string | undefined> {
    const [artikel] = await tx<{ wiki_url: string; wiki_key: string | null; wiki_title: string | null }[]>`
        SELECT a.wiki_url, x.wiki_key, x.wiki_title
          FROM place_wiki_assignment a
          LEFT JOIN wiki_key_assignment x ON x.legacy_art = 'siedlung' AND x.object_public_id = ${row.public_id}::uuid AND x.is_active
         WHERE a.place_id = ${row.id}::bigint AND a.is_active AND a.wiki_url IS NOT NULL
           AND a.assignment_state IN ('assigned', 'address_only')
         LIMIT 1
    `;
    if (artikel === undefined) return undefined;
    await tx`
        INSERT INTO terrain_peak_wiki_assignment (terrain_peak_id, wiki_url, snapshot_id, assignment_state, assignment_origin, source_system, is_active)
        SELECT id, ${artikel.wiki_url}, NULL, 'address_only', 'editor', 'avesmaps3d', TRUE FROM terrain_peak WHERE public_id = ${peakId}::uuid
        ON CONFLICT (terrain_peak_id) DO UPDATE
           SET wiki_url = EXCLUDED.wiki_url, snapshot_id = NULL, assignment_state = 'address_only', assignment_origin = 'editor',
               is_active = TRUE, retired_at = NULL, retired_origin = NULL, updated_at = now()
    `;
    await schreibeX2(tx, "region", [peakId], {
        key: artikel.wiki_key ?? wikiLinkKey(artikel.wiki_url),
        url: artikel.wiki_url,
        name: artikel.wiki_title ?? titelAusWikiAdresse(artikel.wiki_url),
    });
    return artikel.wiki_url;
}

/** Die Quellen des Orts als Kopie an der Landmarke; liefert die Kennungen der Quellen fürs Protokoll. Eine schon einmal kopierte Zeile lebt wieder auf (die Rücknahme der Rücknahme). */
async function kopiereQuellen(tx: Sql, row: PlaceRow, peakId: string): Promise<string[]> {
    const zeilen = await tx<{ source_id: string }[]>`
        INSERT INTO terrain_peak_source (terrain_peak_id, source_id, reference_kind, pages, note, legacy_origin, position, source_system)
        SELECT t.id, s.source_id, s.reference_kind, s.pages, s.note, s.legacy_origin, s.position, 'editor'
          FROM place_source s, terrain_peak t
         WHERE s.place_id = ${row.id}::bigint AND s.is_active AND t.public_id = ${peakId}::uuid
        ON CONFLICT (terrain_peak_id, source_id) DO UPDATE
           SET reference_kind = EXCLUDED.reference_kind, pages = EXCLUDED.pages, note = EXCLUDED.note, position = EXCLUDED.position,
               state = 'active', is_active = TRUE, retired_at = NULL, retired_origin = NULL, updated_at = now()
        RETURNING source_id::text AS source_id
    `;
    return zeilen.map((zeile) => zeile.source_id).sort();
}

/** Die Bezüge, die auf den Ort zeigen, zeigen danach auf die Landmarke. Die Treffer der Vorkommen ändert die App nicht, sie ersetzt sie (`map-grants.psql`). */
async function haengeBezuegeUm(
    tx: Sql,
    row: PlaceRow,
    peakId: string,
): Promise<{ vorkommen: string[]; abenteuer: string[] }> {
    const vorkommen = await tx<{ lore_place_id: string }[]>`
        WITH weg AS (DELETE FROM lore_place_target WHERE place_id = ${row.id}::bigint RETURNING lore_place_id)
        INSERT INTO lore_place_target (lore_place_id, terrain_peak_id)
        SELECT weg.lore_place_id, t.id FROM weg, terrain_peak t WHERE t.public_id = ${peakId}::uuid
        RETURNING lore_place_id::text AS lore_place_id
    `;
    const abenteuer = await tx<{ id: string }[]>`
        UPDATE adventure_place a SET place_id = NULL, terrain_peak_id = t.id, updated_at = now()
          FROM terrain_peak t
         WHERE t.public_id = ${peakId}::uuid AND a.place_id = ${row.id}::bigint AND a.is_active
        RETURNING a.id::text AS id
    `;
    return {
        vorkommen: vorkommen.map((zeile) => zeile.lore_place_id).sort(),
        abenteuer: abenteuer.map((zeile) => zeile.id).sort(),
    };
}

/**
 * Die Umwandlung an EINEM gesperrten Ort, in der Transaktion einer Operation: das Umwandeln selbst und die Rücknahme einer Rücknahme (`ziel.neu` falsch: dieselbe Landmarke lebt wieder auf). Was am Ort hängt,
 * liest sie vom Stand von jetzt; die Kennungen stehen danach im Protokoll.
 */
export async function schreibeUmwandlung(
    tx: Sql,
    actor: MapActor,
    ausgang: PlaceRow,
    ziel: { peakId: string; neu: boolean },
    umgebung: NodeJS.ProcessEnv = process.env,
): Promise<{
    receipt: Pick<OperationReceipt, "affected" | "derivedWork" | "warnings">;
    summary: string;
    entries: MapAuditEntry[];
    art: string;
    name: string;
}> {
    if (ausgang.unplaced || !ausgang.is_active || ausgang.x === null || ausgang.y === null)
        throw new ApiError(400, "validation_failed", "Nur ein Ort auf der Karte lässt sich umwandeln.");
    if (ausgang.subtype !== UMWANDELBARE_ORTSART)
        throw new ApiError(400, "validation_failed", "Nur ein Bauwerk lässt sich in eine Landmarke umwandeln.", {
            field: "subtype",
        });
    if (vorDemCutoff(actor.environment, umgebung, "orte"))
        throw new ApiError(409, "vor_cutoff", VOR_CUTOFF_SATZ, { kategorie: "orte" });
    await pruefeStaetten(tx, ausgang, "loeschen", undefined);
    const gebiete = await tx<{ name: string }[]>`
        SELECT name FROM territory
         WHERE is_active AND (capital_place_public_id = ${ausgang.public_id}::uuid OR seat_place_public_id = ${ausgang.public_id}::uuid)
         ORDER BY name
    `;
    if (gebiete.length > 0)
        throw new ApiError(
            400,
            "validation_failed",
            `${ausgang.name} ist Hauptstadt oder Sitz von ${gebiete.map((gebiet) => gebiet.name).join(", ")}. Erst das Gebiet ändern.`,
            { field: "gebiete" },
        );
    const { x, y } = ausgang;

    // Die Wegenden auf EINEN Punkt: Nur so bleiben sie ohne den Ort verbunden. Ein einzelnes Ende verbindet nichts und bleibt.
    const enden = await pathEndsAt(tx, ausgang);
    const abweichend = enden.length < 2 ? [] : enden.filter((ende) => exactKey(ende.x, ende.y) !== exactKey(x, y));
    const wegEintraege: MapAuditEntry[] = [];
    const wegBetroffen: OperationReceipt["affected"] = [];
    let row = ausgang;
    if (abweichend.length > 0) {
        const verschoben = await verschiebeOrtIn(
            tx,
            ausgang,
            {
                baseRevision: ausgang.revision,
                to: { x, y },
                pathEnds: abweichend.map((ende) => ({
                    pathId: ende.pathId,
                    end: ende.end,
                    baseRevision: ende.revision,
                    to: { x, y },
                })),
            },
            enden,
        );
        wegEintraege.push(...verschoben.entries.filter((eintrag) => eintrag.action !== "place.moved"));
        wegBetroffen.push(...verschoben.receipt.affected.filter((gegenstand) => gegenstand.kind !== "place"));
        row = (await readPlace(tx, ausgang.public_id, true)) ?? ausgang;
    }

    // Die Landmarke: neu, oder dieselbe wieder (die Rücknahme der Rücknahme; Name und Art, wie sie zuletzt waren).
    const vorschlag = landmarkenArtVorschlag(row.name, row.place_kind);
    const ausOrt = merkmaleAusOrt(row);
    const [bisher] = ziel.neu
        ? []
        : await tx<{ merkmale: string[] }[]>`SELECT merkmale FROM terrain_peak WHERE public_id = ${ziel.peakId}::uuid`;
    const merkmale = mitMerkmalenDesOrts(bisher?.merkmale ?? [], ausOrt);
    const [landmarke] = ziel.neu
        ? await tx<{ revision: number; name: string; subtype: string; show_name: boolean }[]>`
              INSERT INTO terrain_peak (public_id, map_domain_id, name, subtype, merkmale, show_name, geom, source_system, is_active)
              VALUES (${ziel.peakId}::uuid, ${row.map_domain_id}, ${row.name}, ${vorschlag}, ${merkmale}::text[], TRUE,
                      ST_SetSRID(ST_MakePoint(${x}, ${y}), 0), 'avesmaps3d', TRUE)
              RETURNING revision::int AS revision, name, subtype, show_name
          `
        : await tx<{ revision: number; name: string; subtype: string; show_name: boolean }[]>`
              UPDATE terrain_peak SET is_active = TRUE, merkmale = ${merkmale}::text[] WHERE public_id = ${ziel.peakId}::uuid AND NOT is_active
              RETURNING revision::int AS revision, name, subtype, show_name
          `;
    if (landmarke === undefined) throw new ApiError(404, "not_found", "Diese Landmarke gibt es nicht (mehr).");

    const wiki = await nimmArtikelMit(tx, row, ziel.peakId);
    const quellen = await kopiereQuellen(tx, row, ziel.peakId);
    if (quellen.length > 0) await aktualisiereKanon(tx, { peak: new Set([ziel.peakId]) });
    const bezuege = await haengeBezuegeUm(tx, row, ziel.peakId);
    const kraftlinien = await haengeKraftlinienUm(tx, actor, row.public_id, ziel.peakId);
    await setzeVerweis(tx, ziel.peakId, row.public_id);

    // Der Ort still wie beim Löschen, samt seiner Stätten; die Aktion sagt der Rücknahme, wohin er gehört.
    const still = await loescheOrt(tx, row);
    const ortEintrag: MapAuditEntry = {
        ...still.entry,
        action: AKTION_ORT_UMGEWANDELT,
        revisionBefore: ausgang.revision,
        changes: {
            ...still.entry.changes,
            landmarke: { before: null, after: ziel.peakId },
            ...(bezuege.vorkommen.length > 0 ? { vorkommen: { before: bezuege.vorkommen, after: [] } } : {}),
            ...(bezuege.abenteuer.length > 0 ? { abenteuer: { before: bezuege.abenteuer, after: [] } } : {}),
        },
    };
    const landmarkeEintrag: MapAuditEntry = {
        action: AKTION_LANDMARKE_UMGEWANDELT,
        peakId: ziel.peakId,
        revisionBefore: null,
        revisionAfter: landmarke.revision,
        changes: {
            name: { after: landmarke.name },
            subtype: { after: landmarke.subtype },
            ...(merkmale.length > 0 ? { merkmale: { after: merkmale } } : {}),
            showName: { after: landmarke.show_name },
            position: { after: [x, y] },
            active: { before: false, after: true },
            ausOrt: { after: row.public_id },
            ...(wiki === undefined ? {} : { wiki: { after: wiki } }),
            ...(quellen.length > 0 ? { quellen: { after: quellen } } : {}),
        },
    };
    return {
        receipt: {
            affected: [
                { kind: "place", id: row.public_id, revision: still.revision },
                { kind: GIPFEL_ART, id: ziel.peakId, revision: landmarke.revision },
                ...wegBetroffen,
                ...kraftlinien.affected,
            ],
            derivedWork: [{ kind: "routing", state: "pending" }],
            warnings: [],
        },
        summary: `${row.name}: in eine Landmarke umgewandelt`,
        entries: [ortEintrag, landmarkeEintrag, ...wegEintraege, ...kraftlinien.entries],
        art: landmarke.subtype,
        name: landmarke.name,
    };
}

/** `POST /api/editor/places/:id/in-landmarke`: EIN Ort, EINE Operation. */
export async function wandleOrtInLandmarke(
    database: Database,
    actor: MapActor,
    publicId: string,
    body: PlaceInLandmarkeBody,
    umgebung: NodeJS.ProcessEnv = process.env,
): Promise<PlaceInLandmarkeReceipt> {
    const domain = await domainOf(database, publicId);
    const peakId = randomUUID();
    const quittung = await mapOperation(
        database,
        actor,
        {
            operationId: body.operationId,
            operation: UMWANDLUNG_OPERATION,
            mapDomainId: domain,
            body: { publicId, ...body },
        },
        async (tx) => {
            await pruefeFremdeOrtssperre(tx, actor, [publicId]);
            const row = await lockedPlace(tx, publicId, body.baseRevision);
            const { receipt, summary, entries } = await schreibeUmwandlung(
                tx,
                actor,
                row,
                { peakId, neu: true },
                umgebung,
            );
            return { receipt, summary, entries };
        },
    );
    // Eine wiederholte Kennung bekommt die erste Quittung: Ihre Landmarke ist die aus der Quittung.
    const angelegt = quittung.affected.find((gegenstand) => gegenstand.kind === GIPFEL_ART)?.id ?? peakId;
    const [zeile] = await database<{ name: string; subtype: string }[]>`
        SELECT name, subtype FROM terrain_peak WHERE public_id = ${angelegt}::uuid
    `;
    return { ...quittung, peakId: angelegt, name: zeile?.name ?? "", subtype: zeile?.subtype ?? "" };
}
