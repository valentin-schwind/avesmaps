<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { regelFuer, type KanalId } from "@avesmaps3d/shared";
import AvmPille from "../controls/avm-pille.vue";
import FensterReiter from "../fenster/fenster-reiter.vue";
import { t } from "../i18n/i18n";
import { rubrikName } from "../news/news";
import { kanalName } from "./social-modell";
import { kanalKontextJetzt } from "./social-kontext";
import SocialVorschauFoto from "./social-vorschau-foto.vue";
import SocialVorschauText from "./social-vorschau-text.vue";
import { ANZEIGENAME, KUERZUNG, aktiverReiter, kontoVon, reiterVon, vorschauText } from "./social-vorschau-modell";

/**
 * Die Vorschau je Kanal im Beitragsfenster des Social Hubs (WI-0270; Probierseite V15, Vali 2026-11-01: „da wo die vorschau ist: kannst du das mehr nach vorschau - z.b. nach instagram oder facebook „aussehen
 * lassen“?“; der Entwurf wurde am selben Tag per Antwortknopf „Ja, so einbauen“ bestätigt). Über der Vorschau eine Reiterleiste: zuerst die angehakten Kanäle, die übrigen zum Vergleich (gestrichelt unterstrichen).
 * Jeder Reiter zeigt den Beitrag ungefähr so, wie der Dienst ihn in seinem Strom zeigt, mit seinen Kürzungen, seiner Bildform und seiner Leiste darunter, ohne Zeichen und Marken der Dienste.
 *
 * - **Neuigkeiten** wie bisher: Rubrik, Titelzeile, Text; die Seite zeigt noch keine Bilder.
 * - **Mastodon** mit Kopf, Verweisen und Bild 16:9; **Instagram** mit quadratischem Bild (Pflicht: ohne Bild die gestrichelte Fläche) und der Unterschrift, die nach rund 125 Zeichen mit „mehr“ kürzt (klappt auf);
 *   **Facebook** kürzt nach rund 300 Zeichen mit „Mehr anzeigen“, das Bild randlos; **Discord** als Einbettung mit farbiger Kante und Titelzeile.
 * - 🔴 **Die Reiter stammen aus der Kanalliste des Hubs** (`social-vorschau-modell.ts`, `reiterVon`): Ein Kanal, den die Liste nicht (mehr) führt, hat keinen Reiter. Der Text ist die Fassung, die der Kanal bekommt
 *   (die ersten so vielen Hashtags, wie er nimmt), und er wird nie als HTML gesetzt (`social-vorschau-text.vue`).
 * - 🎨 **Eigene Farben, eine begründete Ausnahme.** Die Dienste zeichnen nicht im Pergament der Karte, also trägt dieses Bauteil, nur dieses, eine kleine eigene Tafel `--vs-*` (hell und dunkel, wie im Entwurf) und
 *   die Schrift des Systems. Die Wächter des Kanons prüfen Fenster und Bausteine, nicht diese Datei; die Reiterleiste selbst ist die eine des Hauses (`FensterReiter`, Guide §9).
 * - Am Telefon passt die Karte in die Breite (`min(100%, 30rem)`).
 */
const props = defineProps<{
    /** Die angehakten Kanäle des Beitrags. */
    kanaele: readonly KanalId[];
    titel: string;
    text: string;
    hashtags: readonly string[];
    rubrik: string;
    /** „heute“ oder das Datum der Veröffentlichung (Reiter Neuigkeiten). */
    heute: string;
    /** Ist ein Bild gewählt? */
    hatBild: boolean;
    /** Die Vorschau-Adresse des gewählten Bildes, wenn das Fenster sie kennt. */
    bildUrl: string | null;
    bildBeschreibung: string;
}>();

const KENNUNG = "social-vorschau";
const reihe = computed(() => reiterVon(props.kanaele));
const gewaehlt = ref<KanalId | undefined>(undefined);
const aktiv = computed<KanalId>({
    get: () => aktiverReiter(reihe.value, gewaehlt.value) ?? "neuigkeiten",
    set: (id) => {
        gewaehlt.value = id;
    },
});
const reiterListe = computed(() => reihe.value.map((eintrag) => ({ id: eintrag.id, name: kanalName(eintrag.id) })));
const angehakt = (id: KanalId): boolean => reihe.value.find((eintrag) => eintrag.id === id)?.angehakt === true;

/** „mehr“ klappt auf; ein anderer Reiter beginnt wieder gekürzt. */
const voll = ref(false);
watch(aktiv, () => {
    voll.value = false;
});

const regeln = computed(() => kanalKontextJetzt().regeln);
const fremd = computed(() =>
    aktiv.value === "neuigkeiten"
        ? undefined
        : vorschauText(
              aktiv.value,
              { text: props.text, hashtags: props.hashtags },
              { leer: t("community.social.vorschau.keinText"), regeln: regeln.value, voll: voll.value },
          ),
);
const konto = computed(() => kontoVon(aktiv.value));
const titelZeile = computed(() => props.titel.trim() || t("community.social.vorschau.ohneTitel"));
const buchstabe = ANZEIGENAME.slice(0, 1);

const hinweis = computed((): string | undefined => {
    switch (aktiv.value) {
        case "mastodon":
            return t("community.social.vorschau.hinweis.mastodon", {
                n: regelFuer("mastodon", regeln.value).adresse ?? 0,
            });
        case "instagram":
            return t("community.social.vorschau.hinweis.instagram", { n: KUERZUNG.instagram ?? 0 });
        case "facebook":
            return t("community.social.vorschau.hinweis.facebook", {
                n: regelFuer("facebook", regeln.value).hashtags,
            });
        case "discord":
            return t("community.social.vorschau.hinweis.discord");
        default:
            return undefined;
    }
});
const karteName = computed(() => t("community.social.vorschau.karte", { kanal: kanalName(aktiv.value) }));
</script>

<template>
    <div class="vs" data-testid="community-social-vorschau">
        <FensterReiter
            v-model="aktiv"
            :reiter="reiterListe"
            :beschriftung="t('community.social.vorschau.reiter')"
            :kennung="KENNUNG"
        >
            <template #reiter="{ eintrag }">
                <span
                    class="avm-versalmitte vs-reiter"
                    :class="{ 'vs-reiter--aus': !angehakt(eintrag.id) }"
                    :title="
                        angehakt(eintrag.id)
                            ? t('community.social.vorschau.angehakt')
                            : t('community.social.vorschau.nichtAngehakt')
                    "
                    >{{ eintrag.name }}</span
                >
            </template>
        </FensterReiter>

        <div
            :id="`${KENNUNG}-inhalt-${aktiv}`"
            role="tabpanel"
            class="vs-inhalt"
            :aria-labelledby="`${KENNUNG}-reiter-${aktiv}`"
        >
            <!-- Neuigkeiten: wie bisher -->
            <article v-if="aktiv === 'neuigkeiten'" class="vorschau" data-testid="social-vorschau-neuigkeiten">
                <div class="vorschau__kopf">
                    <AvmPille>{{ rubrikName(rubrik) ?? rubrik }}</AvmPille>
                    <span class="vs-leise">{{ heute }}</span>
                </div>
                <h4 class="vorschau__titel">{{ titelZeile }}</h4>
                <p class="vorschau__text">{{ text || t("community.social.vorschau.keinText") }}</p>
                <p v-if="hatBild" class="vs-leise">{{ t("community.social.vorschau.ohneBild") }}</p>
            </article>

            <template v-else-if="fremd !== undefined">
                <div class="vs-buehne" :data-kanal="aktiv">
                    <!-- Mastodon -->
                    <article v-if="aktiv === 'mastodon'" class="vs-karte" :aria-label="karteName">
                        <header class="vs-kopf">
                            <span class="vs-avatar" aria-hidden="true">{{ buchstabe }}</span>
                            <span class="vs-namen">
                                <b>{{ ANZEIGENAME }}</b>
                                <span>{{ konto }}</span>
                            </span>
                            <span class="vs-zeit">{{ t("community.social.vorschau.dienst.jetzt") }}</span>
                        </header>
                        <div class="vs-text"><SocialVorschauText :absaetze="fremd.absaetze" /></div>
                        <SocialVorschauFoto form="breit" :gewaehlt="hatBild" :url="bildUrl" :alt="bildBeschreibung" />
                        <footer class="vs-leiste" aria-hidden="true">
                            <span>↩ 0</span><span>⇄ 0</span><span>☆ 0</span><span>⋯</span>
                        </footer>
                    </article>

                    <!-- Instagram -->
                    <article v-else-if="aktiv === 'instagram'" class="vs-karte vs-instagram" :aria-label="karteName">
                        <header class="vs-kopf">
                            <span class="vs-avatar vs-avatar--ring" aria-hidden="true">{{ buchstabe }}</span>
                            <b>{{ konto }}</b>
                            <span class="vs-mehr" aria-hidden="true">⋯</span>
                        </header>
                        <SocialVorschauFoto
                            form="quadrat"
                            :gewaehlt="hatBild"
                            :url="bildUrl"
                            :alt="bildBeschreibung"
                            :ohne="t('community.social.vorschau.instagramOhneBild')"
                        />
                        <div class="vs-leiste vs-leiste--ig" aria-hidden="true">
                            <span>♡</span><span>◯</span><span>➤</span><span class="vs-rechts">⌑</span>
                        </div>
                        <div class="vs-text vs-text--ig">
                            <b>{{ konto }}</b>
                            {{ " " }}
                            <SocialVorschauText
                                :absaetze="fremd.absaetze"
                                inline
                                :knopf="
                                    fremd.gekuerzt ? t('community.social.vorschau.dienst.instagramMehr') : undefined
                                "
                                @mehr="voll = true"
                            />
                        </div>
                        <div class="vs-zeit vs-zeit--ig">{{ t("community.social.vorschau.dienst.instagramZeit") }}</div>
                    </article>

                    <!-- Facebook -->
                    <article v-else-if="aktiv === 'facebook'" class="vs-karte vs-facebook" :aria-label="karteName">
                        <header class="vs-kopf">
                            <span class="vs-avatar" aria-hidden="true">{{ buchstabe }}</span>
                            <span class="vs-namen">
                                <b>{{ ANZEIGENAME }}</b>
                                <span>{{ t("community.social.vorschau.dienst.facebookZeit") }}</span>
                            </span>
                            <span class="vs-mehr" aria-hidden="true">⋯</span>
                        </header>
                        <div class="vs-text">
                            <SocialVorschauText
                                :absaetze="fremd.absaetze"
                                :knopf="fremd.gekuerzt ? t('community.social.vorschau.dienst.facebookMehr') : undefined"
                                @mehr="voll = true"
                            />
                        </div>
                        <SocialVorschauFoto
                            form="breit"
                            randlos
                            :gewaehlt="hatBild"
                            :url="bildUrl"
                            :alt="bildBeschreibung"
                        />
                        <footer class="vs-leiste vs-leiste--fb" aria-hidden="true">
                            <span>{{ t("community.social.vorschau.dienst.facebookGefaellt") }}</span>
                            <span>{{ t("community.social.vorschau.dienst.facebookKommentieren") }}</span>
                            <span>{{ t("community.social.vorschau.dienst.facebookTeilen") }}</span>
                        </footer>
                    </article>

                    <!-- Discord -->
                    <article v-else-if="aktiv === 'discord'" class="vs-discord" :aria-label="karteName">
                        <span class="vs-avatar" aria-hidden="true">{{ buchstabe }}</span>
                        <div class="vs-discord__rumpf">
                            <div class="vs-discord__kopf">
                                <b>{{ ANZEIGENAME }}</b>
                                <span class="vs-plakette">APP</span>
                                <span class="vs-zeit">{{ t("community.social.vorschau.dienst.discordZeit") }}</span>
                            </div>
                            <div class="vs-einbettung">
                                <b>{{ titelZeile }}</b>
                                <div class="vs-text"><SocialVorschauText :absaetze="fremd.absaetze" /></div>
                                <SocialVorschauFoto
                                    form="breit"
                                    :gewaehlt="hatBild"
                                    :url="bildUrl"
                                    :alt="bildBeschreibung"
                                />
                            </div>
                        </div>
                    </article>
                </div>
                <p v-if="hinweis !== undefined" class="vs-leise vs-hinweis" data-testid="social-vorschau-hinweis">
                    {{ t("community.social.vorschau.ungefaehr") }} {{ hinweis }}
                </p>
            </template>
        </div>
    </div>
</template>

<style scoped>
/*
 * Die Vorschau je Kanal: eine Bühne in der Farbe eines Dienststroms, darauf die Karte des Beitrags. Eigene Farben, weil die Dienste nicht im Pergament der Karte zeichnen; im dunklen Thema ihr dunkles.
 * Schrift wie dort: die des Systems. Die Tafel `--vs-*` gilt nur in diesem Bauteil und seinen Kindern (`social-vorschau-text.vue`, `social-vorschau-foto.vue`).
 */
.vs {
    --vs-buehne: #eef0f3;
    --vs-flaeche: #ffffff;
    --vs-text: #14171a;
    --vs-leise: #5b6671;
    --vs-link: #1d5fb8;
    --vs-linie: #dde1e6;
    --vs-discord: #f2f3f5;
    --vs-discord-kante: #5865f2;
    --vs-avatar-grund: #f6eedb;
    --vs-avatar-schrift: #7a5a1c;
    --vs-ring: #d6249f;
    --vs-plakette-schrift: #ffffff;
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
    min-width: 0;
}

:root[data-theme="dark"] .vs {
    --vs-buehne: #0d0f12;
    --vs-flaeche: #181a1f;
    --vs-text: #e8eaed;
    --vs-leise: #9aa4ae;
    --vs-link: #7fb0ff;
    --vs-linie: #2c3037;
    --vs-discord: #2b2d31;
    --vs-discord-kante: #8891f2;
}

/* Ein Kanal, der nicht angehakt ist, steht zum Vergleich da: gestrichelt unterstrichen (der Reiter selbst bleibt der des Hauses). */
.vs-reiter--aus {
    text-decoration: underline dashed;
    text-decoration-thickness: 1px;
    text-underline-offset: 0.2em;
}

.vs-inhalt {
    min-width: 0;
}

.vs-leise {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
}

.vs-hinweis {
    margin-block-start: var(--space-6);
}

/* Neuigkeiten: die Karte von bisher. */
.vorschau {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    padding: var(--space-6) var(--space-8);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-panel);
}

.vorschau__kopf {
    display: flex;
    align-items: center;
    gap: var(--space-6);
}

.vorschau__titel {
    margin: 0;
    color: var(--color-text-strong);
}

.vorschau__text {
    margin: 0;
    color: var(--color-text);
    overflow-wrap: anywhere;
    white-space: pre-wrap;
}

.vs-buehne {
    display: grid;
    justify-items: center;
    padding: var(--space-10) var(--space-6);
    border-radius: var(--radius-md);
    background: var(--vs-buehne);
}

.vs-karte,
.vs-discord {
    box-sizing: border-box;
    width: min(100%, 30rem);
    min-width: 0;
    color: var(--vs-text);
    font:
        0.9375rem/1.4 system-ui,
        -apple-system,
        "Segoe UI",
        Roboto,
        sans-serif;
    text-align: start;
}

.vs-karte {
    display: grid;
    gap: 10px;
    padding: 12px 14px;
    border: 1px solid var(--vs-linie);
    border-radius: 10px;
    background: var(--vs-flaeche);
}

.vs-kopf {
    display: flex;
    gap: 10px;
    align-items: center;
}

.vs-avatar {
    display: inline-grid;
    flex: none;
    place-items: center;
    width: 40px;
    height: 40px;
    overflow: hidden;
    border-radius: 50%;
    background: var(--vs-avatar-grund);
    color: var(--vs-avatar-schrift);
    font:
        700 18px/1 Georgia,
        serif;
}

.vs-avatar--ring {
    width: 34px;
    height: 34px;
    box-shadow:
        0 0 0 2px var(--vs-flaeche),
        0 0 0 4px var(--vs-ring);
}

.vs-namen {
    display: grid;
    min-width: 0;
    line-height: 1.25;
    overflow-wrap: anywhere;
}

.vs-namen span,
.vs-zeit {
    color: var(--vs-leise);
    font-size: 0.8125rem;
}

.vs-zeit,
.vs-mehr {
    margin-inline-start: auto;
}

.vs-mehr {
    color: var(--vs-leise);
}

.vs-text {
    display: grid;
    gap: 8px;
    overflow-wrap: anywhere;
}

.vs-leiste {
    display: flex;
    gap: 22px;
    color: var(--vs-leise);
    font-size: 0.875rem;
}

.vs-leiste--ig {
    gap: 16px;
    color: var(--vs-text);
    font-size: 1.25rem;
}

.vs-rechts {
    margin-inline-start: auto;
}

.vs-leiste--fb {
    justify-content: space-around;
    padding-block-start: 8px;
    border-top: 1px solid var(--vs-linie);
    font-weight: 600;
}

.vs-instagram {
    gap: 8px;
    padding: 10px 0;
}

.vs-instagram > :not(img, .vs-foto) {
    padding-inline: 12px;
}

.vs-text--ig {
    display: block;
}

.vs-zeit--ig {
    margin: 0;
    font-size: 0.6875rem;
    letter-spacing: 0.02em;
}

.vs-discord {
    display: flex;
    gap: 14px;
    padding: 12px 14px;
    border-radius: 8px;
    background: var(--vs-discord);
}

.vs-discord__rumpf {
    display: grid;
    gap: 6px;
    min-width: 0;
}

.vs-discord__kopf {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    align-items: baseline;
}

.vs-plakette {
    padding: 0 4px;
    border-radius: 3px;
    background: var(--vs-discord-kante);
    color: var(--vs-plakette-schrift);
    font-size: 0.625rem;
    font-weight: 700;
}

.vs-einbettung {
    display: grid;
    gap: 8px;
    min-width: 0;
    padding: 10px 14px;
    border-left: 4px solid var(--vs-discord-kante);
    border-radius: 4px;
    background: var(--vs-flaeche);
}
</style>
