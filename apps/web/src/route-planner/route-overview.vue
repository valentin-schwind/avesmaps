<script setup lang="ts">
import { computed, inject, onScopeDispose, ref, watch } from "vue";
import {
    AVENTURIA_TRAVEL_MODEL,
    hurryFactor,
    type RouteResponse,
    type RouteSlope,
    type SubjectRef,
} from "@avesmaps3d/shared";
import { territoryHierarchy } from "./territory-hierarchy";
import InlineTextAction from "./inline-text-action.vue";
import RouteStageList from "./route-stage-list.vue";
import RouteElevationProfile from "./route-elevation-profile.vue";
import { hasElevationProfile } from "./elevation-profile-model";
import InfoKnopf from "../fenster/info-knopf.vue";
import AvmDisclosure from "../controls/avm-disclosure.vue";
import AvmKaestchen from "../controls/avm-kaestchen.vue";
import ClosureNote from "./closure-note.vue";
import AvmText from "../controls/avm-text.vue";
import AvmWert from "../controls/avm-wert.vue";
import { nurEinheit } from "../controls/wert";
import CostFootnoteRef from "./cost-footnote-ref.vue";
import CostFootnotes from "./cost-footnotes.vue";
import { closureAnywayHead, closureHead, closureNotes, seasonalWayNotes } from "./closure-notes";
import { formatDate, formatNumber, seasonLabel, type PlannerOptions } from "./planner-model";
import { meldeEinmal } from "../besuch/besuch-melden";
import { t, tPlural } from "../i18n/i18n";
import { areasLid, type LandscapeEntry, type LandscapeLines, type TerritoryEntry } from "./route-landscapes";
import type { BorderStep, CostView } from "./travel-cost-view";
import { settingsLine } from "./route-settings-line";
import { grade, gradeWord, profileCosts, profileHeadline, tenths } from "./profile-costs";
import { airExtraShown, days, hours, miles, schritt } from "./stage-figures";
import { stageListModel } from "./stage-list-model";
import { shipNotes } from "./ship-notes";
import UnterwegsBox from "./unterwegs-box.vue";
import { unterwegsAnfrage, unterwegsGruppen, useUnterwegs, type UnterwegsZeile } from "./unterwegs";
import { createUnterwegsAuswahl, UNTERWEGS_AUSWAHL } from "./unterwegs-auswahl";
import { SUCH_LEUCHTEN_ZUGANG } from "../search/such-leuchten-steuerung";
import { einmalOffen } from "../einmal-offen";
import { ReisePdfFenster } from "../nachladen";
import ReisePdfKnopfZeichen from "../reise-pdf/reise-pdf-knopf-zeichen.vue";

/**
 * Die Reiseübersicht (Design Guide §17.8, Legacy route-plan.js): Titelzeile, Kennzahlen, Etappen.
 *
 * - **Kennzahlen dreispaltig:** Beschriftung, Wert und dieselbe Größe in anderer Einheit - „jeder soll
 *   selber nachrechnen können" (Owner 2026-07-30). Die Gesamtzeit setzt ein Trenner ab.
 * - **Goldbraun heißt anklickbar:** Ort und Weg (13 px) führen auf die Karte, der Rest ist Text. Die
 *   Rangordnung läuft über die Größe, nie über Gewicht.
 * - **Namen sind Text, nie Markup** - Vue setzt sie als Text. Legacys Titelzeile setzte sie als HTML
 *   (MCS-020, S1).
 * - **Die Etappen** stehen seit WI-0079 als kompakte Liste (`route-stage-list.vue`, Modell `stage-list-model.ts`):
 *   Mediengruppen, Wegpunktstationen und EINE durchgehende Kette. Was früher als Fließtext in der Zeile stand -
 *   Wegnamen, Flussrichtung, Datum, Boden, Steigung, Flugzuschlag, Landschaften, Gebiete, der lange
 *   Querfeldein-Hinweis und der Sperrhinweis der Etappe -, steht jetzt im Infopanel der Etappe (`panel-stage.ts`);
 *   verloren geht nichts.
 * - **Landschaften** (WI-0035, Legacy „Führt durch“): Die Listen der GANZEN Route - Landschaften und politische
 *   Gebiete - stehen seit WI-0081 in EINER Klappbox „Durch 19 Landschaften und 43 politische Gebiete“ (Betreiber
 *   2026-10-05): zuerst die Landschaften, dann die Gebiete.
 * - **Vorkommen unterwegs** (WI-0257 S4, S5, Betreiber 2026-10-29 und 2026-10-30): Die letzte Klappbox der Routendetails nennt alles, was auf der Reise vorkommt - Waren, Fauna, Flora, Spezies -, einmal,
 *   mit der ersten Etappe und der Gegend. Der Kreis einer Zeile legt den Eintrag in die Auswahl (mehrere zugleich): Die Etappen ALLER gewählten färben sich, alle leuchten zusammen auf der Karte, und
 *   das Infopanel zeigt ab zwei den Sammelscreen „Ausgewählte Vorkommen“ (`unterwegs.ts`, `unterwegs-auswahl.ts`, `unterwegs-box.vue`). Die Frage ist EINE je Route.
 * - **🔗 neben dem Titel** legt einen Kurzlink an (WI-0034): oben rechts, nur das Symbol, wie Legacy
 *   (Owner 2026-07-30: „oben rechts, etwas größer, Text raus“). Zwei Geschwister, kein Knopf im Knopf.
 * - **Reisebeginn** (WI-0038, Legacy `route-plan-calendar.js`, `route-closures.js`): Abreise und
 *   Ankunft über der Distanz, je Etappe ihr Datum und der Boden der Jahreszeit. Sperrhinweise nach
 *   Variante C: oben, DASS umgeleitet wurde, am Abzweig, WAS gesperrt ist; ohne Reisebeginn die Bitte,
 *   ihn zu prüfen.
 * - **Reisekosten je Person** (WI-0042, Legacy `renderRoutePlanTravelCosts`): ganz unten, nach den
 *   Etappen, ohne eigenen Kasten - Überschrift und Trenner, dasselbe Raster wie oben (Owner 2026-08-03).
 *   Ein Posten ohne Betrag steht leise mit „?“ da, und die Summe sagt, was fehlt. Die Zahlen liefert der Server
 *   (WI-0065); hier steht nur, was er sagt.
 * - **Grenzübertritte** (WI-0065 Z3): unter der Zollzeile eine aufklappbare Liste „Reich → Reich“ in Fahrtrichtung
 *   und darin das Häkchen „auf der Karte zeigen“, das die Übertrittsstellen als Marken auf die Karte legt. Der
 *   Aufklappzustand gehört dieser Übersicht, das Häkchen dem Planer (er legt die Marken auf die Karte); beides steht
 *   in keinem Link. Ohne Grenzen und bei „nicht ermittelbar“ gibt es keine Liste.
 * - **Schifffahrtshinweise** (WI-0069): Fährt die Route ein Schiff, sagt ein Deckel nach den Kosten je benutztem
 *   Schiff, wie lange seine Besatzung fährt und rastet (`ship-notes.ts`). Die Namen der Schiffe tragen keine Stunden.
 * - **Reise als PDF** (WI-0306, Entwurf Fassung 6, Vali 2026-11-10): rechts neben 🔗 derselbe weiche Knopf mit dem Blatt und der Fahne „PDF“; er
 *   öffnet das Fenster „Reise als PDF“ (`reise-pdf/reise-pdf-fenster.vue`), das erst beim ersten Öffnen nachlädt (`einmal-offen.ts`).
 * - **Einstellungszeile** (Betreiber 2026-10-04): unter dem Titel EINE leise Zeile mit dem, was die Route wählt - Routenart
 *   und Umsteigen, im Flug „Flug“ -, damit man sieht, womit gerechnet wurde. Ohne Transportmittel („zu lang“), Reisebeginn
 *   (steht darunter bei Abreise) und Reisestunden (stehen in der Leiste „Reiseoptionen“). Wird sie zu lang, kürzt
 *   `.einzeilig` am Ende mit „…“; der volle Text steht im DOM (Vorleser) und im `title`. Regel: `route-settings-line.ts`.
 */
const props = defineProps<{
    route: RouteResponse;
    selectedStage: number | null;
    stale: boolean;
    /** Wie die Kartenpunkte im Planer heißen („Kartenpunkt bei Gareth“), nach Kennung. */
    pointNames: ReadonlyMap<string, string>;
    /** Ein Kurzlink wird gerade angelegt (WI-0034): 🔗 wartet. */
    sharing: boolean;
    /** Die Landschaften der Route und je Etappe (WI-0035); `null`, bis sie da sind. */
    landscapes: LandscapeLines | null;
    /**
     * Die Optionen des Planers: nach welcher Größe gesucht wurde (der Umweg einer Sperre zählt in Tagen oder in Meilen)
     * und was die Einstellungszeile unter dem Titel nennt.
     */
    options: PlannerOptions;
    /** Die Reisekosten je Person (WI-0042), in der Sprache der Seite aufbereitet. */
    costs: CostView | null;
    /** Das Häkchen „auf der Karte zeigen“ der Liste der Grenzübertritte (WI-0065 Z3 C). */
    showBorders: boolean;
    /** Wie das eigene Flugmittel heißt (WI-0051); leer heißt „Eigenes Flugmittel“. */
    customAirName?: string;
}>();
const emit = defineEmits<{
    selectStage: [index: number, zoom: boolean];
    fitRoute: [];
    /** Eine Nennung in der Etappenliste öffnet ihren Gegenstand (WI-0087 P2): Ort, Kartenpunkt, Weg oder Gebiet. */
    showSubject: [ref: SubjectRef];
    share: [];
    showLandscape: [entry: LandscapeEntry];
    /** „Details zur Höhenberechnung“: das ⓘ Transportmittel auf dem Reiter „Gebirge“. */
    slopeDetails: [];
    /** Das Häkchen der Liste der Grenzübertritte: die Marken auf der Karte zeigen oder nicht. */
    showBorders: [show: boolean];
    showBorder: [step: BorderStep];
    showTerritory: [entry: TerritoryEntry];
}>();

/**
 * „Vorkommen unterwegs“: die Vorkommen der Reise (eine Frage je Route, eine Beigabe wie die Landschaften) und die gewählten Einträge. Die Auswahl gehört der App (`UNTERWEGS_AUSWAHL`: Das
 * Infopanel zeigt aus ihr den Sammelscreen); ohne sie (eine Probeseite, ein Bauteiltest) führt die Übersicht eine eigene, die nur färbt und leuchten lässt. Eine neue Reise beendet die Wahl:
 * Ihre Etappen sind andere, und das Leuchten gehörte zur alten.
 */
const unterwegs = useUnterwegs(() => props.route);
const unterwegsGruppenListe = computed(() => {
    const liste = unterwegs.liste.value;
    return liste === null || liste.length === 0 ? [] : unterwegsGruppen(liste);
});
const geteilteAuswahl = inject(UNTERWEGS_AUSWAHL, undefined);
const unterwegsAuswahl = geteilteAuswahl ?? createUnterwegsAuswahl({ zugang: inject(SUCH_LEUCHTEN_ZUGANG, undefined) });
/** Die Etappen (ab 0), in denen einer der gewählten Einträge vorkommt; die Etappenliste färbt sie. */
const unterwegsTreffer = computed(
    (): ReadonlySet<number> => new Set(unterwegsAuswahl.zeilen.value.flatMap((zeile) => zeile.etappen)),
);
watch(unterwegs.liste, () => unterwegsAuswahl.leere());
// Ohne Übersicht keine Reise: Die Wahl endet mit ihr (die eigene baut ganz ab).
onScopeDispose(() => {
    if (geteilteAuswahl === undefined) unterwegsAuswahl.abbauen();
    else unterwegsAuswahl.leere();
    unterwegsAuswahl.setzeReise(undefined);
});
/** „Reise als PDF“ (WI-0306): das Fenster hängt erst beim ersten Öffnen ein und lädt dabei nach. */
const pdfOffen = ref(false);
const pdfEingehaengt = einmalOffen(() => pdfOffen.value);

/** Der Name einer Zeile: die Infobox öffnen, ohne die Auswahl zu ändern. */
const oeffneUnterwegs = (zeile: UnterwegsZeile): void => unterwegsAuswahl.oeffne(zeile);

const milesPerUnit = computed(() => props.route.miles_per_unit);
const distance = computed(
    () => props.route.stages.reduce((sum, stage) => sum + stage.distance_units, 0) * milesPerUnit.value,
);
const airLegs = computed(() => props.route.air_legs_units.map((units) => units * milesPerUnit.value));
const air = computed(() => airLegs.value.reduce((sum, leg) => sum + leg, 0));
const names = computed(() =>
    props.route.waypoints.map((waypoint) => props.pointNames.get(waypoint.id) ?? waypoint.name),
);
/**
 * Die Reise der Wahl: Der Sammelscreen nennt Start und Ziel im Kopf und misst den Anteil an ihren Etappen; mit ihren Etappen fragt die Wahl nach den Gegenden, die die Route kreuzt.
 */
watch(
    () => [names.value[0], names.value.at(-1), props.route] as const,
    ([von, bis, route]) => {
        const anfrage = unterwegsAnfrage(route) ?? undefined;
        unterwegsAuswahl.setzeReise(
            von === undefined || bis === undefined
                ? undefined
                : { von, bis, etappen: route.stages.length, ...(anfrage === undefined ? {} : { anfrage }) },
        );
    },
    { immediate: true },
);

const routeLandscapes = computed(() => props.landscapes?.route ?? []);
const routeTerritories = computed(() =>
    props.landscapes?.territories ? territoryHierarchy(props.landscapes.territories) : null,
);
/**
 * Die Sprachen der Route (WI-0261 O8, Bauvorlage: Probierseite „Sprachen unterwegs“ Fassung 2): ein eigener Abschnitt der Klappbox zwischen Derographie
 * und politischen Gebieten, wie im Infopanel der Etappe. Je Sprache das Kästchen in ihrer Kartenfarbe, der Name (öffnet ihre Infobox) und ihr Anteil
 * an der Strecke.
 */
const routeSprachenListe = computed(() => props.landscapes?.routeSprachen ?? []);
/** Der Deckel (`areasLid` in `route-landscapes.ts`): mit Sprachen kurz und einzeilig. */
const areasLidText = computed(() =>
    areasLid(routeLandscapes.value.length, routeSprachenListe.value.length, routeTerritories.value?.length ?? 0),
);
/**
 * Die Unterüberschriften in der Flächenbox (Betreiber 2026-10-05: „arbeite mit unterüberschriften von
 * landschaften und politischer liste“) stehen nur, wenn MINDESTENS ZWEI Listen da sind: Mit nur einer sagte
 * „LANDSCHAFTEN“ dasselbe wie der Deckel darüber und käme nur die Zeile zu stehen. Sie tragen keine Zahl - der
 * Deckel nennt alle schon.
 */
const showsAreaHeadings = computed(
    () =>
        [routeLandscapes.value.length, routeSprachenListe.value.length, routeTerritories.value?.length ?? 0].filter(
            (n) => n > 0,
        ).length >= 2,
);
const sprachAnteil = (anteil: number): string => `${formatNumber(Math.round(anteil * 100), 0)} %`;

/** „6 Etappen“, aber „1 Etappe“ - Einzahl und Mehrzahl sind getrennte Schlüssel (Legacy). */
const legCount = (n: number): string => tPlural("planner.summary.legCount", n, { n });
const stationCount = (n: number): string => tPlural("planner.summary.airStations", n, { n });
const closureHeadText = computed(() => closureHead(props.route, props.options.optimize));
const closureAnywayText = computed(() => closureAnywayHead(props.route));
/** Womit gerechnet wurde, in einer Zeile unter dem Titel (`route-settings-line.ts`); der Wortlaut ist zugleich der `title`. */
const settings = computed(() => settingsLine(props.route, props.options));
const stageClosures = computed(() => closureNotes(props.route));
const seasonalWays = computed(() => seasonalWayNotes(props.route));
const ships = computed(() => shipNotes(props.route));
/**
 * Die Etappenliste (WI-0079 P1): Mediengruppen, Wegpunktstationen und die durchgehende Kette rechnet
 * `stage-list-model.ts` als reine Daten; dieses Bauteil zeigt sie nur. Die Gruppierung ist Darstellung und
 * ändert nichts an der Antwort.
 */
const stageList = computed(() =>
    stageListModel(props.route, {
        pointNames: props.pointNames,
        ...(props.customAirName === undefined ? {} : { customAirName: props.customAirName }),
        closures: new Set(stageClosures.value.keys()),
    }),
);
/**
 * Der Deckel „Eiltempo“ in den Routendetails (WI-0078 §6a): Er steht, sobald der Haken gesetzt ist - auch wenn kein
 * Abschnitt geeignet war. Ein Haken ohne jede Wirkung und ohne ein Wort dazu wäre von einem Fehler nicht zu
 * unterscheiden. Im Flug gibt es kein Eiltempo (§3 Regel 7), also auch keinen Deckel.
 */
const showsHurryBox = computed(() => props.options.hurry && !props.route.air);
/**
 * 🔴 Der Deckel nennt nur das ERGEBNIS (Betreiber 2026-10-05: „8,6 Std. Zeitersparnis im Eiltempo“), die Rechnung
 * steht im Inneren. Die Farbgebung macht `AvmText` nach der Klappbox-Regel: die Zahl hervorgehoben, das Wort nicht -
 * hier wird nichts von Hand eingefärbt.
 *
 * Drei Fälle: ohne jede Wirkung sagt der Deckel das (ein Haken ohne Wort wäre von einem Fehler nicht zu
 * unterscheiden); unter einer Zehntelstunde steht „wenige Minuten“ statt „0,0 Std.“; über einem Tag in Tagen.
 */
const hurrySavedText = (value: number): string =>
    value >= 24 ? days(value) : t("unit.hoursShort", { n: formatNumber(value, 1) });
const hurryLid = computed(() => {
    const hurry = props.route.hurry;
    if (!hurry || !(hurry.saved_hours > 0)) return t("planner.hurry.lid.none");
    if (hurry.saved_hours < 0.05) return t("planner.hurry.lid.tiny");
    return t("planner.hurry.lid", { saved: hurrySavedText(hurry.saved_hours) });
});

/**
 * Die Rechnung im Inneren (Betreiber 2026-10-05: „präsentiere die rechnung beim aufklappen“): welcher Teil der Reise
 * geeignet war, wie viele Reisetage wirklich geeilt wurden, welcher Faktor an einem Eiltag galt, und was daraus folgt.
 *
 * 🔴 Die Zahl der Eiltage ist seit F3 die eigentliche Auskunft: Die Geographia erlaubt erhöhtes Tempo nur jeden
 * zweiten Reisetag, und `hurried_hours` nennt die Stunden, die wirklich darin lagen. Geteilt durch die Reisestunden
 * am Tag des Planers sind das die Tage. Die Faktoren kommen aus dem Reisemodell (`hurryFactor`), nie aus einer Zahl
 * hier - gezeigt werden genau die, die auf dieser Reise gegolten haben.
 */
const hurryLines = computed((): { label: string; value: string }[] => {
    const hurry = props.route.hurry;
    if (!hurry) return [];
    const perDay = props.route.hours_per_day > 0 ? props.route.hours_per_day : 1;
    const faktoren = [
        ...new Set(
            props.route.segments
                .filter((segment) => (segment.hurry_factor ?? 1) > 1)
                .map((segment) => hurryFactor(AVENTURIA_TRAVEL_MODEL, segment.transport_type, segment.subtype))
                .filter((value) => value > 1),
        ),
    ].sort((a, b) => a - b);
    const lines = [
        {
            label: t("planner.hurry.stretch.label"),
            value: t("planner.hurry.stretch", {
                // Die Einheit steht EINMAL, am Ende - wie der Betreiber sie geschrieben hat.
                miles: formatNumber(hurry.distance_units * milesPerUnit.value, 1),
                total: miles(distance.value, 1),
            }),
        },
        {
            label: t("planner.hurry.days.label"),
            value: t("planner.hurry.days", {
                hurried: formatNumber(hurry.hurried_hours / perDay, 1),
                total: formatNumber(props.route.travel_hours / perDay, 1),
            }),
        },
    ];
    if (faktoren.length > 0) {
        lines.push({
            label: t("planner.hurry.factor.label"),
            // „1,5-fach“ und „1,25-fach“: so viele Stellen, wie der Faktor wirklich hat.
            value: faktoren
                .map((value) =>
                    t("planner.hurry.factor.value", {
                        n: formatNumber(value, Number.isInteger(value * 10) ? 1 : 2),
                    }),
                )
                .join(" · "),
        });
    }
    lines.push({ label: t("planner.hurry.saved.label"), value: hurrySavedText(hurry.saved_hours) });
    return lines;
});
/**
 * Die Steigung je Etappe und für die Reise (WI-0049 S5d; Betreiber 2026-09-28 am Entwurf: Satz wie Legacy,
 * „würd weder schätzen noch modellieren sagen - vielleicht einfach den satz und dann "Details zur
 * Höhenberechnung"“). Legacys Wortlaut vom Owner 30.07.2026: „(max. 21 % Steigung, 1.539 ↑, 809 ↓ Schritt)“.
 * - Ohne Höhen oder ganz eben keine Zeile (Legacy: „nur wenn es etwas zu sagen gibt“).
 * - Gerundet auf 10 Schritt, ganze Prozent und Zehntelstunden. Ist das Steilste ein Gefälle, heißt es so.
 * - Die Mehrzeit ist die Zeit mit Steigung minus dieselbe Zeit im Ebenen, nie negativ. Absitzen zählt
 *   nicht dazu. Der steilste Abschnitt ist über ein längeres Stück gemittelt, wie Legacy (Betreiber
 *   2026-09-28 „1 B“); die 750-Schritt-Werte zeigten Klippen der Raster bis 164 %.
 */
const routeSlope = computed(() => props.route.slope);
/** Der Zuschlag eines Flugs über der Reisehöhe: nicht „Aufstieg“, denn auch das Halten über der Reisehöhe kostet (`airExtraShown`). */
const routeAirExtra = computed(() => props.route.air_extra);
/**
 * Die Profilbox gibt es nur, wenn ein Höhenprofil abgeleitet wurde (Betreiber 2026-10-03: „keine Klappbox, wenn kein
 * Höhenprofil abgeleitet wurde“) - ohne Messwerte weder Box noch Leerhinweis. Eine Steigungs-Zusammenfassung ohne
 * Profilpunkte (alte Wegprofile aus nur Summen, ohne Abtastschritte) hält die Box offen, denn der Satz zur ganzen
 * Reise, der höchste Punkt und „Details zur Höhenberechnung“ stehen sonst nirgends; dann ohne Diagramm.
 */
const profilePoints = computed(() => hasElevationProfile(props.route));
const showsProfileBox = computed(
    () => profilePoints.value || routeSlope.value !== undefined || airExtraShown(routeAirExtra.value),
);
/**
 * Die Kurzangabe im Deckel: die Mehrzeit aus Steigung und Schnee zusammen, „+65,8 Std. (bis 27 % Steigung, Schnee)“
 * (`profileHeadline`, Betreiber 2026-10-04: eine Zeile), oder der Zuschlag eines Flugs über der Reisehöhe; leer, wenn nichts
 * davon zu sagen ist.
 */
const profileSummary = computed(() => {
    const extra = routeAirExtra.value;
    // Ein Flug über der Reisehöhe (kein Land, keine Steigung): sein Zuschlag; sonst die Mehrzeit aus Steigung und Schnee
    // zusammen („+65,8 Std. (bis 27 % Steigung, Schnee)“, Betreiber 2026-10-04).
    if (!routeSlope.value && airExtraShown(extra)) return t("planner.air.extra", { hours: tenths(extra.extra_hours) });
    return profileHeadline(routeSlope.value, props.route.snow, props.route.segments);
});
/** Was Steigung und Schnee kosten, als Satz (`profile-costs.ts`); leer, wenn keins eine Angabe wert ist. */
const profileCostText = computed(() => profileCosts(routeSlope.value?.extra_hours, props.route.snow));
/**
 * Wer das Höhenprofil aufklappt, hat die dritte Dimension genutzt (`profile`, WI-0159, `BESUCH-0001 §13 D`). Einmal je
 * Besuch, wie die Neigung und der Flug - gezählt wird das Aufklappen, nie das Zuklappen und nie die bloß vorhandene Box.
 */
function profilGeklappt(offen: boolean): void {
    if (offen) meldeEinmal("profile");
}
const coverage = (slope: RouteSlope): string | undefined =>
    slope.covered_stages < slope.total_stages
        ? t("planner.slope.coverage", { covered: slope.covered_stages, total: slope.total_stages })
        : undefined;
</script>

<template>
    <div class="overview" :class="{ 'overview--stale': stale }" data-testid="route-overview">
        <div class="overview__heading">{{ t("planner.summary.heading") }}</div>
        <div class="overview__head">
            <button type="button" class="overview__journey" data-testid="route-title" @click="emit('fitRoute')">
                {{ t("planner.journey.from") }} <span class="overview__terminal">{{ names[0] }}</span>
                <!-- 🪤 Das Leerzeichen vor „über“ steht ausdrücklich da: Vue verwirft den Umbruch davor. -->
                <template v-for="name in names.slice(1, -1)" :key="name"
                    >{{ " " }}{{ t("planner.journey.via") }} {{ name }}</template
                >
                {{ t("planner.journey.to") }} <span class="overview__terminal">{{ names[names.length - 1] }}</span>
            </button>
            <button
                type="button"
                class="overview__share"
                data-testid="route-share"
                :disabled="sharing"
                :aria-busy="sharing"
                :title="t('planner.shareRoute')"
                :aria-label="t('planner.shareRoute')"
                @click="emit('share')"
            >
                <span aria-hidden="true">🔗</span>
            </button>
            <button
                type="button"
                class="overview__share overview__pdf"
                data-testid="route-pdf"
                :title="t('reisePdf.knopf')"
                :aria-label="t('reisePdf.knopf')"
                @click="pdfOffen = true"
            >
                <ReisePdfKnopfZeichen />
            </button>
        </div>
        <p class="overview__settings einzeilig" :title="settings" data-testid="route-settings">{{ settings }}</p>

        <!-- Vor den Zahlen: Ein Umweg von Tagen ist ohne den Hinweis von einem Rechenfehler nicht zu unterscheiden. -->
        <ClosureNote v-if="closureHeadText" testid="route-closure-head">{{ closureHeadText }}</ClosureNote>
        <!-- WI-0082: gesperrt, aber ohnehin gemieden - eigener Wortlaut, bewusst ohne Zeitangabe. -->
        <ClosureNote v-if="closureAnywayText" testid="route-closure-anyway">{{ closureAnywayText }}</ClosureNote>
        <ClosureNote v-if="seasonalWays.length > 0" testid="route-seasonal-ways"
            >{{ t("planner.closure.unknownStart") }}
            <template v-for="(way, index) in seasonalWays" :key="way.name"
                >{{ index > 0 ? ", " : "" }}{{ way.name }} ({{ way.window }})</template
            >. {{ t("planner.closure.checkStart") }}</ClosureNote
        >

        <div class="overview__figures" data-testid="route-figures">
            <template v-if="route.departure && route.arrival">
                <span class="figure__label">{{ t("planner.summary.departure") }}</span>
                <span class="figure__value" data-testid="route-departure">{{ formatDate(route.departure) }}</span>
                <span class="figure__note"></span>

                <span class="figure__label">{{ t("planner.summary.arrival") }}</span>
                <span class="figure__value" data-testid="route-arrival">{{ formatDate(route.arrival) }}</span>
                <span class="figure__note">{{ seasonLabel(route.arrival.season) }}</span>
            </template>

            <span class="figure__label">{{ t("planner.summary.distance") }}</span>
            <span class="figure__value">{{ miles(distance) }}</span>
            <span class="figure__note">{{ legCount(route.stages.length) }}</span>

            <span class="figure__label">{{ t("planner.summary.airDistance") }}</span>
            <span class="figure__value">{{ miles(air) }}</span>
            <span
                class="figure__note"
                :title="
                    airLegs.length > 1
                        ? t('unit.miles', { n: airLegs.map((leg) => formatNumber(leg, 1)).join(' + ') })
                        : undefined
                "
                >{{ stationCount(route.waypoints.length) }}</span
            >

            <span class="figure__label">{{ t("planner.summary.travelTime") }}</span>
            <span class="figure__value">{{ hours(route.travel_hours) }}</span>
            <span class="figure__note">{{ days(route.travel_hours) }}</span>

            <span class="figure__label">{{ t("planner.summary.restTime") }}</span>
            <span class="figure__value">{{ hours(route.rest_hours) }}</span>
            <span class="figure__note">{{ days(route.rest_hours) }}</span>

            <span class="figure__rule" aria-hidden="true"></span>
            <span class="figure__label figure--total">{{ t("planner.summary.totalTime") }}</span>
            <span class="figure__value figure--total">{{ hours(route.total_hours) }}</span>
            <span class="figure__note figure--total">{{ days(route.total_hours) }}</span>
        </div>
        <div class="overview__heading overview__heading--legs">{{ t("planner.legs.heading") }}</div>
        <RouteStageList
            :model="stageList"
            :selected-stage="selectedStage"
            :stale="stale"
            :treffer="unterwegsTreffer"
            @select-stage="emit('selectStage', $event, true)"
            @show-subject="emit('showSubject', $event)"
        />

        <section class="planning" data-testid="route-planning">
            <div class="overview__heading overview__heading--legs">{{ t("planner.planning.heading") }}</div>
            <AvmDisclosure
                v-if="showsProfileBox"
                :label="t('planner.profile.heading')"
                :secondary="profileSummary"
                data-testid="planning-profile"
                toggle-testid="profile-toggle"
                @update:open="profilGeklappt"
            >
                <p
                    v-if="routeSlope"
                    class="overview__landscapes"
                    :title="coverage(routeSlope)"
                    data-testid="route-slope"
                >
                    <!--
                        Die Werte setzen `AvmText` und `AvmWert` (Klappbox-Regel, Design Guide §16.3): Zahl hell, Einheit
                        gedämpft. 🪤 Die Leerzeichen stehen ausdrücklich da: Vue verwirft den Umbruch zwischen zwei Elementen.
                    -->
                    <AvmText
                        :text="
                            t('planner.slope.summary.head', {
                                word: gradeWord(routeSlope.steepest_grade),
                                grade: grade(routeSlope.steepest_grade),
                            })
                        "
                    />{{ " (" }}<AvmText :text="schritt(routeSlope.ascent_schritt)" />{{ " "
                    }}<span class="richtung" :title="t('planner.slope.up')" :aria-label="t('planner.slope.up')"
                        >↑&#xFE0E;</span
                    >{{ " · " }}<AvmText :text="schritt(routeSlope.descent_schritt)" />{{ " "
                    }}<span class="richtung" :title="t('planner.slope.down')" :aria-label="t('planner.slope.down')"
                        >↓&#xFE0E;</span
                    >{{ " " }}<AvmWert :werte="[nurEinheit(t('planner.slope.unit'))]" />{{ "), "
                    }}<AvmText
                        :text="t('planner.slope.summary.highest', { n: schritt(routeSlope.highest_schritt) })"
                    />{{ ". " }}<AvmText v-if="profileCostText" :text="profileCostText" />
                    <!-- 🪤 Das Leerzeichen steht ausdrücklich da: Vue verwirft den Umbruch vor dem Knopf. -->
                    {{ " "
                    }}<span class="overview__inline-info"
                        ><InfoKnopf
                            :beschriftung="t('planner.slope.details')"
                            :hinweis="t('planner.slope.details')"
                            testid="route-slope-details"
                            @oeffnen="emit('slopeDetails')"
                    /></span>
                </p>
                <!-- Schnee ohne Steigungszeile (eine Reise ohne Wegprofile an Land): der Satz allein. -->
                <p v-if="!routeSlope && profileCostText" class="overview__landscapes" data-testid="route-snow">
                    <AvmText :text="profileCostText" />
                </p>
                <p
                    v-if="airExtraShown(routeAirExtra)"
                    class="overview__landscapes"
                    :title="t('planner.air.extra.title')"
                    data-testid="route-air-extra"
                >
                    <AvmText
                        :text="
                            t('planner.air.extra.summary', {
                                hours: tenths(routeAirExtra.extra_hours),
                                peak: schritt(routeAirExtra.peak_schritt),
                            })
                        "
                    />
                </p>

                <RouteElevationProfile v-if="profilePoints" :route="route" :names="names" />
            </AvmDisclosure>
            <AvmDisclosure
                v-if="costs"
                :label="t('planner.cost.heading')"
                :secondary="costs.summary"
                data-testid="planning-costs"
                toggle-testid="costs-toggle"
            >
                <div class="overview__figures overview__figures--costs" data-testid="route-costs">
                    <template v-for="line in costs.lines" :key="line.key">
                        <span class="figure__label">{{ line.label }}</span>
                        <!-- Die Übernachtung: eine Unterzeile je Dach, der Betrag nur an den Gasthausnächten (Betreiber 2026-10-04). -->
                        <span v-if="line.nights" class="figure__value costs__nights" :data-testid="`cost-${line.key}`">
                            <span
                                v-for="night in line.nights"
                                :key="night.kind"
                                class="costs__night"
                                :data-kind="night.kind"
                                data-testid="cost-night"
                                ><AvmText
                                    :text="night.amount ? `${night.text}: ` : night.text"
                                    rolle="sekundaer" /><span v-if="night.amount || night.footnote" class="costs__keep"
                                    ><AvmWert
                                        v-if="night.amount"
                                        class="costs__night-amount"
                                        :werte="night.amount.coins"
                                        :ohne="night.amount.text" /><CostFootnoteRef
                                        v-if="night.footnote"
                                        :number="night.footnote" /></span
                            ></span>
                        </span>
                        <template v-else>
                            <span
                                class="figure__value"
                                :class="{ 'figure__value--unknown': line.unknown }"
                                :data-testid="`cost-${line.key}`"
                                ><AvmWert :werte="line.amount.coins" :ohne="line.amount.text"
                            /></span>
                            <span class="figure__note costs__note"
                                ><AvmText :text="line.note" rolle="sekundaer" /><CostFootnoteRef
                                    v-if="line.footnote"
                                    :number="line.footnote" /><span
                                    v-if="line.extra"
                                    class="costs__extra"
                                    :data-testid="'cost-' + line.key + '-extra'"
                                    ><AvmText :text="line.extra" rolle="sekundaer" /></span
                            ></span>
                        </template>
                        <!-- Z3 B: die Übertritte, aufklappbar; Z3 C: das Häkchen darin legt Marken auf die Karte. -->
                        <AvmDisclosure
                            v-if="line.key === 'tolls' && costs.borders"
                            class="borders"
                            data-testid="route-borders"
                            :label="t('planner.borders.toggle', { n: formatNumber(costs.borders.count, 0) })"
                            toggle-testid="borders-toggle"
                        >
                            <div class="borders__inner">
                                <ol class="borders__list" data-testid="borders-list">
                                    <li
                                        v-for="(step, index) in costs.borders.steps"
                                        :key="index"
                                        class="borders__step"
                                        data-testid="border-step"
                                        :title="t('planner.borders.step', { from: step.fromTitle, to: step.toTitle })"
                                    >
                                        <button
                                            type="button"
                                            class="stage__link"
                                            :disabled="stale"
                                            @click="emit('showBorder', step)"
                                        >
                                            {{ t("planner.borders.step", { from: step.from, to: step.to }) }}
                                        </button>
                                    </li>
                                </ol>
                                <AvmKaestchen
                                    art="checkbox"
                                    :checked="showBorders"
                                    :hinweis="t('planner.borders.show.title')"
                                    testid="borders-show"
                                    @change="emit('showBorders', $event)"
                                >
                                    <span>{{ t("planner.borders.show") }}</span>
                                </AvmKaestchen>
                            </div>
                        </AvmDisclosure>
                    </template>
                    <span class="figure__rule" aria-hidden="true"></span>
                    <span class="figure__label figure--total">{{ t("planner.cost.total") }}</span>
                    <span class="figure__value figure--total" data-testid="cost-total"
                        ><AvmWert :werte="costs.totalAmount.coins" :ohne="costs.totalAmount.text"
                    /></span>
                    <span class="figure__note figure--total costs__note" data-testid="cost-total-note"
                        ><AvmText :text="costs.totalNote" rolle="sekundaer"
                    /></span>
                </div>
                <CostFootnotes :notes="costs.footnotes" />
            </AvmDisclosure>
            <!--
                Eiltempo (WI-0078 §6a): Es wirkt abschnittsweise, nie pauschal - ohne diesen Deckel wäre eine kürzere
                Reisezeit von einem Rechenfehler nicht zu unterscheiden. Er nennt die Summe, die Regel in
                unpersönlicher Regelstimme und die Belastung, die der Plan NICHT einrechnet.
            -->
            <AvmDisclosure
                v-if="showsHurryBox"
                :label="hurryLid"
                data-testid="planning-hurry"
                toggle-testid="hurry-toggle"
            >
                <!--
                    Die Rechnung zuerst, dann die Regel: erst was herauskam, dann warum.

                    🔴 Die Rechnung steht als TABELLE (WI-0087 P11, Betreiber 2026-10-06: „kannst du die wall of text
                    etwas auflockern, vielleicht kannst du die rechnung in eine tabelle tun"): links die Benennung,
                    rechts der Wert. Die Werte sind unverändert - dieselben Zahlen, Einheiten und Rundungen.
                -->
                <dl class="hurry-table" data-testid="route-hurry-table">
                    <template v-for="line in hurryLines" :key="line.label">
                        <dt class="hurry-table__label" data-testid="route-hurry-line">{{ line.label }}</dt>
                        <dd class="hurry-table__value" data-testid="route-hurry-value">
                            <AvmText :text="line.value" />
                        </dd>
                    </template>
                </dl>
                <!--
                    Die Regel der Geographia, aufgelockert: drei Sätze statt eines Absatzes, und die Aufzählung, die
                    im Fließtext steckte, als Aufzählung. 🔴 Wort für Wort dieselbe - gestrichen ist nichts.
                -->
                <template v-if="route.hurry">
                    <p class="overview__landscapes" data-testid="route-hurry">
                        <AvmText :text="t('planner.hurry.rule.pace')" />
                    </p>
                    <ul class="hurry-where" data-testid="route-hurry-where">
                        <li><AvmText :text="t('planner.hurry.rule.whereYes')" /></li>
                        <li><AvmText :text="t('planner.hurry.rule.whereNo')" /></li>
                    </ul>
                    <p class="overview__landscapes" data-testid="route-hurry-sleds">
                        <AvmText :text="t('planner.hurry.rule.sleds')" />
                    </p>
                </template>
                <p v-else class="overview__landscapes" data-testid="route-hurry-none">
                    <AvmText :text="t('planner.hurry.none')" />
                </p>
                <p class="overview__landscapes" data-testid="route-hurry-strain">
                    <AvmText :text="t('planner.hurry.strain')" />
                </p>
            </AvmDisclosure>
            <AvmDisclosure
                v-if="ships"
                :label="ships.heading"
                data-testid="planning-ships"
                toggle-testid="ships-toggle"
            >
                <p v-for="line in ships.lines" :key="line" class="ships__line" data-testid="ship-line">
                    <AvmText :text="line" />
                </p>
            </AvmDisclosure>
            <!--
                EINE Klappbox für Landschaften, Sprachen und politische Gebiete (WI-0081, Betreiber 2026-10-05; Sprachen
                WI-0261 O8): der Deckel nennt die Zahlen, innen stehen zuerst die Landschaften, dann die Sprachen, darunter
                die Gebiete mit ihrer Hierarchie. Jede Liste bleibt für sich erkennbar (`route-landscapes`, `route-sprachen`,
                `route-territories`), der Deckel heißt `route-areas`.
            -->
            <AvmDisclosure
                v-if="
                    routeLandscapes.length > 0 ||
                    routeSprachenListe.length > 0 ||
                    (routeTerritories && routeTerritories.length > 0)
                "
                :label="areasLidText"
                data-testid="route-areas"
                toggle-testid="areas-toggle"
            >
                <div
                    v-if="showsAreaHeadings && routeLandscapes.length > 0"
                    class="overview__heading areas__heading avm-versalmitte"
                    data-testid="route-areas-heading-landscapes"
                >
                    {{ t("planner.summary.areas.heading.landscapes") }}
                </div>
                <div v-if="routeLandscapes.length > 0" data-testid="route-landscapes">
                    <template v-for="(entry, index) in routeLandscapes" :key="entry.key"
                        >{{ index > 0 ? ", " : ""
                        }}<button
                            v-if="entry.target"
                            type="button"
                            class="stage__link"
                            :title="entry.art || undefined"
                            @click.stop="emit('showLandscape', entry)"
                        >
                            {{ entry.name }}</button
                        ><span v-else :title="entry.art || undefined">{{ entry.name }}</span></template
                    >
                </div>
                <div
                    v-if="showsAreaHeadings && routeSprachenListe.length > 0"
                    class="overview__heading areas__heading avm-versalmitte"
                    data-testid="route-areas-heading-sprachen"
                >
                    {{ t("planner.summary.areas.heading.sprachen") }}
                </div>
                <div v-if="routeSprachenListe.length > 0" data-testid="route-sprachen">
                    <template v-for="(sprache, index) in routeSprachenListe" :key="sprache.ref.id"
                        >{{ index > 0 ? ", " : ""
                        }}<span class="areas__sprache"
                            ><span
                                class="areas__swatch"
                                :style="{ background: sprache.farbe }"
                                aria-hidden="true"
                                data-testid="route-sprache-swatch"
                            ></span
                            ><button type="button" class="stage__link" @click.stop="emit('showSubject', sprache.ref)">
                                {{ sprache.name }}</button
                            >&nbsp;<AvmText :text="sprachAnteil(sprache.anteil)" rolle="sekundaer" /></span
                    ></template>
                </div>
                <div
                    v-if="showsAreaHeadings && routeTerritories && routeTerritories.length > 0"
                    class="overview__heading areas__heading avm-versalmitte"
                    data-testid="route-areas-heading-territories"
                >
                    {{ t("planner.summary.areas.heading.territories") }}
                </div>
                <ul
                    v-if="routeTerritories && routeTerritories.length > 0"
                    class="territory-tree"
                    data-testid="route-territories"
                >
                    <li
                        v-for="{ entry, depth } in routeTerritories"
                        :key="entry.id"
                        class="territory-tree__row"
                        :class="{ 'territory-tree__row--child': depth > 0 }"
                        :style="{ '--territory-depth': depth }"
                        :data-territory-id="entry.id"
                    >
                        <InlineTextAction
                            v-if="entry.target"
                            class="stage__link"
                            :disabled="stale"
                            @activate="emit('showTerritory', entry)"
                            >{{ entry.name }}</InlineTextAction
                        ><span v-else>{{ entry.name }}</span>
                    </li>
                </ul>
            </AvmDisclosure>
            <UnterwegsBox
                v-if="unterwegsGruppenListe.length > 0"
                :gruppen="unterwegsGruppenListe"
                :gewaehlt="unterwegsAuswahl.zeilen.value"
                :farben="unterwegsAuswahl.farben.value"
                :stale="stale"
                @umschalten="unterwegsAuswahl.umschalten($event)"
                @entferne="unterwegsAuswahl.entferne($event)"
                @leere="unterwegsAuswahl.leere()"
                @oeffne="oeffneUnterwegs"
            />
        </section>
        <!-- Das Fenster hängt sich selbst an `body` (Hülle, Guide §12.6); hier steht es nur neben seinem Auslöser. -->
        <ReisePdfFenster
            v-if="pdfEingehaengt"
            v-model:offen="pdfOffen"
            :route="route"
            :options="options"
            :point-names="pointNames"
            :landscapes="landscapes"
            :unterwegs="unterwegs.liste.value"
            :custom-air-name="customAirName"
        />
    </div>
</template>

<style scoped>
.overview {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    min-height: 0;
    font-size: var(--font-size-body);
    line-height: var(--leading-normal);
}

/* Die Mini-Überschriften der Übersicht: gedämpft, klein, Versalien (Legacy `.route-plan-legs__title`). */
.overview__heading {
    margin: 0 0 1px;
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
    font-weight: var(--font-weight-bold);
    letter-spacing: 0.04em;
    line-height: var(--leading-tight);
    text-transform: uppercase;
}

/*
 * Trenner plus Überschrift über den beiden unteren Blöcken, über die ganze Breite (Legacy, Owner 2026-07-30;
 * Betreiber 2026-09-24: „zwischen Reiseetappen und Reiseübersicht fehlt ein breiter Trenner“). Die
 * erste Überschrift trägt keinen: der Kasten ist selbst gerahmt.
 *
 * 🔴 Seit dem 2026-10-05 steht REISEETAPPEN oben und ROUTENDETAILS darunter (Betreiber: „Routendetails unter
 * Reiseetappen“). Titel und Einstellungszeile bleiben, wo sie sind - sie gehören zum Kopf.
 */
.overview__heading--legs {
    margin-top: 9px;
    padding-top: 8px;
    border-top: 1px solid var(--color-divider);
}

/*
 * Titel links, 🔗 oben rechts (Legacy `.route-plan-summary__head`): `flex-start`, damit der Knopf bei
 * einem zwei- oder dreizeiligen Titel oben bleibt und nicht mittig mitwandert.
 */
.overview__head {
    display: flex;
    align-items: flex-start;
    gap: var(--space-4);
}

.overview__journey {
    flex: 1 1 auto;
    padding: var(--space-2) var(--space-4);
    border: 1px solid transparent;
    border-radius: var(--radius-md);
    background: transparent;
    color: var(--color-text);
    cursor: pointer;
    font: inherit;
    font-size: var(--font-size-reading);
    text-align: left;
    transition:
        color 120ms ease,
        background-color 120ms ease,
        border-color 120ms ease,
        box-shadow 120ms ease;
}

.overview__journey:hover {
    border-color: var(--color-border-strong);
    background: var(--color-hover-wash);
}

.overview__journey:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring, 0 0 0 3px var(--color-focus));
}

/*
 * 🔗 wie Legacys `.share-link-button--icon`: weicher Knopf, nur das Symbol, etwas größer als der Text.
 * Hover und Fokus heben ihn um einen Pixel und geben ihm Schatten (Legacy); gedrückt wird er dunkler,
 * ohne Hub (§13.22). Gesperrt, solange der Link entsteht (§30.5).
 */
.overview__share {
    flex: 0 0 auto;
    padding: var(--space-4) var(--space-6);
    border: 1px solid var(--color-button-soft-border);
    border-radius: var(--radius-md);
    background: var(--color-button-soft);
    color: var(--color-button-soft-text);
    cursor: pointer;
    font: inherit;
    font-size: var(--font-size-toast);
    line-height: var(--leading-tight);
    transition:
        background-color 120ms ease,
        box-shadow 120ms ease,
        transform 120ms ease;
}

.overview__share:hover,
.overview__share:focus-visible {
    background: var(--color-button-soft-hover);
    box-shadow: var(--shadow-button-hover);
    outline: none;
    transform: translateY(-1px);
}

.overview__share:focus-visible {
    box-shadow: var(--focus-ring, 0 0 0 3px var(--color-focus)), var(--shadow-button-hover);
}

.overview__share:active {
    background: var(--color-button-soft-active);
    box-shadow: none;
    transform: none;
}

.overview__share:disabled {
    border-color: var(--color-disabled-border);
    background: var(--color-disabled-bg);
    box-shadow: none;
    color: var(--color-disabled-text);
    cursor: not-allowed;
    transform: none;
}

/*
 * „Reise als PDF“ (WI-0306): derselbe weiche Knopf wie 🔗, mit allen seinen Zuständen; das Zeichen so hoch wie die Zeile des 🔗, damit beide
 * gleich hoch stehen. Die Buchstaben der Fahne stehen in der Fläche des Knopfs, auch beim Überfahren und Drücken.
 */
.overview__pdf {
    --pdf-zeichen-grund: var(--color-button-soft);
}

.overview__pdf svg {
    display: block;
    width: calc(var(--font-size-toast) * var(--leading-tight));
    height: calc(var(--font-size-toast) * var(--leading-tight));
}

.overview__pdf:hover,
.overview__pdf:focus-visible {
    --pdf-zeichen-grund: var(--color-button-soft-hover);
}

.overview__pdf:active {
    --pdf-zeichen-grund: var(--color-button-soft-active);
}

.overview__terminal {
    color: var(--color-text-strong);
}

/*
 * Die Einstellungszeile (Betreiber 2026-10-04): leise wie die Herleitung neben den Kennzahlen - gedämpft, Beschriftungsgröße -
 * und in derselben Einrückung wie diese (6 px), damit sie am Raster darunter steht. Der Zeilenabstand zum Titel nimmt den
 * Abstand der Spalte (`gap`) zurück: Sie gehört zum Titel, nicht zu den Kennzahlen. Gekürzt wird nur über `.einzeilig`
 * (app.vue); es setzt den unteren Rand selbst, ihn hier zu überschreiben nähme der Zeile den Platz für die Unterlängen.
 */
.overview__settings {
    margin-top: calc(-1 * var(--space-4));
    padding-inline: var(--space-4);
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
    line-height: var(--leading-snug);
}

/*
 * Drei Spalten in EINEM Raster, damit die Werte aller Zeilen untereinander stehen: Bezeichnung
 * gedämpft, Wert, leise die Herleitung (Legacy `.route-plan-summary__time`, §17.8). Nur die letzte
 * Spalte darf umbrechen, sonst schöbe eine lange Herleitung das Raster über die Panelbreite.
 */
.overview__figures {
    display: grid;
    grid-template-columns: auto max-content minmax(0, 1fr);
    align-items: baseline;
    gap: 1px 8px;
    padding: 0 6px 2px;
    font-size: var(--font-size-small);
    line-height: 1.32;
}

.figure__label {
    color: var(--color-text-muted);
}

.figure__value {
    white-space: nowrap;
}

.figure__note {
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
}

/*
 * Die Gesamtzeit ist das Ergebnis der ganzen Rechnung: eine Spur größer, kräftiger, unter einem Trenner.
 * Der zweite darunter ist weg (Betreiber 2026-09-24): Den Abschluss macht der breite Trenner über den
 * Reiseetappen.
 */
.figure__label.figure--total,
.figure__value.figure--total {
    color: var(--color-text-strong);
    font-size: var(--font-size-body);
}

/* Die Gesamtzeile setzt ein Trenner ab, nicht Fettung - die trüge nichts (§3). Er läuft über alle drei
   Spalten ohne Lücke. */
.figure__rule {
    grid-column: 1 / -1;
    margin: 5px 0 4px;
    border-top: 1px solid var(--color-divider);
}

/* Ein fehlender Betrag ist kein Wert: leise, damit „?“ nicht wie eine Zahl gelesen wird. */
.figure__value--unknown {
    color: var(--color-text-muted);
}

/*
 * 💣 Die Herleitung steht in den Reisekosten UNTER dem Betrag, nicht in einer dritten Spalte daneben (Betreiber
 * 2026-09-30, Dunkelmodus, Rechner: „1 × Gemeinschaftszimme“ / „r“). Legacy setzt sie in eine dritte Spalte
 * (`minmax(0, 1fr)`) und lässt dort `overflow-wrap: anywhere` mitten im Wort brechen, damit „Gemeinschaftszimmer“
 * das Raster nicht über die Panelbreite schiebt. Gemessen bei 350 px Panelbreite bleiben dort rund 125 px, das
 * längste Wort braucht 115: Schon ein Betrag wie „121 D 1 S 8 H“ oder ein Telefon mit 360 px bricht es, und die neuen
 * Zollvermerke („2 Landesgrenzen, als gutverdienender Beruf veranlagt“) sind noch länger. Legacys eigene Lösung für einen
 * langen Vermerk ist die leise Zeile darunter (der Erfassungsvermerk der Steigung, `route-planner.css`): Die Zahl bleibt
 * auf einen Blick lesbar, der Vorbehalt steht darunter. Zwei Spalten - Bezeichnung und Betrag mit Herleitung - lassen der
 * Herleitung die ganze Breite neben der Bezeichnung (rund 210 px); sie bricht an Leerzeichen, nie mitten im Wort.
 */
/*
 * 🔴 Die linke Kante der Zeilenbeschriftungen und der Fußnoten fluchtet mit dem Text der Kopfzeile („Reisekosten je Person“,
 * Betreiber 2026-10-04: „schau dass es mit dem header aligned“). Der Deckel gibt dem Inhalt sein Polster (`--space-16 / 2`,
 * 9 px, dasselbe wie der Kopfzeile links); die Tabelle trägt kein eigenes Polster daneben: `.overview__figures` hat 6 px für
 * die Kennzahlen oben, hier stünden die Beschriftungen damit 6 px rechts der Kopfzeile. Das Polster des Deckels bleibt, wie
 * es ist (der Versuch, es auf 4 px zu kürzen, ließ die Beschriftungen 5 px links vor der Kopfzeile stehen). Wächter:
 * `route-costs.spec.ts`.
 */
.overview__figures--costs {
    grid-template-columns: auto minmax(0, 1fr);
    row-gap: 0;
    padding-inline: 0;
}

.overview__figures--costs .figure__label,
.overview__figures--costs .figure__value {
    padding-top: 3px;
}

/*
 * Die Übernachtung hat eine Unterzeile je Dach (Betreiber 2026-10-04): „8 × im Gemeinschaftszimmer: 4 S 8 H ¹“,
 * „12 × im Freien ²“. Der Wert darf umbrechen (`figure__value` steht nowrap): am Doppelpunkt vor dem Betrag, nie im
 * Betrag selbst - er steht als Ganzes (`AvmWert`). Die Farben der Werte und des Textes setzen `AvmWert` und `AvmText` (Rolle
 * `sekundaer`), hier steht nur Größe und Umbruch; der Betrag in Wertgröße.
 */
.costs__nights {
    white-space: normal;
}

.costs__night {
    display: block;
    font-size: var(--font-size-caption);
}

.costs__night-amount {
    font-size: var(--font-size-small);
}

/*
 * Betrag und Fußnotenzahl bleiben zusammen („4 S 8 H¹“, nie „H“ und „¹“ getrennt): Passt die Zeile nicht, bricht sie davor,
 * nach dem Doppelpunkt - der Betrag samt Nummer rutscht als Ganzes in die nächste Zeile (Betreiber 2026-10-04).
 */
.costs__keep {
    white-space: nowrap;
}

.costs__note {
    grid-column: 2;
    /* Ein Wort bricht nur, wenn es allein nicht in die ganze Spalte passt - nie, solange die Spalte 200 px hat. */
    overflow-wrap: break-word;
    word-break: normal;
    hyphens: manual;
}

/* Der Zusatz unter dem Vermerk („Hafenzoll nicht beziffert“): eine eigene Zeile, gleiche leise Schrift. */
.costs__extra {
    display: block;
}

.borders {
    grid-column: 2;
    margin: 0 0 var(--space-2);
    font-size: var(--font-size-caption);
}

.borders__inner {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
}

.borders__list {
    display: flex;
    flex-direction: column;
    gap: 1px;
    margin: var(--space-2) 0 0;
    padding: 0;
    padding-inline-start: var(--space-12);
    color: var(--color-text);
    list-style: decimal;
}

/* Lange Namen („Heiliges Neues Kaiserreich vom Greifenthron zu Gareth“) müssen brechen dürfen. */
.borders__step {
    overflow-wrap: anywhere;
}

.borders__step > button {
    display: block;
}

/*
 * Die Routendetails: die Deckel untereinander unter der Gesamtzeit, über die ganze Breite (Legacy).
 *
 * 🔴 Etwas mehr Luft zwischen den kleinen Klappboxen (Betreiber 2026-10-29: „9 Flächen und 8 politische Gebiete -> mach etwas mehr abstand zwischen die
 * kleinen sektionen“): 10 px (`--space-8`) statt 6 (`--space-4`), ein Wert des Kanons und überall derselbe (`unterwegs-box.spec.ts` misst ihn). Der Abstand zwischen den
 * Blöcken der Übersicht (`--space-4`) bleibt, wie er ist.
 */
.planning {
    display: flex;
    flex-direction: column;
    gap: var(--space-8);
}
.overview__inline-info {
    display: inline-block;
    position: relative;
    width: var(--icon-sm);
    height: 0;
    vertical-align: middle;
}
.overview__inline-info > :deep(button) {
    position: absolute;
    top: 0;
    left: 0;
    transform: translateY(-50%);
}

.territory-tree {
    margin: 0;
    padding: 0;
    list-style: none;
}

/*
 * Landschaften und Gebiete stehen in EINER Klappbox (WI-0081): Folgt der Gebietsbaum der Namensreihe der Landschaften,
 * trennt sie derselbe Abstand wie zwei Textzeilen eines Deckels (`--space-4`, wie `.overview__landscapes`).
 */
.territory-tree:not(:first-child) {
    margin-top: var(--space-4);
}

/*
 * Die Unterüberschriften in der Flächenbox: dieselbe Miniüberschrift wie „ROUTENDETAILS“ und „REISEETAPPEN“
 * (`overview__heading`) - gedämpft, klein, Versalien, OHNE Grund, Kante und Pfeil. Ein zweiter Klappdeckel würde
 * versprechen, dass sich die beiden Teile einzeln auf- und zuklappen lassen; das sollen sie nicht.
 * Die Versalhöhe sitzt in der Mitte (Guide §3.2, `avm-versalmitte`) - eine neue Überschrift nimmt das Rezept mit.
 */
.areas__heading {
    margin: 0 0 var(--space-2);
}

/*
 * Zwischen einer Liste und der nächsten Überschrift steht deutlich mehr Luft als zwischen zwei Zeilen (WI-0261 O8, Betreiber 2026-11-01:
 * „schaff etwas abstand zwischen den sektionen (DEROGRAPHIE, SPRACHEN, ....)“; vorher `--space-6`).
 */
.areas__heading:not(:first-child) {
    margin-top: var(--space-12);
}

/* Eine Sprache bleibt mit Kästchen, Name und Anteil beisammen; umbrochen wird nur zwischen den Sprachen. */
.areas__sprache {
    white-space: nowrap;
}

/* Das Kästchen in der Kartenfarbe der Sprache, wie im Infopanel (`info-fields__swatch`). */
.areas__swatch {
    display: inline-block;
    width: var(--space-6);
    height: var(--space-6);
    margin-right: var(--space-2);
    border-radius: calc(var(--radius-sm) / 2);
    vertical-align: baseline;
}

.territory-tree__row {
    position: relative;
    padding-inline-start: calc(var(--territory-depth) * var(--space-12));
    overflow-wrap: anywhere;
    hyphens: auto;
}

.territory-tree__row + .territory-tree__row {
    margin-top: var(--space-2);
}

.territory-tree__row--child::before {
    content: "";
    position: absolute;
    top: calc(-1 * var(--space-2));
    inset-inline-start: calc(var(--territory-depth) * var(--space-12) - var(--space-8));
    width: var(--space-4);
    height: var(--space-12);
    border-inline-start: 1px solid var(--color-text-muted);
    border-bottom: 1px solid var(--color-text-muted);
    border-end-start-radius: var(--radius-sm);
    pointer-events: none;
}

.overview__landscapes,
.ships__line {
    margin: var(--space-4) 0 0;
    color: var(--color-text);
    font-size: inherit;
    line-height: var(--leading-normal);
}

/*
 * Die Rechnung des Eiltempos als Tabelle (WI-0087 P11): links die Benennung, rechts der Wert.
 *
 * 🔴 Hausmittel, keine neue Wertetafel: die vorhandenen Sprossen (`--space-*`), der gedämpfte Ton für die Benennung
 * und `AvmText` für den Wert - der hebt die Zahl hervor und lässt die Einheit gedämpft (Klappbox-Regel, Guide
 * §16.3). Die Benennung bricht nicht um (`auto`-Spalte), der Wert darf es.
 */
.hurry-table {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: var(--space-2) var(--space-8);
    margin: var(--space-4) 0 0;
    line-height: var(--leading-normal);
}

.hurry-table__label {
    margin: 0;
    color: var(--color-text-muted);
}

.hurry-table__value {
    margin: 0;
    color: var(--color-text);
}

/*
 * Die Aufzählung in der Regel des Eiltempos (WI-0087 P11): Was im Fließtext eine Aufzählung war, steht jetzt als
 * eine - Wort für Wort dieselbe. Der Punkt davor ist der gewöhnliche Listenpunkt des Hauses, eingerückt wie ein
 * Absatz und mit demselben Zeilenabstand.
 */
.hurry-where {
    margin: var(--space-4) 0 0;
    padding-left: var(--space-16);
    color: var(--color-text);
    line-height: var(--leading-normal);
}

.hurry-where li + li {
    margin-top: var(--space-2);
}

/*
 * Ein Name, auf den man klicken kann: 13 px Goldbraun, ein Knopf, der wie ein Link aussieht und sich so verhält
 * (§17.8). Hier tragen ihn die Listen der ganzen Reise - Landschaften, Gebiete, Grenzübertritte; die Etappenzeile
 * hat seit WI-0079 ihre eigene (`route-stage-row.vue`).
 */
.stage__link {
    padding: 0;
    border: 0;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--color-link);
    cursor: pointer;
    font: inherit;
    /*
     * Ein <button> bringt vom Browser `text-align: center` mit, und `font: inherit` holt die Ausrichtung
     * nicht zurück. Bricht ein Name um („Grenzfelden-Zweifelsfels-Falding, Grafenpfad“), stand er sonst
     * mittig im Fließtext (Betreiber 2026-09-24; Legacy `.route-plan-entry__waylink` hatte denselben Fehler).
     */
    text-align: inherit;
    transition:
        color 120ms ease,
        box-shadow 120ms ease;
}

.stage__link:hover {
    color: var(--color-link-hover);
    text-decoration: underline;
}

.stage__link:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring, 0 0 0 3px var(--color-focus));
}

/* Die Pfeile der Steigung als Schrift, nie als farbiges Emoji. */
.richtung {
    font-variant-emoji: text;
}

/* Während neu gerechnet wird, tritt die alte Übersicht zurück - gesperrt heißt hier: gerade nicht.
   Die Etappenliste dämpft sich selbst (`route-stage-list.vue`, `is-stale`). */
.overview--stale .overview__settings,
.overview--stale .overview__figures {
    opacity: 0.55;
    pointer-events: none;
}

@media (prefers-reduced-motion: reduce) {
    .overview__share,
    .overview__share:hover,
    .overview__share:focus-visible {
        transition: none;
        transform: none;
    }

    .overview__journey,
    .stage__link,
    .borders {
        transition: none;
    }
}
</style>
