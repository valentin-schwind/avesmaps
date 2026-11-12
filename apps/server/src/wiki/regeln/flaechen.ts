import {
    isLandscapeHandle,
    wikiLinkKey,
    type OperationReceipt,
    type WikisyncRegelFlaechen,
    type WikisyncRegelOffeneFlaeche,
} from "@avesmaps3d/shared";
import type { Sql } from "../../auth/session-store.ts";
import type { Queryable } from "../../database.ts";
import type { MapAuditEntry } from "../../editor/map-operation.ts";
import { ApiError } from "../../http/api-error.ts";
import { isMissingTable } from "../../system/state-row.ts";
import { legeX2Still, schreibeX2 } from "../objekt/anschluss.ts";
import { titelAusWikiAdresse } from "../vorschau/adresse.ts";

/**
 * Eine Fläche ohne Wiki-Schlüssel bekommt ihren Artikel (WI-0253 §25; Vali 2026-10-27: „bau im Regelfenster einen Knopf, der einer gleichnamigen Fläche ohne Wiki-Schlüssel den Schlüssel zuweist“).
 *
 * Eine Regel wartet (F4, „!“), wenn ihre Bedingung auf einen Artikel zeigt, den keine Fläche der Karte trägt. Die Ableitung nennt dann `kandidat`: eine Fläche GLEICHEN NAMENS ohne Wiki-Schlüssel – genannt, nie
 * angenommen (nie über den Namen raten). Hier entscheidet ein Mensch: Der Knopf weist dieser Fläche den Artikel zu (`region.wiki_url`, dazu `wiki_region_key`, wo der Wiki-Stand ihn kennt), und die nächste Ableitung
 * findet die Fläche über ihren Artikel.
 *
 * - **Der Server prüft alles selbst** (die Oberfläche ist nur der Weg dorthin): Die Fläche ist aktiv, hat KEINEN Schlüssel (nie ein vorhandener überschrieben), ihr Name ist (klein, getrimmt wie in der Ableitung)
 *   der Kandidat, und der Titel ist im Protokoll des jüngsten fertigen Laufs als offene Fläche mit genau diesem Kandidaten vermerkt. Kein anderer Eintrag der Karte trägt den Artikel schon.
 * - **Schutz vor dem Legacy-Zug:** Die Zuweisung schreibt die Tafel X2 (`wiki_key_assignment`, Art `landschaft`) mit der Herkunft `avesmaps3d`, wie die Wiki-Box. Der Import der Landschaften (I2,
 *   `migration/region-import.ts`) lässt `wiki_url` und `wiki_region_key` einer Region, deren X2-Zeile aktiv ist und nicht aus Legacy stammt, stehen; der X2-Import legt sie nie still (`protectedWhere`).
 * - **Rücknahme:** nur, wenn die jüngste Zuordnung der Fläche diese Zuweisung ist und der Artikel noch so dasteht. Der Schlüssel wird wieder leer, die X2-Zeile still gelegt (nie gelöscht).
 * - **Die Rücknahme der Rücknahme** (WI-0265 B8e2, das ↺ in „Änderungen“ an der Rücknahme): `stelleFlaecheZuweisungWiederHer` stellt dieselbe Zuweisung wieder her, mit demselben Artikel, demselben Schlüssel und derselben
 *   X2-Zeile (belebt, nie neu angelegt, wo es sie gibt). Streng wie die Rücknahme: nur, wenn die Rücknahme noch die jüngste Zuordnung der Fläche ist und die Fläche noch keinen Artikel hat; sonst 409 ohne Schreiben.
 * - Schreibklasse `map`, dieselbe Naht wie jede Änderung der Karte (`mapOperation`, Quelle `wikisync`), Fachprotokoll `region.wiki_zugewiesen` / `region.wiki_entfernt` mit dem Titel als `wiki`.
 */

type Zeile = Record<string, unknown>;

/** Die Operationen im Fachprotokoll (`map_operation.action`). */
export const OPERATION_ZUWEISEN = "wikisync.flaeche_zuweisen";
export const OPERATION_ZURUECK = "wikisync.flaeche_zuruecknehmen";
/** Die Zuweisung, die das ↺ an der Rücknahme wiederherstellt (B8e2): gilt in der Liste und im Regelfenster wie eine Zuweisung, hat aber eine eigene Operation, damit sie als Wiederherstellung kenntlich bleibt. */
export const OPERATION_WIEDER = "wikisync.flaeche_wiederherstellen";

const WIKI_ADRESSE = "https://de.wiki-aventurica.de/wiki/";
const text = (wert: unknown): string | null => (typeof wert === "string" && wert.trim() !== "" ? wert : null);
/** So vergleicht die Ableitung Namen und Titel (`lesen.ts`: getrimmt, klein). */
const norm = (wert: string): string => wert.replaceAll("_", " ").trim().toLowerCase();
const adresseAusTitel = (titel: string): string => `${WIKI_ADRESSE}${encodeURIComponent(titel.replaceAll(" ", "_"))}`;
const titelDerAdresse = (adresse: string | null): string | null => {
    const titel = titelAusWikiAdresse(adresse);
    return titel === null ? null : norm(titel);
};

// ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Das Protokoll des jüngsten Laufs
// ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

interface OffenerKandidat {
    titel: string;
    kandidat: string;
    vorschlaege: number;
}

/** Der jüngste fertige Lauf der Vorschau mit Protokoll der Regelvorschläge; `undefined`, solange keiner vorliegt (oder vor Migration 0248). */
export async function juengsterRegelLauf(db: Queryable): Promise<number | undefined> {
    try {
        const [lauf] = await db<{ id: number }[]>`
            SELECT l.id::int AS id FROM wikisync_lauf l JOIN wikisync_regel_lauf r ON r.lauf_id = l.id WHERE l.status = 'fertig' ORDER BY l.id DESC LIMIT 1
        `;
        return lauf?.id;
    } catch (error) {
        if (isMissingTable(error)) return undefined;
        throw error;
    }
}

/**
 * Die offenen Flächen mit Kandidat aus dem Protokoll des Laufs: je Titel und Kandidat die Zahl der Vorschläge, die auf sie warten. Nur die Bedingungen der Regeln (`bedingungen`), nicht die „bisherigen“.
 * Gelesen mit einem Pfad auf der Nutzlast, ohne die Vorschläge zu laden (rund 600 wartende, 1,6 MB je Lauf).
 */
async function offeneKandidaten(db: Queryable, lauf: number): Promise<OffenerKandidat[]> {
    const zeilen = await db<{ titel: string | null; kandidat: string | null; n: number }[]>`
        SELECT f->>'titel' AS titel, f->>'kandidat' AS kandidat, count(DISTINCT v.id)::int AS n
          FROM wikisync_regel_vorschlag v
         CROSS JOIN LATERAL jsonb_path_query(v.payload, '$.regeln[*].bedingungen[*].flaeche ? (@.offen == true && @.kandidat != null)') AS f
         WHERE v.lauf_id = ${lauf} AND v.wartet
         GROUP BY 1, 2
    `;
    return zeilen.flatMap((zeile) =>
        zeile.titel === null || zeile.kandidat === null || zeile.titel.trim() === "" || zeile.kandidat.trim() === ""
            ? []
            : [{ titel: zeile.titel, kandidat: zeile.kandidat, vorschlaege: zeile.n }],
    );
}

// ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Die Flächen der Karte
// ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

interface KartenFlaeche {
    kennung: string;
    name: string;
    /** Der Titel ihres Artikels (klein), `null` ohne Adresse. */
    titel: string | null;
    hatSchluessel: boolean;
    /** Ein Griff („Wald-925“) ist kein Name; so hält ihn auch die Ableitung aus dem Index (`laden.ts`). */
    griff: boolean;
}

/** Die Flächen der Karte wie die Ableitung sie sieht (aktiv, ohne die Klimabänder). */
async function ladeKartenFlaechen(db: Queryable): Promise<KartenFlaeche[]> {
    const zeilen = await db<Zeile[]>`
        SELECT public_id::text AS kennung, name, region_type, wiki_url, wiki_region_key
          FROM region WHERE is_active AND region_layer <> 'klima' ORDER BY id
    `;
    return zeilen.map((zeile) => {
        const name = String(zeile["name"] ?? "").trim();
        return {
            kennung: String(zeile["kennung"]),
            name,
            titel: titelDerAdresse(text(zeile["wiki_url"])),
            hatSchluessel: text(zeile["wiki_url"]) !== null || text(zeile["wiki_region_key"]) !== null,
            griff: isLandscapeHandle(name, String(zeile["region_type"] ?? "")),
        };
    });
}

/** Ist das ein Name, den die Ableitung als Kandidat führt (vier Zeichen, kein Griff)? */
const alsNameBrauchbar = (flaeche: KartenFlaeche): boolean => flaeche.name.length >= 4 && !flaeche.griff;

// ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Die Zuweisungen aus diesem Fenster (Fachprotokoll)
// ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

interface Zuordnung {
    /** Die jüngste Wiki-Zuordnung der Fläche im Fachprotokoll. */
    aktion: string;
    operation: string;
    /** Die Kennung dieser Operation (`map_operation.operation_id`). */
    operationId: string;
    am: Date | null;
    von: string | null;
    /** Der Titel, den die Zuweisung eintrug (`changes.wiki.after`). */
    titel: string | null;
}

/** Je Fläche die jüngste Wiki-Zuordnung (zugewiesen oder entfernt) aus dem Fachprotokoll, mit Zeit und Person. */
async function juengsteZuordnungen(db: Queryable, kennungen: readonly string[]): Promise<Map<string, Zuordnung>> {
    const ergebnis = new Map<string, Zuordnung>();
    if (kennungen.length === 0) return ergebnis;
    const zeilen = await db<Zeile[]>`
        SELECT DISTINCT ON (e.region_public_id) e.region_public_id::text AS kennung, e.action, o.action AS operation, o.operation_id::text AS operation_id, o.at,
               e.changes #>> '{wiki,after}' AS titel, COALESCE(p.display_name, o.actor_label) AS wer
          FROM map_audit_event e
          JOIN map_operation o ON o.operation_id = e.operation_id
          LEFT JOIN avesmaps_auth.person p ON p.id = o.actor_person_id
         WHERE e.region_public_id = ANY(${[...kennungen]}::uuid[]) AND e.action IN ('region.wiki_zugewiesen', 'region.wiki_entfernt')
         ORDER BY e.region_public_id, e.id DESC
    `;
    for (const zeile of zeilen) {
        ergebnis.set(String(zeile["kennung"]), {
            aktion: String(zeile["action"]),
            operation: String(zeile["operation"]),
            operationId: String(zeile["operation_id"]),
            am: zeile["at"] instanceof Date ? zeile["at"] : null,
            von: text(zeile["wer"]),
            titel: text(zeile["titel"]),
        });
    }
    return ergebnis;
}

/** Steht die Zuordnung der Fläche noch so da, wie dieses Fenster sie schrieb? */
const nochDieZuweisung = (zuordnung: Zuordnung | undefined, titelJetzt: string | null): boolean =>
    zuordnung !== undefined &&
    zuordnung.aktion === "region.wiki_zugewiesen" &&
    (zuordnung.operation === OPERATION_ZUWEISEN || zuordnung.operation === OPERATION_WIEDER) &&
    zuordnung.titel !== null &&
    titelJetzt !== null &&
    norm(zuordnung.titel) === titelJetzt;

// ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Lesen: die offenen Flächen mit Kandidat
// ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

const UEBERSICHT_MAX = 200;

/**
 * Die offenen Flächen, für die es eine Fläche gleichen Namens ohne Wiki-Schlüssel gibt (oder gab, seit der Lauf rechnete), mit dem Stand von jetzt. Die Karte entscheidet den Zustand, nicht das Protokoll:
 * Das Protokoll sagt nur, WELCHER Artikel und WELCHER Name zusammengehören und wie viele Vorschläge warten.
 */
export async function leseOffeneFlaechen(db: Queryable, jetzt: Date): Promise<WikisyncRegelFlaechen> {
    const lauf = await juengsterRegelLauf(db);
    if (lauf === undefined) return { jetzt: jetzt.toISOString(), lauf: null, flaechen: [] };
    const kandidaten = await offeneKandidaten(db, lauf);
    if (kandidaten.length === 0) return { jetzt: jetzt.toISOString(), lauf, flaechen: [] };
    const karte = await ladeKartenFlaechen(db);
    const nachName = new Map<string, KartenFlaeche[]>();
    for (const flaeche of karte) {
        if (!alsNameBrauchbar(flaeche)) continue;
        const schluessel = norm(flaeche.name);
        nachName.set(schluessel, [...(nachName.get(schluessel) ?? []), flaeche]);
    }
    // Zugewiesen: die Fläche gleichen Namens, die den Artikel jetzt trägt (die Zuweisung stammt vielleicht aus diesem Fenster).
    const tragende = kandidaten.flatMap((k) =>
        (nachName.get(norm(k.kandidat)) ?? []).filter((f) => f.titel === norm(k.titel)).map((f) => f.kennung),
    );
    const zuordnungen = await juengsteZuordnungen(db, [...new Set(tragende)]);
    const ergebnis: WikisyncRegelOffeneFlaeche[] = [];
    for (const k of kandidaten) {
        const gleichnamig = nachName.get(norm(k.kandidat)) ?? [];
        const traegtArtikel = gleichnamig.filter((f) => f.titel === norm(k.titel));
        const ohneSchluessel = gleichnamig.filter((f) => !f.hatSchluessel);
        if (traegtArtikel.length > 0) {
            // Ein anderer Name trägt den Artikel (oder dieser): Zugewiesen zeigen wir nur, was die Karte unter diesem Namen schon hat.
            const flaeche = traegtArtikel[0] as KartenFlaeche;
            const zuordnung = zuordnungen.get(flaeche.kennung);
            const zurueck = traegtArtikel.length === 1 && nochDieZuweisung(zuordnung, flaeche.titel);
            ergebnis.push({
                titel: k.titel,
                name: flaeche.name,
                kennung: flaeche.kennung,
                vorschlaege: k.vorschlaege,
                zustand: "zugewiesen",
                zuruecknehmbar: zurueck,
                zugewiesenAm: zurueck ? (zuordnung?.am?.toISOString() ?? null) : null,
                zugewiesenVon: zurueck ? (zuordnung?.von ?? null) : null,
            });
        } else if (ohneSchluessel.length === 1) {
            const flaeche = ohneSchluessel[0] as KartenFlaeche;
            ergebnis.push({
                titel: k.titel,
                name: flaeche.name,
                kennung: flaeche.kennung,
                vorschlaege: k.vorschlaege,
                zustand: "zuweisbar",
                zuruecknehmbar: false,
                zugewiesenAm: null,
                zugewiesenVon: null,
            });
        } else if (ohneSchluessel.length > 1) {
            ergebnis.push({
                titel: k.titel,
                name: (ohneSchluessel[0] as KartenFlaeche).name,
                kennung: null,
                vorschlaege: k.vorschlaege,
                zustand: "mehrdeutig",
                zuruecknehmbar: false,
                zugewiesenAm: null,
                zugewiesenVon: null,
            });
        }
    }
    ergebnis.sort((a, b) => b.vorschlaege - a.vorschlaege || a.name.localeCompare(b.name, "de"));
    return { jetzt: jetzt.toISOString(), lauf, flaechen: ergebnis.slice(0, UEBERSICHT_MAX) };
}

/** Wurde seit dem Ende des Laufs einer Landschaft ein Wiki-Artikel zugewiesen oder genommen (hier oder in der Wiki-Box)? Dann sind die offenen Flächen der Vorschläge nach einem älteren Stand gerechnet. */
export async function flaechenSeitLaufGeaendert(db: Queryable, beendetAm: Date | null): Promise<boolean> {
    if (beendetAm === null) return false;
    const [zeile] = await db<{ ja: boolean }[]>`
        SELECT EXISTS (
            SELECT 1 FROM map_operation o JOIN map_audit_event e ON e.operation_id = o.operation_id
             WHERE o.at > ${beendetAm} AND e.action IN ('region.wiki_zugewiesen', 'region.wiki_entfernt')
        ) AS ja
    `;
    return zeile?.ja === true;
}

// ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Schreiben: zuweisen und zurücknehmen (in der Transaktion von `mapOperation`)
// ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface FlaecheArbeit {
    receipt: Omit<OperationReceipt, "operationId" | "status" | "environment">;
    entries: MapAuditEntry[];
    summary: string;
    ableitung: false;
}

interface RegionZeile {
    id: string;
    name: string;
    region_layer: string;
    wiki_url: string | null;
    wiki_region_key: string | null;
    revision: number;
    is_active: boolean;
}

/** Sperrt die Fläche (wie jeder Schreibweg der Landschaften: `FOR NO KEY UPDATE`) und liest sie; `404`, wenn es sie nicht (mehr) gibt. */
async function sperreFlaeche(tx: Sql, kennung: string): Promise<RegionZeile> {
    const [region] = await tx<RegionZeile[]>`
        SELECT id::text AS id, name, region_layer, wiki_url, wiki_region_key, revision::int AS revision, is_active
          FROM region WHERE public_id = ${kennung}::uuid FOR NO KEY UPDATE
    `;
    if (region === undefined || !region.is_active)
        throw new ApiError(404, "flaeche_weg", "Diese Fläche gibt es nicht (mehr).", { flaeche: kennung });
    return region;
}

/** Die Fläche, den Titel und den Kandidaten des Protokolls zusammen: Sonst ist es kein Fall dieses Knopfs. */
async function pruefeKandidat(tx: Sql, region: RegionZeile, titel: string): Promise<void> {
    if (text(region.wiki_url) !== null || text(region.wiki_region_key) !== null) {
        throw new ApiError(
            409,
            "flaeche_hat_schluessel",
            "Diese Fläche hat schon einen Wiki-Artikel; er wird nie überschrieben.",
            { flaeche: region.name },
        );
    }
    const lauf = await juengsterRegelLauf(tx);
    if (lauf === undefined) {
        throw new ApiError(409, "kein_lauf", "Es liegt keine Ableitung der Regelvorschläge vor.");
    }
    const passt = (await offeneKandidaten(tx, lauf)).some(
        (k) => norm(k.titel) === norm(titel) && norm(k.kandidat) === norm(region.name),
    );
    if (region.region_layer === "klima" || !passt) {
        throw new ApiError(
            409,
            "kein_kandidat",
            "Die Ableitung nennt diese Fläche nicht als Fläche zu diesem Artikel; erst neu ableiten.",
            { flaeche: region.name, titel },
        );
    }
    const karte = await ladeKartenFlaechen(tx);
    // Heißen mehrere Flächen so und trägt keine einen Schlüssel, sagt kein Name, welche gemeint ist: Das entscheidet die Wiki-Box an der einzelnen Fläche.
    const gleichnamig = karte.filter(
        (f) => alsNameBrauchbar(f) && norm(f.name) === norm(region.name) && !f.hatSchluessel,
    );
    if (gleichnamig.length > 1) {
        throw new ApiError(
            409,
            "mehrdeutig",
            "Mehrere Flächen heißen so und haben keinen Wiki-Artikel; weise ihn in der Wiki-Box der gemeinten Fläche zu.",
            { flaeche: region.name, anzahl: gleichnamig.length },
        );
    }
    const vergeben = karte.find((f) => f.titel === norm(titel));
    if (vergeben !== undefined) {
        throw new ApiError(
            409,
            "titel_vergeben",
            "Diesen Wiki-Artikel trägt schon eine Fläche der Karte; erst neu ableiten.",
            { titel, flaeche: vergeben.name },
        );
    }
}

/**
 * Weist der Fläche `kennung` den Wiki-Artikel `titel` zu. Kennt der Wiki-Stand der Landschaften den Artikel (`wiki_region_snapshot`), gilt seine Adresse und sein Schlüssel (wie in der Wiki-Box); sonst folgt die
 * Adresse aus dem Titel, und der Schlüssel `wiki_region_key` bleibt leer (nichts wird geraten). Die Tafel X2 trägt die Zuweisung als Entscheidung des Editors, so schützt sie der Zug.
 */
export async function weiseFlaecheZu(tx: Sql, eingabe: { kennung: string; titel: string }): Promise<FlaecheArbeit> {
    const titel = eingabe.titel.replaceAll("_", " ").trim();
    const region = await sperreFlaeche(tx, eingabe.kennung);
    await pruefeKandidat(tx, region, titel);
    // Der Wiki-Stand, wenn er den Artikel kennt: seine Adresse und sein Schlüssel.
    const staende = await tx<{ wiki_key: string; wiki_url: string; name: string | null }[]>`
        SELECT wiki_key, wiki_url, name FROM wiki_region_snapshot WHERE is_active ORDER BY wiki_key
    `;
    const stand = staende.find((s) => titelDerAdresse(s.wiki_url) === norm(titel));
    const adresse = stand?.wiki_url ?? adresseAusTitel(titel);
    const schluessel = stand?.wiki_key ?? null;
    const [danach] = await tx<{ revision: number }[]>`
        UPDATE region SET wiki_url = ${adresse}, wiki_region_key = ${schluessel} WHERE id = ${region.id}::bigint RETURNING revision::int AS revision
    `;
    await schreibeX2(tx, "landschaft", [eingabe.kennung], {
        key: stand?.wiki_key ?? wikiLinkKey(adresse),
        url: adresse,
        name: stand?.name ?? titel,
    });
    return {
        receipt: {
            affected: [{ kind: "landscape", id: eingabe.kennung, revision: danach!.revision }],
            derivedWork: [],
            warnings:
                stand === undefined
                    ? [{ code: "kein_wiki_stand", message: "Der Artikel hat noch keinen Wiki-Stand." }]
                    : [],
        },
        entries: [
            {
                action: "region.wiki_zugewiesen",
                regionId: eingabe.kennung,
                revisionBefore: region.revision,
                revisionAfter: danach!.revision,
                changes: { wiki: { before: null, after: titel } },
            },
        ],
        summary: `Wiki-Artikel „${titel}“ zugewiesen (Regelvorschläge)`,
        ableitung: false,
    };
}

/**
 * Steht die Zuweisung `operationId` noch so da, dass sie sich zurücknehmen ließe (Vorprüfung des ↺ in „Änderungen“, WI-0265 B8e)? Nur lesend: dieselbe Entscheidung wie `nimmFlaecheZuweisungZurueck`.
 * `vorhanden`: Es gibt die Fläche noch (aktiv); sonst ist es ein „gelöscht“.
 */
export async function zuweisungSteht(
    db: Queryable,
    kennung: string,
    operationId: string,
): Promise<{ steht: boolean; vorhanden: boolean; name: string | null }> {
    const [region] = await db<{ name: string; wiki_url: string | null; is_active: boolean }[]>`
        SELECT name, wiki_url, is_active FROM region WHERE public_id = ${kennung}::uuid
    `;
    if (region === undefined || !region.is_active)
        return { steht: false, vorhanden: false, name: region?.name ?? null };
    const zuordnung = (await juengsteZuordnungen(db, [kennung])).get(kennung);
    return {
        steht:
            nochDieZuweisung(zuordnung, titelDerAdresse(text(region.wiki_url))) &&
            zuordnung?.operationId === operationId,
        vorhanden: true,
        name: region.name,
    };
}

/**
 * Nimmt die Zuweisung aus diesem Fenster zurück: nur, wenn die jüngste Wiki-Zuordnung der Fläche diese Zuweisung ist und der Artikel noch so dasteht (409 `nicht_zuruecknehmbar`). Der Schlüssel wird wieder
 * leer; die X2-Zeile wird still gelegt, nie gelöscht. Nennt der Aufruf die Operation der Zuweisung (das ↺ in „Änderungen“, WI-0265 B8e), muss es genau diese sein, nicht eine jüngere des Regelfensters.
 */
export async function nimmFlaecheZuweisungZurueck(
    tx: Sql,
    eingabe: { kennung: string; operationId?: string },
): Promise<FlaecheArbeit> {
    const region = await sperreFlaeche(tx, eingabe.kennung);
    const zuordnung = (await juengsteZuordnungen(tx, [eingabe.kennung])).get(eingabe.kennung);
    if (
        !nochDieZuweisung(zuordnung, titelDerAdresse(text(region.wiki_url))) ||
        (eingabe.operationId !== undefined && zuordnung?.operationId !== eingabe.operationId)
    ) {
        throw new ApiError(
            409,
            "nicht_zuruecknehmbar",
            "Die Zuordnung dieser Fläche ist seit der Zuweisung geändert oder stammt nicht aus diesem Fenster.",
            { flaeche: region.name },
        );
    }
    const [danach] = await tx<{ revision: number }[]>`
        UPDATE region SET wiki_url = NULL, wiki_region_key = NULL WHERE id = ${region.id}::bigint RETURNING revision::int AS revision
    `;
    await legeX2Still(tx, "landschaft", [eingabe.kennung]);
    return {
        receipt: {
            affected: [{ kind: "landscape", id: eingabe.kennung, revision: danach!.revision }],
            derivedWork: [],
            warnings: [],
        },
        entries: [
            {
                action: "region.wiki_entfernt",
                regionId: eingabe.kennung,
                revisionBefore: region.revision,
                revisionAfter: danach!.revision,
                changes: { wiki: { before: zuordnung?.titel ?? null, after: null } },
            },
        ],
        summary: `Wiki-Artikel „${zuordnung?.titel ?? ""}“ zurückgenommen (Regelvorschläge)`,
        ableitung: false,
    };
}

// ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Die Rücknahme der Rücknahme (WI-0265 B8e2)
// ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Lässt sich die Rücknahme `operationId` zurücknehmen, und mit welchem Artikel? Nur lesend und für Vorprüfung und Schreibweg dieselbe Entscheidung: Die Rücknahme ist die jüngste Wiki-Zuordnung der Fläche, die Fläche hat
 * (wieder) keinen Artikel und keinen Schlüssel, keine andere Fläche trägt den Artikel inzwischen, und die Zeile der Tafel X2 ist still (oder fehlt). Sonst `undefined`.
 */
async function pruefeWiederherstellung(
    db: Queryable,
    kennung: string,
    region: { wiki_url: string | null; wiki_region_key: string | null },
    operationId: string,
): Promise<{ titel: string } | undefined> {
    if (text(region.wiki_url) !== null || text(region.wiki_region_key) !== null) return undefined;
    const zuordnung = (await juengsteZuordnungen(db, [kennung])).get(kennung);
    if (
        zuordnung === undefined ||
        zuordnung.aktion !== "region.wiki_entfernt" ||
        zuordnung.operation !== OPERATION_ZURUECK ||
        zuordnung.operationId !== operationId
    )
        return undefined;
    // Der Artikel, den die Rücknahme entfernte, steht im Fachprotokoll ihres Eintrags (`wiki.before`).
    const [entfernt] = await db<{ titel: string | null }[]>`
        SELECT changes #>> '{wiki,before}' AS titel FROM map_audit_event
         WHERE operation_id = ${operationId}::uuid AND region_public_id = ${kennung}::uuid AND action = 'region.wiki_entfernt' LIMIT 1
    `;
    const titel = text(entfernt?.titel);
    if (titel === null) return undefined;
    if ((await ladeKartenFlaechen(db)).some((f) => f.kennung !== kennung && f.titel === norm(titel))) return undefined;
    const [x2] = await db<{ is_active: boolean }[]>`
        SELECT is_active FROM wiki_key_assignment WHERE legacy_art = 'landschaft' AND object_public_id = ${kennung}::uuid
    `;
    return x2?.is_active === true ? undefined : { titel };
}

/** Wie `zuweisungSteht`, für die Rücknahme: Lässt sich ihre Zuweisung wiederherstellen (Vorprüfung des ↺ in „Änderungen“, WI-0265 B8e2)? Nur lesend. */
export async function wiederherstellungSteht(
    db: Queryable,
    kennung: string,
    operationId: string,
): Promise<{ steht: boolean; vorhanden: boolean; name: string | null }> {
    const [region] = await db<
        { name: string; wiki_url: string | null; wiki_region_key: string | null; is_active: boolean }[]
    >`
        SELECT name, wiki_url, wiki_region_key, is_active FROM region WHERE public_id = ${kennung}::uuid
    `;
    if (region === undefined || !region.is_active)
        return { steht: false, vorhanden: false, name: region?.name ?? null };
    return {
        steht: (await pruefeWiederherstellung(db, kennung, region, operationId)) !== undefined,
        vorhanden: true,
        name: region.name,
    };
}

/**
 * Stellt die Zuweisung wieder her, die die Rücknahme `operationId` zurücknahm (das ↺ an der Rücknahme in „Änderungen“): derselbe Artikel, dieselbe Adresse, derselbe Schlüssel (der des Wiki-Stands, wo er den Artikel
 * kennt, sonst der, den die X2-Zeile trägt) und dieselbe X2-Zeile, belebt und nie neu angelegt, wo es sie gibt. Streng: Hat die Fläche seither eine andere Zuordnung bekommen (oder trägt eine andere Fläche den Artikel),
 * ist es 409 `nicht_wiederherstellbar`, und nichts wird geschrieben.
 */
export async function stelleFlaecheZuweisungWiederHer(
    tx: Sql,
    eingabe: { kennung: string; operationId: string },
): Promise<FlaecheArbeit> {
    const region = await sperreFlaeche(tx, eingabe.kennung);
    const wieder = await pruefeWiederherstellung(tx, eingabe.kennung, region, eingabe.operationId);
    if (wieder === undefined) {
        throw new ApiError(
            409,
            "nicht_wiederherstellbar",
            "Die Zuordnung dieser Fläche ist seit der Rücknahme geändert, oder der Artikel gehört jetzt einer anderen Fläche.",
            { flaeche: region.name },
        );
    }
    const titel = wieder.titel;
    const [x2] = await tx<{ wiki_key: string; wiki_url: string | null }[]>`
        SELECT wiki_key, wiki_url FROM wiki_key_assignment
         WHERE legacy_art = 'landschaft' AND object_public_id = ${eingabe.kennung}::uuid FOR UPDATE
    `;
    const staende = await tx<{ wiki_key: string; wiki_url: string; name: string | null }[]>`
        SELECT wiki_key, wiki_url, name FROM wiki_region_snapshot WHERE is_active ORDER BY wiki_key
    `;
    const stand = staende.find((s) => titelDerAdresse(s.wiki_url) === norm(titel));
    const adresse = text(x2?.wiki_url) ?? stand?.wiki_url ?? adresseAusTitel(titel);
    // Der Schlüssel der Fläche war der des Wiki-Stands oder leer. Die X2-Zeile trägt den des Stands (`wiki:<Schlüssel>`) oder den aus der Adresse: Weicht sie von diesem ab, war es der des Stands.
    const kanonisch = (schluessel: string): string =>
        schluessel.startsWith("wiki:") ? schluessel : `wiki:${schluessel}`;
    const schluessel =
        stand?.wiki_key ??
        (x2 !== undefined && x2.wiki_key !== kanonisch(wikiLinkKey(adresse))
            ? x2.wiki_key.replace(/^wiki:/u, "")
            : null);
    const [danach] = await tx<{ revision: number }[]>`
        UPDATE region SET wiki_url = ${adresse}, wiki_region_key = ${schluessel} WHERE id = ${region.id}::bigint RETURNING revision::int AS revision
    `;
    if (x2 !== undefined) {
        // Dieselbe Zeile, belebt: Schlüssel, Adresse und Name bleiben, wie sie waren.
        await tx`
            UPDATE wiki_key_assignment SET is_active = TRUE, retired_at = NULL, retired_origin = NULL, source_system = 'avesmaps3d', updated_at = now()
             WHERE legacy_art = 'landschaft' AND object_public_id = ${eingabe.kennung}::uuid
        `;
    } else {
        await schreibeX2(tx, "landschaft", [eingabe.kennung], {
            key: stand?.wiki_key ?? wikiLinkKey(adresse),
            url: adresse,
            name: stand?.name ?? titel,
        });
    }
    return {
        receipt: {
            affected: [{ kind: "landscape", id: eingabe.kennung, revision: danach!.revision }],
            derivedWork: [],
            warnings:
                stand === undefined
                    ? [{ code: "kein_wiki_stand", message: "Der Artikel hat noch keinen Wiki-Stand." }]
                    : [],
        },
        entries: [
            {
                action: "region.wiki_zugewiesen",
                regionId: eingabe.kennung,
                revisionBefore: region.revision,
                revisionAfter: danach!.revision,
                changes: { wiki: { before: null, after: titel } },
            },
        ],
        summary: `Wiki-Artikel „${titel}“ wiederhergestellt (Regelvorschläge)`,
        ableitung: false,
    };
}
