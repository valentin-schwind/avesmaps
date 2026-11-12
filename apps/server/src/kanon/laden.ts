import { raumDerAdresse } from "./namensraum.ts";
import type { KanonObjektart, WikiNamespaceTafel } from "@avesmaps3d/shared";
import type { Queryable } from "../database.ts";
import {
    erbeGruppenNamensraum,
    leiteKanonAb,
    type KanonEingabe,
    type KanonErgebnis,
    type KanonQuelle,
    type KanonRegelstand,
} from "./ableitung.ts";

/**
 * Die Träger des Kanons mit allem, was die Regel braucht (WI-0253 B-2): die gespeicherte Wiki-Adresse (daraus der Namensraum, über die Tafel),
 * die Verweise auf die Katalogquellen und die Gruppe, in der ein Weg erbt. Nur lesend.
 *
 * Wo die Zuweisung eines Trägers steht, weiß jede Art selbst: Ort, Weg, Gipfel und Kraftlinie haben eine Zuordnungstafel
 * (`<träger>_wiki_assignment`, nur aktiv und mit Zustand `assigned` oder `address_only`, beim Weg die Hauptzuweisung), Gebiet und Landschaft
 * tragen die Adresse selbst (`territory.wiki_url`, `region.wiki_url`).
 */

interface TraegerTabellen {
    traeger: string;
    fremdschluessel: string;
    verweis: string | null;
    kanon: string;
    /** Das SELECT der Träger: `id`, `public_id`, `gruppe` (nur Wege), `wiki_url`. */
    auswahl: string;
}

const ZUWEISUNG_AKTIV = "a.is_active AND a.assignment_state IN ('assigned', 'address_only')";

export const KANON_TRAEGER: Readonly<Record<KanonObjektart, TraegerTabellen>> = {
    place: {
        traeger: "place",
        fremdschluessel: "place_id",
        verweis: "place_source",
        kanon: "place_canon",
        auswahl: `SELECT c.id::text AS id, c.public_id::text AS public_id, NULL::text AS gruppe,
                         (SELECT a.wiki_url FROM place_wiki_assignment a WHERE a.place_id = c.id AND ${ZUWEISUNG_AKTIV}) AS wiki_url
                    FROM place c WHERE c.is_active`,
    },
    path: {
        traeger: "path",
        fremdschluessel: "path_id",
        verweis: "path_source",
        kanon: "path_canon",
        // Die Gruppe ist der Name (Wegart und Name), nicht der Wiki-Key (Legacy: ein unzugewiesener Abschnitt hat keinen Key).
        auswahl: `SELECT c.id::text AS id, c.public_id::text AS public_id,
                         CASE WHEN btrim(coalesce(c.name, '')) <> '' THEN c.subtype || '|' || btrim(c.name) END AS gruppe,
                         (SELECT a.wiki_url FROM path_wiki_assignment a
                           WHERE a.path_id = c.id AND a.role = 'main' AND ${ZUWEISUNG_AKTIV}) AS wiki_url
                    FROM path c WHERE c.is_active`,
    },
    territory: {
        traeger: "territory",
        fremdschluessel: "territory_id",
        verweis: "territory_source",
        kanon: "territory_canon",
        auswahl: `SELECT c.id::text AS id, c.public_id::text AS public_id, NULL::text AS gruppe, c.wiki_url
                    FROM territory c WHERE c.is_active`,
    },
    area: {
        traeger: "region",
        fremdschluessel: "region_id",
        verweis: "region_source",
        kanon: "region_canon",
        auswahl: `SELECT c.id::text AS id, c.public_id::text AS public_id, NULL::text AS gruppe, c.wiki_url
                    FROM region c WHERE c.is_active`,
    },
    peak: {
        traeger: "terrain_peak",
        fremdschluessel: "terrain_peak_id",
        verweis: "terrain_peak_source",
        kanon: "terrain_peak_canon",
        auswahl: `SELECT c.id::text AS id, c.public_id::text AS public_id, NULL::text AS gruppe,
                         (SELECT a.wiki_url FROM terrain_peak_wiki_assignment a WHERE a.terrain_peak_id = c.id AND ${ZUWEISUNG_AKTIV}) AS wiki_url
                    FROM terrain_peak c WHERE c.is_active`,
    },
    powerline: {
        traeger: "powerline",
        fremdschluessel: "powerline_id",
        // Eine Kraftlinie hat in Legacy keine Quellen und deshalb keine Verknüpfungstafel (`sources.yaml`).
        verweis: null,
        kanon: "powerline_canon",
        auswahl: `SELECT c.id::text AS id, c.public_id::text AS public_id, NULL::text AS gruppe,
                         (SELECT a.wiki_url FROM powerline_wiki_assignment a WHERE a.powerline_id = c.id AND ${ZUWEISUNG_AKTIV}) AS wiki_url
                    FROM powerline c WHERE c.is_active`,
    },
};

export interface KanonTraeger {
    art: KanonObjektart;
    /** Die interne Nummer des Trägers (Text, `bigint`). */
    id: string;
    publicId: string;
    gruppe: string | null;
    wikiUrl: string | null;
    /** Der Namensraum der eigenen Zuweisung (aus der Adresse über die Tafel); `null`: keine Zuweisung. */
    eigenerRaum: number | null;
    /** Der Namensraum nach der Erbschaft der Wegegruppe. */
    raum: number | null;
    quellen: KanonQuelle[];
}

/** Die Träger einer Art mit Zuweisung und Verweisen; die Erbschaft der Wegegruppe ist schon gerechnet. */
export async function ladeKanonTraeger(
    db: Queryable,
    art: KanonObjektart,
    tafel: WikiNamespaceTafel,
): Promise<KanonTraeger[]> {
    const tabellen = KANON_TRAEGER[art];
    const zeilen = await db.unsafe<{ id: string; public_id: string; gruppe: string | null; wiki_url: string | null }[]>(
        tabellen.auswahl,
    );
    const quellen = new Map<string, KanonQuelle[]>();
    if (tabellen.verweis !== null) {
        const verweise = await db.unsafe<{ traeger: string; publikation: boolean; offiziell: boolean; art: string }[]>(
            `SELECT s.${tabellen.fremdschluessel}::text AS traeger, s.reference_kind IS NOT NULL AS publikation,
                    f.is_official AS offiziell, f.source_type AS art
               FROM ${tabellen.verweis} s
               JOIN feature_source f ON f.id = s.source_id AND f.is_active
              WHERE s.is_active AND s.state = 'active'`,
        );
        for (const verweis of verweise) {
            const liste = quellen.get(verweis.traeger) ?? [];
            liste.push({ offiziell: verweis.offiziell, art: verweis.art, publikation: verweis.publikation });
            quellen.set(verweis.traeger, liste);
        }
    }
    const eigene = zeilen.map((zeile) => raumDerAdresse(zeile.wiki_url, tafel).ns);
    const geerbt =
        art === "path"
            ? erbeGruppenNamensraum(zeilen.map((zeile, i) => ({ gruppe: zeile.gruppe, ns: eigene[i] ?? null })))
            : eigene;
    return zeilen.map((zeile, i) => ({
        art,
        id: zeile.id,
        publicId: zeile.public_id,
        gruppe: zeile.gruppe,
        wikiUrl: zeile.wiki_url,
        eigenerRaum: eigene[i] ?? null,
        raum: geerbt[i] ?? null,
        quellen: quellen.get(zeile.id) ?? [],
    }));
}

/** Was die Regel zu einem Träger sagt. */
export function kanonDesTraegers(
    traeger: KanonTraeger,
    tafel: WikiNamespaceTafel,
    regelstand: KanonRegelstand = "avesmaps",
): KanonErgebnis | null {
    const eingabe: KanonEingabe = { ns: traeger.raum, quellen: traeger.quellen };
    return leiteKanonAb(eingabe, tafel, regelstand);
}

export interface GespeicherterKanon {
    /** `official`, `unofficial` oder `unlabelled`. */
    kanon: string;
    designatorType: string | null;
    designatorCount: number | null;
    designatorLabel: string | null;
    derivedFrom: string;
}

/** Die Kanon-Zeilen einer Art, je Träger (interne Nummer). */
export async function ladeGespeicherteKanonZeilen(
    db: Queryable,
    art: KanonObjektart,
): Promise<Map<string, GespeicherterKanon>> {
    const tabellen = KANON_TRAEGER[art];
    const zeilen = await db.unsafe<
        {
            traeger: string;
            canon: string;
            designator_type: string | null;
            designator_count: number | null;
            designator_label: string | null;
            derived_from: string;
        }[]
    >(
        `SELECT ${tabellen.fremdschluessel}::text AS traeger, canon, designator_type, designator_count, designator_label, derived_from
           FROM ${tabellen.kanon}`,
    );
    return new Map(
        zeilen.map((zeile) => [
            zeile.traeger,
            {
                kanon: zeile.canon,
                designatorType: zeile.designator_type,
                designatorCount: zeile.designator_count,
                designatorLabel: zeile.designator_label,
                derivedFrom: zeile.derived_from,
            },
        ]),
    );
}
