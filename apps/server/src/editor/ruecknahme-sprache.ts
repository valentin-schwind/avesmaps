import type { PendingQuery, Row } from "postgres";
import {
    type Capability,
    type MapHistoryEntry,
    type MapHistoryObjectKind,
    type OperationReceipt,
    type RuecknahmeBody,
    type RuecknahmePruefung,
    type RuecknahmeReceipt,
    type RuecknahmeVorschauBody,
} from "@avesmaps3d/shared";
import type { Sql } from "../auth/session-store.ts";
import type { Database, Queryable } from "../database.ts";
import { ApiError } from "../http/api-error.ts";
import { geometrie } from "../sprachen/editor-flaechen.ts";
import {
    SPRACHE_ART,
    SPRACHEN_DOMAENE,
    SPRACHFLAECHE_ART,
    flaechenStand,
    leseSpracheZeile,
    pruefeFremdeSprachSperre,
    spracheStand,
} from "../sprachen/editor-naht.ts";
import {
    ordnePillen,
    pillenVon,
    protokoll as pillenProtokoll,
    zaehleSprachRevision,
    type PillenProtokoll,
} from "../sprachen/editor-wiki.ts";
import { eintraegeNachKennung } from "./history.ts";
import type { MapActor, MapAuditEntry, MapChange } from "./map-operation.ts";
import {
    fuehreRuecknahmeAus,
    pruefeFamilie,
    type RuecknahmeFamilie,
    type RuecknahmeHaken,
    type RuecknahmeSchreiben,
    type SchreibErgebnis,
} from "./ruecknahme-ablauf.ts";
import { RUECKNAHME_SPRACHE_OPERATION, SPRACHE_OPERATIONEN } from "./ruecknahme-arten.ts";
import type { RuecknahmeAdapter, RuecknahmeLeser, VorKonflikt, Vorpruefung } from "./ruecknahme.ts";
import { polygoneVon, ringe, schluessel as eckenSchluessel, type Punkt } from "./ring-form.ts";

/**
 * Sprachen zurücknehmen (WI-0265 B6e, für WI-0261; Fachvertrag `project-control/planning/aenderungen-arbeitsserien-fachvertrag.md` C.2, C.3, F.1; Testvertrag U2 bis U9, U13): der Adapter des
 * Spracheditors für die Vorprüfung (`ruecknahme.ts`), die Vorschau und die Rücknahme in EINER Operation `sprache.restore_series` (Quelle `restore`, `reverts` = die offenen Mitglieder in
 * Serienfolge, EIN `deriveAfter`; Ablauf, Fehler und Sperren in `ruecknahme-ablauf.ts`). Die Route hängt an EINER Sprache (`:id`), die jedes Mitglied berührt (eine Teilfläche trägt ihre
 * Sprache im Protokoll mit).
 *
 * - **Was zurückgeht** (Parität mit dem Client-↺ des Sprachverlaufs, das hiermit entfällt, und mehr): die Felder der Sprache (Name, Legende, Farbe, Reihenfolge), ihre Wiki-Artikel samt dem,
 *   was einer anderen Sprache dafür genommen wurde (die Artikel kehren zu ihr zurück, mit der Herkunft der Zuordnung von vorher), Stilllegen und Zurückholen der Sprache, die Form einer
 *   Teilfläche samt ihrer Herkunft (`redaktion` oder `sprachenkarte` mit Revision der Quelle, T-1), Stilllegen und Zurückholen einer Teilfläche und die Werkzeuge, die in EINER Operation über
 *   mehrere Teilflächen und auch Sprachen schreiben („Unterflächen“, „Zerschneiden“, „Mit anderer Fläche“, „Kopieren“ samt „Originalfläche löschen“): jede Teilfläche mit ihrer ganzen Form,
 *   ganz oder gar nicht. „Kopieren …“ in eine NEUE Sprache hat die Sprache in derselben Operation angelegt (`sprache.created`): Die Rücknahme legt auch sie still.
 * - **Die Inverse folgt dem Protokoll, nicht dem Vorwärtsweg:** Jeder Gegenstand und jedes Feld geht auf den Wert VOR dem ersten Mitglied, das es berührt (C.3). Das Anlegen einer Teilfläche
 *   oder Sprache innerhalb einer Operation (`sprache.created`, `sprache_flaeche.created`, `.copied`) geht zurück als Stilllegen (nichts wird gelöscht). Die Schreibteile sind die der
 *   Vorwärtswege (`spracheStand`, `flaechenStand`, `ordnePillen`), nicht kopiert: Stilllegen setzt dieselben Spalten, Pillen kommen über dieselbe zweistufige Stellenfolge zurück.
 * - **Bedingung** (`pruefeWerte`, streng und alles oder nichts): Jedes Feld, das die Mitglieder berührten, steht heute so, wie das LETZTE Mitglied es hinterließ; dazu die Revision je Sprache und
 *   Teilfläche aus der Vorprüfung des Kerns. Ein Wiki-Artikel, der zurückkäme, darf nicht inzwischen einer anderen Sprache gehören oder aus dem Wiki verschwunden sein (`sprache_wiki`). Eine
 *   Teilfläche kommt nur zurück, wenn die Redaktion sie stilllegte (`retired_origin = editor`): was ein späterer Import ersetzte, gehört zu einer alten Vorlage.
 * - **Sperre:** Wie bei den übrigen Familien zählt nur die FREMDE Sperre (409 `object_locked`), auch an der anderen Sprache einer Kopie oder an der, der ein Artikel genommen wurde. Die eigene
 *   Sperre der Sprache verlangt die Rücknahme nicht: Sie geht aus „Änderungen“, ohne dass ein Fenster der Sprache offen ist.
 * - **Folgen:** Berührt die Rücknahme eine Teilfläche oder den Bestand einer Sprache (Stilllegen, Zurückholen), reiht die Schreibnaht EINEN Auftrag `sprache_treffer` ein (`deriveAfter`, wie die
 *   Vorwärtswege); Name, Legende, Farbe, Reihenfolge und Wiki-Artikel gehen in keinen Treffer ein (`ableitung: false`). Das Gelände ist nicht betroffen.
 * - **Grund** (Gate 2): Betrifft die Rücknahme eine andere Person, ist `reason` Pflicht (400 `reason_required`) und steht als `restoreReason` an jedem Eintrag.
 *
 * **Anlegen** (WI-0265 B8c): Eine neue Sprache (`sprache.create`, auf Wunsch gleich mit Wiki-Artikeln, die sie einer anderen Sprache nahm), eine neue Teilfläche (`sprache_flaeche.create`) und eine Teilfläche der
 * Derographie als Kopie in einer Sprache (`sprache.flaeche_aus_landschaft`, auch in eine neue Sprache) gehen zurück als Stilllegen, ganz oder gar nicht: Die Sprache gibt ihre Wiki-Artikel frei, und die Sprache,
 * der sie genommen wurden, bekommt sie zurück (die freien zuerst, `schreibeSprache`). Was die Serie anlegte, kommt nur still (`active`); sein Name, seine Farbe und seine Artikel danach bleiben, wie sie sind.
 * Die Rücknahme dieser Rücknahme belebt wieder (`sprache.restored`, `sprache_flaeche.restored`). Die Fläche der Derographie, aus der kopiert wurde, wird nie angefasst (die Quelle steht als Feld `kopiertAus`,
 * nicht als Ziel der Zeile); die Landschaft meldet eine solche Kopie bei der Rücknahme ihrer Anlage (`ruecknahme-flaeche.ts`).
 */

type Art = "sprache" | "sprache_flaeche";
const ARTEN: readonly Art[] = ["sprache", "sprache_flaeche"];
const istArt = (kind: MapHistoryObjectKind): kind is Art => (ARTEN as readonly string[]).includes(kind);

/** Die Felder je Art, die das Protokoll führt und die Rücknahme setzt (Positivliste `MAP_AUDIT_FIELDS`, ohne `restoreReason`, `schluessel`, `kopiertAus`). */
const FELDER: Readonly<Record<Art, ReadonlySet<string>>> = {
    sprache: new Set(["name", "legende", "farbe", "reihenfolge", "active", "wiki"]),
    sprache_flaeche: new Set(["geometry", "herkunft", "quelleRevision", "active"]),
};
/** Die Felder der Sprache, die in einer Spalte der Tafel stehen (ohne Stand und Wiki). */
const SPRACH_SPALTEN = ["name", "legende", "farbe", "reihenfolge"] as const;

// Die Namen der Operationen dieser Familie (Anlegen und eine Fläche der Derographie in eine Sprache gehören nicht dazu) stehen im Katalog (`ruecknahme-arten.ts`, WI-0265 B6f): Liste, Zustandsfilter und dieser Adapter sagen so dasselbe.

/** Die Aktionen der Protokolleinträge, die die Inverse kennt. */
const AKTIONEN: ReadonlySet<string> = new Set([
    "sprache.created",
    "sprache.updated",
    "sprache.wiki_changed",
    "sprache.wiki_released",
    "sprache.retired",
    "sprache.restored",
    "sprache_flaeche.created",
    "sprache_flaeche.copied",
    "sprache_flaeche.reshaped",
    "sprache_flaeche.parts",
    "sprache_flaeche.split",
    "sprache_flaeche.boolean",
    "sprache_flaeche.retired",
    "sprache_flaeche.restored",
]);

/** Eine Aktion, die einen Gegenstand anlegt: Zurück geht sie als Stilllegen (`active` wird `false`). */
const ANLEGEN: ReadonlySet<string> = new Set(["sprache.created", "sprache_flaeche.created", "sprache_flaeche.copied"]);

/** Stilllegen und Zurückholen einer Teilfläche tragen an ihrem Eintrag nur `active` als Ziel (die Form vorher steht dort zur Anzeige, ohne `after`). */
const NUR_STAND: ReadonlySet<string> = new Set(["sprache_flaeche.retired", "sprache_flaeche.restored"]);

// --- Der Plan ---------------------------------------------------------------------------------------------------------------

/** Was ein Feld über die Mitglieder hinweg erlebt hat: der Wert vor dem ersten und nach dem letzten Mitglied, das es berührt (C.3). */
interface FeldZiel {
    vorher: unknown;
    nachher: unknown;
}

interface PlanGegenstand {
    art: Art;
    id: string;
    name?: string;
    /** Die Sprache einer Teilfläche (öffentliche Kennung), soweit das Protokoll sie nennt. */
    sprache?: string;
    felder: Map<string, FeldZiel>;
    /** Ein Mitglied legte den Gegenstand an (`ANLEGEN`): Zurück heißt stillgelegt, seine späteren Felder bleiben (`zielWerte`). */
    angelegt: boolean;
}

type Plan = Map<string, PlanGegenstand>;

const schl = (art: string, id: string): string => `${art}:${id}`;

function setze(g: PlanGegenstand, feld: string, vorher: unknown, nachher: unknown): void {
    const bisher = g.felder.get(feld);
    if (bisher === undefined) g.felder.set(feld, { vorher, nachher });
    else bisher.nachher = nachher;
}

/**
 * Der Plan aus den Protokolleinträgen der offenen Mitglieder (volle Nutzlast), in der Folge der Serie: je Gegenstand und Feld der Wert vor dem ersten und nach dem letzten Mitglied.
 */
export function bauePlan(eintraege: readonly MapHistoryEntry[]): Plan {
    const plan: Plan = new Map();
    for (const eintrag of [...eintraege].sort((a, b) => a.seq - b.seq)) {
        for (const o of eintrag.objects) {
            if (!istArt(o.kind)) continue;
            const key = schl(o.kind, o.id);
            let g = plan.get(key);
            if (g === undefined) {
                const sprache = o.kind === "sprache" ? o.id : o.sprache?.id;
                g = {
                    art: o.kind,
                    id: o.id,
                    felder: new Map(),
                    angelegt: false,
                    ...(o.name !== undefined ? { name: o.name } : {}),
                    ...(sprache !== undefined ? { sprache } : {}),
                };
                plan.set(key, g);
            }
            if (ANLEGEN.has(o.action)) {
                // Der Gegenstand entstand in dieser Operation: Zurück bedeutet stillgelegt; Name, Farbe und Form von damals sind kein Ziel.
                g.angelegt = true;
                setze(g, "active", false, true);
                continue;
            }
            for (const [feld, wechsel] of Object.entries(o.changes)) {
                if (!FELDER[o.kind].has(feld)) continue;
                if (NUR_STAND.has(o.action) && feld !== "active") continue;
                setze(g, feld, wechsel.before ?? null, wechsel.after ?? null);
            }
        }
    }
    return plan;
}

const ART_FOLGE: Readonly<Record<Art, number>> = { sprache: 0, sprache_flaeche: 1 };
const sortiert = (plan: Plan): PlanGegenstand[] =>
    [...plan.values()].sort((a, b) => ART_FOLGE[a.art] - ART_FOLGE[b.art] || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

// --- Der heutige Stand ------------------------------------------------------------------------------------------------------

interface Ist {
    /** Die Werte der Felder, wie das Protokoll sie führt (`null`, wo leer). */
    werte: Record<string, unknown>;
    revision: number;
    /** Die Zeilennummer (`id`) in der Tafel. */
    pk: string;
    /** Von wem stillgelegt (`editor` oder `import`), wenn es das ist. */
    stillgelegtVon: string | null;
}

interface SpracheRow {
    pk: string;
    id: string;
    name: string;
    legende: string | null;
    farbe: string;
    reihenfolge: number;
    aktiv: boolean;
    von: string | null;
    revision: number;
}
interface PilleRow {
    sprache: string;
    id: string;
    titel: string;
}
interface FlaecheRow {
    pk: string;
    id: string;
    herkunft: string;
    quelle: string | null;
    aktiv: boolean;
    von: string | null;
    revision: number;
    geojson: string;
}

/** Der heutige Stand der Gegenstände des Plans; ein Gegenstand, den es nicht (mehr) gibt, fehlt. */
async function leseIstAlle(db: Queryable, plan: Plan): Promise<Map<string, Ist>> {
    const ist = new Map<string, Ist>();
    const ids = (art: Art): string[] => [...plan.values()].filter((g) => g.art === art).map((g) => g.id);
    if (ids("sprache").length > 0) {
        const pillen = await db<PilleRow[]>`
            SELECT s.public_id::text AS sprache, a.public_id::text AS id, a.titel
              FROM sprache_wiki w JOIN sprache s ON s.id = w.sprache_id JOIN wiki_sprache_artikel a ON a.id = w.wiki_sprache_artikel_id
             WHERE s.public_id = ANY(${ids("sprache")}::uuid[]) AND w.is_active
             ORDER BY s.id, w.position, w.id
        `;
        for (const r of await db<SpracheRow[]>`
            SELECT id::text AS pk, public_id::text AS id, name, legende, farbe, reihenfolge, is_active AS aktiv, retired_origin AS von,
                   revision::int AS revision
              FROM sprache WHERE public_id = ANY(${ids("sprache")}::uuid[])
        `)
            ist.set(schl("sprache", r.id), {
                pk: r.pk,
                revision: r.revision,
                stillgelegtVon: r.von,
                werte: {
                    name: r.name,
                    legende: r.legende,
                    farbe: r.farbe,
                    reihenfolge: r.reihenfolge,
                    active: r.aktiv,
                    wiki: pillen.filter((p) => p.sprache === r.id).map((p) => ({ id: p.id, titel: p.titel })),
                },
            });
    }
    if (ids("sprache_flaeche").length > 0)
        for (const r of await db<FlaecheRow[]>`
            SELECT id::text AS pk, public_id::text AS id, herkunft, quelle_revision AS quelle, is_active AS aktiv, retired_origin AS von,
                   revision::int AS revision, ST_AsGeoJSON(geom, 15) AS geojson
              FROM sprache_flaeche WHERE public_id = ANY(${ids("sprache_flaeche")}::uuid[])
        `)
            ist.set(schl("sprache_flaeche", r.id), {
                pk: r.pk,
                revision: r.revision,
                stillgelegtVon: r.von,
                werte: {
                    geometry: ringe(polygoneVon(r.geojson)),
                    herkunft: r.herkunft,
                    quelleRevision: r.quelle,
                    active: r.aktiv,
                },
            });
    return ist;
}

// --- Vergleichen ------------------------------------------------------------------------------------------------------------

const artikelIds = (wert: unknown): string[] =>
    Array.isArray(wert) ? (wert as { id: string }[]).map((pille) => pille.id) : [];

/** Ein Wert in fester Form zum Vergleichen: die Form auf fünf Nachkommastellen (wie die Vorwärtswege), die Pillen als Folge ihrer Artikel, leer als `null`. */
function norm(feld: string, wert: unknown): string {
    if (feld === "geometry")
        return JSON.stringify(
            ((wert ?? []) as number[][][][]).map((polygon) =>
                polygon.map((ring) => ring.map(([x, y]) => eckenSchluessel([x!, y!] as Punkt))),
            ),
        );
    if (feld === "wiki") return JSON.stringify(artikelIds(wert));
    return JSON.stringify(wert ?? null);
}
const gleich = (feld: string, a: unknown, b: unknown): boolean => norm(feld, a) === norm(feld, b);

const ausRingen = (wert: unknown): Punkt[][][] =>
    ((wert ?? []) as number[][][][]).map((polygon) => polygon.map((ring) => ring.map(([x, y]) => [x!, y!] as const)));

/** Der Wert, den das Feld nach der Rücknahme hat, als Pillen: die des Ziels in der Folge des Protokolls. */
const zielPillen = (g: PlanGegenstand): PillenProtokoll[] =>
    ((g.felder.get("wiki")?.vorher ?? []) as PillenProtokoll[]).map((pille) => ({ id: pille.id, titel: pille.titel }));

// --- Recht und Art ----------------------------------------------------------------------------------------------------------

const SPRACHE_WIKI_SATZ =
    "Ein Wiki-Artikel, der zurückkäme, gehört heute einer anderen Sprache oder steht nicht mehr im Wiki.";

/**
 * Die Wiki-Artikel, die an einer Sprache zurückkämen, müssen frei sein: Sie dürfen heute keiner Sprache gehören, die nicht selbst im Plan steht und sie abgäbe, und müssen im Wiki stehen
 * (ein Artikel, der aus dem Wiki verschwand, bleibt, wo er ist, kommt aber nirgends neu dazu).
 */
async function wikiKonflikte(db: Queryable, plan: Plan, ist: ReadonlyMap<string, Ist>): Promise<VorKonflikt[]> {
    // Eine Sprache, die die Serie anlegte, kommt still und gibt ihre Artikel frei: Ihre Artikel danach sind kein Ziel.
    const mitWiki = sortiert(plan).filter(
        (g) => g.art === "sprache" && !g.angelegt && g.felder.has("wiki") && ist.has(schl(g.art, g.id)),
    );
    const neuJe = new Map<string, string[]>();
    for (const g of mitWiki) {
        const heute = new Set(artikelIds(ist.get(schl(g.art, g.id))!.werte["wiki"]));
        const neu = zielPillen(g)
            .map((pille) => pille.id)
            .filter((id) => !heute.has(id));
        if (neu.length > 0) neuJe.set(g.id, neu);
    }
    if (neuJe.size === 0) return [];
    const alle = [...new Set([...neuJe.values()].flat())];
    const zeilen = await db<{ id: string; aktiv: boolean; besitzer: string | null }[]>`
        SELECT a.public_id::text AS id, a.is_active AS aktiv, s.public_id::text AS besitzer
          FROM wiki_sprache_artikel a
          LEFT JOIN sprache_wiki w ON w.wiki_sprache_artikel_id = a.id AND w.is_active
          LEFT JOIN sprache s ON s.id = w.sprache_id
         WHERE a.public_id = ANY(${alle}::uuid[])
    `;
    const nachId = new Map(zeilen.map((zeile) => [zeile.id, zeile] as const));
    // Welche Artikel eine Sprache im Plan nach der Rücknahme führt: keine, wenn sie still wird (auch die angelegte); sonst die ihres Ziels; `undefined`: Sie steht nicht im Plan und behält, was sie hat.
    const zielArtikel = (id: string): Set<string> | undefined => {
        const g = plan.get(schl("sprache", id));
        if (g === undefined) return undefined;
        if (g.felder.get("active")?.vorher === false) return new Set();
        return g.felder.has("wiki") ? new Set(zielPillen(g).map((pille) => pille.id)) : undefined;
    };
    const konflikte: VorKonflikt[] = [];
    for (const [spracheId, neu] of neuJe) {
        const g = plan.get(schl("sprache", spracheId))!;
        const schlecht = neu.some((id) => {
            const zeile = nachId.get(id);
            if (zeile === undefined || !zeile.aktiv) return true;
            if (zeile.besitzer === null || zeile.besitzer === spracheId) return false;
            // Ein Besitzer im Plan gibt ihn ab, wenn sein Ziel ihn nicht mehr führt.
            const ziel = zielArtikel(zeile.besitzer);
            return ziel === undefined || ziel.has(id);
        });
        if (!schlecht) continue;
        konflikte.push({
            art: "wert",
            kind: "sprache",
            id: spracheId,
            ...(g.name !== undefined ? { name: g.name } : {}),
            felder: ["wiki"],
            abweichung: { was: "sprache_wiki" },
            detail: SPRACHE_WIKI_SATZ,
        });
    }
    return konflikte;
}

/** Der Adapter des Spracheditors für `vorpruefen` (siehe Kopf der Datei). */
export const SPRACHE_ADAPTER: RuecknahmeAdapter = {
    familie: "sprache",
    // Wie die Vorwärtswege des Spracheditors: Sprachen, Teilflächen und Wiki-Artikel schreibt, wer das Recht am Sprachmodul hat (Linguist, Admins, Betreiber; E17a).
    recht: (): Capability => "edit_languages",
    pruefeArt: (operation, aktionen) =>
        SPRACHE_OPERATIONEN.has(operation) && aktionen.length > 0 && aktionen.every((aktion) => AKTIONEN.has(aktion))
            ? { ok: true }
            : { ok: false, reason: "art" },
    async pruefeWerte(database, kontext): Promise<readonly VorKonflikt[]> {
        const eintraege = (
            await eintraegeNachKennung(
                database,
                kontext.offen.map((m) => m.operationId),
                { personId: kontext.leser.personId, nutzlast: "voll" },
            )
        ).entries;
        const plan = bauePlan(eintraege);
        const ist = await leseIstAlle(database, plan);
        const konflikte: VorKonflikt[] = [];
        for (const g of sortiert(plan)) {
            const z = ist.get(schl(g.art, g.id));
            // Den Gegenstand gibt es nicht mehr: Das meldet die Vorprüfung als `geloescht`.
            if (z === undefined) continue;
            const name = g.name === undefined ? {} : { name: g.name };
            const abweichend = [...g.felder]
                .filter(([feld, ziel]) => !gleich(feld, z.werte[feld], ziel.nachher))
                .map(([feld]) => feld);
            if (abweichend.length > 0)
                konflikte.push({
                    art: "wert",
                    kind: g.art,
                    id: g.id,
                    ...name,
                    felder: abweichend,
                    abweichung: { was: "felder" },
                    detail: `Heute anders als nach dem letzten Schritt: ${abweichend.join(", ")}.`,
                });
            // Eine Teilfläche kommt nur zurück, wenn die Redaktion sie stilllegte (ein späterer Import ersetzte sie sonst durch eine neue Vorlage).
            const stand = g.felder.get("active");
            if (
                g.art === "sprache_flaeche" &&
                stand?.vorher === true &&
                z.werte["active"] === false &&
                z.stillgelegtVon !== "editor" &&
                !abweichend.includes("active")
            )
                konflikte.push({
                    art: "wert",
                    kind: g.art,
                    id: g.id,
                    ...name,
                    felder: ["active"],
                    abweichung: { was: "felder" },
                    detail: "Diese Teilfläche hat ein späterer Import der Sprachenkarte ersetzt; sie kommt nicht zurück.",
                });
        }
        konflikte.push(...(await wikiKonflikte(database, plan, ist)));
        return konflikte;
    },
};

// --- Schreiben --------------------------------------------------------------------------------------------------------------

/**
 * Der Stand eines Gegenstands nach der Rücknahme: seine heutigen Werte, die geplanten Felder auf den Wert vor dem ersten Mitglied. Einen Gegenstand, den die Serie selbst anlegte, gab es vorher nicht:
 * Zurück ist nur `active = false`, was er danach bekam (Name, Farbe, Artikel …), bleibt (WI-0265 B8c).
 */
function zielWerte(g: PlanGegenstand, z: Ist): Record<string, unknown> {
    const neu = { ...z.werte };
    for (const [feld, ziel] of g.felder) if (!g.angelegt || feld === "active") neu[feld] = ziel.vorher;
    return neu;
}

/** Die Felder, die sich ändern (heute anders als das Ziel). */
const aenderungen = (g: PlanGegenstand, z: Ist, neu: Record<string, unknown>): string[] =>
    [...g.felder.keys()].filter((feld) => !gleich(feld, z.werte[feld], neu[feld]));

const wechsel = (z: Ist, neu: Record<string, unknown>, felder: readonly string[]): Record<string, MapChange> =>
    Object.fromEntries(felder.map((feld) => [feld, { before: z.werte[feld] ?? null, after: neu[feld] ?? null }]));

const konfliktRevision = (): ApiError =>
    new ApiError(
        409,
        "edit_conflict",
        "Seit diesen Änderungen hat sich etwas geändert. Die Rücknahme würde das überschreiben.",
    );

interface Ergebnis {
    affected: OperationReceipt["affected"];
    entries: MapAuditEntry[];
    ableitung: boolean;
    namen: string[];
}

/**
 * Die Pillen der Sprache auf das Ziel: erst prüfen, dass jeder Artikel, der neu dazukommt, frei ist und im Wiki steht (die Vorprüfung hat es unter den Sperren schon gesagt; das hier hält
 * eine Unterbrechung des Wettlaufs von einer Verletzung des Teilindex ab), dann über die Stellenfolge der Vorwärtswege. Gibt die Pillen vorher und nachher zurück, oder `undefined`, wenn
 * sich nichts ändert.
 */
async function setzePillen(
    tx: Sql,
    z: Ist,
    gewuenscht: readonly PillenProtokoll[],
): Promise<{ vorher: PillenProtokoll[]; nachher: PillenProtokoll[] } | undefined> {
    const aktuell = await pillenVon(tx, z.pk);
    const ziel = gewuenscht.map((pille) => pille.id);
    if (aktuell.map((zeile) => zeile.artikel_public_id).join("|") === ziel.join("|")) return undefined;
    const hier = new Set(aktuell.map((zeile) => zeile.artikel_public_id));
    const neu = ziel.filter((id) => !hier.has(id));
    const artikel =
        ziel.length === 0
            ? []
            : await tx<{ id: string; public_id: string; titel: string; is_active: boolean }[]>`
                  SELECT id::text, public_id::text, titel, is_active FROM wiki_sprache_artikel WHERE public_id = ANY(${[...ziel]}::uuid[])
              `;
    const nachKennung = new Map(artikel.map((zeile) => [zeile.public_id, zeile] as const));
    if (neu.some((id) => nachKennung.get(id)?.is_active !== true)) throw konfliktRevision();
    if (neu.length > 0) {
        const belegt = await tx<{ id: string }[]>`
            SELECT w.id::text FROM sprache_wiki w
             WHERE w.wiki_sprache_artikel_id = ANY(${neu.map((id) => nachKennung.get(id)!.id)}::bigint[]) AND w.is_active
               FOR UPDATE OF w
        `;
        if (belegt.length > 0) throw konfliktRevision();
    }
    await ordnePillen(
        tx,
        z.pk,
        aktuell,
        ziel,
        new Map(ziel.map((id) => [id, nachKennung.get(id)?.id ?? ""] as const)),
        true,
    );
    return {
        vorher: aktuell.map(pillenProtokoll),
        nachher: ziel.map((id) => ({
            id,
            titel: nachKennung.get(id)?.titel ?? gewuenscht.find((p) => p.id === id)!.titel,
        })),
    };
}

/** Eine Fragmentfolge mit Komma (`a, b, c`), für die Spalten eines `UPDATE`. */
const mitKomma = (tx: Queryable, teile: readonly PendingQuery<Row[]>[]): PendingQuery<Row[]> =>
    teile.reduce((vorn, teil) => tx`${vorn}, ${teil}`);

/**
 * Die Inverse des Protokolls: jeder Gegenstand des Plans auf den Wert vor dem ersten Mitglied. Erst die Sprachen (die, deren Pillen nur schrumpfen oder wandern, vor denen, die Artikel
 * zurückbekommen: So sind die Artikel frei, wenn sie gebraucht werden), dann die Teilflächen. Je Gegenstand EIN Eintrag mit den Aktionen der Vorwärtswege, damit die Rücknahme selbst
 * wieder zurückgenommen werden kann; ändern sich an einer Teilfläche Form und Stand zugleich, sind es zwei Einträge nacheinander (der Plan liest an Stilllegen und Zurückholen nur `active`).
 */
async function schreibeSprache(
    tx: Sql,
    eintraege: readonly MapHistoryEntry[],
    grund: string | undefined,
): Promise<Ergebnis> {
    const plan = bauePlan(eintraege);
    const ist = await leseIstAlle(tx, plan);
    const grundFeld: Record<string, MapChange> = grund === undefined ? {} : { restoreReason: { after: grund } };
    const affected: OperationReceipt["affected"] = [];
    const entries: MapAuditEntry[] = [];
    const namen: string[] = [];
    /** Die Sprachen, die die Rücknahme berührt (mit ihrer Revision danach), auch wo nur eine Teilfläche sich änderte. */
    const sprachen = new Map<string, number>();
    let ableitung = false;

    const alle = sortiert(plan);
    const neuBei = (g: PlanGegenstand): number => {
        const z = ist.get(schl(g.art, g.id));
        if (z === undefined || g.angelegt || !g.felder.has("wiki")) return 0;
        const heute = new Set(artikelIds(z.werte["wiki"]));
        return zielPillen(g).filter((pille) => !heute.has(pille.id)).length;
    };
    const sprachGegenstaende = alle.filter((g) => g.art === "sprache");
    const geordnet = [
        ...sprachGegenstaende.filter((g) => neuBei(g) === 0),
        ...sprachGegenstaende.filter((g) => neuBei(g) > 0),
    ];

    for (const g of geordnet) {
        const z = ist.get(schl(g.art, g.id));
        if (z === undefined) throw new ApiError(404, "not_found", "Etwas davon gibt es nicht mehr.");
        const neu = zielWerte(g, z);
        const felder = aenderungen(g, z, neu);
        if (felder.length === 0) continue;
        const aktivWechsel = felder.includes("active");
        const zielAktiv = neu["active"] === true;
        const aenderung = wechsel(z, neu, felder);
        if (g.name !== undefined) namen.push(g.name);

        // Die Pillen: auf das Ziel des Plans; eine Sprache, die stillgelegt wird, hält keine (wie das Stilllegen vorwärts).
        const pillenZiel = aktivWechsel && !zielAktiv ? [] : felder.includes("wiki") ? zielPillen(g) : undefined;
        const pillen = pillenZiel === undefined ? undefined : await setzePillen(tx, z, pillenZiel);
        if (pillen !== undefined) aenderung["wiki"] = { before: pillen.vorher, after: pillen.nachher };
        else delete aenderung["wiki"];

        const spalten = SPRACH_SPALTEN.filter((feld) => felder.includes(feld));
        let revision = z.revision;
        if (spalten.length > 0 || aktivWechsel) {
            const stand = aktivWechsel ? tx`, ${spracheStand(tx, zielAktiv)}` : tx``;
            const [geschrieben] = await tx<{ revision: number }[]>`
                UPDATE sprache
                   SET name = ${neu["name"] as string}, legende = ${neu["legende"] as string | null}, farbe = ${neu["farbe"] as string},
                       reihenfolge = ${neu["reihenfolge"] as number} ${stand}
                 WHERE id = ${z.pk}::bigint AND revision = ${z.revision}
                RETURNING revision::int AS revision
            `;
            if (geschrieben === undefined) throw konfliktRevision();
            revision = geschrieben.revision;
        } else if (pillen !== undefined) {
            // Die Zuordnung ist ein Feld des Entwurfs: Sie zählt die Revision der Sprache hoch (wie `sprache.wiki`).
            revision = await zaehleSprachRevision(tx, z.pk);
        }
        if (Object.keys(aenderung).length === 0) continue;
        const nurWiki = Object.keys(aenderung).every((feld) => feld === "wiki");
        sprachen.set(g.id, revision);
        affected.push({ kind: SPRACHE_ART, id: g.id, revision });
        entries.push({
            action: aktivWechsel
                ? zielAktiv
                    ? "sprache.restored"
                    : "sprache.retired"
                : nurWiki
                  ? "sprache.wiki_changed"
                  : "sprache.updated",
            spracheId: g.id,
            revisionBefore: z.revision,
            revisionAfter: revision,
            changes: { ...aenderung, ...grundFeld },
        });
        if (aktivWechsel) ableitung = true;
    }

    for (const g of alle.filter((x) => x.art === "sprache_flaeche")) {
        const z = ist.get(schl(g.art, g.id));
        if (z === undefined) throw new ApiError(404, "not_found", "Etwas davon gibt es nicht mehr.");
        const neu = zielWerte(g, z);
        const felder = aenderungen(g, z, neu);
        if (felder.length === 0) continue;
        if (g.name !== undefined) namen.push(g.name);
        const sprache = g.sprache;
        const aktivWechsel = felder.includes("active");
        const zielAktiv = neu["active"] === true;
        const fuerForm = felder.filter((feld) => feld !== "active");
        let revision = z.revision;

        if (fuerForm.length > 0) {
            const teile: PendingQuery<Row[]>[] = [];
            if (fuerForm.includes("geometry")) teile.push(tx`geom = ${geometrie(tx, ausRingen(neu["geometry"]))}`);
            if (fuerForm.includes("herkunft") || fuerForm.includes("quelleRevision"))
                teile.push(
                    tx`herkunft = ${neu["herkunft"] as string}, quelle_revision = ${neu["quelleRevision"] as string | null}`,
                );
            const [geschrieben] = await tx<{ revision: number }[]>`
                UPDATE sprache_flaeche SET ${mitKomma(tx, teile)}
                 WHERE id = ${z.pk}::bigint AND revision = ${revision}
                RETURNING revision::int AS revision
            `;
            if (geschrieben === undefined) throw konfliktRevision();
            affected.push({ kind: SPRACHFLAECHE_ART, id: g.id, revision: geschrieben.revision });
            entries.push({
                action: "sprache_flaeche.reshaped",
                ...(sprache !== undefined ? { spracheId: sprache } : {}),
                spracheFlaecheId: g.id,
                revisionBefore: revision,
                revisionAfter: geschrieben.revision,
                changes: { ...wechsel(z, neu, fuerForm), ...grundFeld },
            });
            revision = geschrieben.revision;
            if (fuerForm.includes("geometry")) ableitung = true;
        }
        if (aktivWechsel) {
            const [geschrieben] = await tx<{ revision: number }[]>`
                UPDATE sprache_flaeche SET ${flaechenStand(tx, zielAktiv)}
                 WHERE id = ${z.pk}::bigint AND revision = ${revision}
                RETURNING revision::int AS revision
            `;
            if (geschrieben === undefined) throw konfliktRevision();
            affected.push({ kind: SPRACHFLAECHE_ART, id: g.id, revision: geschrieben.revision });
            entries.push({
                action: zielAktiv ? "sprache_flaeche.restored" : "sprache_flaeche.retired",
                ...(sprache !== undefined ? { spracheId: sprache } : {}),
                spracheFlaecheId: g.id,
                revisionBefore: revision,
                revisionAfter: geschrieben.revision,
                changes: { active: { before: !zielAktiv, after: zielAktiv }, ...grundFeld },
            });
            ableitung = true;
        }
        if (sprache !== undefined && !sprachen.has(sprache)) sprachen.set(sprache, -1);
    }

    // Die Sprache jeder Teilfläche steht unter `affected`, auch wo sie selbst unberührt blieb (so reiht die Schreibnaht den Auftrag für ihre Treffer ein, wie bei den Vorwärtswegen).
    const fehlend = [...sprachen].filter(([, revision]) => revision === -1).map(([id]) => id);
    if (fehlend.length > 0)
        for (const zeile of await tx<{ id: string; revision: number }[]>`
            SELECT public_id::text AS id, revision::int AS revision FROM sprache WHERE public_id = ANY(${fehlend}::uuid[]) ORDER BY id
        `)
            affected.unshift({ kind: SPRACHE_ART, id: zeile.id, revision: zeile.revision });
    return { affected, entries, ableitung, namen };
}

// --- Die Familie ------------------------------------------------------------------------------------------------------------

export const familieVon = (spracheId: string): RuecknahmeFamilie => ({
    operation: RUECKNAHME_SPRACHE_OPERATION,
    scope: `${SPRACHE_ART}:${spracheId}`,
    adapter: SPRACHE_ADAPTER,
    mapDomainId: SPRACHEN_DOMAENE,
});

/** Die Sprache, an der die Route hängt, auch eine stillgelegte (deren Stilllegen die Rücknahme zurückholt); 404, wenn es sie nicht gibt. */
async function pruefeSprache(database: Queryable, spracheId: string): Promise<void> {
    if ((await leseSpracheZeile(database, spracheId)) === undefined)
        throw new ApiError(404, "not_found", "Diese Sprache gibt es nicht.");
}

/** Die Folgen für das Bestätigungsblatt: wie viele Teilflächen die Rücknahme schreibt; das Gelände ist nie betroffen. */
const folgenVon = (vor: Vorpruefung): RuecknahmePruefung["folgen"] => ({
    gegenstaende: vor.gegenstaende.filter((g) => g.kind === "sprache_flaeche").length,
    gelaende: "keines",
});

/** `POST /api/editor/sprachen/:id/restore-series/preview`: lesend, nichts wird geschrieben und kein Auftrag eingestellt. */
export async function vorschauSprache(
    database: Database,
    spracheId: string,
    body: RuecknahmeVorschauBody,
    leser: RuecknahmeLeser,
): Promise<RuecknahmePruefung> {
    await pruefeSprache(database, spracheId);
    const vor = await pruefeFamilie(
        database,
        { mapDomainId: SPRACHEN_DOMAENE, mitglieder: body.members, membersHash: body.membersHash },
        leser,
        familieVon(spracheId),
    );
    return { ...vor, folgen: folgenVon(vor) } as RuecknahmePruefung;
}

const idsVon = (vorab: Vorpruefung, art: Art): string[] =>
    [...new Set(vorab.gegenstaende.filter((g) => g.kind === art).map((g) => g.id))].sort();

/** Die Zeilen der Gegenstände in fester Reihenfolge sperren (Sprachen, Teilflächen, die Pillen der Sprachen), bevor die Vorprüfung wiederholt wird. */
async function sperreZeilen(tx: Queryable, vorab: Vorpruefung): Promise<void> {
    const sprachen = idsVon(vorab, "sprache");
    const flaechen = idsVon(vorab, "sprache_flaeche");
    if (sprachen.length > 0)
        await tx`SELECT id FROM sprache WHERE public_id = ANY(${sprachen}::uuid[]) ORDER BY id FOR NO KEY UPDATE`;
    if (flaechen.length > 0)
        await tx`SELECT id FROM sprache_flaeche WHERE public_id = ANY(${flaechen}::uuid[]) ORDER BY id FOR NO KEY UPDATE`;
    if (sprachen.length > 0)
        await tx`
            SELECT w.id FROM sprache_wiki w JOIN sprache s ON s.id = w.sprache_id
             WHERE s.public_id = ANY(${sprachen}::uuid[]) ORDER BY w.id FOR UPDATE OF w
        `;
}

/**
 * `POST /api/editor/sprachen/:id/restore-series`: nimmt die Mitglieder einer Serie (oder eine Einzeloperation) in EINER Operation zurück (Ablauf: `fuehreRuecknahmeAus`). Hier steht, was die
 * Sprachen ausmacht: die Fremdsperren der Sprachen, die Sperren der Zeilen, die Inverse des Protokolls und die Quittung.
 */
export async function ruecknehmenSprache(
    database: Database,
    actor: MapActor,
    leser: RuecknahmeLeser,
    spracheId: string,
    body: RuecknahmeBody,
): Promise<RuecknahmeReceipt> {
    await pruefeSprache(database, spracheId);
    const haken: RuecknahmeHaken = {
        async pruefeFremdeSperre(db, akteur, scopes) {
            const sprachen = [...scopes].filter((s) => s.startsWith("sprache:")).map((s) => s.slice("sprache:".length));
            if (sprachen.length > 0) await pruefeFremdeSprachSperre(db, akteur, sprachen);
        },
        sperreZeilen,
        async schreibe({ tx, offen, grund }: RuecknahmeSchreiben): Promise<SchreibErgebnis> {
            const eintraege = (await eintraegeNachKennung(tx, offen, { personId: leser.personId, nutzlast: "voll" }))
                .entries;
            const ergebnis = await schreibeSprache(tx, eintraege, grund);
            const namen = [...new Set(ergebnis.namen)];
            const wer =
                namen.length === 0 ? "Sprache" : namen.length === 1 ? namen[0]! : `${String(namen.length)} Gegenstände`;
            return {
                receipt: { affected: ergebnis.affected, derivedWork: [], warnings: [] },
                summary: `${wer}: ${offen.length === 1 ? "1 Änderung" : `${String(offen.length)} Änderungen`} zurückgenommen`,
                entries: ergebnis.entries,
                // Name, Legende, Farbe, Reihenfolge und Wiki-Artikel gehen in keinen Treffer ein (wie `sprache.update`): nur die Kachelrevision.
                ...(ergebnis.ableitung ? {} : { ableitung: false as const }),
            };
        },
    };
    return fuehreRuecknahmeAus({ database, actor, leser, familie: familieVon(spracheId), body, haken });
}
