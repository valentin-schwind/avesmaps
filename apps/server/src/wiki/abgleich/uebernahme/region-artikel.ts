import type { Queryable } from "../../../database.ts";
import type { MapAuditEntry, MapChange } from "../../../editor/map-operation.ts";
import { landmarkeSchluessel } from "../../infobox/landmarke.ts";
import { wikiLinkKey } from "@avesmaps3d/shared";
import { VORSCHAU_TEXT_MAX } from "../ablage.ts";
import { landmarkeAdresse } from "../landmarken.ts";
import { ladeRegionArtikel } from "../lokal.ts";
import type { PlanObjekt } from "../plan.ts";
import { neueRegionArtikelId, REGION_ARTIKEL_ART } from "../region-artikel.ts";
import { ARTIKEL_FELD } from "../sprachen.ts";
import { LANDSCHAFTS_STAND, schreibeLandschaftsStand } from "./landschafts-stand.ts";
import type { VorschauZeile } from "./protokoll.ts";
import {
    auditSchluessel,
    type BefundSchritt,
    type ListenErgebnis,
    type ListenSchreiber,
    type Schreiber,
} from "./schreiber.ts";

/**
 * Die Übernahme und Rücknahme der Wiki-Einträge ohne Fläche (WI-0284; im Bereich `region` neben `regionSchreiber`), nach dem Muster der Landmarken-Artikel (`landmarken.ts`). Ein Objekt ist eine Zeile in
 * `wiki_region_snapshot`, an der keine Fläche hängt; jedes Feld folgt dem Wiki. Geschrieben wird:
 *
 * - **Die Felder** der Infobox als Spalten der Zeile und die Nachbarn als Zeilen, derselbe Weg wie der Wiki-Stand einer Landschaft (`schreibeLandschaftsStand`).
 * - **Der Lebenslauf** (`artikel`): Der Wert ist der Titel. Wird er leer, legt `schreibeObjekt` die Zeile still (`retired_origin = 'wikisync'`); wird er wieder ein Titel, lebt sie auf.
 * - **Neue Artikel** über den Listen-Schreiber: angelegt nach allen Schreibzugriffen (`schliesseAb`), mit allen Feldern, die das Wiki nennt. Die Rücknahme legt sie über das Feld `artikel` still.
 *
 * 🔴 Nie eine Fläche, nie eine Zuordnung. Hängt die Zeile an einer Fläche, lädt sie `ladeRegionArtikel` nicht: Sie gehört dann `regionSchreiber`. Kein Wert geht in ein abgeleitetes Ergebnis ein.
 */

/** Feld des Plans → Spalte; `artikel` ist keine Spalte: `schreibeObjekt` setzt daraus Adresse und Zustand. */
const SPALTEN: Readonly<Record<string, string>> = { [ARTIKEL_FELD]: ARTIKEL_FELD, ...LANDSCHAFTS_STAND };

const gekuerzt = (wert: string | null): boolean => wert !== null && Array.from(wert).length >= VORSCHAU_TEXT_MAX;

/** Ein Artikel, den die Übernahme anlegt: Titel und die Werte der Felder (Spalte → Wert). */
export interface RegionArtikelAnlage {
    objekt: PlanObjekt;
    titel: string;
    werte: Record<string, string>;
}

function platzhalter(id: string, titel: string): PlanObjekt {
    return {
        bereich: "region",
        objektArt: REGION_ARTIKEL_ART,
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

/** Gehört die Zeile zu einem Artikel, den der Bestand noch nicht hat? Ihre Kennung ist dann der Platzhalter ihres Artikels. */
export function istNeuerRegionArtikel(zeile: { objektId: string | null; artikel: string | null }): boolean {
    return (
        zeile.objektId !== null &&
        zeile.artikel !== null &&
        zeile.objektId === neueRegionArtikelId(landmarkeSchluessel(zeile.artikel))
    );
}

/**
 * Entscheidet die Zeilen der neuen Artikel gegen den Stand von jetzt (REIN). Nur ein Artikel, dessen Zeile `artikel` die Vorschau übernehmen wollte, wird angelegt; steht er inzwischen im Bestand, ist das ein
 * Befund. Ein gekürzter Wert wird nie geschrieben.
 */
export function entscheideNeueRegionArtikel(
    zeilen: readonly VorschauZeile[],
    objekte: ReadonlyMap<string, PlanObjekt>,
): ListenErgebnis<RegionArtikelAnlage> {
    const ergebnis: ListenErgebnis<RegionArtikelAnlage> = { schritte: [], befunde: [], schonGleich: 0 };
    const jeArtikel = new Map<string, VorschauZeile[]>();
    for (const zeile of zeilen) {
        if (zeile.objektId === null) continue;
        jeArtikel.set(zeile.objektId, [...(jeArtikel.get(zeile.objektId) ?? []), zeile]);
    }
    const bestand = new Set<string>();
    for (const objekt of objekte.values()) {
        if (objekt.regionArtikel !== undefined) bestand.add(objekt.regionArtikel.schluessel);
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
                objektArt: REGION_ARTIKEL_ART,
                objektName: titel,
                feld,
                befund: art,
                grund,
            });
        };
        if (bestand.has(landmarkeSchluessel(titel))) {
            befund(ARTIKEL_FELD, "seit_vorschau_geaendert", "Der Wiki-Eintrag steht inzwischen im Bestand");
            continue;
        }
        const werte: Record<string, string> = {};
        for (const zeile of liste) {
            if (zeile.feld === ARTIKEL_FELD || !uebernimmt(zeile)) continue;
            const spalte = SPALTEN[zeile.feld];
            if (spalte === undefined) continue;
            if (gekuerzt(zeile.neu)) {
                befund(zeile.feld, "wert_gekuerzt", "Die Vorschau hat den Wert gekürzt");
                continue;
            }
            if (zeile.neuZustand === "text" && zeile.neu !== null && zeile.neu.trim() !== "") werte[spalte] = zeile.neu;
        }
        ergebnis.schritte.push({ objekt: platzhalter(id, titel), titel, werte });
    }
    return ergebnis;
}

/**
 * Legt die neuen Artikel an (nach allen Schreibzugriffen der Übernahme) und liefert das Fachprotokoll: je Artikel ein Eintrag, jedes Feld mit `before: null`. Ist der Schlüssel seit der Rechnung vergeben (die
 * Zeile hängt inzwischen an einer Fläche oder zwei Titel ergeben denselben Schlüssel), bleibt die vorhandene Zeile, wie sie ist.
 */
async function legeNeueRegionArtikelAn(
    tx: Queryable,
    schritte: readonly RegionArtikelAnlage[],
): Promise<{
    entries: MapAuditEntry[];
    affected: { kind: string; id: string; revision: number }[];
    zahlen: Record<string, number>;
}> {
    const entries: MapAuditEntry[] = [];
    const affected: { kind: string; id: string; revision: number }[] = [];
    let angelegt = 0;
    for (const schritt of schritte) {
        const felder = Object.entries(schritt.werte);
        const einfach = felder.filter(([spalte]) => !spalte.startsWith("@"));
        const [zeile] = await tx.unsafe<{ id: string; public_id: string; revision: number }[]>(
            `INSERT INTO wiki_region_snapshot (wiki_key, wiki_url, source_system${einfach.map(([spalte]) => `, ${spalte}`).join("")})
             VALUES ($1, $2, 'avesmaps3d'${einfach.map((_feld, index) => `, $${String(index + 3)}`).join("")})
             ON CONFLICT (wiki_key) DO NOTHING
          RETURNING id::text AS id, public_id::text AS public_id, revision::int AS revision`,
            [
                wikiLinkKey(schritt.titel),
                landmarkeAdresse(schritt.titel),
                ...einfach.map(([, wert]) => wert),
            ] as never[],
        );
        if (zeile === undefined) continue;
        angelegt += 1;
        const nachbarn = Object.fromEntries(felder.filter(([spalte]) => spalte.startsWith("@")));
        if (Object.keys(nachbarn).length > 0) await schreibeLandschaftsStand(tx, zeile.id, nachbarn);
        const changes: Record<string, MapChange> = {
            [auditSchluessel(ARTIKEL_FELD, "wirksam")]: { before: null, after: schritt.titel },
        };
        for (const [feld, spalte] of Object.entries(SPALTEN)) {
            const wert = schritt.werte[spalte];
            if (wert !== undefined) changes[auditSchluessel(feld, "wirksam")] = { before: null, after: wert };
        }
        entries.push({
            action: "region_artikel.wikisync_uebernommen",
            regionArtikelId: zeile.public_id,
            revisionBefore: null,
            revisionAfter: zeile.revision,
            changes,
        });
        affected.push({ kind: REGION_ARTIKEL_ART, id: zeile.public_id, revision: zeile.revision });
    }
    return { entries, affected, zahlen: { angelegt } };
}

/** Der Listen-Schreiber der neuen Artikel: wie bei den Landmarken; ein Objekt des Bestands berührt er nie, die Rücknahme geht den Weg der Felder. */
const neueRegionArtikel: ListenSchreiber<RegionArtikelAnlage> = {
    feldGehoert: (_feld, zeile) => istNeuerRegionArtikel(zeile),
    auditSchluessel: "artikel_neu",
    entscheide: entscheideNeueRegionArtikel,
    schreibe: () => Promise.resolve(new Map<string, MapChange>()),
    schliesseAb: legeNeueRegionArtikelAn,
    nimmZurueck: () => Promise.resolve({ change: null, befunde: [], anzahl: 0 }),
};

export const regionArtikelSchreiber: Schreiber = {
    bereich: "region",
    objekte: ladeRegionArtikel,
    protokollArt: "region_artikel",
    objektArt: REGION_ARTIKEL_ART,
    affectedArt: REGION_ARTIKEL_ART,
    eintragZiel: (id) => ({ regionArtikelId: id }),
    zielSpalte: "region_artikel_public_id",
    wirksameSpalten: SPALTEN,
    // Die Zeile IST der Wiki-Stand: Es gibt nichts hinter ↺, jede Spalte folgt dem Wiki.
    schnappschussSpalten: {},
    fuelltLeereFelder: true,
    liste: neueRegionArtikel,
    leitetAb: () => false,

    async sperre(tx, ids) {
        if (ids.length === 0) return new Map();
        const zeilen = await tx<{ id: string; revision: number }[]>`
            SELECT public_id::text AS id, revision::int AS revision
              FROM wiki_region_snapshot
             WHERE public_id = ANY(${[...ids]}::uuid[])
             ORDER BY public_id
               FOR NO KEY UPDATE
        `;
        return new Map(zeilen.map((zeile) => [zeile.id, zeile.revision]));
    },

    schnappschussIds: () => Promise.resolve(new Map()),

    pruefe: (_tx, schritte) => Promise.resolve({ schritte: [...schritte], befunde: [] }),

    async schreibeObjekt(tx, id, spalten) {
        const [zeile] = await tx<
            { id: string }[]
        >`SELECT id::text AS id FROM wiki_region_snapshot WHERE public_id = ${id}::uuid`;
        if (zeile === undefined) throw new Error(`Wiki-Eintrag ${id}: nicht zu schreiben (nicht gesperrt)`);
        const { [ARTIKEL_FELD]: artikel, ...felder } = spalten;
        if (artikel === null) {
            await tx`
                UPDATE wiki_region_snapshot SET is_active = FALSE, retired_at = now(), retired_origin = 'wikisync' WHERE id = ${zeile.id}::bigint
            `;
        } else if (artikel !== undefined) {
            await tx`
                UPDATE wiki_region_snapshot
                   SET wiki_url = ${landmarkeAdresse(artikel)}, is_active = TRUE, retired_at = NULL, retired_origin = NULL
                 WHERE id = ${zeile.id}::bigint
            `;
        }
        await schreibeLandschaftsStand(tx, zeile.id, felder);
        const [danach] = await tx<{ revision: number }[]>`
            SELECT revision::int AS revision FROM wiki_region_snapshot WHERE id = ${zeile.id}::bigint
        `;
        return danach!.revision;
    },

    schreibeSchnappschuss: () => Promise.resolve(),
};
