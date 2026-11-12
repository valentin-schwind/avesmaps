import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { UMGEBUNGEN_URL, UmgebungenStand, lokalAdresse, type UmgebungLokal } from "@avesmaps3d/shared";
import { ADMIN_ERRORS } from "../auth/admin-guard.ts";
import { protect } from "../auth/plugin.ts";
import { gegenseiteLeser } from "../system/gegenseite.ts";
import { leseKarteneinstellungen, privateKarteneinstellungen } from "../system/karteneinstellungen.ts";

/**
 * Der Stand der Umgebungen für das Umgebungsmenü an der Pille (WI-0180 §9, §11):
 *
 *     GET /api/admin/system/umgebungen   eigener Stand, der der Gegenseite und die Adresse von Lokal   switch_environment (V)
 *
 * Nur lesen, nur Betreiber (`switch_environment` ist kein Sonderrecht). Wie die Gegenseite gefragt wird, steht in
 * `system/gegenseite.ts`; die Adresse von Lokal kommt aus den privaten Karteneinstellungen (WI-0180 §8), eingetragen im Reiter
 * „Umgebungen“ (WI-0204). `no-store` setzt die Verwaltung (`routes/admin.ts`).
 */
export const adminUmgebungenRoutes: FastifyPluginAsyncTypebox = async (app) => {
    const gegenseite = gegenseiteLeser(app.config.umgebungen?.gegenseiteHealthUrl, {
        warn: (meldung) => app.log.warn(meldung),
    });

    async function lokal(): Promise<UmgebungLokal | null> {
        if (app.database === undefined) return null;
        const werte = privateKarteneinstellungen(await leseKarteneinstellungen(app.database, { personen: false }));
        const adresse = lokalAdresse(werte.lokalName, werte.lokalPort);
        return adresse === null ? null : { adresse, imMenue: werte.lokalImMenue };
    }

    app.get(
        UMGEBUNGEN_URL,
        { ...protect("switch_environment"), schema: { response: { 200: UmgebungenStand, ...ADMIN_ERRORS } } },
        async () => ({
            eigene: { releaseId: app.config.releaseId },
            gegenseite: await gegenseite(),
            lokal: await lokal(),
        }),
    );
};
