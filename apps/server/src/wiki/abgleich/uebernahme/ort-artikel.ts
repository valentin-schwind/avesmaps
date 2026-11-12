import type { Queryable } from "../../../database.ts";
import type { MapAuditEntry, MapChange } from "../../../editor/map-operation.ts";
import { KONTINENT_VORGABE } from "../../kategorien/konstanten.ts";
import { VORSCHAU_TEXT_MAX } from "../ablage.ts";
import { landmarkeAdresse } from "../landmarken.ts";
import { ladeOrtArtikel } from "../lokal.ts";
import {
    istNeuerOrtArtikel,
    leseStandortOrte,
    ORT_ARTIKEL_ART,
    ORT_ARTIKEL_PLANFELDER,
    ortArtikelSchluessel,
    ortArtikelStandSchluessel,
} from "../ort-artikel.ts";
import type { PlanObjekt } from "../plan.ts";
import { ARTIKEL_FELD } from "../sprachen.ts";
import type { VorschauZeile } from "./protokoll.ts";
import {
    auditSchluessel,
    type BefundSchritt,
    type ListenErgebnis,
    type ListenSchreiber,
    type Schreiber,
} from "./schreiber.ts";

/**
 * Die Übernahme und Rücknahme der Orts- und Bauwerk-Artikel ohne Ort (WI-0295; im Bereich `ort` neben `ortSchreiber`), nach dem Muster der Wiki-Einträge ohne Fläche (`region-artikel.ts`) und der
 * Landmarken-Artikel (`landmarken.ts`). Ein Objekt ist eine Zeile der Registry `wiki_settlement_registry` mit `source_system = 'wikisync'`; jedes Feld folgt dem Wiki. Geschrieben werden:
 *
 * - **An der Registry** (Ortsliste „Nicht auf der Karte“, Innerorts der Besucher): Ortsklasse, Bauwerkart, Ruine, Lage und Standort; der Kontinent ist Aventurien (nur aventurische Artikel werden ein Eintrag).
 *   EIN UPDATE je Objekt, die Revision zählt der Trigger einmal.
 * - **Die genannten Orte** (`wiki_settlement_registry_named_place`) aus dem Feld `standort_orte`: ersetzt, wenn es sich ändert.
 * - **Am Wiki-Stand** (`wiki_settlement_snapshot`, dieselbe Seite; die Wiki-Box sucht darin): Name, Ortsklasse (nur eine bekannte, sonst keine), Bauwerkart, Ruine und die Felder der Infobox. Nur ein Stand
 *   des WikiSync (`source_system = 'wikisync'`), und nur, solange kein Ort ihn trägt: Dann gehört er dem Abgleich der Orte.
 * - **Der Lebenslauf** (`artikel`): Der Wert ist der Titel. Wird er leer, legen Registry und Wiki-Stand still (`retired_origin = 'wikisync'`); wird er wieder ein Titel, leben sie auf.
 * - **Neue Artikel** über den Listen-Schreiber: angelegt nach allen Schreibzugriffen (`schliesseAb`), mit allen Feldern, die das Wiki nennt. Die Rücknahme legt sie über das Feld `artikel` still.
 *
 * 🔴 Nie ein Ort, nie eine Zuordnung, nie eine Zeile Legacys. Kein Wert geht in ein abgeleitetes Ergebnis der Karte ein (`leitetAb`: nie).
 */

/** Feld des Plans → Spalte im Sinn des Abgleichs: jedes Feld ist eines des Objekts (`schreibeObjekt` verteilt sie auf Registry, genannte Orte und Wiki-Stand). */
const SPALTEN: Readonly<Record<string, string>> = Object.fromEntries(
    ORT_ARTIKEL_PLANFELDER.map((feld) => [feld, feld]),
);

/** Felder an der Registry → Spalte. Die Ortsklasse ist dort Pflicht: ohne bekannte Klasse „dorf“ (geraten, wie Legacy). */
const REGISTRY: Readonly<Record<string, string>> = {
    settlement_class: "settlement_class",
    building_type: "building_type",
    lage: "lage",
    standort: "standort",
};

/** Felder am Wiki-Stand → Spalte. */
const STAND: Readonly<Record<string, string>> = {
    name: "wiki_name",
    settlement_class: "settlement_class",
    building_type: "building_type",
    einwohner: "einwohner",
    oberhaupt: "oberhaupt",
    region_text: "region_text",
    staat_text: "staat_text",
    handelszone: "handelszone",
    verkehrswege: "verkehrswege",
    bevoelkerung: "bevoelkerung",
    tempel: "tempel",
    description: "description",
};

/** Die Klasse, wenn das Wiki keine nennt (Legacys Rückfall, `avesmapsWikiSettlementParseInfobox`): geraten. */
const KLASSE_GERATEN = "dorf";

const gekuerzt = (wert: string | null): boolean => wert !== null && Array.from(wert).length >= VORSCHAU_TEXT_MAX;

/** Ein Artikel, den die Übernahme anlegt: Titel und die Werte der Felder (Feld → Wert). */
export interface OrtArtikelAnlage {
    objekt: PlanObjekt;
    titel: string;
    werte: Record<string, string>;
}

function platzhalter(id: string, titel: string): PlanObjekt {
    return {
        bereich: "ort",
        objektArt: ORT_ARTIKEL_ART,
        id,
        name: titel,
        adresse: null,
        zustand: "zugewiesen",
        herkunft: null,
        hauptzuweisung: true,
        lokal: new Map(),
        schnappschuss: null,
        schnappschussUnbekannt: new Set(),
    };
}

/**
 * Entscheidet die Zeilen der neuen Artikel gegen den Stand von jetzt (REIN). Nur ein Artikel, dessen Zeile `artikel` die Vorschau übernehmen wollte, wird angelegt; steht er inzwischen im Bestand, ist das ein
 * Befund. Ein gekürzter Wert wird nie geschrieben.
 */
export function entscheideNeueOrtArtikel(
    zeilen: readonly VorschauZeile[],
    objekte: ReadonlyMap<string, PlanObjekt>,
): ListenErgebnis<OrtArtikelAnlage> {
    const ergebnis: ListenErgebnis<OrtArtikelAnlage> = { schritte: [], befunde: [], schonGleich: 0 };
    const jeArtikel = new Map<string, VorschauZeile[]>();
    for (const zeile of zeilen) {
        if (zeile.objektId === null) continue;
        jeArtikel.set(zeile.objektId, [...(jeArtikel.get(zeile.objektId) ?? []), zeile]);
    }
    const bestand = new Set<string>();
    for (const objekt of objekte.values()) {
        if (objekt.ortArtikel !== undefined) bestand.add(objekt.ortArtikel.schluessel);
    }
    const uebernimmt = (zeile: VorschauZeile): boolean =>
        zeile.eigentuemer === "wiki" && zeile.wirkung === "uebernommen";

    for (const [id, liste] of jeArtikel) {
        const kopf = liste.find((zeile) => zeile.feld === ARTIKEL_FELD);
        if (kopf === undefined || !uebernimmt(kopf) || kopf.neu === null || kopf.neuZustand !== "text") continue;
        const titel = kopf.neu;
        const befund = (feld: string, art: BefundSchritt["befund"], grund: string): void => {
            ergebnis.befunde.push({
                objektId: id,
                objektArt: ORT_ARTIKEL_ART,
                objektName: titel,
                feld,
                befund: art,
                grund,
            });
        };
        if (bestand.has(ortArtikelSchluessel(titel))) {
            befund(ARTIKEL_FELD, "seit_vorschau_geaendert", "Der Orts-Artikel steht inzwischen im Bestand");
            continue;
        }
        const werte: Record<string, string> = {};
        for (const zeile of liste) {
            if (zeile.feld === ARTIKEL_FELD || !uebernimmt(zeile) || SPALTEN[zeile.feld] === undefined) continue;
            if (gekuerzt(zeile.neu)) {
                befund(zeile.feld, "wert_gekuerzt", "Die Vorschau hat den Wert gekürzt");
                continue;
            }
            if (zeile.neuZustand === "text" && zeile.neu !== null && zeile.neu.trim() !== "")
                werte[zeile.feld] = zeile.neu;
        }
        ergebnis.schritte.push({ objekt: platzhalter(id, titel), titel, werte });
    }
    return ergebnis;
}

/** Schreibt die genannten Orte einer Zeile der Registry neu (alle weg, dann in der Reihenfolge des Werts). */
async function schreibeGenannteOrte(tx: Queryable, registryId: string, wert: string | null): Promise<void> {
    await tx`DELETE FROM wiki_settlement_registry_named_place WHERE registry_id = ${registryId}::bigint`;
    const orte = leseStandortOrte(wert);
    for (const [position, ort] of orte.entries()) {
        await tx`
            INSERT INTO wiki_settlement_registry_named_place (registry_id, position, target_raw, target_key)
            VALUES (${registryId}::bigint, ${position}, ${ort.ziel}, ${ort.schluessel})
        `;
    }
}

/**
 * Legt die neuen Artikel an (nach allen Schreibzugriffen der Übernahme) und liefert das Fachprotokoll: je Artikel ein Eintrag, jedes Feld mit `before: null`. Ist der Schlüssel seit der Rechnung vergeben (zwei Titel
 * ergeben denselben Key, oder jemand legte ihn an), bleibt die vorhandene Zeile, wie sie ist; ein Wiki-Stand mit dem Schlüssel ebenso.
 */
async function legeNeueOrtArtikelAn(
    tx: Queryable,
    schritte: readonly OrtArtikelAnlage[],
): Promise<{
    entries: MapAuditEntry[];
    affected: { kind: string; id: string; revision: number }[];
    zahlen: Record<string, number>;
}> {
    const entries: MapAuditEntry[] = [];
    const affected: { kind: string; id: string; revision: number }[] = [];
    let angelegt = 0;
    for (const schritt of schritte) {
        const w = (feld: string): string | null => schritt.werte[feld] ?? null;
        const schluessel = ortArtikelSchluessel(schritt.titel);
        const adresse = landmarkeAdresse(schritt.titel);
        const ruine = w("ruine") === "ja";
        const [zeile] = await tx<{ id: string; public_id: string; revision: number }[]>`
            INSERT INTO wiki_settlement_registry (wiki_key, title, wiki_url, settlement_class, building_type, is_ruined, continent, lage, standort, source_system)
            VALUES (${schluessel}, ${schritt.titel}, ${adresse}, ${w("settlement_class") ?? KLASSE_GERATEN}, ${w("building_type")}, ${ruine},
                    ${KONTINENT_VORGABE}, ${w("lage")}, ${w("standort")}, 'wikisync')
            ON CONFLICT (wiki_key) DO NOTHING
            RETURNING id::text AS id, public_id::text AS public_id, revision::int AS revision
        `;
        if (zeile === undefined) continue;
        angelegt += 1;
        await schreibeGenannteOrte(tx, zeile.id, w("standort_orte"));
        await tx`
            INSERT INTO wiki_settlement_snapshot (wiki_key, wiki_url, wiki_title, wiki_name, settlement_class, settlement_class_guessed, building_type, is_ruined,
                                                  einwohner, oberhaupt, region_text, staat_text, handelszone, verkehrswege, bevoelkerung, tempel, description, synced_at, source_system)
            VALUES (${ortArtikelStandSchluessel(schluessel)}, ${adresse}, ${schritt.titel}, ${w("name")}, ${w("settlement_class")},
                    ${w("settlement_class") === null ? null : false}, ${w("building_type")}, ${ruine}, ${w("einwohner")}, ${w("oberhaupt")}, ${w("region_text")},
                    ${w("staat_text")}, ${w("handelszone")}, ${w("verkehrswege")}, ${w("bevoelkerung")}, ${w("tempel")}, ${w("description")}, now(), 'wikisync')
            ON CONFLICT (wiki_key) DO NOTHING
        `;
        const changes: Record<string, MapChange> = {
            [auditSchluessel(ARTIKEL_FELD, "wirksam")]: { before: null, after: schritt.titel },
        };
        for (const feld of ORT_ARTIKEL_PLANFELDER) {
            const wert = schritt.werte[feld];
            if (feld !== ARTIKEL_FELD && wert !== undefined)
                changes[auditSchluessel(feld, "wirksam")] = { before: null, after: wert };
        }
        entries.push({
            action: "ort_artikel.wikisync_uebernommen",
            ortArtikelId: zeile.public_id,
            revisionBefore: null,
            revisionAfter: zeile.revision,
            changes,
        });
        affected.push({ kind: ORT_ARTIKEL_ART, id: zeile.public_id, revision: zeile.revision });
    }
    return { entries, affected, zahlen: { angelegt } };
}

/** Der Listen-Schreiber der neuen Artikel: wie bei den Landmarken; ein Objekt des Bestands berührt er nie, die Rücknahme geht den Weg der Felder. */
const neueOrtArtikel: ListenSchreiber<OrtArtikelAnlage> = {
    feldGehoert: (_feld, zeile) => istNeuerOrtArtikel(zeile),
    auditSchluessel: "artikel_neu",
    entscheide: entscheideNeueOrtArtikel,
    schreibe: () => Promise.resolve(new Map<string, MapChange>()),
    schliesseAb: legeNeueOrtArtikelAn,
    nimmZurueck: () => Promise.resolve({ change: null, befunde: [], anzahl: 0 }),
};

/**
 * Das SET eines UPDATE: je Feld seine Spalte, `$n` als Platzhalter. Die Namen der Spalten stammen allein aus den festen Tafeln oben (nie aus einer Zeile), die Werte gehen als Parameter.
 */
function setze(
    tafel: Readonly<Record<string, string>>,
    felder: Readonly<Record<string, string | null>>,
    werte: unknown[],
): string[] {
    const sets: string[] = [];
    for (const [feld, spalte] of Object.entries(tafel)) {
        if (!Object.hasOwn(felder, feld)) continue;
        const wert = felder[feld] ?? null;
        werte.push(tafel === REGISTRY && feld === "settlement_class" ? (wert ?? KLASSE_GERATEN) : wert);
        sets.push(`${spalte} = $${String(werte.length)}`);
    }
    return sets;
}

export const ortArtikelSchreiber: Schreiber = {
    bereich: "ort",
    objekte: ladeOrtArtikel,
    protokollArt: "ort_artikel",
    objektArt: ORT_ARTIKEL_ART,
    affectedArt: ORT_ARTIKEL_ART,
    eintragZiel: (id) => ({ ortArtikelId: id }),
    zielSpalte: "ort_artikel_public_id",
    wirksameSpalten: SPALTEN,
    // Die Zeile IST der Wiki-Stand: Es gibt nichts hinter ↺, jede Spalte folgt dem Wiki.
    schnappschussSpalten: {},
    fuelltLeereFelder: true,
    liste: neueOrtArtikel,
    leitetAb: () => false,

    async sperre(tx, ids) {
        if (ids.length === 0) return new Map();
        const zeilen = await tx<{ id: string; revision: number }[]>`
            SELECT public_id::text AS id, revision::int AS revision
              FROM wiki_settlement_registry
             WHERE public_id = ANY(${[...ids]}::uuid[]) AND source_system = 'wikisync'
             ORDER BY public_id
               FOR NO KEY UPDATE
        `;
        return new Map(zeilen.map((zeile) => [zeile.id, zeile.revision]));
    },

    schnappschussIds: () => Promise.resolve(new Map()),

    pruefe: (_tx, schritte) => Promise.resolve({ schritte: [...schritte], befunde: [] }),

    async schreibeObjekt(tx, id, spalten) {
        const [zeile] = await tx<{ id: string; wiki_key: string; title: string }[]>`
            SELECT id::text AS id, wiki_key, title FROM wiki_settlement_registry WHERE public_id = ${id}::uuid AND source_system = 'wikisync'
        `;
        if (zeile === undefined) throw new Error(`Orts-Artikel ${id}: nicht zu schreiben (nicht gesperrt)`);
        const artikel = spalten[ARTIKEL_FELD];

        // 1. Die Registry: EIN UPDATE (Lebenslauf und Felder), die Revision zählt der Trigger einmal; ohne Feld nur berührt.
        const werte: unknown[] = [];
        const sets = setze(REGISTRY, spalten, werte);
        if (Object.hasOwn(spalten, "ruine")) {
            werte.push(spalten["ruine"] === "ja");
            sets.push(`is_ruined = $${String(werte.length)}`);
        }
        if (artikel === null) {
            sets.push("is_active = FALSE", "retired_at = now()", "retired_origin = 'wikisync'");
        } else if (artikel !== undefined) {
            werte.push(landmarkeAdresse(artikel));
            sets.push(
                `wiki_url = $${String(werte.length)}`,
                "is_active = TRUE",
                "retired_at = NULL",
                "retired_origin = NULL",
            );
        }
        werte.push(zeile.id);
        const [danach] = await tx.unsafe<{ revision: number }[]>(
            `UPDATE wiki_settlement_registry SET ${sets.length === 0 ? "revision = revision" : sets.join(", ")}
              WHERE id = $${String(werte.length)}::bigint
          RETURNING revision::int AS revision`,
            werte as never[],
        );

        // 2. Die genannten Orte.
        if (Object.hasOwn(spalten, "standort_orte"))
            await schreibeGenannteOrte(tx, zeile.id, spalten["standort_orte"] ?? null);

        // 3. Der Wiki-Stand derselben Seite, nur der des WikiSync und nur, solange kein Ort ihn trägt.
        const standWerte: unknown[] = [];
        const standSets = setze(STAND, spalten, standWerte);
        if (Object.hasOwn(spalten, "settlement_class")) {
            standWerte.push(spalten["settlement_class"] === null ? null : false);
            standSets.push(`settlement_class_guessed = $${String(standWerte.length)}`);
        }
        if (Object.hasOwn(spalten, "ruine")) {
            standWerte.push(spalten["ruine"] === "ja");
            standSets.push(`is_ruined = $${String(standWerte.length)}`);
        }
        if (artikel === null) {
            standSets.push("is_active = FALSE", "retired_at = now()", "retired_origin = 'wikisync'");
        } else if (artikel !== undefined) {
            standWerte.push(landmarkeAdresse(artikel), artikel);
            standSets.push(
                `wiki_url = $${String(standWerte.length - 1)}`,
                `wiki_title = $${String(standWerte.length)}`,
                "is_active = TRUE",
                "retired_at = NULL",
                "retired_origin = NULL",
            );
        }
        if (standSets.length > 0) {
            standWerte.push(ortArtikelStandSchluessel(zeile.wiki_key));
            await tx.unsafe(
                `UPDATE wiki_settlement_snapshot s SET ${standSets.join(", ")}, synced_at = now(), updated_at = now()
                  WHERE s.wiki_key = $${String(standWerte.length)} AND s.source_system = 'wikisync'
                    AND NOT EXISTS (SELECT 1 FROM place_wiki_assignment a WHERE a.snapshot_id = s.id AND a.is_active)`,
                standWerte as never[],
            );
        }
        if (danach === undefined) throw new Error(`Orts-Artikel ${id}: nicht geschrieben`);
        return danach.revision;
    },

    schreibeSchnappschuss: () => Promise.resolve(),
};
