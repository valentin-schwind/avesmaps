import {
    AVENTURIA,
    type MapHistoryEntry,
    type MapHistoryObjectKind,
    type RuecknahmeBody,
    type RuecknahmePruefung,
    type RuecknahmeReceipt,
    type RuecknahmeVorschauBody,
} from "@avesmaps3d/shared";
import type { Database, Queryable } from "../database.ts";
import { ApiError } from "../http/api-error.ts";
import type { MapActor, MapAuditEntry } from "./map-operation.ts";
import {
    fuehreRuecknahmeAus,
    pruefeFamilie,
    type RuecknahmeFamilie,
    type RuecknahmeSchreiben,
    type SchreibErgebnis,
} from "./ruecknahme-ablauf.ts";
import type { RuecknahmeAdapter, RuecknahmeLeser, Vorpruefung } from "./ruecknahme.ts";

/**
 * Das Gemeinsame der Rücknahme von Quelle, Werk und Korpus (WI-0265 B6g1; `ruecknahme-quelle.ts`, `-werk.ts`, `-korpus.ts`): Die drei schreiben über `inhalteOperation` (Naht `inhalte` des
 * gemeinsamen Ablaufs: Quelle `restore`, `reverts`, ohne Ableitung und ohne Ereignis `map.changed`), haben keine Sperre im Editor (`editor_lock` kennt die Inhalte nicht) und nehmen, wie das
 * Gebiet, je Feld den Wert VOR dem ersten Mitglied einer Serie zurück. Was ihnen gleich ist, steht hier: der Plan aus dem Protokoll, der Vergleich der Werte, der Grund an den Einträgen und
 * die zwei Routen (`vorschau…`, `ruecknehmen…`).
 *
 * 🔴 **Parität und Grenze:** Zurückgenommen wird, was das Protokoll in `before` und `after` vollständig festhält. Was es nicht festhält, bleibt `art`: Die Verwendungen einer Quelle an
 * Trägern (`links`; sie hängen am Kanon und, beim Weg, an der ganzen Straße und gehören mit den Quellen am Träger zu B6g3) und die Wirkung eines Korpus auf mehr als `PROTOKOLL_QUELLEN_MAX`
 * Quellen (das Protokoll nennt dann nur die Zahl).
 */

/** Die Karte der Inhalte: Alle Operationen der Inhalte schreiben in diese Domäne (`inhalteOperation`). */
export const INHALTE_DOMAENE: string = AVENTURIA.mapDomain;

/** Ein leeres Feld ist `null`, gleich ob das Protokoll es als `null` oder gar nicht führt. */
export const leer = (wert: unknown): unknown => wert ?? null;

/** Was ein Feld über die Serie hinweg erlebt hat: der Wert vor dem ersten und nach dem letzten Mitglied, das es berührt. */
export interface FeldZiel {
    feld: string;
    vorher: unknown;
    nachher: unknown;
}

/** Ein Gegenstand der Serie: sein Name (der heutige, wie die Liste ihn nennt) und seine Felder. */
export interface InhaltePlan {
    name?: string;
    felder: Map<string, FeldZiel>;
    /**
     * Ein Mitglied legte den Gegenstand an (`ANGELEGT_AKTION`; WI-0265 B8d): Zurück heißt stillgelegt (das Feld `active`, Wert davor `false`), nicht gelöscht. Die Felder, die das Anlegen und die
     * Folgeänderungen schrieben, bleiben, wie sie sind (ohne Belang für einen stillgelegten Gegenstand); sie dienen nur dem Vergleich der Werte heute (`FeldZiel.nachher`).
     */
    angelegt: boolean;
}

/** Die Aktion, mit der das Anlegen eines Gegenstands der Art im Protokoll steht (`source.create` schreibt `source.created` …). */
export const ANGELEGT_AKTION: Readonly<Partial<Record<MapHistoryObjectKind, string>>> = {
    source: "source.created",
    work: "work.created",
    corpus: "corpus.created",
    lore: "lore.created",
};

/**
 * Die Felder, auf die eine Rücknahme zurückgeht: alle des Plans, bei einem angelegten Gegenstand nur `active` (still) und die Felder in `auch`, die vor dem Anlegen sicher einen Wert hatten (die Ortsliste
 * eines neuen Werks ist leer). Was das Anlegen und die Folgeänderungen sonst schrieben, bleibt.
 */
export const zielFelder = (plan: InhaltePlan, auch: readonly string[] = []): ReadonlyMap<string, FeldZiel> =>
    plan.angelegt
        ? new Map(
              ["active", ...auch].flatMap((feld) => (plan.felder.has(feld) ? [[feld, plan.felder.get(feld)!]] : [])),
          )
        : plan.felder;

/**
 * Die Felder der Mitglieder je Gegenstand der Art `kind`; die Einträge brauchen die volle Nutzlast. Der Grund einer früheren Rücknahme (`restoreReason`) ist kein Feld des Gegenstands.
 * Ein Feld, das mehrere Mitglieder berühren, trägt den Wert vor dem ersten und nach dem letzten.
 */
export function planAusEintraegen(
    eintraege: readonly MapHistoryEntry[],
    kind: MapHistoryObjectKind,
): Map<string, InhaltePlan> {
    const plan = new Map<string, InhaltePlan>();
    for (const eintrag of [...eintraege].sort((a, b) => a.seq - b.seq))
        for (const gegenstand of eintrag.objects) {
            if (gegenstand.kind !== kind) continue;
            let eines = plan.get(gegenstand.id);
            if (eines === undefined) {
                eines = {
                    felder: new Map(),
                    angelegt: false,
                    ...(gegenstand.name !== undefined ? { name: gegenstand.name } : {}),
                };
                plan.set(gegenstand.id, eines);
            }
            if (gegenstand.action === ANGELEGT_AKTION[kind]) {
                // Der Gegenstand entstand in dieser Operation: Vor der Serie gab es ihn nicht, also ist er danach still. Nach dem Anlegen ist er aktiv, bis ein späteres Mitglied das ändert.
                eines.angelegt = true;
                eines.felder.set("active", { feld: "active", vorher: false, nachher: true });
            }
            for (const [schluessel, wechsel] of Object.entries(gegenstand.changes)) {
                if (schluessel === "restoreReason") continue;
                const bisher = eines.felder.get(schluessel);
                if (bisher === undefined)
                    eines.felder.set(schluessel, {
                        feld: schluessel,
                        vorher: wechsel.before ?? null,
                        nachher: wechsel.after ?? null,
                    });
                else bisher.nachher = wechsel.after ?? null;
            }
        }
    return plan;
}

/** Ein Wert in fester Form zum Vergleichen: Schlüssel eines Objekts in fester Folge, leer als `null`. */
function fest(wert: unknown): unknown {
    if (Array.isArray(wert)) return wert.map(fest);
    if (wert !== null && typeof wert === "object")
        return Object.fromEntries(
            Object.entries(wert as Record<string, unknown>)
                .sort(([a], [b]) => (a < b ? -1 : 1))
                .map(([schluessel, eins]) => [schluessel, fest(eins)]),
        );
    return leer(wert);
}

export const gleichWert = (a: unknown, b: unknown): boolean => JSON.stringify(fest(a)) === JSON.stringify(fest(b));

/** Der Grund steht an jedem Eintrag der Rücknahme (Positivliste `source`, `work`, `corpus`: `restoreReason`). */
export const mitGrund = (entry: MapAuditEntry, grund: string | undefined): MapAuditEntry =>
    grund === undefined ? entry : { ...entry, changes: { ...entry.changes, restoreReason: { after: grund } } };

/** 400 `not_revertable` mit dem Grund `art` (und dem Feld, das die Rücknahme nicht versteht). */
export const nichtRuecknehmbar = (was: string, feld?: string): ApiError =>
    new ApiError(400, "not_revertable", `Diese Änderung an ${was} lässt sich nicht zurücknehmen.`, {
        reason: "art",
        ...(feld !== undefined ? { field: feld } : {}),
    });

/** Der Satz in der Liste „Änderungen“ (`map_operation.summary`): „Quelle „X“: 3 Änderungen zurückgenommen“. */
export const zusammenfassung = (art: string, name: string, mitglieder: number): string =>
    `${art} „${name}“: ${mitglieder === 1 ? "Änderung" : `${String(mitglieder)} Änderungen`} zurückgenommen`;

/** Die Familie für den gemeinsamen Ablauf: die Naht der Inhalte, der Gegenstand der Route als Anker. */
export const inhalteFamilie = (operation: string, scope: string, adapter: RuecknahmeAdapter): RuecknahmeFamilie => ({
    operation,
    scope,
    adapter,
    mapDomainId: INHALTE_DOMAENE,
    naht: "inhalte",
});

/** `POST …/restore-series/preview`: lesend, nichts wird geschrieben und kein Auftrag eingestellt. Quelle, Werk und Korpus gehen in kein abgeleitetes Ergebnis (Gelände: keines). */
export async function vorschauInhalte(
    database: Queryable,
    familie: RuecknahmeFamilie,
    kind: MapHistoryObjectKind,
    body: RuecknahmeVorschauBody,
    leser: RuecknahmeLeser,
): Promise<RuecknahmePruefung> {
    const vor = await pruefeFamilie(
        database,
        { mapDomainId: INHALTE_DOMAENE, mitglieder: body.members, membersHash: body.membersHash },
        leser,
        familie,
    );
    return {
        ...vor,
        folgen: { gegenstaende: vor.gegenstaende.filter((g) => g.kind === kind).length, gelaende: "keines" },
    } as RuecknahmePruefung;
}

/** Was die Familie für das Schreiben liefert: ihre Zeilen sperren und die Inverse schreiben. */
export interface InhalteSchreiben {
    /** Die Zeilen der Gegenstände (und was die Rücknahme sonst anfasst) in fester Reihenfolge sperren, bevor die Vorprüfung wiederholt wird. */
    sperreZeilen(tx: Queryable, vorab: Vorpruefung): Promise<void>;
    schreibe(kontext: RuecknahmeSchreiben): Promise<SchreibErgebnis>;
}

/**
 * `POST …/restore-series`: nimmt die Mitglieder in EINER Operation zurück (Ablauf: `fuehreRuecknahmeAus`, Naht der Inhalte). Die Inhalte kennen keine Sperre im Editor; es gibt also keine
 * Fremdsperre zu prüfen. Das Recht der Vorwärtsoperation (`manage_sources`) prüft der Ablauf über den Adapter.
 */
export function ruecknehmenInhalte(parameter: {
    database: Database;
    actor: MapActor;
    leser: RuecknahmeLeser;
    familie: RuecknahmeFamilie;
    body: RuecknahmeBody;
    schreiben: InhalteSchreiben;
}): Promise<RuecknahmeReceipt> {
    const { schreiben, ...rest } = parameter;
    return fuehreRuecknahmeAus({
        ...rest,
        haken: {
            pruefeFremdeSperre: async () => undefined,
            sperreZeilen: (tx, vorab) => schreiben.sperreZeilen(tx, vorab),
            schreibe: (kontext) => schreiben.schreibe(kontext),
        },
    });
}
