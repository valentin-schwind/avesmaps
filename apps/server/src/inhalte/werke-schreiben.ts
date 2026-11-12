import {
    INHALTE_WERK_ROLLEN,
    type InhalteWerkAendernBody,
    type InhalteWerkAnlegenBody,
    type InhalteWerkOrtEintrag,
    type InhalteWerkZielart,
    type OperationReceipt,
} from "@avesmaps3d/shared";
import type { Sql } from "../auth/session-store.ts";
import type { Database } from "../database.ts";
import { mapEditConflict } from "../editor/place-edit.ts";
import type { MapActor, MapChange } from "../editor/map-operation.ts";
import { ApiError } from "../http/api-error.ts";
import { titelOhneAuszeichnung } from "../wiki/infobox/text.ts";
import { inhalteOperation, type InhalteArbeit } from "./operation.ts";
import { TRAEGER } from "./traeger.ts";

/**
 * Schreiben für den Reiter „Literatur“ (WI-0254, Runde 2): `work.create` und `work.update`, je EINE Operation mit Protokoll
 * (`map_operation`, `map_audit_event`, Ziel `work_public_id`, Migration 0233).
 *
 * - 🔴 **Eine Operation, ein Stand:** `work.update` sperrt das Werk (`FOR UPDATE`) und prüft `baseRevision`; ein veralteter Stand ist 409
 *   `edit_conflict` mit wer und wann (`mapEditConflict`). Stammdaten und Ortsliste gehen zusammen durch oder gar nicht; jede Änderung zählt
 *   die Revision des Werks genau einmal hoch.
 * - 🔴 **Bestandsschutz** (Kapitel 9.37, manuell schlägt Wiki): Was der Editor ändert oder anlegt, trägt `source_system = 'editor'` am WERK;
 *   der Legacy-Zug fasst ein solches Werk samt Ortsliste, Links und Herkunftsvermerken nie an und legt es nicht still
 *   (`migration/literature-import.ts`). Der Schutz gilt für das ganze Werk, nicht für ein einzelnes Feld.
 * - **Herkunft je Feld:** Jedes geänderte Feld bekommt in `adventure_field_origin` den Vermerk `manual` (Legacys Regel: ein Speichern im
 *   Editor stempelt von Hand); die Oberfläche zeigt ihn als „manuell“ neben dem Feld.
 * - **Die Ortsliste ist Aussage** (`sort_order`, der kleinste ist der Startort): Der Körper nennt die GANZE aktive Liste in der Reihenfolge,
 *   die gelten soll. Bleibt die Folge der vorhandenen Zeilen und kommen neue nur ans Ende, behalten die Zeilen ihre Nummern (Legacys Lücken
 *   und Gleichstände bleiben); sonst wird 0 bis n-1 neu vergeben. Eine aktive Zeile, die fehlt, wird still gelegt (aus Legacy unterdrückt,
 *   eigene gelöst, beide mit `retired_origin = editor`), eine stille, die erscheint, kommt zurück; gelöscht wird nie.
 * - **Ziele nur über echte Kennungen:** Ein neues Ziel ist `kind` + `carrierId` eines aktiven Objekts; ein freier Name bleibt ausdrücklich
 *   ungeklärt (`unresolved`, ohne Kartenbezug). Nie wird ein Name gegen Objekte verglichen, nie eine Lage erfunden.
 */

type Zeile = Record<string, string | number | boolean | null>;
const nurText = (wert: string | null | undefined): string | null => {
    const text = (wert ?? "").trim();
    return text === "" ? null : text;
};
const fehlerbild = (pfad: string, regel: string, satz: string): ApiError =>
    new ApiError(400, "validation_failed", satz, { issues: [{ path: pfad, rule: regel }] });

// ---------------------------------------------------------------------------------------------------------------------
// Anlegen
// ---------------------------------------------------------------------------------------------------------------------

export async function legeWerkAn(
    database: Database,
    actor: MapActor,
    body: InhalteWerkAnlegenBody,
): Promise<OperationReceipt & { publicId: string }> {
    const title = titelOhneAuszeichnung(body.title).trim();
    const art = body.productType.trim();
    if (title === "") throw fehlerbild("title", "required", "Ein Werk braucht einen Titel.");
    if (art === "") throw fehlerbild("productType", "required", "Ein Werk braucht eine Art.");
    const offiziell = body.isOfficial ?? true;
    let publicId = "";
    const quittung = await inhalteOperation(
        database,
        actor,
        { operationId: body.operationId, operation: "work.create", body },
        async (tx) => {
            // Ein gleichlautender Titel ist kein Beweis für dasselbe Werk (WI-0254 §6): nichts wird zusammengelegt oder abgelehnt.
            const [neu] = await tx<{ id: string; public_id: string; revision: number }[]>`
                INSERT INTO adventure (public_id, title, product_type, is_official, legacy_origin, state, source_system)
                VALUES (gen_random_uuid(), ${title}, ${art}, ${offiziell}, 'manual', 'active', 'editor')
                RETURNING id::text, public_id::text, revision::int
            `;
            publicId = neu!.public_id;
            for (const feld of ["title", "product_type", "is_official"]) {
                await tx`
                    INSERT INTO adventure_field_origin (adventure_id, field, origin)
                    VALUES (${neu!.id}::bigint, ${feld}, 'manual')
                    ON CONFLICT (adventure_id, field) DO UPDATE SET origin = 'manual'
                `;
            }
            return {
                receipt: {
                    affected: [{ kind: "work", id: publicId, revision: neu!.revision }],
                    derivedWork: [],
                    warnings: [],
                },
                summary: `Werk „${title}“ angelegt`,
                entries: [
                    {
                        action: "work.created",
                        workId: publicId,
                        revisionAfter: neu!.revision,
                        changes: {
                            title: { after: title },
                            productType: { after: art },
                            isOfficial: { after: offiziell },
                        },
                    },
                ],
            };
        },
    );
    const kennung = publicId !== "" ? publicId : (quittung.affected.find((eines) => eines.kind === "work")?.id ?? "");
    return { ...quittung, publicId: kennung };
}

// ---------------------------------------------------------------------------------------------------------------------
// Ändern
// ---------------------------------------------------------------------------------------------------------------------

interface WerkSperre {
    id: string;
    revision: number;
    updated_at: Date;
    title: string;
    product_type: string;
    edition: string | null;
    series: string | null;
    bf_year: number | null;
    bf_label: string | null;
    genre: string | null;
    is_official: boolean;
    editor_note: string | null;
    is_active: boolean;
    state: string;
}

interface OrtZeile {
    id: string;
    sort_order: number;
    export_ordinal: number;
    name_key: string;
    dup_ordinal: number;
    raw_name: string;
    role: string;
    target_state: string;
    state: string;
    is_active: boolean;
    source_system: string;
    place_id: string | null;
    territory_id: string | null;
    region_id: string | null;
    terrain_peak_id: string | null;
    path_id: string | null;
}

/** Das Feld des Vertrags (`adventure_field_origin.field`) zu einem Feld der Schnittstelle. */
const FELD_HERKUNFT: Readonly<Record<string, string>> = {
    title: "title",
    productType: "product_type",
    edition: "edition",
    series: "series",
    bfYear: "bf_year",
    bfLabel: "bf_label",
    genre: "genre",
    isOfficial: "is_official",
};

export async function aendereWerk(
    database: Database,
    actor: MapActor,
    publicId: string,
    body: InhalteWerkAendernBody,
): Promise<OperationReceipt> {
    const felder = body.fields ?? {};
    if (Object.keys(felder).length === 0 && body.orte === undefined) {
        throw fehlerbild("fields", "required", "Es ist nichts zu ändern.");
    }
    return inhalteOperation(
        database,
        actor,
        { operationId: body.operationId, operation: "work.update", body: { workId: publicId, ...body } },
        (tx) => schreibeWerkAendern(tx, publicId, body),
    );
}

/** Was nur die Rücknahme dem Schreibweg mitgibt (`editor/ruecknahme-werk.ts`, WI-0265 B6g1). */
export interface WerkRuecknahme {
    /**
     * Die Jahresangabe in Worten, wie sie vor der Serie stand. Das Ändern des Jahres löscht sie (sie gehörte zum alten Jahr); die Rücknahme setzt sie auf den früheren Wert zurück, statt sie
     * zu löschen. Fehlt der Schlüssel, gilt die Regel des Ändern.
     */
    bfLabel?: string | null;
}

/**
 * Die Arbeit von `work.update` in der Transaktion der Schreibnaht: das Werk sperren, gegen `baseRevision` prüfen, Stammdaten und Ortsliste schreiben, die Herkunft je Feld vermerken. Herausgezogen,
 * damit die Rücknahme (`editor/ruecknahme-werk.ts`, WI-0265 B6g1) denselben Schreibweg in ihrer eigenen Transaktion nimmt, statt ihn zu kopieren. `ruecknahme` gibt es nur dort: Ein Stand, der
 * einmal galt, braucht die Prüfung „ein stillgelegtes Werk lässt sich nur wiederherstellen“ nicht (das Werk kann damals stillgelegt GEWESEN sein und andere Felder trugen schon ihren Wert).
 */
export async function schreibeWerkAendern(
    tx: Sql,
    publicId: string,
    body: Pick<InhalteWerkAendernBody, "baseRevision" | "fields" | "orte">,
    ruecknahme?: WerkRuecknahme,
): Promise<InhalteArbeit> {
    const felder = body.fields ?? {};
    const [werk] = await tx<WerkSperre[]>`
        SELECT id::text AS id, revision::int AS revision, updated_at, title, product_type, edition, series, bf_year, bf_label,
               genre, is_official, editor_note, is_active, state
          FROM adventure WHERE public_id = ${publicId}::uuid FOR UPDATE
    `;
    if (werk === undefined) throw new ApiError(404, "not_found", "Dieses Werk gibt es nicht.");
    if (werk.revision !== body.baseRevision) {
        throw await mapEditConflict(
            tx,
            { kind: "work", publicId },
            { revision: werk.revision, changedAt: werk.updated_at },
        );
    }
    // Ein stillgelegtes Werk lässt sich nur wiederherstellen; was sonst in der Anfrage steht, bleibt unberührt und wird abgelehnt. (Nicht für die Rücknahme: Sie setzt einen Stand, der galt.)
    const wirdAktiv = felder.aktiv ?? werk.is_active;
    const ausserAktiv = Object.keys(felder).some((feld) => feld !== "aktiv");
    if (ruecknahme === undefined && !wirdAktiv && (ausserAktiv || body.orte !== undefined)) {
        throw fehlerbild(
            "fields",
            "state",
            "Ein stillgelegtes Werk lässt sich nur wiederherstellen; erst dann lässt es sich ändern.",
        );
    }

    const aenderungen: Record<string, MapChange> = {};
    const setze: Zeile = {};
    const geaendertFelder = wendeFelderAn(werk, felder, setze, aenderungen, ruecknahme);

    if (body.orte !== undefined) {
        const ergebnis = await wendeOrteAn(tx, werk.id, body.orte);
        if (ergebnis !== undefined) aenderungen["places"] = { before: ergebnis.vorher, after: ergebnis.nachher };
    }

    if (Object.keys(aenderungen).length === 0) {
        // Nichts hat sich geändert (etwa derselbe Titel noch einmal): keine Revision, kein Protokoll.
        return {
            receipt: {
                affected: [{ kind: "work", id: publicId, revision: werk.revision }],
                derivedWork: [],
                warnings: [],
            },
            entries: [],
        };
    }

    // Herkunft je Feld: was die Redaktion geändert hat, trägt den Vermerk „manuell“.
    for (const feld of geaendertFelder) {
        await tx`
            INSERT INTO adventure_field_origin (adventure_id, field, origin)
            VALUES (${werk.id}::bigint, ${feld}, 'manual')
            ON CONFLICT (adventure_id, field) DO UPDATE SET origin = 'manual'
        `;
    }

    const spalten = Object.entries(setze);
    const zuweisungen = spalten.map(([spalte], index) => `${spalte} = $${String(index + 3)}`);
    // Jede Änderung macht das Werk zu einem der Redaktion (Importschutz auf Werksebene).
    zuweisungen.push("source_system = 'editor'");
    const [neu] = await tx.unsafe<{ revision: number }[]>(
        `UPDATE adventure SET ${[...zuweisungen, "revision = $2::bigint"].join(", ")}
          WHERE id = $1::bigint RETURNING revision::int AS revision`,
        [werk.id, werk.revision + 1, ...spalten.map(([, wert]) => wert)] as never[],
    );
    const revision = neu!.revision;
    const titelJetzt = typeof aenderungen["title"]?.after === "string" ? aenderungen["title"].after : werk.title;
    return {
        receipt: { affected: [{ kind: "work", id: publicId, revision }], derivedWork: [], warnings: [] },
        summary: `Werk „${titelJetzt}“ geändert`,
        entries: [
            {
                action: "work.updated",
                workId: publicId,
                revisionBefore: werk.revision,
                revisionAfter: revision,
                changes: aenderungen,
            },
        ],
    };
}

/**
 * Die Felder des Werks gegen den Stand prüfen und die Spalten sammeln. Gibt die Felder des Vertrags zurück, die sich ändern und einen
 * Herkunftsvermerk bekommen (`adventure_field_origin.field`).
 */
function wendeFelderAn(
    werk: WerkSperre,
    felder: NonNullable<InhalteWerkAendernBody["fields"]>,
    setze: Zeile,
    aenderungen: Record<string, MapChange>,
    ruecknahme?: WerkRuecknahme,
): string[] {
    const mitVermerk: string[] = [];
    const merke = (feld: string, spalte: string, vorher: unknown, nachher: string | number | boolean | null): void => {
        if (vorher === nachher) return;
        setze[spalte] = nachher;
        aenderungen[feld] = { before: vorher, after: nachher };
        const vermerk = FELD_HERKUNFT[feld];
        if (vermerk !== undefined) mitVermerk.push(vermerk);
    };
    if (felder.title !== undefined) {
        const titel = titelOhneAuszeichnung(felder.title).trim();
        if (titel === "") throw fehlerbild("fields.title", "required", "Ein Werk braucht einen Titel.");
        merke("title", "title", werk.title, titel);
    }
    if (felder.productType !== undefined) {
        const art = felder.productType.trim();
        if (art === "") throw fehlerbild("fields.productType", "required", "Ein Werk braucht eine Art.");
        merke("productType", "product_type", werk.product_type, art);
    }
    if (felder.edition !== undefined) merke("edition", "edition", werk.edition, nurText(felder.edition));
    if (felder.series !== undefined) merke("series", "series", werk.series, nurText(felder.series));
    if (felder.genre !== undefined) merke("genre", "genre", werk.genre, nurText(felder.genre));
    if (felder.isOfficial !== undefined) merke("isOfficial", "is_official", werk.is_official, felder.isOfficial);
    if (felder.editorNote !== undefined)
        merke("editorNote", "editor_note", werk.editor_note, nurText(felder.editorNote));
    if (felder.bfYear !== undefined && felder.bfYear !== werk.bf_year) {
        merke("bfYear", "bf_year", werk.bf_year, felder.bfYear);
        // Die Jahresangabe in Worten („Praios 1040“) gehörte zum alten Jahr; sie bliebe sonst neben einem anderen Jahr stehen. Die Rücknahme setzt sie auf ihren früheren Wert zurück.
        if (ruecknahme?.bfLabel === undefined && werk.bf_label !== null)
            merke("bfLabel", "bf_label", werk.bf_label, null);
    }
    if (ruecknahme?.bfLabel !== undefined) merke("bfLabel", "bf_label", werk.bf_label, ruecknahme.bfLabel);

    if (felder.aktiv !== undefined && felder.aktiv !== werk.is_active) {
        setze["is_active"] = felder.aktiv;
        // Die Spalten der Stilllegung folgen den Prüfungen `adventure_state_matches_activity` und `adventure_retired_consistent` (0068).
        setze["state"] = felder.aktiv ? "active" : "retired";
        setze["retired_at"] = felder.aktiv ? null : new Date().toISOString();
        setze["retired_origin"] = felder.aktiv ? null : "editor";
        aenderungen["active"] = { before: werk.is_active, after: felder.aktiv };
    }
    return mitVermerk;
}

// ---------------------------------------------------------------------------------------------------------------------
// Die Ortsliste
// ---------------------------------------------------------------------------------------------------------------------

/** Ein Eintrag der Ortsliste, wie er im Protokoll steht. */
interface OrtProtokoll {
    rowId: string;
    name: string;
    role: string;
    kind?: InhalteWerkZielart;
}

/** Ein Ziel, wie es eine neue Zeile braucht: die Spalte des Fremdschlüssels, die interne Nummer und der Name. */
interface NeuesZiel {
    kind: Exclude<InhalteWerkZielart, "path">;
    spalte: "place_id" | "territory_id" | "region_id" | "terrain_peak_id";
    internId: string;
    name: string;
}

const SPALTE_JE_ART: Readonly<Record<NeuesZiel["kind"], NeuesZiel["spalte"]>> = {
    place: "place_id",
    territory: "territory_id",
    area: "region_id",
    peak: "terrain_peak_id",
};

const ZIEL_ARTEN_JE_SPALTE: readonly { spalte: keyof OrtZeile; kind: InhalteWerkZielart }[] = [
    { spalte: "place_id", kind: "place" },
    { spalte: "territory_id", kind: "territory" },
    { spalte: "region_id", kind: "area" },
    { spalte: "terrain_peak_id", kind: "peak" },
    { spalte: "path_id", kind: "path" },
];

const zielSchluessel = (zeile: OrtZeile): string | undefined => {
    const art = ZIEL_ARTEN_JE_SPALTE.find(({ spalte }) => zeile[spalte] !== null);
    return art === undefined ? undefined : `${art.kind}:${String(zeile[art.spalte])}`;
};

/** Ein Eintrag der gewünschten Liste, aufgelöst gegen den Bestand. */
interface Wunsch {
    eintrag: InhalteWerkOrtEintrag;
    role: string;
    vorhanden?: OrtZeile;
    ziel?: NeuesZiel;
    rohname?: string;
}

function rolleGueltig(wert: string, pfad: string): void {
    if (!(INHALTE_WERK_ROLLEN as readonly string[]).includes(wert)) {
        throw fehlerbild(pfad, "enum", "Diese Rolle gibt es nicht.");
    }
}

/**
 * Die Ortsliste auf die gewünschte Folge bringen. Gibt vorher und nachher (die aktiven Zeilen in ihrer Reihenfolge) für das Protokoll
 * zurück, `undefined`, wo sich nichts ändert.
 */
async function wendeOrteAn(
    tx: Sql,
    werkId: string,
    eintraege: readonly InhalteWerkOrtEintrag[],
): Promise<{ vorher: OrtProtokoll[]; nachher: OrtProtokoll[] } | undefined> {
    const zeilen = await tx<OrtZeile[]>`
        SELECT id::text AS id, sort_order, export_ordinal, name_key, dup_ordinal, raw_name, role, target_state, state, is_active,
               source_system, place_id::text AS place_id, territory_id::text AS territory_id, region_id::text AS region_id,
               terrain_peak_id::text AS terrain_peak_id, path_id::text AS path_id
          FROM adventure_place WHERE adventure_id = ${werkId}::bigint
         ORDER BY sort_order, export_ordinal, id
         FOR UPDATE
    `;
    const nachId = new Map(zeilen.map((zeile) => [zeile.id, zeile]));
    const aktivVorher = zeilen.filter((zeile) => zeile.is_active && zeile.state === "active");

    // --- Wünsche prüfen und gegen den Bestand auflösen ---
    const gesehenZeilen = new Set<string>();
    const wuensche: Wunsch[] = [];
    for (const [index, eintrag] of eintraege.entries()) {
        const pfad = `orte.${String(index)}`;
        rolleGueltig(eintrag.role, `${pfad}.role`);
        if ("rowId" in eintrag) {
            const vorhanden = nachId.get(eintrag.rowId);
            if (vorhanden === undefined) {
                throw fehlerbild(`${pfad}.rowId`, "unknown", "Diese Zeile gibt es nicht mehr; der Stand ist veraltet.");
            }
            if (gesehenZeilen.has(eintrag.rowId)) {
                throw fehlerbild(`${pfad}.rowId`, "unique", "Eine Zeile steht in der Liste nur einmal.");
            }
            gesehenZeilen.add(eintrag.rowId);
            wuensche.push({ eintrag, role: eintrag.role, vorhanden });
        } else if ("carrierId" in eintrag) {
            const tafeln = TRAEGER[eintrag.kind];
            const [ziel] = await tx.unsafe<{ id: string; name: string | null; is_active: boolean }[]>(
                `SELECT id::text AS id, name, is_active FROM ${tafeln.carrier} WHERE public_id = $1::uuid`,
                [eintrag.carrierId],
            );
            if (ziel === undefined) throw new ApiError(404, "not_found", "Dieses Objekt gibt es nicht.");
            if (!ziel.is_active) {
                throw fehlerbild(
                    `${pfad}.carrierId`,
                    "state",
                    "An ein stillgelegtes Objekt lässt sich kein Werk hängen.",
                );
            }
            const name = (ziel.name ?? "").trim();
            if (name === "") throw fehlerbild(`${pfad}.carrierId`, "required", "Dieses Objekt hat keinen Namen.");
            wuensche.push({
                eintrag,
                role: eintrag.role,
                ziel: { kind: eintrag.kind, spalte: SPALTE_JE_ART[eintrag.kind], internId: ziel.id, name },
            });
        } else {
            const rohname = eintrag.rawName.trim();
            if (rohname === "") throw fehlerbild(`${pfad}.rawName`, "required", "Ein Name darf nicht leer sein.");
            wuensche.push({ eintrag, role: eintrag.role, rohname });
        }
    }

    // Dieselbe Aussage steht nur einmal: dasselbe Ziel (oder derselbe ungeklärte Name) in derselben Rolle.
    const aussagen = new Set<string>();
    for (const [index, wunsch] of wuensche.entries()) {
        const ziel =
            wunsch.ziel !== undefined
                ? `${wunsch.ziel.kind}:${wunsch.ziel.internId}`
                : wunsch.vorhanden !== undefined
                  ? (zielSchluessel(wunsch.vorhanden) ?? `name:${wunsch.vorhanden.name_key}`)
                  : `name:${(wunsch.rohname ?? "").toLowerCase()}`;
        const schluessel = `${ziel}|${wunsch.role}`;
        if (aussagen.has(schluessel)) {
            throw fehlerbild(
                `orte.${String(index)}`,
                "unique",
                "Dasselbe Ziel steht mit derselben Rolle nur einmal in der Liste.",
            );
        }
        aussagen.add(schluessel);
    }

    // --- Was sich ändert ---
    const behalten = new Set(
        wuensche.flatMap((wunsch) => (wunsch.vorhanden === undefined ? [] : [wunsch.vorhanden.id])),
    );
    const entfernen = aktivVorher.filter((zeile) => !behalten.has(zeile.id));
    const zurueckholen = wuensche.filter(
        (wunsch) =>
            wunsch.vorhanden !== undefined && !(wunsch.vorhanden.is_active && wunsch.vorhanden.state === "active"),
    );
    const neue = wuensche.filter((wunsch) => wunsch.vorhanden === undefined);
    const rollenwechsel = wuensche.filter(
        (wunsch) =>
            wunsch.vorhanden !== undefined &&
            wunsch.vorhanden.is_active &&
            wunsch.vorhanden.state === "active" &&
            wunsch.vorhanden.role !== wunsch.role,
    );

    // Die Folge der Zeilen, die schon aktiv waren und bleiben, gegen die gewünschte: gleich, und alles Neue am Ende, dann bleiben die Nummern.
    const bleibtAktiv = wuensche.filter(
        (wunsch) => wunsch.vorhanden !== undefined && wunsch.vorhanden.is_active && wunsch.vorhanden.state === "active",
    );
    const alteFolge = aktivVorher.filter((zeile) => behalten.has(zeile.id)).map((zeile) => zeile.id);
    const neueFolge = bleibtAktiv.map((wunsch) => (wunsch.vorhanden as OrtZeile).id);
    const folgeGleich =
        alteFolge.length === neueFolge.length && alteFolge.every((id, index) => id === neueFolge[index]);
    const neuesAmEnde = wuensche.every(
        (wunsch, index) =>
            (wunsch.vorhanden !== undefined && wunsch.vorhanden.is_active && wunsch.vorhanden.state === "active") ||
            wuensche
                .slice(index)
                .every((spaeter) => !(spaeter.vorhanden?.is_active && spaeter.vorhanden.state === "active")),
    );
    const neuNummerieren = !(folgeGleich && neuesAmEnde);

    const nichtsZuTun =
        entfernen.length === 0 &&
        zurueckholen.length === 0 &&
        neue.length === 0 &&
        rollenwechsel.length === 0 &&
        folgeGleich;
    if (nichtsZuTun) return undefined;

    const vorher: OrtProtokoll[] = aktivVorher.map((zeile) => protokoll(zeile, zeile.role));

    // --- Stilllegen ---
    for (const zeile of entfernen) {
        // Eine Zeile aus Legacy wird unterdrückt (der Zug belebt sie nie wieder), eine eigene gelöst.
        const neuerState = zeile.source_system === "legacy" ? "suppressed" : "retired";
        await tx`
            UPDATE adventure_place
               SET state = ${neuerState}, is_active = FALSE, retired_at = now(), retired_origin = 'editor', source_system = 'editor',
                   updated_at = now()
             WHERE id = ${zeile.id}::bigint
        `;
    }

    // --- Nummern: erst alle zu bewegenden Zeilen auf freie negative Nummern, dann die endgültigen (der Schlüssel ist eindeutig) ---
    const maximum = zeilen.reduce((m, zeile) => Math.max(m, zeile.sort_order), -1);
    interface Ziel {
        wunsch: Wunsch;
        sortOrder: number;
    }
    const endgueltig: Ziel[] = [];
    if (neuNummerieren) {
        for (const [index, wunsch] of wuensche.entries()) endgueltig.push({ wunsch, sortOrder: index });
    } else {
        // Die Nummern der bleibenden Zeilen bleiben; was dazukommt oder zurückkehrt, hängt hinten an.
        let naechste = maximum + 1;
        for (const wunsch of wuensche) {
            const istAktiv =
                wunsch.vorhanden !== undefined && wunsch.vorhanden.is_active && wunsch.vorhanden.state === "active";
            endgueltig.push({ wunsch, sortOrder: istAktiv ? (wunsch.vorhanden as OrtZeile).sort_order : naechste++ });
        }
    }
    const bewegt = endgueltig.filter(
        ({ wunsch, sortOrder }) =>
            wunsch.vorhanden !== undefined &&
            (wunsch.vorhanden.sort_order !== sortOrder ||
                !(wunsch.vorhanden.is_active && wunsch.vorhanden.state === "active")),
    );
    let zwischen = -1;
    for (const { wunsch } of bewegt) {
        await tx`UPDATE adventure_place SET sort_order = ${zwischen} WHERE id = ${(wunsch.vorhanden as OrtZeile).id}::bigint`;
        zwischen -= 1;
    }
    // Die belegten Schlüssel (Nummer, Schlüsselname, Ordnungszahl): alle Zeilen, die nicht bewegt werden, und alles, was gleich vergeben wird.
    const bewegteIds = new Set(bewegt.map(({ wunsch }) => (wunsch.vorhanden as OrtZeile).id));
    const belegt = new Set(
        zeilen
            .filter((zeile) => !bewegteIds.has(zeile.id))
            .map((zeile) => `${String(zeile.sort_order)}|${zeile.name_key}|${String(zeile.dup_ordinal)}`),
    );
    const naechsteOrdnung = (sortOrder: number, nameKey: string): number => {
        let dup = 0;
        while (belegt.has(`${String(sortOrder)}|${nameKey}|${String(dup)}`)) dup += 1;
        belegt.add(`${String(sortOrder)}|${nameKey}|${String(dup)}`);
        return dup;
    };

    const nachher: OrtProtokoll[] = [];
    for (const { wunsch, sortOrder } of endgueltig) {
        const zeile = wunsch.vorhanden;
        if (zeile !== undefined) {
            if (bewegteIds.has(zeile.id)) {
                // Neu nummeriert oder zurückgeholt: die Nummer, die Schlüsselfolge und der Zustand folgen der Liste.
                const ordnung = naechsteOrdnung(sortOrder, zeile.name_key);
                await tx`
                    UPDATE adventure_place
                       SET sort_order = ${sortOrder}, export_ordinal = ${sortOrder}, dup_ordinal = ${ordnung},
                           role = ${wunsch.role}, state = 'active', is_active = TRUE, retired_at = NULL, retired_origin = NULL,
                           source_system = 'editor', updated_at = now()
                     WHERE id = ${zeile.id}::bigint
                `;
            } else if (wunsch.role !== zeile.role) {
                // Nur die Rolle: Nummer und Gleichstand der Zeile bleiben, wie Legacy sie führt.
                await tx`
                    UPDATE adventure_place SET role = ${wunsch.role}, source_system = 'editor', updated_at = now()
                     WHERE id = ${zeile.id}::bigint
                `;
            }
            const art = ZIEL_ARTEN_JE_SPALTE.find(({ spalte }) => zeile[spalte] !== null);
            nachher.push({
                rowId: zeile.id,
                name: zeile.raw_name,
                role: wunsch.role,
                ...(art === undefined ? {} : { kind: art.kind }),
            });
            continue;
        }
        // Eine neue Zeile.
        const name = wunsch.ziel?.name ?? wunsch.rohname ?? "";
        const [schluessel] = await tx<{ k: string }[]>`SELECT lower(btrim(${name})) AS k`;
        const nameKey = schluessel!.k;
        const ordnung = naechsteOrdnung(sortOrder, nameKey);
        const aufgeloest = wunsch.ziel !== undefined;
        const [eingefuegt] = await tx.unsafe<{ id: string }[]>(
            `INSERT INTO adventure_place (adventure_id, sort_order, export_ordinal, name_key, dup_ordinal, raw_name, role, target_state,
                                          resolved_by, ${wunsch.ziel?.spalte ?? "place_id"}, target_origin, legacy_origin, state,
                                          source_system, is_active)
             VALUES ($1::bigint, $2, $3, $4, $5, $6, $7, $8, $9, $10::bigint, 'editor', 'manual', 'active', 'editor', TRUE)
             RETURNING id::text`,
            [
                werkId,
                sortOrder,
                sortOrder,
                nameKey,
                ordnung,
                name,
                wunsch.role,
                aufgeloest ? "resolved" : "unresolved",
                aufgeloest ? "public_id" : null,
                wunsch.ziel?.internId ?? null,
            ] as never[],
        );
        nachher.push({
            rowId: eingefuegt!.id,
            name,
            role: wunsch.role,
            ...(wunsch.ziel === undefined ? {} : { kind: wunsch.ziel.kind }),
        });
    }
    return { vorher, nachher };
}

function protokoll(zeile: OrtZeile, role: string): OrtProtokoll {
    const art = ZIEL_ARTEN_JE_SPALTE.find(({ spalte }) => zeile[spalte] !== null);
    return { rowId: zeile.id, name: zeile.raw_name, role, ...(art === undefined ? {} : { kind: art.kind }) };
}
