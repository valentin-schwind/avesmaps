<script setup lang="ts">
import { computed, useId, useTemplateRef } from "vue";
import { t } from "../i18n/i18n";
import AvmEingabe from "./avm-eingabe.vue";
import AvmKaestchen from "./avm-kaestchen.vue";
import {
    gesetzteFilter,
    istLang,
    neueWahl,
    sichtbareAbschnitte,
    zahlEingabe,
    type FilterAbschnitt,
    type FilterWahl,
} from "./avm-filterknopf";
import { useMenueBlatt } from "./menue-blatt";

/**
 * Der Filterknopf jeder Liste (Betreiber 2026-10-11, `AGENTS.md` „Filter und Sortierung“: „generell will ich immer allein das
 * sortierung-symbol und das filter-symbol, um platz zu sparen. beim draufklicken öffnet sich das menü mit den optionen.“): der Trichter,
 * daneben die Zahl der gesetzten Filter; ein Klick öffnet das Blatt mit allen Abschnitten. Sein Gegenstück für die Sortierung ist der
 * Menüknopf des Hauses (`avm-menueknopf.vue`) mit den Zeichen aus `avm-sortierzeichen.vue`.
 *
 * Abgeleitet aus dem Trichter der Medienverwaltung (WI-0068, früher `medien/medien-filter-menue.vue`) und dem Filter der Ortsliste
 * (`editor-liste/editor-liste-filter.vue`, WI-0128, Legacy `filter-menu.js`); beide sollen auf dieses Bauteil umziehen.
 *
 * - **Der Knopf** in der Fassung des Menüknopfs: Kante `border`, Fläche `panel`, Radius `md`, Bedienhöhe, quadratisch; mit Zahl breiter.
 *   Kein Wort und kein Winkel ▾: Der Name steht als `aria-label` und Hinweis. Gesetzte Filter: Zahl und Kante golden.
 * - **Das Blatt:** je Abschnitt `eins` eine Wahl mit „alle“ zuerst (Auswahlknöpfe) oder `mehrere` Kästchen, wo die Liste sie kennt mit
 *   der Zahl der Treffer rechts. Ein Abschnitt ohne Werte erscheint nicht. Zwei Spalten, wenn der Platz reicht, und die Abschnitte
 *   verteilen sich gleichmäßig auf sie (WI-0206, T36): Sie laufen wie Zeitungsspalten, ein kurzer bleibt ganz, ein langer (`istLang`)
 *   läuft in die nächste Spalte weiter. „Filter lösen“ unten, solange etwas gesetzt ist. Es bleibt offen, solange man wählt.
 * - **Wo es aufgeht** (`menue-blatt.ts`): in einem offenen Fenster im Fenster (wie `im-fenster` am Menüknopf; hier merkt es der Knopf
 *   selbst), auf der Seite des Knopfs; sonst am `body`. Esc, ein Klick daneben, ein Bildlauf und eine neue Fenstergröße schließen es.
 * - **Zustände nach Guide §30.5:** Ruhe; Hover legt eine Lasur über die Fassung und kräftigt die Kante; gedrückt und offen die
 *   dunklere Lasur; Fokus nur über die Tastatur, goldene Kante und Ring; 120 ms `ease`, bei reduzierter Bewegung ohne. Nie Deckkraft.
 *   Am Finger ein Fingerziel (44 × 44 px).
 * - **Ein Bereich** (`art: "bereich"`, etwa der Zeitraum der Kataloge): zwei Zahlenfelder von–bis, die Grenzen der Daten als Platzhalter;
 *   er zählt als EIN Filter, sobald eine Kante steht, und meldet jede Eingabe als `bereich`.
 * - Die Liste hält die Wahl selbst: `setze` meldet die NEUE Wahl eines Abschnitts, `bereich` eine Kante, `loesen` alle.
 */
const props = defineProps<{
    abschnitte: readonly FilterAbschnitt[];
    wahl: FilterWahl;
    testid?: string | undefined;
}>();
const emit = defineEmits<{
    setze: [abschnitt: string, werte: string[]];
    /** Eine Kante eines Bereichs: die Zahl, oder `null` für leer. */
    bereich: [abschnitt: string, kante: "von" | "bis", wert: number | null];
    loesen: [];
}>();

const zahl = computed(() => gesetzteFilter(props.abschnitte, props.wahl));
const sichtbar = computed(() => sichtbareAbschnitte(props.abschnitte));
const bezeichnung = computed(() =>
    zahl.value > 0 ? t("controls.filter.gesetzt", { n: zahl.value }) : t("controls.filter.name"),
);
const gruppe = useId();
const blattId = useId();
const knopf = useTemplateRef<HTMLButtonElement>("knopf");
const blatt = useTemplateRef<HTMLDivElement>("blatt");

/** Beim Öffnen steht der Fokus auf der ersten gesetzten Wahl, sonst auf dem ersten Eintrag. */
function fokus(): void {
    (
        blatt.value?.querySelector<HTMLElement>("input:checked") ??
        blatt.value?.querySelector<HTMLElement>("input, button")
    )?.focus({ preventScroll: true });
}
const { offen, lage, ziel, umschalten, schliessen } = useMenueBlatt(knopf, blatt, fokus);

function onBlattTaste(event: KeyboardEvent): void {
    if (event.key !== "Escape") return;
    // Esc gehört hier dem Blatt: verbraucht, damit die Tastatur der Seite nicht noch das Fenster schließt.
    event.preventDefault();
    event.stopPropagation();
    schliessen(true);
}

const gesetzt = (abschnitt: FilterAbschnitt): readonly string[] => props.wahl[abschnitt.id] ?? [];

function setze(abschnitt: FilterAbschnitt, wert: string | undefined, an: boolean): void {
    emit("setze", abschnitt.id, neueWahl(abschnitt, gesetzt(abschnitt), wert, an));
}

const kennung = (rest: string): string | undefined =>
    props.testid === undefined ? undefined : `${props.testid}${rest}`;
</script>

<template>
    <span class="filterknopf-huelle">
        <button
            ref="knopf"
            type="button"
            class="filterknopf"
            :class="{ 'is-offen': offen, 'is-aktiv': zahl > 0 }"
            :aria-label="bezeichnung"
            :title="bezeichnung"
            aria-haspopup="true"
            :aria-expanded="offen"
            :aria-controls="offen ? blattId : undefined"
            :data-testid="props.testid"
            @click="umschalten"
        >
            <svg class="filterknopf__trichter" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
                <path
                    d="M2 3h12l-4.5 5.2V13l-3-1.6V8.2Z"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.4"
                    stroke-linejoin="round"
                />
            </svg>
            <span v-if="zahl > 0" class="filterknopf__zahl avm-versalmitte" :data-testid="kennung('-zahl')">{{
                zahl
            }}</span>
        </button>
        <Teleport :to="ziel">
            <div
                v-if="offen"
                :id="blattId"
                ref="blatt"
                class="filterknopf__blatt"
                role="group"
                :aria-label="t('controls.filter.name')"
                :style="{
                    top: `${String(lage.top)}px`,
                    left: `${String(lage.left)}px`,
                    ...(lage.hoehe === undefined ? {} : { maxHeight: `${String(lage.hoehe)}px` }),
                }"
                :data-testid="kennung('-blatt')"
                @keydown="onBlattTaste"
            >
                <p v-if="sichtbar.length === 0" class="filterknopf__leer">{{ t("controls.filter.leer") }}</p>
                <div v-if="sichtbar.length > 0" class="filterknopf__spalten">
                    <fieldset
                        v-for="abschnitt in sichtbar"
                        :key="abschnitt.id"
                        class="filterknopf__abschnitt"
                        :class="{ 'is-lang': istLang(abschnitt) }"
                        :data-testid="kennung(`-${abschnitt.id}`)"
                    >
                        <legend class="filterknopf__titel avm-versalmitte">{{ abschnitt.titel }}</legend>
                        <span v-if="abschnitt.art === 'bereich' && abschnitt.bereich" class="filterknopf__bereich">
                            <AvmEingabe
                                class="filterknopf__zahlfeld"
                                inputmode="numeric"
                                :model-value="abschnitt.bereich.von === null ? '' : String(abschnitt.bereich.von)"
                                :placeholder="String(abschnitt.bereich.min)"
                                :aria-label="`${abschnitt.titel} ${t('controls.filter.von')}`"
                                :testid="kennung(`-${abschnitt.id}-von`)"
                                @update:model-value="
                                    (roh: string) => emit('bereich', abschnitt.id, 'von', zahlEingabe(roh))
                                "
                            />
                            <span aria-hidden="true">–</span>
                            <AvmEingabe
                                class="filterknopf__zahlfeld"
                                inputmode="numeric"
                                :model-value="abschnitt.bereich.bis === null ? '' : String(abschnitt.bereich.bis)"
                                :placeholder="String(abschnitt.bereich.max)"
                                :aria-label="`${abschnitt.titel} ${t('controls.filter.bis')}`"
                                :testid="kennung(`-${abschnitt.id}-bis`)"
                                @update:model-value="
                                    (roh: string) => emit('bereich', abschnitt.id, 'bis', zahlEingabe(roh))
                                "
                            />
                        </span>
                        <AvmKaestchen
                            v-if="abschnitt.art === 'eins'"
                            art="radio"
                            :name="`${gruppe}-${abschnitt.id}`"
                            :checked="gesetzt(abschnitt).length === 0"
                            :testid="kennung(`-${abschnitt.id}-alle`)"
                            @change="setze(abschnitt, undefined, true)"
                            >{{ t("controls.filter.alle") }}</AvmKaestchen
                        >
                        <AvmKaestchen
                            v-for="eintrag in abschnitt.werte"
                            :key="eintrag.wert"
                            :art="abschnitt.art === 'eins' ? 'radio' : 'checkbox'"
                            :name="abschnitt.art === 'eins' ? `${gruppe}-${abschnitt.id}` : undefined"
                            :checked="gesetzt(abschnitt).includes(eintrag.wert)"
                            :testid="kennung(`-${abschnitt.id}-${eintrag.wert}`)"
                            @change="(an: boolean) => setze(abschnitt, eintrag.wert, an)"
                        >
                            <span class="filterknopf__wert">{{ eintrag.text }}</span>
                            <span v-if="eintrag.zahl !== undefined" class="filterknopf__treffer">{{
                                eintrag.zahl
                            }}</span>
                        </AvmKaestchen>
                    </fieldset>
                </div>
                <button
                    v-if="zahl > 0"
                    type="button"
                    class="filterknopf__loesen"
                    :data-testid="kennung('-loesen')"
                    @click="emit('loesen')"
                >
                    {{ t("controls.filter.loesen") }}
                </button>
            </div>
        </Teleport>
    </span>
</template>

<style scoped>
.filterknopf-huelle {
    display: inline-flex;
    flex: none;
}

.filterknopf {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-4);
    box-sizing: border-box;
    min-width: var(--avm-control-h);
    min-height: var(--avm-control-h);
    margin: 0;
    padding: 0 var(--space-4);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background-color: var(--color-panel);
    color: var(--color-text-muted);
    cursor: pointer;
    font: inherit;
    font-size: var(--font-size-body);
    white-space: nowrap;
    transition:
        background-color 120ms ease,
        border-color 120ms ease,
        color 120ms ease,
        box-shadow 120ms ease;
}

.filterknopf.is-aktiv {
    border-color: var(--color-accent-strong);
    color: var(--color-text-strong);
}

/* §30.1: Die Lasur liegt ÜBER der Fassung (geschichtet), sie ersetzt sie nicht. */
.filterknopf:hover {
    border-color: var(--color-border-strong);
    background-image: linear-gradient(var(--color-hover-wash), var(--color-hover-wash));
    color: var(--color-text-strong);
}

.filterknopf:active,
.filterknopf.is-offen {
    border-color: var(--color-border-strong);
    background-image: linear-gradient(var(--color-active-wash), var(--color-active-wash));
    color: var(--color-text-strong);
}

.filterknopf:focus-visible {
    outline: none;
    border-color: var(--color-accent-strong);
    box-shadow: var(--focus-ring);
}

.filterknopf__trichter {
    display: block;
    flex: none;
    width: var(--icon-sm);
    height: var(--icon-sm);
}

.filterknopf__zahl {
    color: var(--color-accent-strong);
    font-size: var(--font-size-small);
    font-variant-numeric: tabular-nums;
}

/* Das Blatt des Kartenmenüs (Guide §18). Es rollt; die Spalten legt `.filterknopf__spalten` darin an. */
.filterknopf__blatt {
    position: fixed;
    z-index: var(--z-dialog-high);
    display: flex;
    flex-direction: column;
    gap: var(--space-10);
    box-sizing: border-box;
    width: min(420px, 100vw - 2 * var(--space-6));
    max-height: min(70vh, 560px);
    padding: var(--space-8) var(--space-10);
    overflow-y: auto;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    background: var(--color-panel);
    box-shadow: var(--shadow-panel);
    color: var(--color-text);
    font-size: var(--font-size-body);
}

/*
 * Die Abschnitte laufen wie Zeitungsspalten (Betreiber 2026-10-16, EDIT-0003 T36: „dass sich die filter kategorien gleichmäßig
 * aufteilen“): Spalten ab 170 px, also zwei im Blatt und eine am Telefon, wie das Raster davor. Das Raster machte jede Zeile so hoch
 * wie ihren längsten Abschnitt; in der Ortsliste stand „Lage“ mit drei Werten neben „Art“ mit 302, das Blatt war zur Hälfte leer.
 */
.filterknopf__spalten {
    column-width: 170px;
    column-gap: var(--space-12);
}

.filterknopf__abschnitt {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 0;
    margin: 0 0 var(--space-10);
    padding: 0;
    border: 0;
    break-inside: avoid;
}

.filterknopf__abschnitt:last-child {
    margin-bottom: 0;
}

/* Ein langer Abschnitt darf weiterlaufen, sonst stünde er allein in einer Spalte und die andere bliebe leer. */
.filterknopf__abschnitt.is-lang {
    break-inside: auto;
}

.filterknopf__titel {
    break-after: avoid;
    padding: 0 0 var(--space-2);
    color: var(--color-accent-strong);
    font-size: var(--font-size-caption);
    letter-spacing: var(--letter-spacing-caps);
    text-transform: uppercase;
}

.filterknopf__wert {
    flex: 1 1 auto;
    min-width: 0;
}

/* Ein Bereich von–bis: zwei schmale Zahlenfelder auf einer Zeile, der Strich dazwischen in der Schriftfarbe. */
.filterknopf__bereich {
    display: flex;
    align-items: center;
    gap: var(--space-4);
}

.filterknopf__zahlfeld {
    flex: 0 1 6.5em;
    min-width: 0;
}

.filterknopf__treffer {
    margin-left: var(--space-6);
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
    font-variant-numeric: tabular-nums;
}

.filterknopf__leer {
    margin: 0;
    color: var(--color-text-muted);
}

.filterknopf__loesen {
    align-self: flex-start;
    padding: 0;
    border: 0;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--color-link);
    cursor: pointer;
    font: inherit;
    transition: color 120ms ease;
}

.filterknopf__loesen:hover {
    color: var(--color-link-hover);
}

.filterknopf__loesen:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
}

@media (pointer: coarse) {
    .filterknopf {
        min-width: 44px;
        min-height: 44px;
    }
}

@media (prefers-reduced-motion: reduce) {
    .filterknopf,
    .filterknopf__loesen {
        transition: none;
    }
}
</style>
