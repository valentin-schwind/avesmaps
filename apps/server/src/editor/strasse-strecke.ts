import {
    pathReaderName,
    STRASSEN_ASSISTENT_ORTE_MAX,
    type StrasseStreckeAntwort,
    type StrasseStreckeBody,
    type StrassenAbschnitt,
    type StrassenOrt,
    type StrassenTeil,
    type StrassenZustand,
} from "@avesmaps3d/shared";
import type { Queryable } from "../database.ts";
import { ApiError } from "../http/api-error.ts";
import { netzOptionen } from "../routing/einstellungen.ts";
import { lineLength, type RouteNode } from "../routing/network.ts";
import { deriveTopology, type Topology, type TopologyOptions } from "../routing/topology.ts";
import { wegfindungswerte } from "../system/wegfindungsstand.ts";
import { titelOderAdresse } from "../wiki/objekt/anschluss.ts";
import { wegAnschluss } from "../wiki/objekt/weg.ts";
import { quellenDerStrasse } from "./strasse-zuweisen.ts";

/**
 * Die Strecke des Straßen-Assistenten (WI-0310; Vertrag `packages/shared/src/editor-strassen-assistent.ts`): lesend, schreibt nichts. Zu einer Straße (ein Abschnitt als Anker), ihrem
 * Wiki-Artikel und einer Liste von Orten rechnet sie, über welche vorhandenen Abschnitte die Straße von Ort zu Ort läuft, wie jeder davon heute steht und welche Abschnitte mit dem Namen oder dem
 * Artikel der Straße abseits liegen. Zuweisen (Name, Artikel, Quellen) ist ein eigener Schreibweg (`strasse-zuweisen.ts`); eine Linie legt der Assistent nie neu („Zuweisen reicht“).
 *
 * - **Orte:** die genannten, sonst aus dem Verlauf des Artikels („A → B → C“): je Name die aktiven Orte gleichen Namens (ohne Groß- und Kleinschreibung, getrimmt), bei mehreren der nächste zur Straße;
 *   ohne Treffer in `unbekannt`. Jeder Ort nur einmal.
 * - **Netz:** die aktiven Landwege (ohne Flussweg und Seeweg) und Orte in einem Kasten um Orte und Straße (Rand ein Viertel der Diagonale, mindestens `KASTEN_RAND_MIN`), die Topologie der Wegfindung
 *   mit den eingestellten Werten (`deriveTopology`, `netzOptionen`); Kanten zwischen den Knoten jeder Linie wie beim Netzaufbau (`network.ts`). Längen in Meilen wie dort: Karteneinheiten mal
 *   `meilenJeKarteneinheit`.
 * - **Strecke** je Ortspaar: der kürzeste Weg (Dijkstra) mit dem Gewicht Länge × Name × Wegtyp (`gewichtJeMeile`), ohne Verbindung „kein Weg“.
 *
 * Die Rechnung (Verlauf zerlegen, Orte wählen, Gewicht, Zustand, Graph, Dijkstra) steht als reine Funktion oben, ohne Datenbank; `strasseStrecke` unten liest nur, was sie braucht.
 */

/** Der Rand des Kastens um Orte und Straße mindestens, in Karteneinheiten. */
export const KASTEN_RAND_MIN = 20;

/** Name: gleicher Name wie die Straße oder schon der Artikel, ohne echten Namen, ein anderer echter Name. */
export const NAME_GEWICHT = { strasse: 0.8, ohne: 1, anderer: 1.2 } as const;
/** Wegtyp (`path.subtype`); was hier fehlt, `TYP_GEWICHT_SONST`. */
export const TYP_GEWICHT: Readonly<Record<string, number>> = {
    Reichsstrasse: 1,
    Strasse: 1,
    Weg: 1.1,
    Pfad: 1.25,
    Gebirgspass: 1.4,
    Wuestenpfad: 1.4,
};
export const TYP_GEWICHT_SONST = 1.3;

/** Ein Weg im Netz der Strecke. */
export interface StreckenWeg {
    id: string;
    name: string;
    subtype: string;
    coordinates: [number, number][];
    /** Der Schlüssel des Hauptartikels heute (`null`: keiner). */
    wikiKey: string | null;
}

/** Woran die Rechnung einen Abschnitt der Straße erkennt. */
export interface StreckenStrasse {
    /** Die echten Namen, die als „gleicher Name“ zählen (getrimmt): der, den die Abschnitte bekämen, und der heutige der Straße. */
    namen: ReadonlySet<string>;
    /** Der Artikel (`null`: ohne). */
    key: string | null;
}

const rund = (wert: number): number => Math.round(wert * 100) / 100;

/** Die Namen eines Verlaufs („A → B → C“), getrimmt, ohne leere. */
export function zerlegeVerlauf(verlauf: string): string[] {
    return verlauf
        .split("→")
        .map((teil) => teil.trim())
        .filter((teil) => teil !== "");
}

const vergleichsform = (name: string): string => name.trim().toLocaleLowerCase("de");

/** Ein Ort, der zu einem Namen des Verlaufs passt, mit seinem Abstand zur Straße (`null`: unbekannt). */
export interface OrtKandidat extends StrassenOrt {
    abstand: number | null;
}

/**
 * Die Orte zu den Namen eines Verlaufs: je Name der passende Ort (ohne Groß- und Kleinschreibung), bei mehreren der nächste zur Straße (bei Gleichstand die kleinere Kennung); ohne Treffer in
 * `unbekannt`. Ein Ort, der schon in der Liste steht, kommt nicht noch einmal, ein unbekannter Name ebenso. Höchstens `STRASSEN_ASSISTENT_ORTE_MAX` Orte.
 */
export function waehleOrte(
    namen: readonly string[],
    kandidaten: readonly OrtKandidat[],
): { orte: StrassenOrt[]; unbekannt: string[] } {
    const orte: StrassenOrt[] = [];
    const unbekannt: string[] = [];
    const gesehen = new Set<string>();
    for (const roh of namen) {
        const name = roh.trim();
        if (name === "") continue;
        const passend = kandidaten
            .filter((ort) => vergleichsform(ort.name) === vergleichsform(name))
            .sort(
                (a, b) =>
                    (a.abstand ?? Number.POSITIVE_INFINITY) - (b.abstand ?? Number.POSITIVE_INFINITY) ||
                    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
            );
        const ort = passend[0];
        if (ort === undefined) {
            if (!unbekannt.some((frueher) => vergleichsform(frueher) === vergleichsform(name))) unbekannt.push(name);
            continue;
        }
        if (gesehen.has(ort.id) || orte.length >= STRASSEN_ASSISTENT_ORTE_MAX) continue;
        gesehen.add(ort.id);
        orte.push({ id: ort.id, name: ort.name, x: ort.x, y: ort.y });
    }
    return { orte, unbekannt };
}

/** Gehört der Weg zur Straße: ihr Name (ein echter) oder schon ihr Artikel? */
export function gehoertZurStrasse(
    weg: Pick<StreckenWeg, "name" | "subtype" | "wikiKey">,
    strasse: StreckenStrasse,
): boolean {
    const echt = pathReaderName(weg.name, weg.subtype);
    return (echt !== null && strasse.namen.has(echt)) || (strasse.key !== null && weg.wikiKey === strasse.key);
}

/** Das Gewicht je Meile: Name (0,8 die Straße, 1 ohne echten Namen, 1,2 ein anderer) mal Wegtyp. */
export function gewichtJeMeile(
    weg: Pick<StreckenWeg, "name" | "subtype" | "wikiKey">,
    strasse: StreckenStrasse,
): number {
    const name = gehoertZurStrasse(weg, strasse)
        ? NAME_GEWICHT.strasse
        : pathReaderName(weg.name, weg.subtype) === null
          ? NAME_GEWICHT.ohne
          : NAME_GEWICHT.anderer;
    return name * (TYP_GEWICHT[weg.subtype] ?? TYP_GEWICHT_SONST);
}

/**
 * Was ein Zuweisen mit dem Abschnitt täte (Fassung 3): `fertig` (Name der Straße und, wenn es einen gibt, der Artikel), `artikel` (Name der Straße, Artikel fehlt oder ein anderer), `name` (kein
 * echter Name: leer, Name der eigenen Art, Griff), `fremd` (ein anderer echter Name). `ziel.name` ist der Name, den die Abschnitte bekämen („“ ohne).
 */
export function zustandVon(
    weg: Pick<StreckenWeg, "name" | "subtype" | "wikiKey">,
    ziel: { name: string; key: string | null },
): StrassenZustand {
    const echt = pathReaderName(weg.name, weg.subtype);
    if (echt === null) return "name";
    if (echt !== ziel.name.trim()) return "fremd";
    return ziel.key === null || weg.wikiKey === ziel.key ? "fertig" : "artikel";
}

/** Eine Kante des Netzes: ein Stück eines Wegs zwischen zwei Knoten, in Meilen und gewichtet. */
export interface Kante {
    a: string;
    b: string;
    weg: string;
    meilen: number;
    gewicht: number;
}

/** Die Kanten aus der Topologie: je Weg die Stücke zwischen Anfang, inneren Teilungen und Ende (wie `buildTopologyNetwork`). `wege` in der Folge, in der die Topologie sie bekam. */
export function kantenAus(
    topologie: Topology,
    wege: readonly StreckenWeg[],
    strasse: StreckenStrasse,
    meilenJe: number,
): Kante[] {
    const kanten: Kante[] = [];
    topologie.plans.forEach((plan, index) => {
        const weg = wege[index];
        if (weg === undefined) return;
        const faktor = gewichtJeMeile(weg, strasse);
        const schnitte: { index: number; node: string }[] = [{ index: 0, node: plan.start }];
        for (const teilung of plan.splits)
            if (teilung.nodeId !== schnitte.at(-1)?.node) schnitte.push({ index: teilung.index, node: teilung.nodeId });
        schnitte.push({ index: plan.coordinates.length - 1, node: plan.end });
        for (let teil = 0; teil < schnitte.length - 1; teil += 1) {
            const von = schnitte[teil]!;
            const nach = schnitte[teil + 1]!;
            if (von.node === nach.node) continue;
            const stueck = plan.coordinates.slice(von.index, nach.index + 1);
            if (stueck.length < 2) continue;
            const meilen = lineLength(stueck) * meilenJe;
            kanten.push({ a: von.node, b: nach.node, weg: plan.publicId, meilen, gewicht: meilen * faktor });
        }
    });
    return kanten;
}

/** Das Netz für Dijkstra: je Knoten die Kanten, die an ihm hängen. */
export type Netz = ReadonlyMap<string, readonly { kante: Kante; nach: string }[]>;

export function baueNetz(kanten: readonly Kante[]): Netz {
    const netz = new Map<string, { kante: Kante; nach: string }[]>();
    const haenge = (knoten: string, eintrag: { kante: Kante; nach: string }): void => {
        const liste = netz.get(knoten);
        if (liste === undefined) netz.set(knoten, [eintrag]);
        else liste.push(eintrag);
    };
    for (const kante of kanten) {
        haenge(kante.a, { kante, nach: kante.b });
        haenge(kante.b, { kante, nach: kante.a });
    }
    return netz;
}

/** Ein kleiner Haufen (kleinstes Gewicht oben) für Dijkstra. */
class Haufen {
    private readonly daten: { d: number; knoten: string }[] = [];
    get leer(): boolean {
        return this.daten.length === 0;
    }
    rein(d: number, knoten: string): void {
        const daten = this.daten;
        daten.push({ d, knoten });
        let i = daten.length - 1;
        while (i > 0) {
            const oben = (i - 1) >> 1;
            if (daten[oben]!.d <= daten[i]!.d) break;
            [daten[oben], daten[i]] = [daten[i]!, daten[oben]!];
            i = oben;
        }
    }
    raus(): { d: number; knoten: string } {
        const daten = this.daten;
        const erster = daten[0]!;
        const letzter = daten.pop()!;
        if (daten.length > 0) {
            daten[0] = letzter;
            let i = 0;
            for (;;) {
                const l = 2 * i + 1;
                const r = l + 1;
                let klein = i;
                if (l < daten.length && daten[l]!.d < daten[klein]!.d) klein = l;
                if (r < daten.length && daten[r]!.d < daten[klein]!.d) klein = r;
                if (klein === i) break;
                [daten[klein], daten[i]] = [daten[i]!, daten[klein]!];
                i = klein;
            }
        }
        return erster;
    }
}

/** Der Weg mit dem kleinsten Gewicht von `von` nach `nach` (Dijkstra): die Kanten in Fahrtfolge, `[]` für denselben Knoten, `undefined` ohne Verbindung. */
export function kuerzesterWeg(netz: Netz, von: string, nach: string): Kante[] | undefined {
    if (von === nach) return [];
    const abstand = new Map<string, number>([[von, 0]]);
    const vorher = new Map<string, { kante: Kante; von: string }>();
    const fertig = new Set<string>();
    const haufen = new Haufen();
    haufen.rein(0, von);
    while (!haufen.leer) {
        const { d, knoten } = haufen.raus();
        if (fertig.has(knoten)) continue;
        fertig.add(knoten);
        if (knoten === nach) break;
        for (const { kante, nach: weiter } of netz.get(knoten) ?? []) {
            const neu = d + kante.gewicht;
            if (neu < (abstand.get(weiter) ?? Number.POSITIVE_INFINITY)) {
                abstand.set(weiter, neu);
                vorher.set(weiter, { kante, von: knoten });
                haufen.rein(neu, weiter);
            }
        }
    }
    if (!fertig.has(nach)) return undefined;
    const kanten: Kante[] = [];
    for (let knoten = nach; knoten !== von;) {
        const schritt = vorher.get(knoten)!;
        kanten.push(schritt.kante);
        knoten = schritt.von;
    }
    return kanten.reverse();
}

/** Die Abschnitte einer Folge von Kanten, ohne denselben Abschnitt zweimal hintereinander (ein an einem Ort geteilter Weg ist EIN Abschnitt). */
export const abschnitteDer = (kanten: readonly Kante[]): string[] =>
    kanten.map((kante) => kante.weg).filter((weg, i, alle) => i === 0 || alle[i - 1] !== weg);

export interface StreckenEingabe {
    /** Die Orte in Reihenfolge; jeder ist ein Knoten in `knoten`. */
    orte: readonly StrassenOrt[];
    /** Die Orte im Kasten (Knoten der Topologie). */
    knoten: readonly RouteNode[];
    /** Die Landwege im Kasten. */
    wege: readonly StreckenWeg[];
    strasse: StreckenStrasse;
    /** Die Abschnitte der Straße (Name oder Artikel): was nicht auf der Strecke liegt, ist abseits. */
    kandidaten: readonly string[];
    optionen: TopologyOptions;
    meilenJe: number;
}

export interface StreckenErgebnis {
    teile: StrassenTeil[];
    abseits: string[];
    /** Orte an den Enden der Abschnitte abseits, die nicht in der Liste stehen. */
    vorschlaege: string[];
    /** Die Länge jedes Wegs im Kasten, in Meilen. */
    laengen: Map<string, number>;
}

/** Die ganze Rechnung der Strecke, ohne Datenbank. */
export function rechneStrecke(eingabe: StreckenEingabe): StreckenErgebnis {
    const topologie = deriveTopology(
        eingabe.knoten,
        eingabe.wege.map((weg) => ({ publicId: weg.id, coordinates: weg.coordinates })),
        eingabe.optionen,
    );
    const netz = baueNetz(kantenAus(topologie, eingabe.wege, eingabe.strasse, eingabe.meilenJe));
    const teile: StrassenTeil[] = [];
    const aufStrecke = new Set<string>();
    for (let i = 0; i + 1 < eingabe.orte.length; i += 1) {
        const von = eingabe.orte[i]!;
        const nach = eingabe.orte[i + 1]!;
        const kanten = kuerzesterWeg(netz, von.id, nach.id);
        if (kanten === undefined) {
            teile.push({ von: von.id, nach: nach.id, laenge: null, umweg: null, abschnitte: [] });
            continue;
        }
        const laenge = kanten.reduce((summe, kante) => summe + kante.meilen, 0);
        const luftlinie = Math.hypot(nach.x - von.x, nach.y - von.y) * eingabe.meilenJe;
        const abschnitte = abschnitteDer(kanten);
        for (const id of abschnitte) aufStrecke.add(id);
        teile.push({
            von: von.id,
            nach: nach.id,
            laenge: rund(laenge),
            umweg: luftlinie > 0 ? rund(laenge / luftlinie) : 1,
            abschnitte,
        });
    }
    const abseits = [...new Set(eingabe.kandidaten)].filter((id) => !aufStrecke.has(id)).sort();
    const inListe = new Set(eingabe.orte.map((ort) => ort.id));
    const vorschlaege: string[] = [];
    const istAbseits = new Set(abseits);
    for (const ende of topologie.ends) {
        if (!istAbseits.has(ende.pathPublicId) || ende.contact !== "ort") continue;
        if (inListe.has(ende.nodeId) || vorschlaege.includes(ende.nodeId)) continue;
        vorschlaege.push(ende.nodeId);
    }
    const laengen = new Map(eingabe.wege.map((weg) => [weg.id, rund(lineLength(weg.coordinates) * eingabe.meilenJe)]));
    return { teile, abseits, vorschlaege, laengen };
}

// --- Lesen ----------------------------------------------------------------------------------------------------------------

interface WegZeile {
    id: string;
    name: string;
    subtype: string;
    revision: number;
    geojson: string;
    wiki_key: string | null;
    wiki_name: string | null;
    wiki_url: string | null;
}

const LAND = ["Flussweg", "Seeweg"];

const nichtDa = (): ApiError => new ApiError(404, "not_found", "Diesen Weg gibt es nicht.");

/** Ein Text, getrimmt, sonst der Ersatz. */
const textOder = (wert: string | null | undefined, ersatz: string): string => {
    const text = wert?.trim() ?? "";
    return text === "" ? ersatz : text;
};

/** Der Artikel (aktiver Wiki-Stand); `undefined`, wo es ihn nicht gibt. */
async function leseArtikel(
    db: Queryable,
    key: string,
): Promise<NonNullable<StrasseStreckeAntwort["artikel"]> | undefined> {
    const [stand] = await db<{ wiki_key: string; wiki_url: string; name: string | null; verlauf: string | null }[]>`
        SELECT wiki_key, wiki_url, name, verlauf FROM wiki_path_snapshot WHERE wiki_key = ${key} AND is_active
    `;
    if (stand === undefined) return undefined;
    return {
        key: stand.wiki_key,
        name: textOder(stand.name, titelOderAdresse(stand.wiki_url)),
        url: stand.wiki_url,
        verlauf: stand.verlauf,
    };
}

/** `POST /api/editor/paths/strassen-assistent/strecke`: lesend (siehe Kopf der Datei). */
export async function strasseStrecke(db: Queryable, body: StrasseStreckeBody): Promise<StrasseStreckeAntwort> {
    const [anker] = await db<{ name: string; subtype: string; map_domain_id: string; is_active: boolean }[]>`
        SELECT name, subtype, map_domain_id, is_active FROM path WHERE public_id = ${body.anker}::uuid AND subtype <> 'Seeweg'
    `;
    if (anker === undefined) throw nichtDa();
    if (!anker.is_active)
        throw new ApiError(400, "validation_failed", "Dieser Weg ist nicht auf der Karte.", { field: "anker" });
    const domain = anker.map_domain_id;
    // Der Hauptartikel der Straße, wie die Wiki-Box ihn sieht (nur einer mit Wiki-Stand); `key` nennt einen anderen oder `null` keinen.
    const box = body.key === undefined ? await wegAnschluss.lies(db, body.anker) : undefined;
    const key = body.key === undefined ? (box?.mitStand === true ? (box.artikel?.key ?? null) : null) : body.key;
    const artikel = key === null ? undefined : await leseArtikel(db, key);
    if (key !== null && artikel === undefined && body.key !== undefined)
        throw new ApiError(400, "validation_failed", "Diesen Wiki-Artikel gibt es nicht.", { field: "key" });
    const ankerName = pathReaderName(anker.name, anker.subtype);
    const name = artikel?.name ?? ankerName ?? "";
    const strasse: StreckenStrasse = {
        namen: new Set([name, ankerName ?? ""].filter((n) => n !== "")),
        key: artikel?.key ?? null,
    };

    // Die Straße: die Landwege auf der Karte mit ihrem Namen oder ihrem Artikel, dazu der Anker.
    const kandidaten = (
        await db<{ id: string }[]>`
            SELECT p.public_id::text AS id FROM path p
             WHERE p.is_active AND p.map_domain_id = ${domain} AND NOT (p.subtype = ANY(${LAND}))
               AND (p.public_id = ${body.anker}::uuid
                    OR (btrim(p.name) = ANY(${[...strasse.namen]}::text[]) AND btrim(p.name) <> p.subtype)
                    OR (${strasse.key}::text IS NOT NULL AND EXISTS (
                        SELECT 1 FROM path_wiki_assignment w JOIN wiki_path_snapshot s ON s.id = w.snapshot_id
                         WHERE w.path_id = p.id AND w.role = 'main' AND w.is_active AND s.wiki_key = ${strasse.key})))
             ORDER BY p.public_id
        `
    ).map((zeile) => zeile.id);

    // Die Orte: genannt, sonst aus dem Verlauf des Artikels.
    let orte: StrassenOrt[];
    let unbekannt: string[] = [];
    if (body.orte !== undefined) {
        const zeilen = await db<StrassenOrt[]>`
            SELECT public_id::text AS id, name, ST_X(geom) AS x, ST_Y(geom) AS y FROM place
             WHERE public_id = ANY(${body.orte}::uuid[]) AND is_active AND map_domain_id = ${domain}
        `;
        const je = new Map(zeilen.map((ort) => [ort.id, ort] as const));
        orte = [...new Set(body.orte.map((id) => id.toLowerCase()))].flatMap((id) => {
            const ort = je.get(id);
            return ort === undefined ? [] : [ort];
        });
    } else {
        const namen =
            artikel?.verlauf === null || artikel?.verlauf === undefined ? [] : zerlegeVerlauf(artikel.verlauf);
        const kandidatenOrte =
            namen.length === 0
                ? []
                : await db<OrtKandidat[]>`
                      WITH strasse AS (SELECT ST_Collect(geom) AS g FROM path WHERE public_id = ANY(${kandidaten}::uuid[]))
                      SELECT p.public_id::text AS id, p.name, ST_X(p.geom) AS x, ST_Y(p.geom) AS y, ST_Distance(p.geom, strasse.g) AS abstand
                        FROM place p, strasse
                       WHERE p.is_active AND p.map_domain_id = ${domain}
                         AND lower(btrim(p.name)) = ANY(${namen.map((n) => n.toLowerCase())}::text[])
                  `;
        ({ orte, unbekannt } = waehleOrte(namen, kandidatenOrte));
    }

    // Der Kasten um Orte und Straße.
    const [huelle] = await db<{ x0: number | null; y0: number | null; x1: number | null; y1: number | null }[]>`
        SELECT ST_XMin(e) AS x0, ST_YMin(e) AS y0, ST_XMax(e) AS x1, ST_YMax(e) AS y1
          FROM (SELECT ST_Extent(geom) AS e FROM path WHERE public_id = ANY(${kandidaten}::uuid[])) AS k
    `;
    const xs = [...orte.map((ort) => ort.x), huelle?.x0, huelle?.x1].filter((x): x is number => typeof x === "number");
    const ys = [...orte.map((ort) => ort.y), huelle?.y0, huelle?.y1].filter((y): y is number => typeof y === "number");
    const kasten =
        xs.length === 0
            ? undefined
            : (() => {
                  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
                  const rand = Math.max(Math.hypot(x1 - x0, y1 - y0) / 4, KASTEN_RAND_MIN);
                  return { x0: x0 - rand, y0: y0 - rand, x1: x1 + rand, y1: y1 + rand };
              })();
    const wegZeilen =
        kasten === undefined
            ? []
            : await db<WegZeile[]>`
                  SELECT p.public_id::text AS id, p.name, p.subtype, p.revision::int AS revision, ST_AsGeoJSON(p.geom, 15) AS geojson,
                         s.wiki_key, s.name AS wiki_name, w.wiki_url
                    FROM path p
                    LEFT JOIN path_wiki_assignment w ON w.path_id = p.id AND w.role = 'main' AND w.is_active
                         AND w.assignment_state IN ('assigned', 'address_only')
                    LEFT JOIN wiki_path_snapshot s ON s.id = w.snapshot_id AND s.is_active
                   WHERE p.is_active AND p.map_domain_id = ${domain} AND NOT (p.subtype = ANY(${LAND}))
                     AND p.geom && ST_MakeEnvelope(${kasten.x0}, ${kasten.y0}, ${kasten.x1}, ${kasten.y1}, 0)
                   ORDER BY p.public_id
              `;
    const knoten =
        kasten === undefined
            ? []
            : (
                  await db<{ id: string; name: string; hidden: boolean; x: number; y: number }[]>`
                      SELECT public_id::text AS id, name, is_hidden AS hidden, ST_X(geom) AS x, ST_Y(geom) AS y FROM place
                       WHERE is_active AND map_domain_id = ${domain}
                         AND geom && ST_MakeEnvelope(${kasten.x0}, ${kasten.y0}, ${kasten.x1}, ${kasten.y1}, 0)
                       ORDER BY public_id
                  `
              ).map((ort): RouteNode => ({
                  id: ort.id,
                  name: ort.name,
                  kind: "place",
                  isHidden: ort.hidden,
                  x: ort.x,
                  y: ort.y,
              }));
    const wege: StreckenWeg[] = wegZeilen.map((zeile) => ({
        id: zeile.id,
        name: zeile.name,
        subtype: zeile.subtype,
        coordinates: (JSON.parse(zeile.geojson) as { coordinates: [number, number][] }).coordinates,
        wikiKey: zeile.wiki_url === null ? null : (zeile.wiki_key ?? titelOderAdresse(zeile.wiki_url)),
    }));
    const werte = await wegfindungswerte(db);
    const ergebnis = rechneStrecke({
        orte,
        knoten,
        wege,
        strasse,
        kandidaten,
        optionen: netzOptionen(werte),
        meilenJe: werte.meilenJeKarteneinheit,
    });

    // Die Quellen der Straße und je Abschnitt, wie viele davon er trägt.
    const quellen = await quellenDerStrasse(db, { mapDomainId: domain, name, key: strasse.key });
    const genannt = [...new Set([...ergebnis.teile.flatMap((teil) => teil.abschnitte), ...ergebnis.abseits])];
    const getragen = new Map(
        quellen.length === 0
            ? []
            : (
                  await db<{ id: string; n: number }[]>`
                      SELECT p.public_id::text AS id, count(*)::int AS n FROM path_source v JOIN path p ON p.id = v.path_id
                       WHERE p.public_id = ANY(${genannt}::uuid[]) AND v.is_active AND v.source_id = ANY(${quellen.map((q) => q.quelleId)}::bigint[])
                       GROUP BY p.public_id
                  `
              ).map((zeile) => [zeile.id, zeile.n] as const),
    );
    const zeileVon = new Map(wegZeilen.map((zeile) => [zeile.id, zeile] as const));
    const wegVon = new Map(wege.map((weg) => [weg.id, weg] as const));
    const abschnitte: Record<string, StrassenAbschnitt> = {};
    for (const id of genannt) {
        const zeile = zeileVon.get(id);
        const weg = wegVon.get(id);
        if (zeile === undefined || weg === undefined) continue;
        abschnitte[id] = {
            id,
            revision: zeile.revision,
            name: zeile.name,
            subtype: zeile.subtype,
            laenge: ergebnis.laengen.get(id) ?? 0,
            zustand: zustandVon(weg, { name, key: strasse.key }),
            wiki:
                zeile.wiki_url === null
                    ? null
                    : {
                          key: weg.wikiKey ?? titelOderAdresse(zeile.wiki_url),
                          name: textOder(zeile.wiki_name, titelOderAdresse(zeile.wiki_url)),
                      },
            quellen: getragen.get(id) ?? 0,
            coordinates: weg.coordinates,
        };
    }
    const ortVon = new Map(knoten.map((ort) => [ort.id, ort] as const));
    return {
        artikel: artikel ?? null,
        name,
        orte,
        unbekannt,
        teile: ergebnis.teile,
        abschnitte,
        abseits: ergebnis.abseits.filter((id) => abschnitte[id] !== undefined),
        vorschlaege: ergebnis.vorschlaege.flatMap((id) => {
            const ort = ortVon.get(id);
            return ort === undefined ? [] : [{ id: ort.id, name: ort.name, x: ort.x, y: ort.y }];
        }),
        quellen: quellen.map((quelle) => ({ id: quelle.id, titel: quelle.titel })),
    };
}
