import {
    SUBJECT_LIMITS,
    type LandscapeLayer,
    type MapPointDetail,
    type ObjectLinkRequest,
    type ResolveLinkResponse,
    type SubjectCitymapsSection,
    type SubjectDetail,
    type SubjectDetailKind,
    type SubjectLiteratureSection,
    type RouteStageLoreResponse,
    type RouteUnterwegsRequest,
    type RouteUnterwegsResponse,
    type SubjectLoreSection,
    type SubjectRef,
    type SubjectReviewsSection,
    type SubjectSourcesSection,
    type SubjectStaettenSection,
} from "@avesmaps3d/shared";
import { isStatementCancelled, withStatementTimeout, type Database } from "../database.ts";
import { areaDetail } from "./detail-area.ts";
import { climateDetail } from "./detail-climate.ts";
import { pathDetail, pathGroupOf, type PathInput } from "./detail-path.ts";
import { peakDetail } from "./detail-peak.ts";
import { placeDetail } from "./detail-place.ts";
import { powerlineDetail, powerlineMembers } from "./detail-powerline.ts";
import { territoryDetail } from "./detail-territory.ts";
import { mapPointDetail } from "./map-point.ts";
import { resolveObjectLink } from "./resolve-link.ts";
import { readSubjectRevision } from "./revision.ts";
import { listCitymaps } from "./sections/citymaps.ts";
import { listLiterature } from "./sections/literature.ts";
import { listLore, loreCarriersOf } from "./sections/lore.ts";
import { listReviews } from "./sections/reviews.ts";
import { listStaetten } from "./sections/staetten.ts";
import { listSources } from "./sections/sources.ts";
import { unterwegsDerRoute } from "./sections/unterwegs.ts";
import { areaGroupMembers, buildSubjectIndex, canonicalAreaRef, type SubjectIndex } from "./subject-index.ts";

/**
 * Was ein Detail-Abruf nennt: die Kennung der Fachdomäne, nie einen Anzeigenamen. Ein Weg nennt einen Ankerabschnitt ODER seinen
 * Kettenschlüssel `name:<Name>` (die Suche kennt nur ihn), dazu optional den Wiki-Schlüssel eines von mehreren Wegen.
 */
export type DetailRequest =
    { kind: "place" | "territory" | "peak" | "area" | "powerline"; id: string } | ({ kind: "path" } & PathInput);

/**
 * Der Gegenstand, gegen den {@link listLore} den Kontinentlink prüft: „führt ‚Überall in Aventurien‘ auf MICH?“ (WI-0106).
 *
 * 🔴 **Eine Etappe kann dieses Ziel nie sein.** Das Ziel ist immer die Landschaft, die den Kontinentschlüssel trägt
 * (`continentTarget` schickt `wiki:aventurien` durch dieselbe Schleuse wie jeden Objektlink und bekommt einen `area`-Ref
 * zurück); eine Etappe lebt im Planer und hat kein Kartenobjekt. Der Vergleich greift also nie - und genau das ist die
 * Aussage. Darum steht hier die Etappe selbst und kein erfundenes Kartenobjekt; ihr Index steht in der Anfrage nicht, weil
 * er an der Antwort nichts ändert.
 */
const STAGE_SELF: SubjectRef = { kind: "routeStage", index: 0, routeKey: "-" };

/**
 * Die Zeit, die die Vorkommen einer ganzen Route höchstens rechnen (WI-0257 S4), als Notbremse: Gebündelt (`sections/unterwegs.ts`) braucht eine Route mit 67 Etappen lokal rund
 * 0,2 s in einer festen Zahl von Abfragen (vorher 1,9 s in 845 Abfragen, je Etappe eine eigene Transaktion; auf der Stage brach eine Route mit 68 Etappen nach diesen 15 s ab). Sie gilt für die
 * ganze Route: zwischen den Abfragen, und jede Abfrage bricht PostgreSQL am Rest des Budgets ab. Darüber antwortet die Route mit 503 statt mit einer halben Liste und gibt ihren Rechenplatz
 * (`routes/stage-lore.ts`) frei.
 */
export const UNTERWEGS_BUDGET_MS = 15_000;

/** Die Rechnung einer Route hat ihr Zeitbudget aufgebraucht; die Route antwortet 503, die Oberfläche lässt die Box dann weg. */
export class UnterwegsZeitbudget extends Error {
    constructor() {
        super("Die Vorkommen der Route brauchen länger als erlaubt");
        this.name = "UnterwegsZeitbudget";
    }
}

/**
 * Der Dienst der Subjects (WI-0063 P4): Detail je Art, Quellen-Sektion, Kartenpunkt und Auflösung der Objektlinks. Er hält den
 * Speicherindex je Revision (`readSubjectRevision`): die Revision wird bei jeder Anfrage gelesen (eine winzige Abfrage), der Index nur
 * neu gebaut, wenn sie sich geändert hat; mehrere gleichzeitige Anfragen teilen EINEN Aufbau.
 *
 * 🔴 NUR LESEN. Kein Schreibpfad, kein Nebeneffekt.
 */
export interface SubjectService {
    /** Der Index zur aktuellen Revision (gebaut, falls nötig). */
    index(): Promise<SubjectIndex>;
    /** `null`, wenn es das Subject nicht gibt (unbekannt, stillgelegt, verborgen). */
    detail(request: DetailRequest): Promise<SubjectDetail | null>;
    sources(request: DetailRequest): Promise<SubjectSourcesSection | null>;
    /** Die Werke der Spielliteratur, die das Subject nennen (D3); `null`, wenn es das Subject nicht gibt. */
    literature(request: DetailRequest): Promise<SubjectLiteratureSection | null>;
    /** Die Karten der Kartensammlung, die das Subject abbilden (D2). */
    citymaps(request: DetailRequest): Promise<SubjectCitymapsSection | null>;
    /** Die sichtbaren Bewertungen eines Ortes (D4); nur Orte haben welche, sonst eine leere Sektion. */
    reviews(request: DetailRequest): Promise<SubjectReviewsSection | null>;
    /**
     * Die Vorkommen eines Gegenstands (D5, WI-0091): die vier Zeilen samt aufgeklapptem Inhalt. 🔴 Verzögert - sie stehen nie in
     * der Detailantwort (gemessen 2026-10-06: Median 47 geerbte Einträge je Ort, höchstens 256). Weg und Kraftlinie sind kein
     * Zielraum und bekommen eine leere Sektion.
     */
    lore(request: DetailRequest): Promise<SubjectLoreSection | null>;
    /**
     * Die Vorkommen einer ROUTENETAPPE (WI-0106): die vier Zeilen samt Inhalt, gesammelt aus den Wegen, über die die Etappe
     * läuft. 🔴 **Dieselbe Rechnung wie bei einem Weg, nur mit der Kette als Linie** - `loreCarriersOf(…, "path", paths)` ist
     * die EINE Stelle für das Enthaltensein (WI-0103) und nimmt eine LISTE von Wegen. Eine Etappe hat darum nur „Aus der
     * Region“ und den Link; eigene Einträge kann sie strukturell nicht tragen.
     *
     * 🪤 Hier gibt es nichts zu verfehlen: Eine leere Liste (Querfeldein, freie Seefahrt) ist ein gültiger Fall und bekommt
     * die Zeilen mit dem Link. `null` gibt es nicht - eine Etappe kann der Server nicht „nicht finden“, sie gehört dem Planer.
     *
     * 🔴 Seit WI-0257 S2 nennt der Planer dazu die `lines` der Abschnitte OHNE Weg (Verlauf in Kartenkoordinaten): Querfeldein und freies
     * Wasser haben keine Zeile in `path`, aber einen Verlauf, der durch Flächen führt. Die Regeln der Einträge werden entlang der Wege
     * und dieser Linien gefragt.
     */
    stageLore(paths: readonly string[], lines?: readonly (readonly number[])[]): Promise<RouteStageLoreResponse>;
    /**
     * Die Vorkommen der GANZEN Route (WI-0257 S4, „Unterwegs gibt es:“): jeder Eintrag, den das Panel irgendeiner Etappe unter „Aus der Region“ nennt, einmal, mit den Nummern seiner Etappen und der
     * Gegend, in der er zuerst vorkommt. 🔴 **Dieselben Bedingungen je Etappe wie {@link stageLore}**, als Mengen über alle Etappen gerechnet (`sections/unterwegs.ts`): eine Transaktion, eine feste
     * Zahl von Abfragen je Route. Das Zeitbudget gilt für die ganze Route.
     */
    unterwegs(stages: RouteUnterwegsRequest["stages"], budgetMs?: number): Promise<RouteUnterwegsResponse>;
    /**
     * Die Stätten eines Ortes (D7, WI-0109): die Namen, nach Art gegliedert. 🔴 Verzögert wie die Vorkommen - Gareth trägt 414
     * Stätten in 121 Arten. Jede andere Art als `place` bekommt eine leere Sektion: eine Stätte liegt per Definition INNERHALB
     * einer Siedlung (Finding MCS-012).
     */
    staetten(request: DetailRequest): Promise<SubjectStaettenSection | null>;
    /** Ein Klimaband als Gegenstand nur mit Kopf (WI-0063 27.12); `null`, wenn der Schlüssel keine aktive Zone mit Form nennt. */
    climate(band: string): Promise<SubjectDetail | null>;
    /**
     * Eine freie Kartenstelle. `layers` sind die teilnehmenden Landschaftsebenen der aktiven Ansicht (Nachtrag zu WI-0083);
     * ohne Angabe antwortet sie wie bisher, mit allen Ebenen.
     */
    mapPoint(x: number, y: number, layers?: readonly LandscapeLayer[]): Promise<MapPointDetail>;
    resolveLink(request: ObjectLinkRequest): Promise<ResolveLinkResponse>;
    /** Baut den Index vorab, damit die erste Anfrage nicht darauf wartet; Fehler zeigt dann die erste Anfrage selbst. */
    warm(): void;
}

export function createSubjectService(database: Database, mapDomainId = "aventuria"): SubjectService {
    let cached: SubjectIndex | undefined;
    let building: { revision: string; promise: Promise<SubjectIndex> } | undefined;

    async function index(): Promise<SubjectIndex> {
        const revision = await readSubjectRevision(database, mapDomainId);
        if (cached?.revision === revision) return cached;
        if (building?.revision === revision) return building.promise;
        const promise: Promise<SubjectIndex> = buildSubjectIndex(database, revision, mapDomainId)
            .then((built) => {
                cached = built;
                return built;
            })
            .finally(() => {
                if (building?.promise === promise) building = undefined;
            });
        building = { revision, promise };
        return promise;
    }

    /** Das kanonische Subject und seine Träger (öffentliche IDs) für die Quellen: `null`, wenn es das Subject nicht gibt. */
    async function members(
        request: DetailRequest,
        current: SubjectIndex,
    ): Promise<{ kind: SubjectDetailKind; ref: SubjectRef; members: readonly string[] } | null> {
        switch (request.kind) {
            case "place":
            case "peak": {
                const table = request.kind === "place" ? "place" : "terrain_peak";
                // 🔴 KEIN Riegel auf is_hidden mehr (WI-0080): Hier hängt die Quellenbox des Panels
                // (`GET /api/subjects/place/{id}/sources`). Ein verborgener Ort bekam sonst sein Panel, aber
                // als einziger Ort der Karte ohne Quellen — „ganz normal, wenn er entdeckt wird" heißt auch
                // hier normal. Verborgen bleibt er in der Suche und in den Listen anderer Objekte.
                const [row] = await database.unsafe<{ id: string }[]>(
                    `SELECT t.public_id::text AS id FROM ${table} t WHERE t.public_id = $1::uuid AND t.is_active AND t.map_domain_id = $2`,
                    [request.id, current.mapDomainId],
                );
                return row ? { kind: request.kind, ref: { kind: request.kind, id: row.id }, members: [row.id] } : null;
            }
            case "territory": {
                const record = current.territories.byPublicId.get(request.id);
                return record
                    ? { kind: "territory", ref: { kind: "territory", id: record.publicId }, members: [record.publicId] }
                    : null;
            }
            case "area": {
                const ref = canonicalAreaRef(current.regions, request.id);
                return ref ? { kind: "area", ref, members: areaGroupMembers(current.regions, request.id) } : null;
            }
            case "path": {
                const group = pathGroupOf(current, request);
                return group ? { kind: "path", ref: group.ref, members: group.members } : null;
            }
            case "powerline": {
                const rows = await powerlineMembers(database, current.mapDomainId, request.id);
                const ids = rows.map((row) => row.public_id);
                const [anchor] = ids;
                return anchor === undefined
                    ? null
                    : { kind: "powerline", ref: { kind: "powerline", anchor }, members: ids };
            }
        }
    }

    return {
        index,

        async detail(request) {
            const current = await index();
            switch (request.kind) {
                case "place":
                    return placeDetail(database, current, request.id);
                case "territory":
                    return territoryDetail(database, current, request.id);
                case "peak":
                    return peakDetail(database, current, request.id);
                case "area":
                    return areaDetail(database, current, request.id);
                case "path":
                    return pathDetail(database, current, request);
                case "powerline":
                    return powerlineDetail(database, current, request.id);
            }
        },

        async sources(request) {
            const current = await index();
            const subject = await members(request, current);
            if (!subject) return null;
            const sources = await withStatementTimeout(database, SUBJECT_LIMITS.statementMs, (transaction) =>
                listSources(transaction, subject.kind, subject.members),
            );
            return { subject: subject.ref, revision: current.revision, sources };
        },

        async literature(request) {
            const current = await index();
            const subject = await members(request, current);
            if (!subject) return null;
            const works = await withStatementTimeout(database, SUBJECT_LIMITS.statementMs, (transaction) =>
                listLiterature(transaction, subject.kind, subject.members),
            );
            return { subject: subject.ref, revision: current.revision, works };
        },

        async citymaps(request) {
            const current = await index();
            const subject = await members(request, current);
            if (!subject) return null;
            const maps = await withStatementTimeout(database, SUBJECT_LIMITS.statementMs, (transaction) =>
                listCitymaps(transaction, subject.kind, subject.members),
            );
            return { subject: subject.ref, revision: current.revision, maps };
        },

        async reviews(request) {
            const current = await index();
            const subject = await members(request, current);
            if (!subject) return null;
            // Nur Orte haben Bewertungen; jede andere Art bekommt eine leere Sektion statt eines Sonderfalls im Panel.
            if (subject.kind !== "place") {
                return { subject: subject.ref, revision: current.revision, count: 0, reviews: [] };
            }
            const [id] = subject.members;
            const result = await withStatementTimeout(database, SUBJECT_LIMITS.statementMs, (transaction) =>
                listReviews(transaction, id ?? ""),
            );
            return { subject: subject.ref, revision: current.revision, ...result };
        },

        async lore(request) {
            const current = await index();
            const subject = await members(request, current);
            if (!subject) return null;
            // Am Ort braucht der Lesepfad den Punkt für das tiefste Gebiet (`lore.yaml` -> `ortsbezug.lesebezug`) und für die Regeln;
            // er steht nicht im Index. 🪤 EINE Punktabfrage für EIN Objekt - nicht die Punkt-in-Polygon-Rechnung über den ganzen
            // Ortsbestand. (Die Begründung, die der Vertrag früher dagegen nannte, war ein Sperrproblem der PHP-Sitzungen von Legacy und
            // trifft Fastify und PostGIS nicht; `lore.yaml` -> `regelauswertung.ueberholt`. Die Regeln der Einträge liest
            // `loreCarriersOf` seit WI-0257 S2 mit.)
            const point =
                subject.kind === "place"
                    ? (
                          await database<{ x: number; y: number }[]>`
                            SELECT ST_X(geom) AS x, ST_Y(geom) AS y FROM place WHERE public_id = ${subject.members[0] ?? ""}::uuid
                        `
                      )[0]
                    : undefined;
            const rows = await withStatementTimeout(database, SUBJECT_LIMITS.statementMs, async (transaction) =>
                listLore(
                    transaction,
                    current,
                    await loreCarriersOf(transaction, current, subject.kind, subject.members, point),
                    subject.ref,
                ),
            );
            return { subject: subject.ref, revision: current.revision, rows };
        },

        async staetten(request) {
            const current = await index();
            const subject = await members(request, current);
            if (!subject) return null;
            const result = await withStatementTimeout(database, SUBJECT_LIMITS.statementMs, (transaction) =>
                listStaetten(transaction, subject.kind, subject.members),
            );
            return { subject: subject.ref, revision: current.revision, ...result };
        },

        async stageLore(paths, lines = []) {
            const current = await index();
            // 🔴 `geometryStatementMs` und nicht `statementMs`: Die Stelle ist eine LINIE, und Schnitte mit Flächen rechnen in
            // GEOS (so steht es an der Grenze selbst). Gemessen braucht eine Etappe im Median 3 bis 5 ms, höchstens 62 ms.
            const rows = await withStatementTimeout(database, SUBJECT_LIMITS.geometryStatementMs, async (transaction) =>
                listLore(
                    transaction,
                    current,
                    await loreCarriersOf(transaction, current, "path", paths, undefined, lines),
                    STAGE_SELF,
                ),
            );
            return { revision: current.revision, rows };
        },

        async unterwegs(stages, budgetMs = UNTERWEGS_BUDGET_MS) {
            const current = await index();
            const deadline = Date.now() + budgetMs;
            const rest = (): number => {
                const ms = deadline - Date.now();
                if (ms <= 0) throw new UnterwegsZeitbudget();
                return Math.ceil(ms);
            };
            try {
                // 🔴 EINE Transaktion für die ganze Route (eine Verbindung, keine parallelen). Jede Abfrage bricht PostgreSQL am Ende des Budgets ab: Zwischen den Schritten
                // setzt `frist` die Grenze auf den Rest. Ohne JIT (`sections/unterwegs.ts`): Die Punkte entlang der Linien liegen für den Planer weit über `jit_above_cost`.
                const eintraege = await withStatementTimeout(
                    database,
                    rest(),
                    (transaction) =>
                        unterwegsDerRoute(transaction, current, stages, async () => {
                            await transaction.unsafe(`SET LOCAL statement_timeout = ${String(rest())}`);
                        }),
                    { jitOff: true },
                );
                return { revision: current.revision, eintraege };
            } catch (error) {
                // Jede Grenze in dieser Transaktion ist der Rest des Budgets: Ein Abbruch (57014, mitten in GEOS das XX000 „Interrupted“) ist das Budget, nicht eine kranke Datenbank.
                if (isStatementCancelled(error)) throw new UnterwegsZeitbudget();
                throw error;
            }
        },

        async climate(band) {
            return climateDetail(database, await index(), band);
        },

        async mapPoint(x, y, layers) {
            return mapPointDetail(database, await index(), x, y, layers);
        },

        async resolveLink(request) {
            return resolveObjectLink(database, await index(), request);
        },

        warm() {
            void index().catch(() => undefined);
        },
    };
}
