<script setup lang="ts">
import { useTemplateRef } from "vue";
import type { KopierZustand } from "../controls/avm-kopierfeld";
import { phoneViewport } from "../controls/phone-viewport";
import { t } from "../i18n/i18n";
import LinkKasten from "./link-kasten.vue";
import ReisebildZeichen from "./reisebild-zeichen.vue";
import { REISEBILD_SYMBOLE } from "./reisebild-zeichen";

/**
 * Der Rumpf der Bestätigung nach dem Einreichen (WI-0272, Entwurf 8; Betreiber 2026-11-01). Von oben: die Bestätigung („Eingereicht.“, das Pergament der Ablagefläche mit goldenem Haken), gleich als zweites
 * der persönliche Link in einem goldenen Kasten (beim ersten Versuch übersehen; `link-kasten.vue`, seit Entwurf 9 mit dem Häkchen „Auf diesem Gerät merken“), dann das eingereichte Bild als kleine Karte mit dem
 * Ablauf, leise darunter „Stand ansehen“ und „Noch ein Bild von hier“. Der Fuß mit „Schließen“ und der Warnung steht in `reisebild-fertig-fuss.vue`; der Zustand (kopiert, gemerkt, gewarnt) und was „Kopieren“
 * tut, in `reisebild-fenster.vue` und `fertig-schutz.ts`.
 *
 * - Der Linkkasten gehört der Bestätigung und der Statusseite gemeinsam; hier steht er nur an seinem Platz, und die Zusagen (einzeilig gekürzter Link, „Link kopieren“, der Warnring, das Häkchen) halten sich dort.
 * - Das eingereichte Bild steht eingepasst und unverfälscht (nie abgedunkelt, Guide §30.2); die Stufen „Eingereicht ✓ · In Prüfung · Veröffentlicht“ zeigen, wo es steht.
 */
const props = defineProps<{
    /** Der ganze persönliche Link. */
    link: string;
    /** Die Beschreibung, wie eingereicht (getrimmt). */
    beschreibung: string;
    stelleWorte: string;
    /** Die Entstehung in Worten („Foto“). */
    entstehung: string;
    /** Die Vorschau des eingereichten Bildes (ein Blob des Fensters). */
    vorschauUrl?: string | undefined;
    /** Wie der Kopierknopf gerade aussieht: Ruhe, „✓ Kopiert“ oder „ging nicht“. */
    kopiert: KopierZustand;
    /** Wird gerade vor dem Verlust des Links gewarnt (Warnring)? */
    warnt: boolean;
    /** Lässt der Browser das Merken zu? Sonst gibt es kein Häkchen. */
    merkenMoeglich: boolean;
    /** Ist der Link gemerkt? */
    gemerkt: boolean;
    /** Warum das Merken eben nicht ging (voll, gesperrt); der Kasten sagt es leise. */
    merkenProblem?: "voll" | "gesperrt" | undefined;
}>();
const emit = defineEmits<{
    kopieren: [];
    /** Das Häkchen „Auf diesem Gerät merken“: `true` = merken, `false` = vergessen. */
    merken: [an: boolean];
    stand: [];
    "noch-eins": [];
}>();

const kasten = useTemplateRef<InstanceType<typeof LinkKasten>>("kasten");

/** Den Linkkasten in Sicht rollen (der Rumpf rollt, wo das Fenster niedrig ist). */
const zeigeLink = (): void => kasten.value?.zeigeLink();
/** Den Link ganz markieren: Wo die Zwischenablage nicht erlaubt ist, nimmt Strg+C ihn mit. */
const markiereLink = (): void => kasten.value?.markiereLink();
/** Der Fokus geht auf „Link kopieren“, sobald die Bestätigung steht (der Knopf des Einreichens ist weg). */
const fokussiereKopieren = (): void => kasten.value?.fokussiereKopieren();
defineExpose({ zeigeLink, markiereLink, fokussiereKopieren });
</script>

<template>
    <div class="rbk" :class="{ 'rbk--telefon': phoneViewport }" data-testid="reisebild-fertig">
        <!-- Die Bestätigung: dasselbe Pergament wie in der Ablage, statt des Plus ein goldener Haken. -->
        <div class="rbk__erfolg" role="status" data-testid="reisebild-fertig-hinweis">
            <span class="rbk__symbol">
                <img class="rbk__bild" :src="REISEBILD_SYMBOLE.bildmachen" alt="" aria-hidden="true" decoding="async" />
                <span class="rbk__haken"><ReisebildZeichen name="haken" /></span>
            </span>
            <div class="rbk__erfolg-text">
                <p class="rbk__erfolg-titel">{{ t("photobox.fertig.eingereicht") }}</p>
                <p class="rbk__erfolg-satz">{{ t("photobox.fertig.sichtbar") }}</p>
            </div>
        </div>

        <!-- Der persönliche Link: der hervorgehobene Kasten mit dem Hauptknopf und dem Häkchen „Auf diesem Gerät merken“. -->
        <LinkKasten
            ref="kasten"
            testid="reisebild-fertig"
            :link="props.link"
            :kopiert="props.kopiert"
            :warnt="props.warnt"
            :merken-moeglich="props.merkenMoeglich"
            :gemerkt="props.gemerkt"
            :merken-problem="props.merkenProblem"
            @kopieren="emit('kopieren')"
            @merken="(an) => emit('merken', an)"
        />

        <!-- Das eingereichte Bild: eingepasst, ungedimmt, mit Beschreibung, Stelle und dem Ablauf. -->
        <div class="rbk__beleg" data-testid="reisebild-fertig-beleg">
            <div class="rbk__beleg-bild">
                <img
                    v-if="props.vorschauUrl !== undefined"
                    :src="props.vorschauUrl"
                    :alt="t('photobox.status.vorschau.alt')"
                    data-testid="reisebild-fertig-vorschau"
                />
            </div>
            <div class="rbk__beleg-text">
                <p class="rbk__beleg-titel" data-testid="reisebild-fertig-beschreibung">{{ props.beschreibung }}</p>
                <p class="rbk__beleg-mehr">
                    <img class="rbk__nadel" :src="REISEBILD_SYMBOLE.pin" alt="" aria-hidden="true" decoding="async" />
                    <span>{{ props.stelleWorte }} · {{ props.entstehung }}</span>
                </p>
            </div>
            <ol class="rbk__stufen" :aria-label="t('photobox.status.verlauf')">
                <li class="is-erledigt">
                    <span class="rbk__punkt"><ReisebildZeichen name="haken" /></span>
                    <span>{{ t("photobox.status.schritt.eingereicht") }}</span>
                </li>
                <li class="is-jetzt" aria-current="step">
                    <span class="rbk__punkt"></span>
                    <span>{{ t("photobox.status.schritt.pruefung") }}</span>
                </li>
                <li>
                    <span class="rbk__punkt"></span>
                    <span>{{ t("photobox.status.schritt.veroeffentlicht") }}</span>
                </li>
            </ol>
        </div>

        <!-- Leise: Wer weiterwill, findet es, aber der Link bleibt die Hauptsache. -->
        <div class="rbk__weiter">
            <button type="button" class="rbk__leise" data-testid="reisebild-fertig-stand" @click="emit('stand')">
                {{ t("photobox.fertig.stand") }}
            </button>
            <button
                type="button"
                class="rbk__leise"
                data-testid="reisebild-fertig-noch-eins"
                @click="emit('noch-eins')"
            >
                {{ t("photobox.fertig.nochEins") }}
            </button>
        </div>
    </div>
</template>

<style scoped>
/*
 * Alle Maße aus dem Kanon, keine Zahl im Bauteil; die Mehrfachen sind die Maße der Probierseite (Entwurf 8) in Kanonschritten (siehe `reisebild-formular.vue`).
 */
.rbk {
    --rb-symbol: calc(var(--icon-xxl) * 1.4);
    --rb-beleg-bild: calc(var(--icon-xxl) * 2.65);
    --rb-stufe: calc(var(--icon-md) + var(--space-2) / 2);

    display: flex;
    flex-direction: column;
    gap: var(--space-16);
    min-width: 0;
    /* Der Rumpf der Hülle polstert 8 / 14; zusammen mit diesem Polster stehen die Blöcke 14 oben, 18 an den Seiten und 18 unten. */
    padding: var(--space-4) var(--space-2) var(--space-8);
}

.rbk--telefon {
    --rb-symbol: calc(var(--icon-xxl) * 1.15);
    --rb-beleg-bild: calc(var(--icon-xxl) * 2);
}

/* Die Bestätigung. */
.rbk__erfolg {
    display: flex;
    align-items: center;
    gap: var(--space-16);
}

.rbk--telefon .rbk__erfolg {
    gap: var(--space-10);
}

.rbk__symbol {
    position: relative;
    flex: none;
    width: var(--rb-symbol);
    height: var(--rb-symbol);
}

.rbk__bild {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: contain;
}

/* Wie das Plus der Ablagefläche, nun ein Haken: dasselbe Pergament, erledigt. Er springt einmal sanft ein. */
.rbk__haken {
    position: absolute;
    right: calc(-1 * var(--space-4));
    bottom: calc(-1 * var(--space-2) / 2);
    display: grid;
    place-items: center;
    box-sizing: border-box;
    width: calc(var(--icon-lg) + var(--space-2));
    height: calc(var(--icon-lg) + var(--space-2));
    border: calc(var(--space-2) * 0.75) solid var(--color-panel);
    border-radius: 50%;
    background: var(--color-accent);
    color: var(--color-page-bg-deep);
    animation: rbk-haken-ein 320ms cubic-bezier(0.2, 0.7, 0.2, 1.3) 160ms both;
}

.rbk__haken svg {
    width: calc(var(--icon-sm) - var(--space-2) / 4);
    height: calc(var(--icon-sm) - var(--space-2) / 4);
    stroke-width: 3;
}

@keyframes rbk-haken-ein {
    from {
        transform: scale(0.3);
        opacity: 0;
    }
}

.rbk__erfolg-text {
    display: grid;
    gap: var(--space-2);
    min-width: 0;
}

.rbk__erfolg-titel {
    margin: 0;
    color: var(--color-text-strong);
    font-size: var(--font-size-display);
    line-height: var(--leading-tight);
}

.rbk__erfolg-satz {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-reading);
    line-height: var(--leading-normal);
}

/* Das eingereichte Bild (eingepasst, ungedimmt) mit Beschreibung, Stelle und dem Ablauf. */
.rbk__beleg {
    display: grid;
    grid-template-columns: var(--rb-beleg-bild) minmax(0, 1fr);
    align-items: center;
    gap: var(--space-10) var(--space-10);
    padding: var(--space-8);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    background: var(--color-panel-soft);
}

.rbk__beleg-bild {
    position: relative;
    overflow: hidden;
    aspect-ratio: 16 / 10;
    border-radius: var(--radius-md);
    background: var(--color-panel-muted);
}

.rbk__beleg-bild img {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: contain;
}

.rbk__beleg-text {
    display: grid;
    gap: var(--space-4);
    min-width: 0;
}

.rbk__beleg-titel {
    display: -webkit-box;
    margin: 0;
    overflow: hidden;
    color: var(--color-text-strong);
    font-size: var(--font-size-reading);
    line-height: var(--leading-snug);
    overflow-wrap: anywhere;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 3;
    line-clamp: 3;
}

.rbk__beleg-mehr {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

.rbk__nadel {
    flex: none;
    width: var(--icon-sm);
    height: var(--icon-sm);
    object-fit: contain;
}

.rbk__stufen {
    display: grid;
    grid-column: 1 / -1;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    margin: 0;
    padding: var(--space-8) 0 0;
    border-top: 1px solid var(--color-divider);
    list-style: none;
}

.rbk__stufen li {
    position: relative;
    display: grid;
    justify-items: center;
    gap: var(--space-4);
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
    text-align: center;
}

/* Die Verbindung zur vorigen Stufe: grau, bis die Stufe erreicht ist. */
.rbk__stufen li + li::before {
    position: absolute;
    top: var(--space-8);
    right: calc(50% + var(--icon-sm));
    left: calc(-50% + var(--icon-sm));
    height: 2px;
    border-radius: 1px;
    background: var(--color-divider);
    content: "";
}

.rbk__stufen li.is-jetzt::before {
    background: var(--color-accent);
}

.rbk__stufen li.is-erledigt,
.rbk__stufen li.is-jetzt {
    color: var(--color-text-strong);
}

.rbk__punkt {
    position: relative;
    z-index: 1;
    display: grid;
    place-items: center;
    box-sizing: border-box;
    width: var(--rb-stufe);
    height: var(--rb-stufe);
    border: 2px solid var(--color-border-strong);
    border-radius: 50%;
    background: var(--color-panel-soft);
    color: var(--color-page-bg-deep);
}

.rbk__punkt svg {
    width: calc(var(--icon-sm) - var(--space-2) / 2);
    height: calc(var(--icon-sm) - var(--space-2) / 2);
    stroke-width: 3;
}

.rbk__stufen li.is-erledigt .rbk__punkt {
    border-color: var(--color-accent);
    background: var(--color-accent);
}

.rbk__stufen li.is-jetzt .rbk__punkt {
    border-color: var(--color-accent);
    box-shadow: 0 0 0 var(--space-2) var(--color-hover-wash);
}

.rbk__stufen li.is-jetzt .rbk__punkt::after {
    width: var(--space-6);
    height: var(--space-6);
    border-radius: 50%;
    background: var(--color-accent);
    content: "";
}

/* Leise Textknöpfe: ohne Fläche, bis man sie berührt. */
.rbk__weiter {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: var(--space-4) var(--space-10);
    margin-top: calc(-1 * var(--space-6));
}

.rbk__leise {
    display: inline-flex;
    align-items: center;
    min-height: var(--icon-lg);
    padding: 0 var(--space-6);
    border: 1px solid transparent;
    border-radius: var(--radius-md);
    background: none;
    color: var(--color-button-soft-text);
    cursor: pointer;
    font: inherit;
    font-size: var(--font-size-small);
    white-space: nowrap;
    transition:
        background-color 120ms ease,
        border-color 120ms ease,
        color 120ms ease;
}

.rbk__leise:hover {
    border-color: var(--color-button-soft-border);
    background: var(--color-button-soft-hover);
    color: var(--color-text-strong);
}

.rbk__leise:active {
    background: var(--color-button-soft-active);
}

.rbk__leise:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
}

@media (prefers-reduced-motion: reduce) {
    .rbk__haken {
        animation: none;
    }

    .rbk__leise {
        transition: none;
    }
}
</style>
