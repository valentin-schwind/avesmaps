import {
    WIKI_BOX_TREFFER_MAX,
    type WikiBoxArt,
    type WikiBoxArtikel,
    type WikiBoxWeiterer,
    type WikiTreffer,
} from "@avesmaps3d/shared";
import type { Queryable } from "../../database.ts";
import { raumDerAdresseInUmgebung } from "../../kanon/namensraum.ts";
import type { MapAuditEntry } from "../../editor/map-operation.ts";
import type { Schreiber } from "../abgleich/uebernahme/schreiber.ts";
import { titelAusWikiAdresse } from "../vorschau/adresse.ts";

/**
 * Der Anschluss einer Art an die Wiki-Box (WI-0253): was je Art verschieden ist. Die Box selbst (Stand, Suche, Zuweisen, Entfernen, Sync) ist für alle Arten dieselbe (`box.ts`, `routes/editor-wiki-box.ts`);
 * jede Art sagt nur,
 *
 * - **wer** das Objekt ist (`lies`): Name, Kennungen (ein Weg, eine Kraftlinie oder eine Landschaft besteht aus Abschnitten), der Artikel, an dem es hängt, und ob der einen Wiki-Stand hat;
 * - **welche Artikel** es gibt (`suche`): die Wiki-Stände der Art, wie sie in der Datenbank liegen (nie ein Abruf beim Wiki);
 * - **wie** sich die Zuordnung ändert (`weise`, `entferne`) und die Revision des Objekts zählt (`beruehre`).
 *
 * 🔴 Alles hier läuft als App-Rolle, in der Operation an der Karte (`mapOperation`): Die Rechte der App an den Zuordnungstafeln stehen in `map-grants.psql`, die Wiki-Stände darf sie nur lesen (also keine
 * Zeilensperre auf ihnen, `FOR UPDATE` braucht das UPDATE-Recht). Die Sperre nimmt `sperre` auf den Objekten selbst.
 *
 * Eine Zuordnung wird nie gelöscht: `entferne` stellt sie auf „kein Artikel“ (die Art, die der Import nie überschreibt) und legt die Tafel X2 still (`retired_origin = 'editor'`).
 */

export interface BoxObjekt {
    art: WikiBoxArt;
    /** Die Kennung, unter der die Oberfläche das Objekt kennt (Weg: der Anker der Straße). */
    id: string;
    name: string;
    mapDomainId: string;
    /** Alle öffentlichen Kennungen des Objekts: ein Ort, ein Gebiet, eine Landschaft eine, eine Straße oder Kraftlinie ihre Abschnitte. */
    ids: string[];
    artikel: WikiBoxArtikel | null;
    /** Hat der Artikel einen Wiki-Stand (Schnappschuss)? Ohne ihn hat der Sync nichts zu schreiben. */
    mitStand: boolean;
    /** Straße, Linie, Landschaft: an wie vielen Abschnitten hängt der Artikel? Fehlt, wenn an allen. */
    anteil?: { mit: number; von: number };
}

/**
 * Die Herkunft einer Zuordnung, wie ihre Tafel sie führt (WI-0265 B8d): Zustand, Herkunft (`assignment_origin`) und System (`source_system`). Der Schreibweg der Box hält sie vor und nach dem Schreiben im
 * Protokoll fest (`zuordnung`), damit die Rücknahme die Zuordnung samt Herkunft zurückgibt: Eine Zuordnung des Imports soll danach wieder dem Import gehören, nicht der Redaktion.
 */
export interface Zuordnungsherkunft {
    zustand: string;
    herkunft: string;
    system: string;
    /** Nur bei einer Straße oder Linie, an deren Abschnitten der Artikel nur zum Teil hängt (`mit` von `von`): Dieser Stand lässt sich nicht herstellen, ohne die übrigen Abschnitte zu belegen. */
    anteil?: { mit: number; von: number };
}

export interface Anschluss {
    readonly art: WikiBoxArt;
    readonly schreiber: Schreiber;
    /** Das Objekt mit seinem Artikel; `undefined`, wenn es das nicht (mehr) gibt. */
    lies(db: Queryable, id: string): Promise<BoxObjekt | undefined>;
    /** Die Artikel zur Suche, höchstens `WIKI_BOX_TREFFER_MAX`; `belegt` nennt das Objekt, an dem ein Artikel schon hängt. */
    suche(db: Queryable, objekt: BoxObjekt, q: string): Promise<WikiTreffer[]>;
    /** Sperrt die Objekte (feste Reihenfolge) und liefert die Revision je Kennung; fehlt eines, fehlt es in der Abbildung. */
    sperre(tx: Queryable, objekt: BoxObjekt): Promise<ReadonlyMap<string, number>>;
    /** Ordnet den Artikel zu. Wirft `ApiError` 400, wenn es ihn nicht gibt. */
    weise(tx: Queryable, objekt: BoxObjekt, key: string): Promise<WikiBoxArtikel>;
    /** Löst die Zuordnung; die Felder behalten ihre Werte als eigene. */
    entferne(tx: Queryable, objekt: BoxObjekt): Promise<void>;
    /** Zählt die Revision des Objekts (ein UPDATE ohne Wertänderung; der Trigger zählt) und liefert sie je Kennung. */
    beruehre(tx: Queryable, objekt: BoxObjekt): Promise<ReadonlyMap<string, number>>;
    /**
     * Die Herkunft der aktiven Zuordnung (`null`, wo es keine gibt); fehlt, wo die Art keine führt (Gebiet und Landschaft halten Schlüssel und Adresse an der Zeile selbst). Liest nur (WI-0265 B8d).
     */
    herkunft?(tx: Queryable, objekt: BoxObjekt): Promise<Zuordnungsherkunft | null>;
    /** Setzt die Herkunft der aktiven Zuordnung zurück, nachdem `weise` oder `entferne` sie schrieb (nur die Rücknahme, WI-0265 B8d). */
    setzeHerkunft?(tx: Queryable, objekt: BoxObjekt, herkunft: Zuordnungsherkunft): Promise<void>;
    /** Nur der Weg (WI-0300): weitere Artikel neben dem Hauptartikel. Fehlt bei den Arten, die keine tragen. */
    readonly weitere?: WeitereAnschluss;
    /** Nur der Weg (OPS-000112): die Hauptzuordnung je Abschnitt, damit die Rücknahme einen Artikel, der nur an einem Teil der Abschnitte hing, genau dort zurückgibt. */
    readonly abschnitte?: AbschnittsAnschluss;
}

/**
 * Der Stand eines Abschnitts vor oder nach einem Schritt der Box (OPS-000112), im Protokoll als `wikiOrigin` je Abschnitt (neben `wiki` keine eigene Zeile im Verlauf).
 * Weisen und Lösen gelten immer der ganzen Straße; hing der Artikel vorher nur an einem Teil der Abschnitte („An alle Abschnitte“ im Wegeditor), braucht die Rücknahme den Stand jedes Abschnitts.
 */
export interface AbschnittsStand {
    /** Die Hauptzuordnung: Schlüssel des Wiki-Stands (`null`: eine Adresse ohne Stand), Zustand, Herkunft, System; `null`: keine. */
    haupt: { key: string | null; zustand: string; herkunft: string; system: string } | null;
    /** Die weiteren Zeilen desselben Artikels an dem Abschnitt, die das Schreiben still legt (`weise` hält einen Artikel je Abschnitt nur einmal), samt Herkunft. */
    weitere: WeitereZeile[];
}

export interface AbschnittsAnschluss {
    /** Der Stand je Abschnitt; `ziel` nennt je Abschnitt den Artikel, der gleich geschrieben wird (`null`: keiner), damit `weitere` die Zeilen trägt, die das Schreiben still legt. Liest nur. */
    lies(
        db: Queryable,
        objekt: BoxObjekt,
        ziel: (id: string) => string | null,
    ): Promise<ReadonlyMap<string, AbschnittsStand>>;
    /** Stellt den Stand je Abschnitt her (nur die Rücknahme): Hauptzuordnung samt Herkunft, die Tafel X2, die still gelegten weiteren Zeilen. Den Vermerk der Felder fasst es nicht an. */
    stelleHer(tx: Queryable, objekt: BoxObjekt, ziel: ReadonlyMap<string, AbschnittsStand>): Promise<void>;
}

/**
 * Die weiteren Artikel eines Objekts (WI-0300, OPS-000108): neben dem Hauptartikel weitere Artikel, etwa ein Pilgerweg über einer Reichsstraße. Sie ändern nie Name, Gruppe oder Art.
 * Seit WI-0302 zeigt die Box sie nur an: Geschrieben werden sie als weitere Straßennamen je Abschnitt mit „Fertig“ im Wegeditor (`path.update`, `editor/path-weitere.ts`).
 *
 * 🔴 **Die Rücknahme der Schritte, die die Box unter WI-0300 schrieb** (`wikibox.weitere_zuweisen`, `.weitere_entfernen`; die Stage hat solche), arbeitet auf genau den Zeilen, die ein Schritt schrieb,
 * nicht auf dem Artikel: Ein weiterer Artikel hängt meist nur an einem Teil der Abschnitte (Stage 2026-11-09: Reichsstraße 1 trägt den Bärenpfad an 3 von 27). Das Protokoll nennt je Abschnitt die
 * Zeile samt Herkunft (`weitereEintraege`), und die Rücknahme belebt oder legt still genau diese (`belebe`, `legeStill`).
 */
export interface WeitereAnschluss {
    /** Die weiteren Artikel, nach Namen geordnet; `anteil`, wo einer nicht an allen Abschnitten hängt. */
    lies(db: Queryable, objekt: BoxObjekt): Promise<WikiBoxWeiterer[]>;
    /** Rücknahme eines Lösens: belebt genau diese Zeilen mit ihrer Herkunft, jede nur, wenn sie still liegt und ihr Abschnitt den Artikel nicht schon wieder trägt. Liefert die Zahl. */
    belebe(tx: Queryable, zeilen: readonly WeitereZeile[]): Promise<number>;
    /** Rücknahme eines Hinzufügens: legt genau diese Zeilen still, jede nur, wenn sie aktiv ist. Liefert die Zahl. */
    legeStill(tx: Queryable, zeilen: readonly WeitereZeile[]): Promise<number>;
    /** Für die Vorprüfung, nur lesend: wie viele der Zeilen aktiv sind und wie viele stille einen aktiven Zwilling haben (derselbe Abschnitt trägt den Artikel wieder). */
    pruefe(db: Queryable, zeilen: readonly WeitereZeile[]): Promise<{ aktiv: number; zwilling: number }>;
}

/** Eine Zeile der Zuordnungstafel eines weiteren Artikels: ihre Kennung und ihre Herkunft (`assignment_origin`) vor dem Schritt. */
export interface WeitereZeile {
    id: string;
    herkunft: string;
}

/**
 * Herkunft und Rückstellung für die Arten, deren Zuordnung eine eigene Tafel mit Zustand, Herkunft und System führt (Ort, Weg, Kraftlinie, Gipfel). Die Namen sind Konstanten der Anschlüsse, nie Eingaben.
 * `haupt`: nur die Hauptzuweisung (`role = 'main'`, der Weg hat auch weitere).
 */
export function herkunftDerTafel(tafel: {
    zuordnung: string;
    schluessel: string;
    traeger: string;
    haupt?: boolean;
}): Pick<Anschluss, "herkunft" | "setzeHerkunft"> {
    const rolle = tafel.haupt === true ? " AND a.role = 'main'" : "";
    return {
        async herkunft(tx, objekt) {
            const [zeile] = await tx.unsafe<
                { assignment_state: string; assignment_origin: string; source_system: string; mit: number }[]
            >(
                `SELECT a.assignment_state, a.assignment_origin, a.source_system, count(*) OVER ()::int AS mit
                   FROM ${tafel.zuordnung} a JOIN ${tafel.traeger} p ON p.id = a.${tafel.schluessel}
                  WHERE p.public_id = ANY($1::uuid[]) AND a.is_active${rolle}
                  ORDER BY p.public_id LIMIT 1`,
                [objekt.ids] as never[],
            );
            return zeile === undefined
                ? null
                : {
                      zustand: zeile.assignment_state,
                      herkunft: zeile.assignment_origin,
                      system: zeile.source_system,
                      ...(zeile.mit < objekt.ids.length ? { anteil: { mit: zeile.mit, von: objekt.ids.length } } : {}),
                  };
        },
        async setzeHerkunft(tx, objekt, herkunft) {
            await tx.unsafe(
                `UPDATE ${tafel.zuordnung} a SET assignment_state = $2, assignment_origin = $3, source_system = $4
                   FROM ${tafel.traeger} p
                  WHERE p.id = a.${tafel.schluessel} AND p.public_id = ANY($1::uuid[]) AND a.is_active${rolle}`,
                [objekt.ids, herkunft.zustand, herkunft.herkunft, herkunft.system] as never[],
            );
        },
    };
}

/** Der Titel hinter einer Adresse, sonst die Adresse selbst: Mehr zeigt die Box nicht, wenn der Wiki-Stand keinen Namen trägt. */
export const titelOderAdresse = (adresse: string): string => titelAusWikiAdresse(adresse) ?? adresse;

/** Das Muster einer Suche nach Name oder Schlüssel; leer: alles. */
export const sucheMuster = (q: string): string | null => {
    const roh = q.trim();
    return roh === "" ? null : `%${roh.replace(/[\\%_]/gu, (zeichen) => `\\${zeichen}`)}%`;
};

/** Die Obergrenze der Suche, für die Abfragen der Arten. */
export const TREFFER_MAX = WIKI_BOX_TREFFER_MAX;

/**
 * Die Zuordnung der Tafel X2 (`wiki_key_assignment`) für diese Objekte: der kanonische Key ist `wiki:` plus der Schlüssel des Wiki-Stands (so prüft ihn `verify:wiki-links`), der Namensraum folgt dem Präfix
 * des Titels hinter der Adresse (nie aus dem Slug geraten). Herkunft `avesmaps3d`: Der Import fasst die Zeile nie an.
 */
export async function schreibeX2(
    tx: Queryable,
    legacyArt: string,
    ids: readonly string[],
    stand: { key: string; url: string; name: string | null },
): Promise<void> {
    if (ids.length === 0) return;
    const raum = await raumDerAdresseInUmgebung(tx, stand.url);
    const kanonisch = stand.key.startsWith("wiki:") ? stand.key : `wiki:${stand.key}`;
    await tx`
        INSERT INTO wiki_key_assignment (legacy_art, object_public_id, wiki_key, wiki_url, wiki_title, ns, ns_name, source_system)
        SELECT ${legacyArt}, t.id, ${kanonisch}, ${stand.url}, ${stand.name}, ${raum.ns}, ${raum.nsName}, 'avesmaps3d'
          FROM unnest(${[...ids]}::uuid[]) AS t(id)
        ON CONFLICT (legacy_art, object_public_id) DO UPDATE
           SET wiki_key = EXCLUDED.wiki_key, wiki_url = EXCLUDED.wiki_url, wiki_title = EXCLUDED.wiki_title, ns = EXCLUDED.ns, ns_name = EXCLUDED.ns_name,
               source_system = 'avesmaps3d', is_active = TRUE, retired_at = NULL, retired_origin = NULL, updated_at = now()
    `;
}

/** Legt die Zeilen der Tafel X2 still (nie gelöscht); die Herkunft `editor` schützt die Entscheidung vor dem Import. */
export async function legeX2Still(tx: Queryable, legacyArt: string, ids: readonly string[]): Promise<void> {
    if (ids.length === 0) return;
    await tx`
        UPDATE wiki_key_assignment SET is_active = FALSE, retired_at = now(), retired_origin = 'editor', updated_at = now()
         WHERE legacy_art = ${legacyArt} AND object_public_id = ANY(${[...ids]}::uuid[]) AND is_active
    `;
}

/** Die Einträge des Fachprotokolls einer Zuordnung: je Kennung ein Eintrag, `wiki` trägt den Key vorher und nachher. */
export function zuordnungsEintraege(
    anschluss: Pick<Anschluss, "schreiber">,
    aktion: "wiki_zugewiesen" | "wiki_entfernt",
    objekt: BoxObjekt,
    vorher: ReadonlyMap<string, number>,
    nachher: ReadonlyMap<string, number>,
    wiki: { vorher: string | null; nachher: string | null },
    zusatz: Readonly<Record<string, { before?: unknown; after?: unknown }>> = {},
    stand?: { vorher: ReadonlyMap<string, AbschnittsStand>; nachher: ReadonlyMap<string, AbschnittsStand> },
): MapAuditEntry[] {
    return objekt.ids
        .filter((id) => vorher.has(id))
        .map((id) => ({
            action: `${anschluss.schreiber.protokollArt}.${aktion}` as MapAuditEntry["action"],
            ...anschluss.schreiber.eintragZiel(id),
            revisionBefore: vorher.get(id) ?? null,
            revisionAfter: nachher.get(id) ?? null,
            changes: {
                wiki: { before: wiki.vorher, after: wiki.nachher },
                ...zusatz,
                ...(stand === undefined
                    ? {}
                    : { wikiOrigin: { before: stand.vorher.get(id) ?? null, after: stand.nachher.get(id) ?? null } }),
            },
        }));
}

/**
 * Die Einträge des Fachprotokolls eines weiteren Artikels (WI-0300; seit WI-0302 schreibt sie nur noch die Rücknahme solcher Schritte): je Kennung ein Eintrag `<Protokollart>.wiki_weitere_zugewiesen` oder `.wiki_weitere_entfernt`; `wikiWeitere` trägt den Schlüssel des Artikels
 * (vorher `null` beim Hinzufügen, nachher `null` beim Lösen), `wikiWeitereOrigin` die Zeile des Abschnitts samt Herkunft (`null`, wo der Schritt an ihm nichts schrieb).
 */
export function weitereEintraege(
    anschluss: Pick<Anschluss, "schreiber">,
    aktion: "wiki_weitere_zugewiesen" | "wiki_weitere_entfernt",
    objekt: BoxObjekt,
    vorher: ReadonlyMap<string, number>,
    nachher: ReadonlyMap<string, number>,
    key: string,
    zeilen: ReadonlyMap<string, WeitereZeile>,
): MapAuditEntry[] {
    const hinzu = aktion === "wiki_weitere_zugewiesen";
    return objekt.ids
        .filter((id) => vorher.has(id))
        .map((id) => {
            const zeile = zeilen.get(id) ?? null;
            return {
                action: `${anschluss.schreiber.protokollArt}.${aktion}` as MapAuditEntry["action"],
                ...anschluss.schreiber.eintragZiel(id),
                revisionBefore: vorher.get(id) ?? null,
                revisionAfter: nachher.get(id) ?? null,
                changes: {
                    wikiWeitere: hinzu ? { before: null, after: key } : { before: key, after: null },
                    // Die Zeile des Abschnitts (Kennung und Herkunft), die der Schritt anlegte oder still legte: Die Rücknahme braucht genau sie. Neben `wikiWeitere` keine eigene Zeile im Verlauf.
                    wikiWeitereOrigin: hinzu ? { before: null, after: zeile } : { before: zeile, after: null },
                },
            };
        });
}

/** Das Protokoll der Herkunft einer Zuordnung (`zuordnung`, vor und nach dem Schreiben); leer, wo die Art keine führt (WI-0265 B8d). */
export function zuordnungsZusatz(
    anschluss: Pick<Anschluss, "herkunft">,
    vorher: Zuordnungsherkunft | null,
    nachher: Zuordnungsherkunft | null,
): Readonly<Record<string, { before?: unknown; after?: unknown }>> {
    return anschluss.herkunft === undefined ? {} : { zuordnung: { before: vorher, after: nachher } };
}
