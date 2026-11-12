import { randomUUID } from "node:crypto";
import {
    SPRACHE_NEUE_FARBE,
    SPRACHE_POLYGONE_MAX,
    SPRACHE_RING_MAX,
    landscapeBooleanConsumesTarget,
    type LandscapeBooleanOperation,
    type LandscapePartsOperation,
    type OperationReceipt,
    type SpracheAusLandschaftBody,
    type SpracheFlaecheBooleanBody,
    type SpracheFlaecheBooleanVorschau,
    type SpracheFlaecheBooleanVorschauBody,
    type SpracheFlaecheKopierenBody,
    type SpracheFlaecheNeuQuittung,
    type SpracheFlaecheSchneidenBody,
    type SpracheFlaecheTeileBody,
    type SpracheFlaecheTeileQuittung,
} from "@avesmaps3d/shared";
import type { Sql } from "../auth/session-store.ts";
import type { Database, Queryable } from "../database.ts";
import { pruefeVerknuepfung, rechneTeile, schneide, verknuepfung } from "../editor/flaechen-rechnung.ts";
import { mapOperation, type MapActor, type MapAuditEntry, type MapChange } from "../editor/map-operation.ts";
import { mapEditConflict } from "../editor/place-edit.ts";
import { polygoneVon, ringe, type Punkt } from "../editor/ring-form.ts";
import { ApiError } from "../http/api-error.ts";
import {
    SPRACHE_ART,
    SPRACHEN_DOMAENE,
    SPRACHFLAECHE_ART,
    flaechenStand,
    pruefeFremdeSprachSperre,
    ungueltig,
    verlangeSprachSperre,
} from "./editor-naht.ts";
import { farbeVon, legeSpracheAnIn, nameVon } from "./editor-schreiben.ts";
import {
    flaecheZumSchreiben,
    geometrie,
    leseFlaeche,
    leseFlaechenGesperrt,
    type FlaechenZeile,
} from "./editor-flaechen.ts";

/**
 * Die Werkzeuge der Stufe 3 an den Teilflächen einer Sprache (WI-0261; Betreiber 2026-10-31, wörtlich: „beim editieren der sprachflächen wär es gut, wenn wir
 * die tools des flächeneditors hätten“, danach „bau weiter“; Vertrag im Kopf von `packages/shared/src/sprachen-editor.ts`): „Unterflächen ›“
 * (`sprache_flaeche.parts`), „Zerschneiden“ (`.split`), „Mit anderer Fläche ›“ (`.boolean`, Vorschau ohne Schreiben) und „Kopieren …“ (`.copy`).
 *
 * - **Dieselbe Rechnung wie die Derographie** (`editor/flaechen-rechnung.ts`, EDIT-0003 G1); hier stehen nur Besitz, Sperren, Schreiben und Protokoll der Sprache.
 * - **EINE Operation, sofort geschrieben** (Ausnahme von EDIT-0003 G4 wie an der Landschaft, Editor-Orchestrierung 2026-10-31): auch über mehrere Teilflächen
 *   und zwei Sprachen nur ein Eintrag in `map_operation`.
 * - 🔴 **Das Fachprotokoll trägt JEDE betroffene Teilfläche mit ihrer ganzen Form** (Editor-Orchestrierung 2026-10-31, für die Rücknahme als Ganzes, WI-0265):
 *   eine geänderte vorher und nachher (`changes.geometry`), eine neue nur nachher, eine stillgelegte nur vorher (dazu `active`).
 * - **Herkunft** (T-1): Eine Quelle, deren Form sich ändert, und jede neue Teilfläche sind danach Flächen der Redaktion (`herkunft = redaktion`, ohne
 *   `quelle_revision`), damit ein späterer Import der Sprachenkarte sie in Ruhe lässt. Stillgelegt wird mit `retired_origin = editor` (zurückholbar).
 * - **Sperren:** die Sprache der Quelle wird verlangt (`verlangeSprachSperre`), die andere Sprache auch, wenn die Operation an ihr etwas ändert (ihre
 *   Teilfläche stilllegen, ihr eine Kopie anlegen); bleibt sie unberührt, darf nur kein anderer sie halten (wie die Landschaft, `pruefeFremdeSperre`).
 * - **Grenzen** wie beim Umformen: höchstens `SPRACHE_POLYGONE_MAX` Polygone und `SPRACHE_RING_MAX` Ecken je Teilfläche, sonst ließe sie sich danach nicht
 *   mehr bearbeiten (400).
 * - **Folgen:** Jede berührte Sprache steht unter `affected`; die Schreibnaht reiht darauf `sprache_treffer` ein und meldet `map.changed`.
 */

const WORT_TEILE: Record<LandscapePartsOperation, string> = {
    vereinigen: "Unterflächen vereinigt",
    herausloesen: "Unterfläche herausgelöst",
    loeschen: "Unterfläche gelöscht",
};

/** So heißt die Operation „Mit anderer Fläche“ im Verlauf (die Wörter des Menüs, wie an der Landschaft). */
const WORT_ANDERE: Record<LandscapeBooleanOperation, string> = {
    vereinigen: "mit anderer vereinigt",
    "vereinigen-behalten": "mit anderer vereinigt, andere beibehalten",
    ausschneiden: "von anderer ausgeschnitten",
    "ausschneiden-behalten": "von anderer ausgeschnitten, andere beibehalten",
    schnittmenge: "neu von anderer ausgeschnitten",
};

const nichtHier = (): ApiError => new ApiError(404, "not_found", "Diese Teilfläche gibt es an dieser Sprache nicht.");

/** Ein Ergebnis muss sich danach noch bearbeiten lassen wie eine umgeformte Teilfläche (`SprachePolygone`, `formAus`). */
function pruefeGrenzen(polygone: readonly (readonly (readonly Punkt[])[])[]): void {
    if (polygone.length > SPRACHE_POLYGONE_MAX)
        throw ungueltig(`Eine Teilfläche hat höchstens ${String(SPRACHE_POLYGONE_MAX)} Polygone.`, {
            field: "polygons",
        });
    if (polygone.flat(2).length > SPRACHE_RING_MAX)
        throw ungueltig(`Eine Teilfläche hat höchstens ${String(SPRACHE_RING_MAX)} Ecken.`, { field: "polygons" });
}

/** Die Teilfläche vor der Transaktion: sie muss zu dieser Sprache gehören (404). */
async function vorab(database: Database, spracheId: string, flaecheId: string): Promise<FlaechenZeile> {
    const zeile = await leseFlaeche(database, flaecheId, false);
    if (zeile === undefined || zeile.sprache_public_id !== spracheId) throw nichtHier();
    return zeile;
}

/** Die Quelle in der Transaktion: gesperrt, gegen ihre Revision, aktiv, mit der Sperre ihrer Sprache. */
async function quelleZumSchreiben(
    tx: Sql,
    actor: MapActor,
    spracheId: string,
    flaecheId: string,
    baseRevision: number,
): Promise<FlaechenZeile> {
    const zeile = await flaecheZumSchreiben(tx, spracheId, flaecheId, baseRevision);
    if (!zeile.is_active)
        throw ungueltig("Diese Teilfläche ist stillgelegt; erst zurückholen, dann ändern.", { field: "state" });
    await verlangeSprachSperre(tx, actor, spracheId);
    return zeile;
}

/** Die Zeilen, die eine Operation schreibt: Quittung (`affected`) und Fachprotokoll (`entries`). */
interface Buch {
    readonly affected: OperationReceipt["affected"];
    readonly entries: MapAuditEntry[];
}

const nenneSprache = (buch: Buch, zeile: Pick<FlaechenZeile, "sprache_public_id" | "sprache_revision">): void => {
    if (!buch.affected.some((x) => x.kind === SPRACHE_ART && x.id === zeile.sprache_public_id))
        buch.affected.push({ kind: SPRACHE_ART, id: zeile.sprache_public_id, revision: zeile.sprache_revision });
};

/** Die neue Form einer Teilfläche (die Quelle): Sie wird eine der Redaktion (T-1). Protokoll mit der ganzen Form vorher und nachher. */
async function formeUm(tx: Sql, buch: Buch, zeile: FlaechenZeile, neu: Punkt[][][], aktion: string): Promise<void> {
    pruefeGrenzen(neu);
    const [geschrieben] = await tx<{ revision: number }[]>`
        UPDATE sprache_flaeche
           SET geom = ${geometrie(tx, neu)}, herkunft = 'redaktion', quelle_revision = NULL
         WHERE id = ${zeile.id}::bigint AND revision = ${zeile.revision}
        RETURNING revision::int AS revision
    `;
    if (geschrieben === undefined)
        throw await mapEditConflict(
            tx,
            { kind: "sprache_flaeche", publicId: zeile.public_id },
            { revision: zeile.revision, changedAt: zeile.updated_at },
        );
    const changes: Record<string, MapChange> = {
        geometry: { before: ringe(polygoneVon(zeile.geojson)), after: ringe(neu) },
    };
    if (zeile.herkunft !== "redaktion") changes["herkunft"] = { before: zeile.herkunft, after: "redaktion" };
    if (zeile.quelle_revision !== null) changes["quelleRevision"] = { before: zeile.quelle_revision, after: null };
    nenneSprache(buch, zeile);
    buch.affected.push({ kind: SPRACHFLAECHE_ART, id: zeile.public_id, revision: geschrieben.revision });
    buch.entries.push({
        action: `sprache_flaeche.${aktion}`,
        spracheId: zeile.sprache_public_id,
        spracheFlaecheId: zeile.public_id,
        revisionBefore: zeile.revision,
        revisionAfter: geschrieben.revision,
        changes,
    });
}

/** Eine neue Teilfläche der Redaktion an dieser Sprache; Protokoll mit der ganzen Form nachher (vorher keine). Gibt ihre Kennung zurück. */
async function legeAn(
    tx: Sql,
    buch: Buch,
    sprache: Pick<FlaechenZeile, "sprache_id" | "sprache_public_id" | "sprache_revision" | "map_domain_id">,
    polygone: Punkt[][][],
    aktion: "created" | "copied",
    /** Weitere Felder des Protokolls (die Quelle aus der Derographie, `kopiertAus`). */
    mehr: Record<string, MapChange> = {},
): Promise<string> {
    pruefeGrenzen(polygone);
    const publicId = randomUUID();
    const [neu] = await tx<{ revision: number }[]>`
        INSERT INTO sprache_flaeche (public_id, sprache_id, map_domain_id, geom, herkunft, quelle_revision)
        VALUES (${publicId}::uuid, ${sprache.sprache_id}::bigint, ${sprache.map_domain_id}, ${geometrie(tx, polygone)},
                'redaktion', NULL)
        RETURNING revision::int AS revision
    `;
    nenneSprache(buch, sprache);
    buch.affected.push({ kind: SPRACHFLAECHE_ART, id: publicId, revision: neu!.revision });
    buch.entries.push({
        action: `sprache_flaeche.${aktion}`,
        spracheId: sprache.sprache_public_id,
        spracheFlaecheId: publicId,
        revisionBefore: null,
        revisionAfter: neu!.revision,
        changes: {
            geometry: { after: ringe(polygone) },
            herkunft: { after: "redaktion" },
            active: { after: true },
            ...mehr,
        },
    });
    return publicId;
}

/** Eine Teilfläche stilllegen (`retired_origin = editor`, zurückholbar); Protokoll mit der ganzen Form vorher (nachher keine). */
async function legeStill(tx: Sql, buch: Buch, zeile: FlaechenZeile): Promise<void> {
    const [weg] = await tx<{ revision: number }[]>`
        UPDATE sprache_flaeche SET ${flaechenStand(tx, false)}
         WHERE id = ${zeile.id}::bigint
        RETURNING revision::int AS revision
    `;
    nenneSprache(buch, zeile);
    buch.affected.push({ kind: SPRACHFLAECHE_ART, id: zeile.public_id, revision: weg!.revision });
    buch.entries.push({
        action: "sprache_flaeche.retired",
        spracheId: zeile.sprache_public_id,
        spracheFlaecheId: zeile.public_id,
        revisionBefore: zeile.revision,
        revisionAfter: weg!.revision,
        changes: { active: { before: true, after: false }, geometry: { before: ringe(polygoneVon(zeile.geojson)) } },
    });
}

/** Die neue Teilfläche einer Quittung, auch bei einer wiederholten Kennung (dann kommt die erste Quittung): die eine Teilfläche außer der Quelle. */
const neueAus = (quittung: OperationReceipt, quelle: string): string | undefined =>
    quittung.affected.find((x) => x.kind === SPRACHFLAECHE_ART && x.id !== quelle)?.id;

// ---------------------------------------------------------------------------------------------------------------------
// „Unterflächen ›“
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Die aktiven Teilflächen derselben Sprache, die mit der Quelle zusammenhängen (sich berühren oder überlappen, auch über andere hinweg; `ST_ClusterDBSCAN`
 * mit Abstand 0), ohne die Quelle, gesperrt.
 */
async function zusammenhaengende(tx: Sql, quelle: FlaechenZeile): Promise<FlaechenZeile[]> {
    const ids = await tx<{ id: string }[]>`
        WITH c AS (
            SELECT id, ST_ClusterDBSCAN(geom, 0, 1) OVER () AS k
              FROM sprache_flaeche WHERE sprache_id = ${quelle.sprache_id}::bigint AND is_active
        )
        SELECT id::text FROM c WHERE k = (SELECT k FROM c WHERE id = ${quelle.id}::bigint) AND id <> ${quelle.id}::bigint
    `;
    return leseFlaechenGesperrt(
        tx,
        ids.map((zeile) => zeile.id),
    );
}

/**
 * `sprache_flaeche.parts` (`POST …/flaechen/:flaeche/parts`): „vereinigen“ verschmilzt die Teilfläche mit den Teilflächen derselben Sprache, die mit ihr
 * zusammenhängen, zu EINER (die übrigen gehen in ihr auf und werden stillgelegt); „herausloesen“ macht den gewählten Teil zu einer eigenen Teilfläche derselben
 * Sprache; „loeschen“ nimmt ihn weg. Rechnung und Sätze wie an der Landschaft (`rechneTeile`).
 */
export async function teileSprachflaeche(
    database: Database,
    actor: MapActor,
    spracheId: string,
    flaecheId: string,
    body: SpracheFlaecheTeileBody,
): Promise<SpracheFlaecheTeileQuittung> {
    const zeile = await vorab(database, spracheId, flaecheId);
    if (body.operation !== "vereinigen" && body.part === undefined)
        throw ungueltig("Welche Unterfläche? Bitte eine anklicken.", { field: "part" });
    let zahlen: { partsBefore: number; partsAfter: number } | undefined;
    const quittung = await mapOperation(
        database,
        actor,
        {
            operationId: body.operationId,
            operation: "sprache_flaeche.parts",
            mapDomainId: zeile.map_domain_id,
            body: { spracheId, flaecheId, ...body },
        },
        async (tx) => {
            const quelle = await quelleZumSchreiben(tx, actor, spracheId, flaecheId, body.baseRevision);
            const mit = body.operation === "vereinigen" ? await zusammenhaengende(tx, quelle) : [];
            const ids = [quelle.id, ...mit.map((andere) => andere.id)];
            const r = await rechneTeile(
                tx,
                mit.length === 0
                    ? tx`SELECT geom FROM sprache_flaeche WHERE id = ${quelle.id}::bigint`
                    : tx`SELECT ST_Multi(ST_CollectionExtract(ST_Collect(geom ORDER BY id <> ${quelle.id}::bigint, id), 3)) AS geom
                           FROM sprache_flaeche WHERE id = ANY(${ids}::bigint[])`,
                body.operation,
                body.part,
            );
            zahlen = { partsBefore: r.teile, partsAfter: r.rest_teile };
            const buch: Buch = { affected: [], entries: [] };
            await formeUm(tx, buch, quelle, polygoneVon(r.rest), "parts");
            for (const andere of mit) await legeStill(tx, buch, andere);
            if (body.operation === "herausloesen") await legeAn(tx, buch, quelle, polygoneVon(r.stueck!), "created");
            let summary = `Sprache „${quelle.sprache_name}“: ${WORT_TEILE[body.operation]}`;
            if (body.operation === "vereinigen") summary += ` (${String(r.teile)} → ${String(r.rest_teile)})`;
            if (body.operation === "herausloesen") summary += " als eigene Teilfläche";
            return {
                receipt: { affected: buch.affected, derivedWork: [], warnings: [] },
                summary,
                entries: buch.entries,
            };
        },
    );
    const neu = body.operation === "herausloesen" ? neueAus(quittung, flaecheId) : undefined;
    return { ...quittung, ...(zahlen ?? {}), ...(neu === undefined ? {} : { flaecheId: neu }) };
}

// ---------------------------------------------------------------------------------------------------------------------
// „Zerschneiden“
// ---------------------------------------------------------------------------------------------------------------------

/**
 * `sprache_flaeche.split` (`POST …/flaechen/:flaeche/split`): die Schnittlinie teilt exakt (`schneide`, wie an der Landschaft); das größte Stück jedes
 * geschnittenen Teils bleibt, die übrigen werden EINE neue Teilfläche derselben Sprache.
 */
export async function schneideSprachflaeche(
    database: Database,
    actor: MapActor,
    spracheId: string,
    flaecheId: string,
    body: SpracheFlaecheSchneidenBody,
): Promise<SpracheFlaecheNeuQuittung> {
    const zeile = await vorab(database, spracheId, flaecheId);
    const quittung = await mapOperation(
        database,
        actor,
        {
            operationId: body.operationId,
            operation: "sprache_flaeche.split",
            mapDomainId: zeile.map_domain_id,
            body: { spracheId, flaecheId, ...body },
        },
        async (tx) => {
            const quelle = await quelleZumSchreiben(tx, actor, spracheId, flaecheId, body.baseRevision);
            const r = await schneide(
                tx,
                tx`SELECT geom FROM sprache_flaeche WHERE id = ${quelle.id}::bigint`,
                body.line,
            );
            const buch: Buch = { affected: [], entries: [] };
            await formeUm(tx, buch, quelle, polygoneVon(r.bleibt), "split");
            await legeAn(tx, buch, quelle, polygoneVon(r.geht), "created");
            return {
                receipt: { affected: buch.affected, derivedWork: [], warnings: [] },
                summary: `Sprache „${quelle.sprache_name}“: zerschnitten, das Stück als eigene Teilfläche`,
                entries: buch.entries,
            };
        },
    );
    const neu = neueAus(quittung, flaecheId);
    return { ...quittung, ...(neu === undefined ? {} : { flaecheId: neu }) };
}

// ---------------------------------------------------------------------------------------------------------------------
// „Mit anderer Fläche ›“
// ---------------------------------------------------------------------------------------------------------------------

interface Paar {
    quelle_sprache: string;
    ziel_sprache: string;
    ziel_name: string;
    quelle_revision: number;
    ziel_revision: number;
    ziel_geojson: string;
    quelle_aktiv: boolean;
    ziel_aktiv: boolean;
    gleiche_karte: boolean;
    ergebnis: string | null;
    f_quelle: number;
    f_ziel: number;
    f_ergebnis: number;
}

interface SprachRechnung {
    readonly polygone: Punkt[][][];
    readonly zielPolygone: Punkt[][][];
    readonly quelleSprache: string;
    readonly zielName: string;
    readonly quelleRevision: number;
    readonly zielRevision: number;
}

/** Rechnet die neue Form der Quelle mit der Teilfläche einer ANDEREN Sprache (`verknuepfung`, wie an der Landschaft); 404 ohne beide, 400 sonst. */
async function rechneMitAnderer(
    sql: Queryable,
    operation: LandscapeBooleanOperation,
    flaecheId: string,
    zielId: string,
): Promise<SprachRechnung> {
    if (flaecheId === zielId) throw ungueltig("Bitte eine andere Fläche wählen.", { field: "targetAreaId" });
    const [paar] = await sql<Paar[]>`
        WITH q AS (
            SELECT f.geom, f.is_active AND s.is_active AS aktiv, f.map_domain_id, s.public_id::text AS sprache, f.revision
              FROM sprache_flaeche f JOIN sprache s ON s.id = f.sprache_id
             WHERE f.public_id = ${flaecheId}::uuid
        ), z AS (
            SELECT f.geom, f.is_active AND s.is_active AS aktiv, f.map_domain_id, s.public_id::text AS sprache, f.revision, s.name
              FROM sprache_flaeche f JOIN sprache s ON s.id = f.sprache_id
             WHERE f.public_id = ${zielId}::uuid
        ), e AS (
            SELECT ${verknuepfung(sql, operation)} AS geom FROM q, z
        )
        SELECT q.sprache AS quelle_sprache, z.sprache AS ziel_sprache, z.name AS ziel_name, q.revision::int AS quelle_revision,
               z.revision::int AS ziel_revision, ST_AsGeoJSON(z.geom, 15) AS ziel_geojson,
               q.aktiv AS quelle_aktiv, z.aktiv AS ziel_aktiv, q.map_domain_id = z.map_domain_id AS gleiche_karte,
               CASE WHEN ST_IsEmpty(e.geom) THEN NULL ELSE ST_AsGeoJSON(e.geom, 15) END AS ergebnis,
               ST_Area(q.geom) AS f_quelle, ST_Area(z.geom) AS f_ziel, ST_Area(e.geom) AS f_ergebnis
          FROM q, z, e
    `;
    if (paar === undefined || !paar.quelle_aktiv || !paar.ziel_aktiv)
        throw new ApiError(404, "not_found", "Eine der beiden Flächen gibt es nicht mehr.");
    if (!paar.gleiche_karte) throw ungueltig("Die andere Fläche liegt auf einer anderen Karte.");
    // Ziele sind nur Teilflächen ANDERER Sprachen (Editor-Orchestrierung 2026-10-31); Teilflächen derselben Sprache fasst „Unterflächen ›“ zusammen.
    if (paar.quelle_sprache === paar.ziel_sprache)
        throw ungueltig("Bitte die Teilfläche einer anderen Sprache wählen.", { field: "targetAreaId" });
    const flaechen = { ergebnis: paar.ergebnis, quelle: paar.f_quelle, ziel: paar.f_ziel, neu: paar.f_ergebnis };
    pruefeVerknuepfung(operation, flaechen);
    const polygone = polygoneVon(flaechen.ergebnis);
    pruefeGrenzen(polygone);
    return {
        polygone,
        zielPolygone: polygoneVon(paar.ziel_geojson),
        quelleSprache: paar.quelle_sprache,
        zielName: paar.ziel_name,
        quelleRevision: paar.quelle_revision,
        zielRevision: paar.ziel_revision,
    };
}

/** Die Vorschau (`POST …/flaechen/:flaeche/boolean-preview`): rechnet, schreibt nichts, braucht keine Sperre. */
export async function vorschauSprachflaechen(
    database: Database,
    spracheId: string,
    flaecheId: string,
    body: SpracheFlaecheBooleanVorschauBody,
): Promise<SpracheFlaecheBooleanVorschau> {
    const rechnung = await rechneMitAnderer(database, body.operation, flaecheId, body.targetAreaId);
    if (rechnung.quelleSprache !== spracheId) throw nichtHier();
    const alsListe = (polygone: Punkt[][][]): [number, number][][][] =>
        polygone.map((polygon) => polygon.map((ring) => ring.map(([x, y]) => [x, y])));
    return {
        polygons: alsListe(rechnung.polygone),
        targetPolygons: alsListe(rechnung.zielPolygone),
        areaRevision: rechnung.quelleRevision,
        targetAreaRevision: rechnung.zielRevision,
        targetName: rechnung.zielName,
        consumesTarget: landscapeBooleanConsumesTarget(body.operation),
        // Eine Sprache geht nie mit ihrer letzten Teilfläche (wie „Teilfläche entfernen …“).
        targetLandscapeGoes: false,
    };
}

/**
 * `sprache_flaeche.boolean` (`POST …/flaechen/:flaeche/boolean`): Die Quelle bekommt die neue Form, gegen beide Revisionen; „vereinigen“ und „ausschneiden“
 * legen die andere Teilfläche still (ihre Sprache bleibt). EINE Operation.
 */
export async function verknuepfeSprachflaeche(
    database: Database,
    actor: MapActor,
    spracheId: string,
    flaecheId: string,
    body: SpracheFlaecheBooleanBody,
): Promise<OperationReceipt> {
    const zeile = await vorab(database, spracheId, flaecheId);
    if (flaecheId === body.targetAreaId) throw ungueltig("Bitte eine andere Fläche wählen.", { field: "targetAreaId" });
    return mapOperation(
        database,
        actor,
        {
            operationId: body.operationId,
            operation: "sprache_flaeche.boolean",
            mapDomainId: zeile.map_domain_id,
            body: { spracheId, flaecheId, ...body },
        },
        async (tx) => {
            const quelle = await quelleZumSchreiben(tx, actor, spracheId, flaecheId, body.baseRevision);
            const ziel = await leseFlaeche(tx, body.targetAreaId, true);
            if (ziel === undefined || !ziel.is_active || !ziel.sprache_aktiv)
                throw new ApiError(404, "not_found", "Eine der beiden Flächen gibt es nicht mehr.");
            if (ziel.revision !== body.targetBaseRevision)
                throw await mapEditConflict(
                    tx,
                    { kind: "sprache_flaeche", publicId: ziel.public_id },
                    { revision: ziel.revision, changedAt: ziel.updated_at },
                );
            if (ziel.sprache_public_id === spracheId)
                throw ungueltig("Bitte die Teilfläche einer anderen Sprache wählen.", { field: "targetAreaId" });
            const verschluckt = landscapeBooleanConsumesTarget(body.operation);
            if (verschluckt) await verlangeSprachSperre(tx, actor, ziel.sprache_public_id);
            else await pruefeFremdeSprachSperre(tx, actor, [ziel.sprache_public_id]);
            const rechnung = await rechneMitAnderer(tx, body.operation, flaecheId, body.targetAreaId);
            const buch: Buch = { affected: [], entries: [] };
            await formeUm(tx, buch, quelle, rechnung.polygone, "boolean");
            if (verschluckt) await legeStill(tx, buch, ziel);
            return {
                receipt: { affected: buch.affected, derivedWork: [], warnings: [] },
                summary: `Sprache „${quelle.sprache_name}“: ${WORT_ANDERE[body.operation]} (${ziel.sprache_name})`,
                entries: buch.entries,
            };
        },
    );
}

// ---------------------------------------------------------------------------------------------------------------------
// „Kopieren …“
// ---------------------------------------------------------------------------------------------------------------------

/**
 * `sprache_flaeche.copy` (`POST …/flaechen/:flaeche/copy`): die Teilfläche als KOPIE (eigene Kennung und Revision) in einer anderen Sprache; mit
 * `deleteSource` („Originalfläche löschen“) wird sie in der Quelle stillgelegt (Umziehen). EINE Operation, ganz oder gar nicht; die Sprache der Quelle bleibt,
 * auch ohne Teilfläche.
 *
 * Ziel ist eine bestehende Sprache (`targetId`, mit ihrer Sperre) oder eine neue (`neueSprache`, Betreiber 2026-10-31: „Ja, auch neue“): Sie entsteht in
 * DERSELBEN Operation wie beim Anlegen (`legeSpracheAnIn`: Name, Schlüssel, Herkunft, Stelle; ohne Farbe `SPRACHE_NEUE_FARBE`), braucht keine Sperre (es gibt
 * sie vorher nicht) und steht im Fachprotokoll als `sprache.created` vor der Kopie. So nimmt WI-0265 Anlegen, Kopie und Stilllegen als Ganzes zurück. Wie beim
 * Anlegen darf der Name schon vergeben sein: Der Schlüssel wird eindeutig gemacht (`-2`, `-3` …).
 */
export async function kopiereSprachflaeche(
    database: Database,
    actor: MapActor,
    spracheId: string,
    flaecheId: string,
    body: SpracheFlaecheKopierenBody,
): Promise<SpracheFlaecheNeuQuittung> {
    const zeile = await vorab(database, spracheId, flaecheId);
    // Genau eines (das Schema prüft es schon; hier für Aufrufe ohne Route).
    if ((body.targetId === undefined) === (body.neueSprache === undefined))
        throw ungueltig("Bitte eine Zielsprache wählen oder eine neue benennen.", { field: "targetId" });
    if (body.targetId === spracheId) throw ungueltig("Bitte eine andere Sprache wählen.", { field: "targetId" });
    const neueSprache =
        body.neueSprache === undefined
            ? undefined
            : {
                  publicId: randomUUID(),
                  name: nameVon(body.neueSprache.name, "neueSprache.name"),
                  farbe: farbeVon(body.neueSprache.farbe ?? SPRACHE_NEUE_FARBE),
                  legende: null,
              };
    const quittung = await mapOperation(
        database,
        actor,
        {
            operationId: body.operationId,
            operation: "sprache_flaeche.copy",
            mapDomainId: zeile.map_domain_id,
            body: { spracheId, flaecheId, ...body },
        },
        async (tx) => {
            const quelle = await quelleZumSchreiben(tx, actor, spracheId, flaecheId, body.baseRevision);
            const buch: Buch = { affected: [], entries: [] };
            const ziel =
                neueSprache === undefined
                    ? await bestehendesZiel(tx, actor, body.targetId!)
                    : await neuesZiel(tx, buch, neueSprache);
            await legeAn(
                tx,
                buch,
                {
                    sprache_id: ziel.id,
                    sprache_public_id: ziel.public_id,
                    sprache_revision: ziel.revision,
                    map_domain_id: quelle.map_domain_id,
                },
                polygoneVon(quelle.geojson),
                "copied",
            );
            if (body.deleteSource) await legeStill(tx, buch, quelle);
            return {
                receipt: { affected: buch.affected, derivedWork: [], warnings: [] },
                summary: `Sprache „${quelle.sprache_name}“: Teilfläche ${body.deleteSource ? "umgezogen" : "kopiert"} nach „${ziel.name}“`,
                entries: buch.entries,
            };
        },
    );
    const neu = neueAus(quittung, flaecheId);
    // Die Sprache der Kopie: die erste Sprache der Quittung außer der Quelle (auch bei einer wiederholten Kennung).
    const zielSprache = quittung.affected.find((x) => x.kind === SPRACHE_ART && x.id !== spracheId)?.id;
    return {
        ...quittung,
        ...(neu === undefined ? {} : { flaecheId: neu }),
        ...(zielSprache === undefined ? {} : { spracheId: zielSprache }),
    };
}

interface Zielsprache {
    id: string;
    public_id: string;
    name: string;
    revision: number;
}

/** Eine bestehende Zielsprache: gesperrt, aktiv, mit der Sperre der Person (die Kopie ändert ihren Bestand). */
async function bestehendesZiel(tx: Sql, actor: MapActor, targetId: string): Promise<Zielsprache> {
    const [ziel] = await tx<(Zielsprache & { is_active: boolean })[]>`
        SELECT id::text, public_id::text, name, revision::int AS revision, is_active
          FROM sprache WHERE public_id = ${targetId}::uuid
           FOR UPDATE
    `;
    if (ziel === undefined) throw new ApiError(404, "not_found", "Die Zielsprache gibt es nicht mehr.");
    if (!ziel.is_active)
        throw ungueltig("Die Zielsprache ist stillgelegt; erst zurückholen, dann ändern.", { field: "targetId" });
    await verlangeSprachSperre(tx, actor, ziel.public_id);
    return ziel;
}

/** Eine neue Zielsprache, angelegt wie beim Anlegen; sie steht vor der Kopie in Quittung und Protokoll (`sprache.created`). */
async function neuesZiel(
    tx: Sql,
    buch: Buch,
    neu: { publicId: string; name: string; farbe: string; legende: null },
): Promise<Zielsprache> {
    const angelegt = await legeSpracheAnIn(tx, neu);
    buch.affected.push({ kind: SPRACHE_ART, id: neu.publicId, revision: angelegt.revision });
    buch.entries.push({
        action: "sprache.created",
        spracheId: neu.publicId,
        revisionBefore: null,
        revisionAfter: angelegt.revision,
        changes: angelegt.aenderungen,
    });
    return { id: angelegt.id, public_id: neu.publicId, name: neu.name, revision: angelegt.revision };
}

// ---------------------------------------------------------------------------------------------------------------------
// Eine Fläche der Derographie in eine Sprache
// ---------------------------------------------------------------------------------------------------------------------

interface Landschaftsflaeche {
    region: string;
    region_name: string;
    area: string;
    map_domain_id: string;
    geojson: string;
}

/** Die aktive Teilfläche einer aktiven Landschaft, nur gelesen (nie gesperrt, nie geschrieben); sonst 404. */
async function leseLandschaftsflaeche(sql: Queryable, regionId: string, areaId: string): Promise<Landschaftsflaeche> {
    const [zeile] = await sql<Landschaftsflaeche[]>`
        SELECT r.public_id::text AS region, r.name AS region_name, a.public_id::text AS area, a.map_domain_id,
               ST_AsGeoJSON(a.geom, 15) AS geojson
          FROM region_area a JOIN region r ON r.id = a.region_id
         WHERE a.public_id = ${areaId}::uuid AND r.public_id = ${regionId}::uuid AND a.is_active AND r.is_active
    `;
    if (zeile === undefined) throw new ApiError(404, "not_found", "Diese Landschaft hat keine solche Teilfläche.");
    return zeile;
}

/**
 * `sprache.flaeche_aus_landschaft` (`POST /api/editor/sprachen/aus-landschaft`; WI-0261, Betreiber 2026-10-31: „Ja, bauen“): EINE Teilfläche der Derographie als
 * KOPIE in eine Sprache, mit derselben Einheit und Regel wie „Kopieren …“ dort (`landscape.copy`: die ganze Teilfläche, alle ihre Polygone, als EINE neue
 * Teilfläche). Die Fläche der Derographie wird nur gelesen; „Originalfläche löschen“ gibt es hier nicht.
 *
 * - Ziel ist eine bestehende Sprache (mit ihrer Sperre, wie beim Kopieren) oder eine neue (angelegt wie beim Anlegen, `legeSpracheAnIn`, ohne Sperre).
 * - EINE Operation mit eigener Aktion; das Fachprotokoll trägt die neue Sprache (`sprache.created`) und die neue Teilfläche mit ihrer ganzen Form und der Quelle
 *   (`kopiertAus`: Landschaft, Teilfläche, Name). Die Quelle steht als Feld, nicht als Ziel der Zeile: So bekommt die Landschaft keine spätere Operation, die ihre
 *   Rücknahme (WI-0265) als Konflikt läse.
 * - Nur Aventurien (die Domäne der Sprachen); die Grenzen einer Teilfläche gelten wie überall (`pruefeGrenzen`).
 * - Vorerst nicht zurücknehmbar: Kein Adapter der Rücknahme kennt die Aktion, und der Verlauf der Sprache bietet kein ↺ an (`sprache-verlauf.ts`).
 */
export async function kopiereAusLandschaft(
    database: Database,
    actor: MapActor,
    body: SpracheAusLandschaftBody,
): Promise<SpracheFlaecheNeuQuittung> {
    if ((body.targetId === undefined) === (body.neueSprache === undefined))
        throw ungueltig("Bitte eine Zielsprache wählen oder eine neue benennen.", { field: "targetId" });
    await leseLandschaftsflaeche(database, body.regionId, body.areaId);
    const neueSprache =
        body.neueSprache === undefined
            ? undefined
            : {
                  publicId: randomUUID(),
                  name: nameVon(body.neueSprache.name, "neueSprache.name"),
                  farbe: farbeVon(body.neueSprache.farbe ?? SPRACHE_NEUE_FARBE),
                  legende: null,
              };
    const quittung = await mapOperation(
        database,
        actor,
        {
            operationId: body.operationId,
            operation: "sprache.flaeche_aus_landschaft",
            mapDomainId: SPRACHEN_DOMAENE,
            body,
        },
        async (tx) => {
            const quelle = await leseLandschaftsflaeche(tx, body.regionId, body.areaId);
            if (quelle.map_domain_id !== SPRACHEN_DOMAENE)
                throw ungueltig("Die Fläche liegt auf einer anderen Karte als die Sprachen.", { field: "areaId" });
            const buch: Buch = { affected: [], entries: [] };
            const ziel =
                neueSprache === undefined
                    ? await bestehendesZiel(tx, actor, body.targetId!)
                    : await neuesZiel(tx, buch, neueSprache);
            await legeAn(
                tx,
                buch,
                {
                    sprache_id: ziel.id,
                    sprache_public_id: ziel.public_id,
                    sprache_revision: ziel.revision,
                    map_domain_id: SPRACHEN_DOMAENE,
                },
                polygoneVon(quelle.geojson),
                "copied",
                { kopiertAus: { after: { regionId: quelle.region, areaId: quelle.area, name: quelle.region_name } } },
            );
            return {
                receipt: { affected: buch.affected, derivedWork: [], warnings: [] },
                summary: `Sprache „${ziel.name}“: Teilfläche aus „${quelle.region_name}“ kopiert`,
                entries: buch.entries,
            };
        },
    );
    // Die neue Teilfläche und ihre Sprache (auch bei einer wiederholten Kennung aus der ersten Quittung).
    const flaeche = quittung.affected.find((x) => x.kind === SPRACHFLAECHE_ART)?.id;
    const sprache = quittung.affected.find((x) => x.kind === SPRACHE_ART)?.id;
    return {
        ...quittung,
        ...(flaeche === undefined ? {} : { flaecheId: flaeche }),
        ...(sprache === undefined ? {} : { spracheId: sprache }),
    };
}
