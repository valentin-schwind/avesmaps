import {
    INHALTE_TRAEGER,
    SOURCE_REFERENCE_KINDS,
    SOURCE_TYPES,
    type InhalteLizenz,
    type InhalteQuelle,
    type InhalteQuellenAnfrage,
    type InhalteQuellenListe,
    type InhalteQuellenZeile,
    type InhalteTraegerArt,
    type InhalteVerwendung,
    type InhalteZiel,
    type InhalteZiele,
    type SourceReferenceKind,
    type SourceType,
} from "@avesmaps3d/shared";
import type { Queryable } from "../database.ts";
import { likeMuster } from "../db/like-muster.ts";
import { corpusKeyOfUrl } from "../migration/subject-details.ts";
import { gibtVor, vorgabeVon } from "./korpora-vorgabe.ts";
import { umschlaegeVon } from "./quellen-umschlag.ts";
import { STRASSEN_SCHLUESSEL_SQL, leseWegGruppen, sucheStrassen } from "./quellen-wege.ts";
import { TRAEGER, TRAEGER_REIHENFOLGE, leseKanonJeTraeger } from "./traeger.ts";

/**
 * Lesen für den Reiter „Quellen“ des Fensters „Inhalte bearbeiten“ (WI-0254): die Liste links, eine Quelle mit ihren Verwendungen
 * (Mitte und rechts) und die Suche nach Trägern zum Anhängen. Nur lesend; geschrieben wird in `quellen-schreiben.ts`.
 *
 * - **Die Liste** ist seitenweise (3.906 Quellen im Bestand), die Zahl der Verwendungen zählt nur aktive Verknüpfungen. „Stillgelegt“
 *   sind allein die von der Redaktion unterdrückten Quellen (`retired_origin = editor`); was der Import stilllegte, ist Geschichte.
 * - **Die Verwendungen** einer Quelle stehen mit dem Etikett des Trägers (Rang 1 bis 4 der Kanon-Regel, `traeger.ts`), nie mit einem
 *   Namen als Schlüssel: `kind` + `carrierId` ist die Identität. Ein Weg ist immer die ganze Straße (`quellen-wege.ts`): Legacy führt die Quelle je
 *   Abschnitt, hier steht eine Zeile je Straße, änderbar wie jede andere. Eine Antwort trägt höchstens `VERWENDUNGEN_MAX` Zeilen; `verwendungenGesamt` nennt die ganze Zahl.
 */

const TYPEN: ReadonlySet<string> = new Set(SOURCE_TYPES);
const ARTEN: ReadonlySet<string> = new Set(SOURCE_REFERENCE_KINDS);

/** So viele Verwendungen trägt eine Antwort höchstens (die Quelle „Wiki Aventurica“ hat Tausende). */
export const VERWENDUNGEN_MAX = 300;

export const quellenTyp = (wert: string): SourceType => (TYPEN.has(wert) ? (wert as SourceType) : "sonstiges");
export const bezugsArt = (wert: string | null): SourceReferenceKind | null =>
    wert !== null && ARTEN.has(wert) ? (wert as SourceReferenceKind) : null;

/**
 * Die Summe der aktiven Verwendungen als SQL-Ausdruck über den Alias `f`. Ein Weg zählt als Straße, nicht je Abschnitt (die Abschnitte sind ein technisches Detail, `quellen-wege.ts`):
 * dieselbe Zählung wie die Spalte der Verwendungen (Abschnitte auf der Karte, ohne Seewege, je Schlüssel der Straße einmal).
 */
export const VERWENDUNGEN_SQL = TRAEGER_REIHENFOLGE.map((art) =>
    art === "path"
        ? `(SELECT count(DISTINCT ${STRASSEN_SCHLUESSEL_SQL("p")}) FROM path_source v JOIN path p ON p.id = v.path_id
             WHERE v.source_id = f.id AND v.is_active AND v.state = 'active' AND p.is_active AND p.subtype <> 'Seeweg')`
        : `(SELECT count(*) FROM ${TRAEGER[art].link} v WHERE v.source_id = f.id AND v.is_active AND v.state = 'active')`,
).join(" + ");

interface ZeilenRow {
    public_id: string;
    title: string;
    source_type: string;
    url: string | null;
    corpus_key: string | null;
    uses: number;
    source_system: string;
    is_active: boolean;
    retired_origin: string | null;
}

const herkunftVon = (sourceSystem: string): "legacy" | "editor" => (sourceSystem === "legacy" ? "legacy" : "editor");

function zeileVon(row: ZeilenRow): InhalteQuellenZeile {
    return {
        id: row.public_id,
        title: row.title,
        sourceType: quellenTyp(row.source_type),
        ...(row.url === null ? {} : { url: row.url }),
        ...(row.corpus_key === null ? {} : { corpusKey: row.corpus_key }),
        uses: row.uses,
        herkunft: herkunftVon(row.source_system),
        stillgelegt: !row.is_active,
    };
}

/** Die Quellen für die Liste links. */
export async function listeQuellen(database: Queryable, anfrage: InhalteQuellenAnfrage): Promise<InhalteQuellenListe> {
    const stand = anfrage.stand ?? "aktiv";
    const bedingungen: string[] = [];
    const werte: (string | number)[] = [];
    const parameter = (wert: string | number): string => {
        werte.push(wert);
        return `$${String(werte.length)}`;
    };
    if (stand === "aktiv") bedingungen.push("f.is_active");
    else if (stand === "stillgelegt") bedingungen.push("NOT f.is_active AND f.retired_origin = 'editor'");
    else bedingungen.push("(f.is_active OR f.retired_origin = 'editor')");
    if (anfrage.herkunft === "legacy") bedingungen.push("f.source_system = 'legacy'");
    else if (anfrage.herkunft === "editor") bedingungen.push("f.source_system <> 'legacy'");
    const suche = anfrage.q?.trim() ?? "";
    if (suche !== "") {
        const muster = parameter(likeMuster(suche));
        bedingungen.push(
            `(f.title ILIKE ${muster} ESCAPE '\\' OR f.url ILIKE ${muster} ESCAPE '\\' OR f.corpus_key ILIKE ${muster} ESCAPE '\\'
              OR (f.source_key LIKE 'wikipub:%' AND f.source_key ILIKE ${muster} ESCAPE '\\'))`,
        );
    }
    const sortierung =
        anfrage.sort === "uses"
            ? "uses DESC, lower(f.title), f.id"
            : anfrage.sort === "title_desc"
              ? "lower(f.title) DESC, f.id"
              : "lower(f.title), f.id";
    const limit = parameter(anfrage.limit ?? 50);
    const offset = parameter(anfrage.offset ?? 0);
    const treffer = bedingungen.join(" AND ");
    const zeilen = await database.unsafe<ZeilenRow[]>(
        `SELECT f.public_id::text AS public_id, f.title, f.source_type, f.url, f.corpus_key, f.source_system, f.is_active, f.retired_origin,
                (${VERWENDUNGEN_SQL})::int AS uses
           FROM feature_source f
          WHERE ${treffer}
          ORDER BY ${sortierung}
          LIMIT ${limit} OFFSET ${offset}`,
        werte,
    );
    const [summe] = await database.unsafe<{ total: number }[]>(
        `SELECT count(*)::int AS total FROM feature_source f WHERE ${treffer}`,
        werte.slice(0, werte.length - 2),
    );
    const [zahlen] = await database<{ aktiv: number; editor: number; stillgelegt: number }[]>`
        SELECT count(*) FILTER (WHERE is_active)::int AS aktiv,
               count(*) FILTER (WHERE is_active AND source_system <> 'legacy')::int AS editor,
               count(*) FILTER (WHERE NOT is_active AND retired_origin = 'editor')::int AS stillgelegt
          FROM feature_source
    `;
    // WI-0287: Die Suche der Publikationen einer Karte zeigt das Umschlagbild je Treffer (`quellen-umschlag.ts`, nie über den Namen).
    const umschlaege =
        anfrage.umschlag === true
            ? await umschlaegeVon(
                  database,
                  zeilen.map((zeile) => zeile.public_id),
              )
            : undefined;
    return {
        total: summe?.total ?? 0,
        items: zeilen.map((zeile) =>
            umschlaege === undefined
                ? zeileVon(zeile)
                : { ...zeileVon(zeile), umschlag: umschlaege.get(zeile.public_id) ?? null },
        ),
        zahlen: { aktiv: zahlen?.aktiv ?? 0, editor: zahlen?.editor ?? 0, stillgelegt: zahlen?.stillgelegt ?? 0 },
    };
}

interface QuelleRow {
    id: string;
    public_id: string;
    revision: number;
    source_key: string;
    title: string;
    url: string | null;
    source_type: string;
    is_official: boolean;
    license_statement: string;
    license_key: string | null;
    attribution: string | null;
    editor_note: string | null;
    corpus_key: string | null;
    corpus_public_id: string | null;
    corpus_label: string | null;
    corpus_form: string | null;
    corpus_source_type: string | null;
    corpus_is_official: boolean | null;
    corpus_license_statement: string | null;
    corpus_license_key: string | null;
    corpus_attribution: string | null;
    source_system: string;
    is_active: boolean;
}

interface VerwendungRow {
    carrier_id: string;
    name: string;
    subtype: string | null;
    reference_kind: string | null;
    pages: string | null;
    note: string | null;
    state: string;
    source_system: string;
    carrier_active: boolean;
    position: number;
}

/** Die Verwendungen einer Quelle in einer Art von Träger. */
async function lieVerwendungen(
    database: Queryable,
    quelleId: string,
    art: Exclude<InhalteTraegerArt, "path">,
    grenze: number,
): Promise<{ eintraege: InhalteVerwendung[]; gesamt: number }> {
    const tafeln = TRAEGER[art];
    const zeilen = await database.unsafe<VerwendungRow[]>(
        `SELECT c.public_id::text AS carrier_id, c.name, c.${tafeln.subtype} AS subtype, v.reference_kind, v.pages, v.note, v.state,
                v.source_system, c.is_active AS carrier_active, v.position
           FROM ${tafeln.link} v
           JOIN ${tafeln.carrier} c ON c.id = v.${tafeln.foreignKey}
          WHERE v.source_id = $1::bigint
          ORDER BY (v.state = 'active') DESC, lower(c.name), c.id
          LIMIT $2`,
        [quelleId, grenze],
    );
    const [aktiv] = await database.unsafe<{ gesamt: number }[]>(
        `SELECT count(*)::int AS gesamt FROM ${tafeln.link} v WHERE v.source_id = $1::bigint AND v.is_active AND v.state = 'active'`,
        [quelleId],
    );
    const etiketten = await leseKanonJeTraeger(
        database,
        art,
        zeilen.map((zeile) => zeile.carrier_id),
    );
    const eintraege = zeilen.map((zeile): InhalteVerwendung => {
        const canon = etiketten.get(zeile.carrier_id);
        const state = zeile.state === "retired" || zeile.state === "suppressed" ? zeile.state : "active";
        return {
            kind: art,
            carrierId: zeile.carrier_id,
            name: zeile.name,
            ...(zeile.subtype === null || zeile.subtype === "" ? {} : { subtype: zeile.subtype }),
            referenceKind: bezugsArt(zeile.reference_kind),
            pages: zeile.pages,
            note: zeile.note,
            state,
            herkunft: herkunftVon(zeile.source_system),
            traegerAktiv: zeile.carrier_active,
            ...(canon === undefined ? {} : { canon }),
            aenderbar: true,
        };
    });
    return { eintraege, gesamt: aktiv?.gesamt ?? 0 };
}

/** Die Wege einer Quelle: je Straße eine Verwendung (Anker als Kennung, die zusammengefasste Sicht der Abschnitte), nie ein Abschnitt. */
async function lieWege(
    database: Queryable,
    quelleId: string,
    grenze: number,
): Promise<{ eintraege: InhalteVerwendung[]; gesamt: number }> {
    const { gruppen, gesamt } = await leseWegGruppen(database, quelleId, grenze);
    const etiketten = await leseKanonJeTraeger(
        database,
        "path",
        gruppen.map((gruppe) => gruppe.anker),
    );
    const eintraege = gruppen.map((gruppe): InhalteVerwendung => {
        const canon = etiketten.get(gruppe.anker);
        return {
            kind: "path",
            carrierId: gruppe.anker,
            name: gruppe.name,
            ...(gruppe.subtype === undefined || gruppe.subtype === "" ? {} : { subtype: gruppe.subtype }),
            referenceKind: bezugsArt(gruppe.referenceKind),
            pages: gruppe.pages,
            note: gruppe.note,
            state: gruppe.state,
            herkunft: gruppe.editor ? "editor" : "legacy",
            traegerAktiv: true,
            ...(canon === undefined ? {} : { canon }),
            aenderbar: true,
        };
    });
    return { eintraege, gesamt };
}

/** Die Lizenzen des gemeinsamen Katalogs (`license_catalog`, 0064) für die Auswahl. */
export async function leseLizenzen(database: Queryable): Promise<InhalteLizenz[]> {
    const zeilen = await database<{ key: string; display_name: string }[]>`
        SELECT key, display_name FROM license_catalog ORDER BY display_name
    `;
    return zeilen.map((zeile) => ({ key: zeile.key, name: zeile.display_name }));
}

/** Die Kennung der Quelle als interne Nummer; `undefined`, wo es sie nicht gibt. */
export async function quelleIntern(database: Queryable, publicId: string): Promise<string | undefined> {
    const [zeile] = await database<
        { id: string }[]
    >`SELECT id::text FROM feature_source WHERE public_id = ${publicId}::uuid`;
    return zeile?.id;
}

/** Eine Quelle mit allem, was die Mitte und die rechte Spalte zeigen; `undefined`, wo es sie nicht gibt. */
export async function leseQuelle(database: Queryable, publicId: string): Promise<InhalteQuelle | undefined> {
    const [row] = await database<QuelleRow[]>`
        SELECT f.id::text AS id, f.public_id::text AS public_id, f.revision::int AS revision, f.source_key, f.title, f.url, f.source_type,
               f.is_official, f.license_statement, f.license_key, f.attribution, f.editor_note, f.corpus_key, c.public_id::text AS corpus_public_id, c.label AS corpus_label,
               c.form AS corpus_form, c.source_type AS corpus_source_type, c.is_official AS corpus_is_official,
               c.license_statement AS corpus_license_statement, c.license_key AS corpus_license_key, c.attribution AS corpus_attribution,
               f.source_system, f.is_active
          FROM feature_source f
          LEFT JOIN source_corpus c ON c.corpus_key = f.corpus_key
         WHERE f.public_id = ${publicId}::uuid
    `;
    if (row === undefined) return undefined;
    const alle: InhalteVerwendung[] = [];
    let gesamt = 0;
    for (const art of TRAEGER_REIHENFOLGE) {
        const teil =
            art === "path"
                ? await lieWege(database, row.id, VERWENDUNGEN_MAX)
                : await lieVerwendungen(database, row.id, art, VERWENDUNGEN_MAX);
        alle.push(...teil.eintraege);
        gesamt += teil.gesamt;
    }
    // Erst die aktiven, dann die stillen; innerhalb davon nach Art in fester Folge (Ort, Gebiet, Landschaft, Gipfel, Weg).
    const folge = new Map(TRAEGER_REIHENFOLGE.map((art, index) => [art, index]));
    const verwendungen = alle
        .sort(
            (a, b) =>
                Number(b.state === "active") - Number(a.state === "active") ||
                (folge.get(a.kind) ?? 0) - (folge.get(b.kind) ?? 0),
        )
        .slice(0, VERWENDUNGEN_MAX);
    const schluessel = row.source_key;
    const identitaet = schluessel.startsWith("url:")
        ? "url"
        : schluessel.startsWith("wikipub:")
          ? "wikipub"
          : "legacy-id";
    const domain = row.url === null ? "" : corpusKeyOfUrl(row.url);
    const statement = (["unrecorded", "license", "public_domain", "unfree"] as const).find(
        (eine) => eine === row.license_statement,
    );
    const lizenzen = await leseLizenzen(database);
    const korpusForm = row.corpus_form === "werk" || row.corpus_form === "belegstelle" ? row.corpus_form : "";
    const gibtVorFelder =
        row.corpus_key === null
            ? []
            : gibtVor(
                  vorgabeVon({
                      form: korpusForm,
                      sourceType: row.corpus_source_type,
                      isOfficial: row.corpus_is_official,
                      lizenzAussage: row.corpus_license_statement ?? "unrecorded",
                      lizenzKey: row.corpus_license_key,
                      attribution: row.corpus_attribution,
                  }),
              );
    return {
        id: row.public_id,
        revision: row.revision,
        identitaet,
        ...(identitaet === "wikipub" ? { wikiKey: schluessel.slice("wikipub:".length) } : {}),
        title: row.title,
        url: row.url,
        sourceType: quellenTyp(row.source_type),
        isOfficial: row.is_official,
        lizenzAussage: statement ?? "unrecorded",
        lizenzKey: row.license_key,
        attribution: row.attribution,
        editorNote: row.editor_note,
        ...(row.corpus_key === null || row.corpus_public_id === null
            ? {}
            : {
                  korpus: {
                      id: row.corpus_public_id,
                      key: row.corpus_key,
                      label: row.corpus_label ?? "",
                      form: korpusForm,
                      // Bei einer Belegstelle mit Vorgabe gehören diese Felder dem Korpus (Vali: überall): An der Quelle sind sie gesperrt.
                      ...(gibtVorFelder.length === 0 ? {} : { gibtVor: gibtVorFelder }),
                  },
              }),
        ...(domain === "" ? {} : { domain }),
        herkunft: herkunftVon(row.source_system),
        aktiv: row.is_active,
        verwendungen,
        verwendungenGesamt: gesamt,
        lizenzen,
    };
}

/** Träger zum Anhängen: aktive Orte, Herrschaftsgebiete, Landschaften und Gipfel, deren Name den Text enthält; auf Wunsch (`mitWegen`, der Reiter „Quellen“) auch Wege, je Straße ein Treffer mit ihrem Anker. Nur echte Kennungen. */
export async function sucheZiele(
    database: Queryable,
    text: string,
    limit: number,
    mitWegen = false,
): Promise<InhalteZiele> {
    const muster = likeMuster(text.trim());
    const gefunden: InhalteZiel[] = [];
    for (const kind of INHALTE_TRAEGER) {
        const tafeln = TRAEGER[kind];
        const zeilen = await database.unsafe<{ carrier_id: string; name: string; subtype: string | null }[]>(
            `SELECT c.public_id::text AS carrier_id, c.name, c.${tafeln.subtype} AS subtype
               FROM ${tafeln.carrier} c
              WHERE c.is_active AND c.name ILIKE $1 ESCAPE '\\'
              ORDER BY (lower(c.name) = lower($2)) DESC, (lower(c.name) LIKE lower($2) || '%') DESC, lower(c.name), c.id
              LIMIT $3`,
            [muster, text.trim(), limit],
        );
        const etiketten = await leseKanonJeTraeger(
            database,
            kind,
            zeilen.map((zeile) => zeile.carrier_id),
        );
        for (const zeile of zeilen) {
            const canon = etiketten.get(zeile.carrier_id);
            gefunden.push({
                kind,
                carrierId: zeile.carrier_id,
                name: zeile.name,
                ...(zeile.subtype === null || zeile.subtype === "" ? {} : { subtype: zeile.subtype }),
                ...(canon === undefined ? {} : { canon }),
            });
        }
    }
    if (mitWegen) {
        // Ein Weg ist die ganze Straße: ein Treffer je Name, mit dem Anker, nie je Abschnitt.
        const strassen = await sucheStrassen(database, text, limit);
        const etiketten = await leseKanonJeTraeger(
            database,
            "path",
            strassen.map((strasse) => strasse.anker),
        );
        for (const strasse of strassen) {
            const canon = etiketten.get(strasse.anker);
            gefunden.push({
                kind: "path",
                carrierId: strasse.anker,
                name: strasse.name,
                ...(strasse.subtype === undefined ? {} : { subtype: strasse.subtype }),
                ...(canon === undefined ? {} : { canon }),
            });
        }
    }
    gefunden.sort(
        (a, b) =>
            Number(b.name.toLowerCase() === text.trim().toLowerCase()) -
                Number(a.name.toLowerCase() === text.trim().toLowerCase()) || a.name.localeCompare(b.name, "de"),
    );
    return { items: gefunden.slice(0, limit) };
}
