import {
    AVENTURIA,
    SUBJECT_LIMITS,
    WATER_CARTOGRAPHY_LAYER,
    mapPointRef,
    type LandscapeLayer,
    type MapPointDetail,
    type SubjectContext,
} from "@avesmaps3d/shared";
import { withStatementTimeout, type Database } from "../database.ts";
import { pointContext } from "./context.ts";
import { readNearby } from "./nearby.ts";
import { listLore, loreCarriersOf } from "./sections/lore.ts";
import { sprachenAmPunkt } from "../sprachen/an-der-stelle.ts";
import type { SubjectIndex } from "./subject-index.ts";

/**
 * Die freie Kartenstelle „Was ist hier?“ (WI-0063 4.9, 5.4): ein eigener Subject-Typ `mapPoint`. Er trägt die Koordinate in
 * `aventuria-v1`, auf 0,01 gerundet (zwei Druckstellen in derselben Hundertstel sind derselbe Subject), und den Kontext EXAKT am
 * Punkt: die Kette der Gebiete (alle Ebenen), die Landschaften, das Klimaband und die Flüsse im Umkreis, dazu „In der Nähe“
 * (`nearby.ts`, Legacys Auswahl der nächsten Orte und Wege). Es gibt nie eine erfundene Länge/Breite.
 *
 * 🔴 Keine zweite räumliche Semantik: Landschaften und Flüsse sind dieselbe Abfrage wie `/api/areas/at` (`queryAreasAt`), Gebiete
 * die abgeleiteten Formen derselben Kacheln.
 *
 * 🔴 **Nur die aktive Ansicht** (Nachtrag zu WI-0083, Betreiber 2026-10-05 „ja“: „‚Was ist hier?‘ nennt nur noch die aktive
 * Ansicht“). Vorher nannte der lange Druck alle Landschaften aller Ebenen - auch das Meer, während die Vegetation gewählt war.
 * `layers` sind die teilnehmenden Landschaftsebenen der Ansicht des Fragenden; **ohne Angabe bleibt es wie bisher** (alle
 * Ebenen, Flüsse im Umkreis), damit alte Links und fremde Aufrufer gültig bleiben.
 *
 * 🪤 **Dieselbe Regel, nicht eine zweite:** Die Liste kommt vom Client, und zwar aus genau der Tafel, aus der auch die
 * Karteninteraktion sie bekommt (`areaLayersInView`, `map/interaction/priorities.ts`). Hier wird NICHTS über Ansichten
 * entschieden - die Ebene am Treffer (`item.layer`) wird gegen die gereichte Liste gehalten, und die Flüsse hängen wie auf der
 * Karte an der Ebene des Wassers (`WATER_CARTOGRAPHY_LAYER`). Die räumliche Abfrage bleibt Wort für Wort dieselbe.
 *
 * 🪤 Gebietskette und Klimaband filtert die Ansicht NICHT: Sie sind keine Landschaftsebenen. Ein Gebiet ist auch heute nur in
 * der politischen Ansicht anklickbar und steht trotzdem in jeder Auskunft - es beschreibt die Stelle, nicht das Kartenbild.
 *
 * 🔴 **Und seit WI-0110 trägt die Stelle die VORKOMMEN der Flächen, die sie enthalten** (Nachfrage der Editoren 2026-10-08:
 * „‚Was ist hier‘ -> Vorkommen anzeigen? geht das?“). Gerechnet wird mit DERSELBEN Stelle wie überall sonst
 * (`loreCarriersOf` -> `LoreSpot`, WI-0103): ein Punkt ist der Punktfall, es gibt keine zweite Fassung. Ein Kartenpunkt hat
 * deshalb wie ein Weg nur „Aus der Region“ und den Link „Überall in Aventurien“.
 *
 * 🪤 **Die Vorkommen filtert die Ansicht ebenfalls nicht** - aus demselben Grund wie Gebietskette und Klimaband. Was in einer
 * Fläche vorkommt, beschreibt die Stelle; die Ansicht entscheidet nur, welche Landschaften GENANNT werden.
 *
 * 🪤 **Die Zeilen reisen in DIESER Antwort mit, nicht in einer zweiten Frage.** Ein Kartenpunkt hat keine Adresse für eine
 * Sektion (`subjectSectionUrl` gibt für ihn `null`) - dieselbe Lage wie bei der Routenetappe (WI-0106). Gemessen kostet es am
 * Punkt wenige Millisekunden; am Ort wäre es falsch (Median 47, bis 256 eigene Einträge, und dort gibt es eine Detailantwort,
 * in der die Zahl stehen kann).
 */
export async function mapPointDetail(
    database: Database,
    index: SubjectIndex,
    x: number,
    y: number,
    layers?: readonly LandscapeLayer[],
): Promise<MapPointDetail> {
    // Gerechnet wird am gerundeten Punkt: die Antwort ist eine Funktion des kanonischen Subjects.
    const subject = mapPointRef(x, y, layers);
    // Ein Fluss ist Wasser wie ein See und hängt damit an der Ebene des Wassers: Wo sie nicht teilnimmt, wird nicht gefragt.
    const rivers = layers === undefined || layers.includes(WATER_CARTOGRAPHY_LAYER as LandscapeLayer);
    const context = await pointContext(
        database,
        index,
        { x: subject.x, y: subject.y },
        "at_point",
        { rivers },
        SUBJECT_LIMITS.statementMs,
    );
    // ⭐ Nachbarn und Vorkommen laufen NEBENEINANDER (WI-0110, gemessen über 25 Läufe je Stelle): Beide lesen denselben
    // Punkt und wissen nichts voneinander. Hintereinander kostete die Auskunft am Gareth-Punkt 31,8 ms Median statt
    // 13,9 ms vorher, nebeneinander 20,8 ms. Drei Transaktionen je Kartenpunkt (mit den Sprachen, WI-0261) sind der Preis - und ein Kartenpunkt
    // entsteht aus einem KLICK, nicht aus einer Schleife (`AGENTS.md`, „Beim Ziehen wird nicht nachgeschlagen“).
    // 🔴 `statementMs` und nicht `geometryStatementMs`: Die Stelle ist ein PUNKT. Die Grenze für Linien steht an der
    // Etappe, weil dort Linie gegen Fläche in GEOS rechnet; hier ist es dieselbe Punktabfrage wie am Ort.
    const [nearby, lore, sprachen] = await Promise.all([
        withStatementTimeout(database, SUBJECT_LIMITS.statementMs, (transaction) =>
            readNearby(transaction, index, { x: subject.x, y: subject.y }),
        ),
        withStatementTimeout(database, SUBJECT_LIMITS.statementMs, async (transaction) =>
            listLore(
                transaction,
                index,
                await loreCarriersOf(transaction, index, "mapPoint", [], { x: subject.x, y: subject.y }),
                subject,
            ),
        ),
        // Die Sprachen der Stelle (WI-0261, Betreiber 2026-10-31): dieselbe Punktabfrage, die Zeile „Sprachen“ hinter „Regionen“.
        withStatementTimeout(database, SUBJECT_LIMITS.statementMs, (transaction) =>
            sprachenAmPunkt(transaction, AVENTURIA.mapDomain, { x: subject.x, y: subject.y }),
        ),
    ]);
    const inView = landscapesInView(context, layers);
    return {
        subject,
        revision: index.revision,
        ...(inView === undefined ? {} : { context: inView }),
        ...(nearby === undefined ? {} : { nearby }),
        // Ein Teil ohne Inhalt steht nicht in der Antwort (WI-0063 5.3).
        ...(lore.length === 0 ? {} : { lore }),
        ...(sprachen.length === 0 ? {} : { sprachen }),
    };
}

/**
 * Der Kontext mit den Landschaften der aktiven Ansicht. Ohne `layers` bleibt er, wie er kam; ein Teil ohne Inhalt steht nicht in
 * der Antwort (WI-0063 5.3), und bleibt nichts übrig, fehlt der Kontext ganz.
 */
function landscapesInView(
    context: SubjectContext | undefined,
    layers: readonly LandscapeLayer[] | undefined,
): SubjectContext | undefined {
    if (context === undefined || layers === undefined || context.landscapes === undefined) return context;
    const items = context.landscapes.items.filter((item) => layers.includes(item.layer as LandscapeLayer));
    const kept: SubjectContext = { ...context };
    if (items.length === 0) delete kept.landscapes;
    else kept.landscapes = { ...context.landscapes, items };
    return Object.keys(kept).length > 0 ? kept : undefined;
}
