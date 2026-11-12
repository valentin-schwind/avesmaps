import { Value } from "@sinclair/typebox/value";
import {
    SonderrollenAbgleich,
    isSonderrolle,
    type SonderrollenAbgleichEintrag,
    type SonderrollenAbgleichStand,
} from "@avesmaps3d/shared";
import type { FastifyBaseLogger } from "fastify";
import type { Database } from "../database.ts";
import { recordEvent } from "./audit.ts";
import type { AuthEnvironment } from "./config.ts";
import { requireRotation, type Sql } from "./session-store.ts";

/**
 * Die Stage übernimmt die Sonderrollen von Production (WI-0279 E9; Vali: „die datenwahrheit ist production“; Takt und Fristen von Claudio,
 * `project-control/handovers/2026-11-03-sonderrollen-einschaetzung-antwort-an-claudia.md`).
 *
 * - **Jede Minute** fragt die Stage über Loopback, mit Dienstschlüssel und der letzten Revision; ohne Änderung antwortet Production `304`. Ein
 *   Entzug wirkt so in höchstens 60 s.
 * - **Production ist die Wahrheit:** Was dort nicht steht, endet hier; auch was hier von Hand vergeben war (`herkunft = 'vergabe'`). Die Person
 *   erkennt die Stage an der Discord-ID; ohne passendes Konto steht die Zuteilung als `ohneKonto` im Reiter.
 * - **Antwortet Production nicht,** gilt bis 30 Minuten der letzte Stand: Ein Release dauert Sekunden und darf niemanden aussperren. Danach
 *   ruhen alle Sonderrollen der Stage (fail-closed), denn hier schadet „zu wenig Rechte“ weniger als ein Entzug, der nie ankommt.
 * - 🔴 **Der letzte Erfolg steht nur im Speicher.** Nach einem Neustart ohne Antwort ruhen die Rollen sofort, sonst überlebte ein Entzug den
 *   Neustart als „letzter bekannter Stand“.
 *
 * Ruhen heißt beenden (`revoked_at`), nicht markieren: So brauchen Anmeldung und Listen keinen zweiten Blick, und die nächste Antwort trägt alles
 * wieder ein. Der Schlüssel steht nie in einem Log.
 *
 * **Die Glocke der Betreiber** (`2026-11-03-sonderrollen-abgleich-antwort-an-claudia.md`): Ist der Abgleich länger als die Gnade gestört, meldet die Stage das
 * einmal, und noch einmal, wenn er danach wieder läuft. Der Wächter auf dem VPS könnte den Schlüssel nicht lesen; hier liegt der Zustand ohnehin. 🔴 Was zuletzt
 * gemeldet wurde, steht in der Tafel, nicht im Speicher: Die Stage startet mit jedem Push neu, und eine Störung überlebt das. Sonst käme je Neustart eine neue
 * Meldung, und das Ende bliebe stumm. Wie beim Hängt-Melder nicht über die Warteschlange und ohne neues Recht.
 */
export const ABGLEICH_TAKT_MS = 60_000;
export const ABGLEICH_GNADE_MS = 30 * 60_000;
const ABGLEICH_FRIST_MS = 5_000;
const GRUND_UEBERNOMMEN = "Von Production übernommen";
const GRUND_ENTZOGEN = "In Production nicht mehr vergeben";
const GRUND_RUHT = "Abgleich mit Production gestört";
const ART_GESTOERT = "sonderrollen_gestoert";
const ART_WIEDER = "sonderrollen_wieder";

export interface SonderrollenAbgleicher {
    start(): void;
    stop(): void;
    /** Ein Abruf; wirft nie. */
    lauf(): Promise<void>;
    stand(): SonderrollenAbgleichStand;
}

const schluesselDer = (person: string, sonderrolle: string, region: string | null): string =>
    `${person}|${sonderrolle}|${region ?? ""}`;

export function createSonderrollenAbgleich(options: {
    database: Database;
    environment: AuthEnvironment;
    adresse: URL;
    schluessel: string;
    log: FastifyBaseLogger;
    abrufen?: typeof fetch;
    jetzt?: () => number;
    taktMs?: number;
}): SonderrollenAbgleicher {
    const { database, environment, adresse, schluessel, log } = options;
    const abrufen = options.abrufen ?? fetch;
    const jetzt = options.jetzt ?? Date.now;
    let timer: ReturnType<typeof setInterval> | undefined;
    let laeuft = false;
    let revision: string | null = null;
    let zuletzt: number | undefined;
    let gestoertSeit: number | undefined;
    let ruht = false;
    let ohneKonto: SonderrollenAbgleichEintrag[] = [];
    // Spart die Anfrage je Takt; die Wahrheit steht in der Tafel.
    let gemeldet: string | undefined;

    /** Trägt den Stand von Production ein; gibt zurück, was nicht zuzuordnen war. */
    async function uebernimm(
        zuteilungen: readonly SonderrollenAbgleichEintrag[],
    ): Promise<SonderrollenAbgleichEintrag[]> {
        const bekannte = zuteilungen.filter((eintrag) => isSonderrolle(eintrag.sonderrolle));
        return database.begin(async (tx) => {
            await tx`SELECT pg_advisory_xact_lock(hashtext('avesmaps_auth.sonderrollen_abgleich'))`;
            const konten = await tx<{ discord_user_id: string; person_id: string }[]>`
                SELECT d.discord_user_id, d.person_id::text AS person_id
                  FROM avesmaps_auth.discord_login d
                  JOIN avesmaps_auth.person p ON p.id = d.person_id AND p.status = 'active'
                  JOIN avesmaps_auth.person_access a ON a.person_id = d.person_id AND a.environment = ${environment} AND a.status = 'active'
                 WHERE d.discord_user_id = ANY(${bekannte.map((eintrag) => eintrag.discordId)}::text[])
            `;
            const person = new Map(konten.map((konto) => [konto.discord_user_id, konto.person_id]));
            const soll = new Map<string, { person: string; sonderrolle: string; region: string | null }>();
            const fehlend: SonderrollenAbgleichEintrag[] = [];
            for (const eintrag of bekannte) {
                const id = person.get(eintrag.discordId);
                if (id === undefined) fehlend.push(eintrag);
                else soll.set(schluesselDer(id, eintrag.sonderrolle, eintrag.region), { ...eintrag, person: id });
            }
            const ist = await tx<
                { id: string; person_id: string; sonderrolle: string; region: string | null; herkunft: string }[]
            >`
                SELECT id::text, person_id::text, sonderrolle, region_public_id::text AS region, herkunft
                  FROM avesmaps_auth.sonderrolle_zuteilung
                 WHERE environment = ${environment} AND revoked_at IS NULL
            `;
            const betroffen = new Set<string>();
            const bleibt = new Set<string>();
            const weg: string[] = [];
            for (const zeile of ist) {
                const schluesselZeile = schluesselDer(zeile.person_id, zeile.sonderrolle, zeile.region);
                if (zeile.herkunft === "production" && soll.has(schluesselZeile)) {
                    bleibt.add(schluesselZeile);
                } else {
                    weg.push(zeile.id);
                    betroffen.add(zeile.person_id);
                }
            }
            if (weg.length > 0) {
                await tx`
                    UPDATE avesmaps_auth.sonderrolle_zuteilung
                       SET revoked_at = now(), revoke_reason = ${GRUND_ENTZOGEN}
                     WHERE id = ANY(${weg}::bigint[])
                `;
            }
            let neu = 0;
            for (const [schluesselZeile, zeile] of soll) {
                if (bleibt.has(schluesselZeile)) continue;
                const eingetragen = await tx`
                    INSERT INTO avesmaps_auth.sonderrolle_zuteilung (person_id, environment, sonderrolle, region_public_id, herkunft, reason)
                    VALUES (${zeile.person}, ${environment}, ${zeile.sonderrolle}, ${zeile.region}::uuid, 'production', ${GRUND_UEBERNOMMEN})
                    ON CONFLICT DO NOTHING
                `;
                if (eingetragen.count > 0) {
                    neu += 1;
                    betroffen.add(zeile.person);
                }
            }
            for (const id of betroffen) await requireRotation(tx as Sql, id);
            if (neu > 0 || weg.length > 0) {
                await recordEvent(tx as Sql, {
                    environment,
                    action: "sonderrolle.abgeglichen",
                    actorKind: "system",
                    details: { neu, entzogen: weg.length, ohneKonto: fehlend.length, ruht: false },
                });
            }
            return fehlend;
        });
    }

    /** Alle Sonderrollen dieser Umgebung ruhen, bis Production wieder antwortet. */
    async function ruhen(): Promise<void> {
        await database.begin(async (tx) => {
            await tx`SELECT pg_advisory_xact_lock(hashtext('avesmaps_auth.sonderrollen_abgleich'))`;
            const beendet = await tx<{ person_id: string }[]>`
                UPDATE avesmaps_auth.sonderrolle_zuteilung
                   SET revoked_at = now(), revoke_reason = ${GRUND_RUHT}
                 WHERE environment = ${environment} AND revoked_at IS NULL
                RETURNING person_id::text
            `;
            for (const id of new Set(beendet.map((zeile) => zeile.person_id))) await requireRotation(tx as Sql, id);
            if (beendet.length > 0) {
                await recordEvent(tx as Sql, {
                    environment,
                    action: "sonderrolle.abgeglichen",
                    actorKind: "system",
                    details: { neu: 0, entzogen: beendet.length, ohneKonto: 0, ruht: true },
                });
            }
        });
    }

    async function stoerung(grund: string): Promise<void> {
        const nun = jetzt();
        gestoertSeit ??= nun;
        log.warn({ grund }, "Abgleich der Sonderrollen mit Production gestört");
        if (ruht || (zuletzt !== undefined && nun - zuletzt <= ABGLEICH_GNADE_MS)) return;
        await ruhen();
        ruht = true;
        revision = null;
    }

    async function abruf(): Promise<void> {
        let antwort: Response;
        try {
            antwort = await abrufen(adresse, {
                headers: {
                    accept: "application/json",
                    authorization: `Bearer ${schluessel}`,
                    ...(revision === null ? {} : { "if-none-match": revision }),
                },
                signal: AbortSignal.timeout(ABGLEICH_FRIST_MS),
            });
        } catch {
            await stoerung("nicht erreichbar");
            return;
        }
        if (antwort.status !== 304) {
            if (!antwort.ok) {
                await stoerung(`Status ${String(antwort.status)}`);
                return;
            }
            const inhalt: unknown = await antwort.json().catch(() => undefined);
            if (!Value.Check(SonderrollenAbgleich, inhalt)) {
                await stoerung("unerwartete Antwort");
                return;
            }
            ohneKonto = await uebernimm(inhalt.zuteilungen);
            revision = antwort.headers.get("etag");
        }
        zuletzt = jetzt();
        gestoertSeit = undefined;
        ruht = false;
    }

    /** Meldet den Wechsel der Lage in die Glocke; wirft nie. Ein Fehler kostet eine Zeile im Protokoll und diesen Takt, nie den Abgleich. */
    async function glocke(): Promise<void> {
        const lage =
            gestoertSeit === undefined
                ? zuletzt === undefined
                    ? undefined
                    : ART_WIEDER
                : jetzt() - gestoertSeit > ABGLEICH_GNADE_MS
                  ? ART_GESTOERT
                  : undefined;
        if (lage === undefined || lage === gemeldet) return;
        try {
            await database.begin(async (tx) => {
                await tx`SELECT pg_advisory_xact_lock(hashtext('avesmaps_auth.sonderrollen_abgleich'))`;
                const [letzte] = await tx<{ art: string }[]>`
                    SELECT art FROM public.benachrichtigung
                     WHERE environment = ${environment} AND art IN (${ART_GESTOERT}, ${ART_WIEDER})
                     ORDER BY id DESC LIMIT 1
                `;
                // Das Ende nur nach einer gemeldeten Störung; jede Störung nur einmal, auch über Neustarts.
                if ((letzte?.art === ART_GESTOERT) === (lage === ART_GESTOERT)) return;
                await tx`
                    SELECT public.benachrichtige(
                        ${environment}, '{"rolle":"operator"}'::jsonb, 'system', NULL, ${lage}, NULL, NULL,
                        ${`sonderrollen-abgleich:${lage}-${String(jetzt())}`}
                    )
                `;
            });
            gemeldet = lage;
        } catch (error) {
            log.warn({ err: error }, "Lage des Abgleichs nicht gemeldet; neuer Versuch im nächsten Takt");
        }
    }

    return {
        start() {
            if (timer !== undefined) return;
            void this.lauf();
            timer = setInterval(() => void this.lauf(), options.taktMs ?? ABGLEICH_TAKT_MS);
            timer.unref();
        },
        stop() {
            if (timer !== undefined) clearInterval(timer);
            timer = undefined;
        },
        async lauf() {
            if (laeuft) return;
            laeuft = true;
            try {
                await abruf();
            } catch (error) {
                // Etwa eine Tafel ohne Rechte: Der Abgleich bleibt stehen, die Anmeldung läuft weiter.
                gestoertSeit ??= jetzt();
                log.warn({ err: error }, "Abgleich der Sonderrollen fehlgeschlagen");
            }
            await glocke();
            laeuft = false;
        },
        stand() {
            return {
                stand: gestoertSeit !== undefined ? "gestoert" : zuletzt === undefined ? "ausstehend" : "ok",
                zuletzt: zuletzt === undefined ? null : new Date(zuletzt).toISOString(),
                gestoertSeit: gestoertSeit === undefined ? null : new Date(gestoertSeit).toISOString(),
                ruht,
                ohneKontoZahl: ohneKonto.length,
                ohneKonto,
            };
        },
    };
}
