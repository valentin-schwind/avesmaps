import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { noStore } from "../auth/admin-guard.ts";
import { adminAbgleicheRoutes } from "./admin-abgleiche.ts";
import { adminAbzugRoutes } from "./admin-abzug.ts";
import { adminSicherungRoutes } from "./admin-sicherung.ts";
import { adminHoehenmodellRoutes } from "./admin-hoehenmodell.ts";
import { adminSystemzustandRoutes } from "./admin-systemzustand.ts";
import { adminInhalteRoutes } from "./admin-inhalte.ts";
import { adminWegfindungRoutes } from "./admin-wegfindung.ts";
import { adminKarteneinstellungenRoutes } from "./admin-karteneinstellungen.ts";
import { adminMapSeriesRoutes } from "./admin-map-series.ts";
import { adminMapSeriesUploadRoutes } from "./admin-map-series-uploads.ts";
import { adminMapSeriesProductionRoutes } from "./admin-map-series-production.ts";
import { adminZoombaenderRoutes } from "./admin-zoombaender.ts";
import { adminWettermodellRoutes } from "./wetter.ts";
import { adminAuditRoutes } from "./admin-audit.ts";
import { adminCapabilityRoutes } from "./admin-capabilities.ts";
import { adminSonderrollenRoutes } from "./admin-sonderrollen.ts";
import { adminCredentialRoutes } from "./admin-credentials.ts";
import { adminInvitationRoutes } from "./admin-invitations.ts";
import { adminLegacyRoutes } from "./admin-legacy.ts";
import { adminPeopleRoutes } from "./admin-people.ts";
import { adminSystemRoutes } from "./admin-system.ts";
import { kanalRoutes } from "./kanal.ts";
import { freigabeRoutes } from "./freigabe.ts";
import { adminUmgebungenRoutes } from "./admin-umgebungen.ts";
import { adminWikisyncRoutes } from "./admin-wikisync.ts";
import { adminWikisyncRegelnRoutes } from "./admin-wikisync-regeln.ts";
import { adminWikisyncSteuerungRoutes } from "./admin-wikisync-steuerung.ts";
import { adminReleaseTestRoutes } from "./admin-release-test.ts";
import { discordRoutes } from "./discord.ts";
import { newsRoutes } from "./news.ts";
import { versionenRoutes } from "./versionen.ts";

/**
 * Die Verwaltung unter `/api/admin/*` (WI-0120 A7). Jede Route trägt ihr Recht (`protect`), jede Antwort `no-store`; die
 * Herkunftsprüfung für schreibende Anfragen sitzt am Root (`plugin.ts`). Reiter und Rechte: AUTH-0001 §12.2;
 * der Betriebszustand: SYS-0001 §4.2 (WI-0127 SYS-2); die Abgleiche: SYS-0001 §9b (WI-0127 SYS-14).
 */
export const adminRoutes: FastifyPluginAsyncTypebox = async (app) => {
    noStore(app);
    await app.register(adminPeopleRoutes);
    await app.register(adminCredentialRoutes);
    await app.register(adminCapabilityRoutes);
    await app.register(adminSonderrollenRoutes);
    await app.register(adminInvitationRoutes);
    await app.register(adminAuditRoutes);
    await app.register(adminLegacyRoutes);
    await app.register(adminSystemRoutes);
    await app.register(adminAbgleicheRoutes);
    await app.register(adminSicherungRoutes);
    // Der Abzug für lokal (WI-0251): Stage und Production erstellen und liefern aus, der Entwicklungsrechner spielt ein; ohne `config.abzug` gibt es die Routen nicht.
    await app.register(adminAbzugRoutes);
    await app.register(adminHoehenmodellRoutes);
    await app.register(adminSystemzustandRoutes);
    await app.register(adminInhalteRoutes);
    // Die Kenngrößen der Wegfindung (WI-0153): lesen mit dem Betrieb, verstellen mit `manage_system_settings` und Passkey.
    await app.register(adminWegfindungRoutes);
    // Die Karteneinstellungen (WI-0166): lesen mit dem Betrieb, verstellen mit `manage_system_settings` und Passkey.
    await app.register(adminKarteneinstellungenRoutes);
    await app.register(adminMapSeriesRoutes);
    await app.register(adminMapSeriesUploadRoutes);
    await app.register(adminMapSeriesProductionRoutes);
    await app.register(adminZoombaenderRoutes);
    await app.register(adminWettermodellRoutes);
    // Der Betreiber-Kanal (WI-0124) unter /api/kanal, mit derselben Hülle (no-store, Herkunftsprüfung).
    await app.register(kanalRoutes);
    await app.register(versionenRoutes);
    // Die Neuigkeiten (WI-0139): der öffentliche Lesepfad und die Pflege liegen in derselben Datei, wie bei den Inhaltsschaltern.
    await app.register(newsRoutes);
    // Der Reiter „Discord“ unter den Neuigkeiten (WI-0255): Betriebsstand, Vorschau, Routine, Sendearchiv und Wiederholen.
    await app.register(discordRoutes);
    // Die Production-Freigabe (FREIGABE-0001): liest Claudios Statusdatei, legt den Vorgang an.
    await app.register(freigabeRoutes);
    // Der Stand beider Umgebungen für das Umgebungsmenü an der Pille (WI-0180): nur Betreiber, nur lesen.
    await app.register(adminUmgebungenRoutes);
    // Der Dump-Bericht des WikiSync (WI-0253 C): nur lesen, ab Tester; die Läufe rechnet der Auftrag `wiki_vorschau`.
    await app.register(adminWikisyncRoutes);
    await app.register(adminWikisyncSteuerungRoutes);
    // Die Regelvorschläge der Vorkommen und die Begriffstafel (WI-0253 §24): lesen ab Tester, übernehmen ab Editor (Passkey), die Begriffstafel speichert jede Änderung sofort.
    await app.register(adminWikisyncRegelnRoutes);
    // Der Release-Test auf dem Entwicklungsrechner (WI-0248 L): NUR lokal (`config.releaseTest`); auf Stage und Production gibt es die Routen nicht.
    if (app.config.releaseTest !== undefined) await app.register(adminReleaseTestRoutes);
};
