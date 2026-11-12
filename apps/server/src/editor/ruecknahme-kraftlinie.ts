import {
    type MapHistoryEntry,
    type OperationReceipt,
    type PowerlineState,
    type PowerlineStateChange,
    type PowerlineUpdateBody,
    type PowerlineWikiWahl,
    type RuecknahmeBody,
    type RuecknahmePruefung,
    type RuecknahmeReceipt,
    type RuecknahmeVorschauBody,
} from "@avesmaps3d/shared";
import type { Sql } from "../auth/session-store.ts";
import type { Database, Queryable } from "../database.ts";
import { zieheKraftlinienNach } from "../derive/powerline-bahn.ts";
import { ApiError } from "../http/api-error.ts";
import { listEditorLocks } from "./editor-lock.ts";
import { eintraegeNachKennung } from "./history.ts";
import {
    WECHSEL_TEXT,
    linienKopf,
    pruefeLinienSperre,
    schreibeLinieImTx,
    sperreLinie,
    wechsleStandImTx,
} from "./kraftlinien-schreiben.ts";
import type { MapActor, MapAuditEntry, MapChange } from "./map-operation.ts";
import {
    fuehreRuecknahmeAus,
    pruefeFamilie,
    type RuecknahmeFamilie,
    type RuecknahmeSchreiben,
    type SchreibErgebnis,
} from "./ruecknahme-ablauf.ts";
import {
    KRAFTLINIE_LINIE_OPERATIONEN,
    KRAFTLINIE_STAND_OPERATIONEN,
    NODIX_OPERATIONEN,
    RUECKNAHME_KRAFTLINIE_OPERATION,
    RUECKNAHME_NODIX_OPERATION,
} from "./ruecknahme-arten.ts";
import type { RuecknahmeAdapter, RuecknahmeLeser, VorKonflikt, VorMitglied, VorSperre } from "./ruecknahme.ts";

/**
 * Kraftlinien zurücknehmen (WI-0265 B6b; Fachvertrag `project-control/planning/aenderungen-arbeitsserien-fachvertrag.md` C.2, C.3 „Mehrscope“, F.1, Gate 2 und 3; Testvertrag U4, U5, U6, U8, U9):
 * der Adapter der Kraftlinie für die Vorprüfung (`ruecknahme.ts`), die Vorschau und die Rücknahme in EINER Operation `powerline.restore_series` (Quelle `restore`, `reverts` = die offenen
 * Mitglieder in Serienfolge; Ablauf, Fehler und Sperren in `ruecknahme-ablauf.ts`). Die Linie ist die Gruppe gleichen Namens (`kraftlinien-schreiben.ts`); die Route hängt an EINEM ihrer
 * Abschnitte (`:id`, der Anker darf jeder sein), und jedes Mitglied berührt einen davon.
 *
 * 🔴 **Parität:** Zurückgenommen wird genau, was das ↺ im Verlauf der Linie bis B6b konnte (`apps/web/src/kraftlinieneditor/kraftlinie-verlauf.ts`), nicht mehr. Zwei Arten Mitglied, nach den
 * Protokolleinträgen, nicht nach dem Namen der Operation:
 *
 * - **Die Linie ändern** (`powerline.update_line`, auch eine frühere Rücknahme und „Auf Wiki-Werte“ für mehrere Linien): Name, Beschriftung, Beschreibung und der Wiki-Artikel der Linie
 *   (folgte ein Wert vorher dem Wiki, kommt er als `revert: "wiki"` zurück), je Abschnitt Bogen und die beiden Enden, ein angefügter oder zurückgekommener Abschnitt entfällt wieder,
 *   ein herausgenommener kommt zurück. Mehrere Mitglieder sind eine Arbeitsserie: je Feld der Wert VOR dem ersten Mitglied, das es berührt. Der Schreibweg ist der von „Fertig“
 *   (`schreibeLinieImTx`): Sperre, Revisionen, Nodices, Bahn.
 * - **Der Stand der Linie** (`powerline.take_off_map`, `.put_on_map`, `.retire`, `.restore`, auch für mehrere Linien): der Gegenwechsel (`wechsleStandImTx`). Geht nur allein.
 *
 * Betraf die Operation mehrere Linien, kommen ALLE zurück oder keine: Das ↺ des Clients, das nur die Linien zurücknimmt, die noch so stehen, ist eine stille Teilrücknahme und fällt weg
 * (Fachvertrag C.3). Ein Name, der vorher leer war, und eine Operation an einer Linie, die gerade nicht auf der Karte ist, lassen sich wie bisher nicht zurücknehmen.
 *
 * - **Anlegen einer Linie** (`powerline.create`, WI-0265 B8b): ein Abschnitt von Nodix zu Nodix. Zurücknehmen heißt stilllegen: Hat die Linie weitere Abschnitte, fällt dieser heraus (`remove`, wie ein
 *   angefügter Abschnitt), ist er ihr einziger, geht die Linie über den Wechsel des Stands still (`powerline.retire`, derselbe Weg wie Entfernen). Eine Serie aus Anlegen und folgenden Änderungen
 *   derselben Person geht als Ganzes zurück; die Rücknahme der Rücknahme holt die Linie wieder.
 * - **Der Kraftlinienpunkt** (`nodix.create`, `nodix.move`, `nodix.retire`, Adapter `NODIX_ADAPTER`, Route `…/nodices/:id/restore-series`): Anlegen geht still (nur ohne Linie daran, auch ohne abgenommene),
 *   Verschieben geht an die Stelle vor dem ersten Mitglied zurück (die Bahnen an ihm folgen wie beim Verschieben; ist seither ein Abschnitt dazugekommen, bleibt es stehen), Entfernen holt ihn zurück.
 *
 * Nicht rücknehmbar (Grund `art`): was der Wechsel des Stands einer Linie nur allein kann (mehrere Mitglieder mit einem Wechsel). Dazu Import, Zurücksetzen der Testwelt und WikiSync (Grund `quelle`, aus der Liste).
 *
 * **Bedingung:** Die Revision jedes berührten Abschnitts steht heute so wie nach dem letzten Mitglied (Kern, `ruecknahme.ts`); die Werte stehen darin, ein eigener Vergleich wie beim Netz des
 * Gebirges ist nicht nötig.
 */

type Art = "linie" | "stand";

// Die Namen der Operationen stehen im Katalog (`ruecknahme-arten.ts`, WI-0265 B6f): Liste, Zustandsfilter und dieser Adapter sagen so dasselbe.
const LINIE_AKTIONEN: ReadonlySet<string> = new Set([
    "powerline.updated",
    "powerline.created",
    "powerline.revived",
    "powerline.removed",
]);

/** Der Gegenwechsel zu dem, was ein Eintrag der Operation sagt, und der Stand, den die Operation hinterließ. */
const GEGEN: Readonly<Record<string, { wechsel: PowerlineStateChange; nach: PowerlineState }>> = {
    "powerline.taken_off_map": { wechsel: "powerline.put_on_map", nach: "abgenommen" },
    "powerline.put_on_map": { wechsel: "powerline.take_off_map", nach: "karte" },
    "powerline.retired": { wechsel: "powerline.restore", nach: "geloescht" },
    "powerline.restored": { wechsel: "powerline.retire", nach: "karte" },
};

/** Welche Art Mitglied eine Operation ist, nach ihrem Namen und den Aktionen ihrer Protokolleinträge; `undefined`, wenn keine, die die Rücknahme kennt. */
function artVon(operation: string, aktionen: readonly string[]): Art | undefined {
    if (aktionen.length === 0) return undefined;
    if (KRAFTLINIE_LINIE_OPERATIONEN.has(operation) && aktionen.every((aktion) => LINIE_AKTIONEN.has(aktion)))
        return "linie";
    // Ein Wechsel des Stands trägt an allen Abschnitten die EINE Aktion seines Wechsels.
    if (
        KRAFTLINIE_STAND_OPERATIONEN.has(operation) &&
        aktionen.every((aktion) => aktion === aktionen[0] && aktion in GEGEN)
    )
        return "stand";
    return undefined;
}

const artDes = (mitglied: Pick<VorMitglied, "operation" | "gegenstaende">): Art | undefined =>
    artVon(
        mitglied.operation,
        mitglied.gegenstaende.map((gegenstand) => gegenstand.action),
    );
const artDesEintrags = (eintrag: MapHistoryEntry): Art | undefined =>
    artVon(
        eintrag.operation,
        eintrag.objects.map((gegenstand) => gegenstand.action),
    );

/** Bogen und Enden eines Abschnitts: die Form der Linie, die zusätzlich `edit_map_geometry` verlangt (`POST …/update`). */
const FORM = ["curve", "from", "to"] as const;
type FormFeld = (typeof FORM)[number];
const istForm = (feld: string): feld is FormFeld => (FORM as readonly string[]).includes(feld);
/** Die Felder der Linie: je Abschnitt geschrieben, für die ganze Linie gedacht. */
const LINIE = ["name", "labelVisible", "description", "wiki"] as const;
/** Die Felder, die die Rücknahme der Linie versteht; ein anderes im Protokoll hält sie an, statt es zu übergehen. */
const BEKANNT: ReadonlySet<string> = new Set<string>([...LINIE, ...FORM, "nameOrigin", "descriptionOrigin", "active"]);

/** Der Adapter der Kraftlinie für `vorpruefen` (siehe Kopf der Datei). */
export const KRAFTLINIE_ADAPTER: RuecknahmeAdapter = {
    familie: "kraftlinie",
    // Das Recht der Vorwärtsoperation: Felder der Linie und Löschen/Zurückholen verlangen `edit_map_objects`; Bogen, Enden, angefügte und herausgenommene Abschnitte und das Abnehmen
    // von der Karte sind Geometrie und verlangen `edit_map_geometry` (`POST …/update`, `…/take-off-map`, `…/put-on-map`).
    recht(operation, aktionen, felder = []) {
        const art = artVon(operation, aktionen);
        if (art === "stand") {
            const wechsel = GEGEN[aktionen[0]!]?.wechsel;
            return wechsel === "powerline.restore" || wechsel === "powerline.retire"
                ? "edit_map_objects"
                : "edit_map_geometry";
        }
        const geometrie =
            aktionen.some((aktion) => aktion !== "powerline.updated") || felder.some((feld) => istForm(feld));
        return geometrie ? "edit_map_geometry" : "edit_map_objects";
    },
    pruefeArt: (operation, aktionen) =>
        artVon(operation, aktionen) === undefined ? { ok: false, reason: "art" } : { ok: true },
    pruefeListe(offen) {
        // Mehrere Mitglieder sind eine Arbeitsserie: nur Änderungen der Linie. Ein Wechsel des Stands geht allein.
        const verworfen = new Map<string, "art">();
        if (offen.length <= 1) return verworfen;
        for (const mitglied of offen) if (artDes(mitglied) !== "linie") verworfen.set(mitglied.operationId, "art");
        return verworfen;
    },
};

/** Alle Abschnitte der Linie, zu der `anker` gehört, in jedem Stand (die Mitglieder berührten sie, als die Linie noch anders stand); leer, wenn es den Anker nicht gibt. */
async function alleAbschnitte(
    database: Queryable,
    anker: string,
): Promise<{ abschnitte: string[]; mapDomainId: string } | undefined> {
    const [kopf] = await database<{ name: string; map_domain_id: string }[]>`
        SELECT name, map_domain_id FROM powerline WHERE public_id = ${anker}::uuid
    `;
    if (kopf === undefined) return undefined;
    if (kopf.name.trim() === "") return { abschnitte: [anker], mapDomainId: kopf.map_domain_id };
    const zeilen = await database<{ id: string }[]>`
        SELECT public_id::text AS id FROM powerline
         WHERE map_domain_id = ${kopf.map_domain_id} AND name = ${kopf.name} ORDER BY public_id
    `;
    return { abschnitte: zeilen.map((zeile) => zeile.id), mapDomainId: kopf.map_domain_id };
}

const familieVon = (anker: string, linie: { abschnitte: string[]; mapDomainId: string }): RuecknahmeFamilie => ({
    operation: RUECKNAHME_KRAFTLINIE_OPERATION,
    scope: `powerline:${anker}`,
    scopes: linie.abschnitte.map((id) => `powerline:${id}`),
    adapter: KRAFTLINIE_ADAPTER,
    mapDomainId: linie.mapDomainId,
});

async function leseLinie(database: Queryable, anker: string) {
    const linie = await alleAbschnitte(database, anker);
    if (linie === undefined) throw new ApiError(404, "not_found", "Diese Kraftlinie gibt es nicht.");
    return linie;
}

/** Die Sperren anderer an der Linie, auch an einem ihrer Abschnitte (`sections`): Der Kern sieht nur Sperren, deren Kennung ein berührter Abschnitt ist. */
async function fremdeSperrenAnLinie(
    database: Queryable,
    personId: string,
    abschnitte: readonly string[],
): Promise<VorSperre[]> {
    const ids = new Set(abschnitte);
    return (await listEditorLocks(database, "powerline", undefined))
        .filter(
            (sperre) =>
                sperre.person.id !== personId &&
                (ids.has(sperre.id) || (sperre.sections ?? []).some((id) => ids.has(id))),
        )
        .map((sperre) => ({
            kind: sperre.kind,
            id: sperre.id,
            person: sperre.person,
            part: sperre.part,
            since: sperre.since,
        }));
}

/** `POST …/restore-series/preview` an der Linie: lesend, nichts wird geschrieben und kein Auftrag eingestellt. */
export async function vorschauKraftlinie(
    database: Database,
    anker: string,
    body: RuecknahmeVorschauBody,
    leser: RuecknahmeLeser,
): Promise<RuecknahmePruefung> {
    const linie = await leseLinie(database, anker);
    const vor = await pruefeFamilie(
        database,
        { mapDomainId: linie.mapDomainId, mitglieder: body.members, membersHash: body.membersHash },
        leser,
        familieVon(anker, linie),
    );
    const fremd =
        vor.ergebnis === "forbidden" || vor.ergebnis === "invalid_members"
            ? []
            : (await fremdeSperrenAnLinie(database, leser.personId, linie.abschnitte)).filter(
                  (sperre) => !vor.sperren.some((s) => s.id === sperre.id && s.person.id === sperre.person.id),
              );
    const mitSperre =
        fremd.length === 0 ? vor : { ...vor, ergebnis: "object_locked" as const, sperren: [...vor.sperren, ...fremd] };
    return {
        ...mitSperre,
        folgen: { gegenstaende: vor.gegenstaende.filter((g) => g.kind === "powerline").length, gelaende: "keines" },
    } as RuecknahmePruefung;
}

interface Wert {
    vorher: unknown;
    nachher: unknown;
}
interface AbschnittsPlan {
    /** Die Ereignisse am Abschnitt in der Folge der Operationen: welche Operation, was ihm geschah. */
    ereignisse: { operationId: string; aktion: string }[];
    felder: Map<string, Wert>;
    herkunft: Map<string, Wert>;
}

/** Die Ereignisse und Felder je Abschnitt aus den Einträgen der Mitglieder; die Einträge brauchen die volle Nutzlast. */
function planAusEintraegen(eintraege: readonly MapHistoryEntry[]): Map<string, AbschnittsPlan> {
    const plan = new Map<string, AbschnittsPlan>();
    for (const eintrag of [...eintraege].sort((a, b) => a.seq - b.seq))
        for (const gegenstand of eintrag.objects) {
            if (gegenstand.kind !== "powerline") continue;
            let abschnitt = plan.get(gegenstand.id);
            if (abschnitt === undefined) {
                abschnitt = { ereignisse: [], felder: new Map(), herkunft: new Map() };
                plan.set(gegenstand.id, abschnitt);
            }
            abschnitt.ereignisse.push({ operationId: eintrag.operationId, aktion: gegenstand.action });
            // Die Werte eines angefügten oder zurückgekommenen Abschnitts sind keine Änderung an der Linie: Er entfällt als Ganzes.
            if (gegenstand.action !== "powerline.updated") continue;
            for (const [schluessel, wechsel] of Object.entries(gegenstand.changes)) {
                const herkunft = schluessel === "nameOrigin" || schluessel === "descriptionOrigin";
                const ziel = herkunft ? abschnitt.herkunft : abschnitt.felder;
                const feld = herkunft ? schluessel.slice(0, -"Origin".length) : schluessel;
                const bisher = ziel.get(feld);
                if (bisher === undefined)
                    ziel.set(feld, { vorher: wechsel.before ?? null, nachher: wechsel.after ?? null });
                else bisher.nachher = wechsel.after ?? null;
            }
        }
    return plan;
}

const nichtRuecknehmbar = (feld?: string): ApiError =>
    new ApiError(400, "not_revertable", "Diese Änderung an der Kraftlinie lässt sich nicht zurücknehmen.", {
        reason: "art",
        ...(feld !== undefined ? { field: feld } : {}),
    });

const konflikt = (satz: string): ApiError => new ApiError(409, "edit_conflict", satz);

/** Der Grund steht an jedem Eintrag der Rücknahme (Positivliste `powerline`). */
const mitGrund = (entry: MapAuditEntry, grund: string | undefined): MapAuditEntry =>
    grund === undefined || entry.powerlineId === undefined
        ? entry
        : { ...entry, changes: { ...entry.changes, restoreReason: { after: grund } } };

/** Eine Linie, wie sie heute steht. */
interface LinienGruppe {
    /** Ein Abschnitt der Linie, an dem die Schreibwege sie finden. */
    anker: string;
    /** Die heutigen Abschnitte der Linie im Stand der Gruppe, gesperrt, mit Revision. */
    abschnitte: { public_id: string; revision: number }[];
}

/**
 * Die Linien, zu denen die berührten Abschnitte heute im Stand `stand` gehören (jede einmal, nach Anker geordnet), ihre Abschnitte gesperrt. Ein berührter Abschnitt, der nicht in diesem
 * Stand steht, gehört zu keiner dieser Linien (herausgenommen, angefügt und wieder entfallen).
 */
async function gruppiere(tx: Sql, ids: readonly string[], stand: PowerlineState): Promise<LinienGruppe[]> {
    const gruppen: LinienGruppe[] = [];
    const gesehen = new Set<string>();
    for (const id of [...ids].sort()) {
        if (gesehen.has(id)) continue;
        const abschnitte = await sperreLinie(tx, id, stand);
        if (abschnitte.length === 0) continue;
        for (const a of abschnitte) gesehen.add(a.public_id);
        gruppen.push({ anker: id, abschnitte });
    }
    return gruppen;
}

/** Hat die Serie den Abschnitt angelegt (sein erstes Ereignis legt an oder holt zurück) und steht er danach noch da? Dann entfällt er wieder. */
function entfaelltWieder(plan: ReadonlyMap<string, AbschnittsPlan>, id: string): boolean {
    const ereignisse = plan.get(id)?.ereignisse ?? [];
    const erstes = ereignisse[0]?.aktion;
    return (
        (erstes === "powerline.created" || erstes === "powerline.revived") &&
        ereignisse.at(-1)?.aktion !== "powerline.removed"
    );
}

/**
 * Die Änderung der Linie, die sie auf die Werte VOR der Serie bringt (der Körper von `powerline.update_line`): Felder der Linie, Form je Abschnitt, angefügte Abschnitte entfallen,
 * herausgenommene kommen zurück. `beruehrt` sind die Abschnitte, die die Mitglieder an DIESER Linie berührten, auch die heute nicht mehr auf der Karte sind.
 */
function koerperAus(
    gruppe: LinienGruppe,
    beruehrt: readonly string[],
    plan: ReadonlyMap<string, AbschnittsPlan>,
    revisionen: ReadonlyMap<string, number>,
): Omit<PowerlineUpdateBody, "operationId"> {
    // Die Werte der Linie: Der erste Abschnitt der Kette, der das Feld berührte, gibt den Wert davor (alle Abschnitte einer Operation tragen dieselbe Änderung).
    const linie = new Map<string, Wert>();
    const herkunft = new Map<string, Wert>();
    for (const id of beruehrt) {
        const abschnitt = plan.get(id);
        if (abschnitt === undefined) continue;
        for (const [feld, wert] of abschnitt.felder) if (!linie.has(feld)) linie.set(feld, wert);
        for (const [feld, wert] of abschnitt.herkunft) if (!herkunft.has(feld)) herkunft.set(feld, wert);
    }
    const felder: {
        name?: NonNullable<PowerlineUpdateBody["name"]>;
        labelVisible?: boolean;
        description?: NonNullable<PowerlineUpdateBody["description"]> | null;
        wiki?: PowerlineWikiWahl;
    } = {};
    for (const [feld, wert] of linie) {
        if (!BEKANNT.has(feld)) throw nichtRuecknehmbar(feld);
        if (istForm(feld) || feld === "active") continue;
        const vorher = wert.vorher;
        // Folgte der Wert vorher dem Wiki (`<feld>Origin`), kommt er als Wiki-Wert zurück (WI-0225 Nachtrag 2, wie am Ort).
        const zurWiki = herkunft.get(feld)?.vorher === "wiki";
        if (feld === "name") {
            // Ein Name, der vorher leer war, hat kein Ziel (wie im Verlauf).
            if (zurWiki) felder.name = { revert: "wiki" };
            else if (typeof vorher === "string" && vorher.trim() !== "") felder.name = vorher;
            else throw nichtRuecknehmbar(feld);
        } else if (feld === "labelVisible") felder.labelVisible = vorher === true;
        else if (feld === "description")
            felder.description = zurWiki ? { revert: "wiki" } : typeof vorher === "string" ? vorher : null;
        else if (feld === "wiki") felder.wiki = typeof vorher === "string" ? { key: vorher } : null;
    }
    // Die Abschnitte: Was angefügt oder zurückgekommen war, entfällt wieder; was herausgenommen wurde, kommt zurück (mit der Revision, die es heute trägt).
    const entfallen = new Set<string>();
    const wieder: { id: string; baseRevision: number }[] = [];
    for (const id of beruehrt) {
        const ereignisse = plan.get(id)?.ereignisse ?? [];
        const erstes = ereignisse[0]?.aktion;
        const davor = erstes !== "powerline.created" && erstes !== "powerline.revived";
        const danach = ereignisse.at(-1)?.aktion !== "powerline.removed";
        if (!davor && danach) entfallen.add(id);
        else if (davor && !danach) {
            const revision = revisionen.get(id);
            if (revision === undefined) throw nichtRuecknehmbar("active");
            wieder.push({ id, baseRevision: revision });
        }
    }
    const segments = gruppe.abschnitte.map((a) => {
        const form: { curve?: number | null; from?: string; to?: string } = {};
        for (const [feld, wert] of plan.get(a.public_id)?.felder ?? []) {
            if (feld === "curve") form.curve = typeof wert.vorher === "number" ? wert.vorher : null;
            else if ((feld === "from" || feld === "to") && typeof wert.vorher === "string") form[feld] = wert.vorher;
        }
        return entfallen.has(a.public_id)
            ? { id: a.public_id, baseRevision: a.revision, remove: true as const }
            : { id: a.public_id, baseRevision: a.revision, ...form };
    });
    return { segments, ...(wieder.length > 0 ? { revive: wieder } : {}), ...felder };
}

/** Die Linie ändern: die Werte vor dem ersten Mitglied je Linie, alle Linien der Mitglieder in EINER Operation. */
async function schreibeLinien(
    tx: RuecknahmeSchreiben["tx"],
    actor: MapActor,
    eintraege: readonly MapHistoryEntry[],
    grund: string | undefined,
): Promise<SchreibErgebnis> {
    const plan = planAusEintraegen(eintraege);
    const ids = [...plan.keys()];
    const gruppen = await gruppiere(tx, ids, "karte");
    if (gruppen.length === 0) throw konflikt("Diese Kraftlinie steht inzwischen anders.");
    const aufDerKarte = new Set(gruppen.flatMap((g) => g.abschnitte.map((a) => a.public_id)));
    // Ein herausgenommener Abschnitt gehört zu der Linie, deren Abschnitte dieselbe Operation berührte; seine Revision heute geht an `revive`.
    const weg = ids.filter((id) => !aufDerKarte.has(id));
    const revisionen = new Map<string, number>();
    if (weg.length > 0)
        for (const zeile of await tx<{ id: string; revision: number }[]>`
            SELECT public_id::text AS id, revision::int AS revision FROM powerline WHERE public_id = ANY(${weg}::uuid[])
        `)
            revisionen.set(zeile.id, zeile.revision);
    const operationenVon = (id: string): string[] => plan.get(id)?.ereignisse.map((e) => e.operationId) ?? [];
    const affected: OperationReceipt["affected"] = [];
    const warnings: OperationReceipt["warnings"] = [];
    const derivedWork: OperationReceipt["derivedWork"] = [];
    const entries: MapAuditEntry[] = [];
    const namen: string[] = [];
    for (const gruppe of gruppen) {
        const eigene = ids.filter((id) => gruppe.abschnitte.some((a) => a.public_id === id));
        const operationen = new Set(eigene.flatMap(operationenVon));
        const beruehrt = [...eigene, ...weg.filter((id) => operationenVon(id).some((op) => operationen.has(op)))];
        // Angelegt in dieser Serie und sonst nichts an der Linie (WI-0265 B8b): Die Linie hat keinen Abschnitt mehr, der bleiben dürfte; sie geht still wie „Kraftlinie entfernen“.
        if (gruppe.abschnitte.every((a) => entfaelltWieder(plan, a.public_id))) {
            const [kopf] = await tx<{ is_active: boolean; off_map: boolean; name: string }[]>`
                SELECT is_active, off_map, name FROM powerline WHERE public_id = ${gruppe.anker}::uuid
            `;
            const still = await wechsleStandImTx(
                tx,
                actor,
                gruppe.anker,
                gruppe.abschnitte.map((a) => ({ id: a.public_id, baseRevision: a.revision })),
                "powerline.retire",
                kopf!,
            );
            affected.push(...still.affected);
            for (const arbeit of still.derivedWork)
                if (!derivedWork.some((x) => x.kind === arbeit.kind)) derivedWork.push(arbeit);
            entries.push(...still.entries.map((entry) => mitGrund(entry, grund)));
            namen.push(kopf!.name);
            continue;
        }
        const body: PowerlineUpdateBody = { operationId: "", ...koerperAus(gruppe, beruehrt, plan, revisionen) };
        const ergebnis = await schreibeLinieImTx(tx, actor, gruppe.anker, body, linienKopf(body));
        affected.push(...ergebnis.receipt.affected);
        for (const arbeit of ergebnis.receipt.derivedWork)
            if (!derivedWork.some((x) => x.kind === arbeit.kind)) derivedWork.push(arbeit);
        for (const befund of ergebnis.receipt.warnings)
            if (!warnings.some((x) => x.code === befund.code)) warnings.push(befund);
        entries.push(...ergebnis.entries.map((entry) => mitGrund(entry, grund)));
        const [kopf] = await tx<{ name: string }[]>`SELECT name FROM powerline WHERE public_id = ${gruppe.anker}::uuid`;
        namen.push(kopf?.name ?? "");
    }
    return {
        receipt: { affected, derivedWork, warnings },
        summary: `Kraftlinie „${namen.join("“, „")}“: ${
            eintraege.length === 1 && eintraege[0]!.operation === "powerline.create"
                ? "Anlegen"
                : eintraege.length === 1
                  ? "1 Änderung"
                  : `${String(eintraege.length)} Änderungen`
        } zurückgenommen`,
        entries,
    };
}

/** Der Stand der Linie: der Gegenwechsel für jede Linie der Operation, alle in EINER Operation. */
async function schreibeStand(
    tx: RuecknahmeSchreiben["tx"],
    actor: MapActor,
    eintrag: MapHistoryEntry,
    grund: string | undefined,
): Promise<SchreibErgebnis> {
    const gegenstaende = eintrag.objects.filter((gegenstand) => gegenstand.kind === "powerline");
    const gegen = gegenstaende[0] === undefined ? undefined : GEGEN[gegenstaende[0].action];
    if (gegen === undefined) throw nichtRuecknehmbar();
    const ids = gegenstaende.map((gegenstand) => gegenstand.id);
    const gruppen = await gruppiere(tx, ids, gegen.nach);
    // Jeder berührte Abschnitt muss noch im Stand stehen, den die Operation hinterließ.
    const abgedeckt = new Set(gruppen.flatMap((g) => g.abschnitte.map((a) => a.public_id)));
    if (ids.some((id) => !abgedeckt.has(id))) throw konflikt("Diese Kraftlinie steht inzwischen anders.");
    const affected: OperationReceipt["affected"] = [];
    const derivedWork: OperationReceipt["derivedWork"] = [];
    const entries: MapAuditEntry[] = [];
    const namen: string[] = [];
    for (const gruppe of gruppen) {
        const [kopf] = await tx<{ is_active: boolean; off_map: boolean; name: string }[]>`
            SELECT is_active, off_map, name FROM powerline WHERE public_id = ${gruppe.anker}::uuid
        `;
        const ergebnis = await wechsleStandImTx(
            tx,
            actor,
            gruppe.anker,
            gruppe.abschnitte.map((a) => ({ id: a.public_id, baseRevision: a.revision })),
            gegen.wechsel,
            kopf!,
        );
        affected.push(...ergebnis.affected);
        for (const arbeit of ergebnis.derivedWork)
            if (!derivedWork.some((x) => x.kind === arbeit.kind)) derivedWork.push(arbeit);
        entries.push(...ergebnis.entries.map((entry) => mitGrund(entry, grund)));
        namen.push(kopf!.name);
    }
    return {
        receipt: { affected, derivedWork, warnings: [] },
        summary: `Kraftlinie „${namen.join("“, „")}“ ${WECHSEL_TEXT[gegen.wechsel].satz}`,
        entries,
    };
}

/** Die berührten Abschnitte der Mitglieder in fester Reihenfolge sperren (nach Kennung, wie `sperreLinie`), bevor die Vorprüfung wiederholt wird. */
async function sperreAbschnitte(
    tx: Queryable,
    vorab: { gegenstaende: readonly { kind: string; id: string }[] },
): Promise<void> {
    const ids = [...new Set(vorab.gegenstaende.filter((g) => g.kind === "powerline").map((g) => g.id))].sort();
    if (ids.length > 0)
        await tx`SELECT id FROM powerline WHERE public_id = ANY(${ids}::uuid[]) ORDER BY public_id FOR UPDATE`;
}

/**
 * `POST …/restore-series` an der Linie: nimmt die Mitglieder (Änderungen der Linie einer Serie, oder EINEN Wechsel des Stands, auch für mehrere Linien) in EINER Operation zurück (Ablauf:
 * `fuehreRuecknahmeAus`). Hier steht, was die Kraftlinie ausmacht: die Fremdsperre der Linie, die Sperre der Abschnitte und die Inverse je Art.
 */
export async function ruecknehmenKraftlinie(
    database: Database,
    actor: MapActor,
    leser: RuecknahmeLeser,
    anker: string,
    body: RuecknahmeBody,
): Promise<RuecknahmeReceipt> {
    const linie = await leseLinie(database, anker);
    return fuehreRuecknahmeAus({
        database,
        actor,
        leser,
        familie: familieVon(anker, linie),
        body,
        haken: {
            // Die Sperre liegt an der Linie, auch an einem ihrer Abschnitte (`pruefeLinienSperre`): alle Abschnitte der Linie und der berührten Linien.
            async pruefeFremdeSperre(db, akteur, scopes) {
                const beruehrt = [...scopes]
                    .filter((scope) => scope.startsWith("powerline:"))
                    .map((scope) => scope.slice("powerline:".length));
                await pruefeLinienSperre(db, akteur, [...new Set([...beruehrt, ...linie.abschnitte])]);
            },
            sperreZeilen: sperreAbschnitte,
            async schreibe({ tx, offen, grund }) {
                const eintraege = (
                    await eintraegeNachKennung(tx, offen, { personId: leser.personId, nutzlast: "voll" })
                ).entries.sort((a, b) => a.seq - b.seq);
                const art = artDesEintrags(eintraege[0]!);
                if (art === "linie") return schreibeLinien(tx, actor, eintraege, grund);
                if (art === "stand") return schreibeStand(tx, actor, eintraege[0]!, grund);
                throw nichtRuecknehmbar();
            },
        },
    });
}

// --- Der Kraftlinienpunkt (WI-0265 B8b) -----------------------------------------------------------------------------------------

/**
 * Kraftlinienpunkte zurücknehmen: Anlegen (`nodix.create`), Verschieben (`nodix.move`) und Entfernen (`nodix.retire`), einzeln oder als Serie am selben Punkt (die Route hängt an
 * EINEM Punkt, `POST /api/editor/nodices/:id/restore-series[/preview]`). Die Inverse folgt dem Protokoll: je Punkt Lage und Stand vor dem ersten Mitglied, das sie berührt; ein angelegter
 * Punkt geht still. Alles in EINER Operation `nodix.restore_series` (Quelle `restore`).
 *
 * - **Stilllegen** (Anlegen zurück, Entfernen noch einmal): nur, wenn keine Linie mehr an ihm endet, auch keine abgenommene (wie `nodix.retire`); sonst 409 mit dem Abschnitt als Gegenstand.
 * - **Zurück an die Stelle:** wie `nodix.move` (Lage in der Karte; die bezeichneten Bahnen an ihm folgen in derselben Transaktion, `zieheKraftlinienNach`). Ist seither ein Abschnitt an ihm
 *   angelegt worden, bleibt das Verschieben stehen (409): Dessen Ende zöge mit.
 * - **Zurückholen** (Entfernen zurück): der Punkt ist wieder aktiv; seine Lage bleibt.
 * - Das Recht ist das der Vorwärtsoperation: beide, die Sache (die Route) und die Lage (`edit_map_geometry`).
 */
const NODIX_AKTIONEN: ReadonlySet<string> = new Set([
    "nodix.created",
    "nodix.moved",
    "nodix.retired",
    "nodix.restored",
]);

export const NODIX_ADAPTER: RuecknahmeAdapter = {
    familie: "nodix",
    recht: () => "edit_map_geometry",
    pruefeArt: (operation, aktionen) =>
        NODIX_OPERATIONEN.has(operation) &&
        aktionen.length > 0 &&
        aktionen.every((aktion) => NODIX_AKTIONEN.has(aktion))
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
        const plan = nodixPlan(eintraege);
        const ids = [...plan.keys()];
        const heute = await leseNodixIst(database, ids);
        const spaetestens = Math.max(...kontext.offen.map((m) => Date.parse(m.at)));
        const konflikte: VorKonflikt[] = [];
        for (const id of ids) {
            const ziel = zielDesNodix(plan.get(id)!, heute.get(id));
            if (heute.get(id) === undefined) {
                konflikte.push({ art: "geloescht", kind: "nodix", id });
                continue;
            }
            if (ziel.aktiv === false && heute.get(id)!.aktiv) {
                // Stilllegen: keine Linie darf mehr an ihm enden.
                for (const abschnitt of await abschnitteAn(database, id))
                    konflikte.push({
                        art: "wert",
                        kind: "powerline",
                        id: abschnitt.id,
                        name: abschnitt.name,
                        currentRevision: abschnitt.revision,
                        felder: [abschnitt.von === id ? "from" : "to"],
                        abweichung: { was: "felder" },
                        detail: `An diesem Kraftlinienpunkt endet der Abschnitt „${abschnitt.name}“; er lässt sich so nicht stilllegen.`,
                    });
            } else if (ziel.lage !== undefined) {
                // Verschieben zurück: ein Abschnitt, der seit dem letzten Mitglied dazukam, zöge mit.
                for (const abschnitt of await abschnitteAn(database, id))
                    if (abschnitt.angelegt.getTime() > spaetestens)
                        konflikte.push({
                            art: "wert",
                            kind: "powerline",
                            id: abschnitt.id,
                            name: abschnitt.name,
                            currentRevision: abschnitt.revision,
                            felder: [abschnitt.von === id ? "from" : "to"],
                            abweichung: { was: "felder" },
                            detail: `Seither endet der Abschnitt „${abschnitt.name}“ an diesem Kraftlinienpunkt; er zöge beim Zurückschieben mit.`,
                        });
            }
        }
        return konflikte;
    },
};

interface NodixPlan {
    angelegt: boolean;
    /** Lage vor dem ersten und nach dem letzten Mitglied, das sie änderte. */
    lage?: { vorher: [number, number]; nachher: [number, number] };
    stand?: { vorher: boolean; nachher: boolean };
    name?: string;
}

const alsLage = (wert: unknown): [number, number] | undefined =>
    Array.isArray(wert) && typeof wert[0] === "number" && typeof wert[1] === "number" ? [wert[0], wert[1]] : undefined;

/** Je Kraftlinienpunkt das, was die Mitglieder in der Folge der Serie mit ihm taten. Die Einträge brauchen die volle Nutzlast. */
function nodixPlan(eintraege: readonly MapHistoryEntry[]): Map<string, NodixPlan> {
    const plan = new Map<string, NodixPlan>();
    for (const eintrag of [...eintraege].sort((a, b) => a.seq - b.seq))
        for (const gegenstand of eintrag.objects) {
            if (gegenstand.kind !== "nodix") continue;
            const punkt = plan.get(gegenstand.id) ?? { angelegt: false };
            plan.set(gegenstand.id, punkt);
            if (gegenstand.action === "nodix.created") punkt.angelegt = true;
            const lage = gegenstand.changes["position"];
            const vorher = alsLage(lage?.before);
            const nachher = alsLage(lage?.after);
            if (nachher !== undefined) {
                if (punkt.lage === undefined && vorher !== undefined) punkt.lage = { vorher, nachher };
                else if (punkt.lage !== undefined) punkt.lage.nachher = nachher;
            }
            const stand = gegenstand.changes["active"];
            if (typeof stand?.after === "boolean" && typeof stand.before === "boolean") {
                if (punkt.stand === undefined) punkt.stand = { vorher: stand.before, nachher: stand.after };
                else punkt.stand.nachher = stand.after;
            }
        }
    return plan;
}

interface NodixIst {
    id: string;
    revision: number;
    aktiv: boolean;
    x: number;
    y: number;
    domain: string;
}

async function leseNodixIst(database: Queryable, ids: readonly string[]): Promise<Map<string, NodixIst>> {
    if (ids.length === 0) return new Map();
    const zeilen = await database<
        { id: string; revision: number; aktiv: boolean; x: number; y: number; domain: string }[]
    >`
        SELECT public_id::text AS id, revision::int AS revision, is_active AS aktiv, ST_X(geom) AS x, ST_Y(geom) AS y, map_domain_id AS domain
          FROM nodix WHERE public_id = ANY(${ids as string[]}::uuid[])
    `;
    return new Map(zeilen.map((zeile) => [zeile.id, zeile]));
}

/** Wohin ein Kraftlinienpunkt zurückgeht: Ein angelegter geht still, sonst Stand und Lage vor dem ersten Mitglied (`undefined`: unverändert). */
function zielDesNodix(
    plan: NodixPlan,
    heute: NodixIst | undefined,
): { aktiv: boolean | undefined; lage: [number, number] | undefined } {
    if (plan.angelegt) return { aktiv: false, lage: undefined };
    const aktiv = plan.stand === undefined ? undefined : plan.stand.vorher;
    const lage =
        plan.lage === undefined ||
        (heute !== undefined &&
            Math.abs(heute.x - plan.lage.vorher[0]) < 1e-9 &&
            Math.abs(heute.y - plan.lage.vorher[1]) < 1e-9)
            ? undefined
            : plan.lage.vorher;
    return { aktiv: aktiv === heute?.aktiv ? undefined : aktiv, lage };
}

/** Die Abschnitte, die an einem Kraftlinienpunkt enden, auch abgenommene (wie `nodix.retire`). */
async function abschnitteAn(
    database: Queryable,
    id: string,
): Promise<{ id: string; name: string; revision: number; von: string; angelegt: Date }[]> {
    return database<{ id: string; name: string; revision: number; von: string; angelegt: Date }[]>`
        SELECT public_id::text AS id, name, revision::int AS revision, from_public_id::text AS von, created_at AS angelegt
          FROM powerline
         WHERE (is_active OR off_map) AND (from_public_id = ${id}::uuid OR to_public_id = ${id}::uuid)
         ORDER BY public_id
    `;
}

const familieNodix = (id: string, mapDomainId: string): RuecknahmeFamilie => ({
    operation: RUECKNAHME_NODIX_OPERATION,
    scope: `nodix:${id}`,
    adapter: NODIX_ADAPTER,
    mapDomainId,
});

async function domainVonNodix(database: Queryable, id: string): Promise<string> {
    const [zeile] = await database<{ map_domain_id: string }[]>`
        SELECT map_domain_id FROM nodix WHERE public_id = ${id}::uuid
    `;
    if (zeile === undefined) throw new ApiError(404, "not_found", "Diesen Kraftlinienpunkt gibt es nicht.");
    return zeile.map_domain_id;
}

/** `POST …/nodices/:id/restore-series/preview`: lesend, nichts wird geschrieben und kein Auftrag eingestellt. */
export async function vorschauNodix(
    database: Database,
    id: string,
    body: RuecknahmeVorschauBody,
    leser: RuecknahmeLeser,
): Promise<RuecknahmePruefung> {
    const domain = await domainVonNodix(database, id);
    const vor = await pruefeFamilie(
        database,
        { mapDomainId: domain, mitglieder: body.members, membersHash: body.membersHash },
        leser,
        familieNodix(id, domain),
    );
    return {
        ...vor,
        folgen: { gegenstaende: vor.gegenstaende.filter((g) => g.kind === "nodix").length, gelaende: "keines" },
    } as RuecknahmePruefung;
}

/** Der Kraftlinienpunkt zurück (siehe oben), alle Mitglieder in EINER Operation. */
async function schreibeNodices(
    tx: RuecknahmeSchreiben["tx"],
    eintraege: readonly MapHistoryEntry[],
    grund: string | undefined,
): Promise<SchreibErgebnis> {
    const plan = nodixPlan(eintraege);
    const ids = [...plan.keys()].sort();
    const affected: OperationReceipt["affected"] = [];
    const entries: MapAuditEntry[] = [];
    const bewegt: string[] = [];
    for (const id of ids) {
        const [heute] = await tx<{ revision: number; aktiv: boolean; x: number; y: number; domain: string }[]>`
            SELECT revision::int AS revision, is_active AS aktiv, ST_X(geom) AS x, ST_Y(geom) AS y, map_domain_id AS domain
              FROM nodix WHERE public_id = ${id}::uuid FOR UPDATE
        `;
        if (heute === undefined) throw konflikt("Diesen Kraftlinienpunkt gibt es nicht mehr.");
        const ziel = zielDesNodix(plan.get(id)!, { id, ...heute });
        if (ziel.aktiv === undefined && ziel.lage === undefined) continue;
        if (ziel.aktiv === false && heute.aktiv && (await abschnitteAn(tx, id)).length > 0)
            throw konflikt("An diesem Kraftlinienpunkt endet inzwischen eine Kraftlinie.");
        if (ziel.lage !== undefined) {
            const [lage] = await tx<{ inside: boolean | null }[]>`
                SELECT map_domain_contains(${heute.domain}, ST_SetSRID(ST_MakePoint(${ziel.lage[0]}, ${ziel.lage[1]}), 0)) AS inside
            `;
            if (lage?.inside !== true) throw konflikt("Die frühere Lage liegt außerhalb der Karte.");
        }
        const aktivNeu = ziel.aktiv ?? heute.aktiv;
        const [neu] =
            ziel.lage === undefined
                ? await tx<{ revision: number }[]>`
                    UPDATE nodix SET is_active = ${aktivNeu}
                     WHERE public_id = ${id}::uuid AND revision = ${heute.revision} RETURNING revision::int AS revision
                `
                : await tx<{ revision: number }[]>`
                    UPDATE nodix SET is_active = ${aktivNeu}, geom = ST_SetSRID(ST_MakePoint(${ziel.lage[0]}, ${ziel.lage[1]}), 0)
                     WHERE public_id = ${id}::uuid AND revision = ${heute.revision} RETURNING revision::int AS revision
                `;
        if (neu === undefined) throw konflikt("Der Kraftlinienpunkt wurde inzwischen geändert.");
        if (ziel.lage !== undefined) bewegt.push(id);
        affected.push({ kind: "nodix", id, revision: neu.revision });
        const changes: Record<string, MapChange> = {};
        if (ziel.aktiv !== undefined) changes["active"] = { before: heute.aktiv, after: aktivNeu };
        if (ziel.lage !== undefined) changes["position"] = { before: [heute.x, heute.y], after: ziel.lage };
        if (grund !== undefined) changes["restoreReason"] = { after: grund };
        entries.push({
            action: ziel.aktiv === undefined ? "nodix.moved" : aktivNeu ? "nodix.restored" : "nodix.retired",
            nodixId: id,
            revisionBefore: heute.revision,
            revisionAfter: neu.revision,
            changes,
        });
    }
    // Die Bahnen an einem verschobenen Punkt folgen in derselben Transaktion (wie `nodix.move`).
    const nachgezogen = bewegt.length > 0 ? await zieheKraftlinienNach(tx, { knoten: bewegt }) : 0;
    const angelegt = eintraege.length === 1 && eintraege[0]!.operation === "nodix.create";
    return {
        receipt: {
            affected,
            derivedWork: nachgezogen > 0 ? [{ kind: "powerline_path", state: "done" }] : [],
            warnings: [],
        },
        summary: angelegt
            ? "Kraftlinienpunkt: Anlegen zurückgenommen"
            : `Kraftlinienpunkt: ${eintraege.length === 1 ? "1 Änderung" : `${String(eintraege.length)} Änderungen`} zurückgenommen`,
        entries,
    };
}

/** `POST …/nodices/:id/restore-series`: nimmt die Mitglieder am Kraftlinienpunkt in EINER Operation zurück (Ablauf: `fuehreRuecknahmeAus`). */
export async function ruecknehmenNodix(
    database: Database,
    actor: MapActor,
    leser: RuecknahmeLeser,
    id: string,
    body: RuecknahmeBody,
): Promise<RuecknahmeReceipt> {
    const domain = await domainVonNodix(database, id);
    return fuehreRuecknahmeAus({
        database,
        actor,
        leser,
        familie: familieNodix(id, domain),
        body,
        haken: {
            // Der Kraftlinienpunkt kennt keine Sperre des Editors (wie `nodix.move`).
            pruefeFremdeSperre: () => Promise.resolve(),
            async sperreZeilen(tx, vorab) {
                const ids = [...new Set(vorab.gegenstaende.filter((g) => g.kind === "nodix").map((g) => g.id))].sort();
                if (ids.length > 0)
                    await tx`SELECT id FROM nodix WHERE public_id = ANY(${ids}::uuid[]) ORDER BY public_id FOR UPDATE`;
            },
            async schreibe({ tx, offen, grund }) {
                const eintraege = (
                    await eintraegeNachKennung(tx, offen, { personId: leser.personId, nutzlast: "voll" })
                ).entries.sort((a, b) => a.seq - b.seq);
                return schreibeNodices(tx, eintraege, grund);
            },
        },
    });
}
