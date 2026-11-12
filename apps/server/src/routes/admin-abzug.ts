import { createReadStream } from "node:fs";
import type { Readable } from "node:stream";
import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { Type } from "@sinclair/typebox";
import {
    ABZUG_JOB_ART,
    ABZUG_URL,
    AVENTURIA,
    AbzugEingang,
    AbzugEinspielenBody,
    AbzugErstellenBody,
    AbzugHolenBody,
    AbzugLink,
    AbzugLinkBody,
    AbzugQuelleBody,
    AbzugSchluesselBody,
    AbzugSchluesselNeu,
    AbzugSchluesselWiderrufBody,
    AbzugSicht,
    OperationId,
    OperationReceipt,
    type AbzugSchluessel,
    type AbzugSichtErstellen,
    type WarteschlangeUmgebung,
} from "@avesmaps3d/shared";
import { dateinameFuer, findeAbzug, listeAbzuege } from "../abzug/ablage.ts";
import { leseAbzugAuftraege } from "../abzug/auftraege.ts";
import type { AbzugConfig } from "../abzug/konfig.ts";
import { erzeugeLinkspeicher } from "../abzug/links.ts";
import { erzeugeLokalDienst } from "../abzug/lokal.ts";
import { ladeRegeln } from "../abzug/regeln.ts";
import { legeSchluesselAn, listeSchluessel, widerrufeSchluessel } from "../abzug/schluessel.ts";
import { ADMIN_ERRORS, actorFields, adminOperation, adminSession } from "../auth/admin-guard.ts";
import { protect } from "../auth/plugin.ts";
import { isNotProvisioned, type Database } from "../database.ts";
import { ApiError } from "../http/api-error.ts";
import { planerAktiv } from "../jobs/overview.ts";
import { standJetzt, type StandLage } from "../jobs/stand-datei.ts";
import { leseWarteumstand, umstandMitStand } from "../jobs/wartegrund.ts";

/**
 * Der Abzug für lokal in der Systemsteuerung (WI-0251; Vali 2026-10-24: „ja von stage und production, aber ohne die accounts, statistiken und alle
 * kartendaten auch“; `packages/shared/src/system/abzug.ts` beschreibt die Routen):
 *
 * - **Stage und Production** (`erstellen`): Der Knopf reiht den Auftrag `abzug_lokal` ein (`create_backup` mit frischem Passkey; Claudios Korridor
 *   führt ihn aus), die Liste zeigt die fertigen Abzüge der Ablage, und „Herunterladen“ stellt einen Link aus, der zwei Minuten gilt und einmal zu
 *   öffnen ist. Das Ereignis `backup.requested` („Abzug angestoßen“) steht beim Einreihen, `backup.downloaded` („Abzug heruntergeladen“) beim
 *   Ausstellen des Links: Dort entscheidet die Person mit frischem Passkey, die Daten herauszuholen; das Öffnen des Links liefert nur aus. Das
 *   Erstellen liest die Karte, es schreibt sie nicht: Schreibklasse `import` (offen unter beiden Sperren, wie die Abgleiche).
 * - **Lokal** (`einspielen`): Die Datei kommt über `PUT …/eingang` (als Strom auf die Platte, nie in den Speicher), wird geprüft, und das
 *   Einspielen läuft als Hintergrundarbeit des Servers (`abzug/lokal.ts`) nach einer Sicherung. `run_abzug_einspielen` verlangt den frischen Passkey.
 * - **Selbst abholen** (WI-0251; Vali 2026-10-25): Statt Herunterladen und Hochladen von Hand holt der Entwicklungsrechner den neuesten Abzug selbst
 *   (`routes/abzug-holen.ts`). Dazu legt ein Admin mit Passkey auf Stage oder Production einen **Abzugs-Schlüssel** an (`…/schluessel`, mit Ablaufdatum,
 *   widerrufbar mit `…/schluessel/widerrufen`, beides im Protokoll als `system.abzug_schluessel`); sein Wert steht genau einmal in der Antwort. Lokal
 *   verwahrt `…/quelle` den Schlüssel je Quelle (nie in einer Antwort), und `…/holen` holt und spielt ein (frischer Passkey: es ersetzt die lokalen Daten).
 * - Jede Umgebung hat genau EINE dieser Rollen (`config.abzug.rollen`); die Routen der anderen gibt es dort nicht.
 */

const strict = { additionalProperties: false } as const;
const TokenParam = Type.Object({ token: Type.String({ minLength: 20, maxLength: 80 }) }, strict);
const EingangQuery = Type.Object(
    { name: Type.String({ minLength: 1, maxLength: 200 }), operationId: OperationId },
    strict,
);
const ERROR_RESPONSES = { ...ADMIN_ERRORS, 410: ADMIN_ERRORS[404], 422: ADMIN_ERRORS[400] };

async function plannerActive(
    database: Database,
    stand: { lage: StandLage; umgebung: WarteschlangeUmgebung },
): Promise<boolean | null> {
    try {
        return await planerAktiv(database, AVENTURIA.mapDomain, stand);
    } catch {
        return null;
    }
}

function ablageOder503(abzug: AbzugConfig): string {
    if (abzug.wurzel === undefined) {
        throw new ApiError(
            503,
            "abzug_ablage_fehlt",
            "Auf dieser Instanz ist keine Ablage für Abzüge eingerichtet (ABZUG_ROOT).",
        );
    }
    return abzug.wurzel;
}

export const adminAbzugRoutes: FastifyPluginAsyncTypebox = async (app) => {
    const abzug = app.config.abzug;
    if (abzug === undefined) return;
    const erstellen = abzug.rollen.includes("erstellen");
    const links = erzeugeLinkspeicher();
    const dienst = abzug.rollen.includes("einspielen")
        ? erzeugeLokalDienst({
              db: app.database!,
              databaseUrl: app.config.databaseUrl ?? abzug.databaseUrl,
              wurzel: abzug.wurzel,
              regeln: ladeRegeln(),
              medienWurzel: app.config.mediaRoot,
              pgDump: abzug.pgDump,
              einspielen: abzug.einspielen,
              quellen: abzug.quellen,
              fetch: abzug.fetch,
              pauseMs: abzug.pauseMs,
              stillstandMs: abzug.stillstandMs,
              schluessel: abzug.schluessel,
              warn: (meldung) => app.log.warn(meldung),
          })
        : undefined;

    // Der Stand: Stage und Production zeigen Auftrag und Ablage, der Entwicklungsrechner Eingang und Einspielen.
    app.get(
        ABZUG_URL,
        { ...protect("create_backup"), schema: { response: { 200: AbzugSicht, ...ADMIN_ERRORS } } },
        async (request) => {
            await adminSession(request);
            if (!erstellen) return await dienst!.sicht();
            const quelle = abzug.quelle!;
            const database = app.database!;
            const stand = await standJetzt(app.warteschlangeStand);
            const aktiv = await plannerActive(database, stand);
            const umstand = umstandMitStand(
                await leseWarteumstand(database, {
                    plannerActive: aktiv === true,
                    pickupKinds: new Set([ABZUG_JOB_ART]),
                }),
                stand.lage,
                stand.umgebung,
            );
            const { laufend, letzter } = await leseAbzugAuftraege(database, umstand);
            const abzuege = abzug.wurzel === undefined ? [] : await listeAbzuege(abzug.wurzel, quelle);
            // Fehlt die Tafel der Schlüssel noch (Release vor `migrate`), bleibt die Liste leer statt die ganze Sicht zu kippen.
            const schluessel: AbzugSchluessel[] = await listeSchluessel(database, quelle).catch((error: unknown) => {
                if (isNotProvisioned(error)) return [];
                throw error;
            });
            const antwort: AbzugSichtErstellen = {
                rolle: "erstellen",
                jetzt: new Date().toISOString(),
                umgebung: quelle,
                ablage: abzug.wurzel !== undefined,
                planerAktiv: aktiv,
                laufend,
                letzter,
                // Den Pfad der Datei erfährt der Browser nie: nur, was das Schema der Antwort nennt.
                abzuege: abzuege.map((datei) => ({
                    kennung: datei.kennung,
                    erstellt: datei.erstellt,
                    bytes: datei.bytes,
                    tafeln: datei.tafeln,
                    zeilen: datei.zeilen,
                    medien: datei.medien,
                    medienBytes: datei.medienBytes,
                    laeuftAb: datei.laeuftAb,
                })),
                schluessel,
            };
            return antwort;
        },
    );

    if (erstellen) {
        const quelle = abzug.quelle!;

        app.post(
            `${ABZUG_URL}/erstellen`,
            {
                ...protect("create_backup", { confirm: "passkey", writeClass: "import" }),
                schema: { body: AbzugErstellenBody, response: { 200: OperationReceipt, ...ERROR_RESPONSES } },
            },
            async (request) => {
                const session = await adminSession(request);
                ablageOder503(abzug);
                const { operationId } = request.body;
                return adminOperation(
                    app.database!,
                    session,
                    { operationId, body: { action: "abzug.erstellen", quelle } },
                    async (tx) => {
                        await tx`SELECT pg_advisory_xact_lock(hashtext('abzug:erstellen'))`;
                        const [offen] = await tx<{ n: number }[]>`
                            SELECT count(*)::int AS n FROM job WHERE kind = ${ABZUG_JOB_ART} AND state IN ('QUEUED', 'RUNNING')
                        `;
                        if ((offen?.n ?? 0) > 0) {
                            throw new ApiError(
                                409,
                                "abzug_laeuft",
                                "Ein Abzug wird schon erstellt oder wartet darauf. Warte, bis er fertig ist.",
                            );
                        }
                        // Der Auftrag fasst keine Kartendaten an (er liest sie in einer lesenden Transaktion): Bereich `tiles` wie die Kachelaufträge.
                        const [job] = await tx<{ public_id: string }[]>`
                            SELECT public_id::text AS public_id
                              FROM job_enqueue(${ABZUG_JOB_ART}, 1::smallint, ${AVENTURIA.mapDomain}, ${session.personId},
                                               ${tx.json({ quelle } as never)}, 50::smallint, NULL, 'tiles', '{}'::smallint[])
                        `;
                        return {
                            receipt: {
                                environment: session.environment,
                                affected: [],
                                derivedWork: [{ kind: ABZUG_JOB_ART, jobId: job!.public_id, state: "queued" }],
                                warnings: [],
                            },
                            event: {
                                ...actorFields(session, request),
                                action: "backup.requested",
                                targetRef: `job:${job!.public_id}`,
                            },
                        };
                    },
                );
            },
        );

        app.post(
            `${ABZUG_URL}/link`,
            {
                ...protect("create_backup", { confirm: "passkey", writeClass: "import" }),
                schema: { body: AbzugLinkBody, response: { 200: AbzugLink, ...ERROR_RESPONSES } },
            },
            async (request, reply) => {
                const session = await adminSession(request);
                const wurzel = ablageOder503(abzug);
                const { operationId, kennung } = request.body;
                const datei = await findeAbzug(wurzel, quelle, kennung);
                if (datei === null) {
                    throw new ApiError(
                        404,
                        "abzug_unbekannt",
                        "Diesen Abzug gibt es nicht (mehr). Er wird nach 24 Stunden gelöscht.",
                    );
                }
                const dateiname = dateinameFuer(quelle, kennung);
                // Das Ereignis steht vor dem Link: Ohne Eintrag im Protokoll gibt es keinen (fail-closed). Ein Link ist ein Zufallswert im Speicher
                // dieser Instanz und kein Teil der Antwort, die ein Wiederholen mit derselben `operationId` zurückgäbe: Darum antwortet die Route
                // bei einem Wiederholen mit 409, statt einen zweiten Link zu verschenken.
                let ausgestellt = false;
                await adminOperation(
                    app.database!,
                    session,
                    { operationId, body: { action: "abzug.link", quelle, kennung } },
                    async () => {
                        ausgestellt = true;
                        return {
                            receipt: { environment: session.environment, affected: [], derivedWork: [], warnings: [] },
                            event: {
                                ...actorFields(session, request),
                                action: "backup.downloaded",
                                targetRef: `abzug:${quelle}:${kennung}`,
                                details: { name: dateiname },
                            },
                        };
                    },
                );
                if (!ausgestellt) {
                    throw new ApiError(
                        409,
                        "abzug_link_ungueltig",
                        "Dieser Aufruf wurde schon beantwortet. Hole einen neuen Link.",
                    );
                }
                const { token, gueltigBis } = links.ausstellen(session.personId, quelle, kennung);
                void reply.header("cache-control", "no-store");
                return { url: `${ABZUG_URL}/datei/${token}`, gueltigBis: gueltigBis.toISOString(), dateiname };
            },
        );

        app.get(
            `${ABZUG_URL}/datei/:token`,
            { ...protect("create_backup"), schema: { params: TokenParam, response: { ...ERROR_RESPONSES } } },
            async (request, reply) => {
                const session = await adminSession(request);
                const wurzel = ablageOder503(abzug);
                const eintrag = links.einloesen(request.params.token, session.personId);
                if (eintrag === null || eintrag.quelle !== quelle) {
                    throw new ApiError(
                        410,
                        "abzug_link_ungueltig",
                        "Dieser Link ist abgelaufen oder wurde schon benutzt. Hole im Datenabgleich einen neuen.",
                    );
                }
                const datei = await findeAbzug(wurzel, quelle, eintrag.kennung);
                if (datei === null) {
                    throw new ApiError(
                        404,
                        "abzug_unbekannt",
                        "Diesen Abzug gibt es nicht (mehr). Er wird nach 24 Stunden gelöscht.",
                    );
                }
                return (
                    reply
                        .header("content-type", "application/x-tar")
                        .header("content-length", String(datei.bytes))
                        .header(
                            "content-disposition",
                            `attachment; filename="${dateinameFuer(quelle, eintrag.kennung)}"`,
                        )
                        .header("x-content-type-options", "nosniff")
                        // Der Strom ist keine JSON-Antwort: Das Schema kennt nur die Fehlerhüllen, die Datei geht am Schema vorbei.
                        .send(createReadStream(datei.tarPfad) as never)
                );
            },
        );
    }

    if (erstellen) {
        const quelle = abzug.quelle!;

        // Einen Abzugs-Schlüssel anlegen: Passkey, Ablaufdatum; der Wert steht NUR in dieser Antwort (nie im Protokoll und nie in der Quittung, die ein
        // Wiederholen mit derselben `operationId` zurückgäbe): Darum antwortet die Route bei einem Wiederholen mit 409 statt mit einem zweiten Wert.
        app.post(
            `${ABZUG_URL}/schluessel`,
            {
                ...protect("create_backup", { confirm: "passkey", writeClass: "system" }),
                schema: { body: AbzugSchluesselBody, response: { 200: AbzugSchluesselNeu, ...ERROR_RESPONSES } },
            },
            async (request, reply) => {
                const session = await adminSession(request);
                const { operationId, tage } = request.body;
                const angelegt: { neu?: AbzugSchluesselNeu } = {};
                await adminOperation(
                    app.database!,
                    session,
                    { operationId, body: { action: "abzug.schluessel", quelle, tage } },
                    async (tx) => {
                        const neu = await legeSchluesselAn(tx, { quelle, personId: session.personId, tage });
                        angelegt.neu = neu;
                        return {
                            receipt: { environment: session.environment, affected: [], derivedWork: [], warnings: [] },
                            event: {
                                ...actorFields(session, request),
                                action: "system.abzug_schluessel",
                                targetRef: `abzug-schluessel:${neu.id}`,
                                details: { aktion: "angelegt", tage },
                            },
                        };
                    },
                );
                if (angelegt.neu === undefined) {
                    throw new ApiError(
                        409,
                        "abzug_schluessel_gesehen",
                        "Dieser Aufruf wurde schon beantwortet; der Schlüssel steht nur einmal da. Lege einen neuen an.",
                    );
                }
                void reply.header("cache-control", "no-store");
                return angelegt.neu;
            },
        );

        app.post(
            `${ABZUG_URL}/schluessel/widerrufen`,
            {
                ...protect("create_backup", { confirm: "passkey", writeClass: "security" }),
                schema: { body: AbzugSchluesselWiderrufBody, response: { 200: OperationReceipt, ...ERROR_RESPONSES } },
            },
            async (request) => {
                const session = await adminSession(request);
                const { operationId, id } = request.body;
                return adminOperation(
                    app.database!,
                    session,
                    { operationId, body: { action: "abzug.schluessel.widerrufen", quelle, id } },
                    async (tx) => {
                        await widerrufeSchluessel(tx, { quelle, id, personId: session.personId });
                        return {
                            receipt: { environment: session.environment, affected: [], derivedWork: [], warnings: [] },
                            event: {
                                ...actorFields(session, request),
                                action: "system.abzug_schluessel",
                                targetRef: `abzug-schluessel:${id}`,
                                details: { aktion: "widerrufen" },
                            },
                        };
                    },
                );
            },
        );
    }

    if (dienst !== undefined) {
        // Den Schlüssel einer Quelle hinterlegen oder entfernen. Der Wert geht in die Datei des Dienstes und kommt nie wieder heraus; das Protokoll
        // nennt nur die Quelle und `schluessel` beziehungsweise `schluessel_entfernt`.
        app.post(
            `${ABZUG_URL}/quelle`,
            {
                ...protect("run_abzug_einspielen", { writeClass: "import" }),
                schema: { body: AbzugQuelleBody, response: { 200: OperationReceipt, ...ERROR_RESPONSES } },
            },
            async (request) => {
                const session = await adminSession(request);
                const { operationId, quelle, schluessel } = request.body;
                return adminOperation(
                    app.database!,
                    session,
                    { operationId, body: { action: "abzug.quelle", quelle, gesetzt: schluessel !== null } },
                    async () => {
                        dienst.setzeSchluessel(quelle, schluessel);
                        return {
                            receipt: { environment: session.environment, affected: [], derivedWork: [], warnings: [] },
                            event: {
                                ...actorFields(session, request),
                                action: "system.abzug_einspielen",
                                targetRef: `abzug-quelle:${quelle}`,
                                details: { schritt: schluessel === null ? "schluessel_entfernt" : "schluessel" },
                            },
                        };
                    },
                );
            },
        );

        // Den neuesten Abzug einer Quelle holen und einspielen: wie `…/einspielen` mit frischem Passkey, denn es ersetzt die lokalen Kartendaten.
        app.post(
            `${ABZUG_URL}/holen`,
            {
                ...protect("run_abzug_einspielen", { confirm: "passkey", writeClass: "import" }),
                schema: { body: AbzugHolenBody, response: { 200: OperationReceipt, ...ERROR_RESPONSES } },
            },
            async (request) => {
                const session = await adminSession(request);
                const { operationId, quelle } = request.body;
                const schein = dienst.pruefeHolen(quelle);
                return adminOperation(
                    app.database!,
                    session,
                    { operationId, body: { action: "abzug.holen", quelle } },
                    async () => {
                        dienst.starteHolen(schein);
                        return {
                            receipt: { environment: session.environment, affected: [], derivedWork: [], warnings: [] },
                            event: {
                                ...actorFields(session, request),
                                action: "system.abzug_einspielen",
                                targetRef: `abzug-quelle:${quelle}`,
                                details: { schritt: "holen" },
                            },
                        };
                    },
                );
            },
        );

        // Die Datei kommt als Strom: nie ganz in den Speicher, nie durch den Parser von Fastify.
        app.addContentTypeParser("application/x-tar", (_request, payload, done) => done(null, payload));

        app.put(
            `${ABZUG_URL}/eingang`,
            {
                ...protect("create_backup", { writeClass: "import" }),
                schema: { querystring: EingangQuery, response: { 200: AbzugEingang, ...ERROR_RESPONSES } },
            },
            async (request) => {
                const session = await adminSession(request);
                const laenge = Number(request.headers["content-length"]);
                const eingang = await dienst.nimmAn(
                    request.body as Readable,
                    request.query.name,
                    Number.isFinite(laenge) && laenge > 0 ? laenge : undefined,
                );
                await adminOperation(
                    app.database!,
                    session,
                    { operationId: request.query.operationId, body: { action: "abzug.eingang", name: eingang.name } },
                    async () => ({
                        receipt: { environment: session.environment, affected: [], derivedWork: [], warnings: [] },
                        event: {
                            ...actorFields(session, request),
                            action: "system.abzug_einspielen",
                            targetRef: `abzug:${eingang.kennung}`,
                            details: { kennung: eingang.kennung, schritt: "eingang" },
                        },
                    }),
                );
                return eingang;
            },
        );

        app.post(
            `${ABZUG_URL}/einspielen`,
            {
                ...protect("run_abzug_einspielen", { confirm: "passkey", writeClass: "import" }),
                schema: { body: AbzugEinspielenBody, response: { 200: OperationReceipt, ...ERROR_RESPONSES } },
            },
            async (request) => {
                const session = await adminSession(request);
                const { operationId, kennung } = request.body;
                const schein = await dienst.pruefeStart(kennung);
                return adminOperation(
                    app.database!,
                    session,
                    { operationId, body: { action: "abzug.einspielen", kennung } },
                    async () => {
                        dienst.starte(schein);
                        return {
                            receipt: { environment: session.environment, affected: [], derivedWork: [], warnings: [] },
                            event: {
                                ...actorFields(session, request),
                                action: "system.abzug_einspielen",
                                targetRef: `abzug:${kennung}`,
                                details: { kennung, schritt: "start" },
                            },
                        };
                    },
                );
            },
        );
    }
};
