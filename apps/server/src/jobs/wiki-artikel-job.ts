import { WIKISYNC_BEREICHE, wikiNamespaceTafel } from "@avesmaps3d/shared";
import type { Database } from "../database.ts";
import { leseNamespaceTafel } from "../kanon/tafel.ts";
import { ausloeserVon } from "../wiki/abgleich/ablage.ts";
import { ladeObjekte } from "../wiki/abgleich/lokal.ts";
import { WIKISYNC_PARSER_VERSION } from "../wiki/abgleich/plan.ts";
import { wikisyncBereiche } from "../wiki/abgleich/schalter-lesen.ts";
import { legeVergleichAn, schliesseVergleich } from "../wiki/artikel/ablage.ts";
import { artikelTitelOk, normalisiereArtikelTitel } from "../wiki/artikel/titel.ts";
import { leseAntwort } from "../wiki/artikel/antwort.ts";
import { rechneVergleich } from "../wiki/artikel/vergleich.ts";
import type { WikiClientFuerAbfrage } from "./wiki-client.ts";
import { WikiTransportFehler } from "../wiki/transport/fehler.ts";
import { JobCancelled, JobFailure, JobStopped, type JobContext } from "./handlers.ts";
import { withJobDatabase } from "./job-database.ts";
import { erzeugeClientFuerAuftrag, fehlerText } from "./wiki-client.ts";
import { leseObjektEingabe, runWikiObjektSync, type ObjektEingabe } from "./wiki-objekt-sync.ts";

/**
 * Der Vergleich eines einzelnen Artikels als Auftrag: `wiki_artikel` (WI-0253 D-2, LEICHT; Betreiber 2026-10-25: „Einzelartikel: bleibt der Weg über die MediaWiki-API, eine Wiki-Anfrage ohne
 * Anmeldung, unabhängig vom Monats-Dump; das Ergebnis steht im Dump-Bericht“). Genau EINE Anfrage (`prop=revisions`, mit Weiterleitung) im gemeinsamen Takt von 20 Sekunden, anonym wie in Legacy; der Auftrag
 * wartet auf den Takt, der Klick in der Systemsteuerung nicht. Er schreibt in keine Fachtafel, nur den Vergleich (`wikisync_artikel`): die Planzeilen der Objekte, die an diesem Artikel hängen.
 *
 * Eingabe (`input_ref`), streng geprüft: `titel` (der Artikel, ohne `#<>[]|{}` und Steuerzeichen: `|` hängte sonst einen zweiten Titel an die Anfrage) und `ausgeloestVon` (der Name der Person).
 *
 * - **Lokal gesperrt:** Ohne Stage oder Production, echtes Release und Takt-Ordner entsteht kein Client (`wikiAbrufErlaubt`); der Auftrag endet mit `abruf_gesperrt`, bevor er eine Zeile anlegt.
 * - **Ein Fehler des Wikis ist ein Ergebnis, kein Absturz:** Ein 429, ein 403, eine Pause, ein verlorener Takt, ein Artikel, den es nicht gibt – der Vergleich steht mit seinem Grund da (`fehlgeschlagen`), und
 *   die Person fragt später erneut. Der Auftrag wiederholt nicht von selbst (kein Hämmern).
 * - **Kein Geheimnis:** Weder Zugangsdaten noch Cookies stehen im Ergebnis; der Auftrag meldet gar nicht erst an.
 */

export interface ArtikelEingabe {
    titel: string;
    ausgeloestVon: string | undefined;
    /** Der Sync an EINEM Objekt (Wiki-Box, `jobs/wiki-objekt-sync.ts`): nach dem Vergleich schreibt der Auftrag die wiki-eigenen Felder dieses Objekts. Fehlt es, bleibt es beim Vergleich. */
    objekt?: ObjektEingabe;
}

export function leseArtikelEingabe(input: Record<string, unknown>): ArtikelEingabe {
    const unbekannt = Object.keys(input).filter(
        (schluessel) => !["titel", "ausgeloestVon", "objekt"].includes(schluessel),
    );
    if (unbekannt.length > 0) {
        throw new JobFailure("input_invalid", `Wiki-Auftrag: unbekanntes Feld ${unbekannt.join(", ")}`, false);
    }
    const roh = input["titel"];
    if (typeof roh !== "string" || !artikelTitelOk(normalisiereArtikelTitel(roh))) {
        throw new JobFailure("input_invalid", 'Wiki-Auftrag: "titel" ist kein Artikeltitel', false);
    }
    const von = input["ausgeloestVon"];
    if (von !== undefined && (typeof von !== "string" || von.trim() === "" || von.length > 80)) {
        throw new JobFailure("input_invalid", 'Wiki-Auftrag: "ausgeloestVon" ist kein Name', false);
    }
    const objekt = input["objekt"] === undefined ? undefined : leseObjektEingabe(input["objekt"]);
    return {
        titel: normalisiereArtikelTitel(roh),
        ausgeloestVon: von,
        ...(objekt === undefined ? {} : { objekt }),
    };
}

export interface ArtikelAbhaengigkeiten {
    environment?: NodeJS.ProcessEnv;
    /** Der Wiki-Client; Tests geben einen, der auf den Testserver zeigt. Ohne Angabe entsteht der echte (und der ist lokal gesperrt). */
    client?: WikiClientFuerAbfrage;
    /** Die Datenbank des Auftrags (Jobs-Rolle); Tests geben ihre Verbindung. */
    mitDatenbank?: <T>(arbeit: (db: Database) => Promise<T>) => Promise<T>;
}

/**
 * `wiki_artikel`: eine Anfrage, der Vergleich mit den Objekten, die an dem Artikel hängen, abgelegt in `wikisync_artikel`. Das Ergebnis des Auftrags nennt die Nummer des Vergleichs, seinen Stand und die Zahl der
 * Zeilen; Seitentexte stehen nicht darin.
 */
export async function runWikiArtikelJob(
    context: JobContext,
    deps: ArtikelAbhaengigkeiten = {},
): Promise<Record<string, unknown>> {
    const eingabe = leseArtikelEingabe(context.input);
    if (eingabe.objekt !== undefined) {
        // Der Sync am Objekt (Wiki-Box): eine Anfrage, dann die Felder DIESES Objekts; kein Vergleich in `wikisync_artikel`.
        return runWikiObjektSync(context, { ...eingabe, objekt: eingabe.objekt }, deps);
    }
    const umgebung = deps.environment ?? process.env;
    // 🔴 Vor jeder Datenbankzeile: Lokal wirft der Erzeuger, es entsteht weder ein Vergleich noch eine Anfrage.
    const client = deps.client ?? erzeugeClientFuerAuftrag(umgebung);
    const mitDb = deps.mitDatenbank ?? withJobDatabase;

    await context.beginPhase("anfragen", 0.1);
    return mitDb(async (db) => {
        const [jobZeile] = await db<{ actor_ref: string | null }[]>`
            SELECT actor_ref FROM job WHERE public_id = ${context.job.publicId}::uuid
        `;
        const ausloeser = ausloeserVon(jobZeile?.actor_ref ?? null);
        const tafelStand = await leseNamespaceTafel(db);
        const id = await legeVergleichAn(db, {
            titel: eingabe.titel,
            parserVersion: WIKISYNC_PARSER_VERSION,
            tafelRevision: tafelStand.revision,
            jobPublicId: context.job.publicId,
            ausgeloestVon: ausloeser.von,
            ausgeloestLabel: eingabe.ausgeloestVon ?? ausloeser.label,
        });
        const scheitern = async (code: string, satz: string): Promise<Record<string, unknown>> => {
            await schliesseVergleich(db, id, { status: "fehlgeschlagen", fehlerCode: code, fehler: satz });
            return { vergleich: id, status: "fehlgeschlagen", fehlerCode: code, zeilen: 0 };
        };
        try {
            context.checkpoint();
            const antwort = await client.frage({
                action: "query",
                prop: "revisions",
                rvprop: "ids|timestamp|content",
                rvslots: "main",
                redirects: "1",
                titles: eingabe.titel,
            });
            context.checkpoint();
            await context.beginPhase("vergleichen", 0.7);
            const gelesen = leseAntwort(antwort);
            if (gelesen === undefined)
                return await scheitern("antwort_ungueltig", "Das Wiki hat keine Seite geliefert.");
            const { seite, weiterleitung } = gelesen;
            if (seite.invalid === true || typeof seite.title !== "string")
                return await scheitern("titel_ungueltig", "Das Wiki nimmt diesen Titel nicht.");
            if (seite.missing === true)
                return await scheitern("nicht_im_wiki", "Diesen Artikel gibt es im Wiki nicht.");
            const fassung = seite.revisions?.[0];
            const inhalt = fassung?.slots?.main?.content;
            if (typeof inhalt !== "string")
                return await scheitern("antwort_ungueltig", "Das Wiki hat keinen Text geliefert.");
            const ns = typeof seite.ns === "number" ? seite.ns : 0;
            // Die Quellen vergleichen die Publikationen mit den Produktseiten des ganzen Dumps; EIN Artikel hat sie nicht.
            const objekte = await ladeObjekte(
                db,
                WIKISYNC_BEREICHE.filter((bereich) => bereich !== "quelle"),
            );
            const ergebnis = rechneVergleich({
                gefragt: eingabe.titel,
                seite: { titel: seite.title, ns, text: inhalt },
                weiterleitung,
                objekte,
                tafel: tafelStand.revision === null ? wikiNamespaceTafel() : tafelStand.namensraeume,
                wikisyncBereiche: await wikisyncBereiche(db),
            });
            if (ergebnis.objekte === 0) {
                await schliesseVergleich(db, id, {
                    status: "fehlgeschlagen",
                    wikiTitel: seite.title,
                    wikiNamensraum: ns,
                    fehlerCode: "kein_objekt",
                    fehler: "An diesem Artikel hängt kein Objekt der Karte; es gibt nichts zu vergleichen.",
                });
                return { vergleich: id, status: "fehlgeschlagen", fehlerCode: "kein_objekt", zeilen: 0 };
            }
            const revid = typeof fassung?.revid === "number" ? fassung.revid : null;
            const zeit = typeof fassung?.timestamp === "string" ? new Date(fassung.timestamp) : null;
            await schliesseVergleich(db, id, {
                status: "fertig",
                wikiTitel: seite.title,
                wikiNamensraum: ns,
                wikiRevision: revid,
                wikiStand: zeit !== null && !Number.isNaN(zeit.getTime()) ? zeit : null,
                zeilen: ergebnis.zeilen,
                zahlen: ergebnis.zahlen,
            });
            return {
                vergleich: id,
                status: "fertig",
                bereiche: ergebnis.bereiche,
                objekte: ergebnis.objekte,
                zeilen: ergebnis.zeilen.length,
            };
        } catch (fehler) {
            if (fehler instanceof JobCancelled || fehler instanceof JobStopped) {
                await schliesseVergleich(db, id, {
                    status: "fehlgeschlagen",
                    fehlerCode: "abgebrochen",
                    fehler: "Abgebrochen",
                }).catch(() => undefined);
                throw fehler;
            }
            if (fehler instanceof WikiTransportFehler) return await scheitern(fehler.code, fehlerText(fehler));
            await schliesseVergleich(db, id, {
                status: "fehlgeschlagen",
                fehlerCode: "fehler",
                fehler: fehler instanceof Error ? fehler.message : String(fehler),
            }).catch(() => undefined);
            throw fehler;
        }
    });
}
