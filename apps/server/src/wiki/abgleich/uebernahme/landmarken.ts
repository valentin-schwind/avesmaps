import type { Queryable } from "../../../database.ts";
import type { MapAuditEntry, MapChange } from "../../../editor/map-operation.ts";
import { landmarkeSchluessel } from "../../infobox/landmarke.ts";
import { VORSCHAU_TEXT_MAX } from "../ablage.ts";
import { LANDMARKE_ARTIKEL_ART, LANDMARKE_SPALTEN, istNeueLandmarke } from "../landmarken.ts";
import { ladeLandmarkenArtikel } from "../lokal.ts";
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
 * Die Übernahme und Rücknahme der Landmarken-Artikel (WI-0271 L7; im Bereich `gipfel` neben `gipfelSchreiber`), nach dem Muster der Sprachen (`sprachen.ts`). Ein Objekt ist der Wiki-Stand eines Landmarken-Artikels ohne Landmarke auf der
 * Karte (`wiki_landmarke_artikel`, Migration 0290), ein Kandidat ◐; jedes Feld folgt dem Wiki. Geschrieben wird:
 *
 * - **Die Felder** (Name, Art, Wiki-Art, Region, Höhe, Kurzbeschreibung) als Spalten des Objekts: EIN UPDATE je Objekt, die Revision zählt einmal. Ein geschriebenes Feld verliert die Marke `unbekannt`.
 * - **Der Lebenslauf** (`artikel`): Der Wert ist der Titel, solange der Artikel ein Kandidat ist. Wird er leer, legt `schreibeObjekt` die Zeile still (`retired_origin = 'wikisync'`); wird er wieder
 *   ein Titel, lebt sie auf.
 * - **Neue Artikel** über den Listen-Schreiber: angelegt nach allen Schreibzugriffen (`schliesseAb`), mit allen Feldern, die das Wiki nennt. Die Rücknahme legt sie über das Feld `artikel` still.
 *
 * 🔴 Nie eine Landmarke der Karte, nie eine Lage, nie die Unterdrückung (`unterdrueckt` gehört der Redaktion). Kein Wert geht in ein abgeleitetes Ergebnis der Karte ein (`leitetAb`: nie).
 */

/** Feld des Plans → Schlüssel im Fachprotokoll (`MAP_AUDIT_FIELDS.landmarke_artikel`). */
const AUDIT_NAMEN: Readonly<Record<string, string>> = { wiki_art: "wikiArt" };

/** Spalte → Feld des Plans (für die Marke `unbekannt`, die Namen des Plans führt). */
const FELD_DER_SPALTE: ReadonlyMap<string, string> = new Map(
    Object.entries(LANDMARKE_SPALTEN).map(([feld, spalte]) => [spalte, feld]),
);

const gekuerzt = (wert: string | null): boolean => wert !== null && Array.from(wert).length >= VORSCHAU_TEXT_MAX;

/** Der Wert einer Spalte: die Höhe als ganze Zahl (Schritt), alles andere als Text. */
const spaltenWert = (spalte: string, wert: string | null): string | number | null =>
    wert === null ? null : spalte === "hoehe_schritt" ? Number.parseInt(wert, 10) : wert;

/**
 * Das SET eines UPDATE an `wiki_landmarke_artikel` aus Spalten (`LANDMARKE_SPALTEN`): `artikel` setzt Titel und Zustand; jede geschriebene Spalte nimmt ihr Feld aus `unbekannt`. Die Namen der
 * Spalten stammen allein aus der festen Tafel (nie aus einer Zeile), die Werte gehen als Parameter.
 */
function setzeSpalten(spalten: Readonly<Record<string, string | null>>): { sets: string[]; werte: unknown[] } {
    const sets: string[] = [];
    const werte: unknown[] = [];
    const platz = (wert: unknown): string => {
        werte.push(wert);
        return `$${String(werte.length)}`;
    };
    const felder: string[] = [];
    for (const [spalte, wert] of Object.entries(spalten)) {
        const feld = FELD_DER_SPALTE.get(spalte);
        if (feld === undefined) throw new Error(`Landmarken-Artikel: unbekannte Spalte ${spalte}`);
        if (feld === ARTIKEL_FELD) {
            if (wert === null) sets.push("is_active = FALSE", "retired_at = now()", "retired_origin = 'wikisync'");
            else sets.push(`titel = ${platz(wert)}`, "is_active = TRUE", "retired_at = NULL", "retired_origin = NULL");
            continue;
        }
        felder.push(feld);
        sets.push(`${spalte} = ${platz(spaltenWert(spalte, wert))}`);
    }
    if (felder.length > 0) {
        sets.push(
            `unbekannt = ARRAY(SELECT u FROM unnest(unbekannt) AS u WHERE NOT (u = ANY (ARRAY(SELECT jsonb_array_elements_text(${platz(JSON.stringify(felder))}::text::jsonb)))))`,
        );
    }
    return { sets, werte };
}

// ----------------------------------------------------------------------------------------------------------------------------
// Neue Artikel
// ----------------------------------------------------------------------------------------------------------------------------

/** Ein Artikel, den die Übernahme anlegt: Schlüssel, Titel, die Werte der Felder (Spalte → Wert) und die Felder, deren Wert gekürzt ankam (sie bleiben unbekannt). */
export interface LandmarkenAnlage {
    objekt: PlanObjekt;
    schluessel: string;
    titel: string;
    werte: Record<string, string>;
    unbekannt: string[];
}

function platzhalter(id: string, titel: string): PlanObjekt {
    return {
        bereich: "gipfel",
        objektArt: LANDMARKE_ARTIKEL_ART,
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
 * Entscheidet die Zeilen der neuen Artikel gegen den Stand von jetzt (REIN). Nur ein Artikel, dessen Zeile `artikel` die Vorschau übernehmen wollte (Eigentümer `wiki`, Wirkung `uebernommen`), wird
 * angelegt; steht sein Schlüssel inzwischen im Bestand, ist das ein Befund. Ein gekürzter Wert wird nie geschrieben: Er bleibt leer und unbekannt.
 */
export function entscheideNeueLandmarken(
    zeilen: readonly VorschauZeile[],
    objekte: ReadonlyMap<string, PlanObjekt>,
): ListenErgebnis<LandmarkenAnlage> {
    const ergebnis: ListenErgebnis<LandmarkenAnlage> = { schritte: [], befunde: [], schonGleich: 0 };
    const jeArtikel = new Map<string, VorschauZeile[]>();
    for (const zeile of zeilen) {
        if (zeile.objektId === null) continue;
        jeArtikel.set(zeile.objektId, [...(jeArtikel.get(zeile.objektId) ?? []), zeile]);
    }
    const bestand = new Set<string>();
    for (const objekt of objekte.values()) if (objekt.landmarke !== undefined) bestand.add(objekt.landmarke.schluessel);
    const uebernimmt = (zeile: VorschauZeile): boolean =>
        zeile.eigentuemer === "wiki" && zeile.wirkung === "uebernommen";

    for (const [id, liste] of jeArtikel) {
        const kopf = liste.find((zeile) => zeile.feld === ARTIKEL_FELD);
        if (kopf === undefined || !uebernimmt(kopf) || kopf.neu === null || kopf.neuZustand !== "text") continue;
        const titel = kopf.neu;
        const schluessel = landmarkeSchluessel(titel);
        const befund = (feld: string, art: BefundSchritt["befund"], grund: string): void => {
            ergebnis.befunde.push({
                objektId: id,
                objektArt: LANDMARKE_ARTIKEL_ART,
                objektName: titel,
                feld,
                befund: art,
                grund,
            });
        };
        if (bestand.has(schluessel)) {
            befund(ARTIKEL_FELD, "seit_vorschau_geaendert", "Der Landmarken-Artikel steht inzwischen im Bestand");
            continue;
        }
        const werte: Record<string, string> = {};
        const unbekannt: string[] = [];
        for (const zeile of liste) {
            if (zeile.feld === ARTIKEL_FELD || !uebernimmt(zeile)) continue;
            const spalte = LANDMARKE_SPALTEN[zeile.feld];
            if (spalte === undefined) continue;
            if (gekuerzt(zeile.neu)) {
                befund(zeile.feld, "wert_gekuerzt", "Die Vorschau hat den Wert gekürzt");
                unbekannt.push(zeile.feld);
                continue;
            }
            if (zeile.neuZustand === "text" && zeile.neu !== null && zeile.neu.trim() !== "") werte[spalte] = zeile.neu;
        }
        ergebnis.schritte.push({ objekt: platzhalter(id, titel), schluessel, titel, werte, unbekannt });
    }
    return ergebnis;
}

/** Legt die neuen Artikel an (nach allen Schreibzugriffen der Übernahme) und liefert das Fachprotokoll: je Artikel ein Eintrag, jedes Feld mit `before: null`. */
async function legeNeueLandmarkenAn(
    tx: Queryable,
    schritte: readonly LandmarkenAnlage[],
): Promise<{
    entries: MapAuditEntry[];
    affected: { kind: string; id: string; revision: number }[];
    zahlen: Record<string, number>;
}> {
    const entries: MapAuditEntry[] = [];
    const affected: { kind: string; id: string; revision: number }[] = [];
    for (const schritt of schritte) {
        const spalten = Object.keys(schritt.werte);
        // Hat jemand den Schlüssel zwischen dem Entscheiden und hier angelegt, bricht das Schreiben ab (eindeutiger Schlüssel): Der Bereich bleibt, wie er war.
        const [zeile] = await tx.unsafe<{ id: string; revision: number }[]>(
            `INSERT INTO wiki_landmarke_artikel (schluessel, titel, ${spalten.map((spalte) => `${spalte}, `).join("")}unbekannt)
             VALUES ($1, $2, ${spalten.map((_spalte, index) => `$${String(index + 4)}, `).join("")}ARRAY(SELECT jsonb_array_elements_text($3::text::jsonb)))
          RETURNING public_id::text AS id, revision::int AS revision`,
            [
                schritt.schluessel,
                schritt.titel,
                JSON.stringify(schritt.unbekannt),
                ...spalten.map((spalte) => spaltenWert(spalte, schritt.werte[spalte] ?? null)),
            ] as never[],
        );
        if (zeile === undefined) throw new Error(`Landmarken-Artikel ${schritt.titel}: nicht angelegt`);
        const changes: Record<string, MapChange> = {
            [auditSchluessel(ARTIKEL_FELD, "wirksam", AUDIT_NAMEN)]: { before: null, after: schritt.titel },
        };
        for (const spalte of spalten) {
            const feld = FELD_DER_SPALTE.get(spalte) as string;
            changes[auditSchluessel(feld, "wirksam", AUDIT_NAMEN)] = { before: null, after: schritt.werte[spalte] };
        }
        entries.push({
            action: "landmarke_artikel.wikisync_uebernommen",
            landmarkeArtikelId: zeile.id,
            revisionBefore: null,
            revisionAfter: zeile.revision,
            changes,
        });
        affected.push({ kind: LANDMARKE_ARTIKEL_ART, id: zeile.id, revision: zeile.revision });
    }
    return { entries, affected, zahlen: { angelegt: schritte.length } };
}

/** Der Listen-Schreiber der neuen Artikel: wie bei den Sprachen; ein Objekt des Bestands berührt er nie, die Rücknahme geht den Weg der Felder. */
const neueLandmarken: ListenSchreiber<LandmarkenAnlage> = {
    feldGehoert: (_feld, zeile) => istNeueLandmarke(zeile),
    auditSchluessel: "artikel_neu",
    entscheide: entscheideNeueLandmarken,
    schreibe: () => Promise.resolve(new Map<string, MapChange>()),
    schliesseAb: legeNeueLandmarkenAn,
    nimmZurueck: () => Promise.resolve({ change: null, befunde: [], anzahl: 0 }),
};

// ----------------------------------------------------------------------------------------------------------------------------
// Der Schreiber
// ----------------------------------------------------------------------------------------------------------------------------

export const landmarkenSchreiber: Schreiber = {
    bereich: "gipfel",
    objekte: ladeLandmarkenArtikel,
    protokollArt: "landmarke_artikel",
    objektArt: LANDMARKE_ARTIKEL_ART,
    affectedArt: LANDMARKE_ARTIKEL_ART,
    eintragZiel: (id) => ({ landmarkeArtikelId: id }),
    zielSpalte: "landmarke_artikel_public_id",
    wirksameSpalten: LANDMARKE_SPALTEN,
    // Der Landmarken-Artikel IST sein Wiki-Stand: Es gibt nichts hinter ↺, jede Spalte folgt dem Wiki.
    schnappschussSpalten: {},
    auditNamen: AUDIT_NAMEN,
    fuelltLeereFelder: true,
    liste: neueLandmarken,
    leitetAb: () => false,

    async sperre(tx, ids) {
        if (ids.length === 0) return new Map();
        const zeilen = await tx<{ id: string; revision: number }[]>`
            SELECT public_id::text AS id, revision::int AS revision
              FROM wiki_landmarke_artikel
             WHERE public_id = ANY(${[...ids]}::uuid[])
             ORDER BY public_id
               FOR UPDATE
        `;
        return new Map(zeilen.map((zeile) => [zeile.id, zeile.revision]));
    },

    schnappschussIds: () => Promise.resolve(new Map()),

    pruefe: (_tx, schritte) => Promise.resolve({ schritte: [...schritte], befunde: [] }),

    async schreibeObjekt(tx, id, spalten) {
        const { sets, werte } = setzeSpalten(spalten);
        const [zeile] = await tx.unsafe<{ revision: number }[]>(
            `UPDATE wiki_landmarke_artikel SET ${sets.length === 0 ? "revision = revision" : sets.join(", ")}
              WHERE public_id = $${String(werte.length + 1)}::uuid
          RETURNING revision::int AS revision`,
            [...werte, id] as never[],
        );
        if (zeile === undefined) throw new Error(`Landmarken-Artikel ${id}: nicht zu schreiben (nicht gesperrt)`);
        return zeile.revision;
    },

    schreibeSchnappschuss: () => Promise.resolve(),
};
