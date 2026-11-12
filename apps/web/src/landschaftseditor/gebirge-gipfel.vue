<script setup lang="ts">
import { computed } from "vue";
import { PEAK_HEIGHT_MAX, type EditorLandscapePeak } from "@avesmaps3d/shared";
import AvmFeld from "../controls/avm-feld.vue";
import FensterFeldzeilen from "../fenster/fenster-feldzeilen.vue";
import { formatNumber, t } from "../i18n/i18n";

/**
 * „Gipfel in dieser Fläche“ unten im Reiter „Gebirge“ (WI-0178 P5, Fassung 16): wie Legacy jeder Gipfel, dessen Punkt in der Fläche
 * liegt, der höchste zuerst; erkannt, nicht eingetragen. Die Höhe ist hier ein Feld im Entwurf des Gebirges und wird mit dessen
 * „Fertig“ am Gipfel geschrieben (`landscape.update` `peaks`, derselbe Weg wie im Fenster des Gipfels). Ändert das Fenster des Gipfels
 * seine Höhe gerade, ruht das Feld hier (`gesperrtFuer`), damit dieselbe Höhe nur in EINEM Entwurf steht.
 *
 * Marken: höchster · unter Kammhöhe · Vulkan · verborgen. Eine Höhenskala zeigt die Gipfel gegen die Kammhöhe; ein Gipfel ohne Höhe
 * rechnet mit 5.000 Schritt (Vorgabe des Höhenmodells). Überfahren hebt den Gipfel auf der Karte hervor, ein Klick öffnet ihn.
 */
const props = defineProps<{
    peaks: readonly EditorLandscapePeak[];
    /** Die Höhen im Entwurf des Gebirges, je Gipfel. */
    hoehen: Readonly<Record<string, number>>;
    kamm: number;
    gesperrt?: string | undefined;
    /** Warum die Höhe dieses Gipfels hier gerade ruht (sein eigenes Fenster ändert sie), sonst nichts. */
    gesperrtFuer?: ((id: string) => string | undefined) | undefined;
    kennung: string;
}>();
const emit = defineEmits<{
    hoehe: [id: string, hoehe: number];
    oeffne: [id: string];
    zeige: [id: string | undefined];
    /** ⌖: die Kamera fliegt zum Gipfel (Entwurf V16). */
    ziel: [id: string];
}>();

/** Ohne Höhe rechnet das Höhenmodell mit dieser (`ECOSYSTEM_HYDRO_STANDARDHOEHE`). */
const OHNE_HOEHE = 5000;
const roh = (p: EditorLandscapePeak): number | undefined => props.hoehen[p.id] ?? p.height;
const hoehe = (p: EditorLandscapePeak): number => roh(p) ?? OHNE_HOEHE;
/** Der Weg zum Setzen im Kartenmenü, aus den Wörtern des Menüs selbst. */
const setzenPfad = `${t("ortseditor.anlegen.hier")} › ▲ ${t("landschaftseditor.landmarke.setzen")} › ${t("peak.berggipfel")}`;
const liste = computed(() => [...props.peaks].sort((a, b) => hoehe(b) - hoehe(a)));
const hoechster = computed(() => liste.value[0]);
const unter = computed(() => liste.value.filter((p) => hoehe(p) < props.kamm));
const ohne = computed(() => liste.value.filter((p) => roh(p) === undefined));

/** Die Höhenskala: bis knapp über den höchsten Wert, ein ▲ je Gipfel, die Kammhöhe als Strich. */
const SKALA = { breite: 300, hoehe: 34 } as const;
const oben = computed(
    () => Math.max(props.kamm, hoechster.value === undefined ? 0 : hoehe(hoechster.value)) * 1.04 || 1,
);
const x = (wert: number): number => 6 + (SKALA.breite - 12) * Math.min(1, wert / oben.value);

function marke(p: EditorLandscapePeak): string {
    if (props.gesperrtFuer?.(p.id) !== undefined) return t("landschaftseditor.gebirge.gipfel.marke.imGipfel");
    if (p.hidden === true) return t("landschaftseditor.gebirge.gipfel.marke.verborgen");
    if (p === hoechster.value) return t("landschaftseditor.gebirge.gipfel.marke.hoechster");
    if (hoehe(p) < props.kamm) return t("landschaftseditor.gebirge.gipfel.marke.unter");
    return p.subtype === "vulkan" ? t("landschaftseditor.gebirge.gipfel.marke.vulkan") : "";
}
function setze(p: EditorLandscapePeak, ereignis: Event): void {
    const text = (ereignis.target as HTMLInputElement).value.trim();
    const wert = Math.round(Number(text));
    // Leeren kennt der Schreibweg nicht: Ein leeres Feld lässt die Höhe, wie sie ist.
    if (text === "" || !Number.isFinite(wert)) return;
    const neu = Math.min(PEAK_HEIGHT_MAX, Math.max(0, wert));
    if (neu !== roh(p)) emit("hoehe", p.id, neu);
}
</script>

<template>
    <section class="gebirge-gipfel" :data-testid="`${kennung}-gebirge-gipfel`">
        <h4 class="gebirge-gipfel__titel">
            {{ t("landschaftseditor.gebirge.gipfel.titel", { n: formatNumber(liste.length, 0) }) }}
        </h4>
        <p v-if="liste.length === 0" class="gebirge-gipfel__hinweis">
            {{ t("landschaftseditor.gebirge.gipfel.keine", { pfad: setzenPfad }) }}
        </p>
        <template v-else>
            <FensterFeldzeilen>
                <dt>{{ t("landschaftseditor.gebirge.gipfel.hoechster") }}</dt>
                <dd>
                    {{
                        t("landschaftseditor.gebirge.gipfel.wert", {
                            name: hoechster!.name,
                            n: formatNumber(hoehe(hoechster!), 0),
                        })
                    }}
                </dd>
                <dt>{{ t("landschaftseditor.gebirge.hoehe.kamm") }}</dt>
                <dd>{{ formatNumber(kamm, 0) }} {{ t("landschaftseditor.gebirge.hoehe.einheit") }}</dd>
            </FensterFeldzeilen>
            <svg
                class="gebirge-gipfel__skala"
                :viewBox="`0 0 ${SKALA.breite} ${SKALA.hoehe}`"
                role="img"
                :aria-label="t('landschaftseditor.gebirge.gipfel.skala', { n: formatNumber(kamm, 0) })"
            >
                <rect x="6" y="20" :width="SKALA.breite - 12" height="4" rx="2" class="gebirge-gipfel__bahn" />
                <rect
                    x="6"
                    y="20"
                    :width="Math.max(0, x(kamm) - 6)"
                    height="4"
                    rx="2"
                    class="gebirge-gipfel__kammbahn"
                />
                <path
                    v-for="p in liste"
                    :key="p.id"
                    :d="`M${x(hoehe(p))},12L${x(hoehe(p)) + 4},19L${x(hoehe(p)) - 4},19Z`"
                    :class="hoehe(p) < kamm ? 'gebirge-gipfel__unter' : 'gebirge-gipfel__drueber'"
                >
                    <title>{{ p.name }} · {{ formatNumber(hoehe(p), 0) }}</title>
                </path>
                <line :x1="x(kamm)" :x2="x(kamm)" y1="8" y2="30" class="gebirge-gipfel__kamm" />
            </svg>
            <p
                v-if="unter.length > 0"
                class="gebirge-gipfel__warnung"
                role="status"
                :data-testid="`${kennung}-gebirge-gipfel-unter`"
            >
                {{
                    t("landschaftseditor.gebirge.gipfel.unter", {
                        n: formatNumber(unter.length, 0),
                        kamm: formatNumber(kamm, 0),
                    })
                }}
            </p>
            <p v-if="ohne.length > 0" class="gebirge-gipfel__hinweis">
                {{ t("landschaftseditor.gebirge.gipfel.ohneHoehe", { n: formatNumber(ohne.length, 0) }) }}
            </p>
            <ul class="gebirge-gipfel__liste">
                <li
                    v-for="p in liste"
                    :key="p.id"
                    class="gebirge-gipfel__zeile"
                    :class="{ 'is-unter': hoehe(p) < kamm, 'is-geaendert': hoehen[p.id] !== undefined }"
                    :data-testid="`${kennung}-gebirge-gipfel-${p.id}`"
                    @mouseenter="emit('zeige', p.id)"
                    @mouseleave="emit('zeige', undefined)"
                >
                    <button
                        type="button"
                        class="gebirge-gipfel__name einzeilig"
                        :title="t('landschaftseditor.gebirge.gipfel.oeffnen', { name: p.name })"
                        :aria-label="t('landschaftseditor.gebirge.gipfel.oeffnen', { name: p.name })"
                        @focus="emit('zeige', p.id)"
                        @blur="emit('zeige', undefined)"
                        @click="emit('oeffne', p.id)"
                    >
                        <span aria-hidden="true">▲</span> {{ p.name }}
                    </button>
                    <AvmFeld
                        type="number"
                        min="0"
                        :max="PEAK_HEIGHT_MAX"
                        step="50"
                        class="gebirge-gipfel__feld"
                        :value="roh(p) ?? ''"
                        placeholder="5000"
                        :disabled="gesperrt !== undefined || gesperrtFuer?.(p.id) !== undefined"
                        :title="gesperrtFuer?.(p.id)"
                        :aria-label="t('landschaftseditor.gebirge.gipfel.feld', { name: p.name })"
                        :data-testid="`${kennung}-gebirge-gipfel-${p.id}-hoehe`"
                        @change="(ereignis: Event) => setze(p, ereignis)"
                    />
                    <small class="gebirge-gipfel__marke">{{ marke(p) }}</small>
                    <button
                        type="button"
                        class="gebirge-gipfel__ziel"
                        :title="t('landschaftseditor.gebirge.gewaesser.ziel', { name: p.name })"
                        :aria-label="t('landschaftseditor.gebirge.gewaesser.ziel', { name: p.name })"
                        :data-testid="`${kennung}-gebirge-gipfel-${p.id}-ziel`"
                        @click="emit('ziel', p.id)"
                    >
                        ⌖
                    </button>
                </li>
            </ul>
            <p class="gebirge-gipfel__hinweis">{{ t("landschaftseditor.gebirge.gipfel.hinweis") }}</p>
        </template>
    </section>
</template>

<style scoped>
.gebirge-gipfel {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    padding: var(--space-6) var(--space-8);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
}

.gebirge-gipfel__titel {
    margin: 0;
    color: var(--color-accent-strong);
    font-size: var(--font-size-caption);
    font-weight: normal;
    letter-spacing: var(--letter-spacing-caps);
    text-transform: uppercase;
}

.gebirge-gipfel__hinweis,
.gebirge-gipfel__warnung {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

.gebirge-gipfel__warnung {
    color: var(--color-text);
}

.gebirge-gipfel__skala {
    width: 100%;
    height: auto;
}

.gebirge-gipfel__bahn {
    fill: var(--color-border-strong);
}

.gebirge-gipfel__kammbahn {
    fill: var(--color-accent-brown);
    opacity: 0.55;
}

.gebirge-gipfel__drueber {
    fill: var(--color-text);
}

.gebirge-gipfel__unter {
    fill: var(--color-accent-brown);
}

.gebirge-gipfel__kamm {
    stroke: var(--color-text);
    stroke-width: 1.5;
    stroke-dasharray: 2 2;
}

.gebirge-gipfel__liste {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin: 0;
    padding: 0;
    list-style: none;
}

.gebirge-gipfel__zeile {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 8ch minmax(0, 0.5fr) auto;
    gap: var(--space-4);
    align-items: center;
}

.gebirge-gipfel__ziel {
    padding: 0 var(--space-2);
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--color-accent-brown);
    cursor: pointer;
    font: inherit;
    transition: border-color 120ms;
}

.gebirge-gipfel__ziel:hover {
    border-color: var(--color-accent-brown);
}

.gebirge-gipfel__ziel:focus-visible {
    outline: 2px solid var(--color-accent-brown);
    outline-offset: 1px;
}

.gebirge-gipfel__name {
    min-width: 0;
    padding: 0;
    border: 0;
    background: none;
    color: var(--color-text);
    cursor: pointer;
    font: inherit;
    text-align: left;
}

.gebirge-gipfel__name:hover {
    color: var(--color-link-hover);
}

.gebirge-gipfel__zeile.is-unter .gebirge-gipfel__name span {
    color: var(--color-accent-brown);
}

.gebirge-gipfel__feld {
    width: 100%;
}

.gebirge-gipfel__marke {
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}
</style>
