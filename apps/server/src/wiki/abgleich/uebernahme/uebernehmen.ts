import { createHash } from "node:crypto";
import { isWikiBoxArt, type WikisyncAblehnung, type WikisyncBereich } from "@avesmaps3d/shared";
import type { Database, Queryable } from "../../../database.ts";
import { mapOperation, type MapActor, type MapAuditEntry, type MapChange } from "../../../editor/map-operation.ts";
import { erfolgeAusSchritten, merkeErfolge } from "../../objekt/stand.ts";
import { ladeObjekte } from "../lokal.ts";
import type { PlanObjekt } from "../plan.ts";
import { wikisyncBereiche } from "../schalter-lesen.ts";
import { entscheideZeilen, type Entscheidung } from "./entscheiden.ts";
import {
    ladeLaufZeilen,
    schliesseUebernahme,
    schreibeBefunde,
    type VorschauLauf,
    type VorschauZeile,
} from "./protokoll.ts";
import {
    auditSchluessel,
    schreiberDes,
    zeilenDes,
    type BefundSchritt,
    type FeldSchritt,
    type Schreiber,
} from "./schreiber.ts";

/**
 * Die Übernahme eines Bereichs (WI-0253 D-1; §4 D): die Zeilen eines Laufs der Vorschau in die Fachtafeln schreiben, als EINE Operation an der Karte
 * (`map_operation` mit der Quelle `wikisync`, Fachprotokoll je Objekt), in EINER Transaktion mit dem Protokoll der Übernahme.
 *
 * - **Gelesen wird die Vorschau, geglaubt wird ihr nicht.** Unter der Sperre der Objekte (dieselbe wie die der Editoren) rechnet `entscheiden.ts` jedes Feld noch einmal
 *   gegen den Stand von jetzt: Was seit der Vorschau anders ist, wird nicht geschrieben und ist ein Befund (`seit_vorschau_geaendert`).
 * - **Alles oder nichts je Bereich.** Ein Fehler oder Abbruch vor dem Ende der Transaktion lässt den Bereich, wie er war. Die Bereiche eines Auftrags sind getrennte
 *   Transaktionen: Ein späterer Fehler nimmt einen früheren nicht zurück (dafür gibt es die Rücknahme je Bereich und Lauf).
 * - **Nichts zu tun ist keine Operation.** Ändert sich nichts (der zweite Lauf mit demselben Stand), entsteht weder eine `map_operation` noch eine Revision noch ein
 *   Ereignis `map.changed`; das Protokoll der Übernahme steht trotzdem da, mit den Zahlen.
 * - **Die Ableitungen:** Eine Operation setzt die Leser-Revision (`readSubjectRevision` liest die jüngste `map_operation.seq`) und die Kachelrevision (`map.changed`), und
 *   `deriveAfter` reiht, was die Art des Objekts braucht, wo der Schreiber es will (`leitetAb`): Kraftlinien, Orte und Gebiete brauchen nichts darüber hinaus (ihre Werte gehen in kein abgeleitetes Ergebnis ein), ein Wegname löst Wegprofil und Wegnamen auf der Karte aus, ein Landschaftsname die Schriftläufe. Der
 *   Kanon-Cache der Träger (§3a, dritter Schritt) hängt an der Zuordnung und an den Publikationen, die D-1 beide nie ändert.
 * - **Der Besitz ist fest** (`wikisyncBereiche`, kein Schalter mehr): Ein Bereich ohne angeschlossene Übernahme wird nicht übernommen.
 */

/** Die Übernahme darf nicht anlaufen (für den Bereich gibt es keine Übernahme, die Vorschau ist keine Grundlage mehr). Der Auftrag macht daraus `abgelehnt`. */
export class UebernahmeAbgelehnt extends Error {
    readonly grund: WikisyncAblehnung;
    constructor(grund: WikisyncAblehnung, text: string) {
        super(text);
        this.name = "UebernahmeAbgelehnt";
        this.grund = grund;
    }
}

/** Unter der Sperre stellte sich heraus, dass nichts zu schreiben ist; die Transaktion rollt zurück, die Befunde bleiben. */
export class KeineAenderung extends Error {
    readonly befunde: BefundSchritt[];
    readonly zahlen: Record<string, number>;
    constructor(befunde: BefundSchritt[], zahlen: Record<string, number>) {
        super("keine Änderung");
        this.name = "KeineAenderung";
        this.befunde = befunde;
        this.zahlen = zahlen;
    }
}

/** Eine UUID, die aus Auftrag, Bereich und Art folgt: Der Auftrag, den die Warteschlange wiederholt, bekommt dieselbe Kennung der Operation (idempotente Wiederholung). */
export function operationsKennung(jobPublicId: string, bereich: WikisyncBereich, art: string): string {
    const hash = createHash("sha256").update(`wikisync|${jobPublicId}|${bereich}|${art}`).digest("hex");
    const hex = hash.slice(0, 32).split("");
    hex[12] = "4";
    hex[16] = ((Number.parseInt(hex[16] ?? "0", 16) & 0x3) | 0x8).toString(16);
    const roh = hex.join("");
    return `${roh.slice(0, 8)}-${roh.slice(8, 12)}-${roh.slice(12, 16)}-${roh.slice(16, 20)}-${roh.slice(20, 32)}`;
}

export interface UebernahmeKontext {
    db: Database;
    bereich: WikisyncBereich;
    schreiber: Schreiber;
    lauf: VorschauLauf;
    /** Die Zeile in `wikisync_uebernahme`, die dieser Lauf füllt. */
    uebernahmeId: number;
    actor: MapActor;
    mapDomainId: string;
    jobPublicId: string;
    /** Wird kurz vor dem Schreiben gerufen; wirft `JobCancelled`, wenn der Abbruch angenommen ist (zwischen den Phasen, nie mittendrin). */
    vorDemSchreiben(): void;
}

export interface UebernahmeErgebnis {
    operationId: string | null;
    zahlen: Record<string, number>;
    befunde: number;
}

/** Die Objekte eines Schreibers nach Kennung, wie die Vorschau sie liest (Stand von jetzt). */
export async function objekteNachKennung(
    db: Queryable,
    bereich: WikisyncBereich,
    schreiber: Pick<Schreiber, "objekte">,
): Promise<Map<string, PlanObjekt>> {
    // Ein Abschnitt kann zwei Zuweisungen tragen (die Haupt- und weitere); der Schreiber der Wege pflegt nur die Hauptzuweisung, und nur sie steht hier unter der Kennung des Abschnitts.
    return new Map(
        (await (schreiber.objekte === undefined ? ladeObjekte(db, [bereich]) : schreiber.objekte(db)))
            .filter((objekt) => objekt.hauptzuweisung)
            .map((objekt) => [objekt.id, objekt]),
    );
}

/** Die Summe von Zahlen je Schlüssel: Was die Schreiber eines Bereichs einzeln zählen, steht im Protokoll zusammen. */
export function zahlenSumme(zahlen: readonly Readonly<Record<string, number>>[]): Record<string, number> {
    const summe: Record<string, number> = {};
    for (const eintrag of zahlen) {
        for (const [schluessel, wert] of Object.entries(eintrag)) summe[schluessel] = (summe[schluessel] ?? 0) + wert;
    }
    return summe;
}

const einzigartig = (werte: readonly string[]): string[] => [...new Set(werte)].sort();

/** Was die Zeilen eines Bereichs gegen den Stand von jetzt ergeben: die Felder (`entscheiden.ts`) und, wo der Bereich eine Liste führt, die Liste (`Schreiber.liste`). */
export interface Gesamtentscheidung extends Entscheidung {
    liste: { objekt: PlanObjekt }[];
}

/** Teilt die Zeilen nach Feld und Liste und entscheidet beide; rein. */
export function entscheideAlles(
    bereich: WikisyncBereich,
    zeilen: readonly VorschauZeile[],
    objekte: ReadonlyMap<string, PlanObjekt>,
    schreiber: Schreiber,
): Gesamtentscheidung {
    const liste = schreiber.liste;
    const felder = liste === undefined ? zeilen : zeilen.filter((zeile) => !liste.feldGehoert(zeile.feld, zeile));
    const roh = entscheideZeilen(bereich, felder, objekte, schreiber);
    if (liste === undefined) return { ...roh, liste: [] };
    const eintraege = liste.entscheide(
        zeilen.filter((zeile) => liste.feldGehoert(zeile.feld, zeile)),
        objekte,
    );
    return {
        schritte: roh.schritte,
        befunde: [...roh.befunde, ...eintraege.befunde],
        schonGleich: roh.schonGleich + eintraege.schonGleich,
        liste: eintraege.schritte,
    };
}

/**
 * Die Revision nach dem Schreiben für das Fachprotokoll: `null`, wo das Objekt keine neue bekam (der Gipfel: Die Übernahme schreibt an ihm nichts, nur seinen Wiki-Stand). Das Protokoll
 * nimmt nur eine Revision, die vorwärts geht (`map_audit_event_revision_forward`).
 */
export const neueRevision = (vorher: number | undefined, nachher: number | undefined): number | null =>
    nachher === undefined || nachher === vorher ? null : nachher;

/** Welche Objekte die Übernahme berührt: die Objekte der Zeilen, an denen mindestens ein Schritt übrig blieb. */
function beruehrteObjekte(
    zeilen: readonly VorschauZeile[],
    schritte: readonly FeldSchritt[],
    bekannt: ReadonlyMap<string, PlanObjekt>,
): string[] {
    const bleibt = new Set(schritte.map((schritt) => `${schritt.objekt.id}|${schritt.feld}`));
    const ids = new Set<string>();
    for (const zeile of zeilen) {
        if (!zeile.objektIds.some((id) => bleibt.has(`${id}|${zeile.feld}`))) continue;
        for (const id of zeile.objektIds) if (bekannt.has(id)) ids.add(id);
    }
    return [...ids].sort();
}

/** Die Zahlen im Titel der Operation (`map_operation.summary`): wie viele Felder aus dem Wiki kamen und an wie vielen Objekten. */
export interface TitelZahlen {
    felder: number;
    objekte: number;
}

/**
 * Was der Titel der Operation zählt (WI-0265 B6i). Bis dahin zählte er nur die Schritte der Felder an Objekten, die es schon gab: Ein Lauf, der nur NEUE Objekte anlegt (Sprachartikel, `liste` mit
 * `schliesseAb`), stand als „WikiSync: 0 Felder aus dem Wiki übernommen (0 Objekte)“ in der Liste der „Änderungen“, obwohl er neunzig Gegenstände mit allen ihren Feldern trug. Jetzt zählt
 * - **Felder:** die Schritte der Felder; je Zeile der Liste an einem Objekt, das es schon gab (Ortszeile eines Vorkommens, Ortsliste eines Werks, Verwendung einer Quelle), eines; und alle Felder
 *   der Objekte, die die Übernahme selbst anlegte (die Einträge von `schliesseAb` mit ihren Schlüsseln; `created` ist die Marke der Rücknahme, kein Feld des Wikis);
 * - **Objekte:** die berührten Objekte und die angelegten.
 * Die Zahlen des Protokolls der Übernahme (`zahlen`) bleiben, wie sie waren.
 */
export function titelZahlen(args: {
    schritte: readonly FeldSchritt[];
    beruehrt: readonly string[];
    /** Zeilen der Liste an Objekten, die es schon gab. */
    listeImBestand: number;
    /** Die Einträge der Objekte, die die Übernahme anlegte. */
    angelegt: readonly MapAuditEntry[];
}): TitelZahlen {
    const felderAngelegt = args.angelegt.reduce(
        (summe, eintrag) => summe + Object.keys(eintrag.changes ?? {}).filter((feld) => feld !== "created").length,
        0,
    );
    return {
        felder: args.schritte.length + args.listeImBestand + felderAngelegt,
        objekte: args.beruehrt.length + args.angelegt.length,
    };
}

/** Der Titel der Operation in der Liste der „Änderungen“. */
export const uebernahmeTitel = (zahlen: TitelZahlen): string =>
    `WikiSync: ${String(zahlen.felder)} Felder aus dem Wiki übernommen (${String(zahlen.objekte)} Objekte)`;

/** Was `schreibeUnterSperre` geschrieben hat: die Zahlen, die Befunde, die berührten Objekte und das Fachprotokoll samt Folgen. */
export interface SchreibErgebnis {
    befunde: BefundSchritt[];
    zahlen: Record<string, number>;
    /** Die Zahlen für den Titel der Operation (`titelZahlen`). */
    titel: TitelZahlen;
    beruehrt: string[];
    schritte: FeldSchritt[];
    entries: MapAuditEntry[];
    revisionNach: ReadonlyMap<string, number>;
    folgen: { entries: MapAuditEntry[]; affected: { kind: string; id: string; revision: number }[] };
}

/**
 * Schreibt die Zeilen eines Bereichs unter der Sperre der Objekte (Entscheidung gegen den Stand von jetzt, Prüfung des Bereichs, wirksame Spalten, Wiki-Stand, Folgen, Fachprotokoll). Die EINE Stelle
 * für die Übernahme eines Laufs (`uebernimmBereich`) und für den Sync EINES Objekts (`wiki/objekt/sync.ts`, Wiki-Box); beide rufen sie INNERHALB ihrer Operation an der Karte. Wirft `KeineAenderung`,
 * wenn unter der Sperre nichts zu schreiben bleibt. Das Protokoll (Übernahme, Befunde, Stand je Objekt) schreibt der Aufrufer.
 */
export async function schreibeUnterSperre(
    tx: Queryable,
    args: {
        bereich: WikisyncBereich;
        schreiber: Schreiber;
        zeilen: readonly VorschauZeile[];
        zahlenGrund: Record<string, number>;
    },
): Promise<SchreibErgebnis> {
    const { bereich, schreiber, zeilen, zahlenGrund } = args;
    const revisionen = await schreiber.sperre(tx, einzigartig(zeilen.flatMap((zeile) => zeile.objektIds)));
    const objekte = await objekteNachKennung(tx, bereich, schreiber);
    const roh = entscheideAlles(bereich, zeilen, objekte, schreiber);
    const geprueft = await schreiber.pruefe(tx, roh.schritte);
    const befunde = [...roh.befunde, ...geprueft.befunde];
    const zahlenBasis = { ...zahlenGrund, schonGleich: roh.schonGleich };
    if (geprueft.schritte.length === 0 && roh.liste.length === 0) throw new KeineAenderung(befunde, zahlenBasis);

    const schritte = geprueft.schritte;
    // Die Objekte der Felder und der Liste: Jedes bekommt EINE neue Revision (ein offener Entwurf daran 409).
    const beruehrt = einzigartig([
        ...beruehrteObjekte(zeilen, schritte, objekte),
        ...roh.liste.map((schritt) => schritt.objekt.id).filter((id) => objekte.has(id)),
    ]);
    const schnappschussVon = await schreiber.schnappschussIds(tx, beruehrt);

    // 1. Die wirksamen Spalten, ein UPDATE je Objekt (die Revision zählt einmal), auch ohne eigene Spalte, damit offene Entwürfe 409 bekommen.
    const spalten = new Map<string, Record<string, string | null>>();
    for (const schritt of schritte) {
        const spalte = schreiber.wirksameSpalten[schritt.feld];
        if (schritt.wirksam === undefined || spalte === undefined) continue;
        spalten.set(schritt.objekt.id, {
            ...spalten.get(schritt.objekt.id),
            [spalte]: schritt.wirksam.nachher,
        });
    }
    const revisionNach = new Map<string, number>();
    for (const id of beruehrt) {
        revisionNach.set(id, await schreiber.schreibeObjekt(tx, id, spalten.get(id) ?? {}));
    }

    // 2. Der Wiki-Wert hinter ↺: je Schnappschuss und Feld einmal; im Protokoll steht er am ersten Objekt, das an ihm hängt.
    //    Ein Wert, den der Schnappschuss als unbekannt führte, ist danach bekannt (die Marke fällt, die Rücknahme setzt sie wieder).
    const spaltenJeSchnappschuss = new Map<string, Record<string, string | null>>();
    const markenJeSchnappschuss = new Map<string, string[]>();
    const vertreter = new Map<string, string>();
    for (const schritt of schritte) {
        const snapshot = schnappschussVon.get(schritt.objekt.id);
        const spalte = schreiber.schnappschussSpalten[schritt.feld];
        if (schritt.schnappschuss === undefined || snapshot === undefined || spalte === undefined) continue;
        const schluessel = `${snapshot}|${schritt.feld}`;
        if (vertreter.has(schluessel)) continue;
        vertreter.set(schluessel, schritt.objekt.id);
        spaltenJeSchnappschuss.set(snapshot, {
            ...spaltenJeSchnappschuss.get(snapshot),
            [spalte]: schritt.schnappschuss.nachher,
        });
        if (schritt.schnappschuss.unbekannt === true) {
            markenJeSchnappschuss.set(snapshot, [...(markenJeSchnappschuss.get(snapshot) ?? []), schritt.feld]);
        }
    }
    for (const [snapshot, werte] of [...spaltenJeSchnappschuss].sort(([a], [b]) => Number(a) - Number(b))) {
        await schreiber.schreibeSchnappschuss(tx, snapshot, werte, {
            bekannt: markenJeSchnappschuss.get(snapshot) ?? [],
            unbekannt: [],
        });
    }
    // 2b. Folgen am Objekt, die der Editor in derselben Operation mitschreibt (der Name einer Landschaft geht an ihre Beschriftungen).
    const folgen = (await schreiber.folgen?.(tx, schritte, revisionNach)) ?? { entries: [], affected: [] };
    // 2c. Die Liste am Objekt (die Ortsliste eines Werks): vorher und nachher je Objekt fürs Fachprotokoll.
    const listen =
        schreiber.liste === undefined ? new Map<string, MapChange>() : await schreiber.liste.schreibe(tx, roh.liste);
    // 2d. Was die Liste erst nach allen Schritten schreiben kann: Objekte, die sie anlegt (eine Quelle, die der Katalog nicht hatte), und das Etikett der Träger.
    const abschluss =
        schreiber.liste?.schliesseAb === undefined ? undefined : await schreiber.liste.schliesseAb(tx, roh.liste);
    if (abschluss !== undefined) {
        folgen.entries.push(...abschluss.entries);
        folgen.affected.push(...abschluss.affected);
    }

    // 3. Das Fachprotokoll: je berührtes Objekt ein Eintrag mit den Stellen, die sich änderten.
    const entries: MapAuditEntry[] = beruehrt.map((id) => {
        const changes: Record<string, MapChange> = {};
        for (const schritt of schritte.filter((kandidat) => kandidat.objekt.id === id)) {
            if (schritt.wirksam !== undefined) {
                changes[auditSchluessel(schritt.feld, "wirksam", schreiber.auditNamen)] = {
                    before: schritt.wirksam.vorher,
                    after: schritt.wirksam.nachher,
                };
            }
            const snapshot = schnappschussVon.get(id);
            if (
                schritt.schnappschuss !== undefined &&
                snapshot !== undefined &&
                vertreter.get(`${snapshot}|${schritt.feld}`) === id
            ) {
                changes[auditSchluessel(schritt.feld, "schnappschuss")] = {
                    before: schritt.schnappschuss.vorher,
                    after: schritt.schnappschuss.nachher,
                };
                if (schritt.schnappschuss.unbekannt === true) {
                    changes[auditSchluessel(schritt.feld, "unbekannt")] = { before: true, after: false };
                }
            }
        }
        const liste = listen.get(id);
        if (liste !== undefined && schreiber.liste !== undefined) changes[schreiber.liste.auditSchluessel] = liste;
        return {
            action: `${schreiber.protokollArt}.wikisync_uebernommen`,
            ...schreiber.eintragZiel(id),
            revisionBefore: revisionen.get(id) ?? null,
            revisionAfter: neueRevision(revisionen.get(id), revisionNach.get(id)),
            changes,
        };
    });
    entries.push(...folgen.entries);

    const zahlen: Record<string, number> = {
        ...zahlenBasis,
        objekte: beruehrt.length,
        felder: schritte.length + roh.liste.length,
        wirksam: schritte.filter((schritt) => schritt.wirksam !== undefined).length,
        liste: roh.liste.length,
        schnappschuss: schritte.filter((schritt) => schritt.schnappschuss !== undefined).length,
        ...(abschluss?.zahlen ?? {}),
        befunde: 0,
    };
    const titel = titelZahlen({
        schritte,
        beruehrt,
        listeImBestand: roh.liste.filter((schritt) => objekte.has(schritt.objekt.id)).length,
        angelegt: abschluss?.entries ?? [],
    });
    return { befunde, zahlen, titel, beruehrt, schritte, entries, revisionNach, folgen };
}

/** Schreibt die Zeilen eines Bereichs mit allen seinen Schreibern, in der Operation des Aufrufers. Wirft `KeineAenderung` erst, wenn KEINER etwas zu schreiben hat. */
async function schreibeAlleSchreiber(
    tx: Queryable,
    args: {
        bereich: WikisyncBereich;
        schreiber: Schreiber;
        zeilen: readonly VorschauZeile[];
        zahlenGrund: Record<string, number>;
    },
): Promise<{
    fertig: { teil: Schreiber; ergebnis: SchreibErgebnis }[];
    befundeOhne: BefundSchritt[];
    zahlenOhne: Record<string, number>[];
}> {
    const fertig: { teil: Schreiber; ergebnis: SchreibErgebnis }[] = [];
    const ohne: KeineAenderung[] = [];
    for (const teil of schreiberDes(args.schreiber)) {
        try {
            const ergebnis = await schreibeUnterSperre(tx, {
                bereich: args.bereich,
                schreiber: teil,
                zeilen: zeilenDes(args.zeilen, args.schreiber, teil),
                zahlenGrund: {},
            });
            fertig.push({ teil, ergebnis });
        } catch (fehler) {
            if (!(fehler instanceof KeineAenderung)) throw fehler;
            ohne.push(fehler);
        }
    }
    const befundeOhne = ohne.flatMap((fehler) => fehler.befunde);
    const zahlenOhne = ohne.map((fehler) => fehler.zahlen);
    if (fertig.length === 0) throw new KeineAenderung(befundeOhne, { ...zahlenSumme(zahlenOhne), ...args.zahlenGrund });
    return { fertig, befundeOhne, zahlenOhne };
}

/** Übernimmt einen Bereich; wirft `UebernahmeAbgelehnt`, wenn er nicht (mehr) übernommen werden darf. */
export async function uebernimmBereich(kontext: UebernahmeKontext): Promise<UebernahmeErgebnis> {
    const { db, bereich, schreiber, lauf } = kontext;
    const zeilen = await ladeLaufZeilen(db, lauf.id, bereich);
    const zahlenGrund = { zeilen: zeilen.length };

    // Vorab, ohne Sperre: Gibt es überhaupt etwas zu schreiben? Wenn nicht, braucht der zweite Lauf keine Operation.
    const vorab: Gesamtentscheidung[] = [];
    for (const teil of schreiberDes(schreiber)) {
        vorab.push(
            entscheideAlles(
                bereich,
                zeilenDes(zeilen, schreiber, teil),
                await objekteNachKennung(db, bereich, teil),
                teil,
            ),
        );
    }
    if (vorab.every((teil) => teil.schritte.length === 0 && teil.liste.length === 0)) {
        return keineOperation(
            kontext,
            vorab.flatMap((teil) => teil.befunde),
            { ...zahlenGrund, schonGleich: vorab.reduce((summe, teil) => summe + teil.schonGleich, 0) },
        );
    }
    kontext.vorDemSchreiben();

    const operationId = operationsKennung(kontext.jobPublicId, bereich, "uebernahme");
    // Das Ergebnis setzt die Arbeit in der Transaktion; eine Wiederholung derselben Kennung führt sie nicht aus.
    const gemerkt: { ergebnis?: UebernahmeErgebnis } = {};
    try {
        const quittung = await mapOperation(
            db,
            kontext.actor,
            {
                operationId,
                operation: "wikisync.uebernehmen",
                mapDomainId: kontext.mapDomainId,
                body: { bereich, lauf: lauf.id, uebernahme: kontext.uebernahmeId },
                source: "wikisync",
            },
            async (tx) => {
                // Der Besitz ist fest (kein Schalter mehr): Ein Bereich ohne Schreiber gehört dem WikiSync nicht.
                if (!(await wikisyncBereiche(tx)).has(bereich)) {
                    throw new UebernahmeAbgelehnt("gehoert_legacy", "Für diesen Bereich gibt es noch keine Übernahme.");
                }
                const { fertig, befundeOhne, zahlenOhne } = await schreibeAlleSchreiber(tx, {
                    bereich,
                    schreiber,
                    zeilen,
                    zahlenGrund,
                });
                const ergebnisse = fertig.map((eintrag) => eintrag.ergebnis);
                const zahlen = {
                    ...zahlenSumme([...ergebnisse.map((ergebnis) => ergebnis.zahlen), ...zahlenOhne]),
                    ...zahlenGrund,
                    befunde: await schreibeBefunde(tx, kontext.uebernahmeId, [
                        ...ergebnisse.flatMap((ergebnis) => ergebnis.befunde),
                        ...befundeOhne,
                    ]),
                };
                // Der Stand je Objekt für die Wiki-Box (WI-0253): Der Lauf hinterlässt an den berührten Objekten „automatisch“ als Auslöser. Die Box kennt nur die Objekte des Bereichs, keine Kandidaten.
                const haupt = fertig.find((eintrag) => eintrag.teil === schreiber)?.ergebnis;
                if (isWikiBoxArt(bereich) && haupt !== undefined) {
                    await merkeErfolge(
                        tx,
                        bereich,
                        erfolgeAusSchritten(haupt.schritte, haupt.beruehrt),
                        { von: null, label: null, automatisch: true },
                        { jobPublicId: kontext.jobPublicId },
                    );
                }
                await schliesseUebernahme(tx, kontext.uebernahmeId, { status: "fertig", operationId, zahlen });
                gemerkt.ergebnis = { operationId, zahlen, befunde: zahlen.befunde };

                return {
                    receipt: {
                        affected: fertig.flatMap(({ teil, ergebnis }) => [
                            ...ergebnis.beruehrt.map((id) => ({
                                kind: teil.affectedArt,
                                id,
                                revision: ergebnis.revisionNach.get(id) ?? 0,
                            })),
                            ...ergebnis.folgen.affected,
                        ]),
                        derivedWork: [],
                        warnings: [],
                    },
                    entries: ergebnisse.flatMap((ergebnis) => ergebnis.entries),
                    summary: uebernahmeTitel({
                        felder: ergebnisse.reduce((summe, ergebnis) => summe + ergebnis.titel.felder, 0),
                        objekte: ergebnisse.reduce((summe, ergebnis) => summe + ergebnis.titel.objekte, 0),
                    }),
                    ...(fertig.every(({ teil, ergebnis }) => teil.leitetAb?.(ergebnis.schritte) === false)
                        ? { ableitung: false as const }
                        : {}),
                };
            },
        );
        if (gemerkt.ergebnis === undefined) {
            // Dieselbe Kennung lief schon (ein wiederholter Auftrag): Die Operation steht, das Protokoll dieser Zeile schließen wir mit dem Hinweis.
            const zahlen = { ...zahlenGrund, wiederholt: 1 };
            await schliesseUebernahme(db, kontext.uebernahmeId, {
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

/** Nichts zu schreiben: Das Protokoll schließt sich ohne Operation, mit den Befunden. */
async function keineOperation(
    kontext: UebernahmeKontext,
    befunde: readonly BefundSchritt[],
    basis: Record<string, number>,
): Promise<UebernahmeErgebnis> {
    return kontext.db.begin(async (tx) => {
        const anzahl = await schreibeBefunde(tx, kontext.uebernahmeId, befunde);
        const zahlen = { ...basis, objekte: 0, felder: 0, wirksam: 0, schnappschuss: 0, befunde: anzahl };
        await schliesseUebernahme(tx, kontext.uebernahmeId, { status: "fertig", operationId: null, zahlen });
        return { operationId: null, zahlen, befunde: anzahl };
    });
}
