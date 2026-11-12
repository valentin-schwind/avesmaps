import type { Queryable } from "../../../database.ts";
import type { MapAuditEntry, MapChange } from "../../../editor/map-operation.ts";
import { sprachSchluessel } from "../../infobox/sprache.ts";
import { VORSCHAU_TEXT_MAX } from "../ablage.ts";
import type { PlanObjekt } from "../plan.ts";
import { ARTIKEL_FELD, SPRACHE_ARTIKEL_ART, SPRACHE_SPALTEN, istNeuerArtikel, navigationListe } from "../sprachen.ts";
import type { VorschauZeile } from "./protokoll.ts";
import {
    auditSchluessel,
    type BefundSchritt,
    type ListenErgebnis,
    type ListenSchreiber,
    type Schreiber,
} from "./schreiber.ts";

/**
 * Die Übernahme und Rücknahme der Sprachen (WI-0261 S3). Ein Objekt ist der Wiki-Stand eines aventurischen Sprachartikels (`wiki_sprache_artikel`, Migration 0255); er gehört ganz dem
 * WikiSync, darum folgt jedes Feld dem Wiki. Geschrieben wird:
 *
 * - **Die Felder** (die sieben der Infobox, die Kurzbeschreibung, die Navigationsleisten, die vier Rohtexte) als Spalten des Objekts, wie in jedem Bereich über `entscheiden.ts` (wirksame Spalten,
 *   `fuelltLeereFelder`): EIN UPDATE je Objekt, die Revision zählt einmal. Ein geschriebenes Feld verliert die Marke `unbekannt`.
 * - **Der Lebenslauf** (`artikel`, `sprachen.ts`): Der Wert ist der Titel, solange der Artikel aktiv ist. Wird er leer, legt `schreibeObjekt` die Zeile still (`retired_origin = 'wikisync'`); wird er
 *   wieder ein Titel, lebt sie auf. Im selben UPDATE wie die Felder.
 * - **Neue Artikel** über den Listen-Schreiber unten: Ihre Zeilen hängen an der Platzhalter-Kennung (`istNeuerArtikel`), angelegt wird nach allen Schreibzugriffen (`schliesseAb`), mit allen
 *   Feldern, die das Wiki nennt. Das Fachprotokoll trägt jedes Feld mit `before: null`; die Rücknahme legt den Artikel darüber still (das Feld `artikel` wird leer), gelöscht wird nie.
 *
 * 🔴 Abweichung von den übrigen Bereichen: Der WikiSync legt hier Objekte an und still (O1). Nie den Schlüssel (die Identität), nie die Zuordnung zu einer Sprache (`sprache_wiki`), nie Fläche oder
 * Farbe (O6). Kein Wert geht in ein abgeleitetes Ergebnis der Karte ein (`leitetAb`: nie); die Operation hebt die Leser-Revision.
 */

/** Feld des Plans → Schlüssel im Fachprotokoll (`MAP_AUDIT_FIELDS.sprache_artikel`). */
const AUDIT_NAMEN: Readonly<Record<string, string>> = {
    offizielle_sprache: "offizielleSprache",
    weitere_verbreitung: "weitereVerbreitung",
    roh_vorstufen: "rohVorstufen",
    roh_schrift: "rohSchrift",
    roh_offizielle_sprache: "rohOffizielleSprache",
    roh_weitere_verbreitung: "rohWeitereVerbreitung",
};

/** Spalte → Feld des Plans (für die Marke `unbekannt`, die Namen des Plans führt). */
const FELD_DER_SPALTE: ReadonlyMap<string, string> = new Map(
    Object.entries(SPRACHE_SPALTEN).map(([feld, spalte]) => [spalte, feld]),
);

const gekuerzt = (wert: string | null): boolean => wert !== null && Array.from(wert).length >= VORSCHAU_TEXT_MAX;

/**
 * Das SET eines UPDATE an `wiki_sprache_artikel` aus Spalten (`SPRACHE_SPALTEN`): `artikel` setzt Titel und Zustand, `navigation` die Liste; jede geschriebene Spalte nimmt ihr Feld aus `unbekannt`.
 * Die Namen der Spalten stammen allein aus der festen Tafel (nie aus einer Zeile), die Werte gehen als Parameter.
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
        if (feld === undefined) throw new Error(`Sprachartikel: unbekannte Spalte ${spalte}`);
        if (feld === ARTIKEL_FELD) {
            if (wert === null) sets.push("is_active = FALSE", "retired_at = now()", "retired_origin = 'wikisync'");
            else sets.push(`titel = ${platz(wert)}`, "is_active = TRUE", "retired_at = NULL", "retired_origin = NULL");
            continue;
        }
        felder.push(feld);
        if (feld === "navigation") {
            sets.push(
                `navigation = ARRAY(SELECT jsonb_array_elements_text(${platz(JSON.stringify(navigationListe(wert)))}::text::jsonb))`,
            );
        } else {
            sets.push(`${spalte} = ${platz(wert)}`);
        }
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
export interface AnlageSchritt {
    objekt: PlanObjekt;
    schluessel: string;
    titel: string;
    werte: Record<string, string>;
    unbekannt: string[];
}

function platzhalter(id: string, titel: string): PlanObjekt {
    return {
        bereich: "sprachen",
        objektArt: SPRACHE_ARTIKEL_ART,
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
 * Entscheidet die Zeilen der neuen Artikel gegen den Stand von jetzt (REIN). Nur ein Artikel, dessen Zeile `artikel` die Vorschau übernehmen wollte (Eigentümer `wiki`, Wirkung `uebernommen`),
 * wird angelegt; steht sein Schlüssel inzwischen im Bestand (ein anderer Lauf war schneller), ist das ein Befund. Ein gekürzter Wert wird nie geschrieben: Er bleibt leer und unbekannt.
 */
export function entscheideNeueArtikel(
    zeilen: readonly VorschauZeile[],
    objekte: ReadonlyMap<string, PlanObjekt>,
): ListenErgebnis<AnlageSchritt> {
    const ergebnis: ListenErgebnis<AnlageSchritt> = { schritte: [], befunde: [], schonGleich: 0 };
    const jeArtikel = new Map<string, VorschauZeile[]>();
    for (const zeile of zeilen) {
        if (zeile.objektId === null) continue;
        jeArtikel.set(zeile.objektId, [...(jeArtikel.get(zeile.objektId) ?? []), zeile]);
    }
    const bestand = new Set<string>();
    for (const objekt of objekte.values()) if (objekt.sprache !== undefined) bestand.add(objekt.sprache.schluessel);
    const uebernimmt = (zeile: VorschauZeile): boolean =>
        zeile.eigentuemer === "wiki" && zeile.wirkung === "uebernommen";

    for (const [id, liste] of jeArtikel) {
        const kopf = liste.find((zeile) => zeile.feld === ARTIKEL_FELD);
        if (kopf === undefined || !uebernimmt(kopf) || kopf.neu === null || kopf.neuZustand !== "text") continue;
        const titel = kopf.neu;
        const schluessel = sprachSchluessel(titel);
        const befund = (feld: string, art: BefundSchritt["befund"], grund: string): void => {
            ergebnis.befunde.push({
                objektId: id,
                objektArt: SPRACHE_ARTIKEL_ART,
                objektName: titel,
                feld,
                befund: art,
                grund,
            });
        };
        if (bestand.has(schluessel)) {
            befund(ARTIKEL_FELD, "seit_vorschau_geaendert", "Der Sprachartikel steht inzwischen im Bestand");
            continue;
        }
        const werte: Record<string, string> = {};
        const unbekannt: string[] = [];
        for (const zeile of liste) {
            if (zeile.feld === ARTIKEL_FELD || !uebernimmt(zeile)) continue;
            const spalte = SPRACHE_SPALTEN[zeile.feld];
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
async function legeNeueArtikelAn(
    tx: Queryable,
    schritte: readonly AnlageSchritt[],
): Promise<{
    entries: MapAuditEntry[];
    affected: { kind: string; id: string; revision: number }[];
    zahlen: Record<string, number>;
}> {
    const entries: MapAuditEntry[] = [];
    const affected: { kind: string; id: string; revision: number }[] = [];
    for (const schritt of schritte) {
        const spalten = Object.keys(schritt.werte);
        const navigation = schritt.werte["navigation"] ?? null;
        const einfache = spalten.filter((spalte) => spalte !== "navigation");
        // Hat jemand den Schlüssel zwischen dem Entscheiden und hier angelegt, bricht das Schreiben ab (eindeutiger Schlüssel): Der Bereich bleibt, wie er war.
        const [zeile] = await tx.unsafe<{ id: string; revision: number }[]>(
            `INSERT INTO wiki_sprache_artikel (schluessel, titel, ${einfache.map((spalte) => `${spalte}, `).join("")}navigation, unbekannt)
             VALUES ($1, $2, ${einfache.map((_spalte, index) => `$${String(index + 5)}, `).join("")}
                     ARRAY(SELECT jsonb_array_elements_text($3::text::jsonb)), ARRAY(SELECT jsonb_array_elements_text($4::text::jsonb)))
          RETURNING public_id::text AS id, revision::int AS revision`,
            [
                schritt.schluessel,
                schritt.titel,
                JSON.stringify(navigationListe(navigation)),
                JSON.stringify(schritt.unbekannt),
                ...einfache.map((spalte) => schritt.werte[spalte] ?? null),
            ] as never[],
        );
        if (zeile === undefined) throw new Error(`Sprachartikel ${schritt.titel}: nicht angelegt`);
        const changes: Record<string, MapChange> = {
            [auditSchluessel(ARTIKEL_FELD, "wirksam", AUDIT_NAMEN)]: { before: null, after: schritt.titel },
        };
        for (const spalte of spalten) {
            const feld = FELD_DER_SPALTE.get(spalte) as string;
            changes[auditSchluessel(feld, "wirksam", AUDIT_NAMEN)] = { before: null, after: schritt.werte[spalte] };
        }
        entries.push({
            action: "sprache_artikel.wikisync_uebernommen",
            spracheArtikelId: zeile.id,
            revisionBefore: null,
            revisionAfter: zeile.revision,
            changes,
        });
        affected.push({ kind: SPRACHE_ARTIKEL_ART, id: zeile.id, revision: zeile.revision });
    }
    return { entries, affected, zahlen: { angelegt: schritte.length } };
}

/**
 * Der Listen-Schreiber der neuen Artikel. Er gehört zu den Zeilen eines Artikels, den der Bestand noch nicht hat (`istNeuerArtikel`), und legt ihn in `schliesseAb` an; ein Objekt des Bestands
 * berührt er nie (`schreibe` hat nichts zu tun). Sein Fachprotokoll trägt die Felder unter ihren eigenen Schlüsseln, nicht unter einem Listenschlüssel: Die Rücknahme geht darum den Weg aller
 * Felder (`artikel` wird leer, der Artikel ist still gelegt), und `nimmZurueck` wird nie gerufen.
 */
const neueArtikel: ListenSchreiber<AnlageSchritt> = {
    feldGehoert: (_feld, zeile) => istNeuerArtikel(zeile),
    auditSchluessel: "artikel_neu",
    entscheide: entscheideNeueArtikel,
    schreibe: () => Promise.resolve(new Map<string, MapChange>()),
    schliesseAb: legeNeueArtikelAn,
    nimmZurueck: () => Promise.resolve({ change: null, befunde: [], anzahl: 0 }),
};

// ----------------------------------------------------------------------------------------------------------------------------
// Der Schreiber
// ----------------------------------------------------------------------------------------------------------------------------

export const sprachenSchreiber: Schreiber = {
    bereich: "sprachen",
    protokollArt: "sprache_artikel",
    objektArt: SPRACHE_ARTIKEL_ART,
    affectedArt: SPRACHE_ARTIKEL_ART,
    eintragZiel: (id) => ({ spracheArtikelId: id }),
    zielSpalte: "sprache_artikel_public_id",
    wirksameSpalten: SPRACHE_SPALTEN,
    // Der Sprachartikel IST sein Wiki-Stand: Es gibt nichts hinter ↺, jede Spalte des Objekts folgt dem Wiki.
    schnappschussSpalten: {},
    auditNamen: AUDIT_NAMEN,
    // Ein leeres Feld hat keinen Wiki-Stand, auf den ein Leser zurückfiele: Die Übernahme füllt es in der Spalte selbst (wie die Literatur).
    fuelltLeereFelder: true,
    liste: neueArtikel,
    leitetAb: () => false,

    async sperre(tx, ids) {
        if (ids.length === 0) return new Map();
        // Aktive und still gelegte Zeilen: Der WikiSync legt still und belebt selbst. Platzhalter neuer Artikel fehlen (es gibt sie noch nicht).
        const zeilen = await tx<{ id: string; revision: number }[]>`
            SELECT public_id::text AS id, revision::int AS revision
              FROM wiki_sprache_artikel
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
        // Eine Berührung ohne Spalte zählt die Revision trotzdem (`revision = revision`; der Trigger macht daraus +1).
        const [zeile] = await tx.unsafe<{ revision: number }[]>(
            `UPDATE wiki_sprache_artikel SET ${sets.length === 0 ? "revision = revision" : sets.join(", ")}
              WHERE public_id = $${String(werte.length + 1)}::uuid
          RETURNING revision::int AS revision`,
            [...werte, id] as never[],
        );
        if (zeile === undefined) throw new Error(`Sprachartikel ${id}: nicht zu schreiben (nicht gesperrt)`);
        return zeile.revision;
    },

    schreibeSchnappschuss: () => Promise.resolve(),
};
