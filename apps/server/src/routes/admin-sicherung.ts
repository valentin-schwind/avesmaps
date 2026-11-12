import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import {
    AdminSicherung,
    OperationReceipt,
    SicherungStartBody,
    WIEDERHERSTELLUNG_UMFAENGE,
    WiederherstellungBody,
    opsId,
    type KanalStatus,
    type SicherungWiederherstellung,
} from "@avesmaps3d/shared";
import { ADMIN_ERRORS, actorFields, adminOperation, adminSession } from "../auth/admin-guard.ts";
import { protect } from "../auth/plugin.ts";
import type { Queryable } from "../database.ts";
import { ApiError } from "../http/api-error.ts";
import { KanalFehler, kanalFehler } from "../kanal/db.ts";
import { BACKUP_EVENT, entferneAuftrag, leseAuftrag, schreibeAuftrag } from "../system/sicherung.ts";
import { backupZustand, createBackupStatusReader } from "../system/status-files.ts";

/**
 * Die Sicherung in der Systemsteuerung (WI-0127 SYS-9, SYS-0001 §6.5, §9e).
 *
 *     GET  /api/admin/system/backup         Zustand, letzter Lauf, außer Haus, Probelauf, Teile, Auftrag     view_operations (V)
 *     POST /api/admin/system/backup/start   { operationId }  „Sicherung jetzt“                              run_backup (V)
 *     POST /api/admin/system/backup/wiederherstellung  { operationId, sicherung, umfang, grund }           request_restore (S)
 *
 * - Gelesen wird Claudios Statusdatei (`BACKUP_STATUS_FILE`) über `status-files.ts`, nie roh an den Browser.
 * - Der Start legt die Auftragsdatei in `BACKUP_REQUEST_DIR` (`system/sicherung.ts`) und schreibt danach genau ein Ereignis
 *   `system.backup_triggered` mit der `operation_id` (Protokollpflicht, SYS-0001 §9d.2). Scheitert das Schreiben: 503
 *   `backup_write_failed`, kein Ereignis. Scheitert das Protokoll: Die Auftragsdatei wird zurückgenommen.
 * - Ohne `BACKUP_REQUEST_DIR`: 503 `backup_unavailable` (die Oberfläche zeigt den Knopf dann gesperrt mit Satz). Liegt schon ein Auftrag:
 *   409 `backup_pending`. Die Drossel (ein manueller Lauf je 30 min) ist Claudios Seite; ihr Ergebnis steht in `last_request`.
 * - Schreibklasse `security`: Eine Sicherung anstoßen ist ein Sicherheitshandgriff; keine Sperre hält ihn an (er ändert nichts und
 *   überschreibt nichts).
 * - **Wiederherstellung beantragen** (WI-0124 KANAL-0001 W10, K5): Der Antrag wird ein Vorgang der Art `wiederherstellung` im Betreiber-Kanal
 *   (dringend, zuständig Claudio) samt genau einem Ereignis `system.restore_requested` in derselben Transaktion. „Die letzte“ Sicherung
 *   bindet der Server an die Zeit aus der Statusdatei. Aus der App wird nie zurückgespielt; Claudio prüft und fragt vor dem Zurückspielen
 *   nach. Wer `request_restore` hat, sieht im GET den jüngsten offenen Antrag (`wiederherstellung`), den Kanal selbst nur Betreiber.
 */

/** Der jüngste offene Wiederherstellungsantrag dieser Umgebung. */
async function offenerAntrag(db: Queryable, environment: string): Promise<SicherungWiederherstellung | null> {
    const [row] = await db<
        { id: string; status: KanalStatus; gemeldet_at: Date; umfang: string | null; sicherung: string | null }[]
    >`
        SELECT id::text, status, gemeldet_at, kontext->>'umfang' AS umfang, kontext->>'sicherung' AS sicherung
          FROM avesmaps_kanal.vorgang
         WHERE environment = ${environment} AND art = 'wiederherstellung' AND status <> 'abgenommen'
         ORDER BY id DESC
         LIMIT 1
    `;
    const umfang = WIEDERHERSTELLUNG_UMFAENGE.find((wert) => wert === row?.umfang);
    if (row === undefined || umfang === undefined) return null;
    return {
        ops: opsId(Number(row.id)),
        status: row.status,
        beantragtAt: row.gemeldet_at.toISOString(),
        umfang,
        sicherung: row.sicherung ?? "aelter",
    };
}
export const adminSicherungRoutes: FastifyPluginAsyncTypebox = async (app) => {
    const reader = createBackupStatusReader(app.config.backup?.statusFile, {
        warn: (message) => app.log.warn(message),
    });

    app.get(
        "/api/admin/system/backup",
        { ...protect("view_operations"), schema: { response: { 200: AdminSicherung, ...ADMIN_ERRORS } } },
        async (request) => {
            const session = await adminSession(request);
            const darfAntrag = (await request.auth.capabilities()).has("request_restore");
            const now = new Date();
            const dir = app.config.backup?.requestDir;
            const [inhalt, wartend, wiederherstellung] = await Promise.all([
                reader.read(),
                dir === undefined || dir === "" ? Promise.resolve(null) : leseAuftrag(dir).catch(() => null),
                darfAntrag ? offenerAntrag(app.database!, session.environment) : Promise.resolve(null),
            ]);
            const anstossen = { moeglich: dir !== undefined && dir !== "", wartend, letzteAntwort: null };
            if (inhalt.art !== "gelesen") {
                return {
                    now: now.toISOString(),
                    zustand: inhalt.art === "fehlt" ? ("nicht_eingerichtet" as const) : ("unbekannt" as const),
                    stand: null,
                    letzterLauf: null,
                    letzteErfolgreiche: null,
                    ausserHaus: { eingerichtet: null, geprueftAm: null },
                    probelauf: null,
                    naechsterLauf: null,
                    aufbewahrung: null,
                    teile: [],
                    neueresFormat: false,
                    wiederherstellung,
                    anstossen,
                };
            }
            // Die letzte Antwort von Claudios Seite gehört zum Anstoßen, nicht zu den Feldern der Karte.
            const { letzteAnfrage, ...felder } = inhalt.stand;
            return {
                now: now.toISOString(),
                zustand: backupZustand(felder, now),
                ...felder,
                wiederherstellung,
                anstossen: { ...anstossen, letzteAntwort: letzteAnfrage },
            };
        },
    );

    app.post(
        "/api/admin/system/backup/start",
        {
            ...protect("run_backup", { writeClass: "security" }),
            schema: { body: SicherungStartBody, response: { 200: OperationReceipt, ...ADMIN_ERRORS } },
        },
        async (request) => {
            const session = await adminSession(request);
            const dir = app.config.backup?.requestDir;
            if (dir === undefined || dir === "") {
                throw new ApiError(503, "backup_unavailable", "Auf dieser Umgebung gibt es keine Sicherung.");
            }
            const { operationId } = request.body;
            let abgelegt = false;
            try {
                return await adminOperation(
                    app.database!,
                    session,
                    { operationId, body: { action: "backup.start" } },
                    async () => {
                        if ((await leseAuftrag(dir).catch(() => null)) !== null) {
                            throw new ApiError(409, "backup_pending", "Ein Auftrag wartet schon auf die Abholung.");
                        }
                        try {
                            await schreibeAuftrag(dir, operationId, new Date());
                        } catch (error) {
                            request.log.warn(
                                { code: (error as NodeJS.ErrnoException).code },
                                "Auftragsdatei der Sicherung nicht geschrieben",
                            );
                            throw new ApiError(
                                503,
                                "backup_write_failed",
                                "Der Auftrag für die Sicherung ließ sich nicht ablegen.",
                            );
                        }
                        abgelegt = true;
                        return {
                            receipt: { environment: session.environment, affected: [], derivedWork: [], warnings: [] },
                            event: { ...actorFields(session, request), action: BACKUP_EVENT, details: {} },
                        };
                    },
                );
            } catch (error) {
                // Kein Auftrag ohne seinen Eintrag im Protokoll.
                if (abgelegt) await entferneAuftrag(dir, operationId);
                throw error;
            }
        },
    );

    app.post(
        "/api/admin/system/backup/wiederherstellung",
        {
            ...protect("request_restore", { writeClass: "security" }),
            schema: { body: WiederherstellungBody, response: { 200: OperationReceipt, ...ADMIN_ERRORS } },
        },
        async (request) => {
            const session = await adminSession(request);
            const { operationId, sicherung, umfang, grund } = request.body;
            // „Die letzte“ heißt die letzte erfolgreiche laut Statusdatei, zur Zeit des Antrags; der Browser nennt keine Zeit.
            let welche: string = sicherung;
            if (sicherung === "letzte") {
                const inhalt = await reader.read();
                const zeit = inhalt.art === "gelesen" ? inhalt.stand.letzteErfolgreiche : null;
                welche = `letzte:${zeit ?? "unbekannt"}`;
            }
            return adminOperation(
                app.database!,
                session,
                { operationId, body: { action: "backup.wiederherstellung", sicherung, umfang } },
                async (tx) => {
                    let id: number;
                    try {
                        const [row] = await tx<{ id: string }[]>`
                            SELECT avesmaps_kanal.kanal_wiederherstellung(
                                ${operationId}::uuid, ${session.environment}, ${session.personId}::uuid, ${welche}, ${umfang},
                                ${grund.trim()}
                            ) AS id
                        `;
                        id = Number(row?.id);
                    } catch (roh) {
                        const error = kanalFehler(roh);
                        if (error instanceof KanalFehler) throw new ApiError(422, "restore_invalid", error.message);
                        throw error;
                    }
                    return {
                        receipt: {
                            environment: session.environment,
                            affected: [{ kind: "kanal_vorgang", id: opsId(id) }],
                            derivedWork: [],
                            warnings: [],
                        },
                        event: {
                            ...actorFields(session, request),
                            action: "system.restore_requested",
                            targetRef: opsId(id),
                            details: { ops: opsId(id), sicherung: welche, umfang },
                        },
                    };
                },
            );
        },
    );
};
