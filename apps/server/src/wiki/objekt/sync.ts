import type { WikiNamespaceTafel, WikisyncBereich } from "@avesmaps3d/shared";
import type { Database } from "../../database.ts";
import { mapOperation, type MapActor } from "../../editor/map-operation.ts";
import type { PlanObjekt, PlanZeile } from "../abgleich/plan.ts";
import { wikisyncBereiche } from "../abgleich/schalter-lesen.ts";
import { schreiberFuer } from "../abgleich/uebernahme/liste.ts";
import type { VorschauZeile } from "../abgleich/uebernahme/protokoll.ts";
import {
    KeineAenderung,
    UebernahmeAbgelehnt,
    operationsKennung,
    schreibeUnterSperre,
} from "../abgleich/uebernahme/uebernehmen.ts";
import { rechneVergleich, type ApiSeite } from "../artikel/vergleich.ts";
import { erfolgAusSchritten, merkeErfolge, type Ausloeser, type ObjektErfolg, type WikiHerkunft } from "./stand.ts";
import type { WikiBoxArt } from "@avesmaps3d/shared";

/**
 * Der Sync EINES Objekts (WI-0253, Wiki-Box „Sync aktualisieren“; Betreiber 2026-10-25: „Editor verknüpft irgendein objekt von uns mit einem wiki-objekt -> syncen erlaubt. bzw. "Sync aktualisieren"“):
 * derselbe Plan wie die Vorschau (`berechnePlan` über `rechneVergleich`) mit der einen Seite, die die MediaWiki-API lieferte, und dieselben Schreiber wie die Übernahme eines Laufs
 * (`wiki/abgleich/uebernahme/`), aber nur für die Kennungen dieses einen Objekts.
 *
 * - **Dieselbe Entscheidung wie die Übernahme:** Wirksam wird nur, wo der Vermerk „wiki“ sagt, dass der Wert dem Wiki folgt, und der Istwert noch dem Stand der Rechnung entspricht; ein eigener Wert bleibt.
 *   Der Wiki-Stand (↺) wird immer nachgezogen. Eine Zuordnung ändert dieser Weg nie.
 * - **Eine Operation an der Karte** (Quelle `wikisync`, unter dem Namen der Person, die es ausgelöst hat), in derselben Transaktion wie der Stand des Syncs (`wikisync_objekt`). Nichts zu tun ist keine
 *   Operation: kein Eintrag im Verlauf, keine Revision, kein Ereignis `map.changed`; der Stand sagt dann „keine Änderung“.
 * - **Nur wo der Bereich dem WikiSync gehört** (jeder Bereich mit angeschlossener Übernahme, fest, `wikisyncBereiche`): Sonst schreibt der Sync die Wiki-Felder nicht.
 */

/** Die Planzeilen eines Objekts als Zeilen der Übernahme: nur Felder (die Befunde zu neuen Artikeln gehören nicht dazu). */
export function alsUebernahmeZeilen(zeilen: readonly PlanZeile[]): VorschauZeile[] {
    return zeilen.flatMap((zeile, index): VorschauZeile[] =>
        zeile.feld === null
            ? []
            : [
                  {
                      id: index + 1,
                      bereich: zeile.bereich,
                      objektArt: zeile.objektArt,
                      objektId: zeile.objektId,
                      objektName: zeile.objektName,
                      objekte: zeile.objekte,
                      objektIds: zeile.objektIds,
                      artikel: zeile.artikel,
                      feld: zeile.feld,
                      alt: zeile.alt,
                      altZustand: zeile.altZustand,
                      neu: zeile.neu,
                      neuZustand: zeile.neuZustand,
                      eigentuemer: zeile.eigentuemer,
                      wirkung: zeile.wirkung,
                  },
              ],
    );
}

export interface ObjektRechnung {
    zeilen: VorschauZeile[];
    /** Wie viele Objekte des Bereichs an dem Artikel hängen (nach der Einschränkung auf die Kennungen des Objekts). */
    objekte: number;
}

/**
 * Die Zeilen für EIN Objekt: der Vergleich der Seite mit den Objekten des Bereichs, die zu den Kennungen gehören. REIN: keine Datenbank, keine Anfrage.
 * Zeilen, die Objekte außerhalb der Kennungen nennen, kann es nicht geben (die Objekte sind schon eingeschränkt); sie würden sonst an fremden Objekten schreiben.
 */
export function rechneObjektZeilen(eingabe: {
    gefragt: string;
    seite: ApiSeite;
    weiterleitung: { von: string; nach: string } | null;
    /** Alle Objekte des Bereichs mit Zuordnung (`ladeObjekte`); eingeschränkt wird hier. */
    objekte: readonly PlanObjekt[];
    ids: readonly string[];
    tafel: WikiNamespaceTafel;
    wikisyncBereiche: ReadonlySet<WikisyncBereich>;
}): ObjektRechnung {
    const eigene = new Set(eingabe.ids);
    const objekte = eingabe.objekte.filter((objekt) => eigene.has(objekt.id));
    const ergebnis = rechneVergleich({
        gefragt: eingabe.gefragt,
        seite: eingabe.seite,
        weiterleitung: eingabe.weiterleitung,
        objekte,
        tafel: eingabe.tafel,
        wikisyncBereiche: eingabe.wikisyncBereiche,
    });
    const zeilen = alsUebernahmeZeilen(ergebnis.zeilen).map((zeile) => ({
        ...zeile,
        objektIds: zeile.objektIds.filter((id) => eigene.has(id)),
    }));
    return { zeilen: zeilen.filter((zeile) => zeile.objektIds.length > 0), objekte: ergebnis.objekte };
}

export interface ObjektAnwendung {
    /** Die Operation, die geschrieben wurde; `null`, wenn nichts zu schreiben war. */
    operationId: string | null;
    erfolg: ObjektErfolg;
    /** Wie viele Felder die Entscheidung als Befund liegen ließ (der Wert hat sich seit der Rechnung bewegt, der Name ist vergeben …). */
    befunde: number;
    /** Die Operation lief schon (derselbe Auftrag, wiederholt): nichts geschrieben, der Stand steht von damals. */
    wiederholt: boolean;
}

/**
 * Schreibt die Zeilen an dem einen Objekt und hält den Stand des Syncs fest, in EINER Transaktion. Wirft `UebernahmeAbgelehnt('gehoert_legacy')`, wenn der Bereich nicht (mehr) dem WikiSync gehört.
 * Nichts zu schreiben: kein Eingriff in die Karte, nur der Stand „keine Änderung“.
 */
export async function wendeObjektAn(
    db: Database,
    args: {
        art: WikiBoxArt;
        id: string;
        ids: readonly string[];
        titel: string;
        zeilen: readonly VorschauZeile[];
        actor: MapActor;
        mapDomainId: string;
        jobPublicId: string;
        wer: Ausloeser;
        wiki: WikiHerkunft;
    },
): Promise<ObjektAnwendung> {
    const schreiber = schreiberFuer(args.art);
    if (schreiber === undefined) {
        throw new UebernahmeAbgelehnt("nicht_angeschlossen", "Für diese Art gibt es noch keine Übernahme.");
    }
    const alle = (erfolg: ObjektErfolg): Map<string, ObjektErfolg> => new Map(args.ids.map((id) => [id, erfolg]));
    const gemerkt: { erfolg?: ObjektErfolg; befunde?: number } = {};
    try {
        const quittung = await mapOperation(
            db,
            args.actor,
            {
                operationId: operationsKennung(args.jobPublicId, args.art, `objekt:${args.id}`),
                operation: "wikisync.objekt_sync",
                mapDomainId: args.mapDomainId,
                body: { art: args.art, id: args.id, titel: args.titel },
                source: "wikisync",
            },
            async (tx) => {
                // Der Besitz ist fest, wie bei der Übernahme eines Laufs.
                if (!(await wikisyncBereiche(tx)).has(args.art)) {
                    throw new UebernahmeAbgelehnt("gehoert_legacy", "Für diesen Bereich gibt es noch keine Übernahme.");
                }
                const geschrieben = await schreibeUnterSperre(tx, {
                    bereich: args.art,
                    schreiber,
                    zeilen: args.zeilen,
                    zahlenGrund: { zeilen: args.zeilen.length },
                });
                const erfolg = erfolgAusSchritten(geschrieben.schritte);
                gemerkt.erfolg = erfolg;
                gemerkt.befunde = geschrieben.befunde.length;
                await merkeErfolge(tx, args.art, alle(erfolg), args.wer, {
                    wiki: args.wiki,
                    jobPublicId: args.jobPublicId,
                });
                return {
                    receipt: {
                        affected: [
                            ...geschrieben.beruehrt.map((id) => ({
                                kind: schreiber.affectedArt,
                                id,
                                revision: geschrieben.revisionNach.get(id) ?? 0,
                            })),
                            ...geschrieben.folgen.affected,
                        ],
                        derivedWork: [],
                        warnings: [],
                    },
                    entries: geschrieben.entries,
                    summary: `Wiki-Box: ${String(geschrieben.titel.felder)} Felder aus dem Wiki übernommen (Sync am Objekt)`,
                    ...(schreiber.leitetAb?.(geschrieben.schritte) === false ? { ableitung: false as const } : {}),
                };
            },
        );
        if (gemerkt.erfolg === undefined) {
            // Dieselbe Kennung lief schon: Die Operation steht, ihr Stand ebenfalls.
            return {
                operationId: quittung.operationId,
                erfolg: { ergebnis: "keine_aenderung", felder: [], anzahl: 0 },
                befunde: 0,
                wiederholt: true,
            };
        }
        return {
            operationId: quittung.operationId,
            erfolg: gemerkt.erfolg,
            befunde: gemerkt.befunde ?? 0,
            wiederholt: false,
        };
    } catch (fehler) {
        if (!(fehler instanceof KeineAenderung)) throw fehler;
        const erfolg: ObjektErfolg = { ergebnis: "keine_aenderung", felder: [], anzahl: 0 };
        await merkeErfolge(db, args.art, alle(erfolg), args.wer, { wiki: args.wiki, jobPublicId: args.jobPublicId });
        return { operationId: null, erfolg, befunde: fehler.befunde.length, wiederholt: false };
    }
}
