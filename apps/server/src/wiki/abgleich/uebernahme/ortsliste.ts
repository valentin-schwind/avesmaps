import type { Database, Queryable } from "../../../database.ts";
import type { MapChange } from "../../../editor/map-operation.ts";
import { buildWikiKeyLookupOnly } from "../../../subjects/subject-index.ts";
import { lookupWikiKeyTargets, type WikiKeyKind, type WikiKeyLookup } from "../../../subjects/wiki-key-lookup.ts";
import { wikiSchluesselFuerTitel } from "../../schluessel.ts";
import { leseOrtsWert, ortsSchluessel, ortsStelle, type OrtsWert } from "../ortsliste.ts";
import type { PlanObjekt } from "../plan.ts";
import { artikelPasst } from "./entscheiden.ts";
import type { VorschauZeile } from "./protokoll.ts";
import type { BefundSchritt, ListenErgebnis, ListenSchreiber } from "./schreiber.ts";

/**
 * Die Übernahme und Rücknahme der Ortslisten (WI-0253, Scheibe Ortslisten der Literatur): die Zeilen `ort_<Stelle>` einer Vorschau in `adventure_place`. Die Vorschau
 * entscheidet in `../ortsliste.ts`; hier wird jede Zeile unter der Sperre des Werks noch einmal gegen den Stand von jetzt geprüft und dann geschrieben.
 *
 * - **Geprüft wird die Zeile, die die Vorschau sah:** an derselben Stelle, mit demselben Namen und derselben Rolle, und sie gehört noch dem Wiki (`legacy_origin = 'wiki'`).
 *   Sonst schreibt die Übernahme nichts und sagt `seit_vorschau_geaendert`. Steht der Ort schon so da, wie das Wiki ihn nennt, ist nichts zu tun.
 * - **Geschrieben** wird wie im Fenster „Inhalte bearbeiten“, nur mit der Herkunft des Wikis: ein neuer Ort ist eine neue Zeile (`legacy_origin = 'wiki'`,
 *   `source_system = 'wikisync'`), oder eine still gelegte Zeile mit demselben Namen an derselben Stelle lebt wieder auf; ein umbenannter Ort legt die alte Zeile still und
 *   legt eine neue an (der Name gehört zur Identität, Migration 0068); ein entfallener wird still gelegt (`retired_origin = 'wikisync'`, Migration 0241). Gelöscht wird nie.
 *   Name und Rolle allein (derselbe Schlüssel) ändern die Zeile an Ort und Stelle.
 * - **Das Ziel eines neuen Orts** ist der Artikel, auf den er verlinkt: über die Zuordnung X2 (`wiki:` + Legacys Slug, `subjects/wiki-key-lookup.ts`, derselbe Lookup wie bei
 *   den Vorkommen), nie über einen Namen. In Legacys Reihenfolge Ort, Gebiet, Landschaft oder Gipfel, Weg; trägt die erste Art, die trifft, mehr als ein Objekt, bleibt der Ort
 *   ohne Ziel (`unmatched`), ohne Treffer ist er ungeklärt (`unresolved`). Eine Weiterleitung des Wikis wird dabei nicht aufgelöst (heute kein Fall, WI-0253 §18).
 * - **Das Fachprotokoll** trägt wie beim Editor `places` mit den aktiven Zeilen vorher und nachher (`{ rowId, name, role, kind }`); daraus nimmt die Rücknahme zurück.
 */

/** Ein Schritt an der Ortsliste eines Werks. */
export type OrtsSchritt =
    | { art: "anlegen"; objekt: PlanObjekt; stelle: number; neu: OrtsWert }
    | { art: "aendern"; objekt: PlanObjekt; zeile: string; neu: OrtsWert }
    | { art: "ersetzen"; objekt: PlanObjekt; zeile: string; stelle: number; neu: OrtsWert }
    | { art: "entfernen"; objekt: PlanObjekt; zeile: string };

/** Eine Zeile der Ortsliste im Fachprotokoll (wie `work.update` im Editor). */
interface OrtProtokoll {
    rowId: string;
    name: string;
    role: string;
    kind?: string;
}

const GRUND_GEAENDERT = "Der Ort an dieser Stelle hat sich seit der Vorschau geändert";

/**
 * Entscheidet die Zeilen der Ortsliste gegen den Stand von jetzt (REIN). Nur Zeilen, die die Vorschau übernehmen wollte (Eigentümer `wiki`, Wirkung `uebernommen`), werden
 * Schritte; alle anderen hat sie schon als Befund oder eigenen Wert gezeigt.
 */
export function entscheideOrte(
    zeilen: readonly VorschauZeile[],
    objekte: ReadonlyMap<string, PlanObjekt>,
): ListenErgebnis<OrtsSchritt> {
    const ergebnis: ListenErgebnis<OrtsSchritt> = { schritte: [], befunde: [], schonGleich: 0 };
    for (const zeile of zeilen) {
        const stelle = ortsStelle(zeile.feld);
        if (stelle === null || zeile.eigentuemer !== "wiki" || zeile.wirkung !== "uebernommen") continue;
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
            befund("Das Werk ist nicht mehr da");
            continue;
        }
        if (!artikelPasst(zeile, objekt)) {
            befund("Das Werk hängt inzwischen an einem anderen Artikel", objekt.name);
            continue;
        }
        const bestand = objekt.ortsliste;
        if (bestand === undefined) continue;
        if (bestand.redaktion) {
            befund("Das Werk gehört inzwischen der Redaktion", objekt.name);
            continue;
        }
        const alt = leseOrtsWert(zeile.alt);
        const neu = leseOrtsWert(zeile.neu);
        const aktiv = bestand.zeilen.filter((kandidat) => kandidat.zustand === "active" && kandidat.stelle === stelle);
        if (neu !== null && aktiv.some((kandidat) => kandidat.name === neu.name && kandidat.rolle === neu.rolle)) {
            ergebnis.schonGleich += 1;
            continue;
        }
        const unterdrueckt = (name: string): boolean =>
            bestand.zeilen.some(
                (kandidat) => kandidat.zustand === "suppressed" && kandidat.schluessel === ortsSchluessel(name),
            );
        if (alt === null) {
            if (neu === null) continue;
            if (unterdrueckt(neu.name)) {
                befund("Die Redaktion hat den Ort inzwischen aus der Liste genommen", objekt.name);
            } else if (aktiv.some((kandidat) => kandidat.herkunft !== "manual")) {
                befund(GRUND_GEAENDERT, objekt.name);
            } else if (
                bestand.zeilen.some(
                    (kandidat) =>
                        kandidat.zustand === "active" &&
                        kandidat.stelle !== stelle &&
                        kandidat.herkunft !== "wiki" &&
                        kandidat.schluessel === ortsSchluessel(neu.name),
                )
            ) {
                befund("Der Ort steht inzwischen an einer anderen Stelle der Liste", objekt.name);
            } else {
                ergebnis.schritte.push({ art: "anlegen", objekt, stelle, neu });
            }
            continue;
        }
        const gesehen = aktiv.find(
            (kandidat) => kandidat.herkunft === "wiki" && kandidat.name === alt.name && kandidat.rolle === alt.rolle,
        );
        if (gesehen === undefined) {
            // Ein entfallener Ort, der schon fort ist, ist erledigt; jeder andere Unterschied ist ein Befund.
            if (neu === null && !aktiv.some((kandidat) => kandidat.schluessel === ortsSchluessel(alt.name))) {
                ergebnis.schonGleich += 1;
            } else {
                befund(GRUND_GEAENDERT, objekt.name);
            }
            continue;
        }
        if (neu === null) ergebnis.schritte.push({ art: "entfernen", objekt, zeile: gesehen.id });
        else if (ortsSchluessel(neu.name) === gesehen.schluessel)
            ergebnis.schritte.push({ art: "aendern", objekt, zeile: gesehen.id, neu });
        else if (unterdrueckt(neu.name))
            befund("Die Redaktion hat den Ort inzwischen aus der Liste genommen", objekt.name);
        else ergebnis.schritte.push({ art: "ersetzen", objekt, zeile: gesehen.id, stelle, neu });
    }
    return ergebnis;
}

// ----------------------------------------------------------------------------------------------------------------------------
// Ziel eines neuen Orts
// ----------------------------------------------------------------------------------------------------------------------------

type ZielSpalte = "place_id" | "territory_id" | "region_id" | "terrain_peak_id" | "path_id";

interface OrtsZiele {
    lookup: WikiKeyLookup;
    /** Je Spalte: öffentliche Kennung (klein) → interne Nummer der aktiven Zeile. */
    ids: Readonly<Record<ZielSpalte, ReadonlyMap<string, string>>>;
}

export interface OrtsZiel {
    zustand: "resolved" | "unresolved" | "unmatched";
    spalte?: ZielSpalte;
    id?: string;
}

/** Die Reihenfolge der Arten (Legacy `avesmapsGameLiteratureMatchCandidates`: Siedlung, Gebiet, Region, Weg); Landschaft und Gipfel sind beide Legacys „Region“. */
const STUFEN: readonly (readonly WikiKeyKind[])[] = [["place"], ["territory"], ["area", "peak"], ["path"]];

async function ladeZiele(tx: Queryable): Promise<OrtsZiele> {
    // Der Lookup liest nur (mehrere Abfragen); in der Transaktion sieht er den Stand unter der Sperre.
    const lookup = await buildWikiKeyLookupOnly(tx as unknown as Database);
    const nachKennung = async (tafel: string): Promise<Map<string, string>> => {
        const zeilen = await tx.unsafe<{ id: string; public_id: string }[]>(
            `SELECT id::text AS id, public_id::text AS public_id FROM ${tafel} WHERE is_active`,
        );
        return new Map(zeilen.map((zeile) => [zeile.public_id.toLowerCase(), zeile.id]));
    };
    return {
        lookup,
        ids: {
            place_id: await nachKennung("place"),
            territory_id: await nachKennung("territory"),
            region_id: await nachKennung("region"),
            terrain_peak_id: await nachKennung("terrain_peak"),
            path_id: await nachKennung("path"),
        },
    };
}

/** Das Ziel eines Orts: der Artikel, auf den der Name verlinkt, über die Zuordnung X2; nie über einen Namen. */
export function loeseOrtAuf(name: string, ziele: OrtsZiele): OrtsZiel {
    const schluessel = wikiSchluesselFuerTitel(name);
    if (schluessel === "") return { zustand: "unresolved" };
    const kandidaten = lookupWikiKeyTargets(ziele.lookup, schluessel);
    for (const stufe of STUFEN) {
        const treffer = new Map<string, { spalte: ZielSpalte; id: string }>();
        for (const ziel of kandidaten) {
            if (!stufe.includes(ziel.kind)) continue;
            const ref = ziel.ref as { kind: string; id?: string; anchor?: string };
            const spalte: ZielSpalte =
                ziel.kind === "place"
                    ? "place_id"
                    : ziel.kind === "territory"
                      ? "territory_id"
                      : ziel.kind === "area"
                        ? "region_id"
                        : ziel.kind === "peak"
                          ? "terrain_peak_id"
                          : "path_id";
            const kennung = (ref.kind === "path" ? ref.anchor : ref.id)?.toLowerCase();
            const id = kennung === undefined ? undefined : ziele.ids[spalte].get(kennung);
            if (id !== undefined) treffer.set(`${spalte}:${id}`, { spalte, id });
        }
        if (treffer.size === 1) {
            const [einer] = [...treffer.values()];
            return { zustand: "resolved", spalte: einer!.spalte, id: einer!.id };
        }
        if (treffer.size > 1) return { zustand: "unmatched" };
    }
    return { zustand: "unresolved" };
}

// ----------------------------------------------------------------------------------------------------------------------------
// Schreiben
// ----------------------------------------------------------------------------------------------------------------------------

interface Zeile {
    id: string;
    sort_order: number;
    name_key: string;
    dup_ordinal: number;
    raw_name: string;
    role: string;
    state: string;
    retired_origin: string | null;
    target_origin: string;
    source_system: string;
    place_id: string | null;
    territory_id: string | null;
    region_id: string | null;
    terrain_peak_id: string | null;
    path_id: string | null;
}

const ARTEN: readonly { spalte: ZielSpalte; kind: string }[] = [
    { spalte: "place_id", kind: "place" },
    { spalte: "territory_id", kind: "territory" },
    { spalte: "region_id", kind: "area" },
    { spalte: "terrain_peak_id", kind: "peak" },
    { spalte: "path_id", kind: "path" },
];

function protokoll(zeile: Zeile): OrtProtokoll {
    const art = ARTEN.find(({ spalte }) => zeile[spalte] !== null);
    return {
        rowId: zeile.id,
        name: zeile.raw_name,
        role: zeile.role,
        ...(art === undefined ? {} : { kind: art.kind }),
    };
}

async function werkId(tx: Queryable, publicId: string): Promise<string | undefined> {
    const [zeile] = await tx<
        { id: string }[]
    >`SELECT id::text AS id FROM adventure WHERE public_id = ${publicId}::uuid`;
    return zeile?.id;
}

async function zeilenDes(tx: Queryable, werk: string): Promise<Zeile[]> {
    return tx<Zeile[]>`
        SELECT id::text AS id, sort_order, name_key, dup_ordinal, raw_name, role, state, retired_origin, target_origin, source_system,
               place_id::text AS place_id, territory_id::text AS territory_id, region_id::text AS region_id,
               terrain_peak_id::text AS terrain_peak_id, path_id::text AS path_id
          FROM adventure_place WHERE adventure_id = ${werk}::bigint
         ORDER BY sort_order, export_ordinal, id
           FOR UPDATE
    `;
}

const aktiveListe = (zeilen: readonly Zeile[]): OrtProtokoll[] =>
    zeilen.filter((zeile) => zeile.state === "active").map(protokoll);

async function stillLegen(tx: Queryable, id: string): Promise<void> {
    await tx`
        UPDATE adventure_place
           SET state = 'retired', is_active = FALSE, retired_at = now(), retired_origin = 'wikisync', updated_at = now()
         WHERE id = ${id}::bigint AND state = 'active'
    `;
}

/** Die Spalten des Ziels: genau eine gesetzt (oder keine), dazu Zustand und Weg der Auflösung (`adventure_place_one_target_when_resolved`). */
function zielSpalten(ziel: OrtsZiel): Record<string, string | null> {
    const spalten: Record<string, string | null> = {
        target_state: ziel.zustand,
        resolved_by: ziel.zustand === "resolved" ? "wiki_key" : null,
    };
    for (const { spalte } of ARTEN) spalten[spalte] = ziel.spalte === spalte ? (ziel.id ?? null) : null;
    return spalten;
}

/** Ein Ort kommt an eine Stelle: eine still gelegte Zeile desselben Namens an derselben Stelle lebt wieder auf, sonst eine neue Zeile. */
async function legeAn(
    tx: Queryable,
    werk: string,
    zeilen: readonly Zeile[],
    stelle: number,
    neu: OrtsWert,
    ziel: OrtsZiel,
): Promise<void> {
    const schluessel = ortsSchluessel(neu.name);
    const ruhend = zeilen.find(
        (zeile) =>
            zeile.state === "retired" &&
            zeile.sort_order === stelle &&
            zeile.name_key === schluessel &&
            zeile.target_origin !== "editor" &&
            zeile.source_system !== "editor",
    );
    const zielWerte = zielSpalten(ziel);
    if (ruhend !== undefined) {
        const werte: Record<string, string | null> = { ...zielWerte, raw_name: neu.name, role: neu.rolle };
        await tx`
            UPDATE adventure_place
               SET ${tx(werte, ...Object.keys(werte))},
                   state = 'active', is_active = TRUE, retired_at = NULL, retired_origin = NULL, legacy_origin = 'wiki', updated_at = now()
             WHERE id = ${ruhend.id}::bigint
        `;
        return;
    }
    const belegt = new Set(
        zeilen.map((zeile) => `${String(zeile.sort_order)}|${zeile.name_key}|${String(zeile.dup_ordinal)}`),
    );
    let ordnung = 0;
    while (belegt.has(`${String(stelle)}|${schluessel}|${String(ordnung)}`)) ordnung += 1;
    await tx`
        INSERT INTO adventure_place ${tx({
            adventure_id: werk,
            sort_order: stelle,
            export_ordinal: stelle,
            name_key: schluessel,
            dup_ordinal: ordnung,
            raw_name: neu.name,
            role: neu.rolle,
            ...zielWerte,
            target_origin: "legacy_import",
            legacy_origin: "wiki",
            state: "active",
            source_system: "wikisync",
            is_active: true,
        } as Record<string, string | number | boolean | null>)}
    `;
}

/** Schreibt die Schritte, je Werk in einem Zug; liefert je Werk die aktiven Zeilen vorher und nachher fürs Fachprotokoll. */
async function schreibeOrte(tx: Queryable, schritte: readonly OrtsSchritt[]): Promise<Map<string, MapChange>> {
    const jeWerk = new Map<string, OrtsSchritt[]>();
    for (const schritt of schritte) jeWerk.set(schritt.objekt.id, [...(jeWerk.get(schritt.objekt.id) ?? []), schritt]);
    const aenderungen = new Map<string, MapChange>();
    let ziele: OrtsZiele | undefined;
    for (const [publicId, liste] of [...jeWerk].sort(([a], [b]) => (a < b ? -1 : 1))) {
        const werk = await werkId(tx, publicId);
        if (werk === undefined) continue;
        const vorher = await zeilenDes(tx, werk);
        const nachId = new Map(vorher.map((zeile) => [zeile.id, zeile]));
        // Erst still legen (entfallen, ersetzt), dann an Ort und Stelle ändern, dann anlegen: So belegt keine neue Zeile einen Schlüssel, der gerade frei wird.
        for (const schritt of liste) {
            if (schritt.art === "entfernen" || schritt.art === "ersetzen") await stillLegen(tx, schritt.zeile);
        }
        for (const schritt of liste) {
            if (schritt.art !== "aendern" || nachId.get(schritt.zeile)?.state !== "active") continue;
            await tx`
                UPDATE adventure_place SET raw_name = ${schritt.neu.name}, role = ${schritt.neu.rolle}, updated_at = now()
                 WHERE id = ${schritt.zeile}::bigint
            `;
        }
        for (const schritt of liste) {
            if (schritt.art !== "anlegen" && schritt.art !== "ersetzen") continue;
            ziele ??= await ladeZiele(tx);
            await legeAn(
                tx,
                werk,
                await zeilenDes(tx, werk),
                schritt.stelle,
                schritt.neu,
                loeseOrtAuf(schritt.neu.name, ziele),
            );
        }
        const nachher = await zeilenDes(tx, werk);
        const davor = aktiveListe(vorher);
        const danach = aktiveListe(nachher);
        if (JSON.stringify(davor) !== JSON.stringify(danach))
            aenderungen.set(publicId, { before: davor, after: danach });
    }
    return aenderungen;
}

// ----------------------------------------------------------------------------------------------------------------------------
// Rücknahme
// ----------------------------------------------------------------------------------------------------------------------------

const liste = (wert: unknown): OrtProtokoll[] =>
    Array.isArray(wert)
        ? wert.filter(
              (eintrag): eintrag is OrtProtokoll =>
                  typeof eintrag === "object" &&
                  eintrag !== null &&
                  typeof (eintrag as OrtProtokoll).rowId === "string",
          )
        : [];

/**
 * Nimmt die Ortsliste einer Übernahme zurück: was sie anlegte (oder wiederbelebte), wird still gelegt, was sie still legte, lebt wieder auf, eine geänderte Rolle oder
 * Schreibung kehrt zurück. Je Zeile nur, wo der Stand noch der der Übernahme ist; sonst ein Befund. Ein Werk, das inzwischen der Redaktion gehört, bleibt ganz.
 */
async function nimmOrteZurueck(
    tx: Queryable,
    publicId: string,
    wechsel: MapChange,
    objekt: PlanObjekt | undefined,
): Promise<{ change: MapChange | null; befunde: BefundSchritt[]; anzahl: number }> {
    const befunde: BefundSchritt[] = [];
    const befund = (grund: string): void => {
        befunde.push({
            objektId: publicId,
            objektArt: "work",
            objektName: objekt?.name ?? null,
            feld: "places",
            befund: "seit_uebernahme_geaendert",
            grund,
        });
    };
    if (objekt?.ortsliste?.redaktion === true) {
        befund("Die Ortsliste gehört inzwischen der Redaktion");
        return { change: null, befunde, anzahl: 0 };
    }
    const werk = await werkId(tx, publicId);
    if (werk === undefined) return { change: null, befunde, anzahl: 0 };
    const vorher = liste(wechsel.before);
    const nachher = liste(wechsel.after);
    const zeilen = await zeilenDes(tx, werk);
    const nachId = new Map(zeilen.map((zeile) => [zeile.id, zeile]));
    const davorIds = new Set(vorher.map((eintrag) => eintrag.rowId));
    const danachIds = new Set(nachher.map((eintrag) => eintrag.rowId));
    let anzahl = 0;
    for (const eintrag of nachher) {
        const zeile = nachId.get(eintrag.rowId);
        if (davorIds.has(eintrag.rowId)) {
            const alt = vorher.find((kandidat) => kandidat.rowId === eintrag.rowId) as OrtProtokoll;
            if (alt.name === eintrag.name && alt.role === eintrag.role) continue;
            if (zeile?.state !== "active" || zeile.raw_name !== eintrag.name || zeile.role !== eintrag.role) {
                befund(`Der Ort „${eintrag.name}“ wurde seit der Übernahme geändert`);
                continue;
            }
            await tx`UPDATE adventure_place SET raw_name = ${alt.name}, role = ${alt.role}, updated_at = now() WHERE id = ${zeile.id}::bigint`;
            anzahl += 1;
            continue;
        }
        if (zeile?.state !== "active" || zeile.raw_name !== eintrag.name || zeile.role !== eintrag.role) {
            befund(`Der Ort „${eintrag.name}“ wurde seit der Übernahme geändert`);
            continue;
        }
        await stillLegen(tx, zeile.id);
        anzahl += 1;
    }
    for (const eintrag of vorher) {
        if (danachIds.has(eintrag.rowId)) continue;
        const zeile = nachId.get(eintrag.rowId);
        if (zeile?.state !== "retired" || zeile.retired_origin !== "wikisync") {
            befund(`Der Ort „${eintrag.name}“ wurde seit der Übernahme geändert`);
            continue;
        }
        await tx`
            UPDATE adventure_place
               SET state = 'active', is_active = TRUE, retired_at = NULL, retired_origin = NULL, role = ${eintrag.role}, updated_at = now()
             WHERE id = ${zeile.id}::bigint
        `;
        anzahl += 1;
    }
    if (anzahl === 0) return { change: null, befunde, anzahl };
    const danach = await zeilenDes(tx, werk);
    return { change: { before: aktiveListe(zeilen), after: aktiveListe(danach) }, befunde, anzahl };
}

/** Der Listen-Schreiber der Literatur: die Ortsliste. */
export const ortslistenSchreiber: ListenSchreiber<OrtsSchritt> = {
    feldGehoert: (feld) => ortsStelle(feld) !== null,
    auditSchluessel: "places",
    entscheide: entscheideOrte,
    schreibe: schreibeOrte,
    nimmZurueck: nimmOrteZurueck,
};
