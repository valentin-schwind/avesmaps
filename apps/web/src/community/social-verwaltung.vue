<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import {
    HASHTAG_MUSTER,
    SOCIAL_HASHTAG_VORRAT_MAX,
    type SocialHashtag,
    type SocialKanalStand,
} from "@avesmaps3d/shared";
import { ApiFailure } from "../auth/api";
import type { ReadConfirmation } from "../auth/bestaetigen";
import AvmEingabe from "../controls/avm-eingabe.vue";
import AvmHinweis from "../controls/avm-hinweis.vue";
import AvmKaestchen from "../controls/avm-kaestchen.vue";
import AvmKnopf from "../controls/avm-knopf.vue";
import AvmStatus from "../controls/avm-status.vue";
import FensterFeldzeilen from "../fenster/fenster-feldzeilen.vue";
import FensterKarte from "../fenster/fenster-karte.vue";
import type { MessageKey } from "../i18n/de";
import { formatNumber, t } from "../i18n/i18n";
import { genauerGrund, textAus, zahlAus, type Abbildung } from "../system/ablehnung";
import { REDAKTION_FEHLER_SATZ, redaktionFehler } from "./redaktion-api";
import { hashtagVorrat, ladeHashtags, speichereHashtags } from "./social-hashtags";
import { aktualisiereKanaele, liesGrenzenNeu, setzeNotschalter } from "./social-kanaele";
import { kanalStaende } from "./social-kontext";
import { kanalName, socialAblehnung } from "./social-modell";

/**
 * Das Panel „Social Media“ unter Systemsteuerung › Redaktion & Zusammenarbeit (WI-0270 C12a; Fachkonzept §15.6 und §15.7; bis 2026-11-03 eine Zeile im Social Hub): je fremdem Kanal mit Zugang eine Karte - ob die
 * Umgebung ihn kennt, ob die Zählregel gegen ein Testkonto geprüft ist, ob der Notschalter steht und welche Grenzen gelten (mit dem Tag, an dem sie gelesen wurden) - und zwei Knöpfe: der Notschalter und „Grenzen neu
 * lesen“ beziehungsweise „Zugang prüfen“. Aufbau und Bauteile wie das Mailpostfach (`mail-verwaltung.vue`).
 *
 * - Nur mit `manage_social_channels` (Betreiber; Register `SYSTEMSTEUERUNG`); beide Handlungen verlangen einen frischen Passkey (Stufe S), den „Kurz bestätigen“ erfragt.
 * - 🔴 Weder Adresse der Instanz noch Zugangsschlüssel kommen je hierher: Der Server meldet nur, ob die Umgebung den Kanal kennt.
 * - Die Karte sagt, was geschah: „Notschalter gesetzt: Mastodon sendet nichts mehr.“ Eine Handlung, die nicht ging, steht als Satz da (Passkey fehlt, Instanz antwortet nicht), nie stumm.
 * - Der Stand liegt in der gemeinsamen Tafel (`social-kontext.ts`): Wahl und Zähler im Social Hub folgen einer Handlung hier sofort.
 * - **Hashtags** (Vali 2026-11-04): die Liste, die der Hub in jedem Beitrag anbietet; angehakte stehen in einem neuen Beitrag schon drin. Jede Handlung speichert sofort, ohne frischen Passkey (`routes/social.ts`).
 */
const props = defineProps<{ lesen?: ReadConfirmation | undefined }>();

const fehler = ref(false);
const laeuft = ref<string | undefined>(undefined);
const meldung = ref<
    | {
          readonly key: MessageKey;
          readonly ton: "neutral" | "gefahr";
          readonly kanal: string;
          /** Der genaue Grund, wenn der Server ihn nennt (WI-0291); sonst gilt `key`. */
          readonly satz?: string | undefined;
      }
    | undefined
>(undefined);

onMounted(async () => {
    fehler.value = !(await aktualisiereKanaele(undefined, props.lesen?.ask));
});

// --- Hashtags ---------------------------------------------------------------------------------------------------------------------

const hashtagLadefehler = ref(false);
const hashtagLaeuft = ref(false);
/** Der Satz, warum das Speichern der Hashtags nicht ging: der genaue Grund des Servers in den Sätzen des Hubs, sonst der allgemeine. */
const hashtagFehler = ref<string | undefined>(undefined);
const neuerHashtag = ref("");
const neuerTag = computed(() => neuerHashtag.value.trim().replace(/^#*/u, "#"));
/** Warum „Hinzufügen“ gerade nicht geht; leer ohne Satz, solange nichts eingegeben ist oder etwas läuft. */
const hinzuSperre = computed((): string | undefined => {
    if (hashtagLaeuft.value || neuerHashtag.value.trim() === "") return "";
    if (!HASHTAG_MUSTER.test(neuerTag.value)) return t("admin.social.hashtags.form");
    // Der Server nimmt höchstens so viele (Schema `maxItems`); der 51. bekam vorher „Beschreibung, Quelle und Name prüfen“ (WI-0291).
    if (hashtagVorrat.value.length >= SOCIAL_HASHTAG_VORRAT_MAX) {
        return t("admin.social.hashtags.voll", { n: formatNumber(SOCIAL_HASHTAG_VORRAT_MAX, 0) });
    }
    const klein = neuerTag.value.toLowerCase();
    return hashtagVorrat.value.some((hashtag) => hashtag.tag.toLowerCase() === klein)
        ? t("admin.social.hashtags.doppelt")
        : undefined;
});

onMounted(async () => {
    hashtagLadefehler.value = !(await ladeHashtags());
});

async function schreibeHashtags(neu: readonly SocialHashtag[]): Promise<boolean> {
    if (hashtagLaeuft.value) return false;
    hashtagLaeuft.value = true;
    hashtagFehler.value = undefined;
    try {
        await speichereHashtags(neu);
        return true;
    } catch (grund) {
        hashtagFehler.value =
            genauerGrund(grund, socialAblehnung()) ?? t(REDAKTION_FEHLER_SATZ[redaktionFehler(grund)]);
        return false;
    } finally {
        hashtagLaeuft.value = false;
    }
}
async function fuegeHashtagHinzu(): Promise<void> {
    if (hinzuSperre.value !== undefined) return;
    if (await schreibeHashtags([...hashtagVorrat.value, { tag: neuerTag.value, vorausgewaehlt: false }])) {
        neuerHashtag.value = "";
    }
}
const schalteVorauswahl = (tag: string, vorausgewaehlt: boolean): Promise<boolean> =>
    schreibeHashtags(hashtagVorrat.value.map((hashtag) => (hashtag.tag === tag ? { tag, vorausgewaehlt } : hashtag)));
const entferneHashtag = (tag: string): Promise<boolean> =>
    schreibeHashtags(hashtagVorrat.value.filter((hashtag) => hashtag.tag !== tag));

const tag = (iso: string | null): string => (iso === null ? "" : new Date(iso).toLocaleDateString());

/** Mastodon nennt seine Grenzen selbst; bei den übrigen führt der Hub sie, gelesen wird der Zugang (Tag der letzten gelungenen Prüfung). */
function grenzenText(s: SocialKanalStand): string {
    if (s.grenzen === null) return t("admin.social.grenzen.keine");
    const zeichen = formatNumber(s.grenzen.zeichen, 0);
    const datum = tag(s.grenzenAt);
    return s.kanal === "mastodon"
        ? t("admin.social.grenzen.instanz", { zeichen, adresse: formatNumber(s.grenzen.adresse, 0), datum })
        : t("admin.social.grenzen.hub", { zeichen, datum });
}

/** Was der Dienst bei „Grenzen neu lesen“ bemängelt (502 `community_kanal`, `details.reason`); `antwort` ist sein Satz ohne Schlüssel. */
const KANAL_ABLEHNUNG = (kanal: string): Abbildung => ({
    gruende: {
        kanal_zugang: (details) =>
            t("admin.social.fehler.zugang", {
                kanal,
                antwort: textAus(details, "antwort") ?? "",
                status: String(zahlAus(details, "status") ?? ""),
            }),
        kanal_antwort: (details) =>
            t("admin.social.fehler.antwort", { kanal, antwort: textAus(details, "antwort") ?? "" }),
    },
});

function fehlerKey(grund: unknown): MessageKey {
    if (grund instanceof ApiFailure && grund.code === "reauth_required") return "admin.social.fehler.passkey";
    if (grund instanceof ApiFailure && grund.code === "community_kanal") return "admin.social.fehler.kanal";
    return REDAKTION_FEHLER_SATZ[redaktionFehler(grund)];
}

async function handlung(s: SocialKanalStand, was: "notschalter" | "grenzen"): Promise<void> {
    if (laeuft.value !== undefined) return;
    laeuft.value = `${s.kanal}:${was}`;
    meldung.value = undefined;
    try {
        if (was === "grenzen") {
            await liesGrenzenNeu(s.kanal);
            meldung.value = {
                key: s.kanal === "mastodon" ? "admin.social.meldung.gelesen" : "admin.social.meldung.zugangGeprueft",
                ton: "neutral",
                kanal: s.kanal,
            };
        } else {
            const neu = await setzeNotschalter(s.kanal, !s.notschalter);
            meldung.value = {
                key: neu.notschalter ? "admin.social.meldung.notschalterAn" : "admin.social.meldung.notschalterAus",
                ton: "neutral",
                kanal: s.kanal,
            };
        }
    } catch (grund) {
        meldung.value = {
            key: fehlerKey(grund),
            ton: "gefahr",
            kanal: s.kanal,
            satz: genauerGrund(grund, KANAL_ABLEHNUNG(kanalName(s.kanal))),
        };
    } finally {
        laeuft.value = undefined;
    }
}
</script>

<template>
    <div class="social" data-testid="social-verwaltung">
        <p class="satz">{{ t("admin.social.lead") }}</p>
        <p v-if="fehler" class="satz satz--fehler" role="alert" data-testid="social-verwaltung-fehler">
            {{ t("admin.social.failed") }}
        </p>

        <FensterKarte v-for="s in kanalStaende" :key="s.kanal" :titel="kanalName(s.kanal)">
            <FensterFeldzeilen :testid="`social-kanal-${s.kanal}`">
                <dt>{{ t("admin.social.field.zugang") }}</dt>
                <dd :data-testid="`social-kanal-${s.kanal}-zugang`">
                    {{
                        t(s.eingerichtet ? "admin.social.zugang.eingerichtet" : "admin.social.zugang.nichtEingerichtet")
                    }}
                </dd>
                <dt>{{ t("admin.social.field.zaehlregel") }}</dt>
                <dd :data-testid="`social-kanal-${s.kanal}-zaehlregel`">
                    {{
                        s.freigeschaltet
                            ? t("admin.social.zaehlregel.geprueft", { datum: tag(s.freigeschaltetAt) })
                            : t("admin.social.zaehlregel.nichtGeprueft")
                    }}
                </dd>
                <dt>{{ t("admin.social.field.notschalter") }}</dt>
                <dd class="reihe">
                    <AvmStatus
                        :ton="s.notschalter ? 'gefahr' : 'ruhe'"
                        :text="t(s.notschalter ? 'admin.social.notschalter.an' : 'admin.social.notschalter.aus')"
                        :testid="`social-kanal-${s.kanal}-notschalter`"
                    />
                    <AvmKnopf
                        groesse="zeile"
                        :art="s.notschalter ? 'weich' : 'gefahr'"
                        :gesperrt="laeuft === undefined ? undefined : ''"
                        :testid="`social-notschalter-${s.kanal}`"
                        @click="handlung(s, 'notschalter')"
                        >{{
                            t(
                                s.notschalter
                                    ? "admin.social.knopf.notschalterLoesen"
                                    : "admin.social.knopf.notschalterSetzen",
                            )
                        }}</AvmKnopf
                    >
                </dd>
                <dt>{{ t("admin.social.field.grenzen") }}</dt>
                <dd class="reihe">
                    <span :data-testid="`social-kanal-${s.kanal}-grenzen`">{{ grenzenText(s) }}</span>
                    <AvmKnopf
                        groesse="zeile"
                        :gesperrt="
                            !s.eingerichtet
                                ? t('admin.social.grund.nichtEingerichtet')
                                : laeuft === undefined
                                  ? undefined
                                  : ''
                        "
                        :testid="`social-grenzen-${s.kanal}`"
                        @click="handlung(s, 'grenzen')"
                        >{{
                            t(
                                s.kanal === "mastodon"
                                    ? "admin.social.knopf.grenzenLesen"
                                    : "admin.social.knopf.zugangPruefen",
                            )
                        }}</AvmKnopf
                    >
                </dd>
            </FensterFeldzeilen>
            <AvmHinweis
                v-if="meldung !== undefined && meldung.kanal === s.kanal"
                :ton="meldung.ton"
                :rolle="meldung.ton === 'gefahr' ? 'alert' : 'status'"
                :testid="`social-kanal-${s.kanal}-meldung`"
                >{{ meldung.satz ?? t(meldung.key, { kanal: kanalName(s.kanal) }) }}</AvmHinweis
            >
        </FensterKarte>

        <FensterKarte :titel="t('admin.social.hashtags.titel')">
            <div class="hashtag-panel" data-testid="social-hashtags">
                <p class="satz">{{ t("admin.social.hashtags.satz") }}</p>
                <p v-if="hashtagLadefehler" class="satz satz--fehler" role="alert">
                    {{ t("admin.social.hashtags.failed") }}
                </p>
                <ul v-if="hashtagVorrat.length > 0" class="hashtag-liste">
                    <li v-for="hashtag in hashtagVorrat" :key="hashtag.tag" class="hashtag-zeile">
                        <AvmKaestchen
                            art="checkbox"
                            :checked="hashtag.vorausgewaehlt"
                            :hinweis="t('admin.social.hashtags.vorausgewaehlt')"
                            :gesperrt="hashtagLaeuft ? '' : undefined"
                            :testid="`social-hashtag-${hashtag.tag}`"
                            @change="schalteVorauswahl(hashtag.tag, $event)"
                            >{{ hashtag.tag }}</AvmKaestchen
                        >
                        <button
                            type="button"
                            class="hashtag-weg"
                            :aria-label="t('admin.social.hashtags.entfernen', { tag: hashtag.tag })"
                            :title="t('admin.social.hashtags.entfernen', { tag: hashtag.tag })"
                            :disabled="hashtagLaeuft"
                            :data-testid="`social-hashtag-weg-${hashtag.tag}`"
                            @click="entferneHashtag(hashtag.tag)"
                        >
                            ×
                        </button>
                    </li>
                </ul>
                <p v-else-if="!hashtagLadefehler" class="satz">{{ t("admin.social.hashtags.leer") }}</p>
                <div class="hashtag-neu">
                    <AvmEingabe
                        v-model="neuerHashtag"
                        :aria-label="t('admin.social.hashtags.neu')"
                        :placeholder="t('admin.social.hashtags.neu')"
                        testid="social-hashtag-neu"
                        @keydown.enter.prevent="fuegeHashtagHinzu"
                    />
                    <AvmKnopf
                        groesse="zeile"
                        :gesperrt="hinzuSperre"
                        testid="social-hashtag-hinzu"
                        @click="fuegeHashtagHinzu"
                        >{{ t("admin.social.hashtags.hinzu") }}</AvmKnopf
                    >
                </div>
                <AvmHinweis
                    v-if="hashtagFehler !== undefined"
                    ton="gefahr"
                    rolle="alert"
                    testid="social-hashtags-fehler"
                    >{{ hashtagFehler }}</AvmHinweis
                >
            </div>
        </FensterKarte>
    </div>
</template>

<style scoped>
.social {
    display: flex;
    flex-direction: column;
    gap: var(--space-10);
}

.satz {
    margin: 0;
    color: var(--color-text-muted);
}

.satz--fehler {
    color: var(--color-danger-soft-text);
}

.reihe {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-4) var(--space-8);
}

.hashtag-panel {
    display: flex;
    flex-direction: column;
    gap: var(--space-8);
}

.hashtag-liste {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
    gap: var(--space-2) var(--space-10);
    margin: 0;
    padding: 0;
    list-style: none;
}

.hashtag-zeile {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-4);
    min-width: 0;
}

.hashtag-weg {
    flex: none;
    width: 22px;
    height: 22px;
    padding: 0;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--color-text-muted);
    font: inherit;
    line-height: 1;
    cursor: pointer;
    transition:
        background-color 120ms ease,
        border-color 120ms ease,
        color 120ms ease;
}

.hashtag-weg:hover:not(:disabled) {
    border-color: var(--color-border);
    background: var(--color-panel);
    color: var(--color-text);
}

.hashtag-weg:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
}

.hashtag-weg:disabled {
    color: var(--color-disabled-text);
    cursor: not-allowed;
}

.hashtag-neu {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    max-width: 360px;
}
</style>
