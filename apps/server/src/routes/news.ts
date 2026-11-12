import { createHash } from "node:crypto";
import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { Type } from "@sinclair/typebox";
import {
    NEWS_ADMIN_URL,
    NEWS_CACHE_S,
    NEWS_ERROR_STATUS,
    NEWS_SEITE,
    NEWS_URL,
    NewsAendernBody,
    NewsAnlegenBody,
    NewsListe,
    NewsParams,
    NewsPflege,
    OperationReceipt,
    socNummer,
    type NewsEintrag,
    type NewsEintragVoll,
    type NewsImKorb,
    type NewsStageStand,
    type NewsZustand,
} from "@avesmaps3d/shared";
import type { Sql } from "../auth/session-store.ts";
import { ausfuehrungFuer } from "../abgleiche/ausfuehrung.ts";
import { ADMIN_ERRORS, actorFields, adminOperation, adminSession } from "../auth/admin-guard.ts";
import { protect } from "../auth/plugin.ts";
import type { Queryable } from "../database.ts";
import { ApiError } from "../http/api-error.ts";

/**
 * Die Neuigkeiten (WI-0139; Betreiber 2026-10-13: „es wird auch zeit bei "Production" den "Neuigkeiten-Kanal" fürs frontend
 * freizuschalten. in legacy hatten wir dazu eine tägliche routine von claudia, die das nochmal zusammengefasst hat. das war für
 * "normale" nutzer erklärt, was gerade auf avesmaps.de passiert“).
 *
 *     GET    /api/news                     was Besucher lesen (öffentlich, 10 min Cache wie Legacy)   keine
 *     GET    /api/admin/system/news        die Pflege: auch Entwürfe und Verstecktes                  view_operations
 *     POST   /api/admin/system/news        einen Eintrag von Hand anlegen, auch zwischendrin          manage_news
 *     POST   /api/admin/system/news/:id    bessern, freigeben, verstecken, Papierkorb und zurück      manage_news
 *
 * - 🔴 **Gelöscht wird nie.** Löschen heißt Papierkorb (WI-0217, Betreiber 2026-10-17, gewählt „Papierkorb“): Der Eintrag verlässt die
 *   Liste und avesmaps.de, die Zeile bleibt mit Zeitpunkt und Person und lässt sich zurückholen. Es gibt kein DELETE, weder als Route
 *   noch als Recht (`news-grants.psql` nimmt der App-Rolle `DELETE` auf der Tabelle).
 * - 🔴 **Die Reihenfolge ist das Datum**, innerhalb eines Tages `reihe`. Wer unter einem Eintrag einfügt, steht bei gleichem Datum direkt
 *   darunter; die Reihe des Tages wird dafür neu nummeriert (`reiheDesTages`).
 * - **Nur auf der Stage** (WI-0217): Wo ein Production-Zug ankommt, ersetzt er alle Neuigkeiten durch die von Production (Betreiber
 *   2026-10-17: „neuigkeiten wandern immer von production -> stage“). Was eine Person nach dem Ende des letzten erfolgreichen Zugs
 *   angelegt, geändert oder gelöscht hat, trägt `nurStage`. Die Tafel `job` behält die Stage beim Zug, `news_entry` nicht.
 * - 🔴 **Die Routine schreibt nicht hier.** Sie hat keine Sitzung und ruft `news_add` mit ihrer eigenen Rolle; sie legt nur Entwürfe an
 *   (Betreiber 2026-10-13: „erst entwurf, wie empfohlen“). Wer über diese Routen anlegt, ist ein angemeldeter Mensch — sein Eintrag ist
 *   sofort sichtbar.
 * - Fehlt die Tabelle (0119 noch nicht angewandt), antwortet jeder Weg 503 `news_unavailable` statt 500: Der Korridor startet Fastify vor
 *   `migrate`, wie bei der Anmeldung.
 */

interface Zeile {
    id: string;
    datum: Date;
    titel: string;
    text: string;
    rubrik: string;
    zustand: NewsZustand;
    herkunft: string;
    quelle: string | null;
    erstellt_at: Date;
    freigegeben_at: Date | null;
    freigegeben_name: string | null;
}

interface PflegeZeile extends Zeile {
    nur_stage: boolean;
    geloescht_at: Date | null;
    geloescht_name: string | null;
}

const tag = (wert: Date): string => wert.toISOString().slice(0, 10);

const oeffentlich = (zeile: Zeile): NewsEintrag => ({
    id: Number(zeile.id),
    datum: tag(zeile.datum),
    titel: zeile.titel,
    text: zeile.text,
    rubrik: zeile.rubrik,
});

const voll = (zeile: PflegeZeile, beitraege: ReadonlyMap<string, string> = new Map()): NewsEintragVoll => ({
    ...oeffentlich(zeile),
    zustand: zeile.zustand,
    nurStage: zeile.nur_stage,
    herkunft: zeile.herkunft,
    quelle: zeile.quelle,
    erstelltAt: zeile.erstellt_at.toISOString(),
    freigegebenAt: zeile.freigegeben_at?.toISOString() ?? null,
    freigegebenVon: zeile.freigegeben_name,
    beitrag: beitraege.get(zeile.id) ?? null,
});

const imKorb = (zeile: PflegeZeile, beitraege: ReadonlyMap<string, string> = new Map()): NewsImKorb => ({
    ...voll(zeile, beitraege),
    geloeschtAt: (zeile.geloescht_at ?? zeile.erstellt_at).toISOString(),
    geloeschtVon: zeile.geloescht_name,
});

/**
 * Die Reihe eines Tages neu nummerieren: `ids` in der Reihenfolge der Anzeige, der oberste bekommt die höchste Reihe. Nur Zeilen dieses
 * Tages, die der Aufrufer schon gesperrt hat (`tagGesperrt`).
 */
async function reiheDesTages(tx: Sql, ids: readonly number[]): Promise<void> {
    if (ids.length === 0) return;
    const reihen = ids.map((_, index) => ids.length - 1 - index);
    await tx`
        UPDATE public.news_entry n
           SET reihe = v.reihe
          FROM unnest(${[...ids]}::bigint[], ${reihen}::int[]) AS v(id, reihe)
         WHERE n.id = v.id
    `;
}

/** Die Einträge eines Tages in der Reihenfolge der Anzeige, gesperrt bis zum Ende der Operation. */
async function tagGesperrt(tx: Sql, datum: string): Promise<number[]> {
    const zeilen = await tx<{ id: string }[]>`
        SELECT id FROM public.news_entry WHERE datum = ${datum}::date ORDER BY reihe DESC, id DESC FOR UPDATE
    `.catch(uebersetzt);
    return zeilen.map((zeile) => Number(zeile.id));
}

/** 42P01: die Tabelle gibt es noch nicht. Jede andere Ursache bleibt, wie sie ist. */
function uebersetzt(error: unknown): never {
    if (typeof error === "object" && error !== null && (error as { code?: string }).code === "42P01") {
        throw new ApiError(
            NEWS_ERROR_STATUS.news_unavailable,
            "news_unavailable",
            "Neuigkeiten gibt es in dieser Umgebung noch nicht.",
        );
    }
    throw error;
}

export const newsRoutes: FastifyPluginAsyncTypebox = async (app) => {
    const db = (): Queryable => app.database!;
    const lesen = protect("view_operations");
    const pflegen = protect("manage_news", { writeClass: "system" });

    /**
     * Kommt hier ein Production-Zug an (die Umgebung nennt die Quelle `production` in `ABGLEICHE`, also die Stage), das Ende des letzten
     * erfolgreichen, ohne einen `null`; `undefined`, wo keiner ankommt (Production, lokal, ohne Angabe).
     */
    const letzterZug = async (): Promise<Date | null | undefined> => {
        const abgleiche = app.config.abgleiche;
        if (abgleiche === undefined || ausfuehrungFuer(abgleiche, "production") === "verborgen") return undefined;
        const [zeile] = await db()<{ zug: Date | null }[]>`
            SELECT max(finished_at) AS zug FROM public.job WHERE kind = 'production_pull' AND state = 'SUCCEEDED'
        `;
        return zeile?.zug ?? null;
    };

    /**
     * Die Zeilen der Pflege. Die Liste in der Reihenfolge der Anzeige (jüngster Tag zuerst, innerhalb des Tages der oberste zuerst), der
     * Papierkorb mit dem zuletzt Gelöschten zuerst. `nur_stage` vergleicht mit dem Ende des letzten Production-Zugs.
     */
    const zeilen = async (zug: Date | null, papierkorb: boolean): Promise<PflegeZeile[]> =>
        await db()<PflegeZeile[]>`
            SELECT n.id, n.datum, n.titel, n.text, n.rubrik, n.zustand, n.herkunft, n.quelle, n.erstellt_at,
                   n.freigegeben_at, p.display_name AS freigegeben_name, n.geloescht_at, g.display_name AS geloescht_name,
                   (${zug}::timestamptz IS NOT NULL
                    AND GREATEST(n.erstellt_at, n.geaendert_at, n.geloescht_at) > ${zug}::timestamptz) AS nur_stage
              FROM public.news_entry n
              LEFT JOIN avesmaps_auth.person p ON p.id = n.freigegeben_von
              LEFT JOIN avesmaps_auth.person g ON g.id = n.geloescht_von
             WHERE (n.geloescht_at IS NOT NULL) = ${papierkorb}
             ORDER BY CASE WHEN ${papierkorb} THEN n.geloescht_at END DESC NULLS LAST,
                      n.datum DESC, n.reihe DESC, n.id DESC
             LIMIT ${NEWS_SEITE}
        `.catch(uebersetzt);

    /**
     * Welche Einträge aus dem Social Hub stammen (WI-0270 C11, E9): `id` → `SOC-…`. Nur wenn das Ziel des Beitrags auf GENAU diesen Eintrag zeigt (die Stage bekommt `news_entry` mit dem Production-Zug, das
     * Community-Schema nie). Eine Beigabe: Fehlt das Schema oder das Recht, scheitert die Pflege nicht, sie zeigt dann kein „aus SOC-…“.
     */
    const beitraege = async (ids: readonly string[]): Promise<Map<string, string>> => {
        const karte = new Map<string, string>();
        if (ids.length === 0) return karte;
        try {
            const rows = await db()<{ id: string; beitrag: string }[]>`
                SELECT n.id::text AS id, n.beitrag_id::text AS beitrag
                  FROM public.news_entry n
                  JOIN avesmaps_community.beitrag_ziel z
                    ON z.beitrag_id = n.beitrag_id AND z.kanal = 'neuigkeiten' AND z.adresse = 'news:' || n.id::text
                 WHERE n.id = ANY(${[...ids]}::bigint[])
            `;
            for (const row of rows) karte.set(row.id, socNummer(row.beitrag));
        } catch {
            // Kein Hub in dieser Umgebung (Schema oder Recht fehlt): keine Marke, aber die Pflege geht weiter.
        }
        return karte;
    };

    app.get(NEWS_ADMIN_URL, { ...lesen, schema: { response: { 200: NewsPflege, ...ADMIN_ERRORS } } }, async () => {
        const zug = await letzterZug();
        const [liste, korb] = await Promise.all([zeilen(zug ?? null, false), zeilen(zug ?? null, true)]);
        const aus = await beitraege([...liste, ...korb].map((zeile) => zeile.id));
        const eintraege = liste.map((zeile) => voll(zeile, aus));
        let stage: NewsStageStand | null = null;
        if (zug !== undefined) {
            const [zahl] = await db()<{ n: number }[]>`
                SELECT count(*)::int AS n FROM public.news_entry
                 WHERE ${zug}::timestamptz IS NOT NULL
                   AND GREATEST(erstellt_at, geaendert_at, geloescht_at) > ${zug}::timestamptz
            `;
            stage = { letzterZug: zug?.toISOString() ?? null, nurStage: zahl?.n ?? 0 };
        }
        return {
            entwuerfe: eintraege.filter((eintrag) => eintrag.zustand === "entwurf").length,
            eintraege,
            papierkorb: korb.map((zeile) => imKorb(zeile, aus)),
            stage,
        };
    });

    app.post(
        NEWS_ADMIN_URL,
        { ...pflegen, schema: { body: NewsAnlegenBody, response: { 200: OperationReceipt, ...ADMIN_ERRORS } } },
        async (request) => {
            const session = await adminSession(request);
            const { operationId, datum, titel, text, rubrik, nach } = request.body;
            // Von Hand angelegt ist sofort sichtbar (WI-0139); als Entwurf nur auf Wunsch (WI-0217).
            const zustand = request.body.zustand ?? "sichtbar";
            const sichtbar = zustand === "sichtbar";
            return await adminOperation(
                app.database!,
                session,
                { operationId, body: { action: "news.add", datum, titel, rubrik, nach, zustand } },
                async (tx) => {
                    const tag = await tagGesperrt(tx, datum);
                    const [angelegt] = await tx<{ id: string }[]>`
                        INSERT INTO public.news_entry
                            (datum, titel, text, rubrik, reihe, zustand, herkunft, von_person, freigegeben_at, freigegeben_von)
                        VALUES (${datum}::date, ${titel.trim()}, ${text.trim()}, ${rubrik}, 0, ${zustand},
                                ${session.displayName}, ${session.personId},
                                ${sichtbar ? new Date() : null}, ${sichtbar ? session.personId : null})
                        RETURNING id
                    `.catch(uebersetzt);
                    // Unter `nach`, wenn der am selben Tag steht; sonst an die Spitze des Tages.
                    const platz = nach === undefined ? 0 : tag.indexOf(nach) + 1;
                    tag.splice(platz, 0, Number(angelegt?.id));
                    await reiheDesTages(tx, tag);
                    return {
                        receipt: { environment: session.environment, affected: [], derivedWork: [], warnings: [] },
                        event: {
                            ...actorFields(session, request),
                            action: "system.news_added",
                            targetRef: `news:${angelegt?.id ?? "?"}`,
                            details: { datum, rubrik },
                        },
                    };
                },
            );
        },
    );

    app.post(
        `${NEWS_ADMIN_URL}/:id`,
        {
            ...pflegen,
            schema: {
                params: NewsParams,
                body: NewsAendernBody,
                response: { 200: OperationReceipt, ...ADMIN_ERRORS },
            },
        },
        async (request) => {
            const session = await adminSession(request);
            const { id } = request.params;
            const { operationId, titel, text, datum, rubrik, zustand, papierkorb } = request.body;
            if (papierkorb !== undefined && [titel, text, datum, rubrik, zustand].some((feld) => feld !== undefined)) {
                throw new ApiError(
                    NEWS_ERROR_STATUS.news_papierkorb_allein,
                    "news_papierkorb_allein",
                    "Papierkorb steht allein, ohne andere Änderung.",
                );
            }
            return await adminOperation(
                app.database!,
                session,
                { operationId, body: { action: "news.change", id, zustand, papierkorb, datum } },
                async (tx) => {
                    const [vorher] = await tx<
                        { zustand: NewsZustand; datum: Date; geloescht_aus: NewsZustand | null; im_korb: boolean }[]
                    >`
                        SELECT zustand, datum, geloescht_aus, geloescht_at IS NOT NULL AS im_korb
                          FROM public.news_entry WHERE id = ${id} FOR UPDATE
                    `.catch(uebersetzt);
                    if (vorher === undefined) {
                        throw new ApiError(
                            NEWS_ERROR_STATUS.news_not_found,
                            "news_not_found",
                            "Diesen Eintrag gibt es nicht.",
                        );
                    }
                    const protokoll = (von: string, nach: string) => ({
                        receipt: { environment: session.environment, affected: [], derivedWork: [], warnings: [] },
                        event: {
                            ...actorFields(session, request),
                            action: "system.news_changed" as const,
                            targetRef: `news:${String(id)}`,
                            details: { von, nach },
                        },
                    });
                    const vonZustand = vorher.im_korb ? "papierkorb" : vorher.zustand;
                    if (papierkorb === true) {
                        // 🔴 Ein sichtbarer Eintrag wird zugleich versteckt: So zeigt auch ein Release ohne 0146 nichts Gelöschtes.
                        await tx`
                            UPDATE public.news_entry
                               SET geloescht_at = now(), geloescht_von = ${session.personId}::uuid, geloescht_aus = zustand,
                                   zustand = CASE WHEN zustand = 'sichtbar' THEN 'versteckt' ELSE zustand END,
                                   geaendert_at = now()
                             WHERE id = ${id} AND geloescht_at IS NULL
                        `;
                        return protokoll(vonZustand, "papierkorb");
                    }
                    if (papierkorb === false) {
                        await tx`
                            UPDATE public.news_entry
                               SET zustand = COALESCE(geloescht_aus, zustand), geloescht_at = NULL, geloescht_von = NULL,
                                   geloescht_aus = NULL, geaendert_at = now()
                             WHERE id = ${id} AND geloescht_at IS NOT NULL
                        `;
                        return protokoll(vonZustand, vorher.geloescht_aus ?? vorher.zustand);
                    }
                    // 🔴 „sichtbar“ heißt: mit Zeitpunkt und Person — die Datenbank lässt nichts anderes zu (0119). Zurück auf
                    // „entwurf“ räumt beides ab; wer eine Freigabe zurücknehmen will, versteckt sie stattdessen.
                    const wirdSichtbar = zustand === "sichtbar" && vorher.zustand !== "sichtbar";
                    const wirdEntwurf = zustand === "entwurf";
                    // Ein neues Datum stellt den Eintrag an die Spitze seines neuen Tages.
                    const neuerTag = datum !== undefined && datum !== vorher.datum.toISOString().slice(0, 10);
                    const tag = neuerTag ? await tagGesperrt(tx, datum) : [];
                    await tx`
                        UPDATE public.news_entry
                           SET titel = COALESCE(${titel?.trim() ?? null}, titel),
                               text = COALESCE(${text?.trim() ?? null}, text),
                               datum = COALESCE(${datum ?? null}::date, datum),
                               rubrik = COALESCE(${rubrik ?? null}, rubrik),
                               zustand = COALESCE(${zustand ?? null}, zustand),
                               geaendert_at = now(),
                               freigegeben_at = CASE WHEN ${wirdSichtbar} THEN now()
                                                     WHEN ${wirdEntwurf} THEN NULL
                                                     ELSE freigegeben_at END,
                               freigegeben_von = CASE WHEN ${wirdSichtbar} THEN ${session.personId}::uuid
                                                      WHEN ${wirdEntwurf} THEN NULL
                                                      ELSE freigegeben_von END
                         WHERE id = ${id}
                    `.catch(uebersetzt);
                    if (neuerTag) await reiheDesTages(tx, [id, ...tag]);
                    return protokoll(vonZustand, zustand ?? vorher.zustand);
                },
            );
        },
    );
};

/**
 * Der öffentliche Lesepfad, außerhalb der Verwaltung (dort gilt `no-store`; hier der Cache, den Legacy auch hatte). Eigenes Plugin aus
 * demselben Grund wie `contentStateRoutes`: Die Hülle der Verwaltung setzt `no-store` für alles, was unter ihr hängt.
 */
export const newsPublicRoutes: FastifyPluginAsyncTypebox = async (app) => {
    app.get(
        NEWS_URL,
        { config: { auth: "public" }, schema: { response: { 200: NewsListe, 304: Type.Null() } } },
        async (request, reply) => {
            const zeilen = await app.database!<Zeile[]>`
                SELECT n.id, n.datum, n.titel, n.text, n.rubrik, n.zustand, n.herkunft, n.quelle, n.erstellt_at,
                       n.freigegeben_at, NULL::text AS freigegeben_name
                  FROM public.news_entry n
                 WHERE n.zustand = 'sichtbar' AND n.geloescht_at IS NULL
                 ORDER BY n.datum DESC, n.reihe DESC, n.id DESC
                 LIMIT ${NEWS_SEITE}
            `.catch(uebersetzt);
            const eintraege = zeilen.map(oeffentlich);
            // Der ETag hängt an dem, was tatsächlich dasteht: Eine Freigabe oder ein Verstecken ändert ihn, ein Entwurf nicht.
            const etag = `"n${createHash("sha256").update(JSON.stringify(eintraege)).digest("hex").slice(0, 16)}"`;
            reply.header("cache-control", `public, max-age=${String(NEWS_CACHE_S)}`);
            reply.header("etag", etag);
            if (request.headers["if-none-match"] === etag) return reply.code(304).send(null);
            return { stand: eintraege[0]?.datum ?? null, eintraege };
        },
    );
};
