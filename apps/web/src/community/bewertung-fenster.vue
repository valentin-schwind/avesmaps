<script setup lang="ts">
import { computed, onMounted, reactive, ref, useId } from "vue";
import { BEWERTUNG_GRENZEN } from "@avesmaps3d/shared";
import AvmEingabe from "../controls/avm-eingabe.vue";
import AvmHinweis from "../controls/avm-hinweis.vue";
import AvmKnopf from "../controls/avm-knopf.vue";
import AvmPille from "../controls/avm-pille.vue";
import AvmTextbereich from "../controls/avm-textbereich.vue";
import AvmFenster from "../fenster/avm-fenster.vue";
import type { FensterBox, FensterHuellenLage } from "../fenster/fenster-lage";
import type { MessageKey } from "../i18n/de";
import { t } from "../i18n/i18n";
import { ladeStand, neuesFormular, zeichenZahl, type FehlerArt } from "./api";
import { sendeBewertung } from "./bewertung-api";
import { BEWERTUNG_ABLEHNUNG, besucherSatz } from "./besucher-ablehnung";
import {
    bewertungSperrGrund,
    bewertungsBody,
    datumHeute,
    leererBewertungsEntwurf,
    sterneNachTaste,
} from "./bewertung-modell";
import { meldeBewertungGeschrieben } from "./bewertung-signal";
import type { BewertungsZiel } from "./community-besucher";

/**
 * „Bewertung schreiben“ (WI-0269 C10; Bedienkonzept §6.3, Fachkonzept §14): ein Werkzeugfenster der Besucher wie das Meldeformular (`AvmFenster`, §1.3): angedockt neben dem Panel, ⧉ lösen, ▥ andocken,
 * ohne Ablage, nur so hoch wie der Inhalt. Was es rechnet, steht in `bewertung-modell.ts`, der Aufruf in `bewertung-api.ts`.
 *
 * - **Pflicht ist nur die Wertung:** fünf Sternknöpfe, mit ← und → bedienbar (Radiogruppe). Text (höchstens 200 Zeichen, Zähler „0 von 200“), Name (freiwillig: ein echter Name ist nicht nötig, leer
 *   erscheint „Anonym“) und aventurisches Datum (freiwillig, leer gilt der heutige Tag im aventurischen Kalender) folgen. Ein Satz sagt, was öffentlich wird: Sterne, Text, Name und Datum.
 * - **Absenden** steht im Fuß und ist gesperrt, solange die Wertung fehlt; der Grund steht im Fuß daneben und im Tooltip (Guide §7, §13.19).
 * - **Bestätigung im selben Fenster:** „Danke! Die Bewertung steht jetzt bei ‹Ort›.“ oder, wenn sie zurückgehalten wird, „Wir sehen sie uns kurz an, bevor sie erscheint.“ Das Panel des Orts lädt seine Bewertungen
 *   daraufhin frisch (`bewertung-signal.ts`).
 * - **Netz weg:** der Text bleibt, erneutes Senden trägt dieselbe Kennung und legt nie eine zweite Bewertung an (ADR-0019). **Grenze erreicht (429):** der Satz mit der Uhrzeit. **Modul nicht eingerichtet:**
 *   „Bewertungen sind gerade nicht möglich“ statt eines toten Knopfs.
 * - **Honigtopf und Zeitfalle** wie beim Meldeformular (Fachkonzept §14.4): ein Feld, das ein Mensch nie sieht, und die Zeit seit dem Öffnen.
 * - Das freiwillige Mailfeld für den Änderungslink (E8) fehlt noch: Es braucht den Mailweg (Umsetzungsplan C6); ohne Mail gibt es keinen Link, also auch kein „Eigene Bewertung“.
 */
const offen = defineModel<boolean>("offen", { required: true });
const props = defineProps<{
    ziel: BewertungsZiel;
    lage: FensterHuellenLage;
    box?: FensterBox | undefined;
}>();
const emit = defineEmits<{
    "update:lage": [lage: Exclude<FensterHuellenLage, "modal">, box?: FensterBox];
    "update:box": [box: FensterBox];
    vorn: [];
}>();

const kennung = neuesFormular();
const geoeffnet = performance.now();
const entwurf = reactive(leererBewertungsEntwurf(props.ziel.sterne));
/** `undefined`: noch nicht gefragt; das Formular steht trotzdem sofort da. */
const moeglich = ref<boolean | undefined>(undefined);
const sendet = ref(false);
/** Der Satz zum Fehler, schon in der Sprache (WI-0291: der genaue Grund des Servers, sonst der allgemeine Satz). */
const problem = ref<string | undefined>(undefined);
/** Gesendet: der Zustand, den der Server nannte; `undefined`: noch nicht. */
const ergebnis = ref<"neu" | "zurueckgehalten" | undefined>(undefined);
const kennungId = useId();

onMounted(() => {
    void ladeStand().then((geht) => {
        moeglich.value = geht;
    });
});

const FEHLER_SATZ: Readonly<Record<FehlerArt, MessageKey>> = {
    netz: "community.fehler.netz",
    zu_viele: "bewertungen.fehler.zuViele",
    nicht_moeglich: "bewertungen.nichtMoeglich",
    ungueltig: "bewertungen.fehler.ungueltig",
    nicht_gefunden: "bewertungen.fehler.fehlt",
    sonst: "community.fehler.sonst",
};

const STERNE = [1, 2, 3, 4, 5] as const;
const datumPlatzhalter = computed(() => t("bewertungen.schreiben.datumPlatzhalter", { datum: datumHeute() }));

/** Die Sternwahl mit der Tastatur: ← und → wechseln und fokussieren, Pos1 und Ende springen an die Ränder. */
function sternTaste(event: KeyboardEvent): void {
    const neu = sterneNachTaste(entwurf.sterne, event.key);
    if (neu === undefined) return;
    event.preventDefault();
    entwurf.sterne = neu;
    document.getElementById(`${kennungId}-stern-${String(neu)}`)?.focus();
}

/**
 * Esc in einem Feld mit Geschriebenem schließt das Fenster nicht: Zweihundert Zeichen wären mit einem Tastendruck weg (✕ bleibt der ausdrückliche Weg). Ohne Geschriebenes geht Esc wie bei jedem
 * Werkzeugfenster an die Hülle.
 */
function escImFormular(event: KeyboardEvent): void {
    if (entwurf.text.trim() !== "" || entwurf.name.trim() !== "" || entwurf.datum.trim() !== "")
        event.stopPropagation();
}

const grund = computed(() => {
    const key = bewertungSperrGrund(entwurf);
    return key === undefined ? undefined : t(key, { max: BEWERTUNG_GRENZEN.textMax });
});
const gesperrt = computed(() => (sendet.value ? t("community.sendet") : grund.value));
const formularOffen = computed(() => ergebnis.value === undefined && moeglich.value !== false);

async function absenden(): Promise<void> {
    if (grund.value !== undefined || sendet.value) return;
    sendet.value = true;
    problem.value = undefined;
    try {
        const antwort = await sendeBewertung(
            bewertungsBody(kennung, props.ziel.ortId, entwurf, performance.now() - geoeffnet),
        );
        ergebnis.value = antwort.zustand;
        meldeBewertungGeschrieben(props.ziel.ortId);
    } catch (fehler) {
        problem.value = besucherSatz(fehler, BEWERTUNG_ABLEHNUNG, {
            zuViele: "bewertungen.fehler.zuViele",
            rueckfall: (art) => t(FEHLER_SATZ[art]),
        });
    } finally {
        sendet.value = false;
    }
}
</script>

<template>
    <AvmFenster
        v-model:offen="offen"
        bauart="werkzeug"
        breite="entscheiden"
        :lage="props.lage"
        :box="props.box"
        vorgabe-ecke="mitte"
        hoehe="inhalt"
        ohne-ablage
        :titel="t('bewertungen.schreiben.titel', { name: ziel.ortName })"
        testid="community-bewertung-fenster"
        @update:lage="(neu, box) => emit('update:lage', neu, box)"
        @update:box="(neu) => emit('update:box', neu)"
        @vorn="emit('vorn')"
    >
        <!-- Gesendet: die Bestätigung im selben Fenster. -->
        <div v-if="ergebnis !== undefined" class="bew-fenster__fertig" data-testid="community-bewertung-fertig">
            <p class="bew-fenster__danke" role="status">
                {{
                    ergebnis === "zurueckgehalten"
                        ? t("bewertungen.fertig.zurueckgehalten")
                        : t("bewertungen.fertig.steht", { name: ziel.ortName })
                }}
            </p>
            <div class="bew-fenster__knoepfe">
                <AvmKnopf art="gefuellt" testid="community-bewertung-schliessen" @click="offen = false">{{
                    t("community.fertig.schliessen")
                }}</AvmKnopf>
            </div>
        </div>

        <!-- Geht gerade nicht: ein Satz statt eines toten Knopfs. -->
        <AvmHinweis
            v-else-if="moeglich === false"
            ton="warnung"
            rolle="status"
            testid="community-bewertung-nicht-moeglich"
        >
            {{ t("bewertungen.nichtMoeglich") }} {{ t("community.nichtMoeglich.spaeter") }}
        </AvmHinweis>

        <form
            v-else
            class="bew-fenster"
            data-testid="community-bewertung-formular"
            novalidate
            @keydown.esc="escImFormular"
            @submit.prevent
        >
            <div class="bew-fenster__feld">
                <span :id="`${kennungId}-wertung`" class="bew-fenster__label"
                    >{{ t("bewertungen.schreiben.wertung") }}
                    <AvmPille ton="warnung">{{ t("community.quelle.noetig") }}</AvmPille></span
                >
                <div
                    class="sternwahl"
                    role="radiogroup"
                    :aria-labelledby="`${kennungId}-wertung`"
                    data-testid="community-bewertung-sterne"
                >
                    <button
                        v-for="stern in STERNE"
                        :id="`${kennungId}-stern-${String(stern)}`"
                        :key="stern"
                        type="button"
                        role="radio"
                        class="sternwahl__stern"
                        :class="{ 'is-an': stern <= entwurf.sterne }"
                        :aria-checked="entwurf.sterne === stern"
                        :aria-label="t('infoPanel.reviews.starsLabel', { n: stern })"
                        :title="t('infoPanel.reviews.starsLabel', { n: stern })"
                        :tabindex="(entwurf.sterne || 1) === stern ? 0 : -1"
                        :data-testid="`community-bewertung-stern-${String(stern)}`"
                        @click="entwurf.sterne = stern"
                        @keydown="sternTaste"
                    >
                        ★
                    </button>
                </div>
            </div>

            <label class="bew-fenster__feld">
                <span class="bew-fenster__label"
                    >{{ t("bewertungen.schreiben.text") }}
                    <AvmPille testid="community-bewertung-zaehler">{{
                        t("community.text.zaehler", { n: zeichenZahl(entwurf.text), max: BEWERTUNG_GRENZEN.textMax })
                    }}</AvmPille></span
                >
                <AvmTextbereich
                    v-model="entwurf.text"
                    :zeilen="3"
                    :maxlength="BEWERTUNG_GRENZEN.textMax"
                    testid="community-bewertung-text"
                />
            </label>

            <label class="bew-fenster__feld">
                <span class="bew-fenster__label"
                    >{{ t("bewertungen.schreiben.name") }}
                    <span class="bew-fenster__leise">{{ t("community.freiwillig") }}</span></span
                >
                <AvmEingabe
                    v-model="entwurf.name"
                    :maxlength="BEWERTUNG_GRENZEN.nameMax"
                    :placeholder="t('infoPanel.reviews.anonymous')"
                    :aria-describedby="`${kennungId}-name`"
                    autocomplete="nickname"
                    testid="community-bewertung-name"
                />
                <span :id="`${kennungId}-name`" class="bew-fenster__leise">{{
                    t("bewertungen.schreiben.nameHinweis")
                }}</span>
            </label>

            <label class="bew-fenster__feld">
                <span class="bew-fenster__label"
                    >{{ t("bewertungen.schreiben.datum") }}
                    <span class="bew-fenster__leise">{{ t("community.freiwillig") }}</span></span
                >
                <AvmEingabe
                    v-model="entwurf.datum"
                    :maxlength="BEWERTUNG_GRENZEN.datumMax"
                    :placeholder="datumPlatzhalter"
                    :ungueltig="grund !== undefined && entwurf.sterne > 0"
                    testid="community-bewertung-datum"
                />
            </label>

            <p class="bew-fenster__leise" data-testid="community-bewertung-sichtbar">
                {{ t("bewertungen.schreiben.sichtbar") }}
            </p>

            <!-- Der Honigtopf: für Menschen nicht erreichbar (aus der Tab-Folge, versteckt vor Vorlesern, träge), aber im Dokument; nicht `display: none`. -->
            <div class="bew-fenster__honig" aria-hidden="true" inert data-testid="community-bewertung-honig">
                <input v-model="entwurf.honig" type="text" name="weitere-angaben" tabindex="-1" autocomplete="off" />
            </div>

            <AvmHinweis v-if="problem !== undefined" ton="gefahr" rolle="alert" testid="community-bewertung-problem">
                {{ problem }}
            </AvmHinweis>
        </form>

        <template v-if="formularOffen" #fuss-hinweis>
            <span
                v-if="gesperrt !== undefined"
                :id="`${kennungId}-grund`"
                data-testid="community-bewertung-sperrgrund"
                >{{ gesperrt }}</span
            >
        </template>
        <template v-if="formularOffen" #fuss-haupt>
            <button
                type="button"
                :disabled="gesperrt !== undefined"
                :title="gesperrt"
                :aria-describedby="gesperrt === undefined ? undefined : `${kennungId}-grund`"
                data-testid="community-bewertung-absenden"
                @click="absenden"
            >
                {{ t("bewertungen.schreiben.absenden") }}
            </button>
        </template>
    </AvmFenster>
</template>

<style scoped>
.bew-fenster {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: var(--space-8);
    min-width: 0;
}

.bew-fenster__feld {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
}

.bew-fenster__label {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-6);
    color: var(--color-text-strong);
    font-size: var(--font-size-small);
}

.bew-fenster__leise {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
}

/* Die Sternwahl: fünf Knöpfe in Bedienhöhe, gewählt und davor gold (Guide §16.6), sonst stumpf. */
.sternwahl {
    display: flex;
    gap: var(--space-4);
}

.sternwahl__stern {
    width: var(--avm-control-h);
    height: var(--avm-control-h);
    padding: 0;
    border: 1px solid var(--color-button-soft-border);
    border-radius: var(--radius-md);
    background: var(--color-button-soft);
    color: var(--color-star-muted);
    cursor: pointer;
    font-size: var(--font-size-subhead);
    line-height: 1;
    transition:
        background-color 120ms ease,
        border-color 120ms ease,
        color 120ms ease;
}

.sternwahl__stern.is-an {
    color: var(--color-star);
}

.sternwahl__stern:hover {
    border-color: var(--color-border-strong);
    background: var(--color-button-soft-hover);
}

.sternwahl__stern:active {
    background: var(--color-button-soft-active);
}

.sternwahl__stern:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
}

/* Der Honigtopf liegt im Dokument, aber weder im Bild noch im Weg: links neben dem Fenster, durchsichtig, ohne Zeigerereignisse - nicht `display: none`. */
.bew-fenster__honig {
    position: absolute;
    inset-inline-start: -100vw;
    opacity: 0;
    pointer-events: none;
}

.bew-fenster__fertig {
    display: flex;
    flex-direction: column;
    gap: var(--space-8);
    min-width: 0;
}

.bew-fenster__danke {
    margin: 0;
    color: var(--color-text-strong);
    font-size: var(--font-size-reading);
}

.bew-fenster__knoepfe {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: var(--space-6);
}

@media (prefers-reduced-motion: reduce) {
    .sternwahl__stern {
        transition: none;
    }
}
</style>
