import type {
    InhalteVorkommenArt,
    SearchEintrag,
    SearchEintragGegend,
    SearchLeuchtAnfrage,
    SearchZielGruppe,
    SearchZielHit,
} from "@avesmaps3d/shared";
import type { Queryable } from "../database.ts";
import { wikiLine } from "../subjects/facts.ts";
import { listLoreEntrySources } from "../subjects/sections/sources.ts";
import { loadCorpora } from "../subjects/subject-index.ts";
import { leuchte } from "../vorkommen/leuchten.ts";
import { baueWo, gegendenAnDerRoute, ladeWoZeilen, zeilenName } from "./eintrag-wo.ts";
import { bereinigeWiki, vorkommenIndex } from "./vorkommen-index.ts";
import { zieleDesEintrags } from "./vorkommen-suche.ts";
import { zielKatalog } from "./ziele-katalog.ts";

/**
 * Ein Eintrag für sein Panel (WI-0257, S3b): was die Sektion „Vorkommen“ der Suche nicht trägt (Lebensraum, die genannten Orte, die Wiki-Adresse) und die Ziele der Chips „Wo genau?“.
 *
 * 🔴 Nichts wird aus anderen Antworten zusammengeraten: Name, Art, Gruppe und weitere Namen kommen aus dem Index im Prozess (dieselben Zeilen wie die Sektion), die Texte aus der Datenbank, die Zahlen aus
 * `leuchte` und die Ziele aus derselben Rechnung wie die Autovervollständigung nach „Name in“ (`zieleDesEintrags`, derselbe Speicher): Was ein Chip nennt, leuchtet beim Wählen.
 * Nur im Wiki GENANNTE Ziele werden Chips; die übrigen Ziele der Autovervollständigung sind Vorschläge für die Suche, keine Aussage des Eintrags.
 *
 * 🔴 **Die Inhaltsschalter je Art gelten**: Eine ausgeblendete Art gibt es hier nicht (`undefined`, die Route antwortet 404), wie bei `leuchte`.
 *
 * Seit WI-0260 (Infobox neu) trägt die Antwort zusätzlich Kurzbeschreibung, Gegenstandstyp, Kontinent, „Wo es vorkommt“ (`eintrag-wo.ts`) und die Publikationen (`listLoreEntrySources`, derselbe Typ und dieselbe
 * Abfrage wie die Quellen der Kartenobjekte). Die Felder der Chips (`ziele`, `genanntIn`) bleiben bis zum nächsten Release.
 */

/** Nur Adressen der Wiki Aventurica werden verlinkt (wie im Panel der Orte, `subjects/sections/lore.ts`); alles andere bleibt Text. */
const WIKI_HOST = /^https:\/\/de\.wiki-aventurica\.de\//iu;

interface EintragZeile {
    lebensraum: string | null;
    wiki_url: string | null;
    wiki_title: string | null;
    kurzbeschreibung: string | null;
    typ: string | null;
    continent: string | null;
    /** Der Titel der Unterseite „Liste“ laut Wiki-Stand (`wiki_lore_snapshot.liste`, WI-0299); `null` ohne eine oder ohne Stand. */
    liste: string | null;
}

/**
 * Die Adresse einer Seite der Wiki Aventurica zu ihrem Titel, neben der des Artikels (`origin`): Leerzeichen werden Unterstriche, jedes Stück zwischen den Schrägstrichen wird kodiert, die Schrägstriche
 * einer Unterseite bleiben stehen (`/wiki/Langschwert/Liste`; einen kodierten `%2F` lehnen viele Server ab).
 */
export function wikiSeitenAdresse(origin: string, titel: string): string {
    const pfad = titel.replaceAll(" ", "_").split("/").map(encodeURIComponent).join("/");
    return `${origin}/wiki/${pfad}`;
}

export interface EintragOptionen {
    ausgeblendet?: (art: InhalteVorkommenArt) => boolean;
}

/** Der Landschaftstyp des Kontinents (`region_type`): „in Aventurien“ ist nichts anderes als „alle“ und bekommt keinen Chip. */
const KONTINENT_TYP = "kontinent";

/**
 * Die im Wiki genannten Ziele einer Gruppe (`genannt`), in der Reihenfolge der Autovervollständigung, ohne den Kontinent: Ein Chip „Aventurien“ neben „alle“ nennte dieselbe Zahl, und beim
 * Eintrag, der nur den Kontinent nennt, ließe er die Zeile „überall in Aventurien“ nicht zu.
 */
const genannte = (gruppen: readonly SearchZielGruppe[] | undefined): SearchZielHit[] =>
    (gruppen ?? []).flatMap((gruppe) =>
        gruppe.hits.filter((hit) => hit.genannt && hit.leuchten !== undefined && hit.typ !== KONTINENT_TYP),
    );

/**
 * Ein billiger Stempel für alles, was die Antwort eines Eintrags aus seiner Zeile und seinen Quellen liest und der Stempel des Index (`vorkommenIndex().stempel`: Zahl der Einträge, Regeln, Ortszeilen) nicht
 * fasst: die Texte (Kurzbeschreibung, Gegenstandstyp, Kontinent, Lebensraum, Wiki-Adresse, die Unterseite „Liste“ aus dem Wiki-Stand), die Revision und die Quellenverknüpfungen samt Katalog. Er geht in den ETag der Route ein; ohne ihn bliebe ein vom
 * WikiSync geänderter Text hinter einem 304 verborgen. Eine Abfrage über zwei Indizes (`public_id`, `lore_entry_id`); leer, wo es den Eintrag nicht gibt.
 */
export async function eintragStempel(database: Queryable, publicId: string): Promise<string> {
    const [zeile] = await database<{ stempel: string | null }[]>`
        SELECT concat_ws('|',
                 e.revision::text, e.updated_at::text,
                 md5(concat_ws('|', e.kurzbeschreibung, e.typ, e.continent, e.lebensraum, e.wiki_url, e.wiki_title)),
                 (SELECT md5(s.liste) FROM wiki_lore_snapshot s WHERE s.lore_entry_id = e.id),
                 (SELECT concat_ws(':', count(*), count(*) FILTER (WHERE s.is_active), max(s.id), max(s.updated_at), max(f.updated_at))
                    FROM lore_entry_source s LEFT JOIN feature_source f ON f.id = s.source_id
                   WHERE s.lore_entry_id = e.id)) AS stempel
          FROM lore_entry e
         WHERE e.public_id = ${publicId.toLowerCase()}::uuid
    `;
    return zeile?.stempel ?? "";
}

/**
 * Die Gegenden eines Eintrags an einer Route (WI-0257 S5, „Vorkommen unterwegs“): aus seinem Leuchten (`leuchte`, derselbe Zwischenspeicher wie das Panel) die Flächen, die die Route berührt,
 * als Gegenden wie in „Wo es vorkommt“ (`gegendenAnDerRoute`). `undefined` wie beim Panel: unbekannt, ausgeblendet oder pausiert.
 */
export async function eintragAnDerRoute(
    database: Queryable,
    publicId: string,
    beruehrt: { readonly landschaften: ReadonlySet<string>; readonly gebiete: ReadonlySet<string> },
    optionen: EintragOptionen = {},
): Promise<{ gegenden: SearchEintragGegend[]; alle: SearchLeuchtAnfrage[] } | undefined> {
    const index = await vorkommenIndex(database);
    const id = publicId.toLowerCase();
    const eintrag = index.eintraege.find((kandidat) => kandidat.publicId === id);
    if (eintrag === undefined || optionen.ausgeblendet?.(eintrag.kind) === true) return undefined;
    const [katalog, zeilen] = await Promise.all([zielKatalog(database), ladeWoZeilen(database, id)]);
    const leuchtet = await leuchte(
        database,
        { eintrag: eintrag.publicId },
        {
            stand: katalog.stand,
            ...(optionen.ausgeblendet === undefined ? {} : { ausgeblendet: optionen.ausgeblendet }),
        },
    );
    if (leuchtet === undefined || leuchtet.pausiert) return undefined;
    return gegendenAnDerRoute(database, eintrag.publicId, zeilen, leuchtet, katalog, beruehrt);
}

export async function eintragFuerPanel(
    database: Queryable,
    publicId: string,
    optionen: EintragOptionen = {},
): Promise<SearchEintrag | undefined> {
    const index = await vorkommenIndex(database);
    const id = publicId.toLowerCase();
    const eintrag = index.eintraege.find((kandidat) => kandidat.publicId === id);
    if (eintrag === undefined || optionen.ausgeblendet?.(eintrag.kind) === true) return undefined;

    const [zeile, wozeilen] = await Promise.all([
        database<EintragZeile[]>`
            SELECT e.lebensraum, e.wiki_url, e.wiki_title, e.kurzbeschreibung, e.typ, e.continent, s.liste
              FROM lore_entry e
              LEFT JOIN wiki_lore_snapshot s ON s.lore_entry_id = e.id
             WHERE e.public_id = ${id}::uuid AND e.is_active AND e.state = 'active'
        `.then((zeilen) => zeilen[0]),
        ladeWoZeilen(database, id),
    ]);
    if (zeile === undefined) return undefined;

    const katalog = await zielKatalog(database);
    const basis: SearchLeuchtAnfrage = { eintrag: eintrag.publicId };
    const [leuchtet, gruppen, publikationen] = await Promise.all([
        leuchte(database, basis, {
            stand: katalog.stand,
            ...(optionen.ausgeblendet === undefined ? {} : { ausgeblendet: optionen.ausgeblendet }),
        }),
        zieleDesEintrags(
            database,
            eintrag,
            optionen.ausgeblendet === undefined ? {} : { ausgeblendet: optionen.ausgeblendet },
        ),
        listLoreEntrySources(database, eintrag.publicId),
    ]);
    if (leuchtet === undefined || leuchtet.pausiert) return undefined;
    const wo = await baueWo(database, eintrag.publicId, wozeilen, leuchtet, katalog);

    const lebensraum = zeile.lebensraum === null ? "" : bereinigeWiki(zeile.lebensraum);
    const genanntIn = [...new Set(wozeilen.map(zeilenName).filter((name) => name !== ""))];
    // Die Wikizeile samt Lizenz und Namensnennung des Korpus, wie jedes Subject sie trägt; eine fremde Adresse bleibt Text.
    const wiki =
        zeile.wiki_url !== null && WIKI_HOST.test(zeile.wiki_url)
            ? wikiLine(
                  { corpora: await loadCorpora(database) },
                  zeile.wiki_url,
                  bereinigeWiki(zeile.wiki_title ?? "") || eintrag.name,
              )
            : undefined;
    // Die Unterseite „Liste“ (WI-0299): nur neben einer Adresse des Wikis, und nur, wo der WikiSync sie im Dump gefunden hat.
    const liste =
        wiki !== undefined && zeile.liste !== null && zeile.liste.trim() !== ""
            ? wikiSeitenAdresse(new URL(wiki.url).origin, zeile.liste.trim())
            : undefined;
    const weitereNamen = eintrag.aliase.map((alias) => alias.text);
    // Texte ohne Wiki-Auszeichnung; leer heißt „nicht erfasst“ (`null`), nie ein leeres Feld.
    const sauber = (text: string | null): string | null => {
        const rein = text === null ? "" : bereinigeWiki(text);
        return rein === "" ? null : rein;
    };
    // „Myranor / Güldenland“ ist EIN Feld mit zwei Kontinenten; ohne Leerraum um den Schrägstrich, die Oberfläche setzt ihn selbst.
    const kontinent = zeile.continent?.replace(/\s*\/\s*/gu, "/").trim() ?? "";

    return {
        id: eintrag.publicId,
        name: eintrag.name,
        kind: eintrag.kind,
        ...(eintrag.gruppe === undefined ? {} : { gruppe: eintrag.gruppe }),
        ...(weitereNamen.length === 0 ? {} : { weitereNamen }),
        ...(lebensraum === "" ? {} : { lebensraum }),
        ...(genanntIn.length === 0 ? {} : { genanntIn }),
        ...(wiki === undefined ? {} : { wiki }),
        ...(liste === undefined ? {} : { liste }),
        kartenbezug: eintrag.kartenbezug,
        gegenden: leuchtet.gegenden,
        orte: leuchtet.orte.length,
        nurKontinent: leuchtet.nurKontinent,
        leuchten: basis,
        ziele: genannte(gruppen),
        kurzbeschreibung: sauber(zeile.kurzbeschreibung),
        typ: sauber(zeile.typ),
        kontinent: kontinent === "" ? null : kontinent,
        wo,
        publikationen,
    };
}
