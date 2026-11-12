<script setup lang="ts">
import { computed, onMounted, ref, shallowRef, watch } from "vue";
import {
    BAND_COUNT,
    BESUCH_ZAHLEN_URL,
    BESUCH_ZEITRAEUME,
    EDITORPANEL,
    WETTER_BILDRATE_KLASSEN,
    WETTER_GERAETE,
    WETTER_SPITZE_KLASSEN,
    WETTER_START_KLASSEN,
    kinder,
    type BesuchZahlen,
} from "@avesmaps3d/shared";
import { formatNumber, t, type MessageKey } from "../i18n/i18n";
import AvmKaestchen from "../controls/avm-kaestchen.vue";
import AvmKnopf from "../controls/avm-knopf.vue";
import AvmSegmente from "../controls/avm-segmente.vue";
import EditorStatusApi from "./editor-status-api.vue";
import type { ObjektZiel } from "../aenderungen/aenderung-modell";
import EditorStatusEditoren from "./editor-status-editoren.vue";
import EditorStatusServer from "./editor-status-server.vue";
import { navName, type EditorpanelId } from "./editor-panel-texte";
import { medianUndMittel, type Kennzahl } from "./wetter-histogramm";
import {
    ansichtMitEbenen,
    statistikWertName as wertName,
    wetterEinheit,
    wetterKlasseText,
    wetterWertName,
    type StatistikZeile,
    type WetterVerteilung,
} from "./statistik-namen";
import type { NavStand } from "./editor-panel-nav";
import type { LandZahlOrt } from "../besuch/de-bundeslaender-zahlen";

/**
 * Der Reiter „Status“ des Editorpanels: die anonyme Besucherstatistik (WI-0138, Bauplan BESUCH-0001; Legacys Reiter mit denselben
 * drei Unterreitern, `index.html:828-852`).
 *
 * - **Besucher und Editoren sind zwei Sorten derselben Ansicht** (Betreiber 2026-10-12: „editoren nicht als besucher mitgezählt
 *   bzw. klar getrennt“). Der Unterreiter wählt die Sorte; vermischt wird nie.
 * - **Zeiträume wie in Legacy**: 7 T · 30 T · 12 M · Alles.
 * - 🔴 **Ohne Schlüssel in der Umgebung bleibt „eindeutig“ unbekannt, nie 0** (`kennungAktiv`): Eine Kennung aus dem Quelltext wäre
 *   zurückrechenbar, und eine erfundene Null wäre schlimmer als eine fehlende Zahl.
 * - Die Zahlen sind Summen; es gibt nichts Feineres zu zeigen, und das ist der Punkt (Datenschutzfuß unten).
 */
const props = defineProps<{ nav: NavStand; rechte: readonly string[]; messwerteOffen?: boolean }>();
/** „lösen“ meldet nur: Das Messfenster ist ein Werkzeugfenster und gehört der Verwaltung in `app.vue` (WI-0128 E6). */
const emit = defineEmits<{ messwerte: []; zeigen: [ziel: ObjektZiel, id: string] }>();

/** Die Unterreiter als Segmente (Guide §13.25): ein späterer Eintrag steht gesperrt da, mit seinem Satz als Hinweis (D16). */
const unterreiter = computed(() =>
    kinder(EDITORPANEL, "status", props.rechte).map((eintrag) => ({
        value: eintrag.id,
        label: t(navName(eintrag.id as EditorpanelId)),
        gesperrt: eintrag.art === "spaeter",
        ...(eintrag.art === "spaeter" ? { hinweis: t("editorPanel.spaeter.satz") } : {}),
    })),
);
const sorte = computed({
    get: () => props.nav.gewaehlt("status") ?? "besucher",
    set: (id: string) => props.nav.waehle(id),
});
const tage = ref<number>(30);
/** Der Segmentschalter trägt Zeichenketten; gerechnet wird mit der Zahl. */
const zeitraum = computed({
    get: () => String(tage.value),
    set: (wert: string) => {
        tage.value = Number(wert);
    },
});
const zahlen = ref<BesuchZahlen | undefined>(undefined);
const laedt = ref(false);
const fehler = ref(false);
/**
 * Besuche unter 10 Sekunden ausblenden (OPS-000118, der Melder 2026-11-11). Gilt für jede Zahl des Zeitraums der Besucher, nicht für die
 * Anwesenheit; der Satz darunter sagt, dass er wirkt und wie viel er ausblendet.
 */
const ohneKurz = ref(false);

/**
 * Die Nummer der jüngsten Anfrage. 🔴 **Nur sie setzt die Zahlen** (Vali 2026-11-11: „7 T“ gewählt, darüber 2026-10-13 – 2026-11-11):
 * Der Reiter öffnet mit 30 Tagen, die auf der Stage 1,5 s brauchen, sieben Tage 30 ms. Wer gleich auf „7 T“ tippt, bekommt die Woche
 * zuerst, und die ältere Antwort überschrieb sie danach. Die Wahl stand, die Zahlen gehörten zu einer anderen.
 */
let abruf = 0;

async function hole(): Promise<void> {
    if (sorte.value === "api") return;
    const nummer = ++abruf;
    laedt.value = true;
    fehler.value = false;
    try {
        const sorteWert = sorte.value === "editoren" ? "editor" : "visitor";
        const filter = sorteWert === "visitor" && ohneKurz.value ? "&ohneKurz=true" : "";
        const antwort = await fetch(`${BESUCH_ZAHLEN_URL}?sorte=${sorteWert}&tage=${tage.value}${filter}`, {
            cache: "no-store",
            headers: { accept: "application/json" },
        });
        if (!antwort.ok) throw new Error(String(antwort.status));
        const neu = (await antwort.json()) as BesuchZahlen;
        if (nummer === abruf) zahlen.value = neu;
    } catch {
        if (nummer !== abruf) return;
        fehler.value = true;
        zahlen.value = undefined;
    } finally {
        if (nummer === abruf) laedt.value = false;
    }
}

onMounted(hole);
watch([sorte, tage, ohneKurz], hole);

/** Was der Filter tut, in einem Satz; ohne Filter nichts. */
const filterText = computed(() => {
    const filter = zahlen.value?.filter;
    if (!filter) return null;
    if (filter.ab === null) return t("statistik.filterLeer");
    return t("statistik.filterAktiv", {
        tag: filter.ab,
        anzahl: formatNumber(filter.ausgeblendet, 0),
        gesamt: formatNumber(filter.gesamt, 0),
    });
});

/** Die Gründe, aus denen ein Aufruf als Automat zählt (OPS-000118); ein unbekannter steht mit seinem Schlüssel da. */
const AUTOMAT_GRUND: Record<string, MessageKey> = {
    useragent: "statistik.automatGrund.useragent",
    rechenzentrum: "statistik.automatGrund.rechenzentrum",
    haeufung: "statistik.automatGrund.haeufung",
};

/** Als Automat ausgeschlossen: wie viele Aufrufe und warum. Ohne Ausschluss kein Satz. */
const ausgeschlossenText = computed(() => {
    const ausgeschlossen = zahlen.value?.ausgeschlossen;
    if (!ausgeschlossen || ausgeschlossen.aufrufe === 0) return null;
    const gruende = ausgeschlossen.gruende
        .map((grund) => (AUTOMAT_GRUND[grund.name] ? t(AUTOMAT_GRUND[grund.name]!) : grund.name))
        .join(", ");
    return t("statistik.ausgeschlossen", { anzahl: formatNumber(ausgeschlossen.aufrufe, 0), gruende });
});

/** `2026-10-06` wird zu `06.10.`; das Jahr steht schon im Kopf des Abschnitts. */
function tagKurz(iso: string): string {
    const teile = iso.split("-");
    return teile.length === 3 ? `${teile[2]}.${teile[1]}.` : iso;
}

const TAGESWORTE = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

/**
 * Die Aufteilung der Anwesenden (Betreiber 2026-10-13: „die halbkreise bei den besuchern machen keinen sinn. die
 * unterscheidung ist gut, aber es braucht keine halbkreise“).
 *
 * 🔴 Der Kreis ○ ◐ ● ist im Haus das Zeichen für „leer, teilweise, vollständig“ (Guide §13.17). Wer gerade liest, ist
 * aber nicht „halb anwesend“ - die drei Werte teilen eine Summe auf, sie steigern sich nicht. Deshalb stehen hier Zahl
 * und Wort, sonst nichts; die Reihenfolge geht von der größten Nähe zur Karte zur kleinsten.
 */
const jetztTeile = computed(() => {
    const jetzt = zahlen.value?.jetzt;
    if (!jetzt) return [];
    return [
        { wort: t("statistik.aktiv"), anzahl: jetzt.aktiv },
        { wort: t("statistik.lesend"), anzahl: jetzt.lesend },
        { wort: t("statistik.verborgen"), anzahl: jetzt.verborgen },
    ];
});

/** Der höchste Wert der Tafel; daran hängt die Tönung jeder Zelle. */
const tafelHoechst = computed(() => Math.max(1, ...(zahlen.value?.tafel.flat() ?? [0])));

/** Die drei Linien des Verlaufs als Pfade, auf die Breite des Panels gerechnet. */
const verlaufBild = computed(() => {
    const reihe = zahlen.value?.verlauf ?? [];
    if (reihe.length < 2) return undefined;
    const breite = 356;
    const hoehe = 92;
    const hoechst = Math.max(1, ...reihe.map((tag) => tag.aufrufe));
    // 🔴 Eigene Achse rechts (Legacys „Editorenskala rechts"): Editorenzahlen sind zwei Größenordnungen kleiner, in der
    // Besucherachse wären sie eine Linie am Boden. Die Skala steht rechts, in der Farbe ihrer Linie.
    const hoechstEditoren = Math.max(1, ...reihe.flatMap((tag) => (tag.editoren === null ? [] : [tag.editoren])));
    const schritt = breite / (reihe.length - 1);
    // 🔴 Ein ungezählter Tag (`null`, vor der Kopfzählung) trennt den Zug, statt ihn auf null zu ziehen - wie im Reiter „Server“.
    const pfad = (werte: readonly (number | null)[], grenze: number): string[] => {
        const zuege: string[] = [];
        let lauf: string[] = [];
        werte.forEach((wert, i) => {
            if (wert === null) {
                if (lauf.length > 1) zuege.push(lauf.join(" "));
                lauf = [];
                return;
            }
            lauf.push(`${(i * schritt).toFixed(1)},${(hoehe - (wert / grenze) * hoehe).toFixed(1)}`);
        });
        if (lauf.length > 1) zuege.push(lauf.join(" "));
        return zuege;
    };
    return {
        breite,
        hoehe,
        hoechst: Math.round(hoechst),
        hoechstEditoren,
        aufrufe: pfad(
            reihe.map((tag) => tag.aufrufe),
            hoechst,
        ),
        eindeutige: pfad(
            reihe.map((tag) => tag.eindeutige),
            hoechst,
        ),
        editoren: pfad(
            reihe.map((tag) => tag.editoren),
            hoechstEditoren,
        ),
        von: reihe[0]?.tag ?? "",
        mitte: reihe[Math.floor(reihe.length / 2)]?.tag ?? "",
        bis: reihe.at(-1)?.tag ?? "",
    };
});

/** Die Verweildauer in elf Balken; fein gespeichert, grob gezeigt. */
const dauerBalken = computed(() => {
    const koerbe = zahlen.value?.dauer.koerbe ?? [];
    if (koerbe.length === 0) return [];
    const schnitt: [number, number, string][] = [
        [0, 10, "<10s"],
        [10, 30, "30s"],
        [30, 60, "1m"],
        [60, 120, "2m"],
        [120, 180, "3m"],
        [180, 300, "5m"],
        [300, 480, "8m"],
        [480, 720, "12m"],
        [720, 1200, "20m"],
        [1200, 1800, "30m"],
        [1800, 3600, "1h"],
        [3600, Number.MAX_SAFE_INTEGER, "1h+"],
    ];
    const gesamt = koerbe.reduce((summe, korb) => summe + korb.wert, 0) || 1;
    return schnitt.map(([von, bis, wort]) => ({
        wort,
        anteil:
            koerbe
                .filter((korb) => Number(korb.name) >= von && Number(korb.name) < bis)
                .reduce((s, k) => s + k.wert, 0) / gesamt,
    }));
});

/** Sekunden als Uhrzeitspanne: „4:05“, ab einer Stunde „1:04:05“. */
function spanne(sekunden: number): string {
    const stunden = Math.floor(sekunden / 3600);
    const minuten = Math.floor((sekunden % 3600) / 60);
    const rest = String(sekunden % 60).padStart(2, "0");
    return stunden > 0 ? `${stunden}:${String(minuten).padStart(2, "0")}:${rest}` : `${minuten}:${rest}`;
}

const dauerText = computed(() => {
    const dauer = zahlen.value?.dauer;
    if (!dauer || dauer.sitzungen === 0) return t("statistik.ohneDaten");
    return t("statistik.dauerKopf", {
        median: String(dauer.median ?? 0),
        mittel: spanne(dauer.mittel ?? 0),
    });
});

/**
 * Die Kachel „Besuchszeit“ (WI-0213): Mittel und Median derselben Verweildauer wie im Block darunter, beide als Spanne.
 * Der Median ist die Untergrenze seines Korbs (`medianAus` im Leseweg), also auf zehn Sekunden bis fünf Minuten genau.
 */
const besuchszeitText = computed(() => {
    const dauer = zahlen.value?.dauer;
    if (!dauer || dauer.sitzungen === 0 || dauer.mittel === null || dauer.median === null) return "–";
    return `${spanne(dauer.mittel)} / ${spanne(dauer.median)}`;
});

/**
 * Die Kachel „Meiste gleichzeitig anwesend“ (WI-0213). `null` heißt „nie gemessen“ und steht als Strich, nie als 0. Darunter steht
 * der Tag der Spitze wie beim besten Tag (Betreiber 2026-10-19: „wir wollen hier das datum haben WANN die meisten gleichzeitig
 * anwesend waren“); die Uhrzeit ist nicht gespeichert.
 */
/** „bis 3“, oder ein Strich, wenn im Zeitraum nie Köpfe gezählt wurden (vor dem 2026-11-11 zählte die Reihe Geräte). */
const koepfe = computed(() => {
    const kennzahlen = zahlen.value?.kennzahlen;
    const spitze = kennzahlen?.editorenSpitze ?? null;
    return {
        zahl: spitze === null ? "–" : t("statistik.bis", { anzahl: formatNumber(spitze, 0) }),
        ab: kennzahlen?.editorenAb ? t("statistik.seit", { tag: kennzahlen.editorenAb }) : null,
    };
});

const gleichzeitig = computed(() => {
    const kennzahlen = zahlen.value?.kennzahlen;
    const spitze = kennzahlen?.gleichzeitigSpitze ?? null;
    return { zahl: spitze === null ? "–" : formatNumber(spitze, 0), am: kennzahlen?.gleichzeitigAm ?? null };
});

const wachstumText = computed(() => {
    const wachstum = zahlen.value?.kennzahlen.wachstum;
    if (wachstum === undefined || wachstum === null) return "–";
    return `${wachstum >= 0 ? "▲" : "▼"} ${Math.round(Math.abs(wachstum) * 100)} %`;
});

/** Legacys Sprossen als Segmente derselben Bauart. */
const zeitraeume = computed(() =>
    BESUCH_ZEITRAEUME.map((wert) => ({ value: String(wert), label: zeitraumName(wert) })),
);

const zeitraumName = (wert: number): string =>
    wert === 7 ? "7 T" : wert === 30 ? "30 T" : wert === 365 ? "12 M" : t("statistik.alles");

/**
 * Die Herkunftskarte (V8): Deutschland allein, weil nur dort die Auflösung unter dem Land liegt. Die Umrisse kommen erst,
 * wenn jemand den Reiter öffnet - auch 29 KB gehören nicht in das Bündel jeder Karte.
 */
const flaechen = shallowRef<readonly { code: string; name: string; d: string }[]>([]);
const zahlenOrte = shallowRef<Readonly<Record<string, LandZahlOrt>>>({});
const viewBox = ref("0 0 300 380");
onMounted(async () => {
    const [geo, orte] = await Promise.all([
        import("../besuch/de-bundeslaender"),
        import("../besuch/de-bundeslaender-zahlen"),
    ]);
    flaechen.value = geo.DE_BUNDESLAENDER;
    zahlenOrte.value = orte.DE_ZAHLEN_ORTE;
    viewBox.value = geo.DE_VIEWBOX;
});

const regionen = computed(
    () => new Map((zahlen.value?.listen.region.eintraege ?? []).map((eintrag) => [eintrag.name, eintrag.wert])),
);
const regionHoechst = computed(() => Math.max(1, ...regionen.value.values()));

/**
 * Wie oft dieses Bundesland gezählt wurde. Gesucht wird über die Kennung (NW), nicht über den Namen: Der Geodatensatz
 * schreibt je nach Quelle „Bavaria“ oder „Bayern“. Der Name bleibt als Rückfall, solange noch so gezählte Zeilen liegen.
 */
const regionWert = (land: { code: string; name: string }): number =>
    regionen.value.get(land.code) ?? regionen.value.get(land.name) ?? 0;

/** Die Zahl jedes Bundeslands an ihrem Ort auf der Karte (Betreiber 2026-11-03), auch die 0. */
const landZahlen = computed(() =>
    flaechen.value.flatMap((land) => {
        const ort = zahlenOrte.value[land.code];
        return ort ? [{ code: land.code, ort, text: formatNumber(regionWert(land), 0) }] : [];
    }),
);

/** Die Tönung einer Fläche: Wurzel, damit auch die kleinen Länder sichtbar bleiben. */
function flaecheTon(land: { code: string; name: string }): string {
    const wert = regionWert(land);
    if (wert === 0) return "var(--color-panel-soft)";
    const anteil = Math.sqrt(wert / regionHoechst.value);
    return `color-mix(in srgb, var(--color-chart1) ${Math.round(14 + anteil * 76)}%, var(--color-panel-soft))`;
}

/** Eine Liste als Balken; der höchste Wert füllt die Spur. */
function anteil(liste: readonly { name: string; wert: number }[], wert: number): string {
    const hoechst = Math.max(1, ...liste.map((eintrag) => eintrag.wert));
    return `${Math.max(3, (wert / hoechst) * 100)}%`;
}

/**
 * Das Histogramm „Wie nah herangegangen wird“ (WI-0286; Betreiber 2026-11-07): alle neun Stufen, auch leere, damit die Achse von
 * Zeitraum zu Zeitraum stehen bleibt. Der höchste Balken füllt die Höhe.
 *
 * Solange ein Zeitraum keine Stufe gesehen hat, bleibt der Block bei den drei alten Bändern (`zoom_band`).
 */
const zoomBalken = computed(() => {
    const stufen = zahlen.value?.zoom.stufen ?? [];
    if (stufen.length === 0) return [];
    const hoechst = Math.max(...stufen.map((stufe) => stufe.wert));
    return Array.from({ length: BAND_COUNT }, (_, stufe) => {
        const wert = stufen.find((eintrag) => Number(eintrag.name) === stufe)?.wert ?? 0;
        return { stufe, wert, anteil: wert / hoechst };
    });
});

/** Wo eine Stufe auf der Achse liegt: die Mitte ihres Balkens. */
const zoomLage = (stufe: number): string => `${((stufe + 0.5) / BAND_COUNT) * 100}%`;

/** Median und Mittel als Linien; das Wort der kleineren Zahl steht links ihrer Linie, das der größeren rechts, so stoßen sie nie an. */
const zoomMarken = computed(() => {
    const zoom = zahlen.value?.zoom;
    if (!zoom || zoom.median === null || zoom.mittel === null) return undefined;
    return {
        kopf: t("statistik.zoomKopf", { median: String(zoom.median), mittel: formatNumber(zoom.mittel, 1) }),
        median: zoomLage(zoom.median),
        mittel: zoomLage(zoom.mittel),
        medianLinks: zoom.median <= zoom.mittel,
    };
});

/** Ein Balkenblock; `ganz` zeigt alle Zeilen ohne den Knopf zum Ausklappen. */
interface StatistikBlock {
    schluessel: string;
    titel: string;
    liste: { eintraege: readonly StatistikZeile[]; gesamt: number };
    ganz?: boolean;
    /** Die Verteilung des Wetters, deren Ausprägungen `gerät:klasse` heißen (WI-0288); sonst gelten die allgemeinen Namen. */
    wetter?: WetterVerteilung;
}

/** Der Name einer Zeile: im Block „Wetter“ mit Einheit, sonst aus der allgemeinen Tafel. */
const zeilenName = (block: StatistikBlock, name: string): string =>
    block.wetter === undefined ? wertName(name) : wetterWertName(block.wetter, name);

/** Das Histogramm ersetzt die Liste seines Blocks samt Knopf. */
const istHistogramm = (block: StatistikBlock): boolean =>
    block.schluessel === "zoomband" && zoomBalken.value.length > 0;

/**
 * Die Zahlenwerte des Wetters als EIN Histogramm je Wert (Betreiber 2026-11-08: „kannst du bei den numerischen werten histogramme
 * machen?“, dann „du kannst gerne ein feineres binning und mehrere kategorien in einem histogramm (z.b. FPS in 10 ms schritte auf
 * Telefon, PC...)“): alle Klassen in fester Folge, auch leere, damit die Achse von Zeitraum zu Zeitraum stehen bleibt, wie beim Zoom;
 * je Klasse ein Balken je Gerät nebeneinander (Rechner links, Telefon rechts, dazu Farbe und Legende).
 *
 * - **Höhe ist der Anteil am eigenen Gerät**, nicht die Zahl: Telefone sind viel seltener, in absoluten Zahlen läge ihre Verteilung
 *   flach am Boden. Die Zahl und der Anteil stehen im Titel jedes Balkens, die Summe je Gerät in der Legende.
 * - **Die Achse nennt die Untergrenze** jeder Klasse („30“ für 30–40 fps), die letzte „120+“; die Wolkenauflösung (10 bis 100 %,
 *   `resMin` des Wettermodells ab 0,1) nur jede vierte, sonst stießen die Wörter an.
 */
const WETTER_HISTOGRAMM_KLASSEN: Partial<Record<WetterVerteilung, readonly string[]>> = {
    start: WETTER_START_KLASSEN,
    bildrate: WETTER_BILDRATE_KLASSEN,
    spitze: WETTER_SPITZE_KLASSEN,
    aufloesung: Array.from({ length: 19 }, (_, i) => String(10 + i * 5)),
};

/** Die Beschriftung einer Klasse auf der Achse: ihre Untergrenze, `u10` wird „0“, `ab120` „120+“, `2-3s` „2“. */
function wetterAchse(verteilung: WetterVerteilung, klasse: string): string {
    if (verteilung === "aufloesung") return Number(klasse) % 20 === 0 ? klasse : "";
    const treffer = /^(u|ab)?(\d+)/.exec(klasse);
    if (treffer === null) return klasse;
    return treffer[1] === "u" ? "0" : treffer[1] === "ab" ? `${treffer[2]!}+` : treffer[2]!;
}

interface WetterHistogramm {
    reihen: {
        geraet: string;
        name: string;
        summe: number;
        /** Median und Mittel, aus den Klassen geschätzt (`wetter-histogramm.ts`): Wert als Text, Lage als Anteil der Breite. */
        median: { text: string; links: string };
        mittel: { text: string; links: string };
    }[];
    spalten: {
        klasse: string;
        achse: string;
        balken: { geraet: string; anteil: number; titel: string }[];
    }[];
}

function wetterHistogramm(block: StatistikBlock): WetterHistogramm | undefined {
    const verteilung = block.wetter;
    const klassen = verteilung === undefined ? undefined : WETTER_HISTOGRAMM_KLASSEN[verteilung];
    if (verteilung === undefined || klassen === undefined) return undefined;
    const wert = (geraet: string, klasse: string): number =>
        block.liste.eintraege.find((eintrag) => eintrag.name === `${geraet}:${klasse}`)?.wert ?? 0;
    // Median und Mittel je Gerät (Betreiber 2026-11-08: „median und mittelwert ins histogramm … farbig für die kategorien“); Sekunden
    // mit einer Nachkommastelle, sonst ganze Zahlen.
    const stellen = verteilung === "start" ? 1 : 0;
    const reihen = WETTER_GERAETE.flatMap((geraet) => {
        const zahlen = klassen.map((klasse) => wert(geraet, klasse));
        const kennzahlen = medianUndMittel(klassen, zahlen, verteilung === "aufloesung");
        if (kennzahlen === undefined) return [];
        const kennzahl = (k: Kennzahl): { text: string; links: string } => ({
            text: formatNumber(k.wert, stellen),
            links: `${String((k.lage / klassen.length) * 100)}%`,
        });
        return [
            {
                geraet,
                name: wertName(geraet),
                summe: zahlen.reduce((a, b) => a + b, 0),
                median: kennzahl(kennzahlen.median),
                mittel: kennzahl(kennzahlen.mittel),
            },
        ];
    });
    if (reihen.length === 0) return undefined;
    const hoechst = Math.max(
        ...reihen.flatMap((reihe) => klassen.map((klasse) => wert(reihe.geraet, klasse) / reihe.summe)),
    );
    const einheit = wetterEinheit(verteilung);
    return {
        reihen,
        spalten: klassen.map((klasse) => ({
            klasse,
            achse: wetterAchse(verteilung, klasse),
            balken: reihen.map((reihe) => {
                const zahl = wert(reihe.geraet, klasse);
                const anteil = zahl / reihe.summe;
                return {
                    geraet: reihe.geraet,
                    anteil: anteil / hoechst,
                    titel: `${reihe.name} · ${wetterKlasseText(klasse)} ${einheit}: ${formatNumber(zahl, 0)} (${formatNumber(anteil * 100, 0)} %)`,
                };
            }),
        })),
    };
}

const istWetterHistogramm = (block: StatistikBlock): boolean => wetterHistogramm(block) !== undefined;

/**
 * Die Balkenblöcke in ihrer Reihenfolge (WI-0191: vorher stand diese Tafel als Ausdruck im Template, und ein Block hatte
 * keinen Namen, auf den sich etwas beziehen konnte). Der Schlüssel ist der Name im Vertrag, nicht die Aufschrift: Er
 * überlebt einen Sprachwechsel, die Aufschrift nicht.
 */
const bloecke = computed((): StatistikBlock[] => {
    const listen = zahlen.value?.listen;
    const wetter = zahlen.value?.wetter;
    if (listen === undefined || wetter === undefined) return [];
    const ansicht = ansichtMitEbenen(listen.ansicht.eintraege, listen.ebene.eintraege);
    const alle: StatistikBlock[] = [
        { schluessel: "land", titel: t("statistik.laender"), liste: listen.land },
        { schluessel: "einstieg", titel: t("statistik.einstieg"), liste: listen.einstieg },
        { schluessel: "geraet", titel: t("statistik.geraete"), liste: listen.geraet },
        { schluessel: "system", titel: t("statistik.system"), liste: listen.system },
        { schluessel: "browser", titel: t("statistik.browser"), liste: listen.browser },
        { schluessel: "fenster", titel: t("statistik.fensterBreite"), liste: listen.fenster },
        { schluessel: "faehig", titel: t("statistik.faehig"), liste: listen.faehig },
        { schluessel: "sprache", titel: t("statistik.sprache"), liste: listen.sprache },
        {
            schluessel: "spracheEingestellt",
            titel: t("statistik.spracheEingestellt"),
            liste: listen.spracheEingestellt,
        },
        { schluessel: "theme", titel: t("statistik.theme"), liste: listen.theme },
        // Ansichten und Ebenen stehen zusammen und nie gekürzt: Die Ebenen sind das, wonach dieser Block gefragt wird (WI-0286).
        {
            schluessel: "ansicht",
            titel: t("statistik.ansicht"),
            liste: { eintraege: ansicht, gesamt: ansicht.length },
            ganz: true,
        },
        { schluessel: "untergrund", titel: t("statistik.untergrund"), liste: listen.untergrund },
        { schluessel: "zoomband", titel: t("statistik.zoomband"), liste: listen.zoomband },
        { schluessel: "schalter", titel: t("statistik.schalter"), liste: listen.schalter },
        { schluessel: "suche", titel: t("statistik.suche"), liste: listen.suche },
        { schluessel: "angesehen", titel: t("statistik.angesehen"), liste: listen.angesehen },
        { schluessel: "fehlschlag", titel: t("statistik.fehlschlag"), liste: listen.fehlschlag },
        { schluessel: "orte", titel: t("statistik.orte"), liste: listen.orte },
        { schluessel: "routen", titel: t("statistik.routen"), liste: listen.routen },
        { schluessel: "mittel", titel: t("statistik.reisemittel"), liste: listen.mittel },
        { schluessel: "option", titel: t("statistik.option"), liste: listen.option },
        { schluessel: "dreid", titel: t("statistik.dreid"), liste: listen.dreid },
        // Das experimentelle Wetter (WI-0288): Schalter, Nutzung, Start, Bildrate, Spitzen, Auflösung, Grafikkarte, Fehler. Die Verteilungen
        // stehen geordnet nach Gerät und Klasse und ganz, nicht nach Häufigkeit gekürzt.
        { schluessel: "wetterSchalter", titel: t("statistik.wetter.schalter"), liste: wetter.schalter },
        { schluessel: "wetterLauf", titel: t("statistik.wetter.lauf"), liste: wetter.lauf, ganz: true, wetter: "lauf" },
        {
            schluessel: "wetterStart",
            titel: t("statistik.wetter.start"),
            liste: wetter.start,
            ganz: true,
            wetter: "start",
        },
        {
            schluessel: "wetterBildrate",
            titel: t("statistik.wetter.bildrate"),
            liste: wetter.bildrate,
            ganz: true,
            wetter: "bildrate",
        },
        {
            schluessel: "wetterSpitze",
            titel: t("statistik.wetter.spitze"),
            liste: wetter.spitze,
            ganz: true,
            wetter: "spitze",
        },
        {
            schluessel: "wetterAufloesung",
            titel: t("statistik.wetter.aufloesung"),
            liste: wetter.aufloesung,
            ganz: true,
            wetter: "aufloesung",
        },
        { schluessel: "wetterGpu", titel: t("statistik.wetter.gpu"), liste: wetter.gpu, ganz: true, wetter: "gpu" },
        {
            schluessel: "wetterFehler",
            titel: t("statistik.wetter.fehler"),
            liste: wetter.fehler,
            ganz: true,
            wetter: "fehler",
        },
    ];
    return alle.filter((block) => block.liste.eintraege.length > 0 || istHistogramm(block));
});

/**
 * Wie viele Einträge ein Block zeigt, solange er zu ist (WI-0191, Kanal OPS-000016). Acht sind Legacys Zahl und bleiben die
 * erste Ansicht; der Knopf darunter zeigt den Rest.
 */
const ERSTE = 8;

/**
 * Welche Blöcke offen stehen. 🔴 Der Zustand gehört der Ansicht, nicht dem Store: Er ist weder zu teilen noch zu merken, und
 * ein Store-Eintrag je Block wäre Buchhaltung über eine Handbewegung.
 */
const offeneBloecke = ref(new Set<string>());
function klappe(schluessel: string): void {
    const offen = new Set(offeneBloecke.value);
    if (!offen.delete(schluessel)) offen.add(schluessel);
    offeneBloecke.value = offen;
}
/** Die Einträge, die gerade zu sehen sind: acht, oder alle, die der Server geschickt hat. */
function sichtbare(block: StatistikBlock): readonly StatistikZeile[] {
    return block.ganz === true || offeneBloecke.value.has(block.schluessel)
        ? block.liste.eintraege
        : block.liste.eintraege.slice(0, ERSTE);
}
</script>

<template>
    <div class="statistik">
        <AvmSegmente v-model="sorte" :options="unterreiter" :label="t('statistik.sorten')" testid="statistik-sorte" />

        <AvmSegmente
            v-if="sorte !== 'server'"
            v-model="zeitraum"
            :options="zeitraeume"
            :label="t('statistik.zeitraumWahl')"
            testid="statistik-zeitraum"
        />
        <AvmKaestchen
            v-if="sorte === 'besucher'"
            art="checkbox"
            :checked="ohneKurz"
            testid="statistik-ohne-kurz"
            @change="(an: boolean) => (ohneKurz = an)"
            >{{ t("statistik.ohneKurz") }}</AvmKaestchen
        >
        <p v-if="sorte === 'besucher' && filterText" class="statistik__satz" data-testid="statistik-filter">
            {{ filterText }}
        </p>

        <EditorStatusApi v-if="sorte === 'api'" :tage="tage" />
        <EditorStatusServer
            v-else-if="sorte === 'server'"
            :aktiv="true"
            :geloest="props.messwerteOffen === true"
            @loesen="emit('messwerte')"
        />

        <p v-else-if="laedt && !zahlen" class="statistik__satz">{{ t("statistik.laedt") }}</p>
        <p v-else-if="fehler" class="statistik__satz">{{ t("statistik.fehler") }}</p>

        <template v-if="sorte !== 'api' && sorte !== 'server' && zahlen">
            <section class="statistik__block">
                <h3 class="statistik__titel">
                    {{ t("statistik.jetzt") }}
                    <span class="statistik__wert">{{
                        t("statistik.fenster", { minuten: String(zahlen.jetzt.fensterMinuten) })
                    }}</span>
                </h3>
                <div class="statistik__jetzt">
                    <p class="statistik__jetztKopf">
                        <span class="statistik__jetztZahl">{{ formatNumber(zahlen.jetzt.gesamt, 0) }}</span>
                        <span class="statistik__jetztWort">{{ t("statistik.anwesend") }}</span>
                    </p>
                    <dl class="statistik__teile">
                        <div v-for="teil in jetztTeile" :key="teil.wort" class="statistik__teil">
                            <dt class="statistik__teilWort">{{ teil.wort }}</dt>
                            <dd class="statistik__teilZahl">{{ formatNumber(teil.anzahl, 0) }}</dd>
                        </div>
                    </dl>
                    <p v-if="sorte !== 'editoren'" class="statistik__jetztSorte">
                        {{ t("statistik.editorenJetzt") }}
                        <b>{{ formatNumber(zahlen.jetzt.editoren, 0) }}</b>
                        <span class="statistik__jetztSorteZusatz">{{ t("statistik.editorenJetztZusatz") }}</span>
                    </p>
                </div>
            </section>

            <!-- Wer im Editor ist (WI-0141b): unter der Anwesenheit, Klappboxen je Person. -->
            <EditorStatusEditoren
                v-if="sorte === 'editoren'"
                :aktiv="true"
                @zeigen="(ziel: ObjektZiel, id: string) => emit('zeigen', ziel, id)"
            />

            <section class="statistik__block">
                <h3 class="statistik__titel">
                    {{ t("statistik.zeitraum") }}
                    <span class="statistik__wert">{{ zahlen.von }} – {{ zahlen.bis }}</span>
                </h3>
                <div class="statistik__kacheln">
                    <div class="statistik__kachel">
                        <span class="statistik__kachelWort">{{ t("statistik.aufrufe") }}</span>
                        <span class="statistik__kachelZahl">{{ formatNumber(zahlen.kennzahlen.aufrufe, 0) }}</span>
                    </div>
                    <div class="statistik__kachel">
                        <span class="statistik__kachelWort">{{ t("statistik.eindeutigeMittel") }}</span>
                        <span class="statistik__kachelZahl">{{
                            zahlen.kennzahlen.eindeutigeMittel === null
                                ? t("statistik.unbekannt")
                                : formatNumber(zahlen.kennzahlen.eindeutigeMittel, 0)
                        }}</span>
                    </div>
                    <div class="statistik__kachel">
                        <span class="statistik__kachelWort">{{ t("statistik.routen") }}</span>
                        <span class="statistik__kachelZahl">{{ formatNumber(zahlen.kennzahlen.routen, 0) }}</span>
                    </div>
                    <!-- Was Besucher bei uns vergeblich suchen (WI-0138 V11): die nützlichste Zahl der Tafel. -->
                    <div class="statistik__kachel">
                        <span class="statistik__kachelWort">{{ t("statistik.sucheLeer") }}</span>
                        <span class="statistik__kachelZahl">{{ formatNumber(zahlen.kennzahlen.sucheLeer, 0) }}</span>
                    </div>
                    <div class="statistik__kachel statistik__kachel--sorte" data-testid="statistik-koepfe">
                        <span class="statistik__kachelWort">{{ t("statistik.editorenKoepfe") }}</span>
                        <span class="statistik__kachelZahl">{{ koepfe.zahl }}</span>
                        <span v-if="koepfe.ab" class="statistik__kachelZusatz">{{ koepfe.ab }}</span>
                    </div>
                    <div class="statistik__kachel" data-testid="statistik-bester-tag">
                        <span class="statistik__kachelWort">{{ t("statistik.besterTag") }}</span>
                        <span class="statistik__kachelZahl">{{
                            zahlen.kennzahlen.besterTag === null
                                ? t("statistik.unbekannt")
                                : formatNumber(zahlen.kennzahlen.besterTag, 0)
                        }}</span>
                        <span v-if="zahlen.kennzahlen.besterTagAm" class="statistik__kachelZusatz">{{
                            zahlen.kennzahlen.besterTagAm
                        }}</span>
                    </div>
                    <div class="statistik__kachel">
                        <span class="statistik__kachelWort">{{ t("statistik.wachstum") }}</span>
                        <span class="statistik__kachelZahl">{{ wachstumText }}</span>
                    </div>
                    <div class="statistik__kachel" data-testid="statistik-gleichzeitig">
                        <span class="statistik__kachelWort">{{ t("statistik.gleichzeitig") }}</span>
                        <span class="statistik__kachelZahl">{{ gleichzeitig.zahl }}</span>
                        <span v-if="gleichzeitig.am" class="statistik__kachelZusatz">{{ gleichzeitig.am }}</span>
                    </div>
                    <div class="statistik__kachel" data-testid="statistik-besuchszeit">
                        <span class="statistik__kachelWort">{{ t("statistik.besuchszeit") }}</span>
                        <span class="statistik__kachelZahl">{{ besuchszeitText }}</span>
                    </div>
                </div>
                <p class="statistik__satz">{{ t("statistik.sortenSatz") }}</p>
                <p
                    v-if="sorte === 'besucher' && ausgeschlossenText"
                    class="statistik__satz"
                    data-testid="statistik-ausgeschlossen"
                >
                    {{ ausgeschlossenText }}
                </p>
            </section>

            <section v-if="verlaufBild" class="statistik__block">
                <!-- Ohne Zusatz: die Achsen sagen seit dem 2026-10-13 selbst, worüber sie laufen. -->
                <h3 class="statistik__titel">{{ t("statistik.verlauf") }}</h3>
                <svg
                    class="statistik__verlauf"
                    :viewBox="`-34 -8 ${verlaufBild.breite + 66} ${verlaufBild.hoehe + 30}`"
                    role="img"
                    :aria-label="t('statistik.verlaufLabel')"
                >
                    <!-- Die Achsen tragen ihre Maße: links der Höchstwert und die Null, unten drei Tage. -->
                    <line x1="0" y1="0" x2="0" :y2="verlaufBild.hoehe" class="statistik__achse" />
                    <line
                        :x1="verlaufBild.breite"
                        y1="0"
                        :x2="verlaufBild.breite"
                        :y2="verlaufBild.hoehe"
                        class="statistik__achse statistik__achse--zweite"
                    />
                    <line
                        x1="0"
                        :y1="verlaufBild.hoehe"
                        :x2="verlaufBild.breite"
                        :y2="verlaufBild.hoehe"
                        class="statistik__achse"
                    />
                    <text x="-4" y="4" class="statistik__mass statistik__mass--rechts">
                        {{ formatNumber(verlaufBild.hoechst, 0) }}
                    </text>
                    <text x="-4" :y="verlaufBild.hoehe" class="statistik__mass statistik__mass--rechts">0</text>
                    <text :x="verlaufBild.breite + 4" y="4" class="statistik__mass statistik__mass--zweite">
                        {{ formatNumber(verlaufBild.hoechstEditoren, 0) }}
                    </text>
                    <text
                        :x="verlaufBild.breite + 4"
                        :y="verlaufBild.hoehe"
                        class="statistik__mass statistik__mass--zweite"
                    >
                        0
                    </text>
                    <text x="0" :y="verlaufBild.hoehe + 12" class="statistik__mass">
                        {{ tagKurz(verlaufBild.von) }}
                    </text>
                    <text
                        :x="verlaufBild.breite / 2"
                        :y="verlaufBild.hoehe + 12"
                        class="statistik__mass statistik__mass--mitte"
                    >
                        {{ tagKurz(verlaufBild.mitte) }}
                    </text>
                    <text
                        :x="verlaufBild.breite"
                        :y="verlaufBild.hoehe + 12"
                        class="statistik__mass statistik__mass--rechts"
                    >
                        {{ tagKurz(verlaufBild.bis) }}
                    </text>
                    <polyline
                        v-for="(zug, i) in verlaufBild.aufrufe"
                        :key="`a${i}`"
                        :points="zug"
                        class="statistik__linie statistik__linie--aufrufe"
                    />
                    <polyline
                        v-for="(zug, i) in verlaufBild.eindeutige"
                        :key="`u${i}`"
                        :points="zug"
                        class="statistik__linie statistik__linie--eindeutige"
                    />
                    <polyline
                        v-for="(zug, i) in verlaufBild.editoren"
                        :key="`e${i}`"
                        :points="zug"
                        class="statistik__linie statistik__linie--editoren"
                    />
                </svg>
                <p class="statistik__legende">
                    <span class="statistik__legendeTeil"
                        ><i class="statistik__strich statistik__strich--aufrufe"></i>{{ t("statistik.aufrufe") }}</span
                    >
                    <span class="statistik__legendeTeil"
                        ><i class="statistik__strich statistik__strich--eindeutige"></i
                        >{{ t("statistik.eindeutigeMittel") }}</span
                    >
                    <span class="statistik__legendeTeil"
                        ><i class="statistik__strich statistik__strich--editoren"></i
                        >{{ t("statistik.editorenAchse") }}</span
                    >
                </p>
            </section>

            <section class="statistik__block">
                <h3 class="statistik__titel">
                    {{ t("statistik.zeiten") }} <span class="statistik__wert">{{ t("statistik.ortszeit") }}</span>
                </h3>
                <div class="statistik__tafel">
                    <template v-for="(zeile, index) in zahlen.tafel" :key="index">
                        <span class="statistik__tag">{{ TAGESWORTE[index] }}</span>
                        <span
                            v-for="(wert, stunde) in zeile"
                            :key="stunde"
                            class="statistik__zelle"
                            :title="`${TAGESWORTE[index]} ${stunde} ${t('statistik.uhr')}: ${formatNumber(wert, 0)}`"
                            :style="{
                                background:
                                    wert === 0
                                        ? 'var(--color-panel-active)'
                                        : `color-mix(in srgb, var(--color-chart1) ${Math.round(6 + (wert / tafelHoechst) * 88)}%, var(--color-panel-active))`,
                            }"
                        ></span>
                    </template>
                </div>
            </section>

            <section v-if="dauerBalken.length > 0" class="statistik__block">
                <h3 class="statistik__titel">
                    {{ t("statistik.dauer") }} <span class="statistik__wert">{{ dauerText }}</span>
                </h3>
                <div class="statistik__dauer">
                    <span
                        v-for="korb in dauerBalken"
                        :key="korb.wort"
                        class="statistik__dauerBalken"
                        :title="korb.wort"
                    >
                        <i :style="{ height: `${Math.max(2, korb.anteil * 100)}%` }"></i>
                        <em>{{ korb.wort }}</em>
                    </span>
                </div>
                <p v-if="zahlen.dauer.ohne > 0" class="statistik__satz" data-testid="statistik-dauer-ohne">
                    {{ t("statistik.dauerOhne", { anzahl: formatNumber(zahlen.dauer.ohne, 0) }) }}
                </p>
            </section>

            <section v-if="flaechen.length > 0 && regionen.size > 0" class="statistik__block">
                <h3 class="statistik__titel">
                    {{ t("statistik.herkunft") }} <span class="statistik__wert">{{ t("statistik.herkunftWert") }}</span>
                </h3>
                <svg class="statistik__karte" :viewBox="viewBox" role="img" :aria-label="t('statistik.karteLabel')">
                    <path
                        v-for="land in flaechen"
                        :key="land.code"
                        :d="land.d"
                        :fill="flaecheTon(land)"
                        stroke="var(--color-panel)"
                        stroke-width="0.8"
                    >
                        <title>{{ land.name }}: {{ formatNumber(regionWert(land), 0) }}</title>
                    </path>
                    <g v-for="zahl in landZahlen" :key="zahl.code" class="statistik__landZahl">
                        <line
                            v-if="zahl.ort.zu"
                            :x1="zahl.ort.x"
                            :y1="zahl.ort.y"
                            :x2="zahl.ort.zu[0]"
                            :y2="zahl.ort.zu[1]"
                        />
                        <text :x="zahl.ort.x" :y="zahl.ort.y">{{ zahl.text }}</text>
                    </g>
                </svg>
                <!-- 🔴 Die Namensnennung ist Pflicht, nicht Zierde: DB-IP lite steht unter CC BY 4.0 (WI-0138 V6). -->
                <p class="statistik__quelle">{{ t("statistik.geoQuelle") }}</p>
            </section>

            <section v-for="block in bloecke" :key="block.schluessel" class="statistik__block">
                <h3 class="statistik__titel">
                    {{ block.titel }}
                    <span v-if="istHistogramm(block) && zoomMarken" class="statistik__wert">{{ zoomMarken.kopf }}</span>
                    <span v-if="istWetterHistogramm(block) && block.wetter" class="statistik__wert">{{
                        wetterEinheit(block.wetter)
                    }}</span>
                </h3>
                <!-- Das Histogramm der Zoomstufen (WI-0286). Die Zahl je Stufe steht im Titel des Balkens, wie in der Tafel der Zeiten. -->
                <div
                    v-if="istHistogramm(block)"
                    class="statistik__zoom"
                    role="img"
                    :aria-label="t('statistik.zoomLabel', { kopf: zoomMarken?.kopf ?? '' })"
                    data-testid="statistik-zoom"
                >
                    <span
                        v-for="balken in zoomBalken"
                        :key="balken.stufe"
                        class="statistik__zoomBalken"
                        :title="t('statistik.zoomStufe', { stufe: balken.stufe, anzahl: formatNumber(balken.wert, 0) })"
                    >
                        <span class="statistik__zoomSpur"><i :style="{ height: `${balken.anteil * 100}%` }"></i></span>
                        <em>{{ balken.stufe }}</em>
                    </span>
                    <template v-if="zoomMarken">
                        <span
                            class="statistik__zoomLinie"
                            :class="{ 'statistik__zoomLinie--links': zoomMarken.medianLinks }"
                            :style="{ left: zoomMarken.median }"
                            >{{ t("statistik.zoomMedian") }}</span
                        >
                        <span
                            class="statistik__zoomLinie statistik__zoomLinie--mittel"
                            :class="{ 'statistik__zoomLinie--links': !zoomMarken.medianLinks }"
                            :style="{ left: zoomMarken.mittel }"
                            >{{ t("statistik.zoomMittel") }}</span
                        >
                    </template>
                </div>
                <!-- Die Zahlenwerte des Wetters (WI-0288): EIN Histogramm über alle Klassen, Rechner und Telefon nebeneinander. -->
                <template v-else-if="istWetterHistogramm(block)">
                    <p class="statistik__wetterLegende">
                        <span
                            v-for="reihe in wetterHistogramm(block)!.reihen"
                            :key="reihe.geraet"
                            :class="`statistik__wetterMarke statistik__wetterMarke--${reihe.geraet}`"
                            :data-testid="`statistik-${block.schluessel}-legende-${reihe.geraet}`"
                            >{{ reihe.name }} · {{ formatNumber(reihe.summe, 0) }} · {{ t("statistik.zoomMedian") }}
                            {{ reihe.median.text }} · {{ t("statistik.zoomMittel") }} {{ reihe.mittel.text }}</span
                        >
                    </p>
                    <div
                        class="statistik__zoom statistik__zoom--wetter"
                        :style="{ '--spalten': wetterHistogramm(block)!.spalten.length }"
                        role="img"
                        :aria-label="block.titel"
                        :data-testid="`statistik-${block.schluessel}`"
                    >
                        <span
                            v-for="spalte in wetterHistogramm(block)!.spalten"
                            :key="spalte.klasse"
                            class="statistik__zoomBalken"
                        >
                            <span class="statistik__zoomSpur statistik__wetterSpur"
                                ><i
                                    v-for="balken in spalte.balken"
                                    :key="balken.geraet"
                                    :class="`statistik__wetterBalken--${balken.geraet}`"
                                    :data-geraet="balken.geraet"
                                    :title="balken.titel"
                                    :style="{ height: `${balken.anteil * 100}%` }"
                                ></i
                            ></span>
                            <em>{{ spalte.achse }}</em>
                        </span>
                        <!-- Median (durchgezogen) und Mittel (gestrichelt) je Gerät in seiner Farbe; die Werte stehen in der Legende. -->
                        <template v-for="reihe in wetterHistogramm(block)!.reihen" :key="`linien-${reihe.geraet}`">
                            <span
                                :class="`statistik__wetterLinie statistik__wetterLinie--${reihe.geraet}`"
                                :style="{ left: reihe.median.links }"
                                :title="`${reihe.name} · ${t('statistik.zoomMedian')} ${reihe.median.text}`"
                                :data-testid="`statistik-${block.schluessel}-median-${reihe.geraet}`"
                            ></span>
                            <span
                                :class="`statistik__wetterLinie statistik__wetterLinie--mittel statistik__wetterLinie--${reihe.geraet}`"
                                :style="{ left: reihe.mittel.links }"
                                :title="`${reihe.name} · ${t('statistik.zoomMittel')} ${reihe.mittel.text}`"
                                :data-testid="`statistik-${block.schluessel}-mittel-${reihe.geraet}`"
                            ></span>
                        </template>
                    </div>
                </template>
                <template v-else>
                    <div
                        v-for="eintrag in sichtbare(block)"
                        :key="eintrag.name"
                        class="statistik__balken"
                        :class="eintrag.stufe ? `statistik__balken--stufe${eintrag.stufe}` : ''"
                    >
                        <span class="statistik__balkenName einzeilig" :title="zeilenName(block, eintrag.name)">{{
                            zeilenName(block, eintrag.name)
                        }}</span>
                        <span class="statistik__spur"
                            ><i :style="{ width: anteil(block.liste.eintraege, eintrag.wert) }"></i
                        ></span>
                        <span class="statistik__balkenZahl">{{ formatNumber(eintrag.wert, 0) }}</span>
                    </div>
                </template>
                <!-- Ausklappen (WI-0191): nur, wo es mehr gibt als die ersten acht. -->
                <AvmKnopf
                    v-if="block.ganz !== true && !istHistogramm(block) && block.liste.eintraege.length > ERSTE"
                    class="statistik__mehr"
                    groesse="zeile"
                    :testid="`statistik-mehr-${block.schluessel}`"
                    @click="klappe(block.schluessel)"
                    >{{
                        offeneBloecke.has(block.schluessel)
                            ? t("statistik.weniger")
                            : t("statistik.alleZeigen", { anzahl: formatNumber(block.liste.eintraege.length, 0) })
                    }}</AvmKnopf
                >
                <!-- Hat der Server gekürzt, sagt der offene Block, wie viele es insgesamt sind - statt „alle“ zu behaupten. -->
                <p
                    v-if="offeneBloecke.has(block.schluessel) && block.liste.gesamt > block.liste.eintraege.length"
                    class="statistik__satz"
                >
                    {{
                        t("statistik.listeGekuerzt", {
                            gesamt: formatNumber(block.liste.gesamt, 0),
                            grenze: formatNumber(block.liste.eintraege.length, 0),
                        })
                    }}
                </p>
            </section>

            <p class="statistik__fuss">
                <b>{{ t("statistik.datenschutzMarke") }}</b> {{ t("statistik.datenschutz") }} <br />{{
                    t("statistik.speicher", {
                        zeilen: formatNumber(zahlen.speicher.zeilen, 0),
                        mb: (zahlen.speicher.bytes / 1024 / 1024).toFixed(1),
                    })
                }}
            </p>
        </template>
    </div>
</template>

<style scoped>
/* Eine Fluchtlinie mit Titel und Reitern des Panels (beide `--space-12`), damit nichts gegeneinander versetzt steht. */
.statistik {
    display: flex;
    flex-direction: column;
    gap: var(--space-8);
    padding: var(--space-10) var(--space-12) var(--space-16);
}

/* Der Messblock steht über den Zahlen des Zeitraums: er sagt, was JETZT ist. */

.statistik__block {
    border-top: 1px solid var(--color-divider);
    padding-top: var(--space-8);
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
}

.statistik__titel {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-6);
    margin: 0;
    font-size: var(--font-size-caption);
    font-weight: var(--font-weight-regular);
    letter-spacing: 0.09em;
    text-transform: uppercase;
    color: var(--color-text-muted);
}

.statistik__wert,
.statistik__satz {
    font-size: var(--font-size-caption);
    color: var(--color-text-muted);
    text-transform: none;
    letter-spacing: 0;
}

.statistik__satz {
    margin: 0;
}

/* Anwesend jetzt: die Zahl steht für sich, darunter die Aufteilung als Zahl über Wort, darunter die getrennte Sorte. */
.statistik__jetzt {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
    padding: var(--space-6) var(--space-8);
    background: var(--color-panel-soft);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
}

.statistik__jetztKopf {
    display: flex;
    align-items: baseline;
    gap: var(--space-6);
    margin: 0;
}

.statistik__jetztZahl {
    font-size: var(--font-size-display);
    line-height: 1;
    color: var(--color-text-strong);
}

.statistik__jetztWort {
    font-size: var(--font-size-caption);
    color: var(--color-text-muted);
}

.statistik__teile {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: var(--space-4);
    margin: 0;
}

.statistik__teil {
    display: flex;
    flex-direction: column-reverse;
    gap: 1px;
    padding-top: var(--space-4);
    border-top: 1px solid var(--color-divider);
}

.statistik__teilWort {
    font-size: var(--font-size-caption);
    color: var(--color-text-muted);
}

.statistik__teilZahl {
    margin: 0;
    font-size: var(--font-size-subhead);
    color: var(--color-text-strong);
}

/*
 * Die andere Sorte steht abgesetzt - sie ist kein Teil der Summe darüber. Der Satz bleibt gedämpft; nur die Zahl trägt die
 * Farbe der Editorenlinie im Verlauf. Ganz in chart2 las sich die Zeile wie eine Warnung, und Editoren sind keine.
 */
.statistik__jetztSorte {
    margin: 0;
    padding-top: var(--space-4);
    border-top: 1px solid var(--color-divider);
    font-size: var(--font-size-caption);
    color: var(--color-text-muted);
}

.statistik__jetztSorte {
    display: flex;
    align-items: baseline;
    gap: var(--space-4);
}

.statistik__jetztSorte b {
    color: var(--color-chart2);
    font-weight: var(--font-weight-regular);
}

.statistik__jetztSorteZusatz {
    margin-left: auto;
}

.statistik__kacheln {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: var(--space-4);
}

.statistik__kachel {
    display: flex;
    flex-direction: column;
    background: var(--color-panel-soft);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    padding: var(--space-4) var(--space-6);
}

.statistik__kachel--sorte {
    border-color: var(--color-chart2);
}

.statistik__kachelWort {
    font-size: var(--font-size-caption);
    color: var(--color-text-muted);
}

.statistik__kachelZahl {
    font-size: var(--font-size-subhead);
    color: var(--color-text-strong);
}

.statistik__kachelZusatz {
    font-size: var(--font-size-caption);
    color: var(--color-text-muted);
}

.statistik__quelle {
    margin: var(--space-4) 0 0;
    font-size: var(--font-size-caption);
    color: var(--color-text-muted);
}

/* Die volle Höhe der viewBox: Kleiner würden die Zahlen in den Bundesländern unlesbar. */
.statistik__karte {
    display: block;
    width: 100%;
    max-height: 380px;
    height: auto;
}

/* Der Rand in Panelfarbe hält die Zahl auf jedem Ton lesbar; der Zeiger geht durch sie hindurch zum Titel der Fläche. */
.statistik__landZahl {
    pointer-events: none;
}

.statistik__landZahl text {
    fill: var(--color-text-strong);
    stroke: var(--color-panel);
    stroke-width: 2.4px;
    stroke-linejoin: round;
    paint-order: stroke;
    font-size: var(--font-size-caption);
    font-variant-numeric: tabular-nums;
    text-anchor: middle;
    dominant-baseline: central;
}

.statistik__landZahl line {
    stroke: var(--color-text-strong);
    stroke-width: 0.7px;
}

.statistik__verlauf {
    width: 100%;
    height: auto;
}

.statistik__achse {
    stroke: var(--color-divider);
    stroke-width: 1;
}

.statistik__mass {
    font-size: 8px;
    fill: var(--color-text-muted);
}

.statistik__mass--rechts {
    text-anchor: end;
}

.statistik__mass--mitte {
    text-anchor: middle;
}

/* Die zweite Achse gehört der Editorenlinie - Beschriftung und Strich tragen deshalb deren Farbe. */
.statistik__mass--zweite {
    fill: var(--color-chart2);
}

.statistik__achse--zweite {
    stroke: var(--color-chart2);
    stroke-opacity: 0.45;
}

/* Die Legende nennt jede Linie; das Strichmuster ist die zweite Kodierung neben der Farbe (Kanon). */
.statistik__legende {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-6);
    margin: 0;
    font-size: var(--font-size-caption);
    color: var(--color-text-muted);
}

.statistik__legendeTeil {
    display: inline-flex;
    align-items: center;
    gap: var(--space-4);
}

.statistik__strich {
    display: inline-block;
    width: 18px;
    height: 0;
    border-top-width: 2px;
}

.statistik__strich--aufrufe {
    border-top-style: solid;
    border-top-color: var(--color-chart1);
}

.statistik__strich--eindeutige {
    border-top-style: dashed;
    border-top-color: var(--color-chart3);
}

.statistik__strich--editoren {
    border-top-style: dotted;
    border-top-color: var(--color-chart2);
}

.statistik__linie {
    fill: none;
    stroke-width: 1.6;
    stroke-linejoin: round;
}

/* Drei Linien, drei Farben, dazu je ein eigenes Strichmuster: die zweite Kodierung ist Pflicht (Kanon). */
.statistik__linie--aufrufe {
    stroke: var(--color-chart1);
}

.statistik__linie--eindeutige {
    stroke: var(--color-chart3);
    stroke-dasharray: 6 3;
}

.statistik__linie--editoren {
    stroke: var(--color-chart2);
    stroke-dasharray: 2 3;
    stroke-width: 1.3;
}

.statistik__tafel {
    display: grid;
    grid-template-columns: 22px repeat(24, 1fr);
    gap: 1px;
}

.statistik__tag {
    font-size: var(--font-size-caption);
    color: var(--color-text-muted);
    line-height: 11px;
}

.statistik__zelle {
    height: 11px;
    border-radius: 1px;
}

.statistik__balken {
    display: grid;
    grid-template-columns: 124px 1fr 56px;
    align-items: center;
    gap: var(--space-4);
    font-size: var(--font-size-caption);
}

/* Einzeilig gekürzt wird über die Klasse `einzeilig` aus app.vue (Hausregel, design-canon.test.ts). */
.statistik__balkenName {
    min-width: 0;
}

.statistik__spur {
    display: block;
    height: 9px;
    background: var(--color-panel-active);
    border-radius: 2px;
    overflow: hidden;
}

.statistik__spur i {
    display: block;
    height: 100%;
    background: var(--color-chart1);
}

.statistik__balkenZahl {
    text-align: right;
    color: var(--color-text-muted);
    font-variant-numeric: tabular-nums;
}

/* Unter ihrer Ansicht eingerückt: die Ebenen der Derographie und darunter die Unterwahl der Topographie (WI-0286). */
.statistik__balken--stufe1 .statistik__balkenName,
.statistik__balken--stufe2 .statistik__balkenName {
    color: var(--color-text-muted);
}

.statistik__balken--stufe1 .statistik__balkenName {
    padding-inline-start: var(--space-8);
}

.statistik__balken--stufe2 .statistik__balkenName {
    padding-inline-start: var(--space-16);
}

/*
 * Das Histogramm der Zoomstufen: neun gleich breite Spalten, darüber Platz für die Worte von Median und Mittel. Die Spur ist der
 * Bezug der Höhe, die Beschriftung steht darunter und staucht den höchsten Balken nicht. Die Linien unterscheiden sich im Muster
 * (Kanon: zweite Kodierung neben der Farbe) und in ihrem Wort.
 */
.statistik__zoom {
    position: relative;
    display: grid;
    grid-template-columns: repeat(9, 1fr);
    gap: 2px;
    height: 104px;
    padding-top: var(--space-16);
}

.statistik__zoomBalken {
    display: flex;
    flex-direction: column;
    min-width: 0;
    height: 100%;
}

.statistik__zoomSpur {
    flex: 1;
    display: flex;
    align-items: flex-end;
    min-height: 0;
    border-bottom: 1px solid var(--color-divider);
}

.statistik__zoomSpur i {
    display: block;
    width: 100%;
    background: var(--color-chart1);
    border-radius: 2px 2px 0 0;
}

.statistik__zoomBalken:hover i {
    opacity: 0.75;
}

.statistik__zoomBalken em {
    font-size: var(--font-size-caption);
    font-style: normal;
    line-height: 16px;
    text-align: center;
    color: var(--color-text-muted);
    font-variant-numeric: tabular-nums;
}

/* Die Linie reicht vom oberen Rand bis zur Grundlinie (16 px Beschriftung darunter); ihr Wort steht oben daneben. */
.statistik__zoomLinie {
    position: absolute;
    top: 0;
    bottom: 16px;
    padding-inline-start: var(--space-4);
    border-inline-start: 1px solid var(--color-text-strong);
    font-size: var(--font-size-caption);
    line-height: 1;
    color: var(--color-text-muted);
    white-space: nowrap;
    pointer-events: none;
}

.statistik__zoomLinie--mittel {
    border-inline-start-style: dashed;
}

/* Das Wort links der Linie: dieselbe Linie, das Wort läuft nach links aus. */
.statistik__zoomLinie--links {
    padding-inline: 0 var(--space-4);
    border-inline-start: none;
    border-inline-end: 1px solid var(--color-text-strong);
    transform: translateX(-100%);
}

.statistik__zoomLinie--links.statistik__zoomLinie--mittel {
    border-inline-end-style: dashed;
}

/*
 * Die Histogramme des Wetters (WI-0288): so viele Spalten wie Klassen, in jeder ein Balken je Gerät nebeneinander. Rechner in der
 * ersten, Telefon in der zweiten Diagrammfarbe; die Lage in der Spalte (links, rechts) und die Legende sind die zweite Kodierung neben
 * der Farbe (Kanon). Keine Linien von Median und Mittel wie beim Zoom.
 */
.statistik__wetterLegende {
    display: flex;
    gap: var(--space-10);
    margin: 0;
    font-size: var(--font-size-caption);
    color: var(--color-text-muted);
}

.statistik__wetterMarke::before {
    content: "";
    display: inline-block;
    width: 8px;
    height: 8px;
    margin-inline-end: var(--space-4);
    border-radius: 2px;
    background: var(--color-chart1);
}

.statistik__wetterMarke--telefon::before {
    background: var(--color-chart2);
}

.statistik__zoom--wetter {
    grid-template-columns: repeat(var(--spalten), 1fr);
    height: 96px;
    padding-top: var(--space-4);
}

.statistik__wetterSpur {
    gap: 1px;
}

.statistik__wetterSpur i {
    flex: 1;
    min-width: 0;
}

.statistik__wetterSpur i.statistik__wetterBalken--telefon {
    background: var(--color-chart2);
}

/* Median durchgezogen, Mittel gestrichelt (Muster als zweite Kodierung neben der Farbe des Geräts), von oben bis zur Grundlinie. */
.statistik__wetterLegende {
    flex-wrap: wrap;
    row-gap: var(--space-2);
}

.statistik__wetterLinie {
    position: absolute;
    top: 0;
    bottom: 16px;
    border-inline-start: 2px solid var(--color-chart1);
    transform: translateX(-1px);
}

.statistik__wetterLinie--telefon {
    border-inline-start-color: var(--color-chart2);
}

.statistik__wetterLinie--mittel {
    border-inline-start-style: dashed;
}

/* Jede Spalte hält die Höhe ihrer Beschriftung, auch ohne Wort (Wolkenauflösung), sonst rutschte ihr Balken unter die Grundlinie;
   das Wort darf über die schmale Spalte hinausragen, es steht nur an jeder vierten. */
.statistik__zoom--wetter em {
    min-height: 16px;
    white-space: nowrap;
}

/* Der Knopf zum Ausklappen steht linksbündig unter den Balken, nicht über die Breite: Er ist der Nachsatz der Liste. */
.statistik__mehr {
    align-self: flex-start;
    margin-top: var(--space-4);
}

.statistik__dauer {
    display: flex;
    align-items: flex-end;
    gap: 2px;
    height: 72px;
}

.statistik__dauerBalken {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: flex-end;
    height: 100%;
}

.statistik__dauerBalken i {
    width: 100%;
    background: var(--color-chart1);
    border-radius: 1px 1px 0 0;
}

.statistik__dauerBalken em {
    font-size: 9px;
    font-style: normal;
    color: var(--color-text-muted);
}

.statistik__fuss {
    margin: 0;
    padding: var(--space-6) var(--space-8);
    background: var(--color-panel-soft);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    font-size: var(--font-size-caption);
    color: var(--color-text-muted);
}

.statistik__fuss b {
    color: var(--color-text-strong);
    font-weight: var(--font-weight-regular);
}
</style>
