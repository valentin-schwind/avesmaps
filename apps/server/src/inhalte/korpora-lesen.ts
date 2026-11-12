import {
    INHALTE_KORPUS_BESTAETIGUNG_AB,
    INHALTE_KORPUS_FORMEN,
    INHALTE_KORPUS_QUELLEN_MAX,
    SOURCE_TYPES,
    type InhalteHerkunft,
    type InhalteKorporaAnfrage,
    type InhalteKorporaListe,
    type InhalteKorpusEintrag,
    type InhalteKorpusFelder,
    type InhalteKorpusForm,
    type InhalteKorpusQuelle,
    type InhalteKorpusWirkung,
    type InhalteKorpusWirkungFeld,
    type InhalteKorpusZeile,
    type InhalteLizenzAussage,
    type SourceType,
} from "@avesmaps3d/shared";
import type { Queryable } from "../database.ts";
import { likeMuster } from "../db/like-muster.ts";
import {
    bestandVon,
    gibtVor,
    tragtAussage,
    vorgabeVon,
    weichtAb,
    wertText,
    type Bestand,
    type BestandsGruppe,
    type KorpusAngaben,
    type QuellenWerte,
    type Vorgabe,
} from "./korpora-vorgabe.ts";
import { VERWENDUNGEN_SQL, leseLizenzen } from "./quellen-lesen.ts";
import { TRAEGER, TRAEGER_REIHENFOLGE } from "./traeger.ts";

/**
 * Lesen für den Reiter „Korpora“ des Fensters „Inhalte bearbeiten“ (WI-0254, Runde 4): die Liste links, ein Korpus mit seinen Angaben, der Vorgabe und den
 * Quellen der Domain, und „Wirkung prüfen“ (nur rechnen). Nur lesend; geschrieben wird in `korpora-schreiben.ts`.
 *
 * - 🔴 **Die Identität ist die Domain** (`source_corpus.corpus_key`); die Schnittstelle trägt die Kennung `public_id` (Migration 0236). Die Zugehörigkeit einer
 *   Quelle kommt allein aus `feature_source.corpus_key` (aus ihrer Adresse), nie aus einem Namen.
 * - **Gezählt wird, was aktiv ist:** Quellen und Verwendungen; eine stillgelegte Quelle gehört dem Korpus nicht mehr zu (der Zug schreibt sie nicht).
 * - **„Wirkung prüfen“** rechnet je Feld der Vorgabe, wie viele Quellen sich ändern und wie viele davon heute eine Aussage tragen, die überschrieben wird.
 */

const ARTEN: ReadonlySet<string> = new Set(SOURCE_TYPES);
const FORMEN: ReadonlySet<string> = new Set(INHALTE_KORPUS_FORMEN);
const AUSSAGEN: readonly InhalteLizenzAussage[] = ["unrecorded", "license", "public_domain", "unfree"];

export const quellenTyp = (wert: string): SourceType => (ARTEN.has(wert) ? (wert as SourceType) : "sonstiges");
export const korpusForm = (wert: string): InhalteKorpusForm => (FORMEN.has(wert) ? (wert as InhalteKorpusForm) : "");
export const lizenzAussage = (wert: string): InhalteLizenzAussage =>
    AUSSAGEN.find((eine) => eine === wert) ?? "unrecorded";
const herkunftVon = (sourceSystem: string): InhalteHerkunft => (sourceSystem === "legacy" ? "legacy" : "editor");

/** Ein Korpus, wie die Tafel ihn trägt. */
export interface KorpusZeile {
    public_id: string;
    revision: number;
    corpus_key: string;
    label: string;
    form: string;
    source_type: string | null;
    is_official: boolean | null;
    license_statement: string;
    license_key: string | null;
    attribution: string | null;
    editor_note: string | null;
    source_system: string;
    is_active: boolean;
    updated_at: Date;
}

export const KORPUS_SPALTEN = `c.public_id::text AS public_id, c.revision::int AS revision, c.corpus_key, c.label, c.form, c.source_type,
        c.is_official, c.license_statement, c.license_key, c.attribution, c.editor_note, c.source_system, c.is_active, c.updated_at`;

/** Die Angaben eines Korpus für die Vorgabe, mit den Änderungen eines Entwurfs darübergelegt. */
export function angabenMit(zeile: KorpusZeile, felder: InhalteKorpusFelder = {}): KorpusAngaben {
    const aussage = felder.lizenzAussage ?? lizenzAussage(zeile.license_statement);
    const key = felder.lizenzKey !== undefined ? felder.lizenzKey : zeile.license_key;
    return {
        form: felder.form ?? korpusForm(zeile.form),
        sourceType: felder.sourceType !== undefined ? felder.sourceType : zeile.source_type,
        isOfficial: felder.isOfficial !== undefined ? felder.isOfficial : zeile.is_official,
        lizenzAussage: aussage,
        lizenzKey: aussage === "license" ? key : null,
        attribution:
            felder.attribution !== undefined
                ? (felder.attribution ?? "").trim() === ""
                    ? null
                    : (felder.attribution ?? "").trim()
                : zeile.attribution,
    };
}

export interface QuellenRow {
    id: string;
    public_id: string;
    title: string;
    url: string | null;
    source_type: string;
    is_official: boolean;
    license_statement: string;
    license_key: string | null;
    attribution: string | null;
    uses?: number;
}

export const werteVon = (row: QuellenRow): QuellenWerte => ({
    sourceType: row.source_type,
    isOfficial: row.is_official,
    lizenzAussage: row.license_statement,
    lizenzKey: row.license_key,
    attribution: row.attribution,
});

/** Die aktiven Quellen einer Domain (mit den Werten, die die Vorgabe berührt); `mitVerwendungen` zählt auch die Träger je Quelle. */
export async function quellenDerDomain(
    database: Queryable,
    corpusKey: string,
    optionen: { grenze?: number; mitVerwendungen?: boolean; sperren?: boolean } = {},
): Promise<QuellenRow[]> {
    const grenze = optionen.grenze === undefined ? "" : `LIMIT ${String(Math.trunc(optionen.grenze))}`;
    const verwendungen = optionen.mitVerwendungen === true ? `, (${VERWENDUNGEN_SQL})::int AS uses` : "";
    return database.unsafe<QuellenRow[]>(
        `SELECT f.id::text AS id, f.public_id::text AS public_id, f.title, f.url, f.source_type, f.is_official, f.license_statement,
                f.license_key, f.attribution${verwendungen}
           FROM feature_source f
          WHERE f.corpus_key = $1 AND f.is_active
          ORDER BY lower(f.title), f.id ${grenze}${optionen.sperren === true ? " FOR UPDATE OF f" : ""}`,
        [corpusKey],
    );
}

/** Was die aktiven Quellen der Domain gemeinsam sagen (`bestandVon`); eine neue Quelle übernimmt es, wo der Korpus selbst nichts trägt. */
export async function bestandDerDomain(
    database: Queryable,
    corpusKey: string,
    form: InhalteKorpusForm,
): Promise<Bestand> {
    const gruppen = await database<BestandsGruppe[]>`
        SELECT source_type AS "sourceType", is_official AS "isOfficial", license_statement AS "lizenzAussage", license_key AS "lizenzKey",
               attribution, count(*)::int AS n
          FROM feature_source
         WHERE corpus_key = ${corpusKey} AND is_active
         GROUP BY source_type, is_official, license_statement, license_key, attribution
    `;
    return bestandVon(form, gruppen);
}

/** Wie viele verschiedene Träger die aktiven Quellen der Domain zitieren (je Art des Trägers einzeln gezählt, gerechnet, nie gespeichert). */
export async function traegerDerDomain(database: Queryable, corpusKey: string): Promise<number> {
    let summe = 0;
    for (const art of TRAEGER_REIHENFOLGE) {
        const tafeln = TRAEGER[art];
        const [zeile] = await database.unsafe<{ n: number }[]>(
            `SELECT count(DISTINCT v.${tafeln.foreignKey})::int AS n
               FROM ${tafeln.link} v
               JOIN feature_source f ON f.id = v.source_id AND f.is_active
              WHERE f.corpus_key = $1 AND v.is_active AND v.state = 'active'`,
            [corpusKey],
        );
        summe += zeile?.n ?? 0;
    }
    return summe;
}

function zeileVon(row: {
    public_id: string;
    corpus_key: string;
    label: string;
    form: string;
    quellen: number;
    source_system: string;
}): InhalteKorpusZeile {
    return {
        id: row.public_id,
        key: row.corpus_key,
        title: row.label.trim() === "" ? row.corpus_key : row.label,
        form: korpusForm(row.form),
        quellen: row.quellen,
        herkunft: herkunftVon(row.source_system),
    };
}

/** Die Korpora für die Liste links. */
export async function listeKorpora(database: Queryable, anfrage: InhalteKorporaAnfrage): Promise<InhalteKorporaListe> {
    const bedingungen: string[] = ["c.is_active"];
    const werte: (string | number)[] = [];
    const parameter = (wert: string | number): string => {
        werte.push(wert);
        return `$${String(werte.length)}`;
    };
    if (anfrage.herkunft === "legacy") bedingungen.push("c.source_system = 'legacy'");
    else if (anfrage.herkunft === "editor") bedingungen.push("c.source_system <> 'legacy'");
    if (anfrage.form === "belegstelle") bedingungen.push("c.form = 'belegstelle'");
    else if (anfrage.form === "werk") bedingungen.push("c.form = 'werk'");
    else if (anfrage.form === "unentschieden") bedingungen.push("c.form = ''");
    const suche = anfrage.q?.trim() ?? "";
    if (suche !== "") {
        const muster = parameter(likeMuster(suche));
        bedingungen.push(`(c.corpus_key ILIKE ${muster} ESCAPE '\\' OR c.label ILIKE ${muster} ESCAPE '\\')`);
    }
    const titel = "lower(coalesce(nullif(c.label, ''), c.corpus_key))";
    const sortierung = anfrage.sort === "title_desc" ? `${titel} DESC, c.corpus_key DESC` : `${titel}, c.corpus_key`;
    const limit = parameter(anfrage.limit ?? 50);
    const offset = parameter(anfrage.offset ?? 0);
    const treffer = bedingungen.join(" AND ");
    const zeilen = await database.unsafe<
        { public_id: string; corpus_key: string; label: string; form: string; source_system: string; quellen: number }[]
    >(
        `SELECT c.public_id::text AS public_id, c.corpus_key, c.label, c.form, c.source_system,
                (SELECT count(*) FROM feature_source f WHERE f.corpus_key = c.corpus_key AND f.is_active)::int AS quellen
           FROM source_corpus c
          WHERE ${treffer}
          ORDER BY ${sortierung}
          LIMIT ${limit} OFFSET ${offset}`,
        werte,
    );
    const [summe] = await database.unsafe<{ total: number }[]>(
        `SELECT count(*)::int AS total FROM source_corpus c WHERE ${treffer}`,
        werte.slice(0, werte.length - 2),
    );
    const [zahlen] = await database<{ aktiv: number; editor: number }[]>`
        SELECT count(*) FILTER (WHERE is_active)::int AS aktiv,
               count(*) FILTER (WHERE is_active AND source_system <> 'legacy')::int AS editor
          FROM source_corpus
    `;
    return {
        total: summe?.total ?? 0,
        items: zeilen.map(zeileVon),
        zahlen: { aktiv: zahlen?.aktiv ?? 0, editor: zahlen?.editor ?? 0 },
    };
}

/** Die interne Zeile eines Korpus; `undefined`, wo es ihn nicht gibt. */
export async function korpusZeile(database: Queryable, publicId: string): Promise<KorpusZeile | undefined> {
    const [row] = await database.unsafe<KorpusZeile[]>(
        `SELECT ${KORPUS_SPALTEN} FROM source_corpus c WHERE c.public_id = $1::uuid`,
        [publicId],
    );
    return row;
}

/** Ein Korpus mit allem, was die Mitte und die rechte Spalte zeigen; `undefined`, wo es ihn nicht gibt. */
export async function leseKorpus(database: Queryable, publicId: string): Promise<InhalteKorpusEintrag | undefined> {
    const row = await korpusZeile(database, publicId);
    if (row === undefined) return undefined;
    const angaben = angabenMit(row);
    const vorgabe = vorgabeVon(angaben);
    const alle = await quellenDerDomain(database, row.corpus_key, { mitVerwendungen: true });
    const quellen = alle.slice(0, INHALTE_KORPUS_QUELLEN_MAX).map((quelle): InhalteKorpusQuelle => ({
        id: quelle.public_id,
        title: quelle.title,
        url: quelle.url,
        sourceType: quellenTyp(quelle.source_type),
        isOfficial: quelle.is_official,
        uses: quelle.uses ?? 0,
        abweichend: weichtAb(vorgabe, werteVon(quelle)),
    }));
    const abweichendGesamt = alle.filter((quelle) => weichtAb(vorgabe, werteVon(quelle)).length > 0).length;
    return {
        id: row.public_id,
        revision: row.revision,
        key: row.corpus_key,
        label: row.label,
        form: korpusForm(row.form),
        sourceType: row.source_type === null ? null : quellenTyp(row.source_type),
        isOfficial: row.is_official,
        lizenzAussage: lizenzAussage(row.license_statement),
        lizenzKey: row.license_key,
        attribution: row.attribution,
        editorNote: row.editor_note,
        herkunft: herkunftVon(row.source_system),
        schreibtDurch: angaben.form === "belegstelle",
        quellen,
        quellenGesamt: alle.length,
        traegerGesamt: await traegerDerDomain(database, row.corpus_key),
        abweichendGesamt,
        lizenzen: await leseLizenzen(database),
    };
}

/**
 * „Wirkung prüfen“: was eine Änderung (`felder`, gegen den gespeicherten Stand) bei den Quellen der Domain täte, ohne etwas zu schreiben. Bei einer Form, die nicht
 * durchschreibt, bleibt `felder` leer.
 */
export function wirkungVon(
    zeile: KorpusZeile,
    felder: InhalteKorpusFelder,
    quellen: readonly QuellenRow[],
    traegerGesamt: number,
): InhalteKorpusWirkung {
    const nachher = angabenMit(zeile, felder);
    const vorgabe: Vorgabe = vorgabeVon(nachher);
    const betroffen = new Set<string>();
    const wirkungen: InhalteKorpusWirkungFeld[] = [];
    for (const feld of gibtVor(vorgabe)) {
        let aendern = 0;
        let ueberschreibt = 0;
        for (const quelle of quellen) {
            const werte = werteVon(quelle);
            if (!weichtAb(vorgabe, werte).includes(feld)) continue;
            aendern += 1;
            betroffen.add(quelle.id);
            if (tragtAussage(feld, werte)) ueberschreibt += 1;
        }
        wirkungen.push({ feld, wert: wertText(feld, vorgabe), aendern, ueberschreibt });
    }
    const aendernGesamt = betroffen.size;
    return {
        form: nachher.form,
        schreibtDurch: nachher.form === "belegstelle",
        quellenGesamt: quellen.length,
        traegerGesamt,
        aendernGesamt,
        felder: wirkungen,
        bestaetigungAb: INHALTE_KORPUS_BESTAETIGUNG_AB,
        bestaetigungNoetig: aendernGesamt >= INHALTE_KORPUS_BESTAETIGUNG_AB,
    };
}
