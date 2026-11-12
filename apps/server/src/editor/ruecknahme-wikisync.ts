import {
    AVENTURIA,
    type Capability,
    type RuecknahmePruefung,
    type RuecknahmeVorschauBody,
    type WikisyncBereich,
} from "@avesmaps3d/shared";
import type { Database, Queryable } from "../database.ts";
import { wiederherstellungSteht, zuweisungSteht } from "../wiki/regeln/flaechen.ts";
import { unterdrueckungDerOperation, unterdrueckungSteht } from "./landmarken-kandidaten.ts";
import { SCHREIBER } from "../wiki/abgleich/uebernahme/liste.ts";
import { planeObjektSyncRuecknahme } from "../wiki/abgleich/uebernahme/zuruecknehmen.ts";
import { mitgliederHash } from "./arbeitsserie.ts";
import { akteurVon, ladeZustaende, type AkteurZeile } from "./history-status.ts";
import { pruefeErgebnis } from "./ruecknahme-ablauf.ts";
import {
    WIKISYNC_ADMIN_OPERATIONEN,
    WIKISYNC_EDITOR_OPERATIONEN,
    WIKISYNC_FLAECHE_OPERATION,
    WIKISYNC_FLAECHE_RUECKNAHME_OPERATION,
    WIKISYNC_FLAECHE_WIEDER_OPERATION,
    WIKISYNC_LANDMARKE_ANBIETEN_OPERATION,
    WIKISYNC_LANDMARKE_UNTERDRUECKEN_OPERATION,
    WIKISYNC_LAUF_RUECKNAHME_OPERATION,
    WIKISYNC_OBJEKT_OPERATION,
    WIKISYNC_OBJEKT_RUECKNAHME_OPERATION,
    WIKISYNC_QUELLE,
    WIKISYNC_REGELN_OPERATION,
    WIKISYNC_REGELN_REDO_OPERATION,
    WIKISYNC_REGELN_UNDO_OPERATION,
    WIKISYNC_UEBERNAHME_OPERATION,
} from "./ruecknahme-arten.ts";
import type { RuecknahmeAdapter, RuecknahmeLeser, VorKonflikt, VorMitglied, Vorpruefung } from "./ruecknahme.ts";

/**
 * Die Übernahmen des WikiSync zurücknehmen (WI-0265 B8d, B8e; Fachvertrag C.2, F.1, Gate 2): Das ↺ in „Änderungen“ ruft GENAU die Rücknahme auf, die der WikiSync hat (WI-0253 §9): `wiki_zuruecknehmen` für die
 * Übernahme eines Laufs je Bereich (`wikisync_uebernahme.zurueckgenommen_am`, Operation `wikisync.zuruecknehmen`) und `lore.rules_wikisync_undo` für eine Übernahme von Regelvorschlägen
 * (`wikisync_regel_uebernahme.zurueckgenommen_am`). Es gibt keinen zweiten Mechanismus: Die Reiter-Route (`routes/admin-wikisync.ts`) fragt hier nur, ob und was, und reiht dann dieselbe Rücknahme ein wie
 * `POST /api/admin/wikisync/zuruecknehmen` (`zuruecknehmenEinreihen`) beziehungsweise ruft `nimmRegelnZurueck` wie `…/regeln/zuruecknehmen`.
 *
 * 🔴 **Was die Rücknahme des WikiSync anders macht, als der Reiter es sonst kennt (und wie die Antworten es sagen):**
 * - **Recht und Bestätigung:** `undo_wikisync_run` (Admin) mit frischem Passkey, nicht `edit_map_objects`. Fehlt das Recht: Ergebnis `forbidden` (Vorprüfung) und 403; den Passkey verlangt die Route
 *   (`reauth_required`/`assurance_required`, die Oberfläche fragt über „Kurz bestätigen“). Ausnahme sind die Schritte des Editors am Objekt (`WIKISYNC_EDITOR_OPERATIONEN`, B8e): Sync eines Objekts
 *   und Zuweisung einer Fläche laufen unter `edit_map_objects`, wie sie selbst, die Zuweisung in Production mit Passkey.
 * - **Feld für Feld, nicht ganz oder gar nicht:** Die Rücknahme schreibt je Feld das Vorher nur zurück, wo der Wert noch der der Übernahme ist; Felder, die seither jemand änderte (ein Editor, ein späterer Lauf),
 *   bleiben stehen und stehen als Befund im Protokoll der Übernahme (`seit_uebernahme_geaendert`). Es gibt darum keinen Konflikt `edit_conflict` und keine strenge Regel „keine spätere Operation“: Die Vorprüfung
 *   sagt `ok`, und die Rückfrage nennt den Satz (`aenderungen.ruecknahme.folgen.wikisync`). Nur wo gar nichts mehr zurückzuschreiben wäre (der Sync eines Objekts, dessen Felder alle abweichen), ist es ein Konflikt
 *   (`felder`), und nichts wird eingereiht.
 * - **Ein Auftrag, keine Antwort im Moment:** Die Rücknahme eines Laufs und des Syncs eines Objekts läuft als Auftrag der Warteschlange (`wiki_zuruecknehmen`, 200 mit `derivedWork`, Zustand `queued`), nicht in der
 *   Anfrage (sie schreiben mit den Rechten der Jobs-Rolle in den Wiki-Stand); die Operation `wikisync.zuruecknehmen` beziehungsweise `wikisync.objekt_zuruecknehmen` entsteht, wenn er fertig ist. Bis dahin steht
 *   die Übernahme in der Liste weiter als `ruecknehmbar`; ein zweiter Klick ist 409 `uebernahme_laeuft` (wartet oder läuft schon eine Übernahme oder Rücknahme). `reverts` der Quittung ist darum leer. Die Rücknahme
 *   von Regelvorschlägen und die Zuweisung einer Fläche laufen in der Anfrage (`reverts` = die Übernahme).
 * - **Jede Übernahme einzeln:** Die Rücknahme gilt der Übernahme, auf die das ↺ steht (Bereich und Lauf), nie einer anderen desselben Laufs. Eine Übernahme wird nur einmal zurückgenommen (`already_reverted`).
 * - **Der Grund** (Gate 2): Stammt die Übernahme von einer anderen Person oder vom System, ist der Grund Pflicht (400 `reason_required`); er steht als `restoreReason` an jedem Eintrag der Rücknahme.
 * - **Die Rücknahme einer Rücknahme** (B8e) ist die Umkehrung aus dem Protokoll, keine neue Übernahme gegen das Wiki von heute: Die Werte der Übernahme kommen Feld für Feld wieder, wo der Istwert noch der Stand
 *   nach der Rücknahme ist (`zuruecknehmen.ts`, derselbe Kern). Bei Regelvorschlägen ist die Gegenrichtung `lore.rules_wikisync_redo` (`stelleRegelnWiederHer`), und deren Rücknahme ist wieder die Rücknahme.
 * - **Nicht rücknehmbar (Grund `art`):** die Rücknahme der Zuweisung einer Fläche (`wikisync.flaeche_zuruecknehmen`; das Regelfenster weist von Hand neu zu) und alles andere, was der WikiSync schreibt und der
 *   Katalog nicht nennt.
 * - **Import** (`source = import`) und das Zurücksetzen der Testwelt bleiben `nicht_ruecknehmbar` mit Grund `quelle`.
 */

export const WIKISYNC_ADAPTER: RuecknahmeAdapter = {
    familie: "wikisync",
    // Das Recht der Rücknahme des WikiSync (Fachvertrag F.1).
    recht: (operation) => rechtFuer(operation),
    pruefeArt: (operation) =>
        WIKISYNC_ADMIN_OPERATIONEN.has(operation) || WIKISYNC_EDITOR_OPERATIONEN.has(operation)
            ? { ok: true }
            : { ok: false, reason: "art" },
};

/** Das Recht der Rücknahme: die Verwaltung unter `undo_wikisync_run`, die Schritte des Editors unter `edit_map_objects`. */
export const rechtFuer = (operation: string): Capability =>
    WIKISYNC_EDITOR_OPERATIONEN.has(operation) ? "edit_map_objects" : "undo_wikisync_run";

/** Was die Rücknahme der Operation wissen muss. */
export type WikiSyncZiel =
    | { art: "lauf"; uebernahme: number; lauf: number; bereich: WikisyncBereich; geschrieben: boolean; objekte: number }
    /** `richtung`: Was die Rücknahme tut, die Rücknahme der Übernahme (`undo`) oder deren Gegenrichtung (`redo`). */
    | { art: "regeln"; uebernahme: number; richtung: "undo" | "redo"; geschrieben: true; objekte: number }
    | { art: "objekt"; bereich: WikisyncBereich; operationId: string; geschrieben: boolean; objekte: number }
    /** `richtung`: Was die Rücknahme tut, die Zuweisung zurücknehmen (`zurueck`) oder die zurückgenommene Zuweisung wiederherstellen (`wieder`; B8e2). */
    | {
          art: "flaeche";
          flaeche: string;
          operationId: string;
          richtung: "zurueck" | "wieder";
          geschrieben: true;
          objekte: number;
      }
    /** „Nicht auf die Karte“ an einem Landmarken-Kandidaten (WI-0271 L7): `unterdrueckt` ist der Wert, den die Operation schrieb; die Rücknahme schreibt den umgekehrten. */
    | { art: "landmarke"; kandidat: string; unterdrueckt: boolean; geschrieben: true; objekte: number };

interface OperationRow extends AkteurZeile {
    seq: string;
    at: Date;
    action: string;
    source: string;
}

interface UebernahmeRow {
    id: number;
    lauf: number;
    bereich: WikisyncBereich;
    status: string;
    operation_id: string | null;
    zahlen: Record<string, unknown>;
}

const ganz = (wert: unknown): number => (typeof wert === "number" && Number.isFinite(wert) ? Math.trunc(wert) : 0);

/** Der Bereich eines Syncs, aus den Aktionen seines Fachprotokolls (`<Art>.wikisync_uebernommen`/`…_zurueckgenommen`); `undefined`, wo keine Art passt. */
async function objektBereich(
    database: Queryable,
    operationId: string,
): Promise<{ bereich: WikisyncBereich; objekte: number } | undefined> {
    const zeilen = await database<{ art: string; anzahl: number }[]>`
        SELECT split_part(e.action, '.', 1) AS art, count(*)::int AS anzahl FROM map_audit_event e
         WHERE e.operation_id = ${operationId}::uuid AND (e.action LIKE '%.wikisync_uebernommen' OR e.action LIKE '%.wikisync_zurueckgenommen')
         GROUP BY 1
    `;
    for (const zeile of zeilen) {
        const treffer = (
            Object.entries(SCHREIBER) as [WikisyncBereich, NonNullable<(typeof SCHREIBER)[WikisyncBereich]>][]
        )
            .filter(([, schreiber]) => schreiber.protokollArt === zeile.art)
            .map(([bereich]) => bereich);
        // Nur die sechs Arten der Wiki-Box schreiben „am Objekt“; eine andere Art (Quelle, Vorkommen …) kommt aus einem Lauf.
        const bereich = treffer.find((kandidat) => OBJEKT_BEREICHE.has(kandidat));
        if (bereich !== undefined) return { bereich, objekte: zeile.anzahl };
    }
    return undefined;
}

const OBJEKT_BEREICHE: ReadonlySet<WikisyncBereich> = new Set<WikisyncBereich>([
    "ort",
    "weg",
    "gebiet",
    "region",
    "kraftlinie",
    "gipfel",
]);

/** Die Übernahme (oder Rücknahme) zu einer Operation, soweit der WikiSync sie führt; `undefined`, wo die Tafel sie nicht kennt. */
async function ladeZiel(
    database: Queryable,
    operationId: string,
    operation: string,
): Promise<WikiSyncZiel | undefined> {
    if (operation === WIKISYNC_UEBERNAHME_OPERATION || operation === WIKISYNC_LAUF_RUECKNAHME_OPERATION) {
        const [zeile] = await database<UebernahmeRow[]>`
            SELECT id::int AS id, lauf_id::int AS lauf, bereich, status, operation_id::text AS operation_id, zahlen
              FROM wikisync_uebernahme
             WHERE operation_id = ${operationId}::uuid AND art = ${operation === WIKISYNC_UEBERNAHME_OPERATION ? "uebernahme" : "zuruecknahme"}
        `;
        if (zeile === undefined) return undefined;
        return {
            art: "lauf",
            uebernahme: zeile.id,
            lauf: zeile.lauf,
            bereich: zeile.bereich,
            geschrieben: zeile.status === "fertig" && zeile.operation_id !== null,
            objekte: ganz(zeile.zahlen["objekte"]),
        };
    }
    if (operation === WIKISYNC_REGELN_OPERATION) {
        const [regeln] = await database<{ id: number }[]>`
            SELECT id::int AS id FROM wikisync_regel_uebernahme WHERE operation_id = ${operationId}::uuid
        `;
        return regeln === undefined
            ? undefined
            : { art: "regeln", uebernahme: regeln.id, richtung: "undo", geschrieben: true, objekte: 0 };
    }
    if (operation === WIKISYNC_REGELN_UNDO_OPERATION || operation === WIKISYNC_REGELN_REDO_OPERATION) {
        // Die Quittung der Rücknahme nennt die Übernahme (`affected`); ihre Rücknahme ist die Gegenrichtung.
        const [kopf] = await database<{ id: number }[]>`
            SELECT (a ->> 'id')::int AS id FROM map_operation m, jsonb_array_elements(m.receipt -> 'affected') a
             WHERE m.operation_id = ${operationId}::uuid AND a ->> 'kind' = 'wikisync_regel_uebernahme' LIMIT 1
        `;
        return kopf === undefined
            ? undefined
            : {
                  art: "regeln",
                  uebernahme: kopf.id,
                  richtung: operation === WIKISYNC_REGELN_UNDO_OPERATION ? "redo" : "undo",
                  geschrieben: true,
                  objekte: 0,
              };
    }
    if (operation === WIKISYNC_OBJEKT_OPERATION || operation === WIKISYNC_OBJEKT_RUECKNAHME_OPERATION) {
        const bereich = await objektBereich(database, operationId);
        return bereich === undefined
            ? undefined
            : { art: "objekt", bereich: bereich.bereich, operationId, geschrieben: true, objekte: bereich.objekte };
    }
    if (
        operation === WIKISYNC_FLAECHE_OPERATION ||
        operation === WIKISYNC_FLAECHE_WIEDER_OPERATION ||
        operation === WIKISYNC_FLAECHE_RUECKNAHME_OPERATION
    ) {
        // Eine Zuweisung und ihre Wiederherstellung schreiben `wiki_zugewiesen`, die Rücknahme `wiki_entfernt`; deren Rücknahme ist die Wiederherstellung.
        const wieder = operation === WIKISYNC_FLAECHE_RUECKNAHME_OPERATION;
        const [flaeche] = await database<{ kennung: string }[]>`
            SELECT region_public_id::text AS kennung FROM map_audit_event
             WHERE operation_id = ${operationId}::uuid AND action = ${wieder ? "region.wiki_entfernt" : "region.wiki_zugewiesen"}
               AND region_public_id IS NOT NULL LIMIT 1
        `;
        return flaeche === undefined
            ? undefined
            : {
                  art: "flaeche",
                  flaeche: flaeche.kennung,
                  operationId,
                  richtung: wieder ? "wieder" : "zurueck",
                  geschrieben: true,
                  objekte: 1,
              };
    }
    if (
        operation === WIKISYNC_LANDMARKE_UNTERDRUECKEN_OPERATION ||
        operation === WIKISYNC_LANDMARKE_ANBIETEN_OPERATION
    ) {
        const stand = await unterdrueckungDerOperation(database, operationId);
        return stand === undefined
            ? undefined
            : {
                  art: "landmarke",
                  kandidat: stand.kandidat,
                  unterdrueckt: stand.unterdrueckt,
                  geschrieben: true,
                  objekte: 1,
              };
    }
    return undefined;
}

export interface WikiSyncPruefung {
    vor: Vorpruefung;
    ziel: WikiSyncZiel | undefined;
}

/**
 * Die Vorprüfung der Rücknahme einer Übernahme des WikiSync. Nur lesend. Die Reihenfolge der Ergebnisse ist die der Vorprüfung der Reiter: `invalid_members` (unbekannte Kennung, Liste oder Prüfsumme passen nicht) →
 * `forbidden` (das Recht fehlt) → `not_revertable` (die Übernahme schrieb nichts, oder es ist keine, die der WikiSync zurücknimmt) → `already_reverted` → `edit_conflict` (nur Sync eines Objekts und Zuweisung einer
 * Fläche: nichts mehr zurückzuschreiben) → `ok`. `erlaubt` sind die Operationen der Route: die der Verwaltung oder die des Editors.
 */
export async function pruefeWikiSync(
    database: Queryable,
    operationId: string,
    members: readonly string[],
    membersHash: string | undefined,
    leser: RuecknahmeLeser,
    erlaubt: ReadonlySet<string> = WIKISYNC_ADMIN_OPERATIONEN,
): Promise<WikiSyncPruefung> {
    const id = operationId.toLowerCase();
    const liste = [...new Set(members.map((eine) => eine.toLowerCase()))].sort();
    const hash = membersHash?.toLowerCase() ?? mitgliederHash(liste);
    const leer = (
        ergebnis: Vorpruefung["ergebnis"],
        ungueltig?: NonNullable<Vorpruefung["ungueltig"]>,
    ): Vorpruefung => ({
        ergebnis,
        membersHash: hash,
        mitglieder: [],
        offen: [],
        gegenstaende: [],
        konflikte: [],
        sperren: [],
        fehlendeRechte: [],
        fremdePersonen: [],
        reasonRequired: false,
        ...(ungueltig === undefined ? {} : { ungueltig }),
    });
    if (liste.length === 0) return { vor: leer("invalid_members", "leer"), ziel: undefined };
    if (liste.length !== 1 || liste[0] !== id) return { vor: leer("invalid_members", "keine_serie"), ziel: undefined };
    if (hash !== mitgliederHash(liste)) return { vor: leer("invalid_members", "hash"), ziel: undefined };

    const [zeile] = await database<OperationRow[]>`
        SELECT o.seq::text AS seq, o.at, o.action, o.source, o.actor_kind, o.actor_person_id::text AS actor_person_id, o.actor_label, o.approval_ref, p.display_name
          FROM map_operation o LEFT JOIN avesmaps_auth.person p ON p.id = o.actor_person_id
         WHERE o.operation_id = ${id}::uuid AND o.map_domain_id = ${AVENTURIA.mapDomain}
    `;
    if (zeile === undefined || zeile.source !== WIKISYNC_QUELLE)
        return { vor: leer("invalid_members", "unbekannt"), ziel: undefined };

    const zustand = (
        await ladeZustaende(
            database,
            [{ operationId: id, source: zeile.source, operation: zeile.action }],
            leser.personId,
        )
    ).get(id);
    const ziel = erlaubt.has(zeile.action) ? await ladeZiel(database, id, zeile.action) : undefined;
    const akteur = akteurVon(zeile, leser.personId);
    const geschrieben = ziel?.geschrieben === true;
    const mitglied: VorMitglied = {
        operationId: id,
        seq: Number(zeile.seq),
        at: zeile.at.toISOString(),
        operation: zeile.action,
        source: "wikisync",
        actor: akteur,
        status: zustand?.status ?? "nicht_ruecknehmbar",
        ...(zustand?.statusReason === undefined ? {} : { statusReason: zustand.statusReason }),
        offen: zustand?.status === "ruecknehmbar" && geschrieben,
        // Eine Übernahme, die nichts schrieb (oder die Tafel nicht kennt), und alles, was der WikiSync nicht zurücknimmt, schließt die Rücknahme aus.
        ...(ziel === undefined || !geschrieben || zustand?.status === "nicht_ruecknehmbar"
            ? { ausschluss: { grund: "art" as const } }
            : {}),
        gegenstaende: [],
    };
    const fremd = !(akteur.kind === "person" && akteur.id === leser.personId);
    const vor: Vorpruefung = {
        ...leer("ok"),
        mitglieder: [mitglied],
        offen: mitglied.offen ? [id] : [],
        fremdePersonen:
            mitglied.offen && fremd
                ? [
                      {
                          kind: akteur.kind,
                          ...(akteur.id === undefined ? {} : { id: akteur.id }),
                          ...(akteur.name === undefined ? {} : { name: akteur.name }),
                      },
                  ]
                : [],
        reasonRequired: mitglied.offen && fremd,
    };
    if (!leser.rechte.has(rechtFuer(zeile.action)))
        return {
            vor: {
                ...vor,
                ergebnis: "forbidden",
                fehlendeRechte: [rechtFuer(zeile.action)],
                offen: [],
                reasonRequired: false,
                fremdePersonen: [],
            },
            ziel,
        };
    if (mitglied.ausschluss !== undefined) return { vor: { ...vor, ergebnis: "not_revertable" }, ziel };
    if (zustand?.status === "bereits_zurueckgenommen") return { vor: { ...vor, ergebnis: "already_reverted" }, ziel };
    // Die Schritte des Editors haben strenge Vorbedingungen, die schon die Vorprüfung nennt: nichts mehr zurückzuschreiben.
    const konflikte = await konflikteDes(database, ziel);
    if (konflikte.length > 0) return { vor: { ...vor, ergebnis: "edit_conflict", konflikte }, ziel };
    return { vor, ziel };
}

/**
 * Der Sync eines Objekts rechnet vorab mit derselben Entscheidung wie die Rücknahme (`rechneFelder`): Weicht jedes Feld ab, ist es ein Konflikt (`felder`), und es wird nichts eingereiht; ein Protokoll ohne Einträge
 * (eine ältere Operation) ist keine Art, die sich zurücknehmen ließe. Die Zuweisung einer Fläche steht nur, solange die jüngste Wiki-Zuordnung der Fläche diese Zuweisung ist und der Artikel noch so dasteht.
 */
async function konflikteDes(database: Queryable, ziel: WikiSyncZiel | undefined): Promise<VorKonflikt[]> {
    if (ziel?.art === "objekt") {
        const schreiber = SCHREIBER[ziel.bereich];
        if (schreiber === undefined) return [];
        const plan = await planeObjektSyncRuecknahme(database, ziel.bereich, schreiber, ziel.operationId);
        if (plan.eintraege === 0 || plan.zuruecknahmen > 0) return [];
        const felder = [...new Set(plan.befunde.flatMap((befund) => (befund.feld === null ? [] : [befund.feld])))];
        const erster = plan.befunde[0];
        return [
            {
                art: "wert",
                kind: schreiber.affectedArt as VorKonflikt["kind"],
                id: erster?.objektId ?? ziel.operationId,
                ...(erster?.objektName == null ? {} : { name: erster.objektName }),
                felder,
                abweichung: { was: "felder" },
                detail: "Alle Felder dieses Syncs wurden seither geändert; es gibt nichts zurückzuschreiben.",
            },
        ];
    }
    if (ziel?.art === "flaeche") {
        const stand =
            ziel.richtung === "wieder"
                ? await wiederherstellungSteht(database, ziel.flaeche, ziel.operationId)
                : await zuweisungSteht(database, ziel.flaeche, ziel.operationId);
        if (stand.steht) return [];
        return [
            {
                art: stand.vorhanden ? "wert" : "geloescht",
                kind: "landscape",
                id: ziel.flaeche,
                ...(stand.name === null ? {} : { name: stand.name }),
                ...(stand.vorhanden ? { felder: ["wiki"], abweichung: { was: "felder" as const } } : {}),
                detail:
                    ziel.richtung === "wieder"
                        ? "Die Zuordnung dieser Fläche ist seit der Rücknahme geändert, oder der Artikel gehört einer anderen Fläche."
                        : "Die Zuordnung dieser Fläche ist seit der Zuweisung geändert.",
            },
        ];
    }
    if (ziel?.art === "landmarke") {
        // Nur, solange der Kandidat noch so steht, wie die Operation ihn ließ (sonst nähme die Rücknahme eine spätere Entscheidung weg).
        const stand = await unterdrueckungSteht(database, ziel.kandidat, ziel.unterdrueckt);
        if (stand.steht) return [];
        return [
            {
                art: stand.vorhanden ? "wert" : "geloescht",
                kind: "landmarke_artikel",
                id: ziel.kandidat,
                ...(stand.name === null ? {} : { name: stand.name }),
                ...(stand.vorhanden ? { felder: ["unterdrueckt"], abweichung: { was: "felder" as const } } : {}),
                detail: "„Nicht auf die Karte“ an diesem Wiki-Artikel ist seither geändert.",
            },
        ];
    }
    return [];
}

/** `POST …/wikisync/:id/restore-series/preview`: lesend, nichts wird geschrieben und kein Auftrag eingereiht. Die Folgen nennen die Zahl der Objekte, die die Übernahme berührte. */
export async function vorschauWikiSync(
    database: Database,
    operationId: string,
    body: RuecknahmeVorschauBody,
    leser: RuecknahmeLeser,
    erlaubt: ReadonlySet<string> = WIKISYNC_ADMIN_OPERATIONEN,
): Promise<RuecknahmePruefung> {
    const { vor, ziel } = await pruefeWikiSync(database, operationId, body.members, body.membersHash, leser, erlaubt);
    return { ...vor, folgen: { gegenstaende: ziel?.objekte ?? 0, gelaende: "keines" } } as RuecknahmePruefung;
}

/** Die Fehler der Vorprüfung als Fehler der Antwort (403, 400, 409 …) und bei fremder Person der Pflichtgrund; wirft, wo die Rücknahme nicht anlaufen darf. */
export async function erzwingeRuecknahme(
    database: Queryable,
    vor: Vorpruefung,
    grund: string | undefined,
): Promise<void> {
    await pruefeErgebnis(database, vor, grund);
}
