<script setup lang="ts">
import AvmKreis from "../controls/avm-kreis.vue";
import AvmPille from "../controls/avm-pille.vue";
import { t } from "../i18n/i18n";
import type { Fakt, Ton } from "./umgebungen-leiste";

/**
 * Eine Station der Leiste „Lokal → Stage → Production“ (WI-0248, vorher drei eigene Kästen in `verwaltung-umgebungen.vue` und
 * `umgebungen-lokal.vue`): EIN Bauteil für alle drei, damit sie gleich aussehen und gleich groß sind. Sie rechnet nichts; was darin steht,
 * kommt fertig vom Aufrufer (`umgebungen-leiste.ts`).
 *
 * - **Von oben:** die Umgebungspille (mit „hier“, wenn die Sitzung in dieser Umgebung läuft), der Stand, seit wann, die eine Zeile mit
 *   Kreis (läuft, antwortet nicht, nicht bekannt …) und die Fakten.
 * - 🔴 **Die Umgebung, in der man ist, ist markiert:** Kante und Ring in der Akzentfarbe, dazu das Wort „hier“. Die übrigen bleiben in Ruhe.
 * - **Gestrichelt** heißt: Diese Umgebung gibt es (noch) nicht, etwa Lokal ohne Adresse.
 * - 🔴 **Feste Höhe** (`--station-hoehe`, Vali: „eine stabile höhe … 300 px?“): Die Station wechselt ihre Höhe nicht, wenn die Probe fertig ist
 *   oder ein Satz länger wird. Was nicht hineinpasst, rollt in der Station (nie über den Rand); lange Sätze sind gekürzt und tragen den vollen
 *   Wortlaut als Hinweis. Schmal (die Stationen stehen untereinander) ist die Höhe ein Mindestmaß, und die Station folgt dem Inhalt.
 * - Der Standardslot steht unter den Fakten (der Rückweg von Production).
 */
const props = defineProps<{
    pille: string;
    pilleTon: "neutral" | "erfolg" | "warnung" | "gefahr" | "lokal";
    hier: boolean;
    gestrichelt?: boolean | undefined;
    stand: string | null;
    zeit: string;
    zustand: { text: string; ton: Ton; fuellung: "voll" | "halb" | "leer" } | null;
    fakten: readonly Fakt[];
    testid: string;
    zustandTestid?: string | undefined;
}>();
</script>

<template>
    <section
        class="station"
        :class="{ 'is-hier': props.hier, 'is-weg': props.gestrichelt === true }"
        :aria-current="props.hier ? 'true' : undefined"
        :data-hier="props.hier ? 'true' : 'false'"
        :data-testid="props.testid"
    >
        <div class="station__kopf">
            <AvmPille :ton="props.pilleTon">{{ props.pille }}</AvmPille>
            <span v-if="props.hier" class="station__hier">{{ t("admin.umgebungen.hier") }}</span>
        </div>
        <span class="station__stand">{{ props.stand ?? "–" }}</span>
        <span class="station__zeit">{{ props.zeit }}</span>
        <span
            v-if="props.zustand !== null"
            class="station__zustand"
            :class="`station__zustand--${props.zustand.ton}`"
            :data-testid="props.zustandTestid"
        >
            <span :class="{ 'umgebungen-puls': props.zustand.ton === 'lauf' }">
                <AvmKreis :fuellung="props.zustand.fuellung" :name="props.zustand.text" />
            </span>
            {{ props.zustand.text }}
        </span>
        <dl v-if="props.fakten.length > 0" class="fakten">
            <template v-for="fakt in props.fakten" :key="fakt.label">
                <dt>{{ fakt.label }}</dt>
                <dd
                    :class="fakt.ton === undefined ? undefined : `fakten__wert--${fakt.ton}`"
                    :title="fakt.titel ?? fakt.zusatz"
                >
                    {{ fakt.wert
                    }}<span v-if="fakt.zusatz !== undefined" class="fakten__zusatz">{{ fakt.zusatz }}</span>
                </dd>
            </template>
        </dl>
        <slot />
    </section>
</template>

<style scoped>
/* Alle drei Stationen sind gleich breit (das Raster der Leiste) und gleich hoch (`--station-hoehe`, gesetzt in `verwaltung-umgebungen.vue`). */
.station {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    box-sizing: border-box;
    min-width: 0;
    height: var(--station-hoehe);
    padding: var(--space-10);
    overflow-y: auto;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-panel);
}

.station.is-weg {
    border-style: dashed;
}

.station.is-hier {
    border-color: var(--color-accent);
    box-shadow: 0 0 0 1px var(--color-accent);
}

.station__kopf {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-4) var(--space-6);
    margin-bottom: var(--space-4);
}

.station__hier {
    color: var(--color-accent-strong);
    font-size: var(--font-size-caption);
    font-weight: var(--font-weight-bold);
    letter-spacing: var(--letter-spacing-caps);
    text-transform: uppercase;
}

.station__stand {
    color: var(--color-text-strong);
    font-size: var(--font-size-title);
    font-variant-numeric: tabular-nums;
    line-height: var(--leading-tight);
    overflow-wrap: anywhere;
}

.station__zeit {
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
}

.station__zustand {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    margin-top: var(--space-2);
    font-size: var(--font-size-small);
}

.station__zustand--gut {
    color: var(--color-success-soft-text);
}

.station__zustand--warn {
    color: var(--color-warning-soft-text);
}

.station__zustand--rot {
    color: var(--color-danger-soft-text);
}

.station__zustand--lauf {
    color: var(--color-text-strong);
}

.station__zustand--leise {
    color: var(--color-text-muted);
}

.fakten {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: var(--space-2) var(--space-8);
    margin: var(--space-6) 0 0;
    padding-top: var(--space-6);
    border-top: 1px solid var(--color-divider);
    font-size: var(--font-size-caption);
    line-height: var(--leading-snug);
}

.fakten dt {
    color: var(--color-text-muted);
}

.fakten dd {
    min-width: 0;
    margin: 0;
    overflow-wrap: anywhere;
}

.fakten__wert--gut {
    color: var(--color-success-soft-text);
}

.fakten__wert--warn {
    color: var(--color-warning-soft-text);
}

.fakten__wert--rot {
    color: var(--color-danger-soft-text);
}

/* Der Satz unter dem Wert: höchstens drei Zeilen, der volle Wortlaut steht im Hinweis. */
.fakten__zusatz {
    display: -webkit-box;
    overflow: hidden;
    color: var(--color-text-muted);
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 3;
    line-clamp: 3;
}

/* Schmal stehen die Stationen untereinander (dasselbe Maß wie die Leiste, `umgebungen-leiste.vue`): Dann folgt die Höhe dem Inhalt; ein
   Mindestmaß ließe Lokal und Production rund 170 px leer. */
@container umgebungen (max-width: 879px) {
    .station {
        height: auto;
        overflow-y: visible;
    }
}
</style>
