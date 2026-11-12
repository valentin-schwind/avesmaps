<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref, useId, useTemplateRef, watch } from "vue";
import { COMMUNITY_GRENZEN, COMMUNITY_KONTAKT_TAGE } from "@avesmaps3d/shared";
import { phoneViewport } from "../controls/phone-viewport";
import AvmKnopf from "../controls/avm-knopf.vue";
import AvmFenster from "../fenster/avm-fenster.vue";
import type { FensterBox, FensterHuellenLage } from "../fenster/fenster-lage";
import { showToast } from "../feedback/toast";
import type { MessageKey } from "../i18n/de";
import { t } from "../i18n/i18n";
import {
    frischerSchutz,
    nachKopieren,
    pruefeWeiter,
    trotzdemSchluessel,
    warnungSteht,
    type WeiterArt,
} from "../photobox/fertig-schutz";
import LinkKasten from "../photobox/link-kasten.vue";
import { useLinkKopieren } from "../photobox/link-kopieren";
import ReisebildFertigFuss from "../photobox/reisebild-fertig-fuss.vue";
import ReisebildFormularFuss from "../photobox/reisebild-formular-fuss.vue";
import { REISEBILD_SYMBOLE } from "../photobox/reisebild-zeichen";
import ReisebildZeichen from "../photobox/reisebild-zeichen.vue";
import { FEHLER_SATZ, ladeStand, neuesFormular, sendeKontakt, statusAdresse, zeichenZahl } from "./api";
import { besucherSatz, KONTAKT_ABLEHNUNG } from "./besucher-ablehnung";
import DiscordVerbinden from "./discord-verbinden.vue";
import {
    KONTAKT_KATEGORIEN,
    kontaktBody,
    leererKontaktEntwurf,
    mailGueltig,
    sperrFeld,
    sperrGrund,
} from "./kontakt-modell";

/**
 * Das Kontaktformular der Besucher (WI-0268 C4; Gestaltung: Mockup „Nachricht schreiben“ Fassung 3, Betreiber 2026-11-04, im Ton von „Karte vorschlagen“ und den Reisebildern): „Nachricht schreiben“ im Impressum
 * der Hinweise. Hülle wie zuvor (⧉ lösen, ▥ andocken, nur so hoch wie der Inhalt), die Bausteine aus den Reisebildern: Stile (`formular-stil.css`), Fuß, Linkkasten, Schutz des Links. Was es rechnet, steht in
 * `kontakt-modell.ts`, die Aufrufe in `api.ts`.
 *
 * - **Die Themen als Chips** statt einer Auswahl, „Frage“ ist vorgewählt. Sie sind das, was das Formular anbietet (`KONTAKT_THEMEN`), nicht alles, was der Vertrag kennt.
 * - **Die Schreibfläche ist die Ablage dieses Formulars:** groß, ruhig, mit gemalter Feder und einer Einladung je Thema. Die Einladung liegt über dem Feld und lässt jeden Klick durch; beim Schreiben weicht sie. Die
 *   Höhe bleibt, wie sie ist. 🔴 Das Feld bekommt beim Öffnen keinen Fokus: Sonst wäre die Einladung weg, bevor sie jemand gesehen hat.
 * - **Pflicht ist die Nachricht (10 bis 2000 Zeichen).** Name und Adresse sind freiwillig; ohne Adresse antwortet die Redaktion nur auf der Statusseite. „Nachricht senden“ ist gesperrt, solange etwas fehlt, aber
 *   drückbar: Ein Druck nennt den Grund im Fuß, markiert das Feld und setzt den Fokus hinein.
 * - **Bestätigung wie bei den Reisebildern:** die Nummer, der Link zur Statusseite im Kasten; ohne kopierten Link hält ✕, Esc, „Schließen“ und „Statusseite öffnen“ einmal an (`fertig-schutz.ts`). Der Link steht nur
 *   hier und ist der einzige Weg dorthin. „Mit Discord verbinden“ steht hier, nicht im Formular, denn ein Sprung mitten aus dem Formular verlöre den Entwurf.
 * - **Netz weg:** Der Text bleibt, erneutes Senden trägt dieselbe Kennung und denselben Schlüssel und legt nie eine zweite Anfrage an (ADR-0019). **Grenze erreicht (429):** der Satz mit der Uhrzeit, der Text bleibt.
 *   **Modul nicht eingerichtet:** „… gerade nicht möglich“ statt eines toten Knopfs.
 * - **Honigtopf und Zeitfalle** wie beim Meldeformular (Fachkonzept §10.5): ein Feld, das ein Mensch nie sieht, und die Zeit seit dem Öffnen; beides geht mit.
 */
const offen = defineModel<boolean>("offen", { required: true });
const props = defineProps<{
    lage: FensterHuellenLage;
    box?: FensterBox | undefined;
}>();
const emit = defineEmits<{
    "update:lage": [lage: Exclude<FensterHuellenLage, "modal">, box?: FensterBox];
    "update:box": [box: FensterBox];
    vorn: [];
    /** „Statusseite öffnen“ nach der Bestätigung. */
    status: [schluessel: string];
}>();

const kennung = neuesFormular();
const geoeffnet = performance.now();
const entwurf = reactive(leererKontaktEntwurf());
/** `undefined`: noch nicht gefragt; das Formular steht trotzdem sofort da. */
const moeglich = ref<boolean | undefined>(undefined);
const versucht = ref(false);
const sendet = ref(false);
const datenschutzOffen = ref(false);
/** Der Satz zum Fehler, schon in der Sprache (WI-0291: der genaue Grund des Servers, sonst der allgemeine Satz). */
const problem = ref<string | undefined>(undefined);
/** Die Nummer der Bestätigung; gesetzt heißt: gesendet. */
const nummer = ref<string | undefined>(undefined);
const schutz = ref(frischerSchutz());
const kennungId = useId();
const textFeld = useTemplateRef<HTMLTextAreaElement>("textFeld");
const mailFeld = useTemplateRef<HTMLInputElement>("mailFeld");
const fertigKasten = useTemplateRef<InstanceType<typeof LinkKasten>>("fertigKasten");

onMounted(() => {
    void ladeStand().then((geht) => {
        moeglich.value = geht;
    });
});

const gewaehlt = computed(() => KONTAKT_KATEGORIEN.find((eintrag) => eintrag.wert === entwurf.kategorie));
const einladung = computed(() => (gewaehlt.value === undefined ? "" : t(gewaehlt.value.einladung)));

/** Esc in einem Feld mit Geschriebenem schließt das Fenster nicht (✕ bleibt der ausdrückliche Weg); ohne Geschriebenes geht Esc an die Hülle. */
function escImFormular(event: KeyboardEvent): void {
    if (entwurf.text.trim() !== "" || entwurf.name.trim() !== "" || entwurf.mail.trim() !== "") event.stopPropagation();
}

// --- Senden --------------------------------------------------------------------------------------------------------------------

const grund = computed(() => {
    const key = sperrGrund(entwurf);
    return key === undefined ? undefined : t(key, { min: COMMUNITY_GRENZEN.textMin, max: COMMUNITY_GRENZEN.textMax });
});
const fehlt = computed(() => (versucht.value ? sperrFeld(entwurf) : undefined));
const mailFalsch = computed(() => versucht.value && !mailGueltig(entwurf.mail));
const eingegangen = computed(() => nummer.value !== undefined);
const formularOffen = computed(() => !eingegangen.value && moeglich.value !== false);
const linkAdresse = computed(() => statusAdresse(globalThis.location.origin, kennung.schluessel));

/** Die zwei Sätze, die bei Meldungen von „Meldungen“ sprechen; alle anderen gelten für beide Formulare. */
function fehlerKey(art: keyof typeof FEHLER_SATZ): MessageKey {
    if (art === "ungueltig") return "community.kontakt.fehler.ungueltig";
    if (art === "zu_viele") return "community.kontakt.fehler.zuViele";
    if (art === "nicht_moeglich") return "community.kontakt.nichtMoeglich";
    return FEHLER_SATZ[art];
}

/** Der Druck auf „Nachricht senden“: Fehlt etwas, nennt der Fuß den Grund, und das Feld wird fokussiert; sonst geht die Anfrage hinaus. */
async function senden(): Promise<void> {
    if (sendet.value) return;
    versucht.value = true;
    datenschutzOffen.value = false;
    const feld = sperrFeld(entwurf);
    if (feld !== undefined) {
        (feld === "mail" ? mailFeld.value : textFeld.value)?.focus();
        return;
    }
    sendet.value = true;
    problem.value = undefined;
    try {
        const antwort = await sendeKontakt(kontaktBody(kennung, entwurf, performance.now() - geoeffnet));
        nummer.value = antwort.nummer;
    } catch (fehler) {
        problem.value = besucherSatz(fehler, KONTAKT_ABLEHNUNG, {
            zuViele: "community.kontakt.fehler.zuViele",
            rueckfall: (art) => t(fehlerKey(art)),
        });
    } finally {
        sendet.value = false;
    }
}

// --- Bestätigung und Schutz vor Verlust ----------------------------------------------------------------------------------------

const linkKopie = useLinkKopieren({
    link: () => linkAdresse.value,
    erfolg: () => {
        schutz.value = nachKopieren();
    },
    misserfolg: () => fertigKasten.value?.markiereLink(),
});
const warnt = computed(() => eingegangen.value && warnungSteht(schutz.value));

watch(eingegangen, (steht) => {
    if (steht) void nextTick(() => fertigKasten.value?.fokussiereKopieren());
});

/** Ein Weg, der den Link aus dem Blick nimmt: `true`, wenn es weitergeht; `false`, wenn der erste Versuch ohne kopierten Link anhält. */
function weiter(art: WeiterArt): boolean {
    if (!eingegangen.value) return true;
    const ergebnis = pruefeWeiter(schutz.value, art);
    schutz.value = ergebnis.schutz;
    if (ergebnis.halt) void nextTick(() => fertigKasten.value?.zeigeLink());
    return !ergebnis.halt;
}

/** ✕ und Esc setzen `offen` an der Hülle: Das Fenster hängt an diesem Modell, dessen Setzer erst prüft, ob der Link verloren ginge. */
const huellenOffen = computed({
    get: () => offen.value,
    set: (auf: boolean) => {
        if (!auf && !weiter("zu")) return;
        offen.value = auf;
    },
});

function fuehreAus(art: WeiterArt | undefined): void {
    if (art === "stand") emit("status", kennung.schluessel);
    else offen.value = false;
}
const schliessenGedrueckt = (): void => {
    if (weiter("zu")) offen.value = false;
};
const statusGedrueckt = (): void => {
    if (weiter("stand")) emit("status", kennung.schluessel);
};
/** „Kopieren“ in der Warnung: kopieren, melden und dann tun, was gewollt war. Ging das Kopieren nicht, bleibt das Fenster stehen. */
async function warnKopieren(): Promise<void> {
    const art = schutz.value.gewarnt;
    if (!(await linkKopie.kopiere())) return;
    showToast(t("ui.copy.done"));
    fuehreAus(art);
}
/** „Trotzdem schließen“ beziehungsweise „Trotzdem weiter“: der zweite Versuch, jetzt ohne Halt. */
const trotzdem = (): void => fuehreAus(schutz.value.gewarnt);
</script>

<template>
    <AvmFenster
        v-model:offen="huellenOffen"
        bauart="werkzeug"
        breite="entscheiden"
        :lage="props.lage"
        :box="props.box"
        vorgabe-ecke="mitte"
        hoehe="inhalt"
        ohne-ablage
        :titel="t('community.kontakt.titel')"
        :unterzeile="t('community.kontakt.unterzeile')"
        testid="community-kontakt-fenster"
        @update:lage="(neu, box) => emit('update:lage', neu, box)"
        @update:box="(neu) => emit('update:box', neu)"
        @vorn="emit('vorn')"
    >
        <!-- Gesendet: die Bestätigung im selben Fenster. -->
        <div v-if="nummer !== undefined" class="kontakt__fertig" data-testid="community-kontakt-fertig">
            <p class="kontakt__nummer" role="status">
                <ReisebildZeichen name="haken" />{{ t("community.fertig.titel", { nummer }) }}
            </p>
            <p class="rb__satz">{{ t("community.kontakt.fertig.privat") }}</p>
            <LinkKasten
                ref="fertigKasten"
                testid="community-kontakt-fertig"
                :titel="t('community.fertig.linkName')"
                :satz="t('community.fertig.linkHinweis')"
                :link="linkAdresse"
                :kopiert="linkKopie.anzeige.value"
                :warnt="warnt"
                :merken-moeglich="false"
                :gemerkt="false"
                @kopieren="linkKopie.kopiere()"
            />
            <DiscordVerbinden :schluessel="kennung.schluessel" :verbunden="null" erklaerung-klappt />
            <div class="kontakt__knoepfe">
                <AvmKnopf groesse="zeile" testid="community-kontakt-fertig-status" @click="statusGedrueckt">{{
                    t("community.fertig.statusseite")
                }}</AvmKnopf>
            </div>
        </div>

        <!-- Geht gerade nicht: ein Satz statt eines toten Knopfs. -->
        <div v-else-if="moeglich === false" class="kontakt__geht-nicht" data-testid="community-kontakt-nicht-moeglich">
            <img :src="REISEBILD_SYMBOLE.brief" alt="" aria-hidden="true" decoding="async" />
            <p class="kontakt__geht-nicht-titel" role="status">{{ t("community.kontakt.nichtMoeglich") }}</p>
            <p class="rb__satz">{{ t("community.nichtMoeglich.spaeter") }}</p>
        </div>

        <form
            v-else
            class="rb kontakt"
            :class="{ 'rb--telefon': phoneViewport }"
            data-testid="community-kontakt-formular"
            novalidate
            @keydown.esc="escImFormular"
            @submit.prevent
        >
            <div class="rb__abschnitt">
                <span :id="`${kennungId}-themen`" class="rb__titel"
                    ><img
                        class="rb__sym"
                        :src="REISEBILD_SYMBOLE.wegweiser"
                        alt=""
                        aria-hidden="true"
                        decoding="async"
                    />{{ t("community.kontakt.kategorie") }}</span
                >
                <div class="rb__chips kontakt__themen" role="radiogroup" :aria-labelledby="`${kennungId}-themen`">
                    <label
                        v-for="thema in KONTAKT_KATEGORIEN"
                        :key="thema.wert"
                        class="rb__chip kontakt__thema"
                        :data-testid="`community-kontakt-kategorie-${thema.wert}`"
                    >
                        <input
                            v-model="entwurf.kategorie"
                            class="rb__chipwahl"
                            type="radio"
                            name="kontakt-thema"
                            :value="thema.wert"
                        />
                        <ReisebildZeichen :name="thema.zeichen" />
                        <span>{{ t(thema.key) }}</span>
                    </label>
                </div>
            </div>

            <div
                class="schreib"
                :class="{ 'hat-text': entwurf.text !== '', 'is-fehlt': fehlt === 'text' }"
                data-testid="community-kontakt-schreibflaeche"
            >
                <label class="rb__nur-vorleser" :for="`${kennungId}-text`">{{
                    t("community.kontakt.text.label")
                }}</label>
                <textarea
                    :id="`${kennungId}-text`"
                    ref="textFeld"
                    v-model="entwurf.text"
                    class="schreib__feld"
                    :maxlength="COMMUNITY_GRENZEN.textMax"
                    :placeholder="einladung"
                    data-testid="community-kontakt-text"
                ></textarea>
                <div class="schreib__einladung" aria-hidden="true">
                    <img :src="REISEBILD_SYMBOLE.federUndPapier" alt="" decoding="async" />
                    <span class="schreib__titel" data-testid="community-kontakt-einladung">{{ einladung }}</span>
                    <span class="schreib__leise schreib__leise--maus">{{ t("community.kontakt.klicken") }}</span>
                    <span class="schreib__leise schreib__leise--finger">{{ t("community.kontakt.tippen") }}</span>
                </div>
                <span class="schreib__zaehler" data-testid="community-kontakt-zaehler">{{
                    t("community.text.zaehler", { n: zeichenZahl(entwurf.text), max: COMMUNITY_GRENZEN.textMax })
                }}</span>
            </div>

            <div class="rb__abschnitt">
                <div class="rb__zeile">
                    <div class="rb__abschnitt">
                        <label class="rb__titel" :for="`${kennungId}-name`"
                            ><img
                                class="rb__sym"
                                :src="REISEBILD_SYMBOLE.feder"
                                alt=""
                                aria-hidden="true"
                                decoding="async"
                            />{{ t("community.name.label") }}
                            <span class="rb__frei">{{ t("community.freiwillig") }}</span></label
                        >
                        <input
                            :id="`${kennungId}-name`"
                            v-model="entwurf.name"
                            class="rb__eingabe"
                            type="text"
                            :maxlength="COMMUNITY_GRENZEN.nameMax"
                            :placeholder="t('community.kontakt.name.platzhalter')"
                            autocomplete="nickname"
                            data-testid="community-kontakt-name"
                        />
                    </div>
                    <div class="rb__abschnitt">
                        <label class="rb__titel" :for="`${kennungId}-mail`"
                            ><img
                                class="rb__sym"
                                :src="REISEBILD_SYMBOLE.brief"
                                alt=""
                                aria-hidden="true"
                                decoding="async"
                            />{{ t("community.kontakt.mail.label") }}
                            <span class="rb__frei">{{ t("community.freiwillig") }}</span></label
                        >
                        <input
                            :id="`${kennungId}-mail`"
                            ref="mailFeld"
                            v-model="entwurf.mail"
                            class="rb__eingabe"
                            :class="{ 'is-fehlt': mailFalsch }"
                            type="email"
                            inputmode="email"
                            :maxlength="COMMUNITY_GRENZEN.mailMax"
                            :placeholder="t('community.kontakt.mail.platzhalter')"
                            :aria-invalid="mailFalsch ? 'true' : undefined"
                            :aria-describedby="`${kennungId}-mail-satz`"
                            autocomplete="email"
                            data-testid="community-kontakt-mail"
                        />
                    </div>
                </div>
                <p
                    :id="`${kennungId}-mail-satz`"
                    class="rb__satz"
                    :class="{ 'kontakt__satz--warnung': mailFalsch }"
                    data-testid="community-kontakt-mail-satz"
                >
                    {{ mailFalsch ? t("community.kontakt.mail.ungueltig") : t("community.kontakt.mail.hinweis") }}
                </p>
            </div>

            <!-- Der Honigtopf: für Menschen nicht erreichbar (aus der Tab-Folge, versteckt vor Vorlesern, träge), aber im Dokument; nicht `display: none`. -->
            <div class="rb__honig" aria-hidden="true" inert data-testid="community-kontakt-honig">
                <input v-model="entwurf.honig" type="text" name="weitere-angaben" tabindex="-1" autocomplete="off" />
            </div>
        </form>

        <!-- „Nachricht senden“ steht im Fuß, damit es auch in einem niedrigen Fenster im Bild bleibt (Guide §12.6, §13.19). -->
        <template v-if="formularOffen" #fuss>
            <ReisebildFormularFuss
                v-model:datenschutz-offen="datenschutzOffen"
                kennung="community-kontakt"
                schwebend
                :knopf="t('community.kontakt.absenden')"
                :knopf-bild="REISEBILD_SYMBOLE.brief"
                :datenschutz-text="t('community.kontakt.datenschutz', { tage: COMMUNITY_KONTAKT_TAGE })"
                :gesperrt="grund !== undefined"
                :sendet="sendet"
                :grund="versucht ? grund : undefined"
                :problem="problem"
                @hochladen="senden"
            />
        </template>
        <template v-else-if="eingegangen" #fuss>
            <ReisebildFertigFuss
                :warnt="warnt"
                :trotzdem="trotzdemSchluessel(schutz)"
                :merken-moeglich="false"
                @schliessen="schliessenGedrueckt"
                @warn-kopieren="warnKopieren"
                @trotzdem="trotzdem"
            />
        </template>
    </AvmFenster>
</template>

<style scoped src="../photobox/formular-stil.css"></style>
<style scoped>
.kontakt {
    --rb-platz: calc(8 * var(--space-24));
}

.kontakt.rb--telefon {
    --rb-platz: calc(6 * var(--space-24));
}

/* Sechs Themen in zwei gleichen Reihen; am Telefon zweispaltig, ein längeres Wort bricht um statt zu überlaufen. */
.kontakt__themen {
    grid-template-columns: repeat(3, minmax(0, 1fr));
}

.rb--telefon .kontakt__themen {
    grid-template-columns: repeat(2, minmax(0, 1fr));
}

.kontakt__thema {
    justify-content: center;
    text-align: center;
}

/* Die Schreibfläche: dieselbe Sprache wie die Ablage (Pergament, gestrichelter Rand, Gold beim Zeigen), feste Höhe. */
.schreib {
    --rb-grund: var(--color-panel-soft);
    position: relative;
    display: grid;
    height: var(--rb-platz);
    border: 2px dashed var(--color-border-strong);
    border-radius: var(--radius-lg);
    background: var(--rb-grund);
    transition:
        border-color 140ms ease,
        background-color 140ms ease,
        box-shadow 140ms ease;
}

.schreib:hover {
    --rb-grund: color-mix(in srgb, var(--color-accent) 8%, var(--color-panel-soft));
    border-color: var(--color-accent);
}

.schreib:focus-within {
    --rb-grund: var(--color-panel);
    border-style: solid;
    border-color: var(--color-accent);
    box-shadow: var(--focus-ring);
}

.schreib.is-fehlt {
    border-color: var(--color-warning);
    box-shadow: 0 0 0 var(--space-2) var(--color-warning-halo);
}

.schreib__feld {
    box-sizing: border-box;
    width: 100%;
    height: 100%;
    padding: var(--space-12) var(--space-12) calc(var(--space-12) + var(--icon-md));
    border: 0;
    outline: none;
    resize: none;
    background: transparent;
    color: var(--color-text);
    font: inherit;
    font-size: var(--font-size-reading);
    line-height: var(--leading-normal);
    scrollbar-width: thin;
}

.rb--telefon .schreib__feld {
    font-size: var(--font-size-touch);
}

.schreib__feld::placeholder {
    color: transparent;
}

.schreib__feld:focus::placeholder {
    color: var(--color-placeholder);
    opacity: 1;
}

.schreib__einladung {
    position: absolute;
    inset: 0;
    display: grid;
    align-content: center;
    justify-items: center;
    gap: var(--space-2);
    padding: var(--space-8) var(--space-12) var(--space-16);
    text-align: center;
    pointer-events: none;
    transition:
        opacity 160ms ease,
        transform 160ms ease;
}

.schreib__einladung img {
    width: var(--rb-ablage-symbol);
    height: var(--rb-ablage-symbol);
    margin-bottom: var(--space-4);
    object-fit: contain;
    transition: transform 180ms ease;
}

.schreib:hover .schreib__einladung img {
    transform: translateY(calc(-1 * var(--space-2) / 2)) rotate(-2deg);
}

.schreib__titel {
    color: var(--color-text-strong);
    font-size: var(--font-size-subhead);
    line-height: var(--leading-snug);
}

.schreib__leise {
    color: var(--color-text-muted);
    font-size: var(--font-size-body);
}

.schreib__leise--finger {
    display: none;
}

@media (hover: none), (pointer: coarse) {
    .schreib__leise--maus {
        display: none;
    }

    .schreib__leise--finger {
        display: inline;
    }
}

.schreib:focus-within .schreib__einladung,
.schreib.hat-text .schreib__einladung {
    opacity: 0;
    transform: translateY(calc(-1 * var(--space-2)));
}

.schreib__zaehler {
    position: absolute;
    right: var(--space-8);
    bottom: var(--space-4);
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
    font-variant-numeric: tabular-nums;
    opacity: 0;
    pointer-events: none;
    transition: opacity 160ms ease;
}

.schreib:focus-within .schreib__zaehler,
.schreib.hat-text .schreib__zaehler {
    opacity: 1;
}

.kontakt__satz--warnung {
    color: var(--color-warning-soft-text);
}

.kontakt__fertig {
    display: grid;
    gap: var(--space-10);
    min-width: 0;
    padding: var(--space-4) var(--space-2) var(--space-8);
}

.kontakt__nummer {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    margin: 0;
    color: var(--color-success);
    font-size: var(--font-size-subhead);
    line-height: var(--leading-snug);
}

.kontakt__nummer svg {
    flex: none;
    width: var(--icon-md);
    height: var(--icon-md);
}

.kontakt__knoepfe {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: var(--space-6);
}

.kontakt__geht-nicht {
    display: grid;
    justify-items: center;
    gap: var(--space-4);
    padding: var(--space-24) var(--space-12);
    text-align: center;
}

.kontakt__geht-nicht img {
    width: calc(var(--icon-xxl) * 1.75);
    height: calc(var(--icon-xxl) * 1.75);
    margin-bottom: var(--space-4);
    object-fit: contain;
}

.kontakt__geht-nicht-titel {
    margin: 0;
    color: var(--color-text-strong);
    font-size: var(--font-size-subhead);
}

@media (prefers-reduced-motion: reduce) {
    .schreib,
    .schreib__einladung,
    .schreib__einladung img,
    .schreib__zaehler {
        transition: none;
    }
}
</style>
