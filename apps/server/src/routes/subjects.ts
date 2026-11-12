import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import type { FastifyReply } from "fastify";
import { Type, type TSchema } from "@sinclair/typebox";
import {
    MapPointDetail,
    MapPointQuery,
    ResolveLinkQuery,
    ResolveLinkResponse,
    SUBJECT_API_BASE,
    SUBJECT_LIMITS,
    SUBJECT_MAP_POINT_URL,
    SUBJECT_PATH_SUBTYPES,
    pathChainKey,
    SUBJECT_RESOLVE_LINK_URL,
    SubjectCitymapsSection,
    SubjectDetail,
    SubjectLiteratureSection,
    SubjectLoreSection,
    SubjectStaettenSection,
    SubjectReviewsSection,
    SubjectSourcesSection,
    SubjectSprachTrefferSection,
    SPRACH_TREFFER_ARTEN,
    SUBJECT_WETTER_SYMBOL_PFAD,
    mapPointLayers,
    readObjectLink,
    type SubjectDetailKind,
    type SubjectSection,
    FastifyErrorBody,
} from "@avesmaps3d/shared";
import { istOhneKontext } from "../subjects/context.ts";
import { spracheDetail, spracheTrefferAbschnitt } from "../subjects/detail-sprache.ts";
import { wetterSymbolDetail } from "../subjects/detail-wetter.ts";
import { markiereOeffentlichAusgeblendet, pausiereAbschnitt, pausiereVorkommen } from "../subjects/pausiert.ts";
import type { DetailRequest, SubjectService } from "../subjects/service.ts";
import { istAus } from "../system/inhaltsstand.ts";

/**
 * Die Lese-Endpunkte der Subjects (WI-0063 P4, Entwurf Abschnitt 3):
 *
 *     GET /api/subjects/{kind}/{id}            SubjectDetail (place, path, area, territory, peak, powerline)
 *     GET /api/subjects/{kind}/{id}/sources      die Quellen des Subjects selbst, nie vererbt
 *     GET /api/subjects/{kind}/{id}/literature   die Werke der Spielliteratur, die es nennen (D3)
 *     GET /api/subjects/{kind}/{id}/citymaps     die Karten, die es abbilden (D2)
 *     GET /api/subjects/{kind}/{id}/reviews      die sichtbaren Bewertungen (D4, nur Orte)
 *     GET /api/subjects/{kind}/{id}/lore         die Vorkommen: Waren, Fauna, Flora, Spezies (D5, WI-0091)
 *     GET /api/subjects/{kind}/{id}/staetten     die Staetten eines Ortes, nach Art gegliedert (D7, WI-0109; nur Orte)
 *     GET /api/subjects/climate/{band}         SubjectDetail nur mit Kopf: Name, Art und Ziel eines Klimabands (WI-0063 27.12)
 *     GET /api/subjects/sprache/{id}           SubjectDetail einer Sprache (WI-0261 S5b): Felder des Wikis, Treffer, Quellen; keine Sektionen
 *     GET /api/subjects/sprache/{id}/treffer/{art}  alle Treffer einer Art (territory, region, place, path), erst beim Aufklappen der Zeile
 *     GET /api/subjects/wetter-symbol/{id}     SubjectDetail eines Wetter-Icons mit Wiki-Verweis (WI-0288): Typ, Region, Kurzbeschreibung, Wikizeile
 *     GET /api/subjects/map-point?x=&y=[&layers=]  MapPointDetail: Kontext exakt am Punkt, mit `layers` nur die Landschaften
 *                                              der aktiven Ansicht (Nachtrag zu WI-0083); ohne `layers` wie bisher alle.
 *                                              Die vier Vorkommenszeilen reisen HIER mit (`lore`, WI-0110): ein Kartenpunkt
 *                                              hat keine Sektionsadresse, wie die Routenetappe
 *     GET /api/subjects/resolve-link?<param>=  ein Ref, Kandidaten oder nichts: Legacys Objektlinks
 *
 * 🔴 NUR LESEN. Kein Schreibpfad, kein Nebeneffekt, keine Sitzung, kein HTML: strukturierte Daten, Wiki-Text als Rohtext mit
 * Provenienz. Die Kennung eines Subjects ist die der Fachdomäne, nie sein Anzeigename (Weg: ein Ankerabschnitt oder der Kettenschlüssel
 * `name:<Name>` der Suche).
 *
 * 🔴 Kostenschranke nach dem Muster von `/api/areas/at` (WI-0058): alle Parameter im Schema begrenzt, höchstens `concurrent`
 * Abfragen je Prozess gleichzeitig (sonst 503 `busy` mit `Retry-After`), PostgreSQL bricht nach der Zeitgrenze des Dienstes ab (503 über den
 * Fehlerhandler). Antworten dürfen kurz im Cache liegen: Sie tragen ihre `revision`.
 *
 * Inhaltsschalter (WI-0127 SYS-10): Literatur, Kartensammlung, Bewertungen und die Vorkommen je Art antworten ausgeblendet leer mit
 * `paused` beziehungsweise `pausedKinds` (`subjects/pausiert.ts`), auch an einer freien Kartenstelle; den Stand hält der Store der
 * Anwendung.
 *
 * 🪤 Fehlerform im Antwortschema: Steht 400 im Schema, braucht es Fastifys eigene Form, sonst wird aus dem 400 ein 500
 * (`route-error-shapes.test.ts`).
 */

const ValidationError = FastifyErrorBody;
const NotFound = Type.Object({ error: Type.Literal("not_found") });
const SubjectError = Type.Object({
    error: Type.Union([Type.Literal("busy"), Type.Literal("database_unavailable")]),
});

const UUID = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";
const UuidParams = Type.Object({ id: Type.String({ pattern: `^${UUID}$` }) });
/**
 * Ein Weg nennt einen Ankerabschnitt (UUID) oder den Kettenschlüssel `name:<Name>` der Suche (WI-0177 Schritt 2b); alte Links tragen
 * noch `Name:Wegtyp`.
 */
const PathParams = Type.Object({
    id: Type.String({
        pattern: `^(${UUID}|${pathChainKey("")}.+|.+:(${SUBJECT_PATH_SUBTYPES.join("|")}))$`,
        maxLength: 400,
    }),
});
const PathQuery = Type.Object({
    wiki: Type.Optional(Type.String({ minLength: 1, maxLength: 300 })),
    editor: Type.Optional(Type.Boolean()),
});
/** Eine Sektion: `editor=true` zeigt einem Editor ausgeblendete Abschnitte echt (WI-0127 SYS-11); ohne Recht hebt es nichts auf. */
const SectionQuery = Type.Object({ editor: Type.Optional(Type.Boolean()) });
const PathSectionQuery = Type.Object({
    wiki: Type.Optional(Type.String({ minLength: 1, maxLength: 300 })),
    editor: Type.Optional(Type.Boolean()),
});
/**
 * Ein Detail: `editor=true` liest ein Editor am Zwischenspeicher vorbei (WI-0193). Nginx hält `public, max-age=60` für ALLE
 * Angemeldeten (`ops/deploy/staging-deploy.sh`, Betreiber 2026-10-12); nach „Verbergen“ las das Menü am Ort so 60 s lang den
 * alten Stand und bot wieder „Verbergen“ an (EDIT-0003 T35 (1)). Ohne das Recht hebt die Angabe nichts auf.
 */
const DetailQuery = Type.Object({
    editor: Type.Optional(Type.Boolean()),
    /**
     * Der Stand der Reisebilder (`GET /api/content-state`), nur als Teil der Adresse: Nginx schlüsselt nach `$request_uri`, ein neu freigegebenes Bild trifft also nie die 60 s alte Antwort des Ortes (WI-0272).
     * Der Server liest ihn nicht.
     */
    stand: Type.Optional(Type.String({ maxLength: 64 })),
});
/** Der Schlüssel eines Klimabands (`climate_zone_type.type_key`), wie `ClimateRef`. */
const ClimateParams = Type.Object({ band: Type.String({ pattern: "^[a-z][a-z0-9_]{0,63}$" }) });
const SprachTrefferParams = Type.Object({
    id: Type.String({ pattern: `^${UUID}$` }),
    art: Type.Union(SPRACH_TREFFER_ARTEN.map((art) => Type.Literal(art))),
});

const UUID_ONLY = new RegExp(`^${UUID}$`);

const DETAIL_KINDS: readonly Exclude<SubjectDetailKind, "path">[] = ["place", "territory", "peak", "area", "powerline"];

export const subjectRoutes: FastifyPluginAsyncTypebox = async (app) => {
    // Die laufenden Abfragen dieses Prozesses (Semaphor), alle Subject-Routen zusammen.
    let running = 0;
    const service: SubjectService | undefined = app.subjects;

    /** Führt die Arbeit unter der Drossel aus; `null` heißt: die Drossel hat abgewiesen (503 ist schon gesendet). */
    const guarded = async <T>(
        reply: FastifyReply,
        work: (subjects: SubjectService) => Promise<T>,
    ): Promise<{ result: T } | { rejected: FastifyReply }> => {
        if (!service) return { rejected: reply.code(503).send({ error: "database_unavailable" }) };
        if (running >= SUBJECT_LIMITS.concurrent) {
            void reply.header("Retry-After", "1");
            return { rejected: reply.code(503).send({ error: "busy" }) };
        }
        running += 1;
        try {
            return { result: await work(service) };
        } finally {
            running -= 1;
        }
    };
    const cacheable = (reply: FastifyReply): void => {
        void reply.header("cache-control", `public, max-age=${String(SUBJECT_LIMITS.cacheSeconds)}`);
    };
    const notFound = (reply: FastifyReply): FastifyReply => {
        void reply.header("cache-control", "no-store");
        return reply.code(404).send({ error: "not_found" });
    };

    /** Der Schalterstand für eine Antwort; ohne Datenbank (kein Store) gilt keiner. */
    const isOff = async (): Promise<(key: string) => boolean> => {
        const store = app.inhaltsschalter;
        if (store === undefined) return () => false;
        const stand = await store.read();
        return (key) => istAus(stand, key);
    };

    const responses = (ok: TSchema) => ({
        200: ok,
        400: ValidationError,
        404: NotFound,
        503: SubjectError,
    });

    /**
     * Die Sektionen als Tafel (WI-0063 P8): Name in der Adresse, Antwortschema, und wie der Dienst sie liest. Eine neue Sektion ist
     * eine Zeile hier, keine zwei weiteren `app.get`-Blöcke je Art.
     */
    const SECTIONS: readonly {
        name: SubjectSection;
        schema: TSchema;
        read: (subjects: SubjectService, request: DetailRequest) => Promise<unknown>;
    }[] = [
        { name: "sources", schema: SubjectSourcesSection, read: (s, r) => s.sources(r) },
        { name: "literature", schema: SubjectLiteratureSection, read: (s, r) => s.literature(r) },
        { name: "citymaps", schema: SubjectCitymapsSection, read: (s, r) => s.citymaps(r) },
        { name: "reviews", schema: SubjectReviewsSection, read: (s, r) => s.reviews(r) },
        { name: "lore", schema: SubjectLoreSection, read: (s, r) => s.lore(r) },
        { name: "staetten", schema: SubjectStaettenSection, read: (s, r) => s.staetten(r) },
    ];

    /**
     * Einen Lesepfad anmelden: Drossel, 404 ohne Subject, kurzer Cache - für Detail und jede Sektion derselbe Rahmen. Ein Editor mit
     * `use_editor_menu` und `?editor=true` liest frisch (`private, no-store`, `DetailQuery`); dieselbe Antwort, nur nie aus einem
     * öffentlichen Zwischenspeicher.
     */
    const route = <P, Q extends { editor?: boolean }>(
        url: string,
        schema: { params: TSchema; querystring: TSchema; response: ReturnType<typeof responses> },
        read: (subjects: SubjectService, params: P, query: Q) => Promise<unknown>,
    ): void => {
        app.get(url, { schema }, async (httpRequest, reply) => {
            const query = httpRequest.query as Q;
            const outcome = await guarded(reply, (subjects) => read(subjects, httpRequest.params as P, query));
            if ("rejected" in outcome) return outcome.rejected;
            if (outcome.result === null) return notFound(reply);
            if (istOhneKontext(outcome.result)) {
                httpRequest.log.warn(
                    { grund: "kontext_zeitgrenze" },
                    "subject: Kontext an der Zeitgrenze, Antwort ohne ihn",
                );
                void reply.header("cache-control", "no-store");
            } else if (query.editor === true && (await httpRequest.auth.capabilities()).has("use_editor_menu"))
                void reply.header("cache-control", "private, no-store");
            else cacheable(reply);
            return outcome.result;
        });
    };

    /**
     * Eine Sektion mit den Inhaltsschaltern (WI-0127 SYS-10, SYS-11): für Besucher ausgeblendet leer mit `paused`. Ein Editor mit
     * `use_editor_menu` und `?editor=true` sieht sie echt, mit `publicHidden`, und nie aus einem öffentlichen Zwischenspeicher. Die
     * Adresse allein hebt nichts auf (SYS-0001 §3.4): ohne das Recht dieselbe Antwort wie ohne den Schalter.
     */
    const sectionRoute = <Q extends { editor?: boolean }>(
        url: string,
        params: TSchema,
        querystring: TSchema,
        section: (typeof SECTIONS)[number],
        detail: (id: string, query: Q) => DetailRequest,
    ): void => {
        app.get(
            url,
            { schema: { params, querystring, response: responses(section.schema) } },
            async (httpRequest, reply) => {
                const query = httpRequest.query as Q;
                const editor = query.editor === true && (await httpRequest.auth.capabilities()).has("use_editor_menu");
                const id = (httpRequest.params as { id: string }).id;
                const outcome = await guarded(reply, (subjects) => section.read(subjects, detail(id, query)));
                if ("rejected" in outcome) return outcome.rejected;
                if (outcome.result === null) return notFound(reply);
                const off = await isOff();
                if (editor) {
                    void reply.header("cache-control", "private, no-store");
                    return markiereOeffentlichAusgeblendet(section.name, outcome.result, off);
                }
                cacheable(reply);
                return pausiereAbschnitt(section.name, outcome.result, off);
            },
        );
    };

    for (const kind of DETAIL_KINDS) {
        const request = (id: string): DetailRequest => ({ kind, id: id.toLowerCase() });
        route<{ id: string }, { editor?: boolean }>(
            `${SUBJECT_API_BASE}/${kind}/:id`,
            { params: UuidParams, querystring: DetailQuery, response: responses(SubjectDetail) },
            (subjects, params) => subjects.detail(request(params.id)),
        );
        for (const section of SECTIONS) {
            sectionRoute(`${SUBJECT_API_BASE}/${kind}/:id/${section.name}`, UuidParams, SectionQuery, section, (id) =>
                request(id),
            );
        }
    }

    route<{ band: string }, { editor?: boolean }>(
        `${SUBJECT_API_BASE}/climate/:band`,
        { params: ClimateParams, querystring: DetailQuery, response: responses(SubjectDetail) },
        (subjects, params) => subjects.climate(params.band),
    );

    // Eine Sprache (WI-0261 S5b): ein Detail ohne Sektionen, unter derselben Drossel und demselben Cache wie jedes Subject.
    route<{ id: string }, { editor?: boolean }>(
        `${SUBJECT_API_BASE}/sprache/:id`,
        { params: UuidParams, querystring: DetailQuery, response: responses(SubjectDetail) },
        async (subjects, params) => {
            // Ohne Datenbank gibt es keinen Dienst; die Drossel hat dann schon mit 503 geantwortet.
            const database = app.database;
            return database === undefined
                ? null
                : spracheDetail(database, await subjects.index(), params.id.toLowerCase());
        },
    );

    // Ein Wetter-Icon mit Wiki-Verweis (WI-0288): ein Detail ohne Sektionen wie die Sprache; ohne Verweis 404.
    route<{ id: string }, { editor?: boolean }>(
        `${SUBJECT_API_BASE}/${SUBJECT_WETTER_SYMBOL_PFAD}/:id`,
        { params: UuidParams, querystring: DetailQuery, response: responses(SubjectDetail) },
        async (subjects, params) => {
            const database = app.database;
            return database === undefined
                ? null
                : wetterSymbolDetail(database, await subjects.index(), params.id.toLowerCase());
        },
    );

    // Alle Treffer einer Art (WI-0261, Betreiber 2026-10-31): die aufgeklappte Zeile unter „Wo sie gesprochen wird“ holt sie wie eine Vorkommenszeile erst beim Öffnen.
    route<{ id: string; art: (typeof SPRACH_TREFFER_ARTEN)[number] }, { editor?: boolean }>(
        `${SUBJECT_API_BASE}/sprache/:id/treffer/:art`,
        { params: SprachTrefferParams, querystring: DetailQuery, response: responses(SubjectSprachTrefferSection) },
        async (subjects, params) => {
            const database = app.database;
            return database === undefined
                ? null
                : spracheTrefferAbschnitt(database, await subjects.index(), params.id.toLowerCase(), params.art);
        },
    );

    const pathRequest = (id: string, wiki: string | undefined): DetailRequest => {
        const hint = wiki === undefined ? {} : { wiki };
        return UUID_ONLY.test(id)
            ? { kind: "path", anchor: id.toLowerCase(), ...hint }
            : { kind: "path", chain: id, ...hint };
    };
    route<{ id: string }, { wiki?: string; editor?: boolean }>(
        `${SUBJECT_API_BASE}/path/:id`,
        { params: PathParams, querystring: PathQuery, response: responses(SubjectDetail) },
        (subjects, params, query) => subjects.detail(pathRequest(params.id, query.wiki)),
    );
    for (const section of SECTIONS) {
        sectionRoute<{ wiki?: string; editor?: boolean }>(
            `${SUBJECT_API_BASE}/path/:id/${section.name}`,
            PathParams,
            PathSectionQuery,
            section,
            (id, query) => pathRequest(id, query.wiki),
        );
    }

    app.get(
        SUBJECT_MAP_POINT_URL,
        {
            schema: {
                querystring: MapPointQuery,
                response: { 200: MapPointDetail, 400: ValidationError, 503: SubjectError },
            },
        },
        async (httpRequest, reply) => {
            const { x, y, layers } = httpRequest.query;
            // Die Ebenen der aktiven Ansicht (Nachtrag zu WI-0083): zerlegt an EINER Stelle im Vertrag, nie hier gedeutet.
            const inView = mapPointLayers(layers);
            const outcome = await guarded(reply, (subjects) => subjects.mapPoint(x, y, inView));
            if ("rejected" in outcome) return outcome.rejected;
            cacheable(reply);
            const { lore, ...rest } = outcome.result;
            if (lore === undefined) return outcome.result;
            // Die Vorkommen reisen hier mit (WI-0110); eine ausgeblendete Art fehlt wie in der Sektion (WI-0127 SYS-10).
            const { rows } = pausiereVorkommen(lore, await isOff());
            return rows.length === lore.length ? outcome.result : rows.length === 0 ? rest : { ...rest, lore: rows };
        },
    );

    app.get(
        SUBJECT_RESOLVE_LINK_URL,
        {
            schema: {
                querystring: ResolveLinkQuery,
                response: { 200: ResolveLinkResponse, 400: ValidationError, 503: SubjectError },
            },
        },
        async (httpRequest, reply) => {
            const query = httpRequest.query as Record<string, string | undefined>;
            const link = readObjectLink((name) => query[name]);
            if (link === null) {
                // Nur Leerraum als Wert: kein Objektlink, eine falsche Anfrage (in Fastifys Form, sonst würde daraus ein 500).
                return reply.code(400).send({
                    statusCode: 400,
                    code: "FST_ERR_VALIDATION",
                    error: "Bad Request",
                    message: "querystring must carry at least one non-blank object link parameter",
                });
            }
            const outcome = await guarded(reply, (subjects) => subjects.resolveLink(link));
            if ("rejected" in outcome) return outcome.rejected;
            cacheable(reply);
            return outcome.result;
        },
    );
};
