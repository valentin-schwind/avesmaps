<script setup lang="ts">
import { computed } from "vue";
import AvmText from "../controls/avm-text.vue";
import AvmFenster from "../fenster/avm-fenster.vue";
import FensterKarte from "../fenster/fenster-karte.vue";
import FensterMauer from "../fenster/fenster-mauer.vue";
import FensterQuellen from "../fenster/fenster-quellen.vue";
import FensterTafel from "../fenster/fenster-tafel.vue";
import FensterText from "../fenster/fenster-text.vue";
import { formatDecimal, formatList, formatNumber, isMessageKey, t } from "../i18n/i18n";
import { climateZoneName } from "../map/climate-zones";
import { formatMoney, groundLabel, lodgingLabel, OPTIONS_INFO_ICONS, transportShortLabel } from "./planner-model";
import { nonStopTransports } from "./transport-info-model";
import {
    climateRows,
    coachFare,
    groundLosses,
    groundSeasons,
    lodgingRows,
    optimizeExample,
    restDay,
    snowlineCondition,
    transferPenalty,
    minBorderMiles,
    upstreamFactor,
    type LodgingRow,
} from "./route-options-info-model";

/**
 * Das Erklärfenster hinter ⓘ „Reiseoptionen“ (WI-0045 Stufe B; Legacy `js/routing/route-options-info.js`,
 * Guide §17.12). Ein Blatt in der Breite `tafel`, gebaut nach dem Rezept in Guide §12.6: diese Datei
 * liefert NUR den Inhalt, die Hülle ist `AvmFenster`.
 *
 * - Fünf Karten, je Option eine, jede mit ihrer Wirkungsklasse (§17.12): „sucht neu“ goldbraun, weil
 *   nur sie den Weg ändert, „rechnet“ und „kostet“ gedämpft.
 * - Die Karten stehen als Mauerwerk (`FensterMauer`, WI-0076): jede so hoch wie ihr Inhalt, Lesespalten nebeneinander,
 *   so viele der Platz erlaubt. Die Quellen stehen darunter über die ganze Breite (vorher am Fuß der linken Spalte).
 * - Jede Zahl rechnet `route-options-info-model.ts` aus unserem Reisemodell. 🔴 „Reisebeginn“ sucht bei
 *   uns neu (WI-0038 E2), Legacy nannte es „rechnet“.
 */
const offen = defineModel<boolean>("offen", { required: true });

const optimize = computed(() => {
    const example = optimizeExample();
    const tail = example
        ? t("planner.optionsInfo.optimize.example", {
              passMin: formatDecimal(example.passMin, 2),
              passMax: formatDecimal(example.passMax, 2),
              roadMax: formatDecimal(example.roadMax, 2),
          })
        : "";
    // Aufzählung und Beispiel als eigene Blöcke (`FensterText`: Leerzeile = neuer Absatz; WI-0076).
    return tail ? `${t("planner.optionsInfo.optimize.body")}\n\n${tail}` : t("planner.optionsInfo.optimize.body");
});

const transfers = computed(
    () =>
        `${t("planner.optionsInfo.transfers.body", { penalty: formatNumber(transferPenalty(), 0) })}\n\n${t("planner.optionsInfo.transfers.note")}`,
);

const day = restDay();
const rest = computed(() => ({
    body: t("planner.optionsInfo.rest.body", {
        hours: formatNumber(day.hours, 0),
        restHours: formatNumber(day.restHours, 0),
    }),
    note: t("planner.optionsInfo.rest.note", {
        landHours: formatNumber(day.landHours, 0),
        waterHours: formatNumber(day.waterHours, 0),
        nonStop: formatList(nonStopTransports().map(transportShortLabel)),
    }),
}));

const seasons = groundSeasons();
const climate = climateRows();
/** Was der Boden kostet, in ganzen Prozent aus der Bodentafel (WI-0258): zu Fuß und die Kutsche als Gegenbeispiel. */
const losses = groundLosses();
const snowline = snowlineCondition();
const ground = computed(() => {
    // Der Boden über der Schneegrenze (Betreiber 2026-10-04, „B“: auch anteilig), aus dem Reisemodell; ohne ihn kein Satz.
    const mountain = snowline ? ` ${t("planner.optionsInfo.start.snowline", { ground: groundLabel(snowline) })}` : "";
    const exempt = `${t("planner.optionsInfo.start.exempt")}${mountain}`;
    if (!losses) return exempt;
    const percent = (value: number) => formatNumber(value, 0);
    const penalty = t("planner.optionsInfo.start.penalty", {
        road: percent(losses.road),
        pass: percent(losses.pass),
        soft: percent(losses.soft),
        snow: percent(losses.snow),
        deep: percent(losses.deep),
    });
    const example = t("planner.optionsInfo.start.example", {
        coachRoad: percent(losses.coachRoad),
        coachDeep: percent(losses.coachDeep),
    });
    return `${penalty}\n\n${example} ${exempt}`;
});

const lodging = lodgingRows();
const lodgingNote = computed(() =>
    t("planner.optionsInfo.lodging.note", {
        open: lodgingLabel("frei"),
        factor: formatNumber(upstreamFactor(), 0),
        coach: formatMoney(coachFare()),
        miles: formatNumber(minBorderMiles(), 0),
    }),
);

/** Die Stallspalte: je Nacht unter Dach, im Freien Futter je Woche (Legacy: dieselbe Spalte, eine andere Rechnung). */
function stableText(row: LodgingRow): string {
    return "perNight" in row.stable
        ? formatMoney(row.stable.perNight)
        : t("planner.optionsInfo.lodging.perWeek", { money: formatMoney(row.stable.perWeek) });
}

/** Die Namen der Zonen einer Zeile - aus derselben Stelle, die Karte, Panel und Suche nennen (WI-0171). */
function zoneNames(zones: readonly string[]): string {
    return zones.map((zone) => climateZoneName(zone)).join(", ");
}

function seasonName(season: string): string {
    const key = `planner.season.${season}`;
    return isMessageKey(key) ? t(key) : season;
}
</script>

<template>
    <AvmFenster
        v-model:offen="offen"
        bauart="blatt"
        breite="tafel"
        zeichen="info"
        :titel="t('planner.options.heading')"
        testid="options-info"
    >
        <FensterText class="einleitung" :text="t('planner.optionsInfo.intro')" />

        <!--
            Mauerwerk (WI-0076, Betreiber 2026-10-04: „boxen in flexiblen höhen“), gelesen spaltenweise: links, was die Route
            wählt (Schnellste · Kürzeste, Umsteigen), und was sie kostet; rechts Reisestunden und Reisebeginn. Wo die
            Spalte bricht, entscheidet der Browser; diese Reihenfolge hält sie bei 1280 und 1440 Breite an dieser Stelle.
        -->
        <FensterMauer>
            <FensterKarte :titel="t('planner.optionsInfo.optimize.title')" :bild="OPTIONS_INFO_ICONS.optimize">
                <template #etikett>
                    <span class="etikett etikett--search">{{ t("planner.optionsInfo.tag.search") }}</span>
                </template>
                <FensterText class="text" :text="optimize" />
            </FensterKarte>

            <FensterKarte :titel="t('planner.optionsInfo.transfers.title')" :bild="OPTIONS_INFO_ICONS.transfers">
                <template #etikett>
                    <span class="etikett etikett--search">{{ t("planner.optionsInfo.tag.search") }}</span>
                </template>
                <FensterText class="text" :text="transfers" />
            </FensterKarte>

            <FensterKarte :titel="t('planner.optionsInfo.lodging.title')" :bild="OPTIONS_INFO_ICONS.lodging">
                <template #etikett>
                    <span class="etikett">{{ t("planner.optionsInfo.tag.costs") }}</span>
                </template>
                <FensterText class="text" :text="t('planner.optionsInfo.lodging.body')" />
                <!-- Ein Betrag ist ein Wert: Zahl hell, Münze gedämpft, „—“ leise (AvmText, Rolle „sekundär“). -->
                <FensterTafel :beschriftung="t('planner.optionsInfo.lodging.title')" dicht>
                    <table data-testid="options-info-lodging">
                        <thead>
                            <tr>
                                <th scope="col">{{ t("planner.optionsInfo.lodging.level") }}</th>
                                <th scope="col">{{ t("planner.optionsInfo.lodging.bed") }}</th>
                                <th scope="col">{{ t("planner.optionsInfo.lodging.food") }}</th>
                                <th scope="col">{{ t("planner.optionsInfo.lodging.stable") }}</th>
                                <th scope="col">{{ t("planner.optionsInfo.lodging.toll") }}</th>
                                <th scope="col">
                                    {{ t("planner.optionsInfo.lodging.river") }}<br />{{
                                        t("planner.optionsInfo.lodging.per100")
                                    }}
                                </th>
                                <th scope="col">
                                    {{ t("planner.optionsInfo.lodging.sea") }}<br />{{
                                        t("planner.optionsInfo.lodging.per100")
                                    }}
                                </th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr v-for="row in lodging" :key="row.level">
                                <th scope="row">{{ lodgingLabel(row.level) }}</th>
                                <td><AvmText :text="formatMoney(row.bed)" rolle="sekundaer" /></td>
                                <td><AvmText :text="formatMoney(row.food)" rolle="sekundaer" /></td>
                                <td><AvmText :text="stableText(row)" rolle="sekundaer" /></td>
                                <td><AvmText :text="formatMoney(row.toll)" rolle="sekundaer" /></td>
                                <td><AvmText :text="formatMoney(row.river)" rolle="sekundaer" /></td>
                                <td><AvmText :text="formatMoney(row.sea)" rolle="sekundaer" /></td>
                            </tr>
                        </tbody>
                    </table>
                </FensterTafel>
                <FensterText class="text" :text="lodgingNote" />
            </FensterKarte>

            <FensterKarte :titel="t('planner.optionsInfo.rest.title')" :bild="OPTIONS_INFO_ICONS.rest">
                <template #etikett>
                    <span class="etikett">{{ t("planner.optionsInfo.tag.computes") }}</span>
                </template>
                <FensterText class="text" :text="rest.body" />
                <FensterText class="text" :text="rest.note" />
            </FensterKarte>

            <FensterKarte :titel="t('planner.optionsInfo.start.title')" :bild="OPTIONS_INFO_ICONS.start">
                <template #etikett>
                    <span class="etikett etikett--search">{{ t("planner.optionsInfo.tag.search") }}</span>
                </template>
                <FensterText class="text" :text="t('planner.optionsInfo.start.body')" />
                <FensterTafel :beschriftung="t('planner.optionsInfo.start.zone')" art="text" dicht>
                    <table data-testid="options-info-climate">
                        <thead>
                            <tr>
                                <th scope="col">{{ t("planner.optionsInfo.start.zone") }}</th>
                                <th v-for="season in seasons" :key="season" scope="col">
                                    {{ seasonName(season) }}
                                </th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr v-for="row in climate" :key="row.zones.join()">
                                <th scope="row">{{ zoneNames(row.zones) }}</th>
                                <td
                                    v-for="(condition, index) in row.conditions"
                                    :key="seasons[index]"
                                    :data-leer="condition === null ? '' : undefined"
                                >
                                    <template v-if="condition === null">–</template>
                                    <AvmText v-else :text="groundLabel(condition)" />
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </FensterTafel>
                <FensterText class="text" :text="ground" />
                <FensterText
                    class="text"
                    :text="`${t('planner.optionsInfo.start.note')}\n\n${t('planner.optionsInfo.start.canon')}`"
                />
            </FensterKarte>
        </FensterMauer>

        <FensterQuellen
            :grundlage="t('planner.optionsInfo.sources.lead')"
            :werke="t('planner.optionsInfo.sources.works')"
            :anmerkung="t('planner.optionsInfo.sources.note')"
        />
    </AvmFenster>
</template>

<style scoped>
/*
 * Nur der Inhalt: Hülle, Kopf, Rumpf und ihre Maße gehören `AvmFenster`, Karte, Tafel und Quellen
 * ihren Bausteinen. Die Werte sind Legacys `css/features/route-options-info.css`, auf Kanon-Tokens,
 * mit derselben Schriftfarbe je Rolle wie das Fenster „Transportmittel“.
 */
.einleitung {
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
    line-height: var(--leading-normal);
}

.text {
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
    font-weight: var(--font-weight-regular);
    line-height: var(--leading-normal);
}

/*
 * Die Wirkungsklasse (§17.12): Sie sagt, WORAUF eine Option wirkt, und steht in der Aufschrift, damit sie
 * keine Höhe kostet. Nur „sucht neu“ ist goldbraun - eine Warnung und zwei Auskünfte.
 */
.etikett {
    flex: none;
    margin-left: auto;
    padding: 0 var(--space-6);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
    font-weight: var(--font-weight-regular);
    letter-spacing: 0;
    line-height: var(--leading-snug);
    white-space: nowrap;
}

.etikett--search {
    border-color: var(--color-accent-strong);
    color: var(--color-accent-strong);
}
</style>
