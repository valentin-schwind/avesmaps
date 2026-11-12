import type { WikisyncBereich } from "@avesmaps3d/shared";
import type { Database, Queryable } from "../../../database.ts";
import { mapOperation, type MapActor, type MapAuditEntry, type MapChange } from "../../../editor/map-operation.ts";
import { gleich, type PlanObjekt } from "../plan.ts";
import { KeineAenderung, neueRevision, objekteNachKennung, operationsKennung, zahlenSumme } from "./uebernehmen.ts";
import { schliesseUebernahme, schreibeBefunde } from "./protokoll.ts";
import {
    auditSchluessel,
    schreiberDes,
    type BefundSchritt,
    type FeldSchritt,
    type Schreiber,
    type StellenName,
} from "./schreiber.ts";

/**
 * Die Rücknahme einer Übernahme je Bereich und Lauf (WI-0253 D-1; §3 Punkt 6, Work Item §4 D): Sie liest, was die Operation der Übernahme im Fachprotokoll festhielt
 * (`map_audit_event.changes`, Feld → vorher/nachher), und schreibt das Vorher zurück, als EINE neue Operation (Quelle `wikisync`, Aktion `wikisync.zuruecknehmen`).
 * Nichts wird gelöscht.
 *
 * - **Je Stelle nur, wenn der Istwert noch „nachher“ ist.** Hat seitdem jemand das Feld geändert (ein Editor, ein späterer Lauf), bleibt sein Wert stehen und ein Befund
 *   (`seit_uebernahme_geaendert`) sagt es. Die wirksame Spalte und der Wiki-Wert hinter ↺ werden einzeln geprüft; der Vermerk wurde nie geschrieben und bleibt, wie er war
 *   (außer in einem Bereich ohne Wiki-Stand: Dort folgt er dem geschriebenen Wert, `fuelltLeereFelder`). Trägt das Feld inzwischen den Vermerk `manual` (eine Entscheidung
 *   der Redaktion, bei der Literatur auch: das Werk gehört jetzt der Redaktion), bleibt es, auch wenn der Wert noch der der Übernahme ist.
 * - **Ändert sich nichts**, entsteht keine Operation.
 * - Eine Übernahme wird nur einmal zurückgenommen (`zurueckgenommen_am`); was die Rücknahme nicht zurückschreiben durfte, steht als Befund da.
 *
 * 🔴 **Die Rücknahme ist ihre eigene Umkehrung** (WI-0265 B8e): Das Fachprotokoll einer Rücknahme trägt dieselben Schlüssel mit Heute → Vorher, und dieselbe Regel liest es richtig herum:
 * Wer eine Rücknahme zurücknimmt, spielt die Werte der Übernahme wieder ein, je Stelle nur, wo der Istwert noch der Stand nach der Rücknahme ist. Es gibt dafür keinen zweiten Weg. Die Zeilen
 * einer Kette (Übernahme, ihre Rücknahme, deren Rücknahme …) halten ihren Stand in `ordneRuecknahmenNeu`.
 *
 * Derselbe Kern nimmt auch den Sync EINES Objekts zurück (Wiki-Box „mit dem Wiki abgleichen“, `wikisync.objekt_sync`): Er schreibt mit denselben Schreibern und hinterlässt dasselbe Fachprotokoll
 * (`nimmObjektSyncZurueck`).
 */

export interface RuecknahmeKontext {
    db: Database;
    bereich: WikisyncBereich;
    schreiber: Schreiber;
    /** Die Übernahme (oder Rücknahme), die zurückgenommen wird. */
    uebernahme: { id: number; operationId: string };
    /** Die Zeile in `wikisync_uebernahme`, die diese Rücknahme füllt. */
    rueckId: number;
    actor: MapActor;
    mapDomainId: string;
    jobPublicId: string;
    vorDemSchreiben(): void;
    /** Der Grund, wenn die Rücknahme aus „Änderungen“ kam und einen verlangte (WI-0265 B8d); er steht als `restoreReason` an jedem Eintrag. */
    grund?: string;
}

export interface RuecknahmeErgebnis {
    operationId: string | null;
    zahlen: Record<string, number>;
    befunde: number;
}

export interface Aenderung {
    feld: string;
    stelle: StellenName;
    vorher: unknown;
    nachher: unknown;
}

const text = (wert: unknown): string | null => (typeof wert === "string" ? wert : null);

/** Welches (Feld, Stelle) heißt im Fachprotokoll so? */
function schluesselTafel(schreiber: Schreiber): Map<string, { feld: string; stelle: StellenName }> {
    const tafel = new Map<string, { feld: string; stelle: StellenName }>();
    for (const feld of Object.keys(schreiber.wirksameSpalten))
        tafel.set(auditSchluessel(feld, "wirksam", schreiber.auditNamen), { feld, stelle: "wirksam" });
    for (const feld of Object.keys(schreiber.schnappschussSpalten)) {
        tafel.set(auditSchluessel(feld, "schnappschuss"), { feld, stelle: "schnappschuss" });
        if (schreiber.unbekanntFelder?.has(feld) === true)
            tafel.set(auditSchluessel(feld, "unbekannt"), { feld, stelle: "unbekannt" });
    }
    return tafel;
}

/** Was das Fachprotokoll einer Operation an Änderungen nennt, je Objekt (und die Listen am Objekt, die ihr eigener Schreiber zurücknimmt). */
export interface GeleseneAenderungen {
    aenderungen: Map<string, Aenderung[]>;
    listen: Map<string, MapChange>;
    ganze: Map<string, Record<string, MapChange>>;
}

/**
 * Die Änderungen der Übernahme je Objekt, aus dem Fachprotokoll ihrer Operation; eine Liste am Objekt (die Ortsliste eines Werks) steht unter dem Schlüssel ihres
 * Schreibers in `listen`.
 */
export async function ladeAenderungen(
    db: Queryable,
    schreiber: Schreiber,
    operationId: string,
): Promise<GeleseneAenderungen> {
    const listen = new Map<string, MapChange>();
    const ganze = new Map<string, Record<string, MapChange>>();
    const zeilen = await db<{ objekt: string; changes: Record<string, MapChange> }[]>`
        SELECT e.${db(schreiber.zielSpalte)}::text AS objekt, e.changes
          FROM map_audit_event e
         WHERE e.operation_id = ${operationId}::uuid AND e.${db(schreiber.zielSpalte)} IS NOT NULL
         ORDER BY e.id
    `;
    const tafel = schluesselTafel(schreiber);
    const jeObjekt = new Map<string, Aenderung[]>();
    for (const zeile of zeilen) {
        const liste = jeObjekt.get(zeile.objekt) ?? [];
        for (const [schluessel, wechsel] of Object.entries(zeile.changes)) {
            if (schreiber.liste !== undefined && schluessel === schreiber.liste.auditSchluessel) {
                listen.set(zeile.objekt, wechsel);
                ganze.set(zeile.objekt, zeile.changes);
                continue;
            }
            const stelle = tafel.get(schluessel);
            if (stelle === undefined) continue;
            liste.push({ ...stelle, vorher: wechsel.before ?? null, nachher: wechsel.after ?? null });
        }
        jeObjekt.set(zeile.objekt, liste);
    }
    return { aenderungen: jeObjekt, listen, ganze };
}

/** Der Wert, den das Objekt an dieser Stelle heute trägt. */
function istWert(objekt: PlanObjekt, feld: string, stelle: StellenName): string | null {
    if (stelle === "schnappschuss") return objekt.schnappschuss?.get(feld) ?? null;
    if (stelle === "unbekannt") return objekt.schnappschussUnbekannt.has(feld) ? "ja" : "nein";
    const lokal = objekt.lokal.get(feld);
    return lokal?.zustand === "text" ? lokal.wert : null;
}

/** Was die Rechnung der Felder ergibt: was zurückgeschrieben wird, je Objekt und Stelle, und was liegen bleibt. REIN: nichts wird gelesen oder geschrieben. */
export interface FeldRechnung {
    spalten: Map<string, Record<string, string | null>>;
    wiki: Map<string, Record<string, string | null>>;
    /** Je Schnappschuss: die Marken „Wiki-Wert unbekannt“, die wieder gesetzt werden (`setzen`), und die, die wieder fallen (`loeschen`). */
    marken: Map<string, { setzen: string[]; loeschen: string[] }>;
    /** Je Objekt und Schlüssel des Fachprotokolls: Heute → Zurückgeschriebenes. */
    schritte: Map<string, Map<string, MapChange>>;
    reverted: FeldSchritt[];
    befunde: BefundSchritt[];
    zuruecknahmen: number;
}

/**
 * Entscheidet je Objekt und Stelle, was zurückgeschrieben wird: nur, wo der Istwert noch „nachher“ ist (und das Feld nicht inzwischen der Redaktion gehört). REIN; die Rücknahme und die Vorprüfung
 * des Objekt-Syncs rechnen mit derselben Funktion.
 */
export function rechneFelder(eingabe: {
    schreiber: Schreiber;
    ids: readonly string[];
    aenderungen: ReadonlyMap<string, readonly Aenderung[]>;
    listen: ReadonlyMap<string, MapChange>;
    objekte: ReadonlyMap<string, PlanObjekt>;
    schnappschussVon: ReadonlyMap<string, string>;
}): FeldRechnung {
    const { schreiber, objekte, schnappschussVon } = eingabe;
    const rechnung: FeldRechnung = {
        spalten: new Map(),
        wiki: new Map(),
        marken: new Map(),
        schritte: new Map(),
        reverted: [],
        befunde: [],
        zuruecknahmen: 0,
    };
    const befund = (id: string, feld: string, grund: string): void => {
        rechnung.befunde.push({
            objektId: id,
            objektArt: schreiber.objektArt,
            objektName: objekte.get(id)?.name ?? null,
            feld,
            befund: "seit_uebernahme_geaendert",
            grund,
        });
    };
    const zeichne = (id: string, schluessel: string, wechsel: MapChange): void => {
        const jeSchluessel = rechnung.schritte.get(id) ?? new Map<string, MapChange>();
        jeSchluessel.set(schluessel, wechsel);
        rechnung.schritte.set(id, jeSchluessel);
    };
    const snapshotErledigt = new Set<string>();
    for (const id of eingabe.ids) {
        const objekt = objekte.get(id);
        const liste = eingabe.aenderungen.get(id) ?? [];
        if (objekt === undefined) {
            for (const a of liste) befund(id, a.feld, "Das Objekt ist nicht mehr auf der Karte");
            if (schreiber.liste !== undefined && eingabe.listen.has(id))
                befund(id, schreiber.liste.auditSchluessel, "Das Objekt ist nicht mehr auf der Karte");
            continue;
        }
        for (const a of liste.filter((kandidat) => kandidat.stelle === "wirksam")) {
            if (objekt.lokal.get(a.feld)?.vermerk === "manual") {
                befund(id, a.feld, "Der Wert gehört inzwischen der Redaktion");
                continue;
            }
            const heute = istWert(objekt, a.feld, "wirksam");
            if (!gleich(heute, text(a.nachher))) {
                befund(id, a.feld, "Der Wert wurde seit der Übernahme geändert");
                continue;
            }
            const spalte = schreiber.wirksameSpalten[a.feld];
            if (spalte === undefined) continue;
            rechnung.spalten.set(id, { ...rechnung.spalten.get(id), [spalte]: text(a.vorher) });
            zeichne(id, auditSchluessel(a.feld, "wirksam", schreiber.auditNamen), {
                before: heute,
                after: text(a.vorher),
            });
            rechnung.reverted.push({ objekt, feld: a.feld, wirksam: { vorher: heute, nachher: text(a.vorher) } });
            rechnung.zuruecknahmen += 1;
        }
        for (const a of liste.filter((kandidat) => kandidat.stelle === "schnappschuss")) {
            const snapshot = schnappschussVon.get(id);
            const spalte = schreiber.schnappschussSpalten[a.feld];
            if (snapshot === undefined || spalte === undefined) {
                befund(id, a.feld, "Das Objekt hat keinen Wiki-Stand mehr");
                continue;
            }
            const heute = istWert(objekt, a.feld, "schnappschuss");
            if (!gleich(heute, text(a.nachher))) {
                befund(id, a.feld, "Der Wiki-Wert wurde seit der Übernahme geändert");
                continue;
            }
            if (snapshotErledigt.has(`${snapshot}|${a.feld}`)) continue;
            snapshotErledigt.add(`${snapshot}|${a.feld}`);
            rechnung.wiki.set(snapshot, { ...rechnung.wiki.get(snapshot), [spalte]: text(a.vorher) });
            zeichne(id, auditSchluessel(a.feld, "schnappschuss"), { before: heute, after: text(a.vorher) });
            rechnung.zuruecknahmen += 1;
        }
        // Die Marke „Wiki-Wert unbekannt“: Hat die Übernahme sie gelöscht (vorher gesetzt), setzt die Rücknahme sie wieder; hat die Rücknahme sie gesetzt, löscht die Rücknahme der Rücknahme sie wieder.
        // Jeweils nur, wo sie heute noch so steht, wie die Operation sie hinterließ.
        for (const a of liste.filter((kandidat) => kandidat.stelle === "unbekannt")) {
            const snapshot = schnappschussVon.get(id);
            const vorherJa = a.vorher === true;
            const nachherJa = a.nachher === true;
            if (snapshot === undefined || vorherJa === nachherJa) continue;
            if (istWert(objekt, a.feld, "unbekannt") !== (nachherJa ? "ja" : "nein")) {
                befund(
                    id,
                    a.feld,
                    nachherJa ? "Die Marke ist schon wieder gelöscht" : "Die Marke ist schon wieder gesetzt",
                );
                continue;
            }
            const schluessel = snapshot + "|" + a.feld + "|marke";
            if (snapshotErledigt.has(schluessel)) continue;
            snapshotErledigt.add(schluessel);
            const bisher = rechnung.marken.get(snapshot) ?? { setzen: [], loeschen: [] };
            (vorherJa ? bisher.setzen : bisher.loeschen).push(a.feld);
            rechnung.marken.set(snapshot, bisher);
            zeichne(id, auditSchluessel(a.feld, "unbekannt"), { before: nachherJa, after: vorherJa });
            rechnung.zuruecknahmen += 1;
        }
    }
    return rechnung;
}

interface Innen {
    ids: string[];
    beruehrt: string[];
    revisionNach: Map<string, number>;
    zuruecknahmen: number;
    befunde: BefundSchritt[];
    entries: MapAuditEntry[];
    folgenAffected: { kind: string; id: string; revision: number }[];
    reverted: FeldSchritt[];
}

/**
 * Schreibt die Rücknahme EINER Operation in der Transaktion der Operation an der Karte (der Kern der Rücknahme eines Laufs und des Objekt-Syncs); wirft `KeineAenderung`, wenn nichts zurückzuschreiben ist.
 * Die Vorbedingungen (Objekte, Schnappschüsse, Sperren) liest sie selbst, unter der Sperre der Objekte.
 */
async function schreibeRuecknahme(
    tx: Queryable,
    k: {
        bereich: WikisyncBereich;
        schreiber: Schreiber;
        operationId: string;
        gelesen: GeleseneAenderungen;
        grund?: string | undefined;
    },
): Promise<Innen> {
    const { bereich, schreiber, gelesen } = k;
    const ids = [...new Set([...gelesen.aenderungen.keys(), ...gelesen.listen.keys()])].sort();
    const revisionen = await schreiber.sperre(tx, ids);
    const objekte = await objekteNachKennung(tx, bereich, schreiber);
    const schnappschussVon = await schreiber.schnappschussIds(tx, ids);
    const rechnung = rechneFelder({
        schreiber,
        ids,
        aenderungen: gelesen.aenderungen,
        listen: gelesen.listen,
        objekte,
        schnappschussVon,
    });
    const befunde = rechnung.befunde;
    let zuruecknahmen = rechnung.zuruecknahmen;
    // Die Liste am Objekt (die Ortsliste eines Werks): ihr eigener Weg zurück, bedingt auf den Stand der Übernahme.
    if (schreiber.liste !== undefined) {
        for (const id of ids) {
            const objekt = objekte.get(id);
            const listenWechsel = gelesen.listen.get(id);
            if (objekt === undefined || listenWechsel === undefined) continue;
            const zurueck = await schreiber.liste.nimmZurueck(tx, id, listenWechsel, objekt, gelesen.ganze.get(id));
            befunde.push(...zurueck.befunde);
            if (zurueck.change !== null) {
                const jeSchluessel = rechnung.schritte.get(id) ?? new Map<string, MapChange>();
                jeSchluessel.set(schreiber.liste.auditSchluessel, zurueck.change);
                rechnung.schritte.set(id, jeSchluessel);
            }
            zuruecknahmen += zurueck.anzahl;
        }
    }
    // Folgen der Uebernahme am Objekt (die Beschriftungen einer Landschaft): derselbe Weg zurueck, bedingt auf den Stand der Uebernahme.
    const folgen = (await schreiber.folgenZuruecknehmen?.(tx, k.operationId)) ?? {
        entries: [],
        affected: [],
        befunde: [],
    };
    befunde.push(...folgen.befunde);
    zuruecknahmen += folgen.entries.length;
    if (zuruecknahmen === 0) throw new KeineAenderung(befunde, { eintraege: ids.length });

    // Alle Objekte der Übernahme werden berührt (die Revision zählt einmal): Ein offener Entwurf bekommt 409.
    const beruehrt = ids.filter((id) => objekte.has(id));
    const revisionNach = new Map<string, number>();
    for (const id of beruehrt)
        revisionNach.set(id, await schreiber.schreibeObjekt(tx, id, rechnung.spalten.get(id) ?? {}));
    const snapshots = new Set([...rechnung.wiki.keys(), ...rechnung.marken.keys()]);
    for (const snapshot of [...snapshots].sort((a, b) => Number(a) - Number(b))) {
        const marken = rechnung.marken.get(snapshot);
        await schreiber.schreibeSchnappschuss(tx, snapshot, rechnung.wiki.get(snapshot) ?? {}, {
            bekannt: marken?.loeschen ?? [],
            unbekannt: marken?.setzen ?? [],
        });
    }

    const entries: MapAuditEntry[] = beruehrt.map((id) => ({
        action: `${schreiber.protokollArt}.wikisync_zurueckgenommen`,
        ...schreiber.eintragZiel(id),
        revisionBefore: revisionen.get(id) ?? null,
        revisionAfter: neueRevision(revisionen.get(id), revisionNach.get(id)),
        changes: Object.fromEntries(rechnung.schritte.get(id) ?? []),
    }));
    entries.push(...folgen.entries);
    // Der Grund bleibt im Eintrag sichtbar (Gate 2): wie bei jeder Rücknahme aus „Änderungen“ nur `after`.
    if (k.grund !== undefined) {
        for (const [index, eintrag] of entries.entries())
            entries[index] = { ...eintrag, changes: { ...eintrag.changes, restoreReason: { after: k.grund } } };
    }
    return {
        ids,
        beruehrt,
        revisionNach,
        zuruecknahmen,
        befunde,
        entries,
        folgenAffected: folgen.affected,
        reverted: rechnung.reverted,
    };
}

export async function nimmZurueck(kontext: RuecknahmeKontext): Promise<RuecknahmeErgebnis> {
    const { db, bereich, schreiber } = kontext;
    // Je Schreiber des Bereichs, was das Fachprotokoll ihm nennt (seine `zielSpalte`).
    const teile: { teil: Schreiber; gelesen: GeleseneAenderungen }[] = [];
    for (const teil of schreiberDes(schreiber)) {
        const gelesen = await ladeAenderungen(db, teil, kontext.uebernahme.operationId);
        if (gelesen.aenderungen.size > 0 || gelesen.listen.size > 0) teile.push({ teil, gelesen });
    }
    if (teile.length === 0) {
        // Die Operation hat keine Einträge (oder ihr Fachprotokoll gibt es nicht mehr): Es gibt nichts zurückzunehmen.
        return keineOperation(kontext, [], { eintraege: 0 });
    }
    kontext.vorDemSchreiben();

    const operationId = operationsKennung(kontext.jobPublicId, bereich, "zuruecknahme");
    const gemerkt: { ergebnis?: RuecknahmeErgebnis } = {};
    try {
        const quittung = await mapOperation(
            db,
            kontext.actor,
            {
                operationId,
                operation: "wikisync.zuruecknehmen",
                mapDomainId: kontext.mapDomainId,
                body: { bereich, uebernahme: kontext.uebernahme.id, rueckId: kontext.rueckId },
                source: "wikisync",
            },
            async (tx) => {
                const fertig: { teil: Schreiber; innen: Innen }[] = [];
                const ohne: KeineAenderung[] = [];
                for (const { teil, gelesen } of teile) {
                    try {
                        const innen = await schreibeRuecknahme(tx, {
                            bereich,
                            schreiber: teil,
                            operationId: kontext.uebernahme.operationId,
                            gelesen,
                            grund: kontext.grund,
                        });
                        fertig.push({ teil, innen });
                    } catch (fehler) {
                        if (!(fehler instanceof KeineAenderung)) throw fehler;
                        ohne.push(fehler);
                    }
                }
                const befundeOhne = ohne.flatMap((fehler) => fehler.befunde);
                const eintraegeOhne = zahlenSumme(ohne.map((fehler) => fehler.zahlen))["eintraege"] ?? 0;
                if (fertig.length === 0) throw new KeineAenderung(befundeOhne, { eintraege: eintraegeOhne });
                const summe = (wert: (innen: Innen) => number): number =>
                    fertig.reduce((bisher, eintrag) => bisher + wert(eintrag.innen), 0);
                const felder = summe((innen) => innen.zuruecknahmen);
                const objekte = summe((innen) => innen.beruehrt.length);
                const zahlen = {
                    eintraege: summe((innen) => innen.ids.length) + eintraegeOhne,
                    objekte,
                    felder,
                    befunde: await schreibeBefunde(tx, kontext.rueckId, [
                        ...fertig.flatMap(({ innen }) => innen.befunde),
                        ...befundeOhne,
                    ]),
                };
                // Die Übernahme wird nur einmal zurückgenommen: Wer schneller war, hat gewonnen.
                const gesetzt = await tx<{ id: number }[]>`
                    UPDATE wikisync_uebernahme SET zurueckgenommen_am = now(), zurueckgenommen_durch = ${kontext.rueckId}
                     WHERE id = ${kontext.uebernahme.id} AND zurueckgenommen_am IS NULL
                    RETURNING id::int AS id
                `;
                if (gesetzt.length === 0) throw new Error("Diese Übernahme ist schon zurückgenommen");
                await schliesseUebernahme(tx, kontext.rueckId, { status: "fertig", operationId, zahlen });
                // Wer eine Rücknahme zurücknimmt, hebt sie auf: Die Übernahme davor gilt wieder (und so fort die Kette entlang).
                await ordneRuecknahmenNeu(tx, kontext.rueckId);
                gemerkt.ergebnis = { operationId, zahlen, befunde: zahlen.befunde };
                return {
                    receipt: {
                        affected: fertig.flatMap(({ teil, innen }) => [
                            ...innen.beruehrt.map((id) => ({
                                kind: teil.affectedArt,
                                id,
                                revision: innen.revisionNach.get(id) ?? 0,
                            })),
                            ...innen.folgenAffected,
                        ]),
                        derivedWork: [],
                        warnings: [],
                    },
                    entries: fertig.flatMap(({ innen }) => innen.entries),
                    summary: `WikiSync: Übernahme zurückgenommen (${String(felder)} Felder an ${String(objekte)} Objekten)`,
                    // Eine Rücknahme, die nur Wiki-Werte hinter ↺ zurückschreibt, geht in keine Ableitung ein; ein Name tut es.
                    ...(fertig.every(({ teil, innen }) => teil.leitetAb?.(innen.reverted) === false)
                        ? { ableitung: false as const }
                        : {}),
                };
            },
        );
        if (gemerkt.ergebnis === undefined) {
            const zahlen = { wiederholt: 1 };
            await schliesseUebernahme(db, kontext.rueckId, {
                status: "fertig",
                operationId: quittung.operationId,
                zahlen,
            });
            return { operationId: quittung.operationId, zahlen, befunde: 0 };
        }
        return gemerkt.ergebnis;
    } catch (fehler) {
        if (fehler instanceof KeineAenderung) return keineOperation(kontext, fehler.befunde, fehler.zahlen);
        throw fehler;
    }
}

/** Nichts zurückzunehmen: Das Protokoll der Rücknahme schließt sich ohne Operation, mit den Befunden. */
async function keineOperation(
    kontext: RuecknahmeKontext,
    befunde: readonly BefundSchritt[],
    basis: Record<string, number>,
): Promise<RuecknahmeErgebnis> {
    return kontext.db.begin(async (tx) => {
        const anzahl = await schreibeBefunde(tx, kontext.rueckId, befunde);
        const zahlen = { ...basis, objekte: 0, felder: 0, befunde: anzahl };
        await schliesseUebernahme(tx, kontext.rueckId, { status: "fertig", operationId: null, zahlen });
        return { operationId: null, zahlen, befunde: anzahl };
    });
}

// ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Die Kette der Rücknahmen
// ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

interface KettenZeile {
    id: number;
    art: string;
    status: string;
    operation_id: string | null;
    zurueckgenommen_durch: number | null;
}

/**
 * Hält `zurueckgenommen_am`/`zurueckgenommen_durch` in der Kette einer Übernahme richtig (WI-0265 B8e): Eine Zeile ist zurückgenommen, solange eine Rücknahme von ihr gilt, die etwas schrieb und selbst nicht
 * zurückgenommen ist. Die Verwaltung, der Auftrag und „Änderungen“ lesen diese Spalte; so gilt eine Übernahme wieder, wenn ihre Rücknahme zurückgenommen ist, und eine Rücknahme, die zurückgenommen ist, nicht mehr.
 * Läuft in der Transaktion der Rücknahme, nachdem ihre Zeile `fertig` ist; rechnet den ganzen Baum unter der Übernahme (eine Übernahme kann mehrere Rücknahmen haben, wenn sie nach einer aufgehobenen noch einmal
 * zurückgenommen wurde), ändert nur Zeilen, deren Stand abweicht.
 */
export async function ordneRuecknahmenNeu(tx: Queryable, ausgang: number): Promise<void> {
    const zeilen = await tx<(KettenZeile & { zurueck_von: number | null })[]>`
        WITH RECURSIVE nach_oben AS (
            SELECT id, zurueck_von FROM wikisync_uebernahme WHERE id = ${ausgang}
            UNION ALL
            SELECT u.id, u.zurueck_von FROM wikisync_uebernahme u JOIN nach_oben n ON u.id = n.zurueck_von
        ),
        baum AS (
            SELECT u.id, u.art, u.status, u.operation_id, u.zurueck_von, u.zurueckgenommen_durch
              FROM wikisync_uebernahme u WHERE u.id IN (SELECT id FROM nach_oben WHERE zurueck_von IS NULL)
            UNION ALL
            SELECT u.id, u.art, u.status, u.operation_id, u.zurueck_von, u.zurueckgenommen_durch
              FROM wikisync_uebernahme u JOIN baum b ON u.zurueck_von = b.id
        )
        SELECT id::int AS id, art, status, operation_id::text AS operation_id, zurueck_von::int AS zurueck_von,
               zurueckgenommen_durch::int AS zurueckgenommen_durch
          FROM baum
    `;
    const kinder = new Map<number, KettenZeile[]>();
    for (const zeile of zeilen) {
        if (zeile.zurueck_von === null) continue;
        // Nur eine Rücknahme, die etwas schrieb, hebt eine Zeile auf.
        if (zeile.art !== "zuruecknahme" || zeile.status !== "fertig" || zeile.operation_id === null) continue;
        kinder.set(zeile.zurueck_von, [...(kinder.get(zeile.zurueck_von) ?? []), zeile]);
    }
    const aufgehoben = new Map<number, number | null>();
    const aufheber = (id: number, weg: ReadonlySet<number>): number | null => {
        const bekannt = aufgehoben.get(id);
        if (bekannt !== undefined) return bekannt;
        if (weg.has(id)) return null;
        const neuerWeg = new Set(weg).add(id);
        const geltende = (kinder.get(id) ?? [])
            .filter((kind) => aufheber(kind.id, neuerWeg) === null)
            .sort((a, b) => b.id - a.id)[0];
        const wert = geltende?.id ?? null;
        aufgehoben.set(id, wert);
        return wert;
    };
    for (const zeile of zeilen) {
        const soll = aufheber(zeile.id, new Set());
        if (soll === zeile.zurueckgenommen_durch) continue;
        if (soll === null) {
            await tx`UPDATE wikisync_uebernahme SET zurueckgenommen_am = NULL, zurueckgenommen_durch = NULL WHERE id = ${zeile.id}`;
        } else {
            await tx`UPDATE wikisync_uebernahme SET zurueckgenommen_am = now(), zurueckgenommen_durch = ${soll} WHERE id = ${zeile.id}`;
        }
    }
}

// ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Der Sync EINES Objekts
// ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Die Rechnung vorab, nur lesend: Wie viele Felder gingen zurück, welche blieben? Dieselbe Entscheidung wie die Rücknahme selbst. */
export interface ObjektSyncPlan {
    /** Wie viele Objekte das Fachprotokoll der Operation nennt (0: ältere Operation ohne Protokoll, nichts zurückzunehmen). */
    eintraege: number;
    zuruecknahmen: number;
    befunde: BefundSchritt[];
}

export async function planeObjektSyncRuecknahme(
    db: Queryable,
    bereich: WikisyncBereich,
    schreiber: Schreiber,
    syncOperationId: string,
): Promise<ObjektSyncPlan> {
    const gelesen = await ladeAenderungen(db, schreiber, syncOperationId);
    const ids = [...new Set([...gelesen.aenderungen.keys(), ...gelesen.listen.keys()])].sort();
    if (ids.length === 0) return { eintraege: 0, zuruecknahmen: 0, befunde: [] };
    const objekte = await objekteNachKennung(db, bereich, schreiber);
    const schnappschussVon = await schreiber.schnappschussIds(db, ids);
    const rechnung = rechneFelder({
        schreiber,
        ids,
        aenderungen: gelesen.aenderungen,
        listen: gelesen.listen,
        objekte,
        schnappschussVon,
    });
    // Eine Liste am Objekt rechnet erst ihr Schreiber unter der Sperre; im Zweifel zählt sie mit (die sechs Arten der Wiki-Box haben keine).
    return {
        eintraege: ids.length,
        zuruecknahmen: rechnung.zuruecknahmen + (schreiber.liste === undefined ? 0 : gelesen.listen.size),
        befunde: rechnung.befunde,
    };
}

export interface ObjektSyncKontext {
    db: Database;
    bereich: WikisyncBereich;
    schreiber: Schreiber;
    /** Die Operation des Syncs (oder einer Rücknahme davon), die zurückgenommen wird. */
    syncOperationId: string;
    actor: MapActor;
    mapDomainId: string;
    jobPublicId: string;
    vorDemSchreiben(): void;
    grund?: string;
}

export interface ObjektSyncErgebnis {
    operationId: string | null;
    felder: number;
    befunde: BefundSchritt[];
}

/**
 * Nimmt den Sync EINES Objekts zurück (WI-0265 B8e; Operation `wikisync.objekt_zuruecknehmen`, Quelle `wikisync`, die Quittung nennt die Operation des Syncs): derselbe Kern wie die Rücknahme eines Laufs, ohne eine
 * Zeile in `wikisync_uebernahme` (der Sync hat keinen Lauf); die Befunde gehen in das Ergebnis des Auftrags. Nichts zurückzuschreiben ist keine Operation.
 */
export async function nimmObjektSyncZurueck(k: ObjektSyncKontext): Promise<ObjektSyncErgebnis> {
    const gelesen = await ladeAenderungen(k.db, k.schreiber, k.syncOperationId);
    if (gelesen.aenderungen.size === 0 && gelesen.listen.size === 0)
        return { operationId: null, felder: 0, befunde: [] };
    k.vorDemSchreiben();
    const operationId = operationsKennung(k.jobPublicId, k.bereich, `objekt-zurueck:${k.syncOperationId}`);
    const gemerkt: { felder: number; befunde: BefundSchritt[] } = { felder: 0, befunde: [] };
    try {
        const quittung = await mapOperation(
            k.db,
            k.actor,
            {
                operationId,
                operation: "wikisync.objekt_zuruecknehmen",
                mapDomainId: k.mapDomainId,
                body: { bereich: k.bereich, operation: k.syncOperationId },
                source: "wikisync",
            },
            async (tx) => {
                const innen = await schreibeRuecknahme(tx, {
                    bereich: k.bereich,
                    schreiber: k.schreiber,
                    operationId: k.syncOperationId,
                    gelesen,
                    grund: k.grund,
                });
                gemerkt.felder = innen.zuruecknahmen;
                gemerkt.befunde = innen.befunde;
                return {
                    receipt: {
                        affected: [
                            // Die Operation, die zurückgenommen wird: Die Liste liest die Kette daraus (`history-status.ts`); die Link-Tafel darf die Jobs-Rolle nicht anhängen.
                            { kind: "wikisync_operation", id: k.syncOperationId },
                            ...innen.beruehrt.map((id) => ({
                                kind: k.schreiber.affectedArt,
                                id,
                                revision: innen.revisionNach.get(id) ?? 0,
                            })),
                            ...innen.folgenAffected,
                        ],
                        derivedWork: [],
                        warnings: [],
                    },
                    entries: innen.entries,
                    summary: `Wiki-Box: Sync zurückgenommen (${String(innen.zuruecknahmen)} Felder)`,
                    ...(k.schreiber.leitetAb?.(innen.reverted) === false ? { ableitung: false as const } : {}),
                };
            },
        );
        // Dieselbe Kennung lief schon: Die Operation steht.
        return { operationId: quittung.operationId, felder: gemerkt.felder, befunde: gemerkt.befunde };
    } catch (fehler) {
        if (fehler instanceof KeineAenderung) return { operationId: null, felder: 0, befunde: fehler.befunde };
        throw fehler;
    }
}
