<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, shallowRef, useId, useTemplateRef, watch } from "vue";
import { ortAusAntwort } from "../community/community-besucher";
import type { BezugOrt } from "../community/meldung-modell";
import AvmKnopf from "../controls/avm-knopf.vue";
import { phoneViewport } from "../controls/phone-viewport";
import AvmFenster from "../fenster/avm-fenster.vue";
import type { FensterBox, FensterHuellenLage, FensterVorgabeEcke } from "../fenster/fenster-lage";
import { showToast } from "../feedback/toast";
import { t } from "../i18n/i18n";
import { fetchNearestPlace } from "../route-planner/route-client";
import { fehlerArt, ladeVorschau, leseStatus } from "./api";
import { REISEBILD_MEINE_FENSTER } from "./fenster-linie";
import { merkliste } from "./meine-reisebilder";
import {
    ART_KURZ,
    ladeMeine,
    letzteStaende,
    MARKE_UNKLAR,
    MARKE_WEG,
    markeFuerStand,
    meinCache,
    naechsteOrte,
    ortSchluessel,
    type Marke,
    type MeinErgebnis,
    type MeinLauf,
} from "./meine-reisebilder-modell";
import type { ReisebildSteuerung } from "./reisebild-besucher";
import ReisebildZeichen from "./reisebild-zeichen.vue";
import { REISEBILD_SYMBOLE } from "./reisebild-zeichen";
import { stelleText } from "./stelle-text";

/**
 * Das Fenster „Meine Reisebilder“ (WI-0272 S3, Aufgabe 19a; Entwurf 9, Betreiber 2026-11-01: „ok dann mach das so, auch in dem stil“): die Einreichungen, deren persönlichen Link dieses Gerät gemerkt hat
 * (`meine-reisebilder.ts`), je Einreichung eine Karte. Ein Besucherfenster der Hülle (`AvmFenster`) wie das Formular: gelöst und mittig über der Karte, angedockt (▥) am rechten Rand, am Telefon das Blatt
 * unten, ohne Ablage, in einer festen Höhe je Ansicht (`stabil`). Was gerechnet wird (Marken, Laden der Stände), steht in `meine-reisebilder-modell.ts`.
 *
 * - **Je Karte:** das Vorschaubild (72 × 72, ohne Vorschau das gemalte Symbol), die Beschreibung in einer Zeile (hinten gekürzt, voll als Tooltip), leise die Stelle in Worten und die Art kurz („Gemalt“),
 *   die Zustandsmarke und ein leises „Vergessen“. Neueste zuerst. 🔴 **Die ganze Karte ist der Knopf** (die Beschreibung trägt ihn, `::after` deckt die Karte ab) und öffnet die Statusseite im selben Fenster
 *   (`von: "meine"`: dort führt „‹ Meine Reisebilder“ zurück).
 * - 🔴 **Der Stand kommt beim Öffnen vom Server, nacheinander** (`ladeMeine`, die vorhandene Status-Route; der Schlüssel im Rumpf, nie in der Adresse). Bis er da ist, zeigt die Karte den Text aus dem letzten
 *   Abruf dieser Sitzung oder einen ruhigen Platzhalter, ohne Marke; die Höhe der Karte springt nicht. Bei der Lesegrenze (429) und bei Fehlern steht „Stand gerade nicht abrufbar“, nie ein erfundener Stand;
 *   „gibt es nicht (mehr)“ ist „Nicht mehr vorhanden“. Ein Durchgang, kein Takt.
 * - **„Vergessen“ fragt einmal nach** („Nur von diesem Gerät entfernen? Das Reisebild bleibt eingereicht.“): Die Frage ersetzt den Inhalt der Karte, damit Karte und Fenster nicht wachsen; Esc nimmt sie zuerst
 *   zurück. Danach meldet ein Hinweis, dass das Reisebild eingereicht bleibt, und der Fokus geht auf die nächste Karte (sonst auf „Schließen“).
 * - **Leer:** „Nichts gemerkt.“ mit dem gemalten Symbol der Kartensammlung.
 */
const offen = defineModel<boolean>("offen", { required: true });
const props = defineProps<{
    steuerung: ReisebildSteuerung;
    lage: FensterHuellenLage;
    box?: FensterBox | undefined;
    vorgabeEcke?: FensterVorgabeEcke | undefined;
}>();
const emit = defineEmits<{
    "update:lage": [lage: Exclude<FensterHuellenLage, "modal">, box?: FensterBox];
    "update:box": [box: FensterBox];
    vorn: [];
}>();

const kennungId = useId();
const wurzel = useTemplateRef<HTMLElement>("wurzel");
const schliessen = useTemplateRef<InstanceType<typeof AvmKnopf>>("schliessen");

// --- Was die Karten zeigen: Stand je Eintrag, Vorschau, Ort ---------------------------------------------------------------------

/** Was das Laden je Schlüssel ergeben hat; ein Schlüssel ohne Eintrag ist noch unterwegs. */
const ergebnisse = shallowRef<Readonly<Record<string, MeinErgebnis>>>({});
/** Die Vorschau je Schlüssel als Adresse nur für diese Seite (`URL.createObjectURL`), beim Schließen freigegeben. */
const vorschauen = shallowRef<Readonly<Record<string, string>>>({});
const orte = shallowRef<Readonly<Record<string, BezugOrt>>>({});
/** Die Karte, die gerade „Vergessen?“ fragt. */
const frageFuer = ref<string | undefined>(undefined);

/** Eine Karte, wie sie dasteht (nie der Schlüssel selbst im Dokument). */
interface Karte {
    readonly schluessel: string;
    readonly titel: string;
    /** Steht ein echter Stand (oder der letzte dieser Sitzung) dahinter? Sonst ein Platzhalter in gedämpfter Schrift. */
    readonly echt: boolean;
    readonly mehr: string;
    readonly marke: Marke | undefined;
    readonly vorschau: string | undefined;
    /** Öffnet die Karte die Statusseite? Eine Einreichung, die es nicht mehr gibt, hat dort nichts zu zeigen. */
    readonly oeffnet: boolean;
}

const karten = computed((): Karte[] =>
    merkliste.eintraege.value.map(({ schluessel }) => {
        const ergebnis = ergebnisse.value[schluessel];
        // Der Text der Karte darf vom letzten Abruf dieser Sitzung stammen, die Marke nie.
        const status =
            ergebnis?.art === "da"
                ? ergebnis.status
                : ergebnis?.art === "weg"
                  ? undefined
                  : letzteStaende.get(schluessel);
        const marke =
            ergebnis === undefined
                ? undefined
                : ergebnis.art === "da"
                  ? markeFuerStand(ergebnis.status)
                  : ergebnis.art === "weg"
                    ? MARKE_WEG
                    : MARKE_UNKLAR;
        const ort = orte.value[schluessel];
        return {
            schluessel,
            titel:
                status?.beschreibung ??
                (ergebnis?.art === "weg"
                    ? t("photobox.status.fehlt")
                    : ergebnis?.art === "unklar"
                      ? t("photobox.status.titel")
                      : t("photobox.meine.laedt")),
            echt: status !== undefined,
            mehr: status === undefined ? "" : `${stelleText(status.lage, ort)} · ${t(ART_KURZ[status.entstehung])}`,
            marke,
            vorschau: vorschauen.value[schluessel],
            oeffnet: ergebnis?.art !== "weg",
        };
    }),
);

function setze<T>(wert: { value: Readonly<Record<string, T>> }, schluessel: string, neu: T | undefined): void {
    const rest = { ...wert.value };
    if (neu === undefined) delete rest[schluessel];
    else rest[schluessel] = neu;
    wert.value = rest;
}

function gibVorschauFrei(schluessel: string): void {
    const adresse = vorschauen.value[schluessel];
    if (adresse !== undefined) URL.revokeObjectURL(adresse);
    setze(vorschauen, schluessel, undefined);
}

let aktiv = true;

/** Der nächste Ort zur Stelle einer Karte, wie die Statusseite ihn nennt (derselbe Satz „nordöstlich von Gareth“); ohne Antwort bleibt „Stelle auf der Karte“. */
function holeOrt(schluessel: string, lage: { x: number; y: number }): void {
    const stelle = ortSchluessel(lage);
    const bekannt = naechsteOrte.get(stelle);
    if (bekannt !== undefined) {
        setze(orte, schluessel, bekannt);
        return;
    }
    void fetchNearestPlace(lage)
        .then((antwort) => {
            const ort = ortAusAntwort(antwort);
            if (ort === undefined) return;
            naechsteOrte.set(stelle, ort);
            if (aktiv) setze(orte, schluessel, ort);
        })
        .catch(() => undefined);
}

// Was ein anderer Tab inzwischen gemerkt oder vergessen hat, steht beim Öffnen schon da.
merkliste.liesNeu();
const schluesselJetzt = (): string[] => merkliste.eintraege.value.map((eintrag) => eintrag.schluessel);
/** Die Fragen an den Server; der Zwischenspeicher der Sitzung (60 s) erspart dem Rückweg zur Liste alle (Review S3 M2). */
const ladeUmfeld = {
    leseStatus: (schluessel: string) => leseStatus(schluessel),
    ladeVorschau: (schluessel: string) => ladeVorschau(schluessel),
    fehlerArt,
    // Was unterwegs vergessen wird, wird weder gefragt noch gemeldet; was ein anderer Tab dazumerkt, fragt der Durchgang am Ende nach (Review S3 M3).
    noch: (schluessel: string) => merkliste.hat(schluessel),
    aktuelle: schluesselJetzt,
};
const ladeAusgang = {
    stand(schluessel: string, ergebnis: MeinErgebnis): void {
        setze(ergebnisse, schluessel, ergebnis);
        if (ergebnis.art === "da") holeOrt(schluessel, ergebnis.status.lage);
    },
    vorschau(schluessel: string, bild: Blob): void {
        gibVorschauFrei(schluessel);
        setze(vorschauen, schluessel, URL.createObjectURL(bild));
    },
};
/** Zu Ende gelaufen? Dann holt ein später gemerkter Schlüssel (anderer Tab) einen eigenen Durchgang: nie zwei zugleich. */
let lauf: MeinLauf = ladeMeine(ladeUmfeld, schluesselJetzt(), ladeAusgang, { cache: meinCache });
let laeuft = true;
function nachDemLauf(): void {
    void lauf.fertig.then(() => {
        laeuft = false;
        nachfragen();
    });
}
function nachfragen(): void {
    if (!aktiv || laeuft) return;
    const offen = schluesselJetzt().filter((schluessel) => ergebnisse.value[schluessel] === undefined);
    if (offen.length === 0) return;
    laeuft = true;
    lauf = ladeMeine(ladeUmfeld, offen, ladeAusgang, { cache: meinCache });
    nachDemLauf();
}
nachDemLauf();
watch(() => merkliste.eintraege.value, nachfragen);
onBeforeUnmount(() => {
    aktiv = false;
    lauf.stoppe();
    for (const adresse of Object.values(vorschauen.value)) URL.revokeObjectURL(adresse);
});

// --- Bedienen: Stand ansehen, vergessen --------------------------------------------------------------------------------------

function oeffneStand(schluessel: string): void {
    props.steuerung.oeffneStatus(schluessel, { von: "meine" });
}

/** Das Element einer Karte, das den Fokus trägt: die Beschreibung (der Knopf der Karte), sonst „Vergessen“. */
function fokusAnKarte(nr: number): HTMLElement | undefined {
    const karte = wurzel.value?.querySelectorAll("li").item(nr);
    return (
        karte?.querySelector<HTMLElement>('[data-fokus="titel"]') ??
        karte?.querySelector<HTMLElement>('[data-fokus="vergessen"]') ??
        undefined
    );
}

function fragen(schluessel: string): void {
    frageFuer.value = schluessel;
    void nextTick(() =>
        wurzel.value?.querySelector<HTMLElement>('[data-testid="reisebild-meine-vergessen-ja"]')?.focus(),
    );
}

function behalten(): void {
    const nr = karten.value.findIndex((karte) => karte.schluessel === frageFuer.value);
    frageFuer.value = undefined;
    void nextTick(() =>
        wurzel.value?.querySelectorAll("li").item(nr)?.querySelector<HTMLElement>('[data-fokus="vergessen"]')?.focus(),
    );
}

function vergessen(schluessel: string): void {
    const nr = karten.value.findIndex((karte) => karte.schluessel === schluessel);
    frageFuer.value = undefined;
    merkliste.vergiss(schluessel);
    gibVorschauFrei(schluessel);
    setze(ergebnisse, schluessel, undefined);
    setze(orte, schluessel, undefined);
    letzteStaende.delete(schluessel);
    meinCache.vergiss(schluessel);
    showToast(t("photobox.meine.gemeldet"));
    // Der Fokus geht auf die nächste Karte, sonst auf „Schließen“: Die Karte, auf der er stand, ist weg.
    void nextTick(() => {
        const naechste = fokusAnKarte(Math.min(nr, karten.value.length - 1));
        if (karten.value.length > 0 && naechste !== undefined) naechste.focus();
        else schliessen.value?.focus();
    });
}

/** Esc nimmt zuerst die Frage „Vergessen?“ zurück; erst ein zweiter Druck schließt das Fenster. */
function escInFrage(ereignis: KeyboardEvent): void {
    if (frageFuer.value === undefined) return;
    ereignis.stopPropagation();
    behalten();
}
</script>

<template>
    <AvmFenster
        v-model:offen="offen"
        bauart="werkzeug"
        breite="entscheiden"
        :lage="props.lage"
        :box="props.box"
        :vorgabe-ecke="props.vorgabeEcke"
        hoehe="inhalt"
        stabil
        ansicht="liste"
        ohne-ablage
        telefon-blatt
        :titel="t('photobox.meine.titel')"
        :unterzeile="t('photobox.meine.unterzeile')"
        :testid="REISEBILD_MEINE_FENSTER"
        @update:lage="(neu, box) => emit('update:lage', neu, box)"
        @update:box="(neu) => emit('update:box', neu)"
        @vorn="emit('vorn')"
    >
        <div ref="wurzel" class="mr" :class="{ 'mr--telefon': phoneViewport }" @keydown.esc="escInFrage">
            <ul
                v-if="karten.length > 0"
                class="mr__liste"
                :aria-label="t('photobox.meine.liste')"
                data-testid="reisebild-meine-liste"
            >
                <li
                    v-for="(karte, nr) in karten"
                    :key="karte.schluessel"
                    class="mr__karte"
                    :class="{
                        'is-frage': frageFuer === karte.schluessel,
                        'is-rueckfrage': karte.marke?.ton === 'rueckfrage',
                        'is-offen': karte.oeffnet,
                    }"
                    data-testid="reisebild-meine-karte"
                >
                    <span class="mr__bild">
                        <img
                            v-if="karte.vorschau !== undefined"
                            :src="karte.vorschau"
                            alt=""
                            data-testid="reisebild-meine-vorschau"
                        />
                        <img
                            v-else
                            class="mr__bild-leer"
                            :src="REISEBILD_SYMBOLE.kartensammlung"
                            alt=""
                            aria-hidden="true"
                            decoding="async"
                        />
                    </span>

                    <!-- Die Frage „Vergessen?“ ersetzt den Inhalt der Karte, damit sie nicht wächst. -->
                    <template v-if="frageFuer === karte.schluessel">
                        <div
                            class="mr__frage"
                            role="group"
                            :aria-label="t('photobox.meine.vergessenFuer', { titel: karte.titel })"
                            data-testid="reisebild-meine-frage"
                        >
                            {{ t("photobox.meine.frage") }}
                        </div>
                        <div class="mr__antwort">
                            <button
                                type="button"
                                class="mr__klein"
                                data-testid="reisebild-meine-vergessen-ja"
                                @click="vergessen(karte.schluessel)"
                            >
                                {{ t("photobox.merken.vergessen") }}
                            </button>
                            <button
                                type="button"
                                class="mr__leise"
                                data-testid="reisebild-meine-vergessen-nein"
                                @click="behalten"
                            >
                                {{ t("photobox.waehlen.abbrechen") }}
                            </button>
                        </div>
                    </template>

                    <template v-else>
                        <div class="mr__text">
                            <button
                                v-if="karte.oeffnet"
                                type="button"
                                class="mr__titel einzeilig"
                                :class="{ 'is-platzhalter': !karte.echt }"
                                :title="karte.echt ? karte.titel : undefined"
                                :aria-describedby="
                                    karte.marke === undefined ? undefined : `${kennungId}-marke-${String(nr)}`
                                "
                                data-fokus="titel"
                                data-testid="reisebild-meine-titel"
                                @click="oeffneStand(karte.schluessel)"
                            >
                                {{ karte.titel }}
                            </button>
                            <span
                                v-else
                                class="mr__titel mr__titel--aus einzeilig is-platzhalter"
                                data-testid="reisebild-meine-titel-aus"
                                >{{ karte.titel }}</span
                            >
                            <p class="mr__mehr" data-testid="reisebild-meine-mehr">
                                <template v-if="karte.mehr !== ''">
                                    <img
                                        class="mr__nadel"
                                        :src="REISEBILD_SYMBOLE.pin"
                                        alt=""
                                        aria-hidden="true"
                                        decoding="async"
                                    />
                                    <span class="einzeilig">{{ karte.mehr }}</span>
                                </template>
                            </p>
                        </div>
                        <div class="mr__rechts">
                            <span
                                v-if="karte.marke !== undefined"
                                :id="`${kennungId}-marke-${String(nr)}`"
                                class="mr__marke"
                                :class="`mr__marke--${karte.marke.ton}`"
                                data-testid="reisebild-meine-marke"
                            >
                                <img
                                    v-if="karte.marke.zeichen.art === 'gemalt'"
                                    class="mr__marke-bild"
                                    :src="karte.marke.zeichen.pfad"
                                    alt=""
                                    aria-hidden="true"
                                    decoding="async"
                                />
                                <ReisebildZeichen v-else class="mr__marke-linie" :name="karte.marke.zeichen.zeichen" />
                                <span>{{ t(karte.marke.key) }}</span>
                            </span>
                            <button
                                type="button"
                                class="mr__leise mr__vergessen"
                                :aria-label="t('photobox.meine.vergessenFuer', { titel: karte.titel })"
                                data-fokus="vergessen"
                                data-testid="reisebild-meine-vergessen"
                                @click="fragen(karte.schluessel)"
                            >
                                {{ t("photobox.merken.vergessen") }}
                            </button>
                        </div>
                    </template>
                </li>
            </ul>

            <!-- Nichts gemerkt: das gemalte Symbol und ein Satz, wie sich das ändert. -->
            <div v-else class="mr__leer" data-testid="reisebild-meine-leer">
                <img
                    class="mr__leer-bild"
                    :src="REISEBILD_SYMBOLE.kartensammlung"
                    alt=""
                    aria-hidden="true"
                    decoding="async"
                />
                <p class="mr__leer-titel">{{ t("photobox.meine.leer") }}</p>
                <p class="mr__leer-satz">{{ t("photobox.meine.leerHinweis") }}</p>
            </div>
        </div>

        <template #fuss>
            <div class="mr__fuss" :class="{ 'mr__fuss--telefon': phoneViewport }" data-testid="reisebild-meine-fuss">
                <p class="mr__fuss-satz">{{ t("photobox.meine.fuss") }}</p>
                <AvmKnopf ref="schliessen" testid="reisebild-meine-schliessen" @click="offen = false">{{
                    t("photobox.fertig.schliessen")
                }}</AvmKnopf>
            </div>
        </template>
    </AvmFenster>
</template>

<style scoped>
/*
 * Alle Maße aus dem Kanon, keine Zahl im Bauteil; die Mehrfachen sind die Maße der Probierseite (Entwurf 9) in Kanonschritten (siehe `reisebild-formular.vue`).
 */
.mr {
    --mr-bild: calc(var(--icon-xxl) * 1.5);
    --mr-marke: calc(var(--icon-lg) + var(--space-2) / 2);

    min-width: 0;
    /* Der Rumpf der Hülle polstert 8 / 14; zusammen mit diesem Polster stehen die Karten 14 oben, 18 an den Seiten und 18 unten. */
    padding: var(--space-4) var(--space-2) var(--space-8);
}

.mr__liste {
    display: grid;
    gap: var(--space-6);
    margin: 0;
    padding: 0;
    list-style: none;
}

/* Eine Karte je gemerkte Einreichung; die ganze Karte öffnet den Stand, „Vergessen“ liegt darüber. */
.mr__karte {
    position: relative;
    display: grid;
    grid-template-columns: var(--mr-bild) minmax(0, 1fr) auto;
    align-items: start;
    gap: var(--space-4) var(--space-10);
    box-sizing: border-box;
    min-width: 0;
    padding: var(--space-8);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    background: var(--color-panel-soft);
    transition:
        border-color 140ms ease,
        background-color 140ms ease;
}

/* Nur eine Karte, die etwas öffnet, reagiert auf Zeiger und Druck: „Nicht mehr vorhanden“ bleibt ruhig (Review S3 M7, Design Guide §30.5). */
.mr__karte.is-offen:hover {
    border-color: color-mix(in srgb, var(--color-accent) 60%, var(--color-border));
    background: color-mix(in srgb, var(--color-accent) 7%, var(--color-panel-soft));
}

.mr__karte.is-offen:active {
    background: color-mix(in srgb, var(--color-accent) 13%, var(--color-panel-soft));
}

/* Eine Rückfrage der Redaktion fällt auf: ein Rand in der Akzentfarbe um die Karte. */
.mr__karte.is-rueckfrage {
    border-color: var(--color-accent);
}

.mr__bild {
    display: grid;
    grid-row: 1 / -1;
    place-items: center;
    overflow: hidden;
    width: var(--mr-bild);
    height: var(--mr-bild);
    border-radius: var(--radius-md);
    background: var(--color-panel-muted);
}

.mr__bild img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
}

/* Ohne Vorschau steht das gemalte Symbol, kleiner und mittig, nie abgedunkelt. */
.mr__bild .mr__bild-leer {
    width: 62%;
    height: 62%;
    object-fit: contain;
}

.mr__text {
    display: grid;
    align-content: start;
    gap: var(--space-2);
    min-width: 0;
    padding-top: calc(var(--space-2) / 2);
}

/* Die Beschreibung ist der Knopf; sein ::after deckt die ganze Karte ab. */
.mr__titel {
    display: block;
    box-sizing: border-box;
    width: 100%;
    margin: 0;
    padding: 0;
    border: 0;
    background: none;
    color: var(--color-text-strong);
    cursor: pointer;
    font: inherit;
    font-size: var(--font-size-reading);
    line-height: var(--leading-snug);
    text-align: left;
}

.mr__titel.is-platzhalter {
    color: var(--color-text-muted);
}

.mr__titel--aus {
    cursor: default;
}

.mr__titel::after {
    position: absolute;
    inset: 0;
    border-radius: var(--radius-lg);
    content: "";
}

.mr__titel--aus::after {
    content: none;
}

.mr__titel:focus-visible {
    outline: none;
}

.mr__titel:focus-visible::after {
    box-shadow: var(--focus-ring);
}

/* Die zweite Zeile ist von Anfang an so hoch wie eine Zeile, auch ohne Text: Die Karte springt nicht, wenn der Stand ankommt. */
.mr__mehr {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    min-width: 0;
    min-height: calc(var(--font-size-small) * var(--leading-normal));
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
    line-height: var(--leading-normal);
}

.mr__mehr > span {
    min-width: 0;
}

.mr__nadel {
    flex: none;
    width: var(--icon-sm);
    height: var(--icon-sm);
    object-fit: contain;
}

.mr__rechts {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    align-self: stretch;
    justify-content: space-between;
    gap: var(--space-4);
    min-height: var(--mr-bild);
}

/* Die Zustandsmarke: Symbol und Wort; „Rückfrage“ in der Akzentfarbe, die Freigabe grün, die abgeschlossenen und unklaren Zustände leise. */
.mr__marke {
    display: inline-flex;
    flex: none;
    align-items: center;
    gap: var(--space-2);
    box-sizing: border-box;
    min-height: var(--mr-marke);
    padding: 0 var(--space-8) 0 var(--space-4);
    border: 1px solid var(--color-border);
    border-radius: calc(var(--mr-marke) / 2);
    background: var(--color-panel);
    color: var(--color-text);
    font-size: var(--font-size-small);
    line-height: var(--leading-tight);
    white-space: nowrap;
}

.mr__marke-bild {
    flex: none;
    width: var(--icon-kachel);
    height: var(--icon-kachel);
    object-fit: contain;
}

svg.mr__marke-linie {
    flex: none;
    width: calc(var(--icon-sm) - var(--space-2) / 2);
    height: calc(var(--icon-sm) - var(--space-2) / 2);
    margin: 0 calc(var(--space-2) / 2);
}

.mr__marke--rueckfrage {
    border-color: var(--color-accent);
    background: var(--color-panel);
    box-shadow: 0 0 0 calc(var(--space-2) * 0.75) var(--color-hover-wash);
    color: var(--color-accent-strong);
}

.mr__marke--oeffentlich {
    border-color: var(--color-success-soft-border);
    background: var(--color-success-soft);
    color: var(--color-success-soft-text);
}

.mr__marke--leise {
    border-color: transparent;
    background: transparent;
    color: var(--color-text-muted);
}

/* Leise Textknöpfe: ohne Fläche, bis man sie berührt; „Vergessen“ liegt über dem ::after der Karte, damit es für sich zu treffen ist. */
.mr__leise {
    display: inline-flex;
    align-items: center;
    justify-content: center;
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

.mr__leise:hover {
    border-color: var(--color-button-soft-border);
    background: var(--color-button-soft-hover);
    color: var(--color-text-strong);
}

.mr__leise:active {
    background: var(--color-button-soft-active);
}

.mr__leise:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
}

.mr__vergessen {
    position: relative;
    z-index: 1;
    margin: 0 calc(-1 * var(--space-4)) calc(-1 * var(--space-2)) 0;
}

/* Die Frage „Vergessen?“: ein Satz und zwei Knöpfe, an der Stelle von Text und Marke. */
.mr__karte.is-frage {
    align-items: center;
}

.mr__frage {
    margin: 0;
    color: var(--color-text-strong);
    font-size: var(--font-size-body);
    line-height: var(--leading-normal);
}

.mr__antwort {
    display: grid;
    gap: var(--space-4);
    justify-items: stretch;
}

/* Der kleine Knopf in der Akzentfarbe: die Antwort, die etwas tut. */
.mr__klein {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    box-sizing: border-box;
    min-height: calc(var(--avm-control-h) - var(--space-2) / 2);
    padding: 0 var(--space-8);
    border: 1px solid var(--color-accent);
    border-radius: var(--radius-md);
    background: var(--color-accent);
    color: var(--color-page-bg-deep);
    cursor: pointer;
    font: inherit;
    font-size: var(--font-size-body);
    white-space: nowrap;
    transition:
        background-color 120ms ease,
        box-shadow 120ms ease;
}

.mr__klein:hover {
    background: color-mix(in srgb, var(--color-accent) 86%, var(--color-text-strong));
    box-shadow: var(--shadow-button-hover);
}

.mr__klein:active {
    background: color-mix(in srgb, var(--color-accent) 80%, var(--color-page-bg-deep));
    box-shadow: none;
}

.mr__klein:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
}

/*
 * Am Telefon steht die Marke unter dem Text, „Vergessen“ rechts daneben. 🔴 Die Spalte ist nur so breit wie die Karte (Review S3 I4): Eine lange Marke („Stand gerade nicht abrufbar“, französisch noch
 * länger) bricht um, und „Vergessen“ rutscht in die nächste Zeile, statt aus der Karte zu ragen. Fingerhöhe (44 px) bekommt „Vergessen“, ohne dass Schrift oder Karte wachsen: Der Knopf ist
 * höher und hat dafür einen negativen Rand oben und unten.
 */
.mr--telefon {
    /* Das Fingerziel (44 px, wie die Kamerasteuerung) in Kanonschritten: ein Maß im Fenster ist nie ein Literal. */
    --mr-finger: calc(var(--icon-xxl) - var(--space-2));
}

.mr--telefon .mr__karte {
    grid-template-columns: var(--mr-bild) minmax(0, 1fr);
}

.mr--telefon .mr__karte.is-frage {
    align-items: start;
}

.mr--telefon .mr__rechts {
    flex-direction: row;
    flex-wrap: wrap;
    grid-column: 2;
    align-items: center;
    align-self: auto;
    justify-content: flex-start;
    min-width: 0;
    min-height: 0;
}

.mr--telefon .mr__marke {
    flex: 0 1 auto;
    min-width: 0;
    padding-block: calc(var(--space-2) / 2);
    white-space: normal;
}

.mr--telefon .mr__vergessen {
    min-height: var(--mr-finger);
    margin: calc((var(--icon-lg) - var(--mr-finger)) / 2) calc(-1 * var(--space-4));
}

.mr--telefon .mr__antwort {
    grid-column: 2;
    grid-auto-flow: column;
    justify-content: start;
}

/* Nichts gemerkt. */
.mr__leer {
    display: grid;
    justify-items: center;
    gap: var(--space-4);
    padding: var(--space-24) var(--space-12);
    text-align: center;
}

.mr__leer-bild {
    width: calc(var(--icon-xxl) * 1.35);
    height: calc(var(--icon-xxl) * 1.35);
    margin-bottom: var(--space-2);
    object-fit: contain;
}

.mr__leer-titel {
    margin: 0;
    color: var(--color-text-strong);
    font-size: var(--font-size-subhead);
}

.mr__leer-satz {
    max-width: 30em;
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-body);
    line-height: var(--leading-normal);
}

/* Der Fuß: der leise Satz, wo gemerkt wird, und „Schließen“. */
.mr__fuss {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-8) var(--space-10);
    padding: var(--space-8) var(--space-16) var(--space-10);
}

.mr__fuss--telefon {
    padding-bottom: max(var(--space-10), env(safe-area-inset-bottom, 0));
}

.mr__fuss-satz {
    flex: 1 1 16em;
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
    line-height: var(--leading-normal);
}

@media (prefers-reduced-motion: reduce) {
    .mr__karte,
    .mr__leise,
    .mr__klein {
        transition: none;
    }
}
</style>
