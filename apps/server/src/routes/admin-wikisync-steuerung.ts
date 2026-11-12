import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import {
    AVENTURIA,
    OperationReceipt,
    WIKISYNC_STAND_URL,
    WIKISYNC_TAFELN_URL,
    WikisyncStand,
    WikisyncTafeln,
    WikisyncTafelnBody,
    WIKI_DUMP_HOLEN_ART,
    rechteVon,
} from "@avesmaps3d/shared";
import { ADMIN_ERRORS, actorFields, adminOperation, adminSession, editConflict } from "../auth/admin-guard.ts";
import { protect } from "../auth/plugin.ts";
import type { Queryable } from "../database.ts";
import { ApiError } from "../http/api-error.ts";
import { planerAktiv } from "../jobs/overview.ts";
import { standJetzt } from "../jobs/stand-datei.ts";
import { leseWarteumstand, umstandMitStand } from "../jobs/wartegrund.ts";
import { rechteHier } from "../kanal/schalter.ts";
import { aendereKanonTafel, leseKanonTafel, type KanonTafelAenderung } from "../kanon/tafel.ts";
import { zaehleKanonTraeger, type KanonTafelZahlen } from "../kanon/tafel-zahlen.ts";
import { isMissingTable } from "../system/state-row.ts";
import { legacyZugImStand } from "../wiki/abgleich/legacy-zug.ts";
import { leseWikisyncStand } from "../wiki/abgleich/stand.ts";

/**
 * Der Stand des WikiSync und die zwei Tafeln des Kanon-Etiketts für den Reiter „WikiSync“ (WI-0253 UI-1; Vertrag `system/wikisync-steuerung.ts`):
 *
 *     GET  /api/admin/wikisync/stand    der Dump im Ordner, die jüngste Vorschau, die laufenden Aufträge          view_wikisync (ab `tester`)
 *     GET  /api/admin/wikisync/tafeln   Namensräume und Objektarten der Umgebung samt der Zahl ihrer Objekte      view_wikisync (ab `tester`)
 *     POST /api/admin/wikisync/tafeln   beide Tafeln in einem Schritt, eine Revision                               manage_canon_tables (`admin`), in Production + Passkey
 *
 * - **Schreibklasse `system`:** eine Einstellung der Umgebung (wie die Zoombänder); die Systemsperre hält sie an. Genau ein Ereignis
 *   `system.kanon_tafel_geaendert` (`anzahl`, `zeilen`) in derselben Transaktion.
 * - Das Speichern rechnet KEINE Etiketten neu: Rang 4 (Objektarten) gilt beim Lesen sofort; Rang 1 (Namensräume) steht in den Kanon-Zeilen und folgt erst,
 *   wenn sie neu berechnet werden – das ist eine Ableitung der Karte und bleibt hinter dem Map Mutation Guard (`kanon/neu-berechnen.ts`).
 * - 🔴 Keine Route hier fragt das Wiki.
 */

const EVENT = "system.kanon_tafel_geaendert" as const;
const TARGET = "wikisync:kanon-tafeln" as const;

type Zeile = Record<string, unknown>;

const zeit = (wert: unknown): string | null => (wert instanceof Date ? wert.toISOString() : null);

/** Wer eine gespeicherte Zeile zuletzt geändert hat, je Raum und je Art. */
async function aenderungen(db: Queryable): Promise<{ raeume: Map<number, Zeile>; arten: Map<string, Zeile> }> {
    const lesen = async (abfrage: () => Promise<Zeile[]>): Promise<Zeile[]> => {
        try {
            return await abfrage();
        } catch (error) {
            if (isMissingTable(error)) return [];
            throw error;
        }
    };
    const raeume = await lesen(
        () => db<Zeile[]>`
            SELECT s.ns, s.changed_at, COALESCE(p.display_name, s.changed_by_label) AS wer
              FROM wiki_namespace_setting s LEFT JOIN avesmaps_auth.person p ON p.id = s.changed_by
        `,
    );
    const arten = await lesen(
        () => db<Zeile[]>`
            SELECT s.object_kind, s.changed_at, COALESCE(p.display_name, s.changed_by_label) AS wer
              FROM canon_object_label_setting s LEFT JOIN avesmaps_auth.person p ON p.id = s.changed_by
        `,
    );
    return {
        raeume: new Map(raeume.map((zeile) => [Number(zeile["ns"]), zeile])),
        arten: new Map(arten.map((zeile) => [String(zeile["object_kind"]), zeile])),
    };
}

async function leseTafeln(db: Queryable, jetzt: Date): Promise<WikisyncTafeln> {
    const stand = await leseKanonTafel(db);
    let zahlen: KanonTafelZahlen | null = null;
    try {
        zahlen = await zaehleKanonTraeger(db, stand.namensraeume);
    } catch (error) {
        if (!isMissingTable(error)) throw error;
    }
    const wer = stand.source === "database" ? await aenderungen(db) : { raeume: new Map(), arten: new Map() };
    return {
        jetzt: jetzt.toISOString(),
        quelle: stand.source === "database" ? "datenbank" : "vorgabe",
        revision: stand.revision,
        namensraeume: stand.namensraeume.map((zeile) => {
            const geaendert = wer.raeume.get(zeile.ns);
            return {
                ...zeile,
                objekte: zahlen === null ? null : (zahlen.jeRaum.get(zeile.ns) ?? 0),
                geaendertAm: zeit(geaendert?.["changed_at"]),
                geaendertVon: (geaendert?.["wer"] as string | null | undefined) ?? null,
            };
        }),
        objektarten: stand.objektarten.map((zeile) => {
            const geaendert = wer.arten.get(zeile.art);
            return {
                ...zeile,
                objekte: zahlen === null ? null : zahlen.ohne[zeile.art],
                geaendertAm: zeit(geaendert?.["changed_at"]),
                geaendertVon: (geaendert?.["wer"] as string | null | undefined) ?? null,
            };
        }),
    };
}

export const adminWikisyncSteuerungRoutes: FastifyPluginAsyncTypebox = async (app) => {
    app.get(
        WIKISYNC_STAND_URL,
        { ...protect("view_wikisync"), schema: { response: { 200: WikisyncStand, ...ADMIN_ERRORS } } },
        async (request) => {
            await adminSession(request);
            // Ein Legacy-Zug einer anderen Umgebung desselben Hosts hält die schweren Aufträge auch hier an: Der Stand des Dirigenten weiß davon.
            const jetzt = new Date();
            const database = app.database!;
            const stand = await standJetzt(app.warteschlangeStand, jetzt);
            // Das Holen des Dumps führt Claudios Korridor aus: Sein wartender Auftrag sagt „wartet auf die Abholung“ (derselbe Wartegrund wie beim Abzug für lokal).
            const aktiv = await planerAktiv(database, AVENTURIA.mapDomain, stand).catch(() => false);
            const umstand = umstandMitStand(
                await leseWarteumstand(database, {
                    plannerActive: aktiv,
                    pickupKinds: new Set([WIKI_DUMP_HOLEN_ART]),
                }),
                stand.lage,
                stand.umgebung,
            );
            return leseWikisyncStand(database, jetzt, process.env, {
                zugAnderswo: legacyZugImStand(stand.lage),
                umstand,
            });
        },
    );

    app.get(
        WIKISYNC_TAFELN_URL,
        { ...protect("view_wikisync"), schema: { response: { 200: WikisyncTafeln, ...ADMIN_ERRORS } } },
        async (request) => {
            await adminSession(request);
            return leseTafeln(app.database!, new Date());
        },
    );

    app.post(
        WIKISYNC_TAFELN_URL,
        {
            // Der frische Passkey nur in Production (Vali 2026-10-27): Auf der Stage und lokal speichert jeder Klick sofort.
            ...protect("manage_canon_tables", {
                ...(app.authConfig.environment === "production" ? { confirm: "passkey" as const } : {}),
                writeClass: "system",
            }),
            schema: { body: WikisyncTafelnBody, response: { 200: OperationReceipt, ...ADMIN_ERRORS } },
        },
        async (request) => {
            const session = await adminSession(request);
            const { operationId, baseRevision, namensraeume = [], entfernen = [], objektarten = [] } = request.body;
            const liste: KanonTafelAenderung[] = [
                ...namensraeume.map((zeile) => ({ tafel: "namensraum" as const, ns: zeile.ns, zeile })),
                ...entfernen.map((ns) => ({ tafel: "namensraum" as const, ns, zeile: null })),
                ...objektarten.map((zeile) => ({ tafel: "objektart" as const, art: zeile.art, zeile })),
            ];
            if (liste.length === 0) {
                throw new ApiError(400, "validation_failed", "Es gibt nichts zu speichern.");
            }
            const doppelt = new Set<string>();
            for (const eintrag of liste) {
                const schluessel = eintrag.tafel === "namensraum" ? `ns:${String(eintrag.ns)}` : `art:${eintrag.art}`;
                if (doppelt.has(schluessel)) {
                    throw new ApiError(400, "validation_failed", "Eine Zeile steht zweimal in der Änderung.", {
                        row: schluessel,
                    });
                }
                doppelt.add(schluessel);
            }
            const rechte = rechteHier(rechteVon(session), app.authConfig.kanal);
            return adminOperation(
                app.database!,
                session,
                { operationId, body: { action: "kanon_tafeln.set", aenderungen: liste, baseRevision } },
                async (tx) => {
                    const ergebnis = await aendereKanonTafel(tx, {
                        aenderungen: liste,
                        baseRevision,
                        actor: { personId: session.personId, label: session.displayName, capabilities: rechte },
                        conflict: (current) =>
                            editConflict(app.database!, {
                                currentRevision: current.revision,
                                changedAt: current.changedAt,
                                targetRef: TARGET,
                                actions: [EVENT],
                            }),
                    });
                    return {
                        receipt: { environment: session.environment, affected: [], derivedWork: [], warnings: [] },
                        event: {
                            ...actorFields(session, request),
                            action: EVENT,
                            targetRef: TARGET,
                            details: { anzahl: ergebnis.geaendert.length, zeilen: ergebnis.geaendert },
                        },
                    };
                },
            );
        },
    );
};
