import { createHash } from "node:crypto";
import {
    UUID_PATTERN,
    WIKISYNC_LAGE_RICHTUNGEN,
    type InhalteVorkommenBedingung,
    type InhalteVorkommenBeziehung,
    type InhalteVorkommenFlaechen,
    type InhalteVorkommenLageOrte,
    type InhalteVorkommenRegel,
    type InhalteVorkommenUmriss,
    type InhalteVorkommenWikiVorschlag,
    type WikisyncLageRichtung,
    type WikisyncRegelBedingung,
    type WikisyncRegelLage,
    type WikisyncRegelOriginal,
    type WikisyncRegelTyp,
} from "@avesmaps3d/shared";
import type { Queryable } from "../database.ts";
import { likeMuster } from "../db/like-muster.ts";
import { bedingungAus } from "../wiki/regeln/anzeige.ts";
import { flaechenSeitLaufGeaendert } from "../wiki/regeln/flaechen.ts";
import { titelAusWikiAdresse } from "../wiki/vorschau/adresse.ts";

/**
 * Das Lesen für den Regeleditor im Reiter „Vorkommen“ (WI-0254 `--weiter`, Paket R, Bezug WI-0253 §26): die Bedingungsketten der Regeln, der Vorschlag des WikiSync am Eintrag, die
 * Wiki-Fassung hinter einer Regel von Hand, die Suche nach Flächen für eine Bedingung und die Hilfen der Lage zu einer Linie (Suche nach Orten, Umriss Aventuriens für die Skizze). Nur lesend; geschrieben wird
 * in `vorkommen-regeln-schreiben.ts`.
 *
 * - **Der Vorschlag** ist das Protokoll des jüngsten fertigen Laufs mit Regelvorschlägen (`wikisync_regel_vorschlag`, Migration 0248), die Zeile zu diesem Eintrag. Gerechnet wird hier nichts, und
 *   Bedingungen gehen nur durch `bedingungAus` hinaus: Das Protokoll trägt mehr Felder als das Schema, und Fastifys strenger Serialisierer verwürfe die Antwort mit 500 (Stage 2026-10-27). Fehlt die Tafel
 *   (vor 0248) oder der Lauf, gibt es keinen Vorschlag; gefragt wird mit `to_regclass`, nie über ein abgefangenes 42P01 (eine Transaktion bräche daran ab).
 * - **`aktuell` je Beziehung:** Der Vorschlag gilt noch, wenn die Regeln der Beziehung noch so dastehen, wie die Ableitung sie sah (`bisherSchluessel`), und die Redaktion den vorgeschlagenen
 *   Schlüssel nicht selbst stillgelegt hat. Eine Beziehung mit Status `manuell` gilt, solange die Regeln von Hand noch dieselben sind (der Vorschlag steht dann nur als Hinweis „Das Wiki sagt …“).
 * - **`wikiBasis` und `wikiJetzt`** gibt es nur an einer Regel von Hand, die aus einer Wiki-Regel oder einem Vorschlag entstand (`lore_rule.wiki_basis_key`, Migration 0249). `wikiBasis` ist die Fassung,
 *   von der sie ausging (mit Bedingungen, wo die Zeile oder der Vorschlag sie noch kennt), `wikiJetzt` die, die das Wiki seitdem für Eintrag und Beziehung ergibt (die Beziehung mit Status `manuell`).
 * - **Die Lage zu einer Linie** (WI-0254, Migration 0250): `ladeKetten` liest die drei Spalten `line_direction`, `line_place_a_id`, `line_place_b_id` und die Orte dazu (Kennung, Name, Stelle; auch ein still gelegter
 *   Ort bleibt sichtbar, die Regel sagt, was sie sagte). `sucheVorkommenOrte` ist die Suche der Combobox (nur aktive Siedlungen), `leseUmriss` der Umriss Aventuriens für die Skizze, im Prozess zwischengespeichert.
 */

const UUID = new RegExp(UUID_PATTERN, "u");

/** Ein Wiki-Titel in der Schreibweise, in der die Ableitung ihn vergleicht (getrimmt, klein, Leerzeichen statt Unterstrich). */
export const titelNorm = (titel: string): string => titel.replaceAll("_", " ").trim().toLowerCase();
const gleichMenge = (a: readonly string[], b: readonly string[]): boolean =>
    a.length === b.length && [...a].sort().every((wert, index) => wert === [...b].sort()[index]);

// ---------------------------------------------------------------------------------------------------------------------
// Die Bedingungsketten
// ---------------------------------------------------------------------------------------------------------------------

interface BedingungRow {
    rule_id: string;
    id: string;
    seq: number;
    join_op: string;
    wiki_area_title: string | null;
    area_region_id: string | null;
    legacy_area_public_id: string | null;
    climate_from: string | null;
    climate_to: string | null;
    legacy_climate_from: string | null;
    legacy_climate_to: string | null;
    line_direction: string | null;
    line_place_a_id: string | null;
    line_place_b_id: string | null;
}

const RICHTUNGEN: readonly string[] = WIKISYNC_LAGE_RICHTUNGEN;

interface OrtZeile {
    kennung: string;
    name: string;
    x: number;
    y: number;
}

/**
 * Die Lage einer Zeile der Bedingung, oder `undefined` ohne Lage: Richtung und die ein oder zwei Orte in der Reihenfolge, in der sie gespeichert sind (A, B). Eine Richtung außerhalb der vier oder ein Ort ohne Zeile
 * (der Fremdschlüssel verhindert es) ergibt keine Lage, statt die Antwort zu verwerfen.
 */
function lageAus(
    zeile: Pick<BedingungRow, "line_direction" | "line_place_a_id" | "line_place_b_id">,
    orteNachId: ReadonlyMap<string, OrtZeile>,
): WikisyncRegelLage | undefined {
    if (zeile.line_direction === null || zeile.line_place_a_id === null || !RICHTUNGEN.includes(zeile.line_direction))
        return undefined;
    const orte: OrtZeile[] = [];
    for (const id of [zeile.line_place_a_id, zeile.line_place_b_id]) {
        if (id === null) continue;
        const ort = orteNachId.get(id);
        if (ort === undefined) return undefined;
        orte.push(ort);
    }
    return {
        richtung: zeile.line_direction as WikisyncLageRichtung,
        orte: orte.map((ort) => ({ kennung: ort.kennung, name: ort.name, x: ort.x, y: ort.y })),
    };
}

/** Die Ketten der Regeln (nach `lore_rule.id`), in der Auswertungsreihenfolge, wie das Lesemodell sie führt (`InhalteVorkommenBedingung`). */
export async function ladeKetten(
    database: Queryable,
    regelIds: readonly string[],
): Promise<Map<string, InhalteVorkommenBedingung[]>> {
    const ketten = new Map<string, InhalteVorkommenBedingung[]>();
    if (regelIds.length === 0) return ketten;
    const bedingungen = await database<BedingungRow[]>`
        SELECT t.lore_rule_id::text AS rule_id, t.id::text AS id, t.seq::int AS seq, t.join_op, t.wiki_area_title, t.area_region_id::text AS area_region_id,
               t.legacy_area_public_id, t.climate_from, t.climate_to, t.legacy_climate_from, t.legacy_climate_to,
               t.line_direction, t.line_place_a_id::text AS line_place_a_id, t.line_place_b_id::text AS line_place_b_id
          FROM lore_rule_term t WHERE t.lore_rule_id = ANY(${[...regelIds]}::bigint[])
         ORDER BY t.lore_rule_id, t.seq
    `;
    const termIds = bedingungen.map((b) => b.id);
    const arten =
        termIds.length === 0
            ? []
            : await database<{ term: string; layer: string; type: string }[]>`
                  SELECT y.lore_rule_term_id::text AS term, y.region_layer AS layer, y.region_type AS type
                    FROM lore_rule_term_type y WHERE y.lore_rule_term_id = ANY(${termIds}::bigint[])
                   ORDER BY y.lore_rule_term_id, y.region_layer, y.region_type
              `;
    const flaechenIds = [
        ...new Set(bedingungen.map((b) => b.area_region_id).filter((id): id is string => id !== null)),
    ];
    const flaechen =
        flaechenIds.length === 0
            ? []
            : await database<{ id: string; public_id: string; name: string | null }[]>`
                  SELECT id::text, public_id::text, name FROM region WHERE id = ANY(${flaechenIds}::bigint[])
              `;
    const flaechenNachId = new Map(flaechen.map((f) => [f.id, f]));
    const ortIds = [
        ...new Set(
            bedingungen.flatMap((b) =>
                [b.line_place_a_id, b.line_place_b_id].filter((id): id is string => id !== null),
            ),
        ),
    ];
    const orte =
        ortIds.length === 0
            ? []
            : await database<(OrtZeile & { id: string })[]>`
                  SELECT p.id::text AS id, p.public_id::text AS kennung, p.name,
                         round(ST_X(p.geom)::numeric, 2)::float8 AS x, round(ST_Y(p.geom)::numeric, 2)::float8 AS y
                    FROM place p WHERE p.id = ANY(${ortIds}::bigint[])
              `;
    const orteNachId = new Map(orte.map((o) => [o.id, o]));
    for (const b of bedingungen) {
        const flaeche = b.area_region_id === null ? undefined : flaechenNachId.get(b.area_region_id);
        const von = b.climate_from ?? b.legacy_climate_from;
        const bis = b.climate_to ?? b.legacy_climate_to;
        const lage = lageAus(b, orteNachId);
        const eine: InhalteVorkommenBedingung = {
            joinOp: b.join_op === "oder" ? "oder" : b.join_op === "ohne" ? "ohne" : "und",
            ...(flaeche !== undefined
                ? {
                      flaeche: {
                          kennung: flaeche.public_id,
                          ...(flaeche.name === null ? {} : { name: flaeche.name }),
                      },
                  }
                : b.legacy_area_public_id === null
                  ? {}
                  : { flaeche: { kennung: b.legacy_area_public_id } }),
            ...(flaeche === undefined && b.legacy_area_public_id === null && b.wiki_area_title !== null
                ? { wartetAuf: b.wiki_area_title }
                : {}),
            arten: arten.filter((a) => a.term === b.id).map((a) => ({ ebene: a.layer, art: a.type })),
            ...(von === null || bis === null ? {} : { klima: { von, bis } }),
            ...(lage === undefined ? {} : { lage }),
        };
        ketten.set(b.rule_id, [...(ketten.get(b.rule_id) ?? []), eine]);
    }
    return ketten;
}

/**
 * Eine Bedingung des Lesemodells in der Form des Wiki-Vorschlags (`WikisyncRegelBedingung`), wie das Fenster der Regelvorschläge sie führt: eine Fläche der Karte mit ihrer Kennung, eine
 * Kennung aus Legacy ohne Namen, eine wartende Fläche (`offen`, mit dem Titel des Artikels). Die Wörter und Rückfragen der Ableitung kennt die Zeile nicht.
 */
export function alsWikiBedingung(b: InhalteVorkommenBedingung): WikisyncRegelBedingung {
    const fehlt = { kennung: null, offen: false, titel: null, kandidat: null } as const;
    return {
        verknuepfung: b.joinOp,
        flaeche:
            b.flaeche !== undefined
                ? UUID.test(b.flaeche.kennung)
                    ? { ...fehlt, name: b.flaeche.name ?? b.flaeche.kennung, kennung: b.flaeche.kennung }
                    : // Keine Kennung im Muster der Schnittstelle (ein Rest aus Legacy): nur der Text, sonst verwürfe die Antwort ihr Schema.
                      { ...fehlt, name: b.flaeche.name ?? b.flaeche.kennung }
                : b.wartetAuf !== undefined
                  ? { name: b.wartetAuf, kennung: null, offen: true, titel: b.wartetAuf, kandidat: null }
                  : null,
        arten: b.arten.map((a) => ({ ebene: a.ebene, art: a.art })),
        klima: b.klima === undefined ? null : { von: b.klima.von, bis: b.klima.bis },
        ...(b.lage === undefined ? {} : { lage: b.lage }),
        woerter: [],
        rueckfragen: [],
    };
}

// ---------------------------------------------------------------------------------------------------------------------
// Der Vorschlag des WikiSync am Eintrag
// ---------------------------------------------------------------------------------------------------------------------

/** Eine Regel des Eintrags in jedem Zustand, so weit die Prüfung der Vorschläge sie braucht. */
export interface BestandsRegel {
    id: string;
    relation: string;
    ruleKey: string;
    legacyOrigin: string;
    state: string;
    retiredOrigin: string | null;
}

export interface VorschlagBeziehung {
    beziehung: InhalteVorkommenBeziehung;
    status: "neu" | "geaendert" | "entfaellt" | "manuell";
    schluessel: string | null;
    bedingungen: WikisyncRegelBedingung[];
    teile: {
        beziehung: InhalteVorkommenBeziehung;
        text: string;
        grund: string;
        art: "nicht_abbildbar" | "rueckfrage";
    }[];
    bisherIds: string[];
    bisherSchluessel: string[];
}

/** Die Zeile des Protokolls zu einem Eintrag, wie sie in der Datenbank steht (die Bedingungen schon durch `bedingungAus`). */
export interface VorschlagRoh {
    lauf: number;
    beendetAm: Date | null;
    begriffeRevision: number | null;
    typ: WikisyncRegelTyp;
    vorgewaehlt: boolean;
    sperre: string | null;
    original: WikisyncRegelOriginal[];
    regeln: VorschlagBeziehung[];
}

/** Eine Bedingung des Protokolls: ältere Läufe führen die Wörter und Rückfragen vielleicht nicht. */
type BedingungProtokoll = Omit<WikisyncRegelBedingung, "woerter" | "rueckfragen"> &
    Partial<Pick<WikisyncRegelBedingung, "woerter" | "rueckfragen">>;

interface Payload {
    original?: WikisyncRegelOriginal[];
    regeln?: {
        beziehung: InhalteVorkommenBeziehung;
        status: VorschlagBeziehung["status"];
        schluessel?: string | null;
        bedingungen?: BedingungProtokoll[];
        bisher?: BedingungProtokoll[] | null;
        teile?: VorschlagBeziehung["teile"];
        bisherIds?: string[];
        bisherSchluessel?: string[];
    }[];
}

/** Eine Bedingung des Protokolls, auch wenn ein Feld fehlt, in die Form des Schemas (siehe `bedingungAus`). */
const ausProtokoll = (b: BedingungProtokoll): WikisyncRegelBedingung =>
    bedingungAus({ ...b, woerter: b.woerter ?? [], rueckfragen: b.rueckfragen ?? [] });

/** Das Protokoll des jüngsten fertigen Laufs mit Regelvorschlägen, die Zeile zu diesem Eintrag (`lore_entry.id`); `undefined`, wo es keinen Lauf, keine Tafel oder keine Aussage zum Eintrag gibt. */
export async function leseVorschlagRoh(database: Queryable, eintragId: string): Promise<VorschlagRoh | undefined> {
    const [da] = await database<{ ja: boolean }[]>`
        SELECT to_regclass('public.wikisync_regel_vorschlag') IS NOT NULL AND to_regclass('public.wikisync_regel_lauf') IS NOT NULL
               AND to_regclass('public.wikisync_lauf') IS NOT NULL AS ja
    `;
    if (da?.ja !== true) return undefined;
    const [lauf] = await database<{ id: number; beendet_am: Date | null; begriffe_revision: number | null }[]>`
        SELECT l.id::int AS id, l.beendet_am, r.begriffe_revision::int AS begriffe_revision
          FROM wikisync_lauf l JOIN wikisync_regel_lauf r ON r.lauf_id = l.id
         WHERE l.status = 'fertig'
         ORDER BY l.id DESC LIMIT 1
    `;
    if (lauf === undefined) return undefined;
    const [zeile] = await database<
        { typ: WikisyncRegelTyp; vorgewaehlt: boolean; sperre: string | null; payload: Payload | null }[]
    >`
        SELECT v.typ, v.vorgewaehlt, v.sperre, v.payload
          FROM wikisync_regel_vorschlag v
         WHERE v.lauf_id = ${lauf.id} AND v.lore_entry_id = ${eintragId}::bigint
         ORDER BY v.position LIMIT 1
    `;
    if (zeile === undefined) return undefined;
    const payload = zeile.payload ?? {};
    return {
        lauf: lauf.id,
        beendetAm: lauf.beendet_am,
        begriffeRevision: lauf.begriffe_revision,
        typ: zeile.typ,
        vorgewaehlt: zeile.vorgewaehlt,
        sperre: zeile.sperre,
        original: payload.original ?? [],
        regeln: (payload.regeln ?? []).map((regel): VorschlagBeziehung => ({
            beziehung: regel.beziehung,
            status: regel.status,
            schluessel: regel.schluessel ?? null,
            bedingungen: (regel.bedingungen ?? []).map(ausProtokoll),
            teile: (regel.teile ?? []).map((t) => ({
                beziehung: t.beziehung,
                text: t.text,
                grund: t.grund,
                art: t.art,
            })),
            bisherIds: regel.bisherIds ?? [],
            bisherSchluessel: regel.bisherSchluessel ?? [],
        })),
    };
}

/** Hat sich die Begriffstafel oder die Zuweisung einer Fläche seit dem Lauf geändert? Dann ist der Vorschlag nach einem älteren Stand gerechnet (wie in der Liste der Regelvorschläge). */
export async function vorschlagVeraltet(database: Queryable, vorschlag: VorschlagRoh): Promise<boolean> {
    const [stand] = await database<
        { revision: number }[]
    >`SELECT revision::int AS revision FROM wikisync_begriff_state WHERE id = 1`;
    if (stand !== undefined && vorschlag.begriffeRevision !== stand.revision) return true;
    return flaechenSeitLaufGeaendert(database, vorschlag.beendetAm);
}

/**
 * Gilt der Vorschlag zu dieser Beziehung noch? Siehe Kopf: Die bisherigen Regeln stehen so da, wie die Ableitung sie sah, und die Redaktion hat den vorgeschlagenen Schlüssel nicht selbst
 * stillgelegt. Ein Vorschlag zu einer Beziehung, die inzwischen eine Regel von Hand trägt, gilt nur als Hinweis (Status `manuell`); alle anderen warten dann nicht mehr auf Übernahme.
 */
export function vorschlagAktuell(beziehung: VorschlagBeziehung, bestand: readonly BestandsRegel[]): boolean {
    const inBeziehung = bestand.filter((regel) => regel.relation === beziehung.beziehung);
    const aktiv = inBeziehung.filter((regel) => regel.state === "active");
    const vonHand = aktiv.filter((regel) => regel.legacyOrigin !== "wiki_verbreitung").map((regel) => regel.ruleKey);
    const ausWiki = aktiv.filter((regel) => regel.legacyOrigin === "wiki_verbreitung").map((regel) => regel.ruleKey);
    if (beziehung.status === "manuell") {
        return (
            vonHand.length > 0 &&
            gleichMenge(vonHand, beziehung.bisherSchluessel) &&
            !(beziehung.schluessel !== null && vonHand.includes(beziehung.schluessel))
        );
    }
    if (vonHand.length > 0 || !gleichMenge(ausWiki, beziehung.bisherSchluessel)) return false;
    return (
        beziehung.schluessel === null ||
        !inBeziehung.some(
            (regel) =>
                regel.ruleKey === beziehung.schluessel && regel.state !== "active" && regel.retiredOrigin === "editor",
        )
    );
}

/** Der Vorschlag in der Form des Lesemodells (`InhalteVorkommen.wikiVorschlag`). */
export function wikiVorschlagVon(
    vorschlag: VorschlagRoh,
    bestand: readonly BestandsRegel[],
    veraltet: boolean,
): InhalteVorkommenWikiVorschlag {
    return {
        lauf: vorschlag.lauf,
        am: vorschlag.beendetAm?.toISOString() ?? null,
        veraltet,
        typ: vorschlag.typ,
        vorgewaehlt: vorschlag.vorgewaehlt,
        sperre: vorschlag.sperre,
        original: vorschlag.original,
        regeln: vorschlag.regeln.map((regel) => ({
            beziehung: regel.beziehung,
            status: regel.status,
            schluessel: regel.schluessel,
            bedingungen: regel.bedingungen,
            teile: regel.teile,
            bisherIds: regel.bisherIds,
            aktuell: vorschlagAktuell(regel, bestand),
        })),
    };
}

/**
 * Die Wiki-Fassung hinter einer Regel von Hand: die Fassung, von der sie ausging (`wikiBasis`; ihre Bedingungen aus der Zeile mit diesem Fingerabdruck, sonst aus dem Vorschlag, sonst fehlen
 * sie), und die, die das Wiki seitdem ergibt (`wikiJetzt`, nur an einer aktiven Regel: die Beziehung des Vorschlags mit Status `manuell`; `geaendert`, wenn sie von der Basis abweicht).
 */
export function wikiFassung(
    regel: Pick<BestandsRegel, "relation" | "legacyOrigin" | "state"> & { wikiBasisKey: string | null },
    basisBedingungen: readonly InhalteVorkommenBedingung[] | undefined,
    vorschlag: VorschlagRoh | undefined,
): Pick<InhalteVorkommenRegel, "wikiBasis" | "wikiJetzt"> {
    if (regel.legacyOrigin !== "manual" || regel.wikiBasisKey === null) return {};
    const basis = regel.wikiBasisKey;
    const ausVorschlag = vorschlag?.regeln.find((eine) => eine.schluessel === basis && eine.bedingungen.length > 0);
    const bedingungen =
        basisBedingungen !== undefined && basisBedingungen.length > 0
            ? basisBedingungen.map(alsWikiBedingung)
            : ausVorschlag?.bedingungen;
    const jetzt = vorschlag?.regeln.find(
        (eine) =>
            eine.beziehung === regel.relation &&
            eine.status === "manuell" &&
            eine.schluessel !== null &&
            eine.bedingungen.length > 0,
    );
    return {
        wikiBasis: { schluessel: basis, ...(bedingungen === undefined ? {} : { bedingungen }) },
        ...(regel.state === "active" && jetzt !== undefined && jetzt.schluessel !== null
            ? {
                  wikiJetzt: {
                      schluessel: jetzt.schluessel,
                      bedingungen: jetzt.bedingungen,
                      geaendert: jetzt.schluessel !== basis,
                  },
              }
            : {}),
    };
}

// ---------------------------------------------------------------------------------------------------------------------
// Die Suche nach Flächen
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Flächen für eine Bedingung: aktive Landschaften (`region`) außerhalb der Klima-Ebene, deren Name den Text enthält (ohne Text: die ersten nach Name). Ein Treffer nennt Ebene, Art und den
 * Wiki-Artikel, der ihm zugewiesen ist (der Titel der Adresse, wie die Ableitung ihn findet).
 */
export async function sucheVorkommenFlaechen(
    database: Queryable,
    text: string | undefined,
    limit: number,
): Promise<InhalteVorkommenFlaechen> {
    const wort = (text ?? "").trim();
    const zeilen =
        wort === ""
            ? await database<
                  { kennung: string; name: string; ebene: string; art: string | null; wiki_url: string | null }[]
              >`
                  SELECT r.public_id::text AS kennung, r.name, r.region_layer AS ebene, r.region_type AS art, r.wiki_url
                    FROM region r WHERE r.is_active AND r.region_layer <> 'klima'
                   ORDER BY lower(r.name), r.id LIMIT ${limit}
              `
            : await database<
                  { kennung: string; name: string; ebene: string; art: string | null; wiki_url: string | null }[]
              >`
                  SELECT r.public_id::text AS kennung, r.name, r.region_layer AS ebene, r.region_type AS art, r.wiki_url
                    FROM region r
                   WHERE r.is_active AND r.region_layer <> 'klima' AND r.name ILIKE ${likeMuster(wort)} ESCAPE '\\'
                   ORDER BY (lower(r.name) = lower(${wort})) DESC, starts_with(lower(r.name), lower(${wort})) DESC, lower(r.name), r.id
                   LIMIT ${limit}
              `;
    return {
        items: zeilen.map((zeile) => {
            const titel = titelAusWikiAdresse(zeile.wiki_url);
            const wikiTitel = titel === null ? "" : titel.replaceAll("_", " ").trim();
            return {
                kennung: zeile.kennung,
                name: zeile.name,
                ebene: zeile.ebene,
                ...(zeile.art === null || zeile.art === "" ? {} : { art: zeile.art }),
                ...(wikiTitel === "" ? {} : { wikiTitel }),
            };
        }),
    };
}

// ---------------------------------------------------------------------------------------------------------------------
// Die Lage zu einer Linie: Orte und Umriss
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Orte für die Lage einer Bedingung: aktive Siedlungen (`WIKISYNC_LAGE_ORTSARTEN`: Metropole, Großstadt, Stadt, Kleinstadt, Dorf), deren Name den Text enthält. Ohne Text die Metropolen und Großstädte (dort läuft
 * eine Linie am ehesten), sonst in der Rangfolge genauer Name vor Anfang des Namens vor Größe vor Name. Ein Treffer trägt Kennung, Name, Größe und Stelle (Kartenkoordinaten) für die Skizze.
 */
export async function sucheVorkommenOrte(
    database: Queryable,
    text: string | undefined,
    limit: number,
): Promise<InhalteVorkommenLageOrte> {
    const wort = (text ?? "").trim();
    type Zeile = { kennung: string; name: string; art: string; x: number; y: number };
    const zeilen =
        wort === ""
            ? await database<Zeile[]>`
                  SELECT p.public_id::text AS kennung, p.name, p.subtype AS art,
                         round(ST_X(p.geom)::numeric, 2)::float8 AS x, round(ST_Y(p.geom)::numeric, 2)::float8 AS y
                    FROM place p WHERE p.is_active AND p.subtype IN ('metropole', 'grossstadt')
                   ORDER BY CASE p.subtype WHEN 'metropole' THEN 0 ELSE 1 END, lower(p.name), p.id LIMIT ${limit}
              `
            : await database<Zeile[]>`
                  SELECT p.public_id::text AS kennung, p.name, p.subtype AS art,
                         round(ST_X(p.geom)::numeric, 2)::float8 AS x, round(ST_Y(p.geom)::numeric, 2)::float8 AS y
                    FROM place p
                   WHERE p.is_active AND p.subtype IN ('metropole', 'grossstadt', 'stadt', 'kleinstadt', 'dorf') AND p.name ILIKE ${likeMuster(wort)} ESCAPE '\\'
                   ORDER BY (lower(p.name) = lower(${wort})) DESC, starts_with(lower(p.name), lower(${wort})) DESC,
                            CASE p.subtype WHEN 'metropole' THEN 0 WHEN 'grossstadt' THEN 1 WHEN 'stadt' THEN 2 WHEN 'kleinstadt' THEN 3 ELSE 4 END, lower(p.name), p.id
                   LIMIT ${limit}
              `;
    return {
        items: zeilen.map((zeile) => ({
            kennung: zeile.kennung,
            name: zeile.name,
            art: zeile.art as InhalteVorkommenLageOrte["items"][number]["art"],
            x: zeile.x,
            y: zeile.y,
        })),
    };
}

/** Der Umriss Aventuriens samt dem Stand der Karte, auf dem er beruht (ETag der Route). */
export interface UmrissStand {
    /** Der ETag, mit Anführungszeichen. */
    etag: string;
    umriss: InhalteVorkommenUmriss;
}

/**
 * Im Prozess zwischengespeichert: Der Umriss wird aus allen Flächen der Region „Aventurien“ vereinigt und vereinfacht (`ST_Union`, `ST_SimplifyPreserveTopology`), das kostet spürbar und ändert sich nur mit der Karte.
 * Der Schlüssel ist der Stand der Region und ihrer Flächen (Nummern, Revision, Zahl, jüngste Änderung einer Fläche), nicht die Zeit; eine Karte, die sich ändert, bekommt beim nächsten Aufruf einen neuen Umriss.
 */
let umrissMerker: { stand: string; antwort: UmrissStand } | undefined;

/**
 * Der Umriss Aventuriens für die Skizze der Lage (`ST_AsSVG` mit umgedrehtem `y`, einer Nachkommastelle; Vereinfachung 1,5 Kartenpunkte) und der Rahmen seiner Fläche in Kartenkoordinaten. `undefined`, wo die Karte
 * keine aktive Fläche der Region „Aventurien“ hat.
 */
export async function leseUmriss(database: Queryable): Promise<UmrissStand | undefined> {
    const [kopf] = await database<{ ids: string | null; revision: string | null; n: number; geaendert: Date | null }[]>`
        SELECT string_agg(DISTINCT r.id::text, ',') AS ids, max(r.revision)::text AS revision, count(a.id)::int AS n, max(a.updated_at) AS geaendert
          FROM region r JOIN region_area a ON a.region_id = r.id AND a.is_active
         WHERE r.is_active AND r.name = 'Aventurien'
    `;
    if (kopf === undefined || kopf.n === 0) return undefined;
    const stand = `${kopf.ids ?? ""}|${kopf.revision ?? ""}|${String(kopf.n)}|${String(kopf.geaendert?.getTime() ?? 0)}`;
    if (umrissMerker?.stand === stand) return umrissMerker.antwort;
    const [zeile] = await database<{ pfad: string | null; x0: number; x1: number; y0: number; y1: number }[]>`
        WITH flaeche AS (
            SELECT ST_Union(a.geom) AS geom
              FROM region r JOIN region_area a ON a.region_id = r.id AND a.is_active
             WHERE r.is_active AND r.name = 'Aventurien'
        )
        SELECT ST_AsSVG(ST_SimplifyPreserveTopology(geom, 1.5), 0, 1) AS pfad,
               ST_XMin(geom)::float8 AS x0, ST_XMax(geom)::float8 AS x1, ST_YMin(geom)::float8 AS y0, ST_YMax(geom)::float8 AS y1
          FROM flaeche
    `;
    if (zeile === undefined || zeile.pfad === null || zeile.pfad === "") return undefined;
    const antwort: UmrissStand = {
        etag: `"u${createHash("sha256").update(stand, "utf8").digest("hex").slice(0, 16)}"`,
        umriss: { pfad: zeile.pfad, rahmen: { x0: zeile.x0, x1: zeile.x1, y0: zeile.y0, y1: zeile.y1 } },
    };
    umrissMerker = { stand, antwort };
    return antwort;
}
