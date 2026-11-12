import type { WikisyncOrtsrolle } from "@avesmaps3d/shared";
import type { Database, Queryable } from "../../../database.ts";
import type { MapChange } from "../../../editor/map-operation.ts";
import { readLoreResolution } from "../../../migration/lore-import.ts";
import { hitCells, resolveLorePlace } from "../../../migration/lore-keys.ts";
import { VORKOMMEN_EIGENE_FELDER, VORKOMMEN_FELDER, type VorkommenBeziehung } from "../../infobox/vorkommen.ts";
import { VORKOMMEN_STAND_SPALTEN } from "../lokal.ts";
import type { PlanObjekt } from "../plan.ts";
import {
    beziehungAusFeld,
    gueltigeRolle,
    leseLoreOrtWert,
    rolleDerZeile,
    type LoreOrtWert,
    type LoreZeile,
} from "../vorkommen.ts";
import { artikelPasst } from "./entscheiden.ts";
import type { VorschauZeile } from "./protokoll.ts";
import type { BefundSchritt, FeldSchritt, ListenErgebnis, ListenSchreiber, Schreiber } from "./schreiber.ts";

/**
 * Die Übernahme und Rücknahme der Vorkommen (WI-0253, Scheibe Vorkommen, §23). Ein Objekt ist ein Eintrag (`lore_entry`: Ware, Fauna, Flora, Spezies), kein Kartenobjekt; sein Artikel ist ein Artikel mit
 * einer der vier Infoboxen, gefunden über die gespeicherte Adresse (`lore_entry.wiki_url`). Geschrieben wird:
 *
 * - **Die Felder des Eintrags** (Name, Gruppe, Typ, Lebensraum, Weitere Namen, Kontinent: genau die Spalten, die Legacys Lore-Abgleich aus der Infobox setzt; dazu die Kurzbeschreibung aus dem
 *   Text des Artikels, WI-0260, Migration 0252). Wie in Legacy
 *   (`avesmapsLoreFieldPlan`) folgt ein Feld dem Wiki, solange es nicht als eigene Entscheidung vermerkt ist, und das nur, wo der Vermerk es belegt: Ein Wert mit dem Vermerk „wiki“ wird ersetzt, ein
 *   leeres Feld ohne Vermerk gefüllt (`fuelltLeereFelder`); ein Wert OHNE Vermerk ist unbelegt und bleibt ein Befund (`herkunft.ts`, anders als Legacy, das ihn überschrieb). Den Vermerk „wiki“ setzt
 *   der Schreiber für jedes Feld, in das die Übernahme einen Wert schreibt (`lore_entry_field_origin`, nur einfügen; ein vorhandener, auch `manual`, bleibt).
 * - **Der Wiki-Stand** (`wiki_lore_snapshot`): die Wiki-Werte dieser Felder und die vier Rohtexte der Infobox, geschrieben nur hier. Ein Eintrag bekommt ihn mit seiner ersten Übernahme; bis dahin ist jeder Wert
 *   unbekannt (`unbekannt`).
 * - **Die Ortszeilen** (`lore_place`) über den Listen-Schreiber unten: anlegen, die Rolle ändern, still legen (`retired_origin = 'wikisync'`, nie löschen), wiederbeleben, was der WikiSync selbst still legte.
 * - 🔴 **Nie** die Art, die Adresse, der Schlüssel, der Zustand und `source_system` des Eintrags, nie eine Ortszeile der Redaktion, ein Tombstone oder eine von der Redaktion gelöste Zeile. Ein Eintrag der
 *   Redaktion (`source_system = 'editor'`) fasst die Übernahme nicht an: Der Leser (`ladeVorkommen`) gibt jedes seiner Felder und seine ganze Liste als eigene Entscheidung aus.
 *
 * Kein Wert geht in ein abgeleitetes Ergebnis der Karte ein (`leitetAb`: nie); die Operation hebt die Leser-Revision, das Infofenster liest den Eintrag neu. Die Treffer der Zeilen (`lore_place_target`)
 * rechnet die Übernahme mit demselben Lookup wie Import und Editor neu (`resolveLorePlace`, nie über einen Namen), und nur für die Rolle `ort`.
 */

/** Die Spalten, die nie leer werden dürfen (`lore_entry.name` ist NOT NULL). */
const PFLICHT: ReadonlySet<string> = new Set(["name"]);

/** Feld → Name im Fachprotokoll (`MAP_AUDIT_FIELDS.lore`). */
const AUDIT_NAMEN: Readonly<Record<string, string>> = {
    name: "name",
    gruppe: "gruppe",
    typ: "typ",
    lebensraum: "lebensraum",
    synonyme: "synonyme",
    continent: "continent",
    kurzbeschreibung: "kurzbeschreibung",
};

// ----------------------------------------------------------------------------------------------------------------------------
// Ortszeilen: entscheiden
// ----------------------------------------------------------------------------------------------------------------------------

/** Ein Schritt an den Ortszeilen eines Eintrags. */
export type LoreSchritt =
    | { art: "anlegen"; objekt: PlanObjekt; beziehung: VorkommenBeziehung; wert: LoreOrtWert }
    | { art: "rolle"; objekt: PlanObjekt; zeile: string; rolle: WikisyncOrtsrolle }
    | { art: "stilllegen"; objekt: PlanObjekt; zeile: string }
    | { art: "ersetzen"; objekt: PlanObjekt; zeile: string; beziehung: VorkommenBeziehung; wert: LoreOrtWert };

/** Eine Zeile im Fachprotokoll (`places`): wie der Editor sie führt, dazu die Rolle. */
interface OrtProtokoll {
    rowId: string;
    wikiKey: string | null;
    name: string | null;
    relation: string;
    state: string;
    role: WikisyncOrtsrolle;
}

const GRUND_GEAENDERT = "Die Ortszeile hat sich seit der Vorschau geändert";
const GRUND_REDAKTION = "Der Eintrag gehört inzwischen der Redaktion";
const GRUND_NICHT_MEHR_WIKI = "Die Ortszeile gehört nicht mehr dem Wiki";

/**
 * Entscheidet die Zeilen der Ortszeilen gegen den Stand von jetzt (REIN). Nur Zeilen, die die Vorschau übernehmen wollte (Eigentümer `wiki`, Wirkung `uebernommen`), werden Schritte; alle anderen hat
 * sie schon als Befund oder eigenen Wert gezeigt.
 */
export function entscheideLoreOrte(
    zeilen: readonly VorschauZeile[],
    objekte: ReadonlyMap<string, PlanObjekt>,
): ListenErgebnis<LoreSchritt> {
    const ergebnis: ListenErgebnis<LoreSchritt> = { schritte: [], befunde: [], schonGleich: 0 };
    for (const zeile of zeilen) {
        const beziehung = beziehungAusFeld(zeile.feld);
        if (beziehung === null || zeile.eigentuemer !== "wiki" || zeile.wirkung !== "uebernommen") continue;
        const id = zeile.objektIds[0] ?? zeile.objektId;
        if (id === null || id === undefined) continue;
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
        const objekt = objekte.get(id);
        if (objekt === undefined) {
            befund("Der Eintrag ist nicht mehr da");
            continue;
        }
        if (!artikelPasst(zeile, objekt)) {
            befund("Der Eintrag hängt inzwischen an einem anderen Artikel", objekt.name);
            continue;
        }
        const bestand = objekt.vorkommen;
        if (bestand === undefined) continue;
        if (bestand.redaktion) {
            befund(GRUND_REDAKTION, objekt.name);
            continue;
        }
        const alt = leseLoreOrtWert(zeile.alt);
        const neu = leseLoreOrtWert(zeile.neu);
        const finde = (schluessel: string): LoreZeile | undefined =>
            bestand.zeilen.find((kandidat) => kandidat.beziehung === beziehung && kandidat.schluessel === schluessel);
        // Die Zeile, die die Vorschau sah, steht noch so da und gehört noch dem Wiki.
        const gesehen = (
            kandidat: LoreZeile | undefined,
            wert: LoreOrtWert,
        ): LoreZeile | "weg" | "fremd" | "anders" => {
            if (kandidat === undefined || kandidat.zustand !== "active") return "weg";
            if (kandidat.herkunft !== "wiki") return "fremd";
            return rolleDerZeile(kandidat) === wert.rolle ? kandidat : "anders";
        };
        /** Das Ziel einer neuen Zeile: frei, vom WikiSync still gelegt (lebt auf) oder schon da. */
        const neuesZiel = (wert: LoreOrtWert): "frei" | "gleich" | "gesperrt" => {
            const da = finde(wert.schluessel);
            if (da === undefined) return "frei";
            if (da.zustand === "active") return rolleDerZeile(da) === wert.rolle ? "gleich" : "gesperrt";
            return da.zustand === "retired" && da.stillVon === "wikisync" ? "frei" : "gesperrt";
        };

        if (alt === null && neu !== null) {
            const ziel = neuesZiel(neu);
            if (ziel === "gleich") ergebnis.schonGleich += 1;
            else if (ziel === "gesperrt") befund(GRUND_GEAENDERT, objekt.name);
            else ergebnis.schritte.push({ art: "anlegen", objekt, beziehung, wert: neu });
            continue;
        }
        if (alt === null) continue;
        const alte = gesehen(finde(alt.schluessel), alt);
        if (neu === null) {
            // Still legen: nur eine aktive Zeile des Wikis in der Rolle der Vorschau.
            if (typeof alte === "object") ergebnis.schritte.push({ art: "stilllegen", objekt, zeile: alte.id });
            else if (alte === "weg") ergebnis.schonGleich += 1;
            else befund(alte === "fremd" ? GRUND_NICHT_MEHR_WIKI : GRUND_GEAENDERT, objekt.name);
            continue;
        }
        if (alt.schluessel === neu.schluessel) {
            // Die Rolle: dieselbe Zeile, andere Rolle.
            const da = finde(neu.schluessel);
            if (da?.zustand === "active" && rolleDerZeile(da) === neu.rolle) ergebnis.schonGleich += 1;
            else if (typeof alte === "object" && alt.rolle !== neu.rolle)
                ergebnis.schritte.push({ art: "rolle", objekt, zeile: alte.id, rolle: neu.rolle });
            else befund(alte === "fremd" ? GRUND_NICHT_MEHR_WIKI : GRUND_GEAENDERT, objekt.name);
            continue;
        }
        // Ersetzen (eine Weiterleitung wurde aufgelöst): die alte Zeile still legen, die neue anlegen oder beleben.
        const ziel = neuesZiel(neu);
        if (typeof alte === "object" && ziel === "frei")
            ergebnis.schritte.push({ art: "ersetzen", objekt, zeile: alte.id, beziehung, wert: neu });
        else if (alte === "weg" && ziel === "gleich") ergebnis.schonGleich += 1;
        else if (typeof alte === "object" && ziel === "gleich")
            ergebnis.schritte.push({ art: "stilllegen", objekt, zeile: alte.id });
        else befund(alte === "fremd" ? GRUND_NICHT_MEHR_WIKI : GRUND_GEAENDERT, objekt.name);
    }
    return ergebnis;
}

// ----------------------------------------------------------------------------------------------------------------------------
// Ortszeilen: schreiben
// ----------------------------------------------------------------------------------------------------------------------------

interface DbZeile {
    id: string;
    place_wiki_key: string | null;
    place_title: string | null;
    relation: string;
    sort_order: number;
    state: string;
    retired_origin: string | null;
    role: string | null;
}

async function eintragId(tx: Queryable, publicId: string): Promise<string | undefined> {
    const [zeile] = await tx<
        { id: string }[]
    >`SELECT id::text AS id FROM lore_entry WHERE public_id = ${publicId}::uuid`;
    return zeile?.id;
}

async function zeilenDes(tx: Queryable, eintrag: string): Promise<DbZeile[]> {
    return tx<DbZeile[]>`
        SELECT id::text AS id, place_wiki_key, place_title, relation, sort_order::int AS sort_order, state, retired_origin, role
          FROM lore_place WHERE lore_entry_id = ${eintrag}::bigint
         ORDER BY sort_order, id
           FOR UPDATE
    `;
}

const rolleDb = (zeile: DbZeile): WikisyncOrtsrolle => gueltigeRolle(zeile.role) ?? "ort";

function protokollZeile(zeile: DbZeile): OrtProtokoll {
    return {
        rowId: zeile.id,
        wikiKey: zeile.place_wiki_key,
        name: zeile.place_wiki_key === null ? zeile.place_title : null,
        relation: zeile.relation,
        state: zeile.state,
        role: rolleDb(zeile),
    };
}

/** Die Treffer der Zeilen, die gerechnet werden müssen: der Lookup wird einmal geladen (derselbe wie im Import und im Editor). */
function trefferRechner(
    tx: Queryable,
): (zeile: string, schluessel: string | null, rolle: WikisyncOrtsrolle) => Promise<void> {
    let geladen: Awaited<ReturnType<typeof readLoreResolution>> | undefined;
    return async (zeile, schluessel, rolle) => {
        await tx`DELETE FROM lore_place_target WHERE lore_place_id = ${zeile}::bigint`;
        // Nur ein Ort trifft: Eine Zeile mit einer anderen Rolle (und ein ungeklärter Name) behält ihren Link, aber nie ein Ziel.
        if (rolle !== "ort" || schluessel === null) {
            await tx`
                UPDATE lore_place SET key_class = 'other', target_state = 'unmatched', target_count = 0, updated_at = now()
                 WHERE id = ${zeile}::bigint
            `;
            return;
        }
        geladen ??= await readLoreResolution(tx as unknown as Database);
        const aufloesung = resolveLorePlace(schluessel, geladen.wikiKeys, geladen.carrierIds);
        await tx`
            UPDATE lore_place
               SET key_class = ${aufloesung.keyClass}, target_state = ${aufloesung.state}, target_count = ${aufloesung.hits.length}, updated_at = now()
             WHERE id = ${zeile}::bigint
        `;
        for (const treffer of aufloesung.hits) {
            const [ort, gebiet, landschaft, gipfel] = hitCells(treffer);
            await tx`
                INSERT INTO lore_place_target (lore_place_id, place_id, territory_id, region_id, terrain_peak_id)
                VALUES (${zeile}::bigint, ${ort ?? null}::bigint, ${gebiet ?? null}::bigint, ${landschaft ?? null}::bigint, ${gipfel ?? null}::bigint)
            `;
        }
    };
}

async function stillLegen(tx: Queryable, id: string): Promise<void> {
    await tx`
        UPDATE lore_place
           SET state = 'retired', is_active = FALSE, retired_at = now(), retired_origin = 'wikisync', updated_at = now()
         WHERE id = ${id}::bigint AND state = 'active'
    `;
}

/** Ein Ort kommt in die Liste: eine Zeile, die der WikiSync still legte, lebt wieder auf, sonst entsteht eine neue (Herkunft Wiki, Ziel nicht von Hand). Liefert die Zeile. */
async function legeAn(
    tx: Queryable,
    eintrag: string,
    zeilen: readonly DbZeile[],
    beziehung: string,
    wert: LoreOrtWert,
): Promise<string> {
    const da = zeilen.find((zeile) => zeile.relation === beziehung && zeile.place_wiki_key === wert.schluessel);
    if (da !== undefined) {
        await tx`
            UPDATE lore_place
               SET state = 'active', is_active = TRUE, retired_at = NULL, retired_origin = NULL, role = ${wert.rolle}, place_title = ${wert.titel}, updated_at = now()
             WHERE id = ${da.id}::bigint
        `;
        return da.id;
    }
    // Die Stelle: hinter der letzten Zeile des Wikis (von Hand hinzugefügte tragen 9999 und zählen nicht).
    const stelle =
        Math.max(-1, ...zeilen.filter((zeile) => zeile.sort_order < 9999).map((zeile) => zeile.sort_order)) + 1;
    const [neu] = await tx<{ id: string }[]>`
        INSERT INTO lore_place (lore_entry_id, place_wiki_key, relation, place_title, sort_order, key_class, target_state, target_count,
                                target_origin, legacy_origin, state, source_system, is_active, role)
        VALUES (${eintrag}::bigint, ${wert.schluessel}, ${beziehung}, ${wert.titel}, ${stelle}, 'other', 'unmatched', 0,
                'legacy_import', 'wiki', 'active', 'wikisync', TRUE, ${wert.rolle})
        RETURNING id::text AS id
    `;
    return (neu as { id: string }).id;
}

/** Schreibt die Schritte, je Eintrag in einem Zug; liefert je Eintrag die berührten Zeilen vorher und nachher fürs Fachprotokoll. */
async function schreibeLoreOrte(tx: Queryable, schritte: readonly LoreSchritt[]): Promise<Map<string, MapChange>> {
    const jeEintrag = new Map<string, LoreSchritt[]>();
    for (const schritt of schritte)
        jeEintrag.set(schritt.objekt.id, [...(jeEintrag.get(schritt.objekt.id) ?? []), schritt]);
    const aenderungen = new Map<string, MapChange>();
    const rechne = trefferRechner(tx);
    for (const [publicId, liste] of [...jeEintrag].sort(([a], [b]) => (a < b ? -1 : 1))) {
        const eintrag = await eintragId(tx, publicId);
        if (eintrag === undefined) continue;
        const vorher = await zeilenDes(tx, eintrag);
        const beruehrt = new Set<string>();
        // Erst still legen (entfallen, ersetzt), dann die Rolle ändern, dann anlegen: So belegt keine neue Zeile einen Schlüssel, der gerade frei wird.
        for (const schritt of liste) {
            if (schritt.art === "stilllegen" || schritt.art === "ersetzen") {
                await stillLegen(tx, schritt.zeile);
                beruehrt.add(schritt.zeile);
            }
        }
        const neueRollen = new Map<string, WikisyncOrtsrolle>();
        for (const schritt of liste) {
            if (schritt.art !== "rolle") continue;
            await tx`UPDATE lore_place SET role = ${schritt.rolle}, updated_at = now() WHERE id = ${schritt.zeile}::bigint AND state = 'active'`;
            beruehrt.add(schritt.zeile);
            neueRollen.set(schritt.zeile, schritt.rolle);
        }
        for (const schritt of liste) {
            if (schritt.art !== "anlegen" && schritt.art !== "ersetzen") continue;
            const id = await legeAn(tx, eintrag, await zeilenDes(tx, eintrag), schritt.beziehung, schritt.wert);
            beruehrt.add(id);
            neueRollen.set(id, schritt.wert.rolle);
        }
        // Die Treffer der Zeilen, deren Rolle oder Zustand sich änderte: neu gerechnet, nie über einen Namen.
        const nachher = await zeilenDes(tx, eintrag);
        for (const zeile of nachher) {
            if (!neueRollen.has(zeile.id)) continue;
            await rechne(zeile.id, zeile.place_wiki_key, neueRollen.get(zeile.id) as WikisyncOrtsrolle);
        }
        const nachId = new Map(nachher.map((zeile) => [zeile.id, zeile]));
        const davor = vorher.filter((zeile) => beruehrt.has(zeile.id)).map(protokollZeile);
        const danach = [...beruehrt]
            .map((id) => nachId.get(id))
            .filter((z): z is DbZeile => z !== undefined)
            .map(protokollZeile);
        if (JSON.stringify(davor) !== JSON.stringify(danach))
            aenderungen.set(publicId, { before: davor, after: danach });
    }
    return aenderungen;
}

// ----------------------------------------------------------------------------------------------------------------------------
// Ortszeilen: zurücknehmen
// ----------------------------------------------------------------------------------------------------------------------------

const eintraege = (wert: unknown): OrtProtokoll[] =>
    Array.isArray(wert)
        ? wert.filter(
              (eintrag): eintrag is OrtProtokoll =>
                  typeof eintrag === "object" &&
                  eintrag !== null &&
                  typeof (eintrag as OrtProtokoll).rowId === "string",
          )
        : [];

/**
 * Nimmt die Ortszeilen einer Übernahme zurück: was sie anlegte, wird still gelegt, was sie still legte, lebt wieder auf, eine geänderte Rolle kehrt zurück (und mit ihr die Treffer). Je Zeile nur,
 * wo der Stand noch der der Übernahme ist; sonst ein Befund. Ein Eintrag, der inzwischen der Redaktion gehört, bleibt ganz.
 */
async function nimmLoreOrteZurueck(
    tx: Queryable,
    publicId: string,
    wechsel: MapChange,
    objekt: PlanObjekt | undefined,
): Promise<{ change: MapChange | null; befunde: BefundSchritt[]; anzahl: number }> {
    const befunde: BefundSchritt[] = [];
    const befund = (grund: string): void => {
        befunde.push({
            objektId: publicId,
            objektArt: "lore",
            objektName: objekt?.name ?? null,
            feld: "places",
            befund: "seit_uebernahme_geaendert",
            grund,
        });
    };
    if (objekt?.vorkommen?.redaktion === true) {
        befund("Die Ortszeilen gehören inzwischen der Redaktion");
        return { change: null, befunde, anzahl: 0 };
    }
    const eintrag = await eintragId(tx, publicId);
    if (eintrag === undefined) return { change: null, befunde, anzahl: 0 };
    const vorher = eintraege(wechsel.before);
    const nachher = eintraege(wechsel.after);
    const zeilen = await zeilenDes(tx, eintrag);
    const nachId = new Map(zeilen.map((zeile) => [zeile.id, zeile]));
    const rechne = trefferRechner(tx);
    const geaendert = new Set<string>();
    const neueRollen = new Map<string, WikisyncOrtsrolle>();
    let anzahl = 0;
    for (const a of nachher) {
        const b = vorher.find((kandidat) => kandidat.rowId === a.rowId);
        const zeile = nachId.get(a.rowId);
        const wie = a.name ?? a.wikiKey ?? a.rowId;
        const unveraendert = (): boolean => zeile !== undefined && zeile.state === a.state && rolleDb(zeile) === a.role;
        if (b === undefined) {
            // Angelegt: wieder still legen, wo die Zeile noch so dasteht.
            if (!unveraendert()) {
                befund(`Die Ortszeile „${wie}“ wurde seit der Übernahme geändert`);
                continue;
            }
            await stillLegen(tx, a.rowId);
            geaendert.add(a.rowId);
            anzahl += 1;
            continue;
        }
        if (b.state === "active" && a.state === "retired") {
            // Still gelegt: wieder beleben, wo die Zeile noch vom WikiSync still gelegt ist.
            if (zeile === undefined || zeile.state !== "retired" || zeile.retired_origin !== "wikisync") {
                befund(`Die Ortszeile „${wie}“ wurde seit der Übernahme geändert`);
                continue;
            }
            await tx`
                UPDATE lore_place
                   SET state = 'active', is_active = TRUE, retired_at = NULL, retired_origin = NULL, role = ${b.role}, updated_at = now()
                 WHERE id = ${zeile.id}::bigint
            `;
            geaendert.add(a.rowId);
            neueRollen.set(a.rowId, b.role);
            anzahl += 1;
            continue;
        }
        if (b.state === "retired" && a.state === "active") {
            // Belebt: wieder still legen, mit der Rolle von vorher.
            if (!unveraendert()) {
                befund(`Die Ortszeile „${wie}“ wurde seit der Übernahme geändert`);
                continue;
            }
            await stillLegen(tx, a.rowId);
            await tx`UPDATE lore_place SET role = ${b.role}, updated_at = now() WHERE id = ${a.rowId}::bigint`;
            geaendert.add(a.rowId);
            anzahl += 1;
            continue;
        }
        if (b.role !== a.role) {
            // Die Rolle: zurück, wo sie noch die der Übernahme ist.
            if (!unveraendert()) {
                befund(`Die Ortszeile „${wie}“ wurde seit der Übernahme geändert`);
                continue;
            }
            await tx`UPDATE lore_place SET role = ${b.role}, updated_at = now() WHERE id = ${a.rowId}::bigint`;
            geaendert.add(a.rowId);
            neueRollen.set(a.rowId, b.role);
            anzahl += 1;
        }
    }
    if (anzahl === 0) return { change: null, befunde, anzahl };
    const danach = await zeilenDes(tx, eintrag);
    for (const zeile of danach) {
        const rolle = neueRollen.get(zeile.id);
        if (rolle !== undefined) await rechne(zeile.id, zeile.place_wiki_key, rolle);
    }
    const nachDanach = new Map(danach.map((zeile) => [zeile.id, zeile]));
    return {
        change: {
            before: nachher.filter((e) => geaendert.has(e.rowId)),
            after: [...geaendert]
                .map((id) => nachDanach.get(id))
                .filter((z): z is DbZeile => z !== undefined)
                .map(protokollZeile),
        },
        befunde,
        anzahl,
    };
}

/** Der Listen-Schreiber der Vorkommen: die Ortszeilen. */
export const ortszeilenSchreiber: ListenSchreiber<LoreSchritt> = {
    feldGehoert: (feld) => beziehungAusFeld(feld) !== null,
    auditSchluessel: "places",
    entscheide: entscheideLoreOrte,
    schreibe: schreibeLoreOrte,
    // Das Protokoll der Übernahme nennt, wie viele Ortszeilen sie anlegte und still legte (wie bei den Quellen).
    schliesseAb: (_tx, schritte) =>
        Promise.resolve({
            entries: [],
            affected: [],
            zahlen: {
                angelegt: schritte.filter((schritt) => schritt.art === "anlegen" || schritt.art === "ersetzen").length,
                stillgelegt: schritte.filter((schritt) => schritt.art === "stilllegen" || schritt.art === "ersetzen")
                    .length,
            },
        }),
    nimmZurueck: nimmLoreOrteZurueck,
};

// ----------------------------------------------------------------------------------------------------------------------------
// Der Schreiber des Bereichs
// ----------------------------------------------------------------------------------------------------------------------------

export const vorkommenSchreiber: Schreiber = {
    bereich: "vorkommen",
    protokollArt: "lore",
    objektArt: "lore",
    affectedArt: "lore",
    eintragZiel: (id) => ({ loreId: id }),
    zielSpalte: "lore_public_id",
    wirksameSpalten: Object.fromEntries(VORKOMMEN_EIGENE_FELDER.map((feld) => [feld, feld])),
    schnappschussSpalten: VORKOMMEN_STAND_SPALTEN,
    auditNamen: AUDIT_NAMEN,
    unbekanntFelder: new Set(VORKOMMEN_FELDER),
    fuelltLeereFelder: true,
    liste: ortszeilenSchreiber,
    leitetAb: () => false,

    async sperre(tx, ids) {
        if (ids.length === 0) return new Map();
        // Dieselbe Sperre wie der Editor der Vorkommen (`lore.update`: FOR UPDATE am Eintrag); ein stillgelegter oder unterdrückter Eintrag fehlt.
        const zeilen = await tx<{ id: string; revision: number }[]>`
            SELECT public_id::text AS id, revision::int AS revision
              FROM lore_entry
             WHERE public_id = ANY(${[...ids]}::uuid[]) AND is_active
             ORDER BY public_id
               FOR UPDATE
        `;
        return new Map(zeilen.map((zeile) => [zeile.id, zeile.revision]));
    },

    /** Der Wiki-Stand hängt am Eintrag; er entsteht mit der ersten Übernahme (leer, alle Werte unbekannt). */
    async schnappschussIds(tx, ids) {
        if (ids.length === 0) return new Map();
        await tx`
            INSERT INTO wiki_lore_snapshot (lore_entry_id)
            SELECT id FROM lore_entry WHERE public_id = ANY(${[...ids]}::uuid[]) AND is_active
            ON CONFLICT (lore_entry_id) DO NOTHING
        `;
        const zeilen = await tx<{ objekt: string; stand: string }[]>`
            SELECT e.public_id::text AS objekt, s.id::text AS stand
              FROM wiki_lore_snapshot s JOIN lore_entry e ON e.id = s.lore_entry_id
             WHERE e.public_id = ANY(${[...ids]}::uuid[])
        `;
        return new Map(zeilen.map((zeile) => [zeile.objekt, zeile.stand]));
    },

    pruefe(_tx, schritte) {
        const befunde: BefundSchritt[] = [];
        const bleibt: FeldSchritt[] = [];
        for (const schritt of schritte) {
            // Ein Eintrag der Redaktion fasst die Übernahme nicht an, auch nicht seinen Wiki-Stand (der Leser gibt jedes seiner Felder als eigen aus; das hier ist die zweite Sicherung).
            if (schritt.objekt.vorkommen?.redaktion === true) continue;
            if (schritt.wirksam !== undefined && schritt.wirksam.nachher === null && PFLICHT.has(schritt.feld)) {
                befunde.push({
                    objektId: schritt.objekt.id,
                    objektArt: "lore",
                    objektName: schritt.objekt.name,
                    feld: schritt.feld,
                    befund: "wert_unzulaessig",
                    grund: "Ein Eintrag braucht einen Namen; das Wiki nennt keinen",
                });
                // Der Wiki-Wert hinter ↺ bleibt trotzdem ein Stand des Wikis; nur der Name des Eintrags wird nicht geleert.
                if (schritt.schnappschuss !== undefined)
                    bleibt.push({ objekt: schritt.objekt, feld: schritt.feld, schnappschuss: schritt.schnappschuss });
                continue;
            }
            bleibt.push(schritt);
        }
        return Promise.resolve({ schritte: bleibt, befunde });
    },

    async schreibeObjekt(tx, id, spalten) {
        const namen = Object.keys(spalten);
        // Eine Berührung ohne Spalte zählt die Revision trotzdem (`revision = revision` steht im Trigger), damit ein offener Entwurf im Fenster „Inhalte bearbeiten“ 409 bekommt.
        const [zeile] =
            namen.length === 0
                ? await tx<{ id: string; revision: number }[]>`
                      UPDATE lore_entry SET revision = revision WHERE public_id = ${id}::uuid AND is_active
                      RETURNING id::text AS id, revision::int AS revision
                  `
                : await tx<{ id: string; revision: number }[]>`
                      UPDATE lore_entry SET ${tx(spalten as Record<string, string | null>, ...namen)}
                       WHERE public_id = ${id}::uuid AND is_active
                      RETURNING id::text AS id, revision::int AS revision
                  `;
        if (zeile === undefined) throw new Error(`Eintrag ${id}: nicht zu schreiben (nicht gesperrt oder nicht aktiv)`);
        // Der Vermerk „wiki“ für jedes Feld, das jetzt einen Wert aus dem Wiki trägt; ein vorhandener Vermerk (auch `manual`) bleibt.
        const belegt = namen.filter((name) => (spalten[name] ?? null) !== null);
        if (belegt.length > 0) {
            await tx`
                INSERT INTO lore_entry_field_origin (lore_entry_id, field, origin)
                SELECT ${zeile.id}::bigint, feld, 'wiki'
                  FROM unnest(${belegt}::text[]) AS feld
                 WHERE NOT EXISTS (
                           SELECT 1 FROM lore_entry_field_origin o WHERE o.lore_entry_id = ${zeile.id}::bigint AND o.field = feld
                       )
            `;
        }
        return zeile.revision;
    },

    async schreibeSchnappschuss(tx, snapshotId, spalten, marken) {
        const namen = Object.keys(spalten);
        const bekannt = marken?.bekannt ?? [];
        const unbekannt = marken?.unbekannt ?? [];
        if (namen.length > 0) {
            await tx`UPDATE wiki_lore_snapshot SET ${tx(spalten as Record<string, string | null>, ...namen)} WHERE id = ${snapshotId}::bigint`;
        }
        // Die Marken: ein geschriebener Wert nimmt sein Feld aus „unbekannt“, die Rücknahme setzt es wieder hinein.
        await tx`
            UPDATE wiki_lore_snapshot
               SET unbekannt = ARRAY(SELECT DISTINCT f FROM unnest(unbekannt || ${unbekannt}::text[]) AS f WHERE f <> ALL(${bekannt}::text[])),
                   updated_at = now()
             WHERE id = ${snapshotId}::bigint
        `;
    },
};
