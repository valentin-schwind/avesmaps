<script setup lang="ts">
import { computed } from "vue";
import { t } from "../i18n/i18n";
import StageLink from "./stage-link.vue";
import WaypointMark, { MARK_CHAIN_ANCHOR } from "./waypoint-mark.vue";
import type { StageStationModel } from "./stage-list-model";

/**
 * Eine Wegpunktstation in der Etappenkette (WI-0079 §1.3): Start, Zwischenziel und Ziel der Reise stehen als
 * Station in derselben Kette wie die Etappen, ohne zweite Nummerierung.
 *
 * 🔴 Seit WI-0087 P5 steht sie **immer** auf der obersten Ebene der Liste und kann nicht mit eingeklappt werden
 * (Betreiber 2026-10-05: „die zwischenziele verschwinden wenn die etappenzusammenfassungen eingeklappt sind");
 * welche Gruppen sie teilt, entscheidet das Listenmodell, nicht diese Vorlage.
 *
 * 🔴 Ihre Marke ist DIESELBE wie in der Wegpunkteingabe (`waypoint-mark.vue`, Guide §17.4: „die Markerfarbe
 * kodiert die Rolle“): der Ring für Start und Zwischenziel, die Nadel für das Ziel. Vorher stand hier eine
 * schlichte Scheibe für beide, und genau diese Unstimmigkeit hat der Betreiber am 2026-10-05 gemeldet. Ihr Saum im
 * Panelgrund stanzt die Kette aus.
 *
 * 🔴 **Und in DERSELBEN Größe** (WI-0097, Betreiber 2026-10-07: „die icons der wegpunktmarkierung und der tropfen
 * sollten im routenplaner und bei den etappen gleich groß sein"). Hier stand `:size="13"`, oben galt die Vorgabe 18;
 * „dieselbe Marke" stimmte für die Form, nicht für die Größe. Die Zeile sagt jetzt NICHTS über die Größe - sie steht
 * als `MARK_SIZE` bei der Gestalt. 🪤 Die Zeilenhöhe bleibt, weil der Text zweizeilig höher ist als die Nadel; die
 * Kette hängt an einem ANTEIL der Markenhöhe (`MARK_CHAIN_ANCHOR`) und trifft deshalb in jeder Größe.
 *
 * **Die zweite Zeile** (WI-0087 P3, Betreiber 2026-10-05: „statt Dragenfels lieber Dragenfels / Dorf · in Baronie
 * Königlich Mardershöh") nennt die Ortsklasse und das unterste Gebiet mit Namen, gedämpft, in der Gestalt der
 * Untertitel des Infopanels (Guide §16). 🪤 Fehlt ein Teil, entfällt er samt seinem Trenner - nie ein leeres „in —“;
 * fehlen beide, gibt es keine zweite Zeile.
 */
const props = defineProps<{ station: StageStationModel; stale: boolean }>();
const emit = defineEmits<{ open: []; openTerritory: [] }>();

/** Die Stelle, an der der Name in der Satzvorlage steht (wie `namedParts` im Panel): Der Name bleibt ein eigener Link. */
const NAME_MARK = "\u0001";

/**
 * „in <Baronie Königlich Mardershöh>“ als drei Teile. 🔴 Die Satzvorlage ist DIESELBE wie im Untertitel des Panels
 * (`infoPanel.inTerritory`, `panel-header.ts`) - eine Aussage, ein Text, eine Übersetzung.
 */
const inTerritory = computed(() => {
    const territory = props.station.territory;
    if (territory === undefined) return null;
    const [before = "", after = ""] = t("infoPanel.inTerritory", { name: NAME_MARK }).split(NAME_MARK);
    return { before, after, name: territory.name };
});

/** Die zweite Zeile steht nur, wenn sie etwas zu sagen hat. */
const hasDetail = computed(() => props.station.kindLabel !== undefined || props.station.territory !== undefined);
</script>

<template>
    <li class="station" data-testid="route-station">
        <span
            class="station__mark stages__mark"
            :class="`station__mark--${station.kind}`"
            :data-chain-anchor="MARK_CHAIN_ANCHOR[station.kind]"
            aria-hidden="true"
            ><WaypointMark :rolle="station.kind"
        /></span>
        <!-- 🪤 Die Leerzeichen stehen ausdrücklich da: Vue verwirft den Umbruch zwischen zwei Elementen. -->
        <span class="station__text">
            <span class="station__line1"
                ><StageLink
                    :text="station.name"
                    :linked="station.ref !== undefined"
                    :stale="stale"
                    testid="station-name"
                    @open="emit('open')"
                />{{ " " }}<span class="station__role">· {{ station.role }}</span></span
            >
            <span v-if="hasDetail" class="station__detail" data-testid="station-detail"
                ><template v-if="station.kindLabel">{{ station.kindLabel }}</template
                ><span v-if="station.kindLabel && inTerritory" class="station__sep"> · </span
                ><template v-if="inTerritory"
                    >{{ inTerritory.before
                    }}<StageLink
                        :text="inTerritory.name"
                        :linked="true"
                        :stale="stale"
                        testid="station-territory"
                        @open="emit('openTerritory')"
                    />{{ inTerritory.after }}</template
                ></span
            >
        </span>
    </li>
</template>

<style scoped>
.station {
    display: grid;
    grid-template-columns: var(--mark-size) minmax(0, 1fr);
    align-items: center;
    gap: var(--space-4);
    padding: var(--space-2) var(--space-4);
}

/*
 * Die Marke stanzt die Kette aus: Ein Saum in der Farbe des Grundes legt sich um ihre Form. Beim Ring ist das ein
 * runder Schatten, bei der Nadel ein Rechteck hinter ihr - ihre Spitze endet dort, wo die Kette weiterläuft.
 */
.station__mark {
    position: relative;
    z-index: 3;
    display: grid;
    justify-self: center;
    place-items: center;
}

.station__mark--wegpunkt {
    border-radius: 50%;
    box-shadow: 0 0 0 3px var(--mark-bg, var(--color-panel));
}

.station__mark--ziel {
    padding: 0 3px;
    background: var(--mark-bg, var(--color-panel));
}

.station__text {
    min-width: 0;
}

.station__line1 {
    display: block;
    font-size: var(--font-size-body);
    line-height: var(--leading-snug);
    overflow-wrap: anywhere;
}

.station__role {
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
}

/*
 * Die zweite Zeile wie Zeile 2 der Etappe: gedämpft, in Bildunterschriftgröße, mit demselben Abstand nach oben. Sie
 * bricht sauber (`overflow-wrap`), denn ein Gebietsname wie „Heiliges Neues Kaiserreich vom Greifenthron zu Gareth“
 * ist am Telefon breiter als 360 px (WI-0087 A13).
 */
.station__detail {
    display: block;
    margin-top: 1px;
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
    line-height: var(--leading-snug);
    overflow-wrap: anywhere;
}

.station__sep {
    color: var(--color-text-muted);
}
</style>
