import { randomUUID } from "node:crypto";
import type { PendingQuery, Row } from "postgres";
import { AVENTURIA } from "@avesmaps3d/shared";
import type { Database, Queryable } from "../database.ts";
import { withZugSperre } from "../derive/derive-lock.ts";
import { createFinding, type Finding } from "../findings.ts";
import { alleSprachTrefferNeuRechnenLassen } from "../sprachen/treffer-auftrag.ts";
import { sprachSchluessel } from "../wiki/infobox/sprache.ts";
import { MigrationAborted } from "./places.ts";
import {
    farbeHex,
    HERKUNFT_SPRACHENKARTE,
    liesSprachenKarte,
    SPRACHEN_CONTRACT_VERSION,
    SPRACHEN_TAFEL,
    type SprachenKarte,
} from "./sprachen-karte.ts";

/**
 * Spielt die Sprachenkarte ein (WI-0261 S6; Setzungen T-1 bis T-4): die elf Einträge der Farbtafel (`sprache`), die Teilflächen der
 * abgeleiteten GeoJSON (`sprache_flaeche`), die Zuordnung der Wiki-Artikel (`sprache_wiki`) und danach der Auftrag, der die Treffer neu
 * rechnet. Alles in EINER Transaktion unter der Sperre der Kartendomäne, mit Journal (`migration_run`) und Bericht.
 *
 * - **Einträge (T-2):** fehlende werden angelegt, vorhandene NIE geändert (Farbe und Namen ändert danach nur der Spracheditor); der Bericht
 *   nennt, worin ein vorhandener von der Tafel abweicht.
 * - **Flächen (T-1):** Herkunft `sprachenkarte`, Revision der Quelle ist der SHA-256 der Datei. Die Datei zählt als eingespielt, wenn keine
 *   aktive Fläche dieser Herkunft eine andere Revision trägt und es Zeilen dieser Revision gibt; dann ändert der Lauf an den Flächen nichts
 *   (auch nicht, was die Redaktion an ihnen stillgelegt hat). Sonst werden die bisherigen aktiven Flächen der Herkunft still gelegt
 *   (`retired_origin = 'import'`) und die Teile der Datei neu angelegt, je Polygon eine Zeile. Flächen der Redaktion fasst der Import nie an.
 * - **Geometrie:** `ST_MakeValid`, nur Polygonteile. Eine Datei, die erst repariert werden muss, ist ein Befund; ein Teil, der nicht in die
 *   Kartendomäne passt (nicht speicherbar), ist ein technischer Abbruch vor jedem Schreiben.
 * - **Wiki:** Artikel aus `wiki_sprache_artikel` werden den Gruppen der Tafel zugeordnet, aber nur, wenn sie noch keiner aktiven Sprache
 *   gehören und die Redaktion die Zuordnung nicht gelöst hat. Ein fehlender Artikel ist ein Befund, kein Abbruch.
 * - **Auftrag:** Haben sich Flächen geändert, reiht der Lauf „alle Treffer neu rechnen“ ein (`alleSprachTrefferNeuRechnenLassen`).
 *
 * 🔴 Eine Kartendatenübernahme (Map Mutation Guard): nur mit dem Zuruf des Betreibers für genau diese Datenbank (`--operator-said` in
 * `sprachen-cli.ts`). Ohne ihn rollt der Lauf alles zurück, auch das Journal und den eingereihten Auftrag (`dryRun`).
 */

/** Wer den Auftrag der Treffer ausgelöst hat: eine opake Kennung, nie ein Name (ADR-0013). */
export const SPRACHEN_IMPORT_AKTEUR = "migrate:sprachen";

export interface ImportSprachenOptions {
    /** Vorgabe: die Domäne Aventurien. */
    mapDomainId?: string;
    /** Probelauf: rechnet in der Transaktion, nennt alles und rollt zurück, auch das Journal. */
    dryRun?: boolean;
    /** `job.actor_ref` des Auftrags der Treffer; Vorgabe `SPRACHEN_IMPORT_AKTEUR`. */
    actorRef?: string;
}

export interface FeldAbweichung {
    feld: string;
    vorhanden: string;
    tafel: string;
}

export interface EintragAbweichung {
    schluessel: string;
    felder: FeldAbweichung[];
}

export interface SpracheFlaechenzahlen {
    /** Teilflächen (Polygone) der Datei nach der Reparatur. */
    teile: number;
    /** Fläche in Karteneinheiten², auf eine Stelle gerundet. */
    flaecheE2: number;
    stuetzpunkte: number;
    loecher: number;
}

export interface SprachenImportBericht {
    runId: string;
    sourceRef: string;
    /** SHA-256 der Eingabedatei (`quelle_revision`). */
    quelleRevision: string;
    mapDomainId: string;
    /** Wahr, wenn alles zurückgerollt wurde: Die Zahlen sind die des Schreiblaufs, geschrieben ist nichts. */
    dryRun: boolean;
    eintraege: { angelegt: number; vorhanden: number; abweichend: EintragAbweichung[] };
    flaechen: {
        /** Aktive Flächen der Herkunft `sprachenkarte` vor dem Lauf. */
        bisherAktiv: number;
        /** Die Datei war schon eingespielt: an den Flächen ändert der Lauf nichts. */
        dateiSchonEingespielt: boolean;
        angelegt: number;
        stillgelegt: number;
        unveraendert: number;
        /** Aktive Flächen der Redaktion; der Import fasst sie nie an. */
        redaktionUnberuehrt: number;
        /** Stützpunkte aller Teile der Datei (nach der Reparatur), auch wenn nichts geschrieben wird. */
        stuetzpunkte: number;
        jeSprache: Record<string, SpracheFlaechenzahlen>;
    };
    wiki: {
        /** Gibt es aktive Artikel im Wiki-Stand? Ohne (WikiSync noch nicht gelaufen) ordnet der Import nichts zu. */
        stand: boolean;
        aktiveArtikel: number;
        angelegt: number;
        vorhanden: number;
        /** Artikel, die schon einer anderen aktiven Sprache gehören (`Titel -> Schlüssel`). */
        anderswo: string[];
        /** Artikel, deren Zuordnung die Redaktion gelöst hat. */
        vonRedaktionGeloest: number;
        /** Titel der Tafel, die im Wiki-Stand fehlen. */
        fehlend: string[];
    };
    auftrag: { eingereiht: boolean; jobId: string | null };
    changed: boolean;
    findings: Finding[];
}

class DryRunRollback extends Error {}

interface SpracheZeile {
    id: string;
    name: string;
    legende: string | null;
    farbe: string;
    reihenfolge: number;
    herkunft: string;
    is_active: boolean;
}

interface TeilZeile {
    flaeche: number;
    stuetzpunkte: number;
    loecher: number;
    im_rahmen: boolean;
}

/**
 * Die Teile eines Features als Zeilen: Polygone der reparierten Geometrie, in der Reihenfolge der Datei. Derselbe Ausdruck wird geprüft
 * und geschrieben, damit beides dieselben Teile meint.
 */
function teileVon(tx: Queryable, geometrie: string): PendingQuery<Row[]> {
    return tx`
        ST_Dump(ST_CollectionExtract(ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(${geometrie}), 0)), 3))
    `;
}

export async function importSprachen(
    database: Database,
    bytes: Uint8Array,
    options: ImportSprachenOptions = {},
): Promise<SprachenImportBericht> {
    // Gelesen und geprüft wird vor jeder Verbindung und vor der Sperre: eine unbrauchbare Datei kostet nichts.
    const karte = liesSprachenKarte(bytes);
    return withZugSperre(database, options.mapDomainId ?? AVENTURIA.mapDomain, "Sprachenkarte", () =>
        importSprachenGesperrt(database, karte, options),
    );
}

async function importSprachenGesperrt(
    database: Database,
    karte: SprachenKarte,
    options: ImportSprachenOptions,
): Promise<SprachenImportBericht> {
    const mapDomainId = options.mapDomainId ?? AVENTURIA.mapDomain;
    const runId = randomUUID();
    const sourceRef = `sprachen-s1.geojson; sha256=${karte.sha256}`;
    const bericht: SprachenImportBericht = {
        runId,
        sourceRef,
        quelleRevision: karte.sha256,
        mapDomainId,
        dryRun: options.dryRun === true,
        eintraege: { angelegt: 0, vorhanden: 0, abweichend: [] },
        flaechen: {
            bisherAktiv: 0,
            dateiSchonEingespielt: false,
            angelegt: 0,
            stillgelegt: 0,
            unveraendert: 0,
            redaktionUnberuehrt: 0,
            stuetzpunkte: 0,
            jeSprache: {},
        },
        wiki: {
            stand: false,
            aktiveArtikel: 0,
            angelegt: 0,
            vorhanden: 0,
            anderswo: [],
            vonRedaktionGeloest: 0,
            fehlend: [],
        },
        auftrag: { eingereiht: false, jobId: null },
        changed: false,
        findings: [...karte.findings],
    };
    try {
        await database.begin(async (tx) => {
            const [domaene] = await tx<{ id: string }[]>`SELECT id FROM map_domain WHERE id = ${mapDomainId}`;
            if (domaene === undefined) {
                throw new MigrationAborted(`Die Kartendomäne ${mapDomainId} gibt es nicht`, { mapDomainId });
            }
            // Zuerst nur lesen: Passt jeder Teil der Datei in die Domäne? Ein Abbruch kommt hier, vor dem ersten Schreiben.
            await pruefeGeometrien(tx, karte, mapDomainId, bericht);
            await tx`
                INSERT INTO migration_run (id, data_domain, source_system, source_ref, contract_version)
                VALUES (${runId}, 'sprachen', 'sprachenkarte', ${sourceRef}, ${SPRACHEN_CONTRACT_VERSION})
            `;
            const sprachIds = await spieleEintraegeEin(tx, bericht);
            await spieleFlaechenEin(tx, karte, mapDomainId, sprachIds, bericht);
            await ordneWikiArtikelZu(tx, sprachIds, bericht);
            if (bericht.flaechen.angelegt + bericht.flaechen.stillgelegt > 0) {
                const jobId = await alleSprachTrefferNeuRechnenLassen(
                    tx,
                    options.actorRef ?? SPRACHEN_IMPORT_AKTEUR,
                    mapDomainId,
                );
                bericht.auftrag = { eingereiht: true, jobId };
            }
            bericht.changed =
                bericht.eintraege.angelegt +
                    bericht.flaechen.angelegt +
                    bericht.flaechen.stillgelegt +
                    bericht.wiki.angelegt >
                0;
            await tx`
                UPDATE migration_run
                   SET completed_at = now(), status = 'completed', journal = ${
                       {
                           quelle_revision: bericht.quelleRevision,
                           eintraege: { angelegt: bericht.eintraege.angelegt, vorhanden: bericht.eintraege.vorhanden },
                           flaechen: { ...bericht.flaechen, jeSprache: undefined },
                           wiki: bericht.wiki,
                           auftrag: bericht.auftrag,
                           dry_run: bericht.dryRun,
                           findings: bericht.findings.map((befund) => befund.code),
                       } as unknown as string
                   }
                 WHERE id = ${runId}
            `;
            if (options.dryRun === true) throw new DryRunRollback();
        });
    } catch (error) {
        if (!(error instanceof DryRunRollback)) throw error;
    }
    return bericht;
}

/**
 * Liest je Feature die Teile der reparierten Geometrie: Zahlen für den Bericht und die Frage, ob jeder Teil in die Domäne passt
 * (`sprache_flaeche_inside_domain`). Ein Teil außerhalb ist nicht speicherbar: technischer Abbruch. Eine Geometrie, die erst repariert
 * werden musste, ist ein Befund.
 */
async function pruefeGeometrien(
    tx: Queryable,
    karte: SprachenKarte,
    mapDomainId: string,
    bericht: SprachenImportBericht,
): Promise<void> {
    const repariert: string[] = [];
    for (const merkmal of karte.merkmale) {
        let teile: TeilZeile[];
        try {
            const [gueltig] = await tx<{ gueltig: boolean; grund: string }[]>`
                SELECT ST_IsValid(g) AS gueltig, ST_IsValidReason(g) AS grund
                  FROM (SELECT ST_SetSRID(ST_GeomFromGeoJSON(${merkmal.geometrie}), 0) AS g) x
            `;
            if (gueltig?.gueltig === false) repariert.push(`${merkmal.schluessel}: ${gueltig.grund}`);
            teile = await tx<TeilZeile[]>`
                SELECT ST_Area(d.geom)::float8 AS flaeche, ST_NPoints(d.geom)::int AS stuetzpunkte,
                       ST_NumInteriorRings(d.geom)::int AS loecher, map_domain_contains(${mapDomainId}, d.geom) AS im_rahmen
                  FROM ${teileVon(tx, merkmal.geometrie)} d
                 ORDER BY d.path
            `;
        } catch (error) {
            if (error instanceof MigrationAborted) throw error;
            throw new MigrationAborted(`Die Geometrie von „${merkmal.schluessel}“ lässt sich nicht lesen`, {
                schluessel: merkmal.schluessel,
                fehler: error instanceof Error ? error.message : String(error),
            });
        }
        const draussen = teile.flatMap((teil, nr) => (teil.im_rahmen ? [] : [nr + 1]));
        if (draussen.length > 0) {
            throw new MigrationAborted(
                `Teile der Sprache „${merkmal.schluessel}“ liegen außerhalb der Kartendomäne ${mapDomainId} und lassen sich nicht speichern`,
                { schluessel: merkmal.schluessel, teile: draussen.join(", "), kartendomaene: mapDomainId },
            );
        }
        const zahlen: SpracheFlaechenzahlen = { teile: teile.length, flaecheE2: 0, stuetzpunkte: 0, loecher: 0 };
        for (const teil of teile) {
            zahlen.flaecheE2 += teil.flaeche;
            zahlen.stuetzpunkte += teil.stuetzpunkte;
            zahlen.loecher += teil.loecher;
        }
        zahlen.flaecheE2 = Math.round(zahlen.flaecheE2 * 10) / 10;
        bericht.flaechen.jeSprache[merkmal.schluessel] = zahlen;
        bericht.flaechen.stuetzpunkte += zahlen.stuetzpunkte;
    }
    if (repariert.length > 0) {
        bericht.findings.push(
            createFinding(
                "geometrie_repariert",
                "Die Datei enthält ungültige Geometrien; eingespielt wird die Reparatur mit ST_MakeValid (nur Polygonteile)",
                { sprachen: repariert.length },
                [],
                0,
                repariert,
            ),
        );
    }
}

/** T-2: fehlende Einträge anlegen, vorhandene nie ändern. Gibt Schlüssel -> `sprache.id` für alle Sprachen der Tafel zurück. */
async function spieleEintraegeEin(tx: Queryable, bericht: SprachenImportBericht): Promise<Map<string, string>> {
    const ids = new Map<string, string>();
    const abweichend: string[] = [];
    const stillgelegt: string[] = [];
    for (const [reihenfolge, tafel] of SPRACHEN_TAFEL.entries()) {
        const farbe = farbeHex(tafel.rgb);
        const [vorhanden] = await tx<SpracheZeile[]>`
            SELECT id::text, name, legende, farbe, reihenfolge, herkunft, is_active FROM sprache WHERE schluessel = ${tafel.schluessel}
        `;
        if (vorhanden === undefined) {
            const [neu] = await tx<{ id: string }[]>`
                INSERT INTO sprache (schluessel, name, legende, farbe, reihenfolge, herkunft)
                VALUES (${tafel.schluessel}, ${tafel.name}, ${tafel.legende}, ${farbe}, ${reihenfolge}, ${HERKUNFT_SPRACHENKARTE})
                RETURNING id::text
            `;
            ids.set(tafel.schluessel, neu!.id);
            bericht.eintraege.angelegt += 1;
            continue;
        }
        ids.set(tafel.schluessel, vorhanden.id);
        const felder: FeldAbweichung[] = [];
        const vergleiche: [string, string | number | null, string | number][] = [
            ["name", vorhanden.name, tafel.name],
            ["legende", vorhanden.legende, tafel.legende],
            ["farbe", vorhanden.farbe, farbe],
            ["reihenfolge", vorhanden.reihenfolge, reihenfolge],
        ];
        for (const [feld, istWert, tafelWert] of vergleiche) {
            if (istWert !== tafelWert) felder.push({ feld, vorhanden: String(istWert), tafel: String(tafelWert) });
        }
        if (felder.length === 0) {
            bericht.eintraege.vorhanden += 1;
        } else {
            bericht.eintraege.abweichend.push({ schluessel: tafel.schluessel, felder });
            abweichend.push(
                `${tafel.schluessel}: ${felder.map((feld) => `${feld.feld} ${feld.vorhanden} statt ${feld.tafel}`).join(", ")}`,
            );
        }
        if (!vorhanden.is_active) stillgelegt.push(tafel.schluessel);
    }
    if (abweichend.length > 0) {
        bericht.findings.push(
            createFinding(
                "eintrag_weicht_von_tafel_ab",
                "Vorhandene Einträge weichen von der Farbtafel ab; sie bleiben unverändert (T-2: Farbe und Namen ändert der Spracheditor)",
                { eintraege: abweichend.length },
                [],
                0,
                abweichend,
            ),
        );
    }
    if (stillgelegt.length > 0) {
        bericht.findings.push(
            createFinding(
                "eintrag_stillgelegt",
                "Diese Sprachen sind stillgelegt; der Import belebt sie nicht, ihre Flächen erscheinen erst wieder mit ihnen",
                { eintraege: stillgelegt.length },
                [],
                0,
                [stillgelegt.join(", ")],
            ),
        );
    }
    return ids;
}

/** T-1: Flächen der Herkunft `sprachenkarte` idempotent einspielen; Flächen der Redaktion bleiben unberührt. */
async function spieleFlaechenEin(
    tx: Queryable,
    karte: SprachenKarte,
    mapDomainId: string,
    sprachIds: ReadonlyMap<string, string>,
    bericht: SprachenImportBericht,
): Promise<void> {
    const [stand] = await tx<{ aktiv: number; fremd_aktiv: number; eigene: number; redaktion_aktiv: number }[]>`
        SELECT count(*) FILTER (WHERE herkunft = ${HERKUNFT_SPRACHENKARTE} AND is_active)::int AS aktiv,
               count(*) FILTER (WHERE herkunft = ${HERKUNFT_SPRACHENKARTE} AND is_active AND quelle_revision <> ${karte.sha256})::int AS fremd_aktiv,
               count(*) FILTER (WHERE herkunft = ${HERKUNFT_SPRACHENKARTE} AND quelle_revision = ${karte.sha256})::int AS eigene,
               count(*) FILTER (WHERE herkunft = 'redaktion' AND is_active)::int AS redaktion_aktiv
          FROM sprache_flaeche
         WHERE map_domain_id = ${mapDomainId}
    `;
    bericht.flaechen.bisherAktiv = stand!.aktiv;
    bericht.flaechen.redaktionUnberuehrt = stand!.redaktion_aktiv;
    if (stand!.fremd_aktiv === 0 && stand!.eigene > 0) {
        bericht.flaechen.dateiSchonEingespielt = true;
        bericht.flaechen.unveraendert = stand!.aktiv;
        return;
    }
    const still = await tx<{ id: string }[]>`
        UPDATE sprache_flaeche
           SET is_active = FALSE, retired_at = now(), retired_origin = 'import'
         WHERE map_domain_id = ${mapDomainId} AND herkunft = ${HERKUNFT_SPRACHENKARTE} AND is_active
        RETURNING id::text
    `;
    bericht.flaechen.stillgelegt = still.length;
    for (const merkmal of karte.merkmale) {
        const neu = await tx<{ id: string }[]>`
            INSERT INTO sprache_flaeche (sprache_id, map_domain_id, geom, herkunft, quelle_revision)
            SELECT ${sprachIds.get(merkmal.schluessel)!}::bigint, ${mapDomainId}::text, d.geom, ${HERKUNFT_SPRACHENKARTE}::text,
                   ${karte.sha256}::text
              FROM ${teileVon(tx, merkmal.geometrie)} d
             ORDER BY d.path
            RETURNING id::text
        `;
        bericht.flaechen.angelegt += neu.length;
    }
}

/**
 * Die Wiki-Artikel den Gruppen zuordnen (Herkunft `import`, Stelle in der Reihenfolge der Tafel). Nur ein Artikel, der noch keiner
 * aktiven Sprache gehört und dessen Zuordnung die Redaktion nicht gelöst hat. Ohne Wiki-Stand nur ein Hinweis.
 */
async function ordneWikiArtikelZu(
    tx: Queryable,
    sprachIds: ReadonlyMap<string, string>,
    bericht: SprachenImportBericht,
): Promise<void> {
    const artikel = await tx<{ id: string; schluessel: string }[]>`
        SELECT id::text, schluessel FROM wiki_sprache_artikel WHERE is_active
    `;
    bericht.wiki.aktiveArtikel = artikel.length;
    if (artikel.length === 0) {
        bericht.findings.push(
            createFinding(
                "wiki_ohne_stand",
                "Es gibt keinen Wiki-Stand der Sprachartikel (WikiSync, Bereich sprachen, ist noch nicht gelaufen); der Import ordnet keine Artikel zu",
                {},
            ),
        );
        return;
    }
    bericht.wiki.stand = true;
    const nachSchluessel = new Map(artikel.map((zeile) => [zeile.schluessel, zeile.id]));
    const sprachen = await tx<{ id: string; schluessel: string; is_active: boolean }[]>`
        SELECT id::text, schluessel, is_active FROM sprache
    `;
    const schluesselVon = new Map(sprachen.map((zeile) => [zeile.id, zeile.schluessel]));
    // Eine von der Redaktion stillgelegte Sprache bekommt keine Artikel: Sie stehen ihr nicht zu, solange sie nicht zurückgeholt ist
    // (der Bericht nennt sie im Befund `eintrag_stillgelegt`).
    const aktiveSprachen = new Set(sprachen.filter((zeile) => zeile.is_active).map((zeile) => zeile.id));
    const zuordnungen = await tx<
        {
            sprache_id: string;
            artikel_id: string;
            position: number;
            is_active: boolean;
            retired_origin: string | null;
        }[]
    >`
        SELECT sprache_id::text, wiki_sprache_artikel_id::text AS artikel_id, position, is_active, retired_origin FROM sprache_wiki
    `;
    const aktivJeArtikel = new Map<string, string>();
    const vonRedaktionGeloest = new Set<string>();
    const naechsteStelle = new Map<string, number>();
    for (const zeile of zuordnungen) {
        if (zeile.is_active) {
            aktivJeArtikel.set(zeile.artikel_id, zeile.sprache_id);
            naechsteStelle.set(
                zeile.sprache_id,
                Math.max(naechsteStelle.get(zeile.sprache_id) ?? 0, zeile.position + 1),
            );
        } else if (zeile.retired_origin === "editor") {
            vonRedaktionGeloest.add(zeile.artikel_id);
        }
    }
    for (const tafel of SPRACHEN_TAFEL) {
        const spracheId = sprachIds.get(tafel.schluessel)!;
        if (!aktiveSprachen.has(spracheId)) continue;
        for (const titel of tafel.wikiArtikel) {
            const artikelId = nachSchluessel.get(sprachSchluessel(titel));
            if (artikelId === undefined) {
                bericht.wiki.fehlend.push(titel);
                continue;
            }
            const besitzer = aktivJeArtikel.get(artikelId);
            if (besitzer === spracheId) {
                bericht.wiki.vorhanden += 1;
            } else if (besitzer !== undefined) {
                bericht.wiki.anderswo.push(`${titel} -> ${schluesselVon.get(besitzer) ?? besitzer}`);
            } else if (vonRedaktionGeloest.has(artikelId)) {
                bericht.wiki.vonRedaktionGeloest += 1;
            } else {
                const stelle = naechsteStelle.get(spracheId) ?? 0;
                await tx`
                    INSERT INTO sprache_wiki (sprache_id, wiki_sprache_artikel_id, position, herkunft)
                    VALUES (${spracheId}, ${artikelId}, ${stelle}, 'import')
                `;
                naechsteStelle.set(spracheId, stelle + 1);
                aktivJeArtikel.set(artikelId, spracheId);
                bericht.wiki.angelegt += 1;
            }
        }
    }
    if (bericht.wiki.fehlend.length > 0) {
        bericht.findings.push(
            createFinding(
                "wiki_artikel_fehlt",
                "Diese Artikel der Tafel stehen nicht im Wiki-Stand der Sprachartikel und bleiben unzugeordnet",
                { artikel: bericht.wiki.fehlend.length },
                [],
                0,
                [bericht.wiki.fehlend.join(", ")],
            ),
        );
    }
    if (bericht.wiki.anderswo.length > 0) {
        bericht.findings.push(
            createFinding(
                "wiki_zuordnung_anderswo",
                "Diese Artikel gehören schon einer anderen aktiven Sprache und bleiben dort",
                { artikel: bericht.wiki.anderswo.length },
                [],
                0,
                bericht.wiki.anderswo,
            ),
        );
    }
    if (bericht.wiki.vonRedaktionGeloest > 0) {
        bericht.findings.push(
            createFinding(
                "wiki_zuordnung_von_redaktion_geloest",
                "Die Redaktion hat diese Zuordnungen gelöst; der Import setzt sie nicht wieder",
                { artikel: bericht.wiki.vonRedaktionGeloest },
            ),
        );
    }
}
