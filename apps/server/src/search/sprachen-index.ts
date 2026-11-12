import {
    foldName,
    SEARCH_VORKOMMEN_SICHTBAR,
    type SearchSpracheFund,
    type SearchSpracheHit,
    type SearchSpracheSektion,
} from "@avesmaps3d/shared";
import type { Queryable } from "../database.ts";
import { dialekteVon } from "../sprachen/dialekte.ts";
import { bereinigeWiki, namensGuete } from "./vorkommen-index.ts";

/**
 * Der Suchindex der Sprachen (WI-0261 S5c; Betreiber 2026-10-30: „sprachen sollen in der suche auftauchen und leuchten“, O1: „Die Suche findet eine Gruppe auch über die Namen ihrer
 * Wiki-Artikel“): Name, Legende, Wiki-Artikel und Dialekte aller aktiven Sprachen, einmal im Prozess und gefaltet (klein, ohne Akzente, ß als ss, `foldName`). Es sind elf Sprachen der
 * Karte und rund neunzig Wiki-Artikel, die Tastendruck-Suche kostet also einen Durchlauf über wenige Zeilen im Speicher. Der Index wird neu gelesen, sobald sich Sprachen, ihre Flächen,
 * ihre Zuordnung zu Artikeln oder die Artikel selbst ändern (`stempel`, wie `vorkommen-index.ts`).
 *
 * - **Gefunden** wird über den Namen, die Legende, den Titel oder Namen eines zugeordneten Wiki-Artikels und den Namen eines Dialekts. Die Dialekte sind dieselbe Ableitung wie in der Infobox
 *   (`sprachen/dialekte.ts`): Wiki-Artikel derselben Sprachfamilie, die keiner Sprache zugeordnet sind.
 * - **Eine Sprache ist ein Treffer**, der beste ihrer Namen zählt (Güte, dann Name vor Wiki-Artikel vor Legende vor Dialekt). Gäbe es je Name eine Zeile, stünde „Thorwalsch“ dreimal da, sobald
 *   jemand „thor“ tippt.
 * - Nur **aktive** Sprachen; Artikel und Zuordnungen zählen nur aktiv. Eine Sprache ohne Fläche ist ein Treffer (`gegenden: 0`): Die Oberfläche sagt „noch keine Fläche“, es leuchtet nichts.
 */

interface Name {
    readonly text: string;
    readonly gefaltet: string;
}

export interface SprachIndexEintrag {
    /** `sprache.public_id` */
    readonly publicId: string;
    readonly schluessel: string;
    readonly name: string;
    readonly gefaltet: string;
    readonly farbe: string;
    readonly reihenfolge: number;
    /** Mehr als ein zugeordneter Wiki-Artikel: eine Sprachgruppe (O1). */
    readonly gruppe: boolean;
    /** Die Zahl der aktiven Teilflächen. */
    readonly gegenden: number;
    readonly legende: Name | undefined;
    /** Titel und Name der zugeordneten aktiven Wiki-Artikel, in der Reihenfolge der Zuordnung, ohne Doppelte. */
    readonly artikel: readonly Name[];
    readonly dialekte: readonly Name[];
}

export interface SprachIndex {
    readonly stempel: string;
    readonly sprachen: readonly SprachIndexEintrag[];
}

const name = (text: string): Name => ({ text, gefaltet: foldName(text) });

/** Hängt `text` an, wenn er nicht leer ist und (gefaltet) noch nicht dasteht. */
function fuegeHinzu(liste: Name[], text: string | null | undefined): void {
    const sauber = bereinigeWiki(text ?? "");
    if (sauber === "") return;
    const neu = name(sauber);
    if (!liste.some((vorhanden) => vorhanden.gefaltet === neu.gefaltet)) liste.push(neu);
}

interface SpracheZeile {
    id: string;
    public_id: string;
    schluessel: string;
    name: string;
    legende: string | null;
    farbe: string;
    reihenfolge: number;
    gegenden: number;
}

interface ArtikelZeile {
    sprache_id: string;
    id: string;
    titel: string;
    name: string | null;
    navigation: string[];
    vorstufen: string | null;
}

/** Ein billiger Stempel für alles, wovon der Index abhängt (eine Abfrage): Zahl, größte Kennung und Summe der Revisionen je Tafel; jede Änderung zählt eine Revision hoch (`revision_bump`). */
async function ladeStempel(database: Queryable): Promise<string> {
    const [zeile] = await database<{ stempel: string }[]>`
        SELECT concat_ws('|',
            (SELECT concat_ws(':', count(*), max(s.id), sum(s.revision)) FROM sprache s),
            (SELECT concat_ws(':', count(*), max(a.id), sum(a.revision)) FROM sprache_flaeche a),
            (SELECT concat_ws(':', count(*), max(z.id), sum(z.revision)) FROM sprache_wiki z),
            (SELECT concat_ws(':', count(*), max(w.id), sum(w.revision)) FROM wiki_sprache_artikel w)
        ) AS stempel
    `;
    return zeile?.stempel ?? "";
}

async function baueIndex(database: Queryable, stempel: string): Promise<SprachIndex> {
    const [sprachen, artikel] = await Promise.all([
        database<SpracheZeile[]>`
            SELECT s.id::text AS id, s.public_id::text AS public_id, s.schluessel, s.name, s.legende, s.farbe, s.reihenfolge,
                   (SELECT count(*)::int FROM sprache_flaeche a WHERE a.sprache_id = s.id AND a.is_active) AS gegenden
              FROM sprache s
             WHERE s.is_active
             ORDER BY s.reihenfolge, lower(s.name), s.id
        `,
        database<ArtikelZeile[]>`
            SELECT z.sprache_id::text AS sprache_id, w.id::text AS id, w.titel, w.name, w.navigation, w.vorstufen
              FROM sprache_wiki z
              JOIN wiki_sprache_artikel w ON w.id = z.wiki_sprache_artikel_id AND w.is_active
              JOIN sprache s ON s.id = z.sprache_id AND s.is_active
             WHERE z.is_active
             ORDER BY z.sprache_id, z.position, z.id
        `,
    ]);
    const eintraege: SprachIndexEintrag[] = [];
    for (const sprache of sprachen) {
        const eigene = artikel.filter((zeile) => zeile.sprache_id === sprache.id);
        const titel: Name[] = [];
        for (const zeile of eigene) {
            fuegeHinzu(titel, zeile.titel);
            fuegeHinzu(titel, zeile.name);
        }
        const erster = eigene[0];
        const dialekte: Name[] = [];
        if (erster !== undefined) {
            for (const text of await dialekteVon(database, {
                id: erster.id,
                navigation: erster.navigation,
                vorstufen: erster.vorstufen,
            })) {
                fuegeHinzu(dialekte, text);
            }
        }
        const legende = bereinigeWiki(sprache.legende ?? "");
        eintraege.push({
            publicId: sprache.public_id,
            schluessel: sprache.schluessel,
            name: sprache.name.trim(),
            gefaltet: foldName(sprache.name),
            farbe: sprache.farbe,
            reihenfolge: sprache.reihenfolge,
            gruppe: eigene.length > 1,
            gegenden: sprache.gegenden,
            legende: legende === "" ? undefined : name(legende),
            artikel: titel,
            dialekte,
        });
    }
    return { stempel, sprachen: eintraege };
}

let aktuell: SprachIndex | undefined;
let ladend: { stempel: string; versprechen: Promise<SprachIndex> } | undefined;
let geprueftAm = 0;
/** So lange gilt ein geprüfter Stempel: ein Tastendruck nach dem anderen fragt die Datenbank nicht jedes Mal. */
const PRUEFABSTAND_MS = 1_500;

/** Verwirft den Index im Prozess (Tests, Eingriffe an der Datenbank). */
export function leereSprachIndex(): void {
    aktuell = undefined;
    ladend = undefined;
    geprueftAm = 0;
}

/** Der Index der aktiven Sprachen, neu gelesen, wenn sich etwas geändert hat; mehrere gleichzeitige Fragen lesen einmal. */
export async function sprachIndex(database: Queryable): Promise<SprachIndex> {
    const jetzt = Date.now();
    if (aktuell !== undefined && jetzt - geprueftAm < PRUEFABSTAND_MS) return aktuell;
    const stempel = await ladeStempel(database);
    geprueftAm = Date.now();
    if (aktuell?.stempel === stempel) return aktuell;
    if (ladend?.stempel === stempel) return ladend.versprechen;
    const versprechen = baueIndex(database, stempel).then((index) => {
        aktuell = index;
        return index;
    });
    ladend = { stempel, versprechen };
    void versprechen.then(
        () => {
            if (ladend?.versprechen === versprechen) ladend = undefined;
        },
        () => {
            if (ladend?.versprechen === versprechen) ladend = undefined;
        },
    );
    return versprechen;
}

// ---------------------------------------------------------------------------------------------------------------------
// Suchen
// ---------------------------------------------------------------------------------------------------------------------

export interface SprachTreffer {
    readonly sprache: SprachIndexEintrag;
    readonly gefundenIn: SearchSpracheFund;
    /** Der Text, über den die Sprache gefunden wurde (nicht der Name). */
    readonly ueber?: string;
    /** Die Güte (`namensGuete`): kleiner ist besser. */
    readonly guete: number;
}

/**
 * Name vor Wiki-Artikel vor Legende vor Dialekt, wenn die Güte gleich ist. Der Artikel steht vor der Legende, weil er das einzelne Wort nennt („Gjalskisch“), das die Legende nur aufzählt: Die Zeile
 * zeigt dann den kurzen Titel statt der ganzen Aufzählung.
 */
const RANG: Readonly<Record<SearchSpracheFund, number>> = { name: 0, wiki: 1, legende: 2, dialekt: 3 };

/**
 * Die Sprachen, die zur Anfrage passen, die besten zuerst: Güte des besten Namens, dann Name vor Wiki-Artikel vor Legende vor Dialekt, dann eine mit Fläche vor einer ohne, dann die Reihenfolge
 * der Legende. Ohne Rücksicht auf Groß- und Kleinschreibung und Akzente.
 */
export function sucheSprachen(index: SprachIndex, text: string): SprachTreffer[] {
    const q = foldName(text);
    if (q === "") return [];
    const treffer: SprachTreffer[] = [];
    for (const sprache of index.sprachen) {
        const kandidaten: SprachTreffer[] = [];
        const pruefe = (gefundenIn: SearchSpracheFund, kandidat: Name, ueber?: string): void => {
            const guete = namensGuete(kandidat.gefaltet, q);
            if (guete === undefined) return;
            kandidaten.push({ sprache, gefundenIn, guete, ...(ueber === undefined ? {} : { ueber }) });
        };
        pruefe("name", { text: sprache.name, gefaltet: sprache.gefaltet });
        if (sprache.legende !== undefined) pruefe("legende", sprache.legende, sprache.legende.text);
        for (const artikel of sprache.artikel) pruefe("wiki", artikel, artikel.text);
        for (const dialekt of sprache.dialekte) pruefe("dialekt", dialekt, dialekt.text);
        const [bester] = kandidaten.sort((a, b) => a.guete - b.guete || RANG[a.gefundenIn] - RANG[b.gefundenIn]);
        if (bester !== undefined) treffer.push(bester);
    }
    return treffer.sort(
        (a, b) =>
            a.guete - b.guete ||
            RANG[a.gefundenIn] - RANG[b.gefundenIn] ||
            Number(b.sprache.gegenden > 0) - Number(a.sprache.gegenden > 0) ||
            a.sprache.reihenfolge - b.sprache.reihenfolge ||
            a.sprache.name.localeCompare(b.sprache.name, "de") ||
            a.sprache.publicId.localeCompare(b.sprache.publicId),
    );
}

function alsHit(treffer: SprachTreffer): SearchSpracheHit {
    const { sprache, gefundenIn, ueber } = treffer;
    // Ein Dialekt heißt in der Zeile wie er selbst; die Infobox, die er öffnet, ist die der Sprache.
    return {
        id: sprache.publicId,
        schluessel: sprache.schluessel,
        name: gefundenIn === "dialekt" && ueber !== undefined ? ueber : sprache.name,
        farbe: sprache.farbe,
        gefundenIn,
        ...(gefundenIn === "legende" || gefundenIn === "wiki" ? { ueber: ueber as string } : {}),
        ...(gefundenIn === "dialekt" ? { dialektVon: sprache.name } : {}),
        gruppe: sprache.gruppe,
        gegenden: sprache.gegenden,
    };
}

/** Die Sektion „Sprachen“ der Suchantwort: höchstens `SEARCH_VORKOMMEN_SICHTBAR` Treffer und die Gesamtzahl; `undefined` ohne Treffer. */
export async function sprachenSektion(database: Queryable, text: string): Promise<SearchSpracheSektion | undefined> {
    const treffer = sucheSprachen(await sprachIndex(database), text);
    if (treffer.length === 0) return undefined;
    return { hits: treffer.slice(0, SEARCH_VORKOMMEN_SICHTBAR).map(alsHit), total: treffer.length };
}
