import { AVENTURIA, UUID_PATTERN, WIKI_BOX_ARTEN, wikiNamespaceTafel, type WikiBoxArt } from "@avesmaps3d/shared";
import type { Database } from "../database.ts";
import { ApiError } from "../http/api-error.ts";
import { leseNamespaceTafel } from "../kanon/tafel.ts";
import { ladeObjekte } from "../wiki/abgleich/lokal.ts";
import { wikisyncBereiche } from "../wiki/abgleich/schalter-lesen.ts";
import { UebernahmeAbgelehnt } from "../wiki/abgleich/uebernahme/uebernehmen.ts";
import { leseAntwort } from "../wiki/artikel/antwort.ts";
import type { WikiClientFuerAbfrage } from "./wiki-client.ts";
import { rechneObjektZeilen, wendeObjektAn } from "../wiki/objekt/sync.ts";
import { merkeFehlschlag } from "../wiki/objekt/stand.ts";
import { PAUSE_403_MS, PAUSE_429_MIN_MS } from "../wiki/transport/konstanten.ts";
import { WikiTransportFehler } from "../wiki/transport/fehler.ts";
import { JobCancelled, JobFailure, JobStopped, type JobContext } from "./handlers.ts";
import { withJobDatabase } from "./job-database.ts";
import { erzeugeClientFuerAuftrag, fehlerText } from "./wiki-client.ts";
import { handelnder, umgebungVon } from "./wiki-uebernahme-jobs.ts";

/**
 * Der Sync EINES Objekts als Auftrag (WI-0253, Wiki-Box „Sync aktualisieren“): der Auftrag `wiki_artikel` mit einem Objekt in der Eingabe. Genau EINE Wiki-Anfrage (`prop=revisions`, mit Weiterleitung) im
 * gemeinsamen Takt von 20 Sekunden, anonym wie in Legacy; danach schreibt er die wiki-eigenen Felder DIESES Objekts mit den Schreibern der Übernahme (`wiki/objekt/sync.ts`) und hält Zeit, Ergebnis und
 * Auslöser fest (`wikisync_objekt`). Der Klick wartet nicht auf die Antwort; die Box fragt den Stand nach.
 *
 * Eingabe (`input_ref`): `titel` und `ausgeloestVon` wie beim Vergleich eines Artikels, dazu `objekt`: `{ art, id, ids }` (die Art, die Kennung, unter der die Oberfläche das Objekt kennt, und alle öffentlichen
 * Kennungen: ein Weg, eine Kraftlinie oder eine Landschaft besteht aus Abschnitten).
 *
 * - **Lokal gesperrt:** Ohne Stage oder Production, echtes Release und Takt-Ordner entsteht kein Client (`wikiAbrufErlaubt`); der Auftrag endet mit `abruf_gesperrt`, bevor er eine Zeile anlegt. Die Route sagt es
 *   schon vorher mit 409.
 * - **Ein Fehler des Wikis ist ein Ergebnis, kein Absturz:** Ein 429, ein 403, eine Pause, ein Artikel, den es nicht gibt – der Stand am Objekt hält den Grund fest (und bei einer Pause ihr Ende, damit die Box
 *   „Später erneut“ bis dahin sperrt), die Person fragt später erneut. Der Auftrag wiederholt nicht von selbst (kein Hämmern).
 * - **Handelt als die Person, die es ausgelöst hat** (`actor_ref`), nie als Agent.
 */

export interface ObjektEingabe {
    art: WikiBoxArt;
    id: string;
    ids: string[];
}

/** Höchstens so viele Kennungen trägt die Eingabe (eine Straße mit hunderten Abschnitten ist die Obergrenze der Wirklichkeit). */
export const OBJEKT_IDS_MAX = 500;

const UUID = new RegExp(UUID_PATTERN, "u");

/** Die Eingabe des Objekts, streng geprüft. */
export function leseObjektEingabe(wert: unknown): ObjektEingabe {
    const fehler = (satz: string): never => {
        throw new JobFailure("input_invalid", `Wiki-Auftrag: "objekt" ${satz}`, false);
    };
    if (typeof wert !== "object" || wert === null || Array.isArray(wert)) return fehler("ist kein Objekt");
    const roh = wert as Record<string, unknown>;
    const unbekannt = Object.keys(roh).filter((schluessel) => !["art", "id", "ids"].includes(schluessel));
    if (unbekannt.length > 0) return fehler(`kennt das Feld ${unbekannt.join(", ")} nicht`);
    const art = roh["art"];
    if (typeof art !== "string" || !(WIKI_BOX_ARTEN as readonly string[]).includes(art)) return fehler("hat keine Art");
    const id = roh["id"];
    if (typeof id !== "string" || !UUID.test(id)) return fehler("hat keine Kennung");
    const ids = roh["ids"];
    if (
        !Array.isArray(ids) ||
        ids.length === 0 ||
        ids.length > OBJEKT_IDS_MAX ||
        !ids.every((eintrag) => typeof eintrag === "string" && UUID.test(eintrag))
    ) {
        return fehler("hat keine Liste von Kennungen");
    }
    return { art: art as WikiBoxArt, id, ids: [...new Set(ids as string[])] };
}

export interface ObjektSyncAbhaengigkeiten {
    environment?: NodeJS.ProcessEnv;
    /** Der Wiki-Client; Tests geben einen, der auf den Testserver zeigt. Ohne Angabe entsteht der echte (und der ist lokal gesperrt). */
    client?: WikiClientFuerAbfrage;
    /** Die Datenbank des Auftrags (Jobs-Rolle); Tests geben ihre Verbindung. */
    mitDatenbank?: <T>(arbeit: (db: Database) => Promise<T>) => Promise<T>;
    jetzt?: () => number;
}

/** Bis wann das Wiki Ruhe will: das Ende der Pause, die der Transport nennt, sonst die kürzeste, die er selbst verhängt. */
function freiAbVon(fehler: WikiTransportFehler, jetzt: number): Date | null {
    if (fehler.code !== "pausiert" && fehler.code !== "http_429" && fehler.code !== "http_403") return null;
    const standard = fehler.code === "http_403" ? PAUSE_403_MS : PAUSE_429_MIN_MS;
    return new Date(fehler.bis ?? jetzt + standard);
}

export async function runWikiObjektSync(
    context: JobContext,
    eingabe: { titel: string; ausgeloestVon: string | undefined; objekt: ObjektEingabe },
    deps: ObjektSyncAbhaengigkeiten = {},
): Promise<Record<string, unknown>> {
    const umgebung = deps.environment ?? process.env;
    // 🔴 Vor jeder Datenbankzeile: Lokal wirft der Erzeuger, es entsteht weder ein Stand noch eine Anfrage.
    const client = deps.client ?? erzeugeClientFuerAuftrag(umgebung);
    const mitDb = deps.mitDatenbank ?? withJobDatabase;
    const jetzt = deps.jetzt ?? Date.now;
    const { objekt } = eingabe;

    await context.beginPhase("anfragen", 0.1);
    return mitDb(async (db) => {
        const scheitere = async (
            code: string,
            satz: string,
            freiAb: Date | null = null,
        ): Promise<Record<string, unknown>> => {
            await merkeFehlschlag(db, objekt.art, objekt.ids, { code, text: satz, freiAb }, context.job.publicId);
            return { status: "fehlgeschlagen", fehlerCode: code, art: objekt.art };
        };
        if (!(await wikisyncBereiche(db)).has(objekt.art)) {
            return scheitere("gehoert_legacy", "Für diesen Bereich gibt es noch keine Übernahme.");
        }
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
            await context.beginPhase("anwenden", 0.7);
            const gelesen = leseAntwort(antwort);
            if (gelesen === undefined)
                return await scheitere("antwort_ungueltig", "Das Wiki hat keine Seite geliefert.");
            const { seite, weiterleitung } = gelesen;
            if (seite.invalid === true || typeof seite.title !== "string")
                return await scheitere("titel_ungueltig", "Das Wiki nimmt diesen Titel nicht.");
            if (seite.missing === true)
                return await scheitere("nicht_im_wiki", "Diesen Artikel gibt es im Wiki nicht.");
            const fassung = seite.revisions?.[0];
            const inhalt = fassung?.slots?.main?.content;
            if (typeof inhalt !== "string")
                return await scheitere("antwort_ungueltig", "Das Wiki hat keinen Text geliefert.");
            const ns = typeof seite.ns === "number" ? seite.ns : 0;

            const tafelStand = await leseNamespaceTafel(db);
            const rechnung = rechneObjektZeilen({
                gefragt: eingabe.titel,
                seite: { titel: seite.title, ns, text: inhalt },
                weiterleitung,
                objekte: await ladeObjekte(db, [objekt.art]),
                ids: objekt.ids,
                tafel: tafelStand.revision === null ? wikiNamespaceTafel() : tafelStand.namensraeume,
                wikisyncBereiche: await wikisyncBereiche(db),
            });
            if (rechnung.objekte === 0) {
                return await scheitere("kein_objekt", "An diesem Artikel hängt dieses Objekt nicht (mehr).");
            }
            const revid = typeof fassung?.revid === "number" ? fassung.revid : null;
            const zeit = typeof fassung?.timestamp === "string" ? new Date(fassung.timestamp) : null;
            const wer = await handelnder(db, context.job.publicId, umgebungVon(umgebung));
            const angewendet = await wendeObjektAn(db, {
                art: objekt.art,
                id: objekt.id,
                ids: objekt.ids,
                titel: eingabe.titel,
                zeilen: rechnung.zeilen,
                actor: wer.actor,
                mapDomainId: context.job.mapDomainId ?? AVENTURIA.mapDomain,
                jobPublicId: context.job.publicId,
                wer: { von: wer.von, label: wer.label, automatisch: false },
                wiki: { revision: revid, stand: zeit !== null && !Number.isNaN(zeit.getTime()) ? zeit : null },
            });
            return {
                status: "fertig",
                art: objekt.art,
                ergebnis: angewendet.erfolg.ergebnis,
                felder: angewendet.erfolg.anzahl,
                befunde: angewendet.befunde,
                operation: angewendet.operationId,
                wiederholt: angewendet.wiederholt,
            };
        } catch (fehler) {
            if (fehler instanceof JobCancelled || fehler instanceof JobStopped) throw fehler;
            if (fehler instanceof WikiTransportFehler) {
                return await scheitere(fehler.code, fehlerText(fehler), freiAbVon(fehler, jetzt()));
            }
            if (fehler instanceof UebernahmeAbgelehnt) return await scheitere(fehler.grund, fehler.message);
            // Hält der Zug die Domäne (503) oder die Karte gerade jemand anders (Sperre), lohnt ein späterer Versuch des Auftrags.
            if (fehler instanceof ApiError)
                throw new JobFailure(fehler.code, fehler.message, fehler.statusCode === 503);
            throw fehler;
        }
    });
}
