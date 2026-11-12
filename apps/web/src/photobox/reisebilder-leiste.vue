<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, useTemplateRef, watch } from "vue";
import { phoneViewport } from "../controls/phone-viewport";
import { showToast } from "../feedback/toast";
import { t } from "../i18n/i18n";
import { ladeBauteilVor, ReisebildBesucher } from "../nachladen";
import { merkliste } from "./meine-reisebilder";
import { reisebildBesucher } from "./reisebild-besucher";
import { ersteMarkierte } from "./reisebilder-leiste-modell";
import { useMeineLeiste } from "./reisebilder-meine";
import { reisebilder } from "./reisebilder-zustand";
import ReisebildKiZeichen from "./reisebild-ki-zeichen.vue";
import ReisebildZeichen from "./reisebild-zeichen.vue";
import { REISEBILD_SYMBOLE } from "./reisebild-zeichen";

/**
 * Die Leiste der Reisebilder (WI-0272 S4, Aufgabe 28): über die ganze Breite am unteren Rand, eine Kachel je Bild im Ausschnitt, von West nach Ost. Beim Verschieben der Karte bleiben die Kacheln
 * im DOM, die bleiben (`TransitionGroup` mit fester Reihenfolge), neue wachsen ein und gehende schrumpfen aus. Die erste Kachel macht ein Bild an der Mitte der freien Fläche
 * (`reisebildBesucher.oeffne(…, { neu, waehlen })`).
 *
 * - **Sichtbar** nur, wenn der Host es sagt (`sichtbar`): offen, Standardansicht, nichts davor. Zu heißt `inert` und `visibility: hidden` nach der Fahrt.
 * - **Markiert** (Klick auf ein Symbol der Karte) rückt die erste markierte Kachel nach 450 ms in die Mitte; **hervor** (Zeiger über Symbol oder Kachel) umrandet sie.
 * - **Rechts die Filter** (Vali 2026-11-03, Probierseite Fassung 2, Idee B), sie rollen nicht mit: „Ohne KI“ blendet als KI-generiert gekennzeichnete Bilder aus und bleibt gemerkt; „Meine Reisebilder“ zeigt nur die eigenen,
 *   Offenes als Kachel mit Marke vorn. Beide wirken über `bilder` und `imBild` des Zustands, also auch auf Karte, Knopf und Bildansicht. „Reisebilder ausblenden“ (Vali 2026-11-04) nimmt nur die Symbole von der Karte, die
 *   Kacheln bleiben. Am Telefon nur die Zeichen, in zwei Spalten.
 * - **Rad** läuft waagerecht, die Leiste fängt das Scrollen (`overscroll-behavior-x: contain`, `touch-action: pan-x`). Reduzierte Bewegung: keine Übergänge.
 * - Maße im Kanon der Leiste (`--leiste-h`, `--kachel`); die Höhe meldet die Leiste dem Host, der sie als `leisteUnten` für Eckbund, Maßstab, Toast und Panels weitergibt.
 */
const props = defineProps<{ sichtbar: boolean }>();
const emit = defineEmits<{ hoehe: [pixel: number] }>();

const { imBild, markiert, hervor, gekappt, ohneKi, nurMeine, ausgeblendet } = reisebilder;
const { offene, offenZahl, laedt: meineLaedt, schalte: schalteMeine } = useMeineLeiste();
const hatMeine = computed(() => merkliste.eintraege.value.length > 0);
/** Der Filter lässt hier nichts übrig: Das sagt die Leiste und bietet das Ausschalten an. */
const leerOhneKi = computed(
    () => ohneKi.value && imBild.value.length === 0 && offene.value.length === 0 && !meineLaedt.value,
);

function schalteOhneKi(): void {
    const vorher = imBild.value.length;
    reisebilder.setzeOhneKi(!ohneKi.value);
    if (!ohneKi.value) return;
    showToast(
        vorher === 0
            ? t("photobox.karte.ohneKiHinweis")
            : t("photobox.karte.ohneKiGezeigt", { gezeigt: imBild.value.length, alle: vorher }),
    );
}

async function oeffneStand(): Promise<void> {
    await ladeBauteilVor(ReisebildBesucher);
    reisebildBesucher.oeffneMeine();
}

const wurzel = useTemplateRef<HTMLElement>("wurzel");
const reihe = useTemplateRef<HTMLElement>("reihe");

const hervorIds = computed<ReadonlySet<string>>(() =>
    hervor.value === undefined ? new Set<string>() : new Set(reisebilder.gruppeVon(hervor.value)),
);

function zeigen(id: string): void {
    reisebilder.setzeHervor(id, "kachel");
}
function nichtMehr(id: string): void {
    if (reisebilder.hervor.value === id) reisebilder.setzeHervor(undefined);
}
function oeffne(id: string): void {
    reisebilder.oeffneAnsicht(id);
}
function bildFehlt(id: string): void {
    reisebilder.vergissBild(id);
}

async function neuesBild(): Promise<void> {
    // Vorher auflösen: `stelle-layer.ts` misst das Fenster im nächsten Takt für die Fahrt zur Stelle (WI-0235).
    await ladeBauteilVor(ReisebildBesucher);
    const mitte = reisebilder.mitteFrei();
    if (mitte === undefined) return;
    reisebildBesucher.oeffne(mitte, undefined, { neu: true, waehlen: true });
}

/** Das Rad scrollt die Leiste waagerecht. */
function rad(ereignis: WheelEvent): void {
    const element = reihe.value;
    if (element === null || element.scrollWidth <= element.clientWidth) return;
    if (Math.abs(ereignis.deltaX) > Math.abs(ereignis.deltaY)) return;
    ereignis.preventDefault();
    element.scrollLeft += ereignis.deltaY;
}

/** Eine neue Markierung bringt die erste markierte Kachel nach 450 ms in die Mitte (die Karte fliegt gerade, die Leiste wartet auf Ruhe). */
let zentrieren: ReturnType<typeof setTimeout> | undefined;
watch(markiert, (jetzt) => {
    if (zentrieren !== undefined) clearTimeout(zentrieren);
    if (jetzt.size === 0) return;
    zentrieren = setTimeout(() => {
        const id = ersteMarkierte(
            imBild.value.map((b) => b.id),
            jetzt,
        );
        if (id === undefined) return;
        const kachel = reihe.value?.querySelector<HTMLElement>(`[data-bild-id="${id}"]`);
        const reduziert = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        kachel?.scrollIntoView({ inline: "center", block: "nearest", behavior: reduziert ? "auto" : "smooth" });
    }, 450);
});

let beobachter: ResizeObserver | undefined;
onMounted(() => {
    reihe.value?.addEventListener("wheel", rad, { passive: false });
    const messe = (): void => emit("hoehe", wurzel.value?.offsetHeight ?? 0);
    beobachter = new ResizeObserver(messe);
    if (wurzel.value) beobachter.observe(wurzel.value);
    void nextTick(messe);
});
onBeforeUnmount(() => {
    reihe.value?.removeEventListener("wheel", rad);
    beobachter?.disconnect();
    if (zentrieren !== undefined) clearTimeout(zentrieren);
});
</script>

<template>
    <section
        id="reisebilder-leiste"
        ref="wurzel"
        class="reisebilder-leiste"
        :class="{ 'is-sichtbar': props.sichtbar, 'is-phone': phoneViewport }"
        data-map-overlay="bottom"
        :inert="!props.sichtbar"
        data-testid="reisebilder-leiste"
        :aria-label="t('photobox.karte.leiste')"
    >
        <div ref="reihe" class="reisebilder-leiste__reihe">
            <button type="button" class="kachel kachel--neu" data-testid="reisebild-neu" @click="neuesBild">
                <img :src="REISEBILD_SYMBOLE.bildmachen" alt="" aria-hidden="true" />
                <span class="kachel__neu-text">{{ t("photobox.titel") }}</span>
            </button>
            <TransitionGroup name="kachel" tag="div" class="reisebilder-leiste__kacheln">
                <button
                    v-if="nurMeine"
                    key="stand"
                    type="button"
                    class="kachel kachel--stand"
                    data-testid="reisebild-stand"
                    @click="oeffneStand"
                >
                    <span class="kachel__innen">
                        <img :src="REISEBILD_SYMBOLE.kartensammlung" alt="" aria-hidden="true" decoding="async" />
                        <span class="kachel__neu-text">{{ t("photobox.karte.standAnsehen") }}</span>
                    </span>
                </button>
                <button
                    v-for="offen in offene"
                    :key="offen.schluessel"
                    type="button"
                    class="kachel kachel--offen"
                    :aria-label="`${offen.beschreibung}: ${t(offen.marke.key)}`"
                    data-testid="reisebild-offen"
                    @click="oeffneStand"
                >
                    <img
                        v-if="offen.vorschau !== undefined"
                        :src="offen.vorschau"
                        alt=""
                        decoding="async"
                        draggable="false"
                    />
                    <img
                        v-else
                        class="kachel__platzhalter"
                        :src="REISEBILD_SYMBOLE.kartensammlung"
                        alt=""
                        aria-hidden="true"
                        decoding="async"
                    />
                    <span class="kachel__marke">
                        <img
                            v-if="offen.marke.zeichen.art === 'gemalt'"
                            :src="offen.marke.zeichen.pfad"
                            alt=""
                            aria-hidden="true"
                            decoding="async"
                        />
                        <span class="einzeilig">{{ t(offen.marke.key) }}</span>
                    </span>
                </button>
                <button
                    v-for="bild in imBild"
                    :key="bild.id"
                    type="button"
                    class="kachel kachel--bild"
                    :class="{ 'is-markiert': markiert.has(bild.id), 'is-hervor': hervorIds.has(bild.id) }"
                    :data-bild-id="bild.id"
                    data-testid="reisebild-kachel"
                    :aria-label="bild.beschreibung"
                    @click="oeffne(bild.id)"
                    @pointerenter="zeigen(bild.id)"
                    @pointerleave="nichtMehr(bild.id)"
                    @focus="zeigen(bild.id)"
                    @blur="nichtMehr(bild.id)"
                >
                    <img
                        :src="bild.kachel?.url ?? bild.datei.url"
                        alt=""
                        loading="lazy"
                        decoding="async"
                        draggable="false"
                        @error="bildFehlt(bild.id)"
                    />
                    <span v-if="bild.entstehung === 'ai_generated'" class="kachel__ki">
                        <ReisebildKiZeichen />
                    </span>
                    <span class="kachel__titel">
                        <span class="kachel__titeltext">{{ bild.beschreibung }}</span>
                    </span>
                </button>
            </TransitionGroup>
            <p v-if="leerOhneKi" class="reisebilder-leiste__leer" data-testid="reisebilder-leer-ohne-ki">
                <span>{{ t(nurMeine ? "photobox.karte.leerMeineOhneKi" : "photobox.karte.leerOhneKi") }}</span>
                <button
                    type="button"
                    class="reisebilder-leiste__filter-aus"
                    data-testid="reisebilder-filter-aus"
                    @click="schalteOhneKi"
                >
                    {{ t("photobox.karte.filterAus") }}
                </button>
            </p>
            <p
                v-else-if="imBild.length === 0 && !nurMeine"
                class="reisebilder-leiste__leer"
                data-testid="reisebilder-leer"
            >
                {{ t("photobox.karte.leer") }}
            </p>
            <p v-else-if="gekappt" class="reisebilder-leiste__mehr" data-testid="reisebilder-mehr">
                {{ t("photobox.karte.mehr") }}
            </p>
        </div>
        <div class="reisebilder-leiste__rechts" data-testid="reisebilder-filter">
            <button
                type="button"
                class="filterknopf"
                :aria-pressed="ohneKi"
                :title="t('photobox.karte.ohneKiHinweis')"
                data-testid="reisebilder-ohne-ki"
                @click="schalteOhneKi"
            >
                <ReisebildZeichen name="roboterAus" />
                <span class="filterknopf__wort">{{ t("photobox.karte.ohneKi") }}</span>
            </button>
            <button
                v-if="hatMeine"
                type="button"
                class="filterknopf"
                :aria-pressed="nurMeine"
                :title="t('photobox.karte.meineHinweis')"
                data-testid="reisebilder-meine"
                @click="schalteMeine"
            >
                <img :src="REISEBILD_SYMBOLE.kartensammlung" alt="" aria-hidden="true" decoding="async" />
                <span class="filterknopf__wort">{{ t("photobox.meine.titel") }}</span>
                <span v-if="offenZahl > 0" class="filterknopf__zahl" data-testid="reisebilder-meine-zahl">{{
                    offenZahl
                }}</span>
            </button>
            <button
                type="button"
                class="filterknopf"
                :aria-pressed="ausgeblendet"
                :title="t('photobox.karte.ausblendenHinweis')"
                data-testid="reisebilder-ausblenden"
                @click="reisebilder.setzeAusgeblendet(!ausgeblendet)"
            >
                <ReisebildZeichen name="augeAus" />
                <span class="filterknopf__wort">{{ t("photobox.karte.ausblenden") }}</span>
            </button>
        </div>
    </section>
</template>

<style scoped>
/*
 * Maße der Leiste (Probierseite): die Leiste 118 px hoch, die Kachel 90 px, am Telefon 92 und 68 px. Sie sind Maße dieses einen Bauteils, kein Abstand des Kanons trifft sie; darum benannt.
 * Der Filterknopf ist so hoch, dass drei übereinander in die Leiste passen; am Telefon bleibt er griffig und steht in zwei Spalten.
 */
.reisebilder-leiste {
    --leiste-h: 118px;
    --kachel: 90px;
    --filterknopf: 32px;
    --leiste-fahrt: 220ms;

    position: absolute;
    right: 0;
    bottom: 0;
    left: 0;
    z-index: var(--z-map-ui);
    display: flex;
    box-sizing: border-box;
    height: var(--leiste-h);
    border-top: 1px solid var(--color-border-strong);
    background: var(--color-panel);
    box-shadow: var(--shadow-panel);
    color: var(--color-text);
    font-size: var(--font-size-small);
    transform: translateY(100%);
    visibility: hidden;
    /* Zu: erst fahren, dann verbergen (die Leiste soll herunterfahren, nicht verschwinden). */
    transition:
        transform var(--leiste-fahrt) ease,
        visibility 0s linear var(--leiste-fahrt);
}

.reisebilder-leiste.is-phone {
    --leiste-h: 92px;
    --kachel: 68px;
    --filterknopf: 34px;
}

.reisebilder-leiste.is-sichtbar {
    transform: none;
    visibility: visible;
    transition:
        transform var(--leiste-fahrt) ease,
        visibility 0s;
}

/*
 * Oben angeschlagen statt mittig (Vali 2026-11-03: „verhindern, dass die reisebilder springen, wenn die scrollbar auftaucht“): Mittig rückten die Kacheln um die halbe Höhe der Scrollbar nach oben, sobald
 * sie mehr wurden, als in die Leiste passen. Der Rand unter den Kacheln ist so hoch wie der darüber, und in ihm läuft die schmale Scrollbar.
 */
.reisebilder-leiste__reihe {
    flex: 1 1 auto;
    display: flex;
    min-width: 0;
    align-items: flex-start;
    gap: var(--space-8);
    height: 100%;
    box-sizing: border-box;
    padding: calc((var(--leiste-h) - var(--kachel)) / 2) var(--space-12) 0;
    overflow-x: auto;
    overflow-y: hidden;
    overscroll-behavior-x: contain;
    touch-action: pan-x;
    scrollbar-width: thin;
}

.reisebilder-leiste__kacheln {
    display: flex;
    align-items: center;
    gap: var(--space-8);
}

.kachel {
    position: relative;
    flex: 0 0 auto;
    width: var(--kachel);
    height: var(--kachel);
    box-sizing: border-box;
    padding: 0;
    overflow: hidden;
    border: 1px solid var(--color-border-strong);
    border-radius: var(--radius-md);
    background: var(--color-panel-soft);
    color: inherit;
    cursor: pointer;
    font-family: inherit;
    transition:
        box-shadow 120ms ease,
        border-color 120ms ease;
}

.kachel img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
}

.kachel:hover,
.kachel:focus-visible {
    outline: none;
    border-color: var(--color-accent);
}

.kachel:focus-visible {
    box-shadow: var(--focus-ring, 0 0 0 3px var(--color-focus));
}

/* Markiert (Klick auf ein Symbol der Karte) und hervor (Zeiger über Symbol oder Kachel): ein Rand im Gelb der Auswahl der Karte. */
.kachel.is-markiert,
.kachel.is-hervor {
    border-color: var(--color-map-selection);
    box-shadow: 0 0 0 2px var(--color-map-selection);
}

/* Die erste Kachel: das gemalte Symbol „Bild machen“ und der Titel des Formulars, zweizeilig. */
.kachel--neu {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-4);
    padding: var(--space-4);
    background: var(--color-panel);
}

.kachel--neu img {
    width: 50%;
    height: auto;
    object-fit: contain;
}

.kachel__neu-text {
    display: -webkit-box;
    overflow: hidden;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    font-size: var(--font-size-caption);
    line-height: var(--leading-tight);
    text-align: center;
}

/*
 * „Stand ansehen“ und die offenen Bilder kommen und gehen mit den Kacheln. Ihr Inhalt behält dabei seine Größe, die Kachel deckt ihn nur auf (Vali 2026-11-03: Die Skalierung „sieht nicht so schön aus, wie das
 * eingeblende von der seite“). Die 2 px sind der Rahmen der Kachel.
 */
.kachel--stand,
.kachel--offen {
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--color-panel);
}

.kachel__innen {
    flex: none;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-4);
    width: calc(var(--kachel) - 2px);
    height: 100%;
    box-sizing: border-box;
    padding: var(--space-4);
}

.kachel__innen img {
    width: 50%;
    height: auto;
    object-fit: contain;
}

.kachel .kachel__platzhalter {
    flex: none;
    width: calc(var(--kachel) * 0.5);
    height: calc(var(--kachel) * 0.5);
    object-fit: contain;
}

.kachel__marke {
    position: absolute;
    bottom: var(--space-2);
    left: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 2px;
    width: calc(var(--kachel) - 2px - var(--space-2));
    box-sizing: border-box;
    padding: var(--space-2) 2px;
    overflow: hidden;
    border-radius: var(--radius-sm);
    background: var(--color-panel);
    color: var(--color-text-strong);
    font-size: var(--font-size-caption);
    line-height: var(--leading-tight);
    transform: translateX(-50%);
}

/* Das Wort der Marke braucht die Breite der Kachel, das Zeichen bleibt darum etwas kleiner als sonst. */
.kachel .kachel__marke img {
    flex: none;
    width: calc(var(--icon-sm) - 2px);
    height: calc(var(--icon-sm) - 2px);
    object-fit: contain;
}

.is-phone .kachel__marke span {
    display: none;
}

.kachel__ki {
    position: absolute;
    right: var(--space-4);
    bottom: var(--space-4);
    display: inline-flex;
    padding: 2px;
    border-radius: var(--radius-sm);
    background: var(--color-panel);
    color: var(--color-text-strong);
    font-size: var(--font-size-caption);
    line-height: 1;
}

/* Der Titel erscheint beim Zeigen. */
.kachel__titel {
    position: absolute;
    right: 0;
    bottom: 0;
    left: 0;
    padding: var(--space-4) var(--space-6);
    background: var(--color-panel);
    font-size: var(--font-size-caption);
    line-height: var(--leading-tight);
    opacity: 0;
    text-align: left;
    transition: opacity 120ms ease;
}

/* Höchstens zwei Zeilen, dann „…“ (Vali 2026-11-03). Der Abstand liegt außen: Am selben Element schaute die dritte Zeile im unteren Abstand heraus. */
.kachel__titeltext {
    display: -webkit-box;
    overflow: hidden;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
}

.kachel--bild:hover .kachel__titel,
.kachel--bild:focus-visible .kachel__titel {
    opacity: 1;
}

.reisebilder-leiste__leer,
.reisebilder-leiste__mehr {
    display: flex;
    flex: 0 0 auto;
    align-items: center;
    gap: var(--space-8);
    height: var(--kachel);
    margin: 0;
    color: var(--color-text-muted);
    white-space: nowrap;
}

.reisebilder-leiste__filter-aus {
    padding: 0;
    border: 0;
    background: none;
    color: var(--color-accent-strong);
    cursor: pointer;
    font-family: inherit;
    font-size: inherit;
    text-decoration: underline;
    text-underline-offset: 2px;
}

.reisebilder-leiste__filter-aus:hover,
.reisebilder-leiste__filter-aus:focus-visible {
    outline: none;
    color: var(--color-text-strong);
}

.reisebilder-leiste__filter-aus:focus-visible {
    box-shadow: var(--focus-ring);
}

/* Rechts in der Leiste: Die Filter rollen nicht mit. */
.reisebilder-leiste__rechts {
    flex: none;
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: var(--space-4);
    padding: 0 var(--space-12);
    border-left: 1px solid var(--color-border);
}

.is-phone .reisebilder-leiste__rechts {
    display: grid;
    grid-auto-flow: column;
    grid-template-rows: repeat(2, var(--filterknopf));
    align-content: center;
    padding: 0 var(--space-6);
}

.filterknopf {
    position: relative;
    display: inline-flex;
    align-items: center;
    gap: var(--space-6);
    height: var(--filterknopf);
    box-sizing: border-box;
    padding: 0 var(--space-10) 0 var(--space-8);
    border: 1px solid var(--color-border-strong);
    border-radius: var(--radius-md);
    background: var(--color-panel);
    color: inherit;
    cursor: pointer;
    font-family: inherit;
    font-size: var(--font-size-small);
    line-height: var(--leading-tight);
    white-space: nowrap;
    transition:
        background-color 120ms ease,
        border-color 120ms ease;
}

.filterknopf svg,
.filterknopf img {
    flex: none;
    width: var(--icon-md);
    height: var(--icon-md);
    object-fit: contain;
}

.filterknopf:hover {
    border-color: var(--color-accent);
    background: var(--color-hover-wash);
}

.filterknopf:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
}

.filterknopf[aria-pressed="true"] {
    border-color: var(--color-accent);
    background: color-mix(in srgb, var(--color-accent) 26%, var(--color-panel));
    box-shadow: inset 0 0 0 1px var(--color-accent);
    color: var(--color-text-strong);
}

.filterknopf[aria-pressed="true"]:focus-visible {
    box-shadow:
        inset 0 0 0 1px var(--color-accent),
        var(--focus-ring);
}

.filterknopf__zahl {
    display: inline-grid;
    place-items: center;
    min-width: var(--icon-sm);
    height: var(--icon-sm);
    margin-left: auto;
    padding: 0 var(--space-2);
    box-sizing: border-box;
    border-radius: calc(var(--icon-sm) / 2);
    background: var(--color-accent);
    color: var(--color-panel);
    font-size: var(--font-size-caption);
    line-height: 1;
    font-variant-numeric: tabular-nums;
}

.is-phone .filterknopf {
    justify-content: center;
    width: var(--filterknopf);
    padding: 0;
}

.is-phone .filterknopf__wort {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
}

.is-phone .filterknopf__zahl {
    position: absolute;
    top: calc(var(--space-4) * -1);
    right: calc(var(--space-4) * -1);
}

/* Kommen und Gehen: Die Kachel wächst in der Breite ein und aus, die Deckkraft folgt etwas schneller (Probierseite). */
.kachel-enter-active,
.kachel-leave-active {
    transition:
        width 280ms ease,
        opacity 220ms ease,
        border-width 280ms ease;
}

.kachel-enter-from,
.kachel-leave-to {
    width: 0;
    border-width: 0;
    opacity: 0;
}

@media (prefers-reduced-motion: reduce) {
    .reisebilder-leiste,
    .reisebilder-leiste.is-sichtbar,
    .kachel,
    .kachel__titel,
    .filterknopf,
    .kachel-enter-active,
    .kachel-leave-active {
        transition: none;
    }
}
</style>
