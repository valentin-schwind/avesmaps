import {
    INHALTE_KONTINENTE,
    INHALTE_VORKOMMEN_ARTEN,
    INHALTE_VORKOMMEN_BEZIEHUNGEN,
    INHALTE_VORKOMMEN_TREFFER_MAX,
    KANON_OBJEKTART_BEZEICHNER,
    SOURCE_REFERENCE_KINDS,
    SOURCE_TYPES,
    WIKISYNC_ORTSROLLEN,
    type InhalteHerkunft,
    type InhalteKontinent,
    type InhalteVorkommen,
    type InhalteVorkommenAnfrage,
    type InhalteVorkommenArt,
    type InhalteVorkommenBeziehung,
    type InhalteVorkommenListe,
    type InhalteVorkommenOrt,
    type InhalteVorkommenQuelle,
    type InhalteVorkommenRegel,
    type InhalteVorkommenTreffer,
    type InhalteVorkommenUrsprung,
    type InhalteVorkommenZeile,
    type InhalteVorkommenZiel,
    type InhalteVorkommenZiele,
    type InhalteVorkommenZustand,
    type SourceReferenceKind,
    type SourceType,
    type SubjectCanon,
    type WikisyncOrtsrolle,
} from "@avesmaps3d/shared";
import type { Queryable } from "../database.ts";
import { likeMuster } from "../db/like-muster.ts";
import { leiteKanonAb, type KanonQuelle } from "../kanon/ableitung.ts";
import { raumDerAdresse } from "../kanon/namensraum.ts";
import { leseNamespaceTafelImSchnitt } from "../kanon/tafel.ts";
import { TRAEGER } from "./traeger.ts";
import { leseVorkommenZitate, type VorkommenZitate } from "./vorkommen-quellen-wiki.ts";
import { bareLoreKey } from "../migration/lore-keys.ts";
import {
    ladeKetten,
    leseVorschlagRoh,
    vorschlagVeraltet,
    wikiFassung,
    wikiVorschlagVon,
    type BestandsRegel,
    type VorschlagRoh,
} from "./vorkommen-regeln-lesen.ts";

/**
 * Lesen für den Reiter „Vorkommen“ des Fensters „Inhalte bearbeiten“ (WI-0254, Runde 3): die Liste links, ein Eintrag mit Stammdaten,
 * Ortszeilen samt ihren Treffern, Regeln und Quellen, und die Suche nach Zielen für eine Ortszeile. Nur lesend; geschrieben wird in
 * `vorkommen-schreiben.ts`.
 *
 * - 🔴 **Die Identität ist der Wiki-Schlüssel** (`lore_entry.wiki_key`), wo es einen gibt; die Schnittstelle trägt die Kennung `public_id` (Migration
 *   0234). Ein Eintrag der Redaktion ohne Wiki-Artikel (Migration 0235) hat keinen Schlüssel (`wikiKey: null`), seine Identität ist `public_id`.
 * - **Die Liste** ist seitenweise (Fauna, Flora, Waren und Spezies tragen zusammen gut 1.600 Einträge). „Stillgelegt“ sind die unterdrückten
 *   (von der Redaktion oder in Legacy von Hand); was das Wiki nicht mehr kennt oder der Zug nicht mehr nennt, ist Geschichte.
 * - **Die Ortszeilen** tragen ALLE Zeilen des Eintrags (aktive und stille) in Legacys Reihenfolge; die Treffer sind die Kartenobjekte, die der Schlüssel
 *   trifft (`lore_place_target`, abgeleitet, höchstens `INHALTE_VORKOMMEN_TREFFER_MAX` je Zeile, `trefferGesamt` nennt die ganze Zahl).
 * - **Die Regeln** sind nicht ausgewertet (die Regelauswertung fehlt, WI-0253). Sie tragen ihren Fingerabdruck (`ruleKey`); die Wiki-Fassung hinter einer Regel von Hand (`wikiBasis`, `wikiJetzt`) und der
 *   Vorschlag des WikiSync am Eintrag (`wikiVorschlag`) kommen aus `vorkommen-regeln-lesen.ts` (Regeleditor, WI-0254 `--weiter`); gibt es keinen Lauf oder keine Tafel, fehlen sie.
 * - **Die Quellen** tragen Typ, „offiziell“ und Adresse der Quelle im Katalog (nur zum Lesen: Titel, Typ und Rechte ändert der Reiter „Quellen“).
 *   Dazu das Zitat des Wikis (`wiki`) und oben der Lauf (`quellenWiki`): Herkunft ist der Vergleich mit dem Wiki (WI-0254 §12, `vorkommen-quellen-wiki.ts`); ohne Lauf mit Zitaten der Vorkommen fehlen beide.
 */

const ARTEN: ReadonlySet<string> = new Set(INHALTE_VORKOMMEN_ARTEN);
const BEZIEHUNGEN: ReadonlySet<string> = new Set(INHALTE_VORKOMMEN_BEZIEHUNGEN);
const BEZUGSARTEN: ReadonlySet<string> = new Set(SOURCE_REFERENCE_KINDS);
const QUELLENTYPEN: ReadonlySet<string> = new Set(SOURCE_TYPES);
const ROLLEN: ReadonlySet<string> = new Set(WIKISYNC_ORTSROLLEN);

const art = (wert: string): InhalteVorkommenArt => (ARTEN.has(wert) ? (wert as InhalteVorkommenArt) : "fauna");
const beziehung = (wert: string): InhalteVorkommenBeziehung =>
    BEZIEHUNGEN.has(wert) ? (wert as InhalteVorkommenBeziehung) : "vorkommen";
/** Der Typ einer Quelle des Katalogs; ein unbekanntes Wort gilt als `sonstiges` (die Tafel erlaubt nur die bekannten, `feature_source_type_known`). */
const quellenTyp = (wert: string): SourceType => (QUELLENTYPEN.has(wert) ? (wert as SourceType) : "sonstiges");
const bezugsArt = (wert: string | null): SourceReferenceKind | null =>
    wert !== null && BEZUGSARTEN.has(wert) ? (wert as SourceReferenceKind) : null;
/** Die Rolle einer Ortszeile (Migration 0247): Eine Zeile ohne Rolle (Bestand aus Legacys Zug, `NULL`) und ein unbekanntes Wort gelten als `ort`, wie im Abgleich des WikiSync (`gueltigeRolle`). */
const rolle = (wert: string | null): WikisyncOrtsrolle =>
    wert !== null && ROLLEN.has(wert) ? (wert as WikisyncOrtsrolle) : "ort";
const zustand = (wert: string): InhalteVorkommenZustand =>
    wert === "retired" || wert === "suppressed" ? wert : "active";

/**
 * Wer einen Eintrag führt: Legacy (und das Wiki) oder die Hand. „Von Hand“ heißt: im Editor angelegt oder geändert (`source_system` nicht `legacy`) oder
 * von Legacys Redaktion von Hand gepflegt (`legacy_origin = manual`); beides zeigt die Liste als ◐ „manuell“.
 */
const herkunftVon = (sourceSystem: string, legacyOrigin = "unknown"): InhalteHerkunft =>
    sourceSystem === "legacy" && legacyOrigin !== "manual" ? "legacy" : "editor";
const VON_HAND_SQL = "(e.source_system <> 'legacy' OR e.legacy_origin = 'manual')";
/** Dieselbe Regel wie `ursprungVon` der Literatur, für einen beliebigen Ursprungswert. */
function ursprungVon(
    sourceSystem: string,
    legacyOrigin: string,
    targetOrigin = "legacy_import",
): InhalteVorkommenUrsprung {
    if (sourceSystem === "editor" || targetOrigin === "editor") return "manual";
    if (legacyOrigin === "wiki" || legacyOrigin === "wiki_verbreitung" || legacyOrigin === "wiki_publication")
        return "wiki";
    if (legacyOrigin === "manual") return "manual";
    return "legacy";
}

/** Unterdrückt heißt: von Hand abgeschaltet, in Legacy oder hier. Was das Wiki nicht mehr kennt (`retired`), ist keine Redaktion. */
const STILLGELEGT_SQL = "(NOT e.is_active AND (e.retired_origin = 'editor' OR e.state = 'suppressed'))";

interface ZeilenRow {
    public_id: string;
    name: string;
    kind: string;
    gruppe: string | null;
    source_system: string;
    legacy_origin: string;
    is_active: boolean;
    verknuepfungen: number;
}

function zeileVon(row: ZeilenRow): InhalteVorkommenZeile {
    return {
        id: row.public_id,
        title: row.name,
        art: art(row.kind),
        ...(row.gruppe === null ? {} : { gruppe: row.gruppe }),
        verknuepfungen: row.verknuepfungen,
        herkunft: herkunftVon(row.source_system, row.legacy_origin),
        stillgelegt: !row.is_active,
    };
}

/** Die Einträge für die Liste links. */
export async function listeVorkommen(
    database: Queryable,
    anfrage: InhalteVorkommenAnfrage,
): Promise<InhalteVorkommenListe> {
    const stand = anfrage.stand ?? "aktiv";
    const bedingungen: string[] = [];
    const werte: (string | number)[] = [];
    const parameter = (wert: string | number): string => {
        werte.push(wert);
        return `$${String(werte.length)}`;
    };
    if (stand === "aktiv") bedingungen.push("e.is_active");
    else if (stand === "stillgelegt") bedingungen.push(STILLGELEGT_SQL);
    else bedingungen.push(`(e.is_active OR ${STILLGELEGT_SQL})`);
    if (anfrage.herkunft === "legacy") bedingungen.push(`NOT ${VON_HAND_SQL}`);
    else if (anfrage.herkunft === "editor") bedingungen.push(VON_HAND_SQL);
    if (anfrage.art !== undefined) bedingungen.push(`e.kind = ${parameter(anfrage.art)}`);
    const suche = anfrage.q?.trim() ?? "";
    if (suche !== "") {
        const muster = parameter(likeMuster(suche));
        bedingungen.push(
            `(e.name ILIKE ${muster} ESCAPE '\\' OR e.gruppe ILIKE ${muster} ESCAPE '\\' OR e.wiki_key ILIKE ${muster} ESCAPE '\\'
              OR e.synonyme ILIKE ${muster} ESCAPE '\\' OR e.lebensraum ILIKE ${muster} ESCAPE '\\')`,
        );
    }
    const sortierung = anfrage.sort === "title_desc" ? "lower(e.name) DESC, e.id" : "lower(e.name), e.id";
    const limit = parameter(anfrage.limit ?? 50);
    const offset = parameter(anfrage.offset ?? 0);
    const treffer = bedingungen.join(" AND ");
    const zeilen = await database.unsafe<ZeilenRow[]>(
        `SELECT e.public_id::text AS public_id, e.name, e.kind, e.gruppe, e.source_system, e.legacy_origin, e.is_active,
                (SELECT count(*) FROM lore_place p WHERE p.lore_entry_id = e.id AND p.is_active AND p.state = 'active')::int AS verknuepfungen
           FROM lore_entry e
          WHERE ${treffer}
          ORDER BY ${sortierung}
          LIMIT ${limit} OFFSET ${offset}`,
        werte,
    );
    const [summe] = await database.unsafe<{ total: number }[]>(
        `SELECT count(*)::int AS total FROM lore_entry e WHERE ${treffer}`,
        werte.slice(0, werte.length - 2),
    );
    // Die Zahlen zählen über ALLE Arten (der Reiter nennt eine Zahl, nicht die des Unterreiters).
    const [zahlen] = await database.unsafe<{ aktiv: number; editor: number; stillgelegt: number }[]>(
        `SELECT count(*) FILTER (WHERE e.is_active)::int AS aktiv,
                count(*) FILTER (WHERE e.is_active AND ${VON_HAND_SQL})::int AS editor,
                count(*) FILTER (WHERE ${STILLGELEGT_SQL})::int AS stillgelegt
           FROM lore_entry e`,
    );
    return {
        total: summe?.total ?? 0,
        items: zeilen.map(zeileVon),
        zahlen: { aktiv: zahlen?.aktiv ?? 0, editor: zahlen?.editor ?? 0, stillgelegt: zahlen?.stillgelegt ?? 0 },
    };
}

interface EintragRow {
    id: string;
    public_id: string;
    revision: number;
    wiki_key: string | null;
    wiki_url: string | null;
    name: string;
    kind: string;
    gruppe: string | null;
    lebensraum: string | null;
    synonyme: string | null;
    editor_note: string | null;
    legacy_origin: string;
    source_system: string;
    is_active: boolean;
}

interface OrtRow {
    id: string;
    relation: string;
    place_wiki_key: string | null;
    place_title: string | null;
    key_class: string;
    target_state: string;
    target_count: number;
    role: string | null;
    state: string;
    legacy_origin: string;
    source_system: string;
    target_origin: string;
}

interface TrefferRow {
    lore_place_id: string;
    place_id: string | null;
    territory_id: string | null;
    region_id: string | null;
    terrain_peak_id: string | null;
}

/** Die Spalten der Treffer in `lore_place_target` und die Art des Trägers dazu (die Landschaft heißt in der Schnittstelle `area`). */
const TREFFER_SPALTEN: readonly { spalte: keyof TrefferRow; kind: InhalteVorkommenTreffer["kind"] }[] = [
    { spalte: "place_id", kind: "place" },
    { spalte: "territory_id", kind: "territory" },
    { spalte: "region_id", kind: "area" },
    { spalte: "terrain_peak_id", kind: "peak" },
];

/** Die Felder des Vertrags (`lore_entry_field_origin.field`) in der Sprache der Schnittstelle. */
const FELDNAMEN: Readonly<Record<string, string>> = {
    name: "name",
    kind: "art",
    gruppe: "gruppe",
    lebensraum: "lebensraum",
    synonyme: "synonyme",
};

/** Die interne Nummer eines Eintrags; `undefined`, wo es ihn nicht gibt. */
export async function eintragIntern(database: Queryable, publicId: string): Promise<string | undefined> {
    const [zeile] = await database<
        { id: string }[]
    >`SELECT id::text FROM lore_entry WHERE public_id = ${publicId}::uuid`;
    return zeile?.id;
}

async function leseOrte(database: Queryable, eintragId: string): Promise<InhalteVorkommenOrt[]> {
    const zeilen = await database<OrtRow[]>`
        SELECT p.id::text AS id, p.relation, p.place_wiki_key, p.place_title, p.key_class, p.target_state, p.target_count::int AS target_count,
               p.role, p.state, p.legacy_origin, p.source_system, p.target_origin
          FROM lore_place p
         WHERE p.lore_entry_id = ${eintragId}::bigint
         ORDER BY p.sort_order, p.id
    `;
    if (zeilen.length === 0) return [];
    const treffer = await database<TrefferRow[]>`
        SELECT t.lore_place_id::text AS lore_place_id, t.place_id::text AS place_id, t.territory_id::text AS territory_id,
               t.region_id::text AS region_id, t.terrain_peak_id::text AS terrain_peak_id
          FROM lore_place_target t
         WHERE t.lore_place_id = ANY(${zeilen.map((z) => z.id)}::bigint[])
         ORDER BY t.id
    `;
    // Eine Abfrage je Art der Träger statt eine je Treffer.
    const traeger = new Map<string, InhalteVorkommenTreffer>();
    for (const { spalte, kind } of TREFFER_SPALTEN) {
        const ids = treffer.map((t) => t[spalte] as string | null).filter((id): id is string => id !== null);
        if (ids.length === 0) continue;
        const tafeln = TRAEGER[kind];
        const gefunden = await database.unsafe<
            { id: string; public_id: string; name: string | null; subtype: string | null }[]
        >(
            `SELECT c.id::text AS id, c.public_id::text AS public_id, c.name, c.${tafeln.subtype} AS subtype
               FROM ${tafeln.carrier} c WHERE c.id = ANY($1::bigint[])`,
            [ids],
        );
        for (const eines of gefunden) {
            traeger.set(`${kind}:${eines.id}`, {
                kind,
                carrierId: eines.public_id,
                name: eines.name ?? "",
                ...(eines.subtype === null || eines.subtype === "" ? {} : { subtype: eines.subtype }),
            });
        }
    }
    const trefferJeZeile = new Map<string, InhalteVorkommenTreffer[]>();
    for (const t of treffer) {
        const art = TREFFER_SPALTEN.find(({ spalte }) => t[spalte] !== null);
        const eines = art === undefined ? undefined : traeger.get(`${art.kind}:${String(t[art.spalte])}`);
        if (eines === undefined) continue;
        const liste = trefferJeZeile.get(t.lore_place_id) ?? [];
        liste.push(eines);
        trefferJeZeile.set(t.lore_place_id, liste);
    }
    return zeilen.map((zeile): InhalteVorkommenOrt => {
        const alle = trefferJeZeile.get(zeile.id) ?? [];
        const titel = (zeile.place_title ?? "").trim();
        const name = titel !== "" ? titel : alle.length === 1 ? alle[0]!.name : (zeile.place_wiki_key ?? "");
        return {
            rowId: zeile.id,
            relation: beziehung(zeile.relation),
            wikiKey: zeile.place_wiki_key,
            name,
            keyClass: zeile.key_class === "continent" ? "continent" : "other",
            targetState:
                zeile.target_state === "resolved" ||
                zeile.target_state === "ambiguous" ||
                zeile.target_state === "unresolved"
                    ? zeile.target_state
                    : "unmatched",
            rolle: rolle(zeile.role),
            treffer: alle.slice(0, INHALTE_VORKOMMEN_TREFFER_MAX),
            trefferGesamt: Math.max(alle.length, zeile.target_count),
            state: zustand(zeile.state),
            ursprung: ursprungVon(zeile.source_system, zeile.legacy_origin, zeile.target_origin),
            herkunft: herkunftVon(zeile.source_system),
        };
    });
}

interface RegelRow {
    id: string;
    relation: string;
    legacy_origin: string;
    state: string;
    rule_key: string;
    retired_origin: string | null;
    wiki_basis_key: string | null;
}

/**
 * Die Regeln des Eintrags in jedem Zustand mit ihren Ketten. Eine Regel von Hand, die aus einer Wiki-Regel oder einem Vorschlag entstand, nennt ihre Wiki-Fassung (`wikiBasis`) und, was das Wiki
 * seitdem sagt (`wikiJetzt`); beides rechnet `vorkommen-regeln-lesen.ts`. Die Zeilen gehen mit hinaus, weil die Prüfung des Vorschlags (`aktuell`) dieselben Regeln braucht.
 */
async function leseRegeln(
    database: Queryable,
    eintragId: string,
    vorschlag: VorschlagRoh | undefined,
): Promise<{ regeln: InhalteVorkommenRegel[]; bestand: BestandsRegel[] }> {
    const regeln = await database<RegelRow[]>`
        SELECT r.id::text AS id, r.relation, r.legacy_origin, r.state, r.rule_key, r.retired_origin, r.wiki_basis_key
          FROM lore_rule r WHERE r.lore_entry_id = ${eintragId}::bigint
         ORDER BY r.sort_order, r.id
    `;
    if (regeln.length === 0) return { regeln: [], bestand: [] };
    const ketten = await ladeKetten(
        database,
        regeln.map((r) => r.id),
    );
    const idNachSchluessel = new Map(regeln.map((r) => [r.rule_key, r.id]));
    return {
        regeln: regeln.map((regel): InhalteVorkommenRegel => {
            const basisId = regel.wiki_basis_key === null ? undefined : idNachSchluessel.get(regel.wiki_basis_key);
            return {
                ruleId: regel.id,
                relation: beziehung(regel.relation),
                ursprung: ursprungVon("legacy", regel.legacy_origin),
                state: zustand(regel.state),
                ruleKey: regel.rule_key,
                bedingungen: ketten.get(regel.id) ?? [],
                ...wikiFassung(
                    {
                        relation: regel.relation,
                        legacyOrigin: regel.legacy_origin,
                        state: regel.state,
                        wikiBasisKey: regel.wiki_basis_key,
                    },
                    basisId === undefined ? undefined : ketten.get(basisId),
                    vorschlag,
                ),
            };
        }),
        bestand: regeln.map((r) => ({
            id: r.id,
            relation: r.relation,
            ruleKey: r.rule_key,
            legacyOrigin: r.legacy_origin,
            state: r.state,
            retiredOrigin: r.retired_origin,
        })),
    };
}

interface QuelleRow {
    source_id: string;
    source_key: string;
    title: string;
    source_type: string;
    is_official: boolean;
    url: string | null;
    reference_kind: string | null;
    pages: string | null;
    note: string | null;
    state: string;
    legacy_origin: string;
    source_system: string;
}

/**
 * Die Quellen eines Eintrags. Mit `zitate` (der Lauf des WikiSync hat Zitate der Vorkommen abgelegt) trägt jede das Zitat des Wikis zu diesem Eintrag (`wiki`, `null`: der Artikel zitiert sie nicht);
 * ohne bleibt das Feld weg (WI-0254 §12: die Herkunft ist der Vergleich mit dem Wiki, ohne Lauf unbekannt).
 */
async function leseQuellen(
    database: Queryable,
    eintragId: string,
    zitate: VorkommenZitate | undefined,
): Promise<InhalteVorkommenQuelle[]> {
    const zeilen = await database<QuelleRow[]>`
        SELECT f.public_id::text AS source_id, f.source_key, f.title, f.source_type, f.is_official, f.url, s.reference_kind, s.pages, s.note, s.state, s.legacy_origin,
               s.source_system
          FROM lore_entry_source s JOIN feature_source f ON f.id = s.source_id
         WHERE s.lore_entry_id = ${eintragId}::bigint
         ORDER BY (s.state = 'active') DESC, s.position, s.id
    `;
    return zeilen.map((zeile): InhalteVorkommenQuelle => ({
        sourceId: zeile.source_id,
        title: zeile.title,
        sourceType: quellenTyp(zeile.source_type),
        offiziell: zeile.is_official,
        ...(zeile.url === null ? {} : { url: zeile.url }),
        referenceKind: bezugsArt(zeile.reference_kind),
        pages: zeile.pages,
        note: zeile.note,
        state: zustand(zeile.state),
        ursprung: ursprungVon(zeile.source_system, zeile.legacy_origin),
        herkunft: herkunftVon(zeile.source_system),
        ...(zitate === undefined ? {} : { wiki: zitate.werte.get(zeile.source_key) ?? null }),
    }));
}

/**
 * Die Pille eines Eintrags nach der Kanon-Regel (`sources.yaml`, `kanon.raenge`, `kanon/ableitung.ts`): Rang 1 der Namensraum der Wiki-Adresse, Rang 2
 * und 3 die Quellen des Eintrags (offizielle zuerst, die Art als Bezeichner), Rang 4 ohne Wiki-Artikel und ohne Quelle INOFFIZIELL | Avesmaps (der
 * Vorschlag der Tafel, `KANON_OBJEKTART_BEZEICHNER`; Vorkommen haben keine Zeile in der Tafel der Objektarten, Vali wählte B am Gate). Ein Eintrag MIT
 * Schlüssel, den die Regel nicht fasst, trägt keine Pille. Gerechnet beim Lesen, nie gespeichert: Eine angehängte Quelle ändert sie sofort.
 */
async function kanonDesEintrags(
    database: Queryable,
    eintragId: string,
    wikiKey: string | null,
    wikiUrl: string | null,
): Promise<SubjectCanon | undefined> {
    const tafel = await leseNamespaceTafelImSchnitt(database);
    const verweise = await database<{ offiziell: boolean; art: string; publikation: boolean }[]>`
        SELECT f.is_official AS offiziell, f.source_type AS art, s.reference_kind IS NOT NULL AS publikation
          FROM lore_entry_source s
          JOIN feature_source f ON f.id = s.source_id AND f.is_active
         WHERE s.lore_entry_id = ${eintragId}::bigint AND s.is_active AND s.state = 'active'
    `;
    const quellen: KanonQuelle[] = verweise.map((verweis) => ({
        offiziell: verweis.offiziell,
        art: verweis.art,
        publikation: verweis.publikation,
    }));
    const ns = wikiKey === null || wikiUrl === null ? null : raumDerAdresse(wikiUrl, tafel).ns;
    const ergebnis = leiteKanonAb({ ns, quellen }, tafel);
    if (ergebnis !== null) {
        return {
            canon: ergebnis.kanon,
            ...(ergebnis.designatorType === null ? {} : { designatorType: ergebnis.designatorType }),
            ...(ergebnis.designatorCount === null ? {} : { designatorCount: ergebnis.designatorCount }),
            ...(ergebnis.designatorLabel === null ? {} : { designatorLabel: ergebnis.designatorLabel }),
        };
    }
    return wikiKey === null ? { canon: "unofficial", designatorLabel: KANON_OBJEKTART_BEZEICHNER } : undefined;
}

/** Ein Eintrag mit allem, was die Mitte und die rechte Spalte zeigen; `undefined`, wo es ihn nicht gibt. */
export async function leseVorkommen(database: Queryable, publicId: string): Promise<InhalteVorkommen | undefined> {
    const [row] = await database<EintragRow[]>`
        SELECT e.id::text AS id, e.public_id::text AS public_id, e.revision::int AS revision, e.wiki_key, e.wiki_url, e.name, e.kind, e.gruppe,
               e.lebensraum, e.synonyme, e.editor_note, e.legacy_origin, e.source_system, e.is_active
          FROM lore_entry e
         WHERE e.public_id = ${publicId}::uuid
    `;
    if (row === undefined) return undefined;
    const herkuenfte = await database<{ field: string; origin: string }[]>`
        SELECT field, origin FROM lore_entry_field_origin WHERE lore_entry_id = ${row.id}::bigint
    `;
    const feldUrsprung: Record<string, "wiki" | "manual"> = {};
    for (const eine of herkuenfte) {
        const name = FELDNAMEN[eine.field];
        if (name !== undefined && (eine.origin === "wiki" || eine.origin === "manual"))
            feldUrsprung[name] = eine.origin;
    }
    const kanon = await kanonDesEintrags(database, row.id, row.wiki_key, row.wiki_url);
    const vorschlag = await leseVorschlagRoh(database, row.id);
    const { regeln, bestand } = await leseRegeln(database, row.id, vorschlag);
    const wikiVorschlag =
        vorschlag === undefined
            ? undefined
            : wikiVorschlagVon(vorschlag, bestand, await vorschlagVeraltet(database, vorschlag));
    const zitate = await leseVorkommenZitate(database, row.public_id);
    return {
        id: row.public_id,
        revision: row.revision,
        wikiKey: row.wiki_key,
        ...(row.wiki_url === null ? {} : { wikiUrl: row.wiki_url }),
        name: row.name,
        art: art(row.kind),
        gruppe: row.gruppe,
        lebensraum: row.lebensraum,
        synonyme: row.synonyme,
        editorNote: row.editor_note,
        ursprung: ursprungVon(row.source_system, row.legacy_origin),
        herkunft: herkunftVon(row.source_system, row.legacy_origin),
        aktiv: row.is_active,
        ...(kanon === undefined ? {} : { kanon }),
        feldUrsprung,
        orte: await leseOrte(database, row.id),
        regeln,
        ...(wikiVorschlag === undefined ? {} : { wikiVorschlag }),
        quellen: await leseQuellen(database, row.id, zitate),
        ...(zitate === undefined ? {} : { quellenWiki: zitate.stand }),
    };
}

/** Wie ein Kontinentbegriff in der Auswahl heißt. */
export const KONTINENT_NAMEN: Readonly<Record<InhalteKontinent, string>> = {
    aventurien: "Aventurien",
    myranor: "Myranor",
    uthuria: "Uthuria",
    rakshazar: "Rakshazar",
    tharun: "Tharun",
    riesland: "Riesland",
    guldenland: "Güldenland (Schreibweise ohne Umlaut)",
    gueldenland: "Güldenland",
    "ehernes-schwert-kontinent": "Ehernes Schwert (Kontinent)",
};

/** Welche Zuweisung (`wiki_key_assignment.legacy_art`) den Schlüssel eines Trägers trägt: die Art des Trägers dazu. */
export const ZUWEISUNG_ART: Readonly<Record<InhalteVorkommenTreffer["kind"], string>> = {
    place: "siedlung",
    territory: "gebiet",
    area: "landschaft",
    peak: "region",
};

/** Der Schlüssel (ohne `wiki:` und klein), den die Zuordnung einem Träger gibt; `undefined`, wo er keinen hat. Nie ein Name, nie geraten. */
export async function wikiSchluesselVon(
    database: Queryable,
    kind: InhalteVorkommenTreffer["kind"],
    publicId: string,
): Promise<string | undefined> {
    const [zeile] =
        kind === "area"
            ? // Eine Landschaft trägt den Artikel selbst oder über eine an sie gebundene Beschriftung (wie `buildWikiKeyLookup`).
              await database<{ wiki_key: string }[]>`
                  SELECT a.wiki_key FROM wiki_key_assignment a
                   WHERE a.is_active AND a.object_public_id = ${publicId}::uuid AND a.legacy_art = 'landschaft'
                  UNION ALL
                  SELECT a.wiki_key FROM wiki_key_assignment a
                    JOIN map_label l ON l.public_id = a.object_public_id
                    JOIN region r ON r.id = l.region_id
                   WHERE a.is_active AND a.legacy_art = 'region' AND r.public_id = ${publicId}::uuid
                   ORDER BY wiki_key LIMIT 1
              `
            : await database<{ wiki_key: string }[]>`
                  SELECT a.wiki_key FROM wiki_key_assignment a
                   WHERE a.is_active AND a.object_public_id = ${publicId}::uuid AND a.legacy_art = ${ZUWEISUNG_ART[kind]}
                   ORDER BY a.wiki_key LIMIT 1
              `;
    if (zeile === undefined) return undefined;
    const schluessel = bareLoreKey(zeile.wiki_key);
    return schluessel === "" ? undefined : schluessel;
}

/**
 * Ziele für eine Ortszeile: aktive Orte, Herrschaftsgebiete, Landschaften und Gipfel, deren Name den Text enthält UND denen die Zuordnung einen
 * Wiki-Schlüssel gibt, dazu die Kontinentbegriffe. Ein Objekt ohne Schlüssel ist kein Ziel: Der Schlüssel wird nie geraten.
 */
export async function sucheVorkommenZiele(
    database: Queryable,
    text: string,
    limit: number,
): Promise<InhalteVorkommenZiele> {
    const wort = text.trim();
    const muster = likeMuster(wort);
    const gefunden: InhalteVorkommenZiel[] = [];
    for (const kind of ["place", "territory", "area", "peak"] as const) {
        const tafeln = TRAEGER[kind];
        const schluessel =
            kind === "area"
                ? `COALESCE(
                       (SELECT min(a.wiki_key) FROM wiki_key_assignment a WHERE a.is_active AND a.legacy_art = 'landschaft' AND a.object_public_id = c.public_id),
                       (SELECT min(a.wiki_key) FROM wiki_key_assignment a JOIN map_label l ON l.public_id = a.object_public_id
                         WHERE a.is_active AND a.legacy_art = 'region' AND l.region_id = c.id))`
                : `(SELECT min(a.wiki_key) FROM wiki_key_assignment a WHERE a.is_active AND a.legacy_art = '${ZUWEISUNG_ART[kind]}' AND a.object_public_id = c.public_id)`;
        const zeilen = await database.unsafe<
            { carrier_id: string; name: string; subtype: string | null; wiki_key: string }[]
        >(
            `SELECT c.public_id::text AS carrier_id, c.name, c.${tafeln.subtype} AS subtype, k.wiki_key
               FROM ${tafeln.carrier} c
               CROSS JOIN LATERAL (SELECT ${schluessel} AS wiki_key) k
              WHERE c.is_active AND k.wiki_key IS NOT NULL AND c.name ILIKE $1 ESCAPE '\\'
              ORDER BY (lower(c.name) = lower($2)) DESC, (lower(c.name) LIKE lower($2) || '%') DESC, lower(c.name), c.id
              LIMIT $3`,
            [muster, wort, limit],
        );
        for (const zeile of zeilen) {
            const bare = bareLoreKey(zeile.wiki_key);
            if (bare === "") continue;
            gefunden.push({
                kind,
                carrierId: zeile.carrier_id,
                name: zeile.name,
                ...(zeile.subtype === null || zeile.subtype === "" ? {} : { subtype: zeile.subtype }),
                wikiKey: bare,
            });
        }
    }
    for (const kontinent of INHALTE_KONTINENTE) {
        const name = KONTINENT_NAMEN[kontinent];
        if (name.toLowerCase().includes(wort.toLowerCase()) || kontinent.includes(wort.toLowerCase())) {
            gefunden.push({ kontinent, name, wikiKey: kontinent });
        }
    }
    const name = (ziel: InhalteVorkommenZiel): string => ziel.name;
    gefunden.sort(
        (a, b) =>
            Number(name(b).toLowerCase() === wort.toLowerCase()) -
                Number(name(a).toLowerCase() === wort.toLowerCase()) || name(a).localeCompare(name(b), "de"),
    );
    return { items: gefunden.slice(0, limit) };
}
