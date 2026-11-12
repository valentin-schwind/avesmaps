<script setup lang="ts">
import { computed, nextTick, useId, useTemplateRef } from "vue";
import type { KopierZustand } from "../controls/avm-kopierfeld";
import { phoneViewport } from "../controls/phone-viewport";
import { t } from "../i18n/i18n";
import ReisebildZeichen from "./reisebild-zeichen.vue";
import { REISEBILD_SYMBOLE } from "./reisebild-zeichen";

/**
 * Der Kasten „Persönlicher Link“ (WI-0272 S3, Aufgabe 19a; Entwurf 9, Betreiber 2026-11-01): der goldene Kasten der Bestätigung (Entwurf 8) mit Linkzeile und „Link kopieren“, darunter neu das Häkchen
 * „Auf diesem Gerät merken“. EIN Bauteil für die Bestätigung (`reisebild-fertig.vue`) und die Statusseite (`reisebild-status-fenster.vue`, `kompakt`: ohne den langen Satz, in kleineren Maßen).
 *
 * - **Der Link steht einzeilig, hinten gekürzt** (über `.einzeilig`, voll als `title`); ein Klick markiert ihn ganz, damit er auch von Hand zu kopieren ist, wo die Zwischenablage nicht erlaubt ist.
 *   **„Link kopieren“** ist der Hauptknopf; nach dem Kopieren steht 2,6 s „✓ Kopiert“ in Erfolgsgrün, gleich breit. Was kopiert wird und wie der Knopf aussieht, hält der Aufrufer (`link-kopieren.ts`).
 * - 🔴 **Das Häkchen „Auf diesem Gerät merken“ ist ein echtes `<input type="checkbox">` mit Label**, mit der Tastatur zu bedienen, und **anfangs leer**: Der Zustand kommt allein aus der Merkliste
 *   (`gemerkt`), nie aus einer Vorbelegung. Gemerkt wird nur im Browserspeicher (`meine-reisebilder.ts`). Sperrt der Browser den Speicher (`merkenMoeglich` falsch), gibt es weder Häkchen noch Zeile.
 * - 🔴 **Die Höhe springt beim Setzen des Häkchens nicht:** Beide Fassungen („merken“ mit dem Hinweis, wo es steht, und „gemerkt“) liegen in DERSELBEN Zelle übereinander und sind nur umgeschaltet
 *   (`visibility`); die Zeile reserviert den Platz der längeren. Auf der Statusseite (`kompakt`) steht dazu in der gemerkten Zeile das leise „Vergessen“; sein Platz ist auch ohne Häkchen reserviert.
 * - **Das Elternteil entscheidet:** Das Kästchen meldet nur den Wunsch (`merken`); ob der Speicher mitmacht, zeigt der Wert `gemerkt` danach. Lehnt er ab, springt das Kästchen zurück, und eine leise
 *   Zeile sagt, warum (`merkenProblem`, Review S3 M4): „Die Liste ist voll. …“ oder „Der Browser lässt das Merken nicht zu.“ Sie liegt in DERSELBEN Zelle wie die Erklärzeile unter dem Titel (beide Sätze
 *   stehen immer im Dokument, nur umgeschaltet), die Höhe springt also nie; für Vorleser meldet sie ein verstecktes `status`.
 * - **Nach „Vergessen“** (Statusseite) geht der Fokus auf das Kästchen (Review S3 M5a): Der Knopf wird dabei unsichtbar, und der Fokus bliebe sonst auf einem verborgenen Element.
 * - **Der Warnring** (`warnt`) liegt um den Kasten, solange vor dem Verlust des Links gewarnt wird; `zeigeLink` rollt ihn in Sicht (der Rumpf rollt, wo das Fenster niedrig ist).
 */
const props = defineProps<{
    /** Der ganze persönliche Link. */
    link: string;
    /** Wie der Kopierknopf gerade aussieht: Ruhe, „✓ Kopiert“ oder „ging nicht“. */
    kopiert: KopierZustand;
    /** Wird gerade vor dem Verlust des Links gewarnt (Warnring)? */
    warnt?: boolean | undefined;
    /** Die Statusseite: ohne den langen Satz, in kleineren Maßen, mit „Vergessen“ in der gemerkten Zeile. */
    kompakt?: boolean | undefined;
    /** Lässt der Browser das Merken zu? Sonst fehlen Häkchen und Zeile still. */
    merkenMoeglich: boolean;
    /** Ist dieser Link gemerkt? */
    gemerkt: boolean;
    /** Warum das Merken eben nicht ging: die Liste ist voll oder der Browser lässt es nicht zu; `undefined`, solange nichts schiefging. */
    merkenProblem?: "voll" | "gesperrt" | undefined;
    /** Der Anfang der Kennungen für Tests: `reisebild-fertig` oder `reisebild-status`. */
    testid: string;
    /** Der Titel, wenn es nicht der persönliche Link eines Reisebilds ist (das Kontaktformular: „Link zur Statusseite“). */
    titel?: string | undefined;
    /** Der Satz unter dem Titel, wenn er nicht von einem Reisebild spricht (Karte vorschlagen, WI-0275); ohne Angabe der Satz der Reisebilder. */
    satz?: string | undefined;
}>();
const emit = defineEmits<{
    kopieren: [];
    /** Der Wunsch: `true` = merken, `false` = vergessen. */
    merken: [an: boolean];
}>();

const kennungId = useId();
const kasten = useTemplateRef<HTMLElement>("kasten");
const linkText = useTemplateRef<HTMLElement>("linkText");
const kopierKnopf = useTemplateRef<HTMLButtonElement>("kopierKnopf");
const merkFeld = useTemplateRef<HTMLInputElement>("merkFeld");
/** Der Satz zum Problem, für Vorleser (der sichtbare liegt in der Zelle der Erklärzeile). */
const problemText = computed(() =>
    props.merkenProblem === undefined
        ? ""
        : t(props.merkenProblem === "voll" ? "photobox.merken.voll" : "photobox.merken.gesperrt"),
);
/** Der Link ohne Schema, wie die Zeile ihn zeigt (`avesmaps.de/reisebild#…`); der volle steht im `title` und kommt in die Zwischenablage. */
const anzeigeLink = computed(() => props.link.replace(/^https?:\/\//u, ""));

/** Den Linkkasten in Sicht rollen (der Rumpf rollt, wo das Fenster niedrig ist), ohne Rollbewegung bei „weniger Bewegung“. */
function zeigeLink(): void {
    const reduziert = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
    kasten.value?.scrollIntoView?.({ block: "nearest", behavior: reduziert ? "auto" : "smooth" });
}

/** Den Link ganz markieren: Wo die Zwischenablage nicht erlaubt ist, nimmt Strg+C ihn mit. */
function markiereLink(): void {
    const knoten = linkText.value;
    const auswahl = globalThis.getSelection?.();
    if (knoten === null || auswahl === null || auswahl === undefined) return;
    const bereich = document.createRange();
    bereich.selectNodeContents(knoten);
    auswahl.removeAllRanges();
    auswahl.addRange(bereich);
}

/**
 * Der Fokus geht auf „Link kopieren“, sobald die Bestätigung steht: Der Knopf, der eben gedrückt war (das Einreichen), ist aus dem Fenster verschwunden, und der Fokus läge sonst auf der Seite statt im
 * Fenster. So erreichen Tastatur und Vorleser das Wichtigste zuerst, und Esc gilt dem Fenster.
 */
function fokussiereKopieren(): void {
    kopierKnopf.value?.focus({ preventScroll: true });
}
defineExpose({ zeigeLink, markiereLink, fokussiereKopieren });

/** „Vergessen“ auf der Statusseite: Der Knopf verschwindet dabei, der Fokus geht auf das Kästchen daneben. */
function vergessenGedrueckt(): void {
    emit("merken", false);
    void nextTick(() => merkFeld.value?.focus({ preventScroll: true }));
}

function geaendert(ereignis: Event): void {
    const feld = ereignis.target as HTMLInputElement;
    emit("merken", feld.checked);
    // Das Elternteil hat gemerkt oder abgelehnt (der Speicher kann voll sein): Das Kästchen zeigt, was gilt.
    void nextTick(() => {
        feld.checked = props.gemerkt;
    });
}
</script>

<template>
    <section
        ref="kasten"
        class="lk"
        :class="{
            'is-fehlt': props.warnt === true,
            'lk--kompakt': props.kompakt === true,
            'lk--telefon': phoneViewport,
        }"
        :aria-labelledby="`${kennungId}-titel`"
        :data-testid="`${props.testid}-linkkasten`"
    >
        <div class="lk__kopf">
            <img class="lk__symbol" :src="REISEBILD_SYMBOLE.linkteilen" alt="" aria-hidden="true" decoding="async" />
            <div>
                <h3 :id="`${kennungId}-titel`" class="lk__titel">{{ props.titel ?? t("photobox.fertig.linkName") }}</h3>
                <p v-if="props.kompakt !== true" class="lk__satz" :data-testid="`${props.testid}-linksatz`">
                    {{ props.satz ?? t("photobox.fertig.linkHinweis") }}
                </p>
            </div>
        </div>
        <div class="lk__zeile">
            <code ref="linkText" class="lk__link einzeilig" :title="props.link" :data-testid="`${props.testid}-link`">{{
                anzeigeLink
            }}</code>
            <button
                ref="kopierKnopf"
                type="button"
                class="lk__kopieren"
                :class="{ 'is-kopiert': props.kopiert === 'kopiert' }"
                :data-testid="`${props.testid}-kopieren`"
                @click="emit('kopieren')"
            >
                <ReisebildZeichen :name="props.kopiert === 'kopiert' ? 'haken' : 'kopie'" />
                <span>{{ props.kopiert === "kopiert" ? t("photobox.fertig.kopiert") : t("ui.copy.button") }}</span>
            </button>
        </div>
        <!-- Die Rückmeldung für Vorleser (der Knopf zeigt „Kopiert“ nur 2,6 s) und der Satz, wenn es nicht ging. -->
        <p
            class="lk__meldung"
            :class="{
                'lk__meldung--fehler': props.kopiert === 'fehler',
                'lk__meldung--still': props.kopiert !== 'fehler',
            }"
            role="status"
            :data-testid="`${props.testid}-meldung`"
        >
            {{
                props.kopiert === "kopiert" ? t("ui.copy.done") : props.kopiert === "fehler" ? t("ui.copy.failed") : ""
            }}
        </p>

        <!-- „Auf diesem Gerät merken“: das Häkchen von Entwurf 8, mit Titel und leiser Zeile. Beide Fassungen liegen übereinander. -->
        <div v-if="props.merkenMoeglich" class="lk__merkzeile" :data-testid="`${props.testid}-merkzeile`">
            <label
                class="lk__merken"
                :class="{ 'is-gemerkt': props.gemerkt }"
                :data-testid="`${props.testid}-merken-label`"
            >
                <input
                    ref="merkFeld"
                    class="lk__feld"
                    type="checkbox"
                    :checked="props.gemerkt"
                    :data-testid="`${props.testid}-merken`"
                    @change="geaendert"
                />
                <span class="lk__haken" aria-hidden="true"><ReisebildZeichen name="haken" /></span>
                <span class="lk__merken-text">
                    <span class="lk__fassung lk__merken-aus">
                        <span class="lk__merken-titel">{{ t("photobox.merken.label") }}</span>
                        <!-- Die Erklärzeile und die beiden Sätze zum Problem teilen sich EINE Zelle: Was nicht gilt, ist unsichtbar, die Höhe bleibt. -->
                        <span class="lk__hinweiszelle">
                            <span class="lk__merken-hinweis" :class="{ 'is-weg': props.merkenProblem !== undefined }">{{
                                t("photobox.merken.hinweis")
                            }}</span>
                            <span
                                class="lk__merken-hinweis lk__merken-problem"
                                :class="{ 'is-weg': props.merkenProblem !== 'voll' }"
                                aria-hidden="true"
                                :data-testid="`${props.testid}-merken-voll`"
                                >{{ t("photobox.merken.voll") }}</span
                            >
                            <span
                                class="lk__merken-hinweis lk__merken-problem"
                                :class="{ 'is-weg': props.merkenProblem !== 'gesperrt' }"
                                aria-hidden="true"
                                :data-testid="`${props.testid}-merken-gesperrt`"
                                >{{ t("photobox.merken.gesperrt") }}</span
                            >
                        </span>
                    </span>
                    <span class="lk__fassung lk__merken-an">
                        <span class="lk__merken-titel">{{ t("photobox.merken.gemerkt") }}</span>
                        <span class="lk__merken-hinweis">{{ t("photobox.merken.gemerktHinweis") }}</span>
                    </span>
                </span>
            </label>
            <!-- Die Rückmeldung für Vorleser: leer, bis das Merken scheitert. -->
            <span class="lk__lesen" role="status" :data-testid="`${props.testid}-merkproblem`">{{ problemText }}</span>
            <!-- Auf der Statusseite: leise „Vergessen“; der Platz ist auch ohne Häkchen reserviert, damit die Zeile nicht springt. -->
            <button
                v-if="props.kompakt === true"
                type="button"
                class="lk__vergessen"
                :class="{ 'is-versteckt': !props.gemerkt }"
                :data-testid="`${props.testid}-vergessen`"
                @click="vergessenGedrueckt"
            >
                {{ t("photobox.merken.vergessen") }}
            </button>
        </div>
    </section>
</template>

<style scoped>
/*
 * Alle Maße aus dem Kanon, keine Zahl im Bauteil; die Mehrfachen sind die Maße der Probierseite (Entwurf 8 und 9) in Kanonschritten (siehe `reisebild-formular.vue`). `--lk-knopf` ist die Höhe von Linkzeile
 * und Hauptknopf: 44 in der Bestätigung, 40 auf der Statusseite.
 */
.lk {
    --lk-knopf: calc(var(--avm-control-h) + var(--space-10));
    --lk-symbol: calc(var(--icon-xl) - var(--space-2) / 2);

    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: var(--space-10);
    min-width: 0;
    padding: var(--space-10);
    border: 2px solid var(--color-accent);
    border-radius: var(--radius-lg);
    background: color-mix(in srgb, var(--color-accent) 9%, var(--color-panel));
    box-shadow: var(--shadow-field-rest);
    transition:
        border-color 160ms ease,
        box-shadow 160ms ease;
}

/* Die Statusseite: derselbe Kasten, nur ohne den langen Satz und etwas kleiner. */
.lk--kompakt {
    --lk-knopf: calc(var(--avm-control-h) + var(--space-6));
    --lk-symbol: calc(var(--icon-lg) + var(--space-6));

    gap: var(--space-6);
    padding: var(--space-8) var(--space-12);
}

/* Gewarnt: ein Warnring um den Kasten, damit der Blick dorthin geht. */
.lk.is-fehlt {
    border-color: var(--color-warning);
    box-shadow: 0 0 0 var(--space-4) color-mix(in srgb, var(--color-warning) 32%, transparent);
}

.lk__kopf {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    align-items: start;
    gap: var(--space-10);
}

.lk--kompakt .lk__kopf {
    align-items: center;
    gap: var(--space-8);
}

.lk__symbol {
    width: var(--lk-symbol);
    height: var(--lk-symbol);
    object-fit: contain;
}

.lk__titel {
    margin: var(--space-2) 0 var(--space-2);
    color: var(--color-text-strong);
    font-size: var(--font-size-subhead);
    font-weight: var(--font-weight-regular);
    line-height: var(--leading-snug);
}

.lk--kompakt .lk__titel {
    margin: 0;
}

.lk__satz {
    margin: 0;
    color: var(--color-text);
    font-size: var(--font-size-body);
    line-height: var(--leading-normal);
}

.lk__zeile {
    display: flex;
    align-items: stretch;
    gap: var(--space-6);
}

.lk--telefon .lk__zeile {
    flex-direction: column;
}

/* Eine Zeile, hinten gekürzt (`.einzeilig`); ein Klick markiert den ganzen Link. */
.lk__link {
    display: block;
    flex: 1 1 auto;
    box-sizing: border-box;
    min-width: 0;
    min-height: var(--lk-knopf);
    padding: 0 var(--space-8);
    border: 1px solid var(--color-button-soft-border);
    border-radius: var(--radius-lg);
    background: var(--color-panel);
    color: var(--color-text-strong);
    cursor: text;
    font-family: inherit;
    font-size: var(--font-size-reading);
    line-height: calc(var(--lk-knopf) - var(--space-2) / 2);
    user-select: all;
    transition: border-color 120ms ease;
}

.lk__link:hover {
    border-color: color-mix(in srgb, var(--color-accent) 60%, var(--color-button-soft-border));
}

.lk__link::selection {
    background: var(--color-active-wash);
}

/* Der Hauptknopf „Link kopieren“, in der Akzentfarbe; nach dem Kopieren „✓ Kopiert“ in Erfolgsgrün, gleich breit. */
.lk__kopieren {
    display: inline-flex;
    flex: none;
    align-items: center;
    justify-content: center;
    gap: var(--space-6);
    box-sizing: border-box;
    min-width: calc(var(--icon-xl) * 3.7);
    min-height: var(--lk-knopf);
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

.lk--kompakt .lk__kopieren {
    min-width: calc(var(--icon-xl) * 3.4);
}

.lk--telefon .lk__kopieren {
    width: 100%;
    min-height: calc(var(--lk-knopf) + var(--space-2));
}

.lk__kopieren svg {
    width: var(--icon-md);
    height: var(--icon-md);
    stroke-width: 2;
}

.lk__kopieren:hover {
    background: color-mix(in srgb, var(--color-accent) 86%, var(--color-text-strong));
    box-shadow: var(--shadow-button-hover-strong);
    transform: translateY(-1px);
}

.lk__kopieren:active {
    background: color-mix(in srgb, var(--color-accent) 80%, var(--color-page-bg-deep));
    box-shadow: none;
    transform: none;
}

.lk__kopieren:focus-visible {
    outline: none;
    box-shadow:
        0 0 0 2px var(--color-panel),
        0 0 0 5px var(--color-accent);
}

.lk__kopieren.is-kopiert,
.lk__kopieren.is-kopiert:hover,
.lk__kopieren.is-kopiert:active {
    border-color: var(--color-success-soft-border);
    background: var(--color-success-soft);
    box-shadow: none;
    color: var(--color-success-soft-text);
    transform: none;
}

.lk__meldung {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
    line-height: var(--leading-normal);
}

.lk__meldung--fehler {
    color: var(--color-warning-soft-text);
}

/* Die Rückmeldung für Vorleser steht im Dokument, nimmt aber keinen Platz: Der Knopf zeigt „Kopiert“ selbst. */
.lk__meldung--still {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
}

/* „Auf diesem Gerät merken“: das Häkchen mit Titel und leiser Zeile, bei der Statusseite mit dem leisen „Vergessen“ daneben. */
.lk__merkzeile {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: start;
    gap: var(--space-4);
    margin: 0 calc(-1 * var(--space-8));
}

.lk__merken {
    position: relative;
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    grid-column: 1;
    align-items: start;
    gap: var(--space-8);
    padding: var(--space-8);
    border-radius: var(--radius-lg);
    cursor: pointer;
    transition:
        background-color 120ms ease,
        box-shadow 120ms ease;
}

.lk__merken:hover {
    background: var(--color-hover-wash);
}

.lk__feld {
    position: absolute;
    top: var(--space-8);
    left: var(--space-8);
    width: var(--icon-md);
    height: var(--icon-md);
    margin: 0;
    opacity: 0;
    pointer-events: none;
}

.lk__haken {
    display: grid;
    place-items: center;
    box-sizing: border-box;
    width: var(--icon-md);
    height: var(--icon-md);
    margin-top: 1px;
    border: 2px solid var(--color-border-strong);
    border-radius: var(--radius-sm);
    background: var(--color-panel);
    color: var(--color-page-bg-deep);
    transition:
        background-color 120ms ease,
        border-color 120ms ease,
        box-shadow 120ms ease;
}

.lk__haken svg {
    width: var(--icon-sm);
    height: var(--icon-sm);
    stroke-width: 3;
    opacity: 0;
    transform: scale(0.4);
    transition:
        opacity 140ms ease,
        transform 140ms ease;
}

.lk__merken:hover .lk__haken {
    border-color: var(--color-accent);
}

.lk__merken:active .lk__haken {
    background: var(--color-active-wash);
}

.lk__feld:checked + .lk__haken {
    border-color: var(--color-accent);
    background: var(--color-accent);
}

.lk__feld:checked + .lk__haken svg {
    opacity: 1;
    transform: none;
}

.lk__feld:focus-visible + .lk__haken {
    box-shadow: var(--focus-ring);
}

/* Beide Fassungen in einer Zelle: Die Zeile ist von Anfang an so hoch wie die längere und ändert sich beim Setzen nicht. */
.lk__merken-text {
    display: grid;
    min-width: 0;
}

.lk__fassung {
    display: grid;
    grid-area: 1 / 1;
    gap: var(--space-2);
    min-width: 0;
}

.lk__merken:not(.is-gemerkt) .lk__merken-an,
.lk__merken.is-gemerkt .lk__merken-aus {
    visibility: hidden;
}

/* Erklärzeile und Sätze zum Problem in einer Zelle (Review S3 M4): Die Zelle ist so hoch wie der längste Satz, was nicht gilt, ist unsichtbar. */
.lk__hinweiszelle {
    display: grid;
    min-width: 0;
}

.lk__hinweiszelle > * {
    grid-area: 1 / 1;
}

.lk__merken-hinweis.is-weg {
    visibility: hidden;
}

.lk__merken-problem {
    color: var(--color-text);
}

/* Die Rückmeldung für Vorleser steht im Dokument, nimmt aber keinen Platz: Der Satz selbst steht in der Zelle der Erklärzeile. */
.lk__lesen {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
}

.lk__merken-titel {
    color: var(--color-text-strong);
    font-size: var(--font-size-reading);
    line-height: var(--leading-snug);
}

.lk__merken-hinweis {
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
    line-height: var(--leading-normal);
}

/* Beim Überfahren liegt der Hauch der Zeile unter der leisen Zeile (dunkel nur 3,4 : 1): Sie nimmt dann die normale Textfarbe. */
.lk__merken:hover .lk__merken-hinweis {
    color: var(--color-text);
}

/* „Vergessen“ auf der Statusseite: ein leiser Textknopf, erst sichtbar, wenn gemerkt ist. */
.lk__vergessen {
    display: inline-flex;
    align-items: center;
    align-self: center;
    min-height: var(--icon-lg);
    margin-right: var(--space-8);
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

.lk__vergessen.is-versteckt {
    visibility: hidden;
}

.lk__vergessen:hover {
    border-color: var(--color-button-soft-border);
    background: var(--color-button-soft-hover);
    color: var(--color-text-strong);
}

.lk__vergessen:active {
    background: var(--color-button-soft-active);
}

.lk__vergessen:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
}

@media (prefers-reduced-motion: reduce) {
    .lk,
    .lk__link,
    .lk__kopieren,
    .lk__merken,
    .lk__haken,
    .lk__haken svg,
    .lk__vergessen {
        transition: none;
    }

    .lk__kopieren:hover {
        transform: none;
    }
}
</style>
