import type { OperationReceipt } from "@avesmaps3d/shared";
import type { Queryable } from "../database.ts";

/**
 * Den Auftrag `sprache_treffer` einreihen (WI-0261 S4; O4; Claudio 2026-10-30 §3, `handovers/2026-10-30-wi0261-sprachen-antwort-an-claudia.md`).
 * Eine eigene kleine Datei, damit die Schreibnaht (`editor/map-operation.ts`) die Rechnung (`jobs/sprachen-treffer-job.ts`) nicht mitlädt.
 *
 * - **Umfang** eines Laufs: alles (nach dem Import, S6), eine oder mehrere Sprachen (nach dem Speichern einer Sprachfläche im Spracheditor, S5:
 *   nur deren Treffer löschen und neu bestimmen) oder bestimmte Objekte (nach einer Operation an Ort, Weg, Gebiet oder Landschaft: nur deren
 *   Treffer). Claudio §3: nach einem Speichern nie voll neu rechnen.
 * - **Zusammenlegen:** Der wartende Auftrag der Domäne nimmt jeden weiteren Anlass mit und vereinigt den Umfang (`sprache_treffer_sammeln`,
 *   Migration 0256): gleitend 30 s Ruhe, höchstens 120 s nach dem ersten Anlass (Claudio §3: „Entprellen, z. B. 30 s“). Ein Lauf über alles
 *   schluckt jeden kleineren, mehr als 200 Objekte werden einer über alles.
 * - **Ohne aktive Sprachfläche** reiht eine Operation an der Karte nichts ein: Bis zum Import (S6) gibt es keine, und jede Speicherung bliebe
 *   sonst ein leerer Auftrag in der Warteschlange.
 */

export const SPRACHE_TREFFER_JOB_KIND = "sprache_treffer";
export const SPRACHE_TREFFER_RUHE_S = 30;
export const SPRACHE_TREFFER_HOECHSTENS_S = 120;

/** Die Arten der Objekte, die Treffer haben (`sprache_treffer.objekt_art`). */
export const TREFFER_ARTEN = ["place", "territory", "region", "path"] as const;
export type TrefferArt = (typeof TREFFER_ARTEN)[number];

/**
 * Die Phasen eines Laufs, je Art eine Transaktion, mit grobem Fortschritt nach der Messung des vollen Laufs (WI-0261 S4, lokal 2026-10-30 mit
 * den 527 Teilflächen der Sprachenkarte: Orte 0,2 s, Gebiete 0,5 s, Regionen 3,3 s, Wege 1,0 s). Zwischen den Phasen kommt ein Abbruch an.
 */
export const SPRACHE_TREFFER_PHASEN: readonly {
    readonly name: string;
    readonly progress: number;
    readonly art: TrefferArt;
}[] = [
    { name: "orte", progress: 0, art: "place" },
    { name: "gebiete", progress: 0.05, art: "territory" },
    { name: "regionen", progress: 0.15, art: "region" },
    { name: "wege", progress: 0.8, art: "path" },
];

/**
 * Die Phase der Mischgebiete (WI-0261 S5a, Migration 0257, `jobs/sprachen-misch.ts`): nach den Treffern, nur wenn der Umfang Sprachen oder
 * „alle“ nennt. Ihr Fortschritt ist geschätzt (55 Paare der 11 Sprachen verschneiden ihre vereinigten Flächen; weniger als die Wege).
 */
export const SPRACHE_MISCH_PHASE = { name: "misch", progress: 0.95 } as const;

/**
 * Der Umfang eines Laufs, wie er in `job.input_ref` steht: `alle`, oder Sprachen (`sprache.public_id`) und Objekte je Art (`public_id`).
 * Leer ist kein Umfang.
 */
export type TrefferUmfang =
    { alle: true } | { sprachen?: readonly string[]; objekte?: Partial<Record<TrefferArt, readonly string[]>> };

type Arbeit = OperationReceipt["derivedWork"][number];

/** Reiht den Auftrag ein oder legt den Umfang zum wartenden der Domäne; gibt dessen Kennung zurück. In der Transaktion des Aufrufers. */
export async function sprachTrefferEinreihen(
    tx: Queryable,
    actorRef: string,
    mapDomainId: string,
    umfang: TrefferUmfang,
): Promise<string> {
    const [auftrag] = await tx<{ public_id: string }[]>`
        SELECT sprache_treffer_sammeln(${mapDomainId}, ${actorRef}, ${tx.json(umfang as never)}::jsonb,
                                       ${SPRACHE_TREFFER_RUHE_S}::int, ${SPRACHE_TREFFER_HOECHSTENS_S}::int)::text AS public_id
    `;
    return auftrag!.public_id;
}

/**
 * Für den Spracheditor (S5): die Treffer dieser Sprachen (`sprache.public_id`) neu rechnen lassen, etwa nach dem Speichern, Stilllegen oder
 * Zurückholen einer Teilfläche oder der Sprache selbst. Auch eine stillgelegte Sprache gehört hierher: Der Lauf löscht dann ihre Treffer.
 */
export function sprachTrefferNeuRechnenLassen(
    tx: Queryable,
    actorRef: string,
    mapDomainId: string,
    sprachen: readonly string[],
): Promise<string> {
    return sprachTrefferEinreihen(tx, actorRef, mapDomainId, { sprachen });
}

/** Für den Import (S6): alle Treffer der Domäne neu rechnen lassen. */
export function alleSprachTrefferNeuRechnenLassen(
    tx: Queryable,
    actorRef: string,
    mapDomainId: string,
): Promise<string> {
    return sprachTrefferEinreihen(tx, actorRef, mapDomainId, { alle: true });
}

/** Gibt es in der Domäne eine aktive Sprachfläche einer aktiven Sprache? */
export async function hatAktiveSprachflaechen(tx: Queryable, mapDomainId: string): Promise<boolean> {
    const [zeile] = await tx<{ ja: boolean }[]>`
        SELECT EXISTS (
            SELECT 1 FROM sprache_flaeche f JOIN sprache s ON s.id = f.sprache_id
             WHERE f.map_domain_id = ${mapDomainId} AND f.is_active AND s.is_active
        ) AS ja
    `;
    return zeile?.ja === true;
}

/**
 * Die Sprachen (`sprache.public_id`), deren Treffer ein Lauf neu bestimmen muss: die genannten, die eine Teilfläche haben (aktiv oder stillgelegt).
 * Eine Sprache ohne jede Fläche hat keine Treffer und keine Mischgebiete; für sie wäre der Lauf leer.
 */
async function sprachenMitFlaechen(tx: Queryable, sprachen: readonly string[]): Promise<string[]> {
    if (sprachen.length === 0) return [];
    const zeilen = await tx<{ id: string }[]>`
        SELECT s.public_id::text AS id FROM sprache s
         WHERE s.public_id::text = ANY(${[...sprachen]}::text[])
           AND EXISTS (SELECT 1 FROM sprache_flaeche f WHERE f.sprache_id = s.id)
         ORDER BY s.id
    `;
    return zeilen.map((zeile) => zeile.id);
}

/**
 * Die Folge einer Operation an der Karte (`deriveAfter`): Hat sie einen Ort (`place`), einen Weg (`path`), ein Herrschaftsgebiet (`territory`)
 * oder eine seiner Flächen (`territory_area`), eine Landschaft (`landscape`) oder eine ihrer Teilflächen (`area`) berührt, den Auftrag für
 * diese Objekte (eine Fläche zählt für ihr Gebiet oder ihre Landschaft); sonst nichts. Ob das Objekt danach noch zählt (stillgelegt, ein Meer,
 * versteckt), entscheidet der Lauf: Er löscht seine Treffer und legt nur an, was zählt.
 *
 * Hat sie eine Sprache berührt (`sprache`; der Spracheditor nennt sie auch an jeder Operation an einer ihrer Teilflächen, WI-0261 S5d), den Auftrag für
 * diese Sprachen, und zwar auch ohne aktive Sprachfläche: Wer die letzte Fläche oder die Sprache stilllegt, braucht den Lauf, der ihre Treffer löscht.
 * Operationen, deren Werte in keinen Treffer eingehen (Name, Farbe, Wiki-Artikel), melden `ableitung: false` und kommen gar nicht hierher.
 */
export async function sprachTrefferNachOperation(
    tx: Queryable,
    actorRef: string,
    mapDomainId: string,
    affected: OperationReceipt["affected"],
): Promise<Arbeit[]> {
    const ids = (kind: string): string[] => [
        ...new Set(affected.filter((entity) => entity.kind === kind).map((entity) => entity.id)),
    ];
    const sprachen = await sprachenMitFlaechen(tx, ids("sprache"));
    const orte = ids("place");
    const wege = ids("path");
    const gebiete = ids("territory");
    const gebietsflaechen = ids("territory_area");
    const landschaften = ids("landscape");
    const teilflaechen = ids("area");
    const zahl =
        orte.length + wege.length + gebiete.length + gebietsflaechen.length + landschaften.length + teilflaechen.length;
    if (zahl === 0 || !(await hatAktiveSprachflaechen(tx, mapDomainId))) {
        if (sprachen.length === 0) return [];
        const jobId = await sprachTrefferNeuRechnenLassen(tx, actorRef, mapDomainId, sprachen);
        return [{ kind: SPRACHE_TREFFER_JOB_KIND, jobId, state: "queued" }];
    }

    const zuGebieten =
        gebietsflaechen.length === 0
            ? []
            : await tx<{ id: string }[]>`
                  SELECT DISTINCT t.public_id::text AS id FROM territory_area a JOIN territory t ON t.id = a.territory_id
                   WHERE a.public_id::text = ANY(${gebietsflaechen}::text[])
              `;
    const zuLandschaften =
        teilflaechen.length === 0
            ? []
            : await tx<{ id: string }[]>`
                  SELECT DISTINCT r.public_id::text AS id FROM region_area a JOIN region r ON r.id = a.region_id
                   WHERE a.public_id::text = ANY(${teilflaechen}::text[])
              `;
    const objekte: Partial<Record<TrefferArt, string[]>> = {};
    const setze = (art: TrefferArt, kennungen: readonly string[]): void => {
        const eindeutig = [...new Set(kennungen)];
        if (eindeutig.length > 0) objekte[art] = eindeutig;
    };
    setze("place", orte);
    setze("path", wege);
    setze("territory", [...gebiete, ...zuGebieten.map((zeile) => zeile.id)]);
    setze("region", [...landschaften, ...zuLandschaften.map((zeile) => zeile.id)]);
    if (Object.keys(objekte).length === 0 && sprachen.length === 0) return [];
    const jobId = await sprachTrefferEinreihen(
        tx,
        actorRef,
        mapDomainId,
        sprachen.length === 0 ? { objekte } : { sprachen, ...(Object.keys(objekte).length === 0 ? {} : { objekte }) },
    );
    return [{ kind: SPRACHE_TREFFER_JOB_KIND, jobId, state: "queued" }];
}

/**
 * Liest den Umfang aus der Eingabe des Auftrags, oder `null`, wenn sie keiner ist (eine kaputte Eingabe ist nicht wiederholbar). Kennungen sind
 * Text in UUID-Form; die Datenbank hat sie beim Einreihen schon gelesen (`sprache_treffer_sammeln`).
 */
export function umfangAus(input: Record<string, unknown>): TrefferUmfang | null {
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
    const liste = (wert: unknown): string[] | null =>
        wert === undefined
            ? []
            : Array.isArray(wert) && wert.every((x): x is string => typeof x === "string" && uuid.test(x))
              ? wert
              : null;
    const schluessel = Object.keys(input);
    if (schluessel.some((name) => name !== "alle" && name !== "sprachen" && name !== "objekte")) return null;
    if (input["alle"] !== undefined) return input["alle"] === true ? { alle: true } : null;
    const sprachen = liste(input["sprachen"]);
    if (sprachen === null) return null;
    const rohObjekte = input["objekte"] ?? {};
    if (typeof rohObjekte !== "object" || rohObjekte === null || Array.isArray(rohObjekte)) return null;
    const objekte: Partial<Record<TrefferArt, string[]>> = {};
    for (const [art, wert] of Object.entries(rohObjekte)) {
        if (!(TREFFER_ARTEN as readonly string[]).includes(art)) return null;
        const kennungen = liste(wert);
        if (kennungen === null) return null;
        if (kennungen.length > 0) objekte[art as TrefferArt] = kennungen;
    }
    if (sprachen.length === 0 && Object.keys(objekte).length === 0) return null;
    return { sprachen, objekte };
}
