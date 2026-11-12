<script setup lang="ts">
import { computed, ref } from "vue";
import { EDITORPANEL, kinder } from "@avesmaps3d/shared";
import AvmSegmente from "../controls/avm-segmente.vue";
import { formatNumber, t } from "../i18n/i18n";
import type { NavStand } from "../editor-panel/editor-panel-nav";
import { navName, type EditorpanelId } from "../editor-panel/editor-panel-texte";
import BewertungenListe from "./bewertungen-liste.vue";
import MailsListe from "./mails-liste.vue";
import MeldungenListe from "./meldungen-liste.vue";
import SocialListe from "./social-liste.vue";

/**
 * Der Reiter „Community“ des Editorpanels (WI-0268 C3; Bedienkonzept WI-0263 §1.1): die Unterreiter aus dem Navigationsregister (`EDITORPANEL`, Kennung `community`), darunter der Rumpf des gewählten.
 * Gebaut sind „Meldungen“, seit WI-0268 C4 „Mails“ (nur mit `read_mailbox`), seit WI-0269 C10 „Bewertungen“ und seit WI-0270 C11 der „Social Hub“. Gemerkt und als Tiefer Link (`?tab=meldungen`, Legacy-Alias `reports`) geht es
 * wie bei den übrigen Reitern über `nav`.
 *
 * - **Die Zahl am Unterreiter** ist, was auf mich wartet: offene ohne Zuständigkeit plus mir zugewiesene (`zaehler.meine`, Bedienkonzept §1.1), bei den Meldungen dazu die wartenden Kartenvorschläge; die Liste meldet sie
 *   nach jedem Laden. Sie steht erst ab 1 da. Der kurze Name „Social“ hält die Zeile eng (WI-0275, Entwurf Fassung 2); der volle Name bleibt der Name für Vorleser und der Hinweis beim Überfahren. Reicht die Zeile doch
 *   nicht (Sprachen, Telefon), bricht die Mulde um.
 * - **Kartenvorschläge** stehen seit WI-0305 bei den Meldungen (Vali 2026-11-10: „Als Eintrag der Meldungen“); den Unterreiter „Karten“ gibt es nicht mehr.
 * - Ein Vorgang öffnet als Werkzeugfenster (`vorgang-fenster.vue`), nicht in diesem Rumpf.
 */
const props = defineProps<{
    nav: NavStand;
    rechte: readonly string[];
    /** Das Panel ist zu sehen (Reiter vorn und Slot offen): Die Liste lädt dann neu. */
    sichtbar?: boolean | undefined;
}>();
// Der Rumpf bekommt von der Seite mehr, als er braucht (Telefon, Zahlen der Karteninhalte …): kein Attribut davon gehört ins DOM.
defineOptions({ inheritAttrs: false });

const meine = ref<number | undefined>(undefined);
/** Mails (WI-0268 C4): neue und in Arbeit; „wartet auf Antwort“ wartet auf den Absender und zählt nicht. */
const offeneMails = ref<number | undefined>(undefined);
/** Zu sichten: neue, zurückgehaltene und gemeldete Bewertungen (WI-0269 C10). */
const zuSichten = ref<number | undefined>(undefined);
/** Auf eine Freigabe wartet (Social Hub, WI-0270 C11): vorgelegte Beiträge und Fehler beim Senden; nur mit `manage_news`. */
const zuFreigeben = ref<number | undefined>(undefined);

const nameVon = (id: string): string => t(navName(id as EditorpanelId));
const kurzVon = (id: string): string => (id === "social" ? t("nav.editorpanel.socialKurz") : nameVon(id));
const roheZahl = (id: string): number | undefined =>
    id === "meldungen"
        ? meine.value
        : id === "mails"
          ? offeneMails.value
          : id === "bewertungen"
            ? zuSichten.value
            : id === "social"
              ? zuFreigeben.value
              : undefined;
const zahlVon = (id: string): number | undefined => (roheZahl(id) === 0 ? undefined : roheZahl(id));

const unterreiter = computed(() =>
    kinder(EDITORPANEL, "community", props.rechte).map((eintrag) => {
        const name = nameVon(eintrag.id);
        const zahl = zahlVon(eintrag.id);
        return {
            value: eintrag.id,
            label: zahl === undefined ? name : `${name} (${formatNumber(zahl, 0)})`,
            gesperrt: eintrag.art === "spaeter",
            ...(eintrag.art === "spaeter" ? { hinweis: t("editorPanel.spaeter.satz") } : {}),
        };
    }),
);
const gewaehlt = computed({
    get: () => props.nav.gewaehlt("community") ?? "meldungen",
    set: (id: string) => props.nav.waehle(id),
});
</script>

<template>
    <div class="community" data-testid="editor-community">
        <AvmSegmente
            v-model="gewaehlt"
            :options="unterreiter"
            :label="t('community.redaktion.unterreiter')"
            testid="community-unterreiter"
            eng
        >
            <!-- Zeichen statt Wort (Guide §13.25): So breit wie sein Name, mit der Zahl dahinter; das Wort mit der Zahl bleibt sein Name für Vorleser und beim Überfahren. -->
            <template #zeichen="{ option }">
                <span class="unterreiter__name">{{ kurzVon(option.value) }}</span>
                <span v-if="zahlVon(option.value) !== undefined" class="unterreiter__zahl">{{
                    formatNumber(zahlVon(option.value) ?? 0, 0)
                }}</span>
            </template>
        </AvmSegmente>
        <MeldungenListe
            v-if="gewaehlt === 'meldungen'"
            :rechte="rechte"
            :sichtbar="sichtbar"
            @zaehler="(n: number | undefined) => (meine = n)"
        />
        <MailsListe
            v-else-if="gewaehlt === 'mails'"
            :rechte="rechte"
            :sichtbar="sichtbar"
            @zaehler="(n: number | undefined) => (offeneMails = n)"
        />
        <BewertungenListe
            v-else-if="gewaehlt === 'bewertungen'"
            :rechte="rechte"
            :sichtbar="sichtbar"
            @zaehler="(n: number | undefined) => (zuSichten = n)"
        />
        <SocialListe
            v-else-if="gewaehlt === 'social'"
            :rechte="rechte"
            :sichtbar="sichtbar"
            @zaehler="(n: number | undefined) => (zuFreigeben = n)"
        />
    </div>
</template>

<style scoped>
.unterreiter__name {
    white-space: nowrap;
}

.unterreiter__zahl {
    margin-left: var(--space-2);
    color: var(--color-accent-strong);
    font-variant-numeric: tabular-nums;
}

/* Auf dem gefüllten Segment trägt die Zahl dessen Schrift: Der Goldton hebt sich dort nicht ab. */
.community :deep(.segmente__segment.is-active .unterreiter__zahl) {
    color: inherit;
}

.community {
    display: flex;
    flex-direction: column;
    gap: var(--space-8);
    padding: var(--space-6) var(--space-12) var(--space-12);
}
</style>
