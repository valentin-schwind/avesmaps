import {
    BESUCH_LISTE_GRENZE,
    heutigeDimension,
    WETTER_BILDRATE_KLASSEN,
    WETTER_FEHLER_ARTEN,
    WETTER_GERAETE,
    WETTER_GPU_FAMILIEN,
    WETTER_SPITZE_KLASSEN,
    WETTER_START_KLASSEN,
    type BesuchSorte,
    type BesuchZahlen,
} from "@avesmaps3d/shared";
import type { Queryable } from "../database.ts";
import {
    DAUER_OHNE,
    LIVE_FENSTER_MINUTEN,
    METRIK_AUTOMAT_GRUND,
    METRIK_GLEICHZEITIG,
    METRIK_KOPF,
    type ZaehlSorte,
} from "./zaehler.ts";

/**
 * Der Leseweg des Panels (WI-0138, BESUCH-0001 §6). Alles kommt aus Summen; es gibt nichts Feineres zu lesen.
 *
 * 🔴 **Editoren werden nie aufsummiert.** Derselbe Editor kommt an vielen Tagen vor; eine Summe über 30 Tage läse sich wie eine
 * Belegschaft. Aus Tagessummen ist „wie viele verschiedene Editoren im Zeitraum“ nicht zu gewinnen — der höchste Tageswert ist die
 * Zahl, die wir ehrlich haben, und deshalb steht „bis“ davor (Legacys eigene Begründung, `review-visitor-analytics.js:660-664`).
 *
 * 🔴 **Ein Editor ist ein Kopf, kein Gerät** (Vali 2026-11-11: „wir sind nur 11“, die Kachel zeigte „bis 22“). Gelesen wird
 * `METRIK_KOPF`, nie mehr `unique` der Editoren: Das zählte Geräte, in Legacy wie bei uns. Tage vor der ersten Kopfzeile sind
 * „nicht gezählt“ (`null`), so wie `gleichzeitig` vor WI-0213.
 */

interface SummenZeile {
    metric: string;
    dimension: string;
    count: string;
}

const zahl = (wert: string | number | null): number => (wert === null ? 0 : Math.round(Number(wert)));

/**
 * Alle Ausprägungen einer Metrik, absteigend, ungekürzt.
 *
 * 🪤 **Zusammengefasst wird VOR dem Kürzen.** Legacys `deregraphic` und unser `standard` sind dieselbe Ansicht
 * (`heutigeDimension`); erst addieren, dann die höchsten nehmen. Umgekehrt stünden beide als eigene Zeile da und
 * könnten beide knapp aus der Spitze fallen, obwohl ihre Summe die Liste anführt.
 */
function alleEintraege(zeilen: readonly SummenZeile[], metrik: string): { name: string; wert: number }[] {
    const summen = new Map<string, number>();
    for (const zeile of zeilen) {
        if (zeile.metric !== metrik || zeile.dimension === "") continue;
        const name = heutigeDimension(metrik, zeile.dimension);
        summen.set(name, (summen.get(name) ?? 0) + zahl(zeile.count));
    }
    return [...summen].map(([name, wert]) => ({ name, wert })).sort((a, b) => b.wert - a.wert);
}

/**
 * Die Liste zu einer Metrik: die höchsten `grenze` Einträge und wie viele Ausprägungen es insgesamt gab (WI-0191).
 *
 * `gesamt` zählt die Ausprägungen, nicht die Besuche — es ist die Zahl, die das Panel im offenen Block nennt, wenn mehr
 * da war, als mitkommt.
 */
function liste(
    zeilen: readonly SummenZeile[],
    metrik: string,
    grenze = BESUCH_LISTE_GRENZE,
): { eintraege: { name: string; wert: number }[]; gesamt: number } {
    const alle = alleEintraege(zeilen, metrik);
    return { eintraege: alle.slice(0, grenze), gesamt: alle.length };
}

/**
 * Die Summe einer Metrik, die **für sich steht** (Art `leer`): `tilt`, `flight`, `profile`, `play`, `share_create`,
 * `search_empty`.
 *
 * 🔴 **Warum `liste` das nicht kann** (WI-0159): Sie überspringt die leere Ausprägung (`dimension === ""`) — richtig, denn eine
 * Liste zeigt Ausprägungen, und die leere hat keinen Namen. Der Block „3D“ wurde aber mit `liste(summen, "tilt", 1)` gebaut und
 * blieb darum **immer leer**, auch für `tilt` und `share_create`, die seit WI-0138 Sender haben. Vier neue Sender hätten daran
 * nichts geändert: Die Zeilen entstanden, der Block zeigte sie nicht.
 */
function summeVon(zeilen: readonly SummenZeile[], metrik: string): number {
    return zeilen.filter((zeile) => zeile.metric === metrik).reduce((summe, zeile) => summe + zahl(zeile.count), 0);
}

/**
 * Eine Zeile des Blocks „3D“, oder keine: Was nie geschah, steht nicht als „0“ da (so hält es auch `liste`). Die Zeile trägt einen
 * Schlüssel, ihren Namen gibt das Panel in der Sprache der Oberfläche (`statistik-namen.ts`).
 */
function dreidZeile(name: string, wert: number): { name: string; wert: number }[] {
    return wert > 0 ? [{ name, wert }] : [];
}

/**
 * Die Stufen aufsteigend, dazu Median und Mittel (WI-0286). Eine Stufe ist eine Zahl, darum rechnet das Mittel über sie selbst; es
 * trägt eine Nachkommastelle, denn „Mittel 5“ sagte weniger, als die Zahlen hergeben.
 */
function zoomAus(zeilen: readonly SummenZeile[]): BesuchZahlen["zoom"] {
    const stufen = alleEintraege(zeilen, "zoom_stufe").sort((a, b) => Number(a.name) - Number(b.name));
    const ruhen = stufen.reduce((summe, stufe) => summe + stufe.wert, 0);
    const summe = stufen.reduce((lauf, stufe) => lauf + Number(stufe.name) * stufe.wert, 0);
    return {
        ruhen,
        median: medianAus(stufen),
        mittel: ruhen > 0 ? Math.round((summe / ruhen) * 10) / 10 : null,
        stufen,
    };
}

/** Die Zählkennungen der Wetterschalter beginnen so (`wetterSchalterKennung`); im Block „Wetter“, nicht unter den übrigen Schaltern. */
const WETTER_SCHALTER = "wetter_";

/**
 * Die Schalter des Anzeigemenüs, getrennt nach Wetter und allem anderen (WI-0288). Das Wetter hat einen eigenen Block; unter den
 * übrigen Schaltern stünde es doppelt und schöbe die Ortsklassen aus der Spitze.
 */
function schalterListe(zeilen: readonly SummenZeile[], wetter: boolean): ReturnType<typeof liste> {
    const eigene = zeilen.filter(
        (zeile) => zeile.metric !== "display_toggle" || zeile.dimension.startsWith(WETTER_SCHALTER) === wetter,
    );
    return liste(eigene, "display_toggle");
}

/**
 * Eine Verteilung des Wetters: `gerät:klasse`, zuerst nach Gerät, dann in der Reihenfolge der Klassen (aufsteigend). Was nicht in der
 * festen Menge steht, kommt hinten dran, damit nichts still verschwindet. Nicht nach Häufigkeit sortiert, wie die übrigen Listen:
 * Eine Bildrate liest sich nur als Verteilung, und eine wandernde Reihenfolge läse sich wie ein Ranking.
 */
function wetterVerteilung(
    zeilen: readonly SummenZeile[],
    metrik: string,
    klassen: readonly string[],
): ReturnType<typeof ganz> {
    const rang = (name: string): number => {
        const [geraet = "", klasse = ""] = name.split(":");
        const g = WETTER_GERAETE.indexOf(geraet as (typeof WETTER_GERAETE)[number]);
        const k = klassen.indexOf(klasse);
        return (g === -1 ? 9 : g) * 1000 + (k === -1 ? 999 : k);
    };
    return ganz(
        alleEintraege(zeilen, metrik).sort((a, b) => rang(a.name) - rang(b.name) || a.name.localeCompare(b.name)),
    );
}

/** Eine Liste, die schon vollständig ist: Sie trägt dieselbe Hülle wie die gekürzten, damit das Panel nur eine Form kennt. */
function ganz(eintraege: { name: string; wert: number }[]): {
    eintraege: { name: string; wert: number }[];
    gesamt: number;
} {
    return { eintraege, gesamt: eintraege.length };
}

/** Der Median aus den Körben: die Untergrenze des Korbs, in dem die Hälfte erreicht ist. */
function medianAus(koerbe: readonly { name: string; wert: number }[]): number | null {
    const gesamt = koerbe.reduce((summe, korb) => summe + korb.wert, 0);
    if (gesamt === 0) return null;
    let lauf = 0;
    for (const korb of [...koerbe].sort((a, b) => Number(a.name) - Number(b.name))) {
        lauf += korb.wert;
        if (lauf >= gesamt / 2) return Number(korb.name);
    }
    return null;
}

/**
 * Die Zahlen des Panels für eine Sorte und einen Zeitraum.
 *
 * 🔴 **`ohneKurz`: Besuche unter 10 s ausblenden** (OPS-000118). Gelesen wird dann `visitor_lang` statt `visitor`, für jede Kennzahl, jedes
 * Diagramm und jede Liste; Anwesenheit und Tagesspitze bleiben, sie sind kein Zeitraum. Gefilterte Zahlen gibt es erst seit dem ersten Tag
 * mit einer `visitor_lang`-Zeile: Der Zeitraum beginnt dann dort, statt davor ungefilterte Tage oder erfundene Nullen zu zeigen.
 */
export async function leseZahlen(
    sql: Queryable,
    sorte: BesuchSorte,
    tage: number,
    kennungAktiv: boolean,
    optionen: { ohneKurz?: boolean } = {},
): Promise<BesuchZahlen> {
    const spanne = Math.max(1, Math.min(3660, Math.round(tage)));
    const gefiltert = optionen.ohneKurz === true && sorte === "visitor";
    const quelle: ZaehlSorte = gefiltert ? "visitor_lang" : sorte;
    const [filterZeile] = gefiltert
        ? await sql<
              { ab: string | null }[]
          >`SELECT MIN(day)::text AS ab FROM visitor_metric WHERE actor_type = 'visitor_lang'`
        : [];
    const filterAb = filterZeile?.ab ?? null;
    // Die untere Grenze jeder Abfrage: ungefiltert keine, gefiltert der erste gefilterte Tag, nie gefiltert gar kein Tag.
    const grenze = !gefiltert ? "-infinity" : (filterAb ?? "infinity");
    // Bei den Editoren SIND die Eindeutigen die Köpfe; ihr altes `unique` zählte Geräte und wird nicht mehr gelesen.
    const eindeutigMetrik = sorte === "editor" ? METRIK_KOPF : "unique";

    // Seit wann Köpfe gezählt werden: der erste Tag mit einer Kopfzeile, auf jeder Umgebung ihr eigener. Davor heißt „nicht gezählt“.
    const [kopfZeile] = await sql<{ ab: string | null }[]>`
        SELECT MIN(day)::text AS ab FROM visitor_metric WHERE metric = ${METRIK_KOPF} AND actor_type = 'editor'
    `;
    const kopfAb = kopfZeile?.ab ?? null;
    const gezaehlt = (tag: string): boolean => kopfAb !== null && tag >= kopfAb;

    // Der Verlauf: je Tag Aufrufe, Eindeutige, Routen - dazu die Editorenköpfe desselben Tages aus der anderen Sorte und die
    // Tagesspitze der Anwesenden (WI-0213; ein Höchstwert, darum MAX und ohne COALESCE: NULL heißt „an dem Tag nie gemessen“).
    const verlaufZeilen = await sql<
        {
            tag: string;
            aufrufe: string;
            eindeutige: string;
            routen: string;
            editoren: string;
            gleichzeitig: string | null;
        }[]
    >`
        SELECT day::text AS tag,
               COALESCE(SUM(count) FILTER (WHERE metric = 'pageview' AND actor_type = ${quelle}), 0)::text AS aufrufe,
               COALESCE(SUM(count) FILTER (WHERE metric = ${eindeutigMetrik} AND actor_type = ${quelle}), 0)::text AS eindeutige,
               COALESCE(SUM(count) FILTER (WHERE metric = 'route' AND actor_type = ${quelle}), 0)::text AS routen,
               COALESCE(SUM(count) FILTER (WHERE metric = ${METRIK_KOPF} AND actor_type = 'editor'), 0)::text AS editoren,
               (MAX(count) FILTER (WHERE metric = ${METRIK_GLEICHZEITIG} AND actor_type = ${sorte}))::text AS gleichzeitig
        FROM visitor_metric
        WHERE day >= CURRENT_DATE - ${spanne - 1}::int AND day >= ${grenze}::text::date
        GROUP BY day
        ORDER BY day
    `;
    const verlauf = verlaufZeilen.map((zeile) => ({
        tag: zeile.tag,
        aufrufe: zahl(zeile.aufrufe),
        eindeutige: sorte !== "editor" || gezaehlt(zeile.tag) ? zahl(zeile.eindeutige) : null,
        editoren: gezaehlt(zeile.tag) ? zahl(zeile.editoren) : null,
    }));

    const aufrufe = verlaufZeilen.reduce((summe, zeile) => summe + zahl(zeile.aufrufe), 0);
    const routen = verlaufZeilen.reduce((summe, zeile) => summe + zahl(zeile.routen), 0);
    // Mittel und bester Tag nur über Tage, an denen gezählt wurde; ein ungezählter Tag ist keine Null.
    const eindeutigeTage = verlauf.flatMap((tag) => (tag.eindeutige === null ? [] : [tag.eindeutige]));
    const eindeutigeSumme = eindeutigeTage.reduce((summe, wert) => summe + wert, 0);
    const besterTag = eindeutigeTage.reduce((hoechst, wert) => Math.max(hoechst, wert), 0);
    /** Der jüngste Tag, an dem `wert` seinen Höchstwert hat; ohne Zeilen `null`. */
    const tagDerSpitze = <Zeile extends { tag: string }>(zeilen: readonly Zeile[], wert: (zeile: Zeile) => number) =>
        zeilen.reduce<{ tag: string | null; wert: number }>(
            (spitze, zeile) => (wert(zeile) >= spitze.wert ? { tag: zeile.tag, wert: wert(zeile) } : spitze),
            { tag: null, wert: -1 },
        ).tag;
    const koepfe = verlauf.flatMap((tag) => (tag.editoren === null ? [] : [tag.editoren]));
    const editorenSpitze = koepfe.length > 0 ? Math.max(...koepfe) : null;
    // Begann die Zählung erst im Zeitraum, sagt die Kachel, seit wann; sonst ist der ganze Zeitraum gezählt.
    const editorenAb = kopfAb !== null && verlauf.length > 0 && kopfAb > verlauf[0]!.tag ? kopfAb : null;
    const gemessen = verlaufZeilen.filter((zeile) => zeile.gleichzeitig !== null);
    const gleichzeitigSpitze =
        gemessen.length > 0
            ? gemessen.reduce((hoechst, zeile) => Math.max(hoechst, zahl(zeile.gleichzeitig)), 0)
            : null;

    // Der gleich lange Zeitraum davor, für den Vergleich.
    const [davor] = await sql<{ aufrufe: string }[]>`
        SELECT COALESCE(SUM(count), 0)::text AS aufrufe FROM visitor_metric
        WHERE metric = 'pageview' AND actor_type = ${quelle}
          AND day >= CURRENT_DATE - ${spanne * 2 - 1}::int AND day < CURRENT_DATE - ${spanne - 1}::int
          AND day >= ${grenze}::text::date
    `;
    const vorher = zahl(davor?.aufrufe ?? null);

    // Die Tafel der aktivsten Zeiten: sieben Zeilen ab Montag.
    const tafelZeilen = await sql<{ wochentag: string; stunde: string; anzahl: string }[]>`
        SELECT EXTRACT(ISODOW FROM day)::int::text AS wochentag, hour::text AS stunde, SUM(count)::text AS anzahl
        FROM visitor_metric
        WHERE metric = 'pageview' AND actor_type = ${quelle} AND hour < 24
          AND day >= CURRENT_DATE - ${spanne - 1}::int AND day >= ${grenze}::text::date
        GROUP BY 1, 2
    `;
    const tafel = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0));
    for (const zeile of tafelZeilen) {
        const zeilenNummer = Number(zeile.wochentag) - 1;
        const stunde = Number(zeile.stunde);
        if (zeilenNummer >= 0 && zeilenNummer < 7 && stunde >= 0 && stunde < 24) {
            tafel[zeilenNummer]![stunde] = zahl(zeile.anzahl);
        }
    }

    // Alle Ausprägungen des Zeitraums in einem Zug; die Listen entstehen daraus im Speicher.
    const summen = await sql<SummenZeile[]>`
        SELECT metric, dimension, SUM(count)::text AS count
        FROM visitor_metric
        WHERE actor_type = ${quelle} AND day >= CURRENT_DATE - ${spanne - 1}::int AND day >= ${grenze}::text::date
        GROUP BY metric, dimension
    `;

    // Die Körbe sind feste Stufen (`dauerKorb`), keine Rangliste: Sie werden nie gekürzt und tragen darum kein `gesamt`.
    // 🔴 Die Dauer entsteht aus der Anwesenheit, die nur `visitor` kennt; im Filter fällt der Korb unter 10 s weg. „Ohne Dauer“ (ein
    // einziges Lebenszeichen) steht für sich und geht weder in Median noch Mittel (OPS-000118).
    const dauerSummen = gefiltert
        ? await sql<SummenZeile[]>`
              SELECT metric, dimension, SUM(count)::text AS count
              FROM visitor_metric
              WHERE actor_type = ${sorte} AND metric = 'dauer'
                AND day >= CURRENT_DATE - ${spanne - 1}::int AND day >= ${grenze}::text::date
              GROUP BY metric, dimension
          `
        : summen;
    const alleKoerbe = alleEintraege(dauerSummen, "dauer");
    const ohneDauer = alleKoerbe.find((korb) => korb.name === DAUER_OHNE)?.wert ?? 0;
    const koerbe = alleKoerbe.filter((korb) => /^\d+$/.test(korb.name) && !(gefiltert && Number(korb.name) < 10));
    const sitzungen = koerbe.reduce((summe, korb) => summe + korb.wert, 0);
    const sekunden = koerbe.reduce((summe, korb) => summe + Number(korb.name) * korb.wert, 0);

    // Was der Filter ausblendet: dieselben Tage ungefiltert, gegen die gefilterten Aufrufe.
    const [ungefiltert] = gefiltert
        ? await sql<{ aufrufe: string }[]>`
              SELECT COALESCE(SUM(count), 0)::text AS aufrufe FROM visitor_metric
              WHERE metric = 'pageview' AND actor_type = ${sorte}
                AND day >= CURRENT_DATE - ${spanne - 1}::int AND day >= ${grenze}::text::date
          `
        : [];
    const gesamtUngefiltert = zahl(ungefiltert?.aufrufe ?? null);

    // Als Automat ausgeschlossen: ihre Aufrufe und warum (OPS-000118). Sie stehen in keiner Sicht der Besucher.
    const automaten = await sql<SummenZeile[]>`
        SELECT metric, dimension, SUM(count)::text AS count
        FROM visitor_metric
        WHERE actor_type = 'bot' AND metric IN ('pageview', ${METRIK_AUTOMAT_GRUND})
          AND day >= CURRENT_DATE - ${spanne - 1}::int AND day >= ${grenze}::text::date
        GROUP BY metric, dimension
    `;

    // 🔴 Die Anwesenheit zählt NUR die gewählte Sorte (Betreiber 2026-10-13: „1 davon editor, getrennt gezählt ist
    // irgendwie widersprüchlich"). `editoren` steht daneben als eigene Zahl und steckt in `gesamt` nicht drin - wie jede
    // andere Zahl dieses Unterreiters.
    const [jetztZeile] = await sql<
        { gesamt: string; aktiv: string; lesend: string; verborgen: string; editoren: string }[]
    >`
        SELECT COUNT(*) FILTER (WHERE actor_type = ${sorte})::text AS gesamt,
               COUNT(*) FILTER (WHERE actor_type = ${sorte} AND state = 'active')::text AS aktiv,
               COUNT(*) FILTER (WHERE actor_type = ${sorte} AND state = 'reading')::text AS lesend,
               COUNT(*) FILTER (WHERE actor_type = ${sorte} AND state = 'hidden')::text AS verborgen,
               COUNT(*) FILTER (WHERE actor_type = 'editor')::text AS editoren
        FROM visitor_live
        WHERE last_seen >= now() - ${`${LIVE_FENSTER_MINUTEN} minutes`}::interval
    `;

    const [speicherZeile] = await sql<{ zeilen: string; bytes: string }[]>`
        SELECT (SELECT COUNT(*) FROM visitor_metric)::text AS zeilen,
               (pg_total_relation_size('visitor_metric')
                + pg_total_relation_size('visitor_daily_seen')
                + pg_total_relation_size('visitor_live'))::text AS bytes
    `;

    return {
        sorte,
        tage: spanne,
        von: verlauf[0]?.tag ?? "",
        bis: verlauf.at(-1)?.tag ?? "",
        kennungAktiv,
        kennzahlen: {
            aufrufe,
            eindeutigeMittel:
                kennungAktiv && eindeutigeTage.length > 0 ? Math.round(eindeutigeSumme / eindeutigeTage.length) : null,
            routen,
            editorenSpitze,
            editorenAb,
            besterTag: kennungAktiv && eindeutigeTage.length > 0 ? besterTag : null,
            // Ein Datum nur zu einer echten Spitze: Bei 0 gibt es keinen Tag, an dem etwas war.
            besterTagAm: kennungAktiv && besterTag > 0 ? tagDerSpitze(verlauf, (tag) => tag.eindeutige ?? -1) : null,
            wachstum: vorher > 0 ? aufrufe / vorher - 1 : null,
            sucheLeer: summeVon(summen, "search_empty"),
            gleichzeitigSpitze,
            gleichzeitigAm:
                gleichzeitigSpitze !== null && gleichzeitigSpitze > 0
                    ? tagDerSpitze(gemessen, (zeile) => zahl(zeile.gleichzeitig))
                    : null,
        },
        verlauf,
        tafel,
        dauer: {
            sitzungen,
            median: medianAus(koerbe),
            mittel: sitzungen > 0 ? Math.round(sekunden / sitzungen) : null,
            koerbe,
            ohne: ohneDauer,
        },
        filter: gefiltert
            ? { ab: filterAb, ausgeblendet: gesamtUngefiltert - aufrufe, gesamt: gesamtUngefiltert }
            : null,
        ausgeschlossen: {
            aufrufe: summeVon(automaten, "pageview"),
            gruende: alleEintraege(automaten, METRIK_AUTOMAT_GRUND),
        },
        zoom: zoomAus(summen),
        // Das experimentelle Wetter (WI-0288). Ein Block, der Sender UND Leser UND Anzeige braucht: `wetter_lauf` hat keine leere Ausprägung,
        // sondern das Gerät, also trägt `liste` sie (anders als die Metriken der Art `leer`, siehe `summeVon`).
        wetter: {
            schalter: schalterListe(summen, true),
            lauf: wetterVerteilung(summen, "wetter_lauf", []),
            start: wetterVerteilung(summen, "wetter_start", WETTER_START_KLASSEN),
            bildrate: wetterVerteilung(summen, "wetter_bildrate", WETTER_BILDRATE_KLASSEN),
            spitze: wetterVerteilung(summen, "wetter_spitze", WETTER_SPITZE_KLASSEN),
            aufloesung: wetterVerteilung(
                summen,
                "wetter_aufloesung",
                Array.from({ length: 21 }, (_, i) => String(i * 5)),
            ),
            gpu: wetterVerteilung(summen, "wetter_gpu", WETTER_GPU_FAMILIEN),
            fehler: wetterVerteilung(summen, "wetter_fehler", WETTER_FEHLER_ARTEN),
        },
        listen: {
            land: liste(summen, "land"),
            region: liste(summen, "region"),
            einstieg: liste(summen, "einstieg"),
            geraet: liste(summen, "geraet"),
            system: liste(summen, "system"),
            browser: liste(summen, "browser"),
            zoomband: liste(summen, "zoom_band"),
            fenster: liste(summen, "fenster"),
            faehig: liste(summen, "faehig"),
            sprache: liste(summen, "sprache"),
            spracheEingestellt: liste(summen, "sprache_eingestellt"),
            theme: liste(summen, "theme"),
            ansicht: liste(summen, "map_mode"),
            untergrund: liste(summen, "map_style"),
            ebene: liste(summen, "eco_kind"),
            mittel: liste(summen, "transport"),
            option: liste(summen, "route_option"),
            orte: liste(summen, "route_waypoint"),
            routen: liste(summen, "route"),
            schalter: schalterListe(summen, false),
            suche: liste(summen, "search"),
            fehlschlag: liste(summen, "route_fail"),
            angesehen: liste(summen, "place_open"),
            // Jede dieser Metriken steht für sich und hat keine Ausprägung, also summiert `summeVon` sie (WI-0159: mit `liste`
            // blieb der Block leer). Die Reihenfolge ist die des Bauplans, nicht die Häufigkeit - die Zeilen beantworten
            // zusammen eine Frage („lohnt die dritte Dimension?"), und eine wandernde Reihenfolge läse sich wie ein Ranking.
            //
            // 🔴 2D und 3D teilen die Seitenaufrufe auf (WI-0286; Betreiber 2026-11-07: „wieviel die karte in 2D und in 3D
            // angesehen haben“). `tilt` zählt je Seitenaufruf einmal, sobald die Karte geneigt steht; was bleibt, blieb flach.
            // Vor dem Start der Zählung liegt Legacy, und das konnte gar nicht neigen: Seine Aufrufe stehen zu Recht unter 2D.
            dreid: ganz([
                ...dreidZeile("nur2d", Math.max(0, aufrufe - summeVon(summen, "tilt"))),
                ...dreidZeile("in3d", summeVon(summen, "tilt")),
                ...dreidZeile("flight", summeVon(summen, "flight")),
                ...dreidZeile("profile", summeVon(summen, "profile")),
                ...dreidZeile("play", summeVon(summen, "play")),
                ...dreidZeile("share_create", summeVon(summen, "share_create")),
            ]),
        },
        jetzt: {
            gesamt: zahl(jetztZeile?.gesamt ?? null),
            aktiv: zahl(jetztZeile?.aktiv ?? null),
            lesend: zahl(jetztZeile?.lesend ?? null),
            verborgen: zahl(jetztZeile?.verborgen ?? null),
            editoren: zahl(jetztZeile?.editoren ?? null),
            fensterMinuten: LIVE_FENSTER_MINUTEN,
        },
        speicher: { zeilen: zahl(speicherZeile?.zeilen ?? null), bytes: zahl(speicherZeile?.bytes ?? null) },
    };
}
