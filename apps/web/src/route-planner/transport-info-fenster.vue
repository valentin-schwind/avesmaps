<script setup lang="ts">
import { computed, ref, watch } from "vue";
import AvmText from "../controls/avm-text.vue";
import AvmFenster from "../fenster/avm-fenster.vue";
import FensterKarte from "../fenster/fenster-karte.vue";
import FensterMauer from "../fenster/fenster-mauer.vue";
import FensterQuellen from "../fenster/fenster-quellen.vue";
import FensterReiter from "../fenster/fenster-reiter.vue";
import FensterTafel from "../fenster/fenster-tafel.vue";
import FensterText from "../fenster/fenster-text.vue";
import { formatDecimal, formatList, formatNumber, isMessageKey, t } from "../i18n/i18n";
import { DOMAIN_ICONS, PATH_ICONS, pathLabel, REST_ICON, TRANSPORT_ICONS, transportShortLabel } from "./planner-model";
import {
    crossCountryRange,
    landSpeedTable,
    nonStopTransports,
    offroadRampMax,
    paceExample,
    travelDay,
    waterSpeeds,
} from "./transport-info-model";
import TransportInfoFlug from "./transport-info-flug.vue";
import TransportInfoGebirge from "./transport-info-gebirge.vue";

/**
 * Das Erklärfenster hinter ⓘ „Transportmittel“ (WI-0045; Legacy `js/routing/transport-speed-info.js`,
 * Guide §17.9). Ein Blatt in der Breite `tafel`, gebaut nach dem Rezept in Guide §12.6: diese Datei
 * liefert NUR den Inhalt, die Hülle ist `AvmFenster`.
 *
 * - Der Titel ist die Aufschrift der Gruppe, an der das ⓘ hängt (Legacy-Owner 2026-08-03).
 * - Die Zahlen rechnet `transport-info-model.ts` aus unserem Reisemodell: das Tempo, mit dem die
 *   Route wirklich rechnet, nicht Legacys überhöhte Tafel (WI-0017, C7). Auch die Reisestunden und
 *   Tagesleistungen der Schiffe kommen aus dem Modell (WI-0069), keine steht im Satz.
 * - Neun Landmittel machen die Tafel breiter als ein Telefon: Sie rollt waagerecht (`FensterTafel`), die
 *   Spalte der Wegtypen bleibt dabei stehen.
 * - Alle Tafeln sind `FensterTafel` (WI-0076, Betreiber 2026-10-04: „Tabelle B“): Die Tempotafel ist deren Matrix
 *   (Kopfband um beide Achsen, Ampel über `data-tier`), Fluss und Meer Zahlentafeln; die Werte laufen über `AvmText`.
 *   Hier stehen keine Tabellenregeln.
 * - Drei Reiter (WI-0049, Betreiber 2026-09-28): „Land und Wasser“ ist die Tempotafel, „Gebirge“ die
 *   Steigung mit Kurvenbild (`transport-info-gebirge.vue`). Das ersetzt Legacys Knopf „Die Kurven
 *   ansehen“, der ein zweites Fenster öffnete. „Flug“ erklärt die Flugmittel und wie ein Flug über oder um
 *   die Berge geht (`transport-info-flug.vue`, WI-0051, Betreiber: „du machst den reiter für flug“).
 */
const offen = defineModel<boolean>("offen", { required: true });
const props = defineProps<{
    /** Mit welchem Reiter das Fenster aufgeht; „Details zur Höhenberechnung“ im Planer öffnet „Gebirge“. */
    startReiter?: "land" | "gebirge" | "flug";
}>();

/** Der sichtbare Reiter; jedes Öffnen beginnt beim Startreiter, sonst bei der Tempotafel. */
const reiter = ref<"land" | "gebirge" | "flug">(props.startReiter ?? "land");
const REITER = computed(() => [
    { id: "land" as const, name: t("transportInfo.tab.land") },
    { id: "gebirge" as const, name: t("transportInfo.tab.mountains") },
    { id: "flug" as const, name: t("transportInfo.tab.air") },
]);
watch(offen, (jetzt) => {
    if (jetzt) reiter.value = props.startReiter ?? "land";
});

const table = landSpeedTable();
const river = waterSpeeds("river");
const sea = waterSpeeds("sea");
const day = travelDay();
const water = computed(() => [
    {
        domain: "river" as const,
        titel: t("transportInfo.riverTravel"),
        rows: river,
        note: t("transportInfo.riverNote"),
    },
    {
        domain: "sea" as const,
        titel: t("transportInfo.seaTravel"),
        rows: sea,
        note: t("transportInfo.seaNote", { nonStop: formatList(nonStopTransports().map(transportShortLabel)) }),
    },
]);

/** Die Spalten der Tafel sind gleich breit; ihre Zahl kommt aus dem Modell, nicht aus dem Stylesheet. */
const columns = { "--spalten": String(table.transports.length + 1) };

function pathTypeLabel(pathType: string): string {
    const key = `transportInfo.path.${pathType}`;
    return isMessageKey(key) ? t(key) : pathLabel(pathType);
}

function speedText(speed: number | null): string {
    return speed === null ? "" : formatDecimal(speed, 2);
}

function milesText(miles: number | null): string {
    return miles === null ? "" : formatNumber(miles, 0);
}

/** Das Beispiel der Einleitung: die Gruppe zu Fuß auf Reichsstraße und Gebirgspass, gerechnet wie die Tafel (WI-0076). */
const intro = computed(() => {
    const pace = paceExample();
    return t("transportInfo.intro", {
        road: pace ? formatDecimal(pace.road, 1) : "",
        pass: pace ? formatDecimal(pace.pass, 1) : "",
    });
});

const crossCountry = computed(() => {
    const range = crossCountryRange();
    const text = range
        ? t("transportInfo.crossCountry.range", {
              min: formatDecimal(range.min, 2),
              max: formatDecimal(range.max, 2),
          })
        : "";
    return t("transportInfo.crossCountry", { range: text, ramp: formatDecimal(offroadRampMax(), 1) });
});

/** Die Regeln unter den Tafeln, je eine Karte mit Aufschrift und Bild (WI-0076; vorher Bild und Absatz ohne Rahmen). */
const regeln = computed(() => [
    { key: "rest", titel: t("transportInfo.rest.title"), bild: REST_ICON, text: t("transportInfo.rest", day) },
    {
        key: "crossCountry",
        titel: t("transportInfo.crossCountry.title"),
        bild: PATH_ICONS.Querfeldein,
        text: crossCountry.value,
    },
    {
        key: "sleigh",
        titel: t("transportInfo.sleigh.title"),
        bild: TRANSPORT_ICONS.sleigh,
        text: t("transportInfo.sleigh"),
    },
    {
        key: "slope",
        titel: t("transportInfo.slope.title"),
        bild: PATH_ICONS.Gebirgspass,
        text: t("transportInfo.slope", { tab: t("transportInfo.tab.mountains") }),
    },
]);
</script>

<template>
    <AvmFenster
        v-model:offen="offen"
        bauart="blatt"
        breite="tafel"
        zeichen="info"
        :titel="t('planner.transport.heading')"
        testid="transport-info"
    >
        <FensterReiter
            v-model="reiter"
            :reiter="REITER"
            :beschriftung="t('transportInfo.tabs.aria')"
            kennung="transport-info"
        />

        <div
            v-if="reiter === 'gebirge'"
            id="transport-info-inhalt-gebirge"
            class="reiter-inhalt"
            role="tabpanel"
            aria-labelledby="transport-info-reiter-gebirge"
        >
            <TransportInfoGebirge />
        </div>
        <div
            v-else-if="reiter === 'flug'"
            id="transport-info-inhalt-flug"
            class="reiter-inhalt"
            role="tabpanel"
            aria-labelledby="transport-info-reiter-flug"
        >
            <TransportInfoFlug />
        </div>
        <div
            v-else
            id="transport-info-inhalt-land"
            class="reiter-inhalt"
            role="tabpanel"
            aria-labelledby="transport-info-reiter-land"
        >
            <FensterText class="einleitung" :text="intro" />

            <FensterKarte :titel="t('transportInfo.landTravel')" :bild="DOMAIN_ICONS.land">
                <FensterTafel :beschriftung="t('transportInfo.landTravel')" art="matrix">
                    <table :style="columns" data-testid="transport-info-table">
                        <thead>
                            <tr>
                                <th scope="col">{{ t("transportInfo.pathTypeHeader") }}</th>
                                <th v-for="transport in table.transports" :key="transport" scope="col">
                                    <span class="fenster-tafel__kopf">
                                        <img :src="TRANSPORT_ICONS[transport]" alt="" />
                                        <span>{{ transportShortLabel(transport) }}</span>
                                    </span>
                                </th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr data-testid="transport-info-day-miles">
                                <th scope="row">{{ t("transportInfo.dayMiles") }}</th>
                                <td v-for="(miles, index) in table.dayMiles" :key="table.transports[index]">
                                    <AvmText :text="milesText(miles)" />
                                </td>
                            </tr>
                            <tr v-for="row in table.rows" :key="row.pathType">
                                <th scope="row">
                                    <span class="fenster-tafel__name">
                                        <img :src="PATH_ICONS[row.pathType]" alt="" />
                                        <span>{{ pathTypeLabel(row.pathType) }}</span>
                                    </span>
                                </th>
                                <!-- Die Ampel trägt Fläche UND Schrift (§17.9): Die Zahl steht in der Farbe ihrer Stufe, nicht über AvmWert. -->
                                <td v-for="cell in row.cells" :key="cell.transport" :data-tier="cell.tier ?? 'nie'">
                                    <template v-if="cell.speed !== null">{{ speedText(cell.speed) }}</template>
                                    <span v-else :aria-label="t('transportInfo.never')">–</span>
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </FensterTafel>
                <ul class="legende">
                    <li><i class="legende__farbe" data-tier="schnell"></i>{{ t("transportInfo.legend.fast") }}</li>
                    <li><i class="legende__farbe" data-tier="mittel"></i>{{ t("transportInfo.legend.mid") }}</li>
                    <li><i class="legende__farbe" data-tier="langsam"></i>{{ t("transportInfo.legend.slow") }}</li>
                </ul>
            </FensterKarte>

            <!--
                Fluss, Meer und die Regeln als Mauerwerk (WI-0076: Karten in flexiblen Höhen). Gelesen wird spaltenweise:
                erst die Schiffe, dann Reisetag, Querfeldein, Schlitten und Steigung.
            -->
            <FensterMauer>
                <FensterKarte
                    v-for="card in water"
                    :key="card.domain"
                    :titel="card.titel"
                    :bild="DOMAIN_ICONS[card.domain]"
                >
                    <FensterTafel :beschriftung="card.titel">
                        <table :data-testid="`transport-info-${card.domain}`">
                            <thead>
                                <tr>
                                    <th scope="col">{{ t("transportInfo.water.transport") }}</th>
                                    <th scope="col">{{ t("transportInfo.water.miles") }}</th>
                                    <th scope="col">{{ t("transportInfo.water.hours") }}</th>
                                    <th scope="col">
                                        {{ t("transportInfo.water.speed") }}
                                        <template v-if="card.domain === 'river'">
                                            <br />{{ t("transportInfo.water.downstream") }}
                                        </template>
                                    </th>
                                    <th v-if="card.domain === 'river'" scope="col">
                                        {{ t("transportInfo.water.speed") }}<br />{{
                                            t("transportInfo.water.upstream")
                                        }}
                                    </th>
                                </tr>
                            </thead>
                            <tbody>
                                <tr v-for="row in card.rows" :key="row.transport" :data-transport="row.transport">
                                    <th scope="row">
                                        <span class="fenster-tafel__name">
                                            <img :src="TRANSPORT_ICONS[row.transport]" alt="" />
                                            <span>{{ transportShortLabel(row.transport) }}</span>
                                        </span>
                                    </th>
                                    <td><AvmText :text="milesText(row.miles)" /></td>
                                    <td>
                                        <AvmText :text="formatNumber(row.hours, 0)" />
                                        <span v-if="row.nonStop" class="fenster-tafel__zusatz">
                                            {{ t("transportInfo.water.nonStop") }}
                                        </span>
                                    </td>
                                    <td><AvmText :text="speedText(row.speed)" /></td>
                                    <td v-if="card.domain === 'river'"><AvmText :text="speedText(row.upstream)" /></td>
                                </tr>
                            </tbody>
                        </table>
                    </FensterTafel>
                    <FensterText class="notiz" :text="card.note" />
                </FensterKarte>
                <FensterKarte
                    v-for="regel in regeln"
                    :key="regel.key"
                    :titel="regel.titel"
                    :bild="regel.bild"
                    :data-testid="`transport-info-regel-${regel.key}`"
                >
                    <FensterText class="notiz" :text="regel.text" />
                </FensterKarte>
            </FensterMauer>

            <FensterQuellen :grundlage="t('transportInfo.sources.lead')" :werke="t('transportInfo.sources.works')" />
        </div>
    </AvmFenster>
</template>

<style scoped>
/*
 * Nur der Inhalt: Hülle, Kopf, Rumpf und ihre Maße gehören `AvmFenster`. Die Werte sind Legacys
 * `css/features/transport-speed-info.css`, auf Kanon-Tokens. Eine Schriftfarbe je ROLLE (Legacy
 * design-language „Text colour by role“): Lesetext gedämpft, Achsen gedämpft, Aufschriften goldbraun,
 * Betonungen stark.
 */
/* Der Inhalt eines Reiters steht im Takt des Rumpfs, als wäre er dessen Kind (`--divider-gap`). */
.reiter-inhalt {
    display: flex;
    flex-direction: column;
    gap: var(--divider-gap);
}

.einleitung {
    color: var(--color-text-muted);
    line-height: var(--leading-normal);
}

.legende {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-4) var(--space-16);
    margin: 0;
    padding: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
    list-style: none;
}

.legende__farbe {
    display: inline-block;
    width: var(--space-10);
    height: var(--space-10);
    margin-right: var(--space-4);
    border-radius: var(--radius-sm);
    vertical-align: middle;
}

/* Die Farbfelder der Legende: dieselben Tokenpaare wie die Ampel in der Tafel (FensterTafel, §17.9). */
.legende__farbe[data-tier="schnell"] {
    background: var(--color-tier-fast-bg);
}

.legende__farbe[data-tier="mittel"] {
    background: var(--color-tier-mid-bg);
}

.legende__farbe[data-tier="langsam"] {
    background: var(--color-tier-slow-bg);
}

.notiz {
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
    line-height: var(--leading-normal);
}
</style>
