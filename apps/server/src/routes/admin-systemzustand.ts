import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { AVENTURIA, AdminSystemzustand } from "@avesmaps3d/shared";
import { ADMIN_ERRORS, adminSession } from "../auth/admin-guard.ts";
import { protect } from "../auth/plugin.ts";
import { standJetzt } from "../jobs/stand-datei.ts";
import { createBackupStatusReader, createSystemStatusReader } from "../system/status-files.ts";
import { readSystemzustand } from "../system/systemzustand.ts";
import { STARTED_AT } from "./admin-system.ts";

/**
 * Der Systemzustand in der Systemsteuerung (WI-0127 SYS-8, SYS-0001 §4.2, §6.3):
 *
 *     GET /api/admin/system/health   Komponenten, Auslastung mit Verlauf, Datenbank, Platte, Tür, Dienste   view_operations (V)
 *
 * Nur lesen; es gibt nichts zu schalten und nichts zu protokollieren. Die Statusdateien liest je Instanz ein Leser mit 30 s
 * Zwischenspeicher (`status-files.ts`), die Oberfläche fragt alle 30 s, solange der Eintrag offen ist.
 *
 * 🔴 `system.json` beschreibt auf oberster Ebene die Stage; Production nimmt Tür und Dienste aus ihrem eigenen Abschnitt
 * (`systemzustand.ts`, `fuerUmgebung`). Deshalb geht die Umgebung hier mit hinein.
 */
export const adminSystemzustandRoutes: FastifyPluginAsyncTypebox = async (app) => {
    const warn = (message: string): void => app.log.warn(message);
    const datei = createSystemStatusReader(app.config.systemzustand?.statusFile, { warn });
    const sicherung = createBackupStatusReader(app.config.backup?.statusFile, { warn });

    app.get(
        "/api/admin/system/health",
        { ...protect("view_operations"), schema: { response: { 200: AdminSystemzustand, ...ADMIN_ERRORS } } },
        async (request) => {
            await adminSession(request);
            return readSystemzustand({
                database: app.database!,
                mapDomainId: AVENTURIA.mapDomain,
                releaseId: app.config.releaseId,
                startedAt: STARTED_AT,
                routing: app.routeRunner?.status(),
                routingSpeicher: (await app.routeRunner?.speicher?.()) ?? null,
                jobsLebenszeichen: app.jobLebenszeichen?.aktuell(),
                datei: await datei.read(),
                sicherung,
                tileRoot: app.config.tileRoot,
                mediaRoot: app.config.mediaRoot,
                martinUrl: app.config.systemzustand?.martinUrl,
                production: app.config.auth?.environment === "production",
                warteschlange: await standJetzt(app.warteschlangeStand),
                now: new Date(),
            });
        },
    );
};
