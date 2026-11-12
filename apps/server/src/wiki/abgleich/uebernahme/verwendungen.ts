import type { InhalteTraegerArt } from "@avesmaps3d/shared";
import type { Sql } from "../../../auth/session-store.ts";
import type { Queryable } from "../../../database.ts";
import type { MapAuditEntry, MapChange } from "../../../editor/map-operation.ts";
import { aktualisiereKanon, type BeruehrteTraeger } from "../../../inhalte/kanon-folgen.ts";
import { vorgabeVon } from "../../../inhalte/korpora-vorgabe.ts";
import { TRAEGER } from "../../../inhalte/traeger.ts";
import { corpusKeyOfUrl } from "../../../migration/subject-details.ts";
import type { PlanObjekt } from "../plan.ts";
import {
    gleicheWerte,
    istKatalogFeld,
    istVerwendungsFeld,
    leseKatalogWert,
    leseQuellenWert,
    quellenWert,
    verwendungAusFeld,
    type KatalogAngaben,
    type QuellenVerknuepfung,
    type QuellenWert,
} from "../quellen.ts";
import { adresseTrifftArtikel } from "./entscheiden.ts";
import type { VorschauZeile } from "./protokoll.ts";
import type { BefundSchritt, ListenErgebnis, ListenSchreiber } from "./schreiber.ts";

/**
 * Die Übernahme und Rücknahme der Verwendungen einer Quelle (WI-0253, Scheibe Quellen): die Zeilen `verwendung_<Art>_<Träger>` einer Vorschau in `<träger>_source`, dazu die Zeile `katalog_neu`,
 * die eine fehlende Katalogquelle anlegt. Die Vorschau entscheidet in `../quellen.ts`; hier wird jede Zeile unter der Sperre der Quelle noch einmal gegen den Stand von jetzt geprüft und
 * dann geschrieben.
 *
 * - **Geprüft wird, was die Vorschau sah:** Der Träger hängt noch am Artikel der Zeile; eine Verknüpfung, die geändert oder still gelegt werden soll, ist noch aktiv, gehört noch dem Wiki
 *   (`legacy_origin = 'wiki_publication'`, nicht von der Redaktion angelegt oder geändert) und steht noch so da (Art, Seiten, Notiz); eine, die angelegt werden soll, gibt es noch nicht (oder
 *   der WikiSync hat sie selbst still gelegt: Dann lebt sie wieder auf). Sonst schreibt die Übernahme nichts und sagt `seit_vorschau_geaendert`.
 * - **Vier Arten von Schritten** (Vali 2026-10-27, WI-0253 §21): `aendern` (Art, Seiten, Notiz einer bestehenden Verknüpfung), `anlegen` (eine neue Verknüpfung oder die Wiederbelebung einer, die der
 *   WikiSync still legte, mit `legacy_origin = 'wiki_publication'` und `source_system = 'wikisync'`), `stilllegen` (`state = 'retired'`, `retired_origin = 'wikisync'`; nie gelöscht, nie die einer
 *   Redaktion, nie ein Tombstone) und `katalog` (die Quelle selbst, wenn der Katalog sie nicht hat: Schlüssel, Titel, Art, „offiziell“ und Adresse wie Legacy, Lizenz und Namensnennung des Korpus wie
 *   der Editor der Quellen). Nichts lebt wieder auf, was die Redaktion, der Legacy-Zug oder ein Tombstone entfernt hat.
 * - **Das Fachprotokoll** trägt wie beim Editor `links` mit vorher und nachher je Verwendung (`{ kind, carrierId, state, referenceKind, pages, note }`; `state: "none"` vor einer neuen); eine neue
 *   Quelle trägt dazu `created`. Daraus nimmt die Rücknahme zurück: angelegt wird still gelegt, still Gelegtes lebt wieder auf, eine angelegte Quelle ohne aktive Verknüpfung wird still gelegt.
 * - **Das Etikett der Träger** (Kanon, Rang 1 bis 3) wird für die berührten Träger neu gerechnet (`inhalte/kanon-folgen.ts`, §3a: Zuweisung → Publikationszeilen → Kanon), in derselben Transaktion; eine Änderung
 *   nur an Art, Seiten und Notiz ändert es nicht.
 */

/** Ein Träger, an dem eine Verknüpfung entsteht. */
export interface TraegerBezug {
    art: InhalteTraegerArt;
    id: string;
    name: string;
}

/** Ein Schritt an den Verwendungen einer Quelle. */
export type VerwendungsSchritt =
    | { art: "aendern"; objekt: PlanObjekt; verwendung: QuellenVerknuepfung; vorher: QuellenWert; nachher: QuellenWert }
    | {
          art: "anlegen";
          objekt: PlanObjekt;
          traeger: TraegerBezug;
          nachher: QuellenWert;
          /** Der WikiSync hat die Verknüpfung selbst still gelegt: Sie lebt wieder auf. */
          wiederbeleben: boolean;
          /** Der WikiSync hat die Quelle selbst still gelegt: Sie lebt mit der Verknüpfung wieder auf. */
          quelleBeleben: boolean;
      }
    | { art: "stilllegen"; objekt: PlanObjekt; verwendung: QuellenVerknuepfung; vorher: QuellenWert }
    | {
          art: "katalog";
          /** Ein Platzhalter-Objekt: Die Quelle gibt es noch nicht, ihre Kennung ist die Platzhalter-Kennung der Zeilen. */
          objekt: PlanObjekt;
          angaben: KatalogAngaben;
          links: { traeger: TraegerBezug; nachher: QuellenWert }[];
      };

/** Eine Verwendung im Fachprotokoll (`state: "none"` vor einer neuen). */
interface VerwendungsProtokoll {
    kind: InhalteTraegerArt;
    carrierId: string;
    state: string;
    referenceKind: string | null;
    pages: string | null;
    note: string | null;
}

const protokoll = (
    art: InhalteTraegerArt,
    traegerId: string,
    wert: QuellenWert,
    zustand: "none" | "active" | "retired",
): VerwendungsProtokoll => ({
    kind: art,
    carrierId: traegerId,
    state: zustand,
    referenceKind: wert.art,
    pages: wert.seiten,
    note: wert.notiz,
});

const KEIN_WERT: QuellenWert = { art: null, seiten: null, notiz: null };

/** Ein Objekt für eine Quelle, die es noch nicht gibt: nur Name und Kennung zählen, damit die Schritte ein Objekt tragen. */
function platzhalterObjekt(id: string, titel: string): PlanObjekt {
    return {
        bereich: "quelle",
        objektArt: "source",
        id,
        name: titel,
        adresse: null,
        zustand: "zugewiesen",
        herkunft: null,
        hauptzuweisung: true,
        lokal: new Map(),
        schnappschuss: new Map(),
        schnappschussUnbekannt: new Set(),
    };
}

/**
 * Entscheidet die Zeilen der Verwendungen gegen den Stand von jetzt (REIN). Nur Zeilen, die die Vorschau übernehmen wollte (Eigentümer `wiki`, Wirkung `uebernommen`), werden Schritte; alle
 * anderen hat sie schon als Befund oder eigenen Wert gezeigt.
 */
export function entscheideVerwendungen(
    zeilen: readonly VorschauZeile[],
    objekte: ReadonlyMap<string, PlanObjekt>,
): ListenErgebnis<VerwendungsSchritt> {
    const ergebnis: ListenErgebnis<VerwendungsSchritt> = { schritte: [], befunde: [], schonGleich: 0 };
    const quelleNachSchluessel = new Map<string, PlanObjekt>();
    for (const objekt of objekte.values())
        if (objekt.quelle?.art === "quelle") quelleNachSchluessel.set(objekt.quelle.schluessel, objekt);

    // Die Zeilen, die eine fehlende Quelle anlegen: Platzhalter-Kennung → ihre Angaben.
    const katalogZeilen = new Map<string, { angaben: KatalogAngaben; zeile: VorschauZeile }>();
    for (const zeile of zeilen) {
        if (!istKatalogFeld(zeile.feld) || zeile.eigentuemer !== "wiki" || zeile.wirkung !== "uebernommen") continue;
        const id = zeile.objektIds[0] ?? zeile.objektId;
        const angaben = leseKatalogWert(zeile.neu, zeile.objektName ?? "");
        if (id !== null && id !== undefined && angaben !== null && angaben.titel !== "")
            katalogZeilen.set(id, { angaben, zeile });
    }
    const katalogSchritte = new Map<string, Extract<VerwendungsSchritt, { art: "katalog" }>>();

    for (const zeile of zeilen) {
        const traeger = verwendungAusFeld(zeile.feld);
        if (traeger === null || zeile.eigentuemer !== "wiki" || zeile.wirkung !== "uebernommen") continue;
        const id = zeile.objektIds[0] ?? zeile.objektId;
        const neu = leseQuellenWert(zeile.neu);
        const alt = leseQuellenWert(zeile.alt);
        if (id === null || id === undefined) continue;
        // Aendern: beides da. Anlegen: nur der Wiki-Wert. Stilllegen: nur der Istwert. Alles andere hat die Vorschau nicht als Übernahme gemeint.
        const art =
            zeile.alt !== null && zeile.neu !== null
                ? "aendern"
                : zeile.alt === null && zeile.neu !== null
                  ? "anlegen"
                  : zeile.alt !== null && zeile.neu === null
                    ? "stilllegen"
                    : null;
        if (art === null || (art !== "stilllegen" && neu === null) || (art !== "anlegen" && alt === null)) continue;
        const befund = (grund: string, name: string | null = zeile.objektName): void => {
            ergebnis.befunde.push({
                objektId: id,
                objektArt: zeile.objektArt,
                objektName: name,
                feld: zeile.feld,
                befund: "seit_vorschau_geaendert",
                grund,
            });
        };

        // Die Quelle: eine bestehende (ihre Kennung oder, bei einer fehlenden, über ihren Schlüssel) oder die, die diese Übernahme anlegt.
        const katalogZeile = katalogZeilen.get(id);
        let quelle = objekte.get(id);
        if (quelle?.quelle?.art !== "quelle" && katalogZeile !== undefined) {
            // Gibt es die Quelle inzwischen (jemand legte sie an), gilt sie wie eine bestehende.
            quelle = quelleNachSchluessel.get(katalogZeile.angaben.schluessel);
        }
        const neueQuelle = quelle?.quelle?.art !== "quelle" && katalogZeile !== undefined;
        if (quelle?.quelle?.art !== "quelle" && !neueQuelle) {
            befund("Die Quelle ist nicht mehr im Katalog");
            continue;
        }
        if (art === "stilllegen" || art === "aendern") {
            if (quelle?.quelle?.art !== "quelle") continue;
            if (!quelle.quelle.aktiv) {
                befund("Die Quelle ist inzwischen stillgelegt", quelle.name);
                continue;
            }
        }

        if (art === "anlegen") {
            const sicht = objekte.get(traeger.id);
            if (sicht?.quelle?.art !== "traeger" || sicht.quelle.traegerArt !== traeger.art) {
                befund("Das Objekt gibt es nicht mehr", katalogZeile?.angaben.titel ?? zeile.objektName);
                continue;
            }
            if (zeile.artikel === null || !adresseTrifftArtikel(sicht.adresse, zeile.artikel)) {
                befund("Das Objekt hängt inzwischen an einem anderen Artikel", sicht.name);
                continue;
            }
            const bezug: TraegerBezug = { art: traeger.art, id: traeger.id, name: sicht.name };
            const quellenSicht = quelle?.quelle?.art === "quelle" ? quelle.quelle : null;
            if (quellenSicht !== null && !quellenSicht.aktiv && quellenSicht.vonWikisyncStill !== true) {
                befund("Die Quelle ist inzwischen stillgelegt", quelle?.name);
                continue;
            }
            // Gibt es das Paar schon? (Bei einer Quelle, die diese Übernahme anlegt, gibt es nichts.)
            const dieser =
                quelle?.quelle?.art === "quelle"
                    ? quelle.quelle.verwendungen.filter(
                          (kandidat) => kandidat.traegerArt === traeger.art && kandidat.traegerId === traeger.id,
                      )
                    : [];
            const aktiv = dieser.find((kandidat) => kandidat.zustand === "active");
            if (aktiv !== undefined) {
                if (neu !== null && gleicheWerte(aktiv, neu)) ergebnis.schonGleich += 1;
                else befund("Die Verknüpfung gibt es inzwischen schon", sicht.name);
                continue;
            }
            if (dieser.some((kandidat) => kandidat.zustand === "suppressed")) {
                befund("Die Redaktion hat die Verknüpfung inzwischen entfernt", sicht.name);
                continue;
            }
            if (dieser.some((kandidat) => kandidat.vonRedaktionGeloest || kandidat.vonImportGeloest === true)) {
                befund("Die Verknüpfung ist inzwischen von jemand anderem gelöst", sicht.name);
                continue;
            }
            const wiederbeleben = dieser.some((kandidat) => kandidat.vonWikisyncGeloest === true);
            if (neu === null) continue;
            if (neueQuelle && katalogZeile !== undefined) {
                const bisher = katalogSchritte.get(id) ?? {
                    art: "katalog" as const,
                    objekt: platzhalterObjekt(id, katalogZeile.angaben.titel),
                    angaben: katalogZeile.angaben,
                    links: [],
                };
                bisher.links.push({ traeger: bezug, nachher: neu });
                katalogSchritte.set(id, bisher);
                continue;
            }
            if (quelle === undefined) continue;
            ergebnis.schritte.push({
                art: "anlegen",
                objekt: quelle,
                traeger: bezug,
                nachher: neu,
                wiederbeleben,
                quelleBeleben: quellenSicht !== null && !quellenSicht.aktiv,
            });
            continue;
        }

        // aendern und stilllegen: die Verknüpfung, die die Vorschau sah
        if (quelle?.quelle?.art !== "quelle") continue;
        const verwendung = quelle.quelle.verwendungen.find(
            (kandidat) => kandidat.traegerArt === traeger.art && kandidat.traegerId === traeger.id,
        );
        if (verwendung === undefined) {
            befund("Die Verknüpfung gibt es nicht mehr", quelle.name);
            continue;
        }
        if (zeile.artikel === null || !adresseTrifftArtikel(verwendung.traegerAdresse, zeile.artikel)) {
            befund("Das Objekt hängt inzwischen an einem anderen Artikel", quelle.name);
            continue;
        }
        const heute: QuellenWert = { art: verwendung.art, seiten: verwendung.seiten, notiz: verwendung.notiz };
        if (art === "aendern") {
            if (neu !== null && verwendung.zustand === "active" && gleicheWerte(heute, neu)) {
                ergebnis.schonGleich += 1;
                continue;
            }
        } else if (verwendung.zustand !== "active" && verwendung.vonWikisyncGeloest === true) {
            // Der WikiSync hat sie schon still gelegt: erledigt.
            ergebnis.schonGleich += 1;
            continue;
        }
        if (verwendung.zustand !== "active") {
            befund("Die Verknüpfung ist inzwischen gelöst", quelle.name);
            continue;
        }
        if (verwendung.herkunft !== "wiki" || verwendung.art === null) {
            befund("Die Verknüpfung gehört nicht mehr dem Wiki", quelle.name);
            continue;
        }
        if (alt !== null && quellenWert(heute) !== zeile.alt && !gleicheWerte(heute, alt)) {
            befund("Die Verknüpfung hat sich seit der Vorschau geändert", quelle.name);
            continue;
        }
        if (art === "aendern") {
            if (neu !== null)
                ergebnis.schritte.push({ art: "aendern", objekt: quelle, verwendung, vorher: heute, nachher: neu });
        } else {
            ergebnis.schritte.push({ art: "stilllegen", objekt: quelle, verwendung, vorher: heute });
        }
    }
    // Eine Quelle, die kein gültiges Paar mehr hat, wird nicht angelegt; die übrigen werden es in der Reihenfolge ihrer Kennung.
    for (const [, schritt] of [...katalogSchritte].sort(([a], [b]) => (a < b ? -1 : 1)))
        ergebnis.schritte.push(schritt);
    return ergebnis;
}

// ----------------------------------------------------------------------------------------------------------------------------
// Schreiben
// ----------------------------------------------------------------------------------------------------------------------------

/** Die interne Nummer eines Trägers und die einer Quelle. */
async function traegerNummer(tx: Queryable, art: InhalteTraegerArt, publicId: string): Promise<string> {
    const [zeile] = await tx.unsafe<{ id: string }[]>(
        `SELECT id::text AS id FROM ${TRAEGER[art].carrier} WHERE public_id = $1::uuid`,
        [publicId] as never[],
    );
    if (zeile === undefined) throw new Error(`Träger ${art}/${publicId}: nicht gefunden`);
    return zeile.id;
}

async function quelleNummer(tx: Queryable, publicId: string): Promise<string> {
    const [zeile] = await tx<
        { id: string }[]
    >`SELECT id::text AS id FROM feature_source WHERE public_id = ${publicId}::uuid`;
    if (zeile === undefined) throw new Error(`Quelle ${publicId}: nicht gefunden`);
    return zeile.id;
}

/** Die Träger, deren Etikett sich ändert: Art → interne Nummern. */
type Beruehrt = Partial<Record<InhalteTraegerArt, Set<string>>>;
const vermerke = (beruehrt: Beruehrt, art: InhalteTraegerArt, nummer: string): void => {
    beruehrt[art] = (beruehrt[art] ?? new Set<string>()).add(nummer);
};

/**
 * Legt eine Verknüpfung an oder belebt die wieder, die der WikiSync still legte. Liefert die interne Nummer des Trägers. Unter der Sperre der Quelle (jeder Schreiber dieser Tafeln sperrt sie zuerst) kann
 * das Paar nicht mehr wechseln; trifft die Wiederbelebung keine Zeile, ist das ein Fehler.
 */
async function legeVerknuepfungAn(
    tx: Queryable,
    quelle: string,
    traeger: TraegerBezug,
    wert: QuellenWert,
    wiederbeleben: boolean,
): Promise<string> {
    const tafeln = TRAEGER[traeger.art];
    const nummer = await traegerNummer(tx, traeger.art, traeger.id);
    if (wiederbeleben) {
        const zeilen = await tx.unsafe<{ id: string }[]>(
            `UPDATE ${tafeln.link}
                SET state = 'active', is_active = TRUE, retired_at = NULL, retired_origin = NULL, reference_kind = $1, pages = $2, note = $3, updated_at = now()
              WHERE ${tafeln.foreignKey} = $4::bigint AND source_id = $5::bigint AND state = 'retired' AND retired_origin = 'wikisync'
          RETURNING id::text AS id`,
            [wert.art, wert.seiten, wert.notiz, nummer, quelle] as never[],
        );
        if (zeilen.length !== 1) throw new Error(`Verwendung ${quelle}/${traeger.art}/${traeger.id}: nicht zu beleben`);
        return nummer;
    }
    await tx.unsafe(
        `INSERT INTO ${tafeln.link} (${tafeln.foreignKey}, source_id, reference_kind, pages, note, legacy_origin, position, state, source_system, is_active)
         VALUES ($1::bigint, $2::bigint, $3, $4, $5, 'wiki_publication',
                 (SELECT coalesce(max(position) + 1, 0) FROM ${tafeln.link} WHERE ${tafeln.foreignKey} = $1::bigint),
                 'active', 'wikisync', TRUE)`,
        [nummer, quelle, wert.art, wert.seiten, wert.notiz] as never[],
    );
    return nummer;
}

/** Legt eine Verknüpfung still (nie gelöscht): nur eine aktive, die nicht der Redaktion gehört. */
async function legeVerknuepfungStill(
    tx: Queryable,
    quelle: string,
    art: InhalteTraegerArt,
    traegerPublicId: string,
): Promise<string> {
    const tafeln = TRAEGER[art];
    const nummer = await traegerNummer(tx, art, traegerPublicId);
    const zeilen = await tx.unsafe<{ id: string }[]>(
        `UPDATE ${tafeln.link}
            SET state = 'retired', is_active = FALSE, retired_at = now(), retired_origin = 'wikisync', updated_at = now()
          WHERE ${tafeln.foreignKey} = $1::bigint AND source_id = $2::bigint AND state = 'active' AND source_system <> 'editor'
      RETURNING id::text AS id`,
        [nummer, quelle] as never[],
    );
    if (zeilen.length !== 1) throw new Error(`Verwendung ${quelle}/${art}/${traegerPublicId}: nicht still zu legen`);
    return nummer;
}

/** Schreibt Art, Seiten und Notiz einer bestehenden Verknüpfung des Wikis. */
async function schreibeWert(
    tx: Queryable,
    quelle: string,
    art: InhalteTraegerArt,
    traegerPublicId: string,
    wert: QuellenWert,
): Promise<void> {
    const tafeln = TRAEGER[art];
    const zeilen = await tx.unsafe<{ id: string }[]>(
        `UPDATE ${tafeln.link} AS l
            SET reference_kind = $1, pages = $2, note = $3, updated_at = now()
           FROM ${tafeln.carrier} AS c, feature_source AS f
          WHERE c.public_id = $4::uuid AND l.${tafeln.foreignKey} = c.id AND f.public_id = $5::uuid AND l.source_id = f.id
            AND l.state = 'active' AND l.source_system <> 'editor'
      RETURNING l.id::text AS id`,
        [wert.art, wert.seiten, wert.notiz, traegerPublicId, quelle] as never[],
    );
    if (zeilen.length !== 1) throw new Error(`Verwendung ${quelle}/${art}/${traegerPublicId}: nicht zu schreiben`);
}

/**
 * Schreibt die Schritte an bestehenden Quellen, je Quelle in einem Zug; liefert je Quelle die geänderten Verwendungen vorher und nachher fürs Fachprotokoll. Die Quellen, die diese Übernahme anlegt,
 * und das Etikett der Träger schreibt `schliesseAb`.
 */
async function schreibeVerwendungen(
    tx: Queryable,
    schritte: readonly VerwendungsSchritt[],
): Promise<Map<string, MapChange>> {
    const jeQuelle = new Map<string, Exclude<VerwendungsSchritt, { art: "katalog" }>[]>();
    for (const schritt of schritte) {
        if (schritt.art === "katalog") continue;
        jeQuelle.set(schritt.objekt.id, [...(jeQuelle.get(schritt.objekt.id) ?? []), schritt]);
    }
    const aenderungen = new Map<string, MapChange>();
    for (const [quelle, liste] of [...jeQuelle].sort(([a], [b]) => (a < b ? -1 : 1))) {
        const vorher: VerwendungsProtokoll[] = [];
        const nachher: VerwendungsProtokoll[] = [];
        for (const schritt of liste) {
            if (schritt.art === "aendern") {
                const { traegerArt, traegerId } = schritt.verwendung;
                await schreibeWert(tx, quelle, traegerArt, traegerId, schritt.nachher);
                vorher.push(protokoll(traegerArt, traegerId, schritt.vorher, "active"));
                nachher.push(protokoll(traegerArt, traegerId, schritt.nachher, "active"));
            } else if (schritt.art === "stilllegen") {
                const { traegerArt, traegerId } = schritt.verwendung;
                await legeVerknuepfungStill(tx, await quelleNummer(tx, quelle), traegerArt, traegerId);
                vorher.push(protokoll(traegerArt, traegerId, schritt.vorher, "active"));
                nachher.push(protokoll(traegerArt, traegerId, schritt.vorher, "retired"));
            } else {
                if (schritt.quelleBeleben) {
                    // Die Quelle lebt mit ihrer ersten neuen Verknüpfung wieder auf (sie ist die, die der WikiSync still legte).
                    await tx`
                        UPDATE feature_source SET is_active = TRUE, retired_at = NULL, retired_origin = NULL
                         WHERE public_id = ${quelle}::uuid AND NOT is_active AND retired_origin = 'wikisync'
                    `;
                }
                await legeVerknuepfungAn(
                    tx,
                    await quelleNummer(tx, quelle),
                    schritt.traeger,
                    schritt.nachher,
                    schritt.wiederbeleben,
                );
                vorher.push(
                    protokoll(
                        schritt.traeger.art,
                        schritt.traeger.id,
                        KEIN_WERT,
                        schritt.wiederbeleben ? "retired" : "none",
                    ),
                );
                nachher.push(protokoll(schritt.traeger.art, schritt.traeger.id, schritt.nachher, "active"));
            }
        }
        aenderungen.set(quelle, { before: vorher, after: nachher });
    }
    return aenderungen;
}

interface KorpusZeile {
    corpus_key: string;
    form: string;
    source_type: string | null;
    is_official: boolean | null;
    license_statement: string;
    license_key: string | null;
    attribution: string | null;
}

/** Legt eine Katalogquelle an wie der Editor der Quellen (`legeQuelleAn`): ein Korpus der Domain gibt Lizenz und Namensnennung vor, ein Belegstellen-Korpus mit Vorgabe auch Art und „offiziell“. */
async function legeQuelleAn(
    tx: Queryable,
    angaben: KatalogAngaben,
): Promise<{ id: string; publicId: string; revision: number; quellenart: string; offiziell: boolean }> {
    const domain = angaben.adresse === null ? "" : corpusKeyOfUrl(angaben.adresse);
    const [korpus] =
        domain === ""
            ? []
            : await tx<KorpusZeile[]>`
                  SELECT corpus_key, form, source_type, is_official, license_statement, license_key, attribution
                    FROM source_corpus WHERE corpus_key = ${domain}
              `;
    const vorgabe =
        korpus === undefined
            ? undefined
            : vorgabeVon({
                  form: korpus.form === "werk" || korpus.form === "belegstelle" ? korpus.form : "",
                  sourceType: korpus.source_type,
                  isOfficial: korpus.is_official,
                  lizenzAussage: korpus.license_statement,
                  lizenzKey: korpus.license_key,
                  attribution: korpus.attribution,
              });
    const quellenart = vorgabe?.sourceType ?? angaben.quellenart;
    const offiziell = vorgabe?.isOfficial ?? angaben.offiziell;
    const [neu] = await tx<{ id: string; public_id: string; revision: number }[]>`
        INSERT INTO feature_source (source_key, identity_state, url, title, source_type, is_official, license_statement, license_key, attribution, corpus_key, source_system)
        VALUES (${angaben.schluessel}, 'final', ${angaben.adresse}, ${angaben.titel}, ${quellenart}, ${offiziell},
                ${korpus?.license_statement ?? "unrecorded"}, ${korpus?.license_key ?? null}, ${korpus?.attribution ?? null}, ${korpus?.corpus_key ?? null}, 'wikisync')
        RETURNING id::text AS id, public_id::text AS public_id, revision::int AS revision
    `;
    if (neu === undefined) throw new Error(`Quelle ${angaben.schluessel}: nicht angelegt`);
    return { id: neu.id, publicId: neu.public_id, revision: neu.revision, quellenart, offiziell };
}

/**
 * Nach allen Schreibzugriffen der Übernahme: die Quellen, die der Katalog nicht hatte, mit ihren Verwendungen (ein Eintrag im Fachprotokoll je neue Quelle), dann das Etikett der berührten Träger
 * neu (nicht bei einer Änderung nur von Art, Seiten und Notiz).
 */
async function schliesseAb(
    tx: Queryable,
    schritte: readonly VerwendungsSchritt[],
): Promise<{
    entries: MapAuditEntry[];
    affected: { kind: string; id: string; revision: number }[];
    zahlen: Record<string, number>;
}> {
    const entries: MapAuditEntry[] = [];
    const affected: { kind: string; id: string; revision: number }[] = [];
    const beruehrt: Beruehrt = {};
    let quellenAngelegt = 0;

    for (const schritt of schritte) {
        if (schritt.art !== "katalog") continue;
        // Hat jemand den Schlüssel zwischen dem Entscheiden und hier angelegt, bricht das Schreiben ab (eindeutiger Schlüssel): Der Bereich bleibt, wie er war.
        const neu = await legeQuelleAn(tx, schritt.angaben);
        quellenAngelegt += 1;
        const vorher: VerwendungsProtokoll[] = [];
        const nachher: VerwendungsProtokoll[] = [];
        for (const link of schritt.links) {
            const nummer = await legeVerknuepfungAn(tx, neu.id, link.traeger, link.nachher, false);
            vermerke(beruehrt, link.traeger.art, nummer);
            vorher.push(protokoll(link.traeger.art, link.traeger.id, KEIN_WERT, "none"));
            nachher.push(protokoll(link.traeger.art, link.traeger.id, link.nachher, "active"));
        }
        // Die Revision einer neuen Quelle ist 1; ihre Verknüpfungen sind Teil derselben Operation.
        const rev = neu.revision;
        entries.push({
            action: "source.wikisync_uebernommen",
            sourceId: neu.publicId,
            revisionBefore: null,
            revisionAfter: rev,
            changes: {
                created: {
                    before: null,
                    after: {
                        key: schritt.angaben.schluessel,
                        title: schritt.angaben.titel,
                        sourceType: neu.quellenart,
                        isOfficial: neu.offiziell,
                        url: schritt.angaben.adresse,
                    },
                },
                links: { before: vorher, after: nachher },
            },
        });
        affected.push({ kind: "source", id: neu.publicId, revision: rev });
    }

    // Das Etikett der Träger, deren Verknüpfungen entstanden oder still gelegt wurden.
    for (const schritt of schritte) {
        if (schritt.art === "anlegen") {
            vermerke(beruehrt, schritt.traeger.art, await traegerNummer(tx, schritt.traeger.art, schritt.traeger.id));
        } else if (schritt.art === "stilllegen") {
            vermerke(
                beruehrt,
                schritt.verwendung.traegerArt,
                await traegerNummer(tx, schritt.verwendung.traegerArt, schritt.verwendung.traegerId),
            );
        }
    }
    const kanon = await aktualisiereKanon(tx as unknown as Sql, beruehrt as BeruehrteTraeger);
    return {
        entries,
        affected,
        zahlen: {
            angelegt: schritte.reduce(
                (summe, s) => summe + (s.art === "anlegen" ? 1 : s.art === "katalog" ? s.links.length : 0),
                0,
            ),
            stillgelegt: schritte.filter((s) => s.art === "stilllegen").length,
            quellenAngelegt,
            kanon: kanon.geschrieben + kanon.entfernt,
        },
    };
}

// ----------------------------------------------------------------------------------------------------------------------------
// Rücknahme
// ----------------------------------------------------------------------------------------------------------------------------

const eintraege = (wert: unknown): VerwendungsProtokoll[] =>
    Array.isArray(wert)
        ? wert.filter(
              (eintrag): eintrag is VerwendungsProtokoll =>
                  typeof eintrag === "object" &&
                  eintrag !== null &&
                  typeof (eintrag as VerwendungsProtokoll).carrierId === "string" &&
                  typeof (eintrag as VerwendungsProtokoll).kind === "string",
          )
        : [];

const wertAus = (eintrag: VerwendungsProtokoll): QuellenWert => ({
    art: eintrag.referenceKind,
    seiten: eintrag.pages,
    notiz: eintrag.note,
});

/** Wie viele aktive Verknüpfungen hat die Quelle noch (an allen Trägern)? */
async function aktiveVerknuepfungen(tx: Queryable, quelleNummerId: string): Promise<number> {
    let summe = 0;
    for (const art of Object.keys(TRAEGER) as InhalteTraegerArt[]) {
        const [zeile] = await tx.unsafe<{ n: number }[]>(
            `SELECT count(*)::int AS n FROM ${TRAEGER[art].link} WHERE source_id = $1::bigint AND state = 'active'`,
            [quelleNummerId] as never[],
        );
        summe += zeile?.n ?? 0;
    }
    return summe;
}

/**
 * Nimmt die Verwendungen einer Übernahme zurück: Art, Seiten und Notiz kehren zurück, was angelegt wurde, wird still gelegt, was still gelegt wurde, lebt wieder auf, und eine Quelle, die die
 * Übernahme angelegt hat und an der nichts Aktives mehr hängt, wird still gelegt. Je Verknüpfung nur, wo der Stand noch der der Übernahme ist und die Verknüpfung dem Wiki gehört; sonst ein Befund.
 * Danach das Etikett der berührten Träger neu.
 */
async function nimmVerwendungenZurueck(
    tx: Queryable,
    quelle: string,
    wechsel: MapChange,
    objekt: PlanObjekt | undefined,
    eintrag?: Readonly<Record<string, MapChange>>,
): Promise<{ change: MapChange | null; befunde: BefundSchritt[]; anzahl: number }> {
    const befunde: BefundSchritt[] = [];
    const befund = (grund: string): void => {
        befunde.push({
            objektId: quelle,
            objektArt: "source",
            objektName: objekt?.name ?? null,
            feld: "links",
            befund: "seit_uebernahme_geaendert",
            grund,
        });
    };
    if (objekt?.quelle?.art !== "quelle") return { change: null, befunde, anzahl: 0 };
    const vorher = eintraege(wechsel.before);
    const nachher = eintraege(wechsel.after);
    const zurueckVorher: VerwendungsProtokoll[] = [];
    const zurueckNachher: VerwendungsProtokoll[] = [];
    const beruehrt: Beruehrt = {};
    const quellenNummer = await quelleNummer(tx, quelle);
    for (const danach of nachher) {
        const davor = vorher.find(
            (kandidat) => kandidat.kind === danach.kind && kandidat.carrierId === danach.carrierId,
        );
        if (davor === undefined) continue;
        const verwendung = objekt.quelle.verwendungen.find(
            (kandidat) => kandidat.traegerArt === danach.kind && kandidat.traegerId === danach.carrierId,
        );
        const name = verwendung?.traegerName ?? danach.carrierId;
        if (verwendung === undefined) {
            befund(`Die Verknüpfung am Objekt „${name}“ ist inzwischen gelöst`);
            continue;
        }
        const heute: QuellenWert = { art: verwendung.art, seiten: verwendung.seiten, notiz: verwendung.notiz };
        const tafeln = TRAEGER[danach.kind];

        // Angelegt oder wiederbelebt: wieder still legen, wo die Verknüpfung noch die der Übernahme ist.
        if (danach.state === "active" && davor.state !== "active") {
            if (verwendung.zustand !== "active") {
                befund(`Die Verknüpfung am Objekt „${name}“ ist inzwischen gelöst`);
                continue;
            }
            if (verwendung.herkunft !== "wiki") {
                befund(`Die Verknüpfung am Objekt „${name}“ gehört inzwischen der Redaktion`);
                continue;
            }
            if (!gleicheWerte(heute, wertAus(danach))) {
                befund(`Die Verknüpfung am Objekt „${name}“ wurde seit der Übernahme geändert`);
                continue;
            }
            vermerke(
                beruehrt,
                danach.kind,
                await legeVerknuepfungStill(tx, quellenNummer, danach.kind, danach.carrierId),
            );
            zurueckVorher.push(protokoll(danach.kind, danach.carrierId, heute, "active"));
            zurueckNachher.push(
                protokoll(
                    danach.kind,
                    danach.carrierId,
                    wertAus(davor),
                    davor.state === "retired" ? "retired" : "none",
                ),
            );
            continue;
        }

        // Still gelegt: wieder beleben, wo sie noch so still liegt, wie die Übernahme sie hinterließ.
        if (davor.state === "active" && danach.state === "retired") {
            if (verwendung.zustand !== "retired" || verwendung.vonWikisyncGeloest !== true) {
                befund(`Die Verknüpfung am Objekt „${name}“ wurde seit der Übernahme geändert`);
                continue;
            }
            const zeilen = await tx.unsafe<{ id: string }[]>(
                `UPDATE ${tafeln.link} AS l
                    SET state = 'active', is_active = TRUE, retired_at = NULL, retired_origin = NULL, updated_at = now()
                   FROM ${tafeln.carrier} AS c
                  WHERE c.public_id = $1::uuid AND l.${tafeln.foreignKey} = c.id AND l.source_id = $2::bigint
                    AND l.state = 'retired' AND l.retired_origin = 'wikisync'
              RETURNING c.id::text AS traeger`,
                [danach.carrierId, quellenNummer] as never[],
            );
            if (zeilen.length !== 1)
                throw new Error(`Verwendung ${quelle}/${danach.kind}/${danach.carrierId}: nicht zu beleben`);
            vermerke(beruehrt, danach.kind, zeilen[0]!.id);
            zurueckVorher.push(protokoll(danach.kind, danach.carrierId, wertAus(davor), "retired"));
            zurueckNachher.push(protokoll(danach.kind, danach.carrierId, wertAus(davor), "active"));
            continue;
        }

        // Geändert: Art, Seiten und Notiz kehren zurück.
        if (verwendung.zustand !== "active") {
            befund(`Die Verknüpfung am Objekt „${name}“ ist inzwischen gelöst`);
            continue;
        }
        if (verwendung.herkunft !== "wiki") {
            befund(`Die Verknüpfung am Objekt „${name}“ gehört inzwischen der Redaktion`);
            continue;
        }
        if (!gleicheWerte(heute, wertAus(danach))) {
            befund(`Die Verknüpfung am Objekt „${name}“ wurde seit der Übernahme geändert`);
            continue;
        }
        const wert = wertAus(davor);
        await schreibeWert(tx, quelle, danach.kind, danach.carrierId, wert);
        zurueckVorher.push(protokoll(danach.kind, danach.carrierId, heute, "active"));
        zurueckNachher.push(protokoll(danach.kind, danach.carrierId, wert, "active"));
    }

    // Eine Quelle, die die Übernahme angelegt hat und an der nichts Aktives mehr hängt, legt sich still (die Rücknahme belebt sie bei der nächsten Nennung wieder).
    if (eintrag?.["created"] !== undefined && zurueckVorher.length > 0) {
        const [stand] = await tx<{ source_system: string; is_active: boolean }[]>`
            SELECT source_system, is_active FROM feature_source WHERE id = ${quellenNummer}::bigint
        `;
        if (
            stand?.is_active === true &&
            stand.source_system === "wikisync" &&
            (await aktiveVerknuepfungen(tx, quellenNummer)) === 0
        ) {
            await tx`
                UPDATE feature_source SET is_active = FALSE, retired_at = now(), retired_origin = 'wikisync'
                 WHERE id = ${quellenNummer}::bigint AND is_active AND source_system = 'wikisync'
            `;
        }
    }
    if (zurueckVorher.length === 0) return { change: null, befunde, anzahl: 0 };
    await aktualisiereKanon(tx as unknown as Sql, beruehrt as BeruehrteTraeger);
    return {
        change: { before: zurueckVorher, after: zurueckNachher },
        befunde,
        anzahl: zurueckVorher.length,
    };
}

/** Der Listen-Schreiber der Quellen: die Verwendungen und die Quellen, die der Katalog nicht hat. */
export const verwendungenSchreiber: ListenSchreiber<VerwendungsSchritt> = {
    feldGehoert: (feld) => istVerwendungsFeld(feld) || istKatalogFeld(feld),
    auditSchluessel: "links",
    entscheide: entscheideVerwendungen,
    schreibe: schreibeVerwendungen,
    schliesseAb,
    nimmZurueck: nimmVerwendungenZurueck,
};
