<script setup lang="ts">
import { computed, useId } from "vue";
import AvmHinweis from "../controls/avm-hinweis.vue";
import { phoneViewport } from "../controls/phone-viewport";
import { t } from "../i18n/i18n";
import type { ReisebildHinweisZiel } from "../legal/hinweise-ziel";
import type { LinienZeichen } from "./reisebild-zeichen";
import ReisebildZeichen from "./reisebild-zeichen.vue";

/**
 * Der Fuß des Formulars „Eigenes Bild hinzufügen“ (WI-0272, Entwurf 8): links „ⓘ Datenschutz“, rechts der große goldene Hauptknopf „Bild hochladen“; darüber, nur wenn es etwas zu sagen gibt, der
 * Datenschutz-Kurzsatz (aufgeklappt), der Grund, warum es noch nicht geht, und ein Problem des Servers. Der Fuß steht immer im Bild, auch wenn der Rumpf rollt: Der Knopf darf nie verschwinden.
 *
 * - 🔴 **Gesperrt heißt `aria-disabled`, nicht `disabled`:** Der Knopf bleibt drückbar und sieht wie ein goldener Umriss aus. Ein Druck im gesperrten Zustand ruft `hochladen` trotzdem; die Hülle
 *   (`reisebild-fenster.vue`) zeigt dann den Grund (`grund`), markiert das fehlende Feld und setzt den Fokus hinein. Während des Sendens ist er wirklich `disabled`.
 * - **Der Datenschutz-Kurzsatz** (mit „Sichtbar erst nach Prüfung durch die Redaktion.“) klappt hinter „ⓘ Datenschutz“ auf; der Verweis darunter öffnet „Hinweise › Datenschutz“.
 * - Zustände nach Guide §30.5: Ruhe, Hover (der Knopf hebt sich um einen Pixel), Aktiv, Fokus (Abstandsring), Gesperrt, 120 bis 180 ms; nie Deckkraft.
 */
const props = defineProps<{
    /** Sieht der Hauptknopf gesperrt aus (es fehlt etwas oder das Bild wird gelesen)? */
    gesperrt: boolean;
    sendet: boolean;
    /** Der Satz, warum es noch nicht geht; nur nach einem Druck auf den gesperrten Knopf. */
    grund?: string | undefined;
    /** Ein Problem des Servers (Grenze erreicht, keine Verbindung …), schon in Worten. */
    problem?: string | undefined;
    /**
     * Für ein anderes Formular der Besucher (Karte vorschlagen, WI-0275 Stufe C): der Anfang der Testkennungen (Vorgabe `reisebild`), die Aufschrift des Hauptknopfs und der Satz hinter „ⓘ Datenschutz“.
     * Mit eigenem Satz fehlt der Verweis zum Datenschutz „Reisebilder“. Ohne diese Angaben bleibt alles, wie es war.
     */
    kennung?: string | undefined;
    knopf?: string | undefined;
    datenschutzText?: string | undefined;
    /** Ein gemaltes Symbol im Hauptknopf statt des Pfeils (das Kontaktformular: der Brief). */
    knopfBild?: string | undefined;
    /** Ein Linienzeichen im Hauptknopf statt des Pfeils (das Meldeformular: das Senden). `knopfBild` geht vor. */
    knopfZeichen?: LinienZeichen | undefined;
    /** Die Sätze über der Zeile schweben über dem Rumpf, das Fenster behält seine Höhe (das Kontaktformular). */
    schwebend?: boolean | undefined;
}>();
const datenschutzOffen = defineModel<boolean>("datenschutzOffen", { default: false });
const emit = defineEmits<{
    hochladen: [];
    hinweise: [ziel: ReisebildHinweisZiel];
}>();

const kennungId = useId();
const k = computed(() => props.kennung ?? "reisebild");
</script>

<template>
    <div
        class="rbf"
        :class="{ 'rbf--telefon': phoneViewport, 'rbf--schwebend': props.schwebend }"
        :data-testid="`${k}-fuss`"
    >
        <div class="rbf__ueber">
            <p
                v-if="datenschutzOffen"
                :id="`${kennungId}-datenschutz`"
                class="rbf__text"
                :data-testid="`${k}-datenschutz`"
            >
                <template v-if="props.datenschutzText !== undefined">{{ props.datenschutzText }}</template>
                <template v-else>{{ t("photobox.fuss.hinweis") }} {{ t("photobox.datenschutz") }}</template>
                <button
                    v-if="props.datenschutzText === undefined"
                    type="button"
                    class="rbf__verweis"
                    data-testid="reisebild-datenschutz-link"
                    @click="emit('hinweise', 'datenschutz-bei-reisebildern')"
                >
                    {{ t("photobox.datenschutz.link") }}
                </button>
            </p>
            <p
                v-if="props.grund !== undefined"
                :id="`${kennungId}-grund`"
                class="rbf__text rbf__text--grund"
                role="status"
                :data-testid="`${k}-sperrgrund`"
            >
                {{ props.grund }}
            </p>
            <AvmHinweis v-if="props.problem !== undefined" ton="gefahr" rolle="alert" :testid="`${k}-problem`">
                {{ props.problem }}
            </AvmHinweis>
        </div>
        <div class="rbf__zeile">
            <button
                type="button"
                class="rbf__info"
                :aria-expanded="datenschutzOffen"
                :aria-controls="`${kennungId}-datenschutz`"
                :data-testid="`${k}-datenschutz-knopf`"
                @click="datenschutzOffen = !datenschutzOffen"
            >
                <ReisebildZeichen name="info" />
                <span>{{ t("photobox.datenschutz.knopf") }}</span>
            </button>
            <button
                type="button"
                class="rbf__senden"
                :disabled="props.sendet"
                :aria-disabled="props.gesperrt && !props.sendet ? 'true' : undefined"
                :aria-describedby="props.grund === undefined ? undefined : `${kennungId}-grund`"
                :data-testid="`${k}-einreichen`"
                @click="emit('hochladen')"
            >
                <img
                    v-if="props.knopfBild !== undefined"
                    :src="props.knopfBild"
                    alt=""
                    aria-hidden="true"
                    decoding="async"
                />
                <ReisebildZeichen v-else :name="props.knopfZeichen ?? 'hochladen'" />
                <span>{{ props.sendet ? t("photobox.sendet") : (props.knopf ?? t("photobox.hochladen")) }}</span>
            </button>
        </div>
    </div>
</template>

<style scoped>
.rbf {
    display: grid;
    gap: var(--space-8);
    padding: var(--space-8) var(--space-16) var(--space-10);
}

/* Ohne `schwebend` stehen die Sätze im Fluss, als gäbe es diese Hülle nicht. */
.rbf__ueber {
    display: contents;
}

.rbf--schwebend {
    position: relative;
}

.rbf--schwebend .rbf__ueber {
    position: absolute;
    right: var(--space-16);
    bottom: calc(100% + var(--space-4));
    left: var(--space-16);
    z-index: 1;
    display: grid;
    gap: var(--space-4);
}

.rbf--schwebend .rbf__ueber > * {
    box-shadow: var(--shadow-panel);
}

.rbf--telefon {
    padding-bottom: max(var(--space-10), env(safe-area-inset-bottom, 0));
}

.rbf__zeile {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-10);
}

.rbf__text {
    margin: 0;
    padding: var(--space-8) var(--space-10);
    border-radius: var(--radius-md);
    background: var(--color-panel-soft);
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
    line-height: var(--leading-normal);
    animation: rbf-ein 180ms ease;
}

/* Der Grund: ein ruhiger Hinweis im Ton der Warnung (er warnt, er schreit nicht), kein roter Alarm. */
.rbf__text--grund {
    padding: var(--space-6) var(--space-10);
    border: 1px solid var(--color-warning-soft-border);
    background: var(--color-warning-soft);
    color: var(--color-warning-soft-text);
    font-size: var(--font-size-body);
}

@keyframes rbf-ein {
    from {
        opacity: 0;
        transform: translateY(var(--space-2));
    }
}

.rbf__verweis {
    padding: 0;
    border: 0;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--color-link);
    cursor: pointer;
    font: inherit;
    text-decoration: underline;
    text-decoration-thickness: 1px;
    text-underline-offset: calc(var(--space-2) / 2);
    transition: color 120ms ease;
}

.rbf__verweis:hover {
    color: var(--color-link-hover);
    text-decoration-thickness: 2px;
}

.rbf__verweis:active {
    color: var(--color-accent-strong);
}

.rbf__verweis:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
}

/* ⓘ Datenschutz: leise, links; aufgeklappt mit weicher Fläche und goldbraunem Zeichen. */
.rbf__info {
    display: inline-flex;
    align-items: center;
    gap: var(--space-4);
    min-height: calc(var(--avm-control-h) - var(--space-2) / 2);
    padding: 0 var(--space-6) 0 var(--space-4);
    border: 1px solid transparent;
    border-radius: var(--radius-md);
    background: none;
    color: var(--color-text-muted);
    cursor: pointer;
    font: inherit;
    font-size: var(--font-size-small);
    transition:
        background-color 120ms ease,
        border-color 120ms ease,
        color 120ms ease;
}

.rbf__info svg {
    width: var(--icon-sm);
    height: var(--icon-sm);
}

.rbf__info:hover {
    background: var(--color-hover-wash);
    color: var(--color-text-strong);
}

.rbf__info:active {
    background: var(--color-active-wash);
}

.rbf__info[aria-expanded="true"] {
    border-color: var(--color-border);
    background: var(--color-panel-soft);
    color: var(--color-accent-strong);
}

.rbf__info:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
}

/* Der Hauptknopf in der Akzentfarbe, groß. Gesperrt ist er ein leeres goldenes Gefäß, das sich füllt, sobald alles da ist. */
.rbf__senden {
    display: inline-flex;
    flex: none;
    align-items: center;
    justify-content: center;
    gap: var(--space-6);
    box-sizing: border-box;
    min-height: calc(var(--avm-control-h) + var(--space-10));
    padding: 0 var(--space-20) 0 var(--space-16);
    border: 1px solid var(--color-accent);
    border-radius: var(--radius-lg);
    background: var(--color-accent);
    box-shadow: var(--shadow-field-rest);
    color: var(--color-page-bg-deep);
    cursor: pointer;
    font: inherit;
    font-size: var(--font-size-subhead);
    line-height: var(--leading-tight);
    white-space: nowrap;
    transition:
        background-color 180ms ease,
        border-color 180ms ease,
        color 180ms ease,
        box-shadow 140ms ease,
        transform 120ms ease;
}

.rbf__senden img {
    width: var(--icon-md);
    height: var(--icon-md);
    object-fit: contain;
}

.rbf__senden svg {
    width: var(--icon-md);
    height: var(--icon-md);
    stroke-width: 2;
}

.rbf__senden:hover {
    background: color-mix(in srgb, var(--color-accent) 86%, var(--color-text-strong));
    box-shadow: var(--shadow-button-hover-strong);
    transform: translateY(-1px);
}

.rbf__senden:active {
    background: color-mix(in srgb, var(--color-accent) 80%, var(--color-page-bg-deep));
    box-shadow: none;
    transform: none;
}

.rbf__senden:focus-visible {
    outline: none;
    box-shadow:
        0 0 0 2px var(--color-panel),
        0 0 0 5px var(--color-accent);
}

.rbf__senden[aria-disabled="true"] {
    border-color: color-mix(in srgb, var(--color-accent) 55%, var(--color-border));
    background: color-mix(in srgb, var(--color-accent) 10%, var(--color-panel));
    box-shadow: none;
    color: var(--color-accent-strong);
    cursor: default;
}

.rbf__senden[aria-disabled="true"]:hover {
    background: color-mix(in srgb, var(--color-accent) 16%, var(--color-panel));
    transform: none;
}

.rbf__senden[aria-disabled="true"]:active {
    background: color-mix(in srgb, var(--color-accent) 22%, var(--color-panel));
}

.rbf__senden[aria-disabled="true"]:focus-visible {
    box-shadow:
        0 0 0 2px var(--color-panel),
        0 0 0 5px var(--color-focus);
}

/* Beim Senden wirklich gesperrt: die Farbfassung des Hauses, kein Schatten, keine Hand. */
.rbf__senden:disabled {
    border-color: var(--color-disabled-border);
    background: var(--color-disabled-bg);
    box-shadow: none;
    color: var(--color-disabled-text);
    cursor: not-allowed;
    transform: none;
}

@media (prefers-reduced-motion: reduce) {
    .rbf__text {
        animation: none;
    }

    .rbf__verweis,
    .rbf__info,
    .rbf__senden {
        transition: none;
    }

    .rbf__senden:hover {
        transform: none;
    }
}
</style>
