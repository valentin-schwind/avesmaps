import type {
    MapHistoryEntry,
    OperationReceipt,
    RuecknahmeBody,
    RuecknahmePruefung,
    RuecknahmeReceipt,
    RuecknahmeVorschauBody,
} from "@avesmaps3d/shared";
import type { Sql } from "../auth/session-store.ts";
import type { Database, Queryable } from "../database.ts";
import { ApiError } from "../http/api-error.ts";
import { aktualisiereKanon } from "../inhalte/kanon-folgen.ts";
import { legeX2Still } from "../wiki/objekt/anschluss.ts";
import { eintraegeNachKennung } from "./history.ts";
import { GIPFEL_ART } from "./gelaende-folgen.ts";
import type { MapActor, MapAuditEntry } from "./map-operation.ts";
import {
    AKTION_LANDMARKE_ZURUECK,
    AKTION_ORT_UMGEWANDELT,
    AKTION_ORT_ZURUECK,
    schreibeUmwandlung,
} from "./ort-in-landmarke.ts";
import { pruefeFremdeOrtssperre, readPlace, verschiebeOrtIn } from "./place-edit.ts";
import { holeOrtZurueck } from "./place-removal.ts";
import { leseGipfel, nimmGipfelWeg, pruefeFremdeGipfelSperre } from "./peak-update.ts";
import { RUECKNAHME_UMWANDLUNG_OPERATION, UMWANDLUNG_OPERATIONEN } from "./ruecknahme-arten.ts";
import {
    fuehreRuecknahmeAus,
    pruefeFamilie,
    type RuecknahmeFamilie,
    type SchreibErgebnis,
} from "./ruecknahme-ablauf.ts";
import { listeDerEnden, wegenden } from "./ruecknahme-ort.ts";
import type { RuecknahmeAdapter, RuecknahmeLeser, VorKonflikt, Vorpruefung } from "./ruecknahme.ts";

/**
 * „In Landmarke umwandeln …“ zurücknehmen (WI-0271 L8; WI-0265 §12, Vali 2026-10-31: „schau dass alle änderungen rücknehmbar sind“): die Familie der Umwandlung, `POST
 * /api/editor/landmarken-umwandlung/:id/restore-series[/preview]` an der Landmarke. Streng, ganz oder gar nicht.
 *
 * - **Zurück** (`place.in_landmarke` im Protokoll): Der Ort lebt samt Stätten und seiner Merkmale wieder auf (`holeOrtZurueck`; Ruine und Seehafen waren nie weg), die verschobenen Wegenden gehen an ihre Lage davor, Treffer, Abenteuer und
 *   Kraftlinien zeigen wieder auf den Ort, die Landmarke geht still mit ihrem Artikel, ihren kopierten Quellen und dem Verweis. Geschrieben als `place.aus_landmarke` und `peak.zum_ort`.
 * - **Wieder** (`place.aus_landmarke`, die Rücknahme der Rücknahme): dieselbe Landmarke lebt wieder auf, über denselben Schreibweg wie das Umwandeln (`schreibeUmwandlung`), samt der Sperre bis zum Cutoff. Was am Ort
 *   hängt, liest sie vom Stand von jetzt; das Protokoll hat dann wieder `place.in_landmarke`.
 * - **Streng:** Jede spätere Operation an Ort, Landmarke, einem verschobenen Weg oder einer umgehängten Kraftlinie hält die Rücknahme an (der Kern, `ruecknahme.ts`), auch ein Artwechsel im Fenster der Landmarke: erst ihn zurück. Hier steht, was
 *   keine Operation an ihnen ist: ein Treffer oder eine Ortszeile, die inzwischen woanders hinzeigt, ein Wegende, das anders liegt, eine weitere Kraftlinie an der Landmarke.
 * - **Nie Mitglied einer Arbeitsserie** (`EINZEL_OPERATIONEN`): Sie berührt Ort und Landmarke zugleich und geht über ihre eigene Adresse.
 */

const text = (wert: unknown): string | undefined => (typeof wert === "string" ? wert : undefined);
const liste = (wert: unknown): string[] =>
    Array.isArray(wert) ? wert.filter((x): x is string => typeof x === "string") : [];

interface Ende {
    pathId: string;
    end: "start" | "end";
    vorher: { x: number; y: number };
    nachher: { x: number; y: number };
}

/** Was das Protokoll eines Mitglieds sagt: die Richtung, die zwei Gegenstände und, beim Zurück, was umzukehren ist. */
interface Plan {
    richtung: "zurueck" | "wieder";
    ortId: string;
    peakId: string;
    staetten: string[];
    ortRevision: number | null;
    vorkommen: string[];
    abenteuer: string[];
    quellen: string[];
    mitWiki: boolean;
    enden: Ende[];
    /** Die Abschnitte der Kraftlinien, die die Umwandlung vom Ort auf die Landmarke hängte. */
    kraftlinien: string[];
}

function planAus(eintrag: MapHistoryEntry): Plan | undefined {
    const ort = eintrag.objects.find(
        (o) => o.kind === "place" && (o.action === AKTION_ORT_UMGEWANDELT || o.action === AKTION_ORT_ZURUECK),
    );
    if (ort === undefined) return undefined;
    const peak = eintrag.objects.find((o) => o.kind === "peak");
    const zurueck = ort.action === AKTION_ORT_UMGEWANDELT;
    const peakId = text(ort.changes["landmarke"]?.after) ?? text(ort.changes["landmarke"]?.before) ?? peak?.id;
    if (peakId === undefined) return undefined;
    const enden: Ende[] = [];
    for (const weg of eintrag.objects) {
        if (weg.kind !== "path" || weg.action !== "path.endpoint_moved") continue;
        const davor = listeDerEnden(weg.changes["geometry"]?.before);
        for (const danach of listeDerEnden(weg.changes["geometry"]?.after)) {
            const frueher = davor.find((ende) => ende.end === danach.end);
            if (frueher !== undefined)
                enden.push({
                    pathId: weg.id,
                    end: danach.end,
                    vorher: { x: frueher.x, y: frueher.y },
                    nachher: { x: danach.x, y: danach.y },
                });
        }
    }
    return {
        richtung: zurueck ? "zurueck" : "wieder",
        ortId: ort.id,
        peakId,
        staetten: liste(ort.changes["staetten"]?.before),
        ortRevision: ort.revisionAfter ?? null,
        vorkommen: liste(ort.changes["vorkommen"]?.before),
        abenteuer: liste(ort.changes["abenteuer"]?.before),
        quellen: liste(peak?.changes["quellen"]?.after),
        mitWiki: peak?.changes["wiki"] !== undefined,
        enden,
        kraftlinien: eintrag.objects
            .filter((o) => o.kind === "powerline" && o.action === "powerline.updated")
            .map((o) => o.id),
    };
}

const istMitglied = (operation: string, aktionen: readonly string[]): boolean =>
    UMWANDLUNG_OPERATIONEN.has(operation) &&
    (aktionen.includes(AKTION_ORT_UMGEWANDELT) || aktionen.includes(AKTION_ORT_ZURUECK));

/** Das Zurück geht nur, wenn alles noch so steht, wie die Umwandlung es hinterließ: Vor dem Schreiben als Konflikt, nicht als Fehler danach. */
async function pruefeZurueck(database: Queryable, plan: Plan): Promise<VorKonflikt[]> {
    const konflikte: VorKonflikt[] = [];
    const [stand] = await database<{ aktiv: boolean; name: string; id: string }[]>`
        SELECT is_active AS aktiv, name, id::text AS id FROM terrain_peak WHERE public_id = ${plan.peakId}::uuid
    `;
    if (stand === undefined || !stand.aktiv)
        konflikte.push({
            art: "wert",
            kind: "peak",
            id: plan.peakId,
            ...(stand === undefined ? {} : { name: stand.name }),
            felder: ["active"],
            abweichung: { was: "felder" },
            detail: "Die Landmarke ist inzwischen stillgelegt.",
        });
    const ort = await readPlace(database, plan.ortId, false);
    if (ort === undefined || ort.unplaced || ort.is_active)
        konflikte.push({
            art: "wert",
            kind: "place",
            id: plan.ortId,
            ...(ort === undefined ? {} : { name: ort.name }),
            felder: ["active"],
            abweichung: { was: "felder" },
            detail: "Der Ort ist inzwischen wieder da.",
        });
    if (stand !== undefined) {
        const [zaehlung] = await database<{ vorkommen: number; abenteuer: number }[]>`
            SELECT (SELECT count(*)::int FROM lore_place_target
                     WHERE terrain_peak_id = ${stand.id}::bigint AND lore_place_id = ANY(${plan.vorkommen}::bigint[])) AS vorkommen,
                   (SELECT count(*)::int FROM adventure_place
                     WHERE terrain_peak_id = ${stand.id}::bigint AND id = ANY(${plan.abenteuer}::bigint[])) AS abenteuer
        `;
        const felder = [
            ...((zaehlung?.vorkommen ?? 0) === plan.vorkommen.length ? [] : ["vorkommen"]),
            ...((zaehlung?.abenteuer ?? 0) === plan.abenteuer.length ? [] : ["abenteuer"]),
        ];
        if (felder.length > 0)
            konflikte.push({
                art: "wert",
                kind: "peak",
                id: plan.peakId,
                name: stand.name,
                felder,
                abweichung: { was: "felder" },
                detail: "Ein Bezug zeigt inzwischen woandershin.",
            });
    }
    // Die Kraftlinien: Genau die umgehängten enden noch an der Landmarke, und keine weitere ist dazugekommen (sie stünde danach ohne Ende da).
    const linien = await database<{ id: string }[]>`
        SELECT public_id::text AS id FROM powerline
         WHERE (is_active OR off_map) AND (from_public_id = ${plan.peakId}::uuid OR to_public_id = ${plan.peakId}::uuid)
    `;
    const anLandmarke = new Set(linien.map((linie) => linie.id));
    if (plan.kraftlinien.some((id) => !anLandmarke.has(id)) || anLandmarke.size !== plan.kraftlinien.length)
        konflikte.push({
            art: "wert",
            kind: "peak",
            id: plan.peakId,
            ...(stand === undefined ? {} : { name: stand.name }),
            felder: ["kraftlinien"],
            abweichung: { was: "felder" },
            detail: "An der Landmarke enden inzwischen andere Kraftlinien.",
        });
    const heute = await wegenden(database, [...new Set(plan.enden.map((ende) => ende.pathId))]);
    for (const ende of plan.enden) {
        const jetzt = heute.find((h) => h.pathId === ende.pathId && h.end === ende.end);
        if (jetzt !== undefined && jetzt.x === ende.nachher.x && jetzt.y === ende.nachher.y) continue;
        konflikte.push({
            art: "wert",
            kind: "path",
            id: ende.pathId,
            ...(jetzt === undefined ? {} : { name: jetzt.name }),
            felder: [ende.end],
            abweichung:
                jetzt === undefined
                    ? { was: "weg_fehlt" }
                    : {
                          was: ende.end === "start" ? "weg_anfang" : "weg_ende",
                          heute: { x: jetzt.x, y: jetzt.y },
                          erwartet: ende.nachher,
                      },
            detail: jetzt === undefined ? "Den Weg gibt es nicht mehr." : "Das Wegende liegt inzwischen woanders.",
        });
    }
    return konflikte;
}

/** Das Wieder: Der Ort steht auf der Karte und die Landmarke ist still. Kraftlinien, die inzwischen am Ort enden, hängt das Umwandeln um. */
async function pruefeWieder(database: Queryable, plan: Plan): Promise<VorKonflikt[]> {
    const konflikte: VorKonflikt[] = [];
    const ort = await readPlace(database, plan.ortId, false);
    if (ort === undefined || ort.unplaced || !ort.is_active)
        konflikte.push({
            art: "wert",
            kind: "place",
            id: plan.ortId,
            ...(ort === undefined ? {} : { name: ort.name }),
            felder: ["active"],
            abweichung: { was: ort?.unplaced === true ? "ort_nicht_auf_karte" : "ort_geloescht" },
            detail: "Der Ort steht nicht mehr auf der Karte.",
        });
    const [stand] = await database<{ aktiv: boolean; name: string }[]>`
        SELECT is_active AS aktiv, name FROM terrain_peak WHERE public_id = ${plan.peakId}::uuid
    `;
    if (stand === undefined || stand.aktiv)
        konflikte.push({
            art: "wert",
            kind: "peak",
            id: plan.peakId,
            ...(stand === undefined ? {} : { name: stand.name }),
            felder: ["active"],
            abweichung: { was: "felder" },
            detail: "Die Landmarke ist schon wieder da.",
        });
    return konflikte;
}

export const UMWANDLUNG_ADAPTER: RuecknahmeAdapter = {
    familie: "umwandlung",
    recht: () => "edit_map_objects",
    pruefeArt: (operation, aktionen) =>
        istMitglied(operation, aktionen) ? { ok: true } : { ok: false, reason: "art" },
    // Eine Umwandlung steht immer allein: Eine Rücknahme nimmt genau eine zurück.
    pruefeListe(offen) {
        const verworfen = new Map<string, "art">();
        if (offen.length > 1) for (const mitglied of offen) verworfen.set(mitglied.operationId, "art");
        return verworfen;
    },
    async pruefeWerte(database, kontext) {
        const eintraege = (
            await eintraegeNachKennung(
                database,
                kontext.offen.map((mitglied) => mitglied.operationId),
                { personId: kontext.leser.personId, nutzlast: "voll" },
            )
        ).entries;
        const konflikte: VorKonflikt[] = [];
        for (const eintrag of eintraege) {
            const plan = planAus(eintrag);
            if (plan === undefined) continue;
            konflikte.push(...(await (plan.richtung === "zurueck" ? pruefeZurueck : pruefeWieder)(database, plan)));
        }
        return konflikte;
    },
};

const familieVon = (peakId: string, mapDomainId: string): RuecknahmeFamilie => ({
    operation: RUECKNAHME_UMWANDLUNG_OPERATION,
    scope: `peak:${peakId}`,
    adapter: UMWANDLUNG_ADAPTER,
    mapDomainId,
});

async function karteDerLandmarke(database: Queryable, peakId: string): Promise<string> {
    const [zeile] = await database<{ map_domain_id: string }[]>`
        SELECT map_domain_id FROM terrain_peak WHERE public_id = ${peakId}::uuid
    `;
    if (zeile === undefined) throw new ApiError(404, "not_found", "Diese Landmarke gibt es nicht.");
    return zeile.map_domain_id;
}

/** `POST …/restore-series/preview`: lesend, nichts wird geschrieben und kein Auftrag eingestellt. */
export async function vorschauUmwandlung(
    database: Database,
    peakId: string,
    body: RuecknahmeVorschauBody,
    leser: RuecknahmeLeser,
): Promise<RuecknahmePruefung> {
    const karte = await karteDerLandmarke(database, peakId);
    const vor = await pruefeFamilie(
        database,
        { mapDomainId: karte, mitglieder: body.members, membersHash: body.membersHash },
        leser,
        familieVon(peakId, karte),
    );
    return { ...vor, folgen: { gegenstaende: vor.gegenstaende.length, gelaende: "keines" } } as RuecknahmePruefung;
}

const mitGrund = (entry: MapAuditEntry, grund: string | undefined): MapAuditEntry =>
    grund === undefined || (entry.placeId === undefined && entry.peakId === undefined)
        ? entry
        : { ...entry, changes: { ...entry.changes, restoreReason: { after: grund } } };

/** Die Abschnitte, die die Umwandlung umhängte, wieder an den Ort. */
async function haengeKraftlinienZurueck(
    tx: Sql,
    plan: Plan,
): Promise<{ affected: OperationReceipt["affected"]; entries: MapAuditEntry[] }> {
    const affected: OperationReceipt["affected"] = [];
    const entries: MapAuditEntry[] = [];
    for (const id of plan.kraftlinien) {
        const [alt] = await tx<{ von: string; nach: string; revision: number }[]>`
            SELECT from_public_id::text AS von, to_public_id::text AS nach, revision::int AS revision
              FROM powerline WHERE public_id = ${id}::uuid FOR UPDATE
        `;
        if (alt === undefined)
            throw new ApiError(404, "not_found", "Eine Kraftlinie der Umwandlung gibt es nicht mehr.");
        const [neu] = await tx<{ revision: number }[]>`
            UPDATE powerline
               SET from_public_id = CASE WHEN from_public_id = ${plan.peakId}::uuid THEN ${plan.ortId}::uuid ELSE from_public_id END,
                   to_public_id = CASE WHEN to_public_id = ${plan.peakId}::uuid THEN ${plan.ortId}::uuid ELSE to_public_id END
             WHERE public_id = ${id}::uuid
            RETURNING revision::int AS revision
        `;
        affected.push({ kind: "powerline", id, revision: neu!.revision });
        entries.push({
            action: "powerline.updated",
            powerlineId: id,
            revisionBefore: alt.revision,
            revisionAfter: neu!.revision,
            changes: {
                ...(alt.von === plan.peakId ? { from: { before: plan.peakId, after: plan.ortId } } : {}),
                ...(alt.nach === plan.peakId ? { to: { before: plan.peakId, after: plan.ortId } } : {}),
            },
        });
    }
    return { affected, entries };
}

/** Das Zurück in EINER Operation: die Landmarke still, die Bezüge zurück, der Ort wieder da, die Wegenden an ihre Lage davor. */
async function schreibeZurueck(tx: Sql, plan: Plan, grund: string | undefined): Promise<SchreibErgebnis> {
    const gipfel = await leseGipfel(tx, plan.peakId, true);
    if (gipfel === undefined) throw new ApiError(404, "not_found", "Diese Landmarke gibt es nicht (mehr).");
    // Erst die Kraftlinien zurück: An einer Landmarke mit Kraftlinie scheitert das Stilllegen.
    const linien = await haengeKraftlinienZurueck(tx, plan);
    const weg = await nimmGipfelWeg(tx, gipfel);
    if (plan.mitWiki) {
        await tx`
            UPDATE terrain_peak_wiki_assignment SET is_active = FALSE, retired_at = now(), retired_origin = 'editor', updated_at = now()
             WHERE terrain_peak_id = ${gipfel.id}::bigint AND is_active
        `;
        await legeX2Still(tx, "region", [plan.peakId]);
    }
    if (plan.quellen.length > 0) {
        await tx`
            UPDATE terrain_peak_source
               SET state = 'retired', is_active = FALSE, retired_at = now(), retired_origin = 'editor', updated_at = now()
             WHERE terrain_peak_id = ${gipfel.id}::bigint AND source_id = ANY(${plan.quellen}::bigint[]) AND is_active
        `;
        await aktualisiereKanon(tx, { peak: new Set([plan.peakId]) });
    }
    await tx`
        UPDATE terrain_peak_bezug SET is_active = FALSE, updated_at = now()
         WHERE terrain_peak_id = ${gipfel.id}::bigint AND ziel_art = 'place' AND ziel_public_id = ${plan.ortId}::uuid
           AND rolle = 'umgewandelt_aus' AND is_active
    `;

    const zurueck = await holeOrtZurueck(tx, plan.ortId, {
        ohneLage: false,
        staettenZurueck: plan.staetten,
        revisionAfter: plan.ortRevision,
    });
    const ortEintrag = zurueck.entries[0]!;
    const [ort] = await tx<{ id: string }[]>`SELECT id::text AS id FROM place WHERE public_id = ${plan.ortId}::uuid`;
    if (plan.vorkommen.length > 0) {
        await tx`
            DELETE FROM lore_place_target WHERE terrain_peak_id = ${gipfel.id}::bigint AND lore_place_id = ANY(${plan.vorkommen}::bigint[])
        `;
        await tx`
            INSERT INTO lore_place_target (lore_place_id, place_id)
            SELECT t.id, ${ort!.id}::bigint FROM unnest(${plan.vorkommen}::bigint[]) AS t(id)
        `;
    }
    if (plan.abenteuer.length > 0)
        await tx`
            UPDATE adventure_place SET terrain_peak_id = NULL, place_id = ${ort!.id}::bigint, updated_at = now()
             WHERE id = ANY(${plan.abenteuer}::bigint[]) AND terrain_peak_id = ${gipfel.id}::bigint
        `;

    // Die Wegenden über denselben Schreibweg wie das Verschieben: Die Kurven, die Höhen an Flüssen und die Quittung folgen ihm. Der Ort bleibt, wo er ist.
    const wegEintraege: MapAuditEntry[] = [];
    const wegBetroffen: OperationReceipt["affected"] = [];
    if (plan.enden.length > 0) {
        const row = await readPlace(tx, plan.ortId, true);
        if (row === undefined || row.x === null || row.y === null)
            throw new ApiError(404, "not_found", "Diesen Ort gibt es nicht auf der Karte.");
        const heute = await wegenden(tx, [...new Set(plan.enden.map((ende) => ende.pathId))]);
        const enden = plan.enden.map((ende) => {
            const jetzt = heute.find((h) => h.pathId === ende.pathId && h.end === ende.end);
            if (jetzt === undefined)
                throw new ApiError(404, "not_found", "Einen Weg der Umwandlung gibt es nicht mehr.");
            return jetzt;
        });
        const verschoben = await verschiebeOrtIn(
            tx,
            row,
            {
                baseRevision: row.revision,
                to: { x: row.x, y: row.y },
                pathEnds: plan.enden.map((ende, i) => ({
                    pathId: ende.pathId,
                    end: ende.end,
                    baseRevision: enden[i]!.revision,
                    to: ende.vorher,
                })),
            },
            enden,
        );
        wegEintraege.push(...verschoben.entries.filter((eintrag) => eintrag.action !== "place.moved"));
        wegBetroffen.push(...verschoben.receipt.affected.filter((gegenstand) => gegenstand.kind !== "place"));
    }
    const [ortJetzt] = await tx<{ revision: number }[]>`
        SELECT revision::int AS revision FROM place WHERE public_id = ${plan.ortId}::uuid
    `;
    return {
        receipt: {
            affected: [
                { kind: "place", id: plan.ortId, revision: ortJetzt!.revision },
                { kind: GIPFEL_ART, id: plan.peakId, revision: weg.entries[0]!.revisionAfter ?? gipfel.revision },
                ...wegBetroffen,
                ...linien.affected,
            ],
            derivedWork: [{ kind: "routing", state: "pending" }],
            warnings: zurueck.receipt.warnings,
        },
        summary: `${gipfel.name}: Umwandlung zurückgenommen`,
        entries: [
            mitGrund(
                {
                    ...ortEintrag,
                    action: AKTION_ORT_ZURUECK,
                    revisionAfter: ortJetzt!.revision,
                    changes: {
                        ...ortEintrag.changes,
                        landmarke: { before: plan.peakId, after: null },
                        ...(plan.vorkommen.length > 0 ? { vorkommen: { before: [], after: plan.vorkommen } } : {}),
                        ...(plan.abenteuer.length > 0 ? { abenteuer: { before: [], after: plan.abenteuer } } : {}),
                    },
                },
                grund,
            ),
            ...weg.entries.map((eintrag) => mitGrund({ ...eintrag, action: AKTION_LANDMARKE_ZURUECK }, grund)),
            ...wegEintraege,
            ...linien.entries,
        ],
    };
}

/** `POST …/restore-series`: nimmt EINE Umwandlung zurück oder wieder auf, in EINER Operation. */
export async function ruecknehmenUmwandlung(
    database: Database,
    actor: MapActor,
    leser: RuecknahmeLeser,
    peakId: string,
    body: RuecknahmeBody,
): Promise<RuecknahmeReceipt> {
    const karte = await karteDerLandmarke(database, peakId);
    return fuehreRuecknahmeAus({
        database,
        actor,
        leser,
        familie: familieVon(peakId, karte),
        body,
        haken: {
            async pruefeFremdeSperre(db, akteur, scopes) {
                const nach = (art: string): string[] =>
                    [...scopes]
                        .filter((scope) => scope.startsWith(`${art}:`))
                        .map((scope) => scope.slice(art.length + 1));
                await pruefeFremdeOrtssperre(db, akteur, nach("place"));
                await pruefeFremdeGipfelSperre(db, akteur, nach("peak"));
            },
            async sperreZeilen(tx, vorab: Vorpruefung) {
                const nach = (art: string): string[] =>
                    vorab.gegenstaende
                        .filter((g) => g.kind === art)
                        .map((g) => g.id)
                        .sort();
                await tx`SELECT id FROM place WHERE public_id = ANY(${nach("place")}::uuid[]) ORDER BY public_id FOR UPDATE`;
                await tx`SELECT id FROM terrain_peak WHERE public_id = ANY(${nach("peak")}::uuid[]) ORDER BY public_id FOR NO KEY UPDATE`;
                await tx`SELECT id FROM path WHERE public_id = ANY(${nach("path")}::uuid[]) ORDER BY public_id FOR UPDATE`;
            },
            async schreibe({ tx, offen, grund }) {
                const [eintrag] = (
                    await eintraegeNachKennung(tx, offen, { personId: leser.personId, nutzlast: "voll" })
                ).entries;
                const plan = eintrag === undefined ? undefined : planAus(eintrag);
                if (plan === undefined)
                    throw new ApiError(400, "not_revertable", "Diese Änderung lässt sich nicht zurücknehmen.", {
                        reason: "art",
                    });
                if (plan.richtung === "zurueck") return schreibeZurueck(tx, plan, grund);
                const row = await readPlace(tx, plan.ortId, true);
                if (row === undefined) throw new ApiError(404, "not_found", "Diesen Ort gibt es nicht.");
                const { receipt, summary, entries } = await schreibeUmwandlung(tx, actor, row, {
                    peakId: plan.peakId,
                    neu: false,
                });
                return { receipt, summary, entries: entries.map((entry) => mitGrund(entry, grund)) };
            },
        },
    });
}
