<script setup lang="ts">
/**
 * Die zwei Fenster „Kontenverwaltung …“ und „Systemsteuerung …“ (WI-0127 SYS-15, Betreiber 2026-10-10, SYS-0001 §9d: „Das Fenster
 * „Verwaltung …“ wird geteilt“, „als Änderung der Zuordnung, ohne Umbau“). EIN Bauteil, zwei Tafeln im Register (`tafel`): Die
 * Kontenverwaltung trägt „Personen & Sicherheit“ samt dem Protokoll der Konten, die Systemsteuerung „System & Betrieb“, „Redaktion &
 * Integrationen“ und das Protokoll des Systems (mit der Rolle Betreiber dazu „Alles“). Bis SYS-15 hieß es „Verwaltung …“
 * (WI-0120 A10, AUTH-0001 §12.2; seit WI-0127 SYS-1 mit Schiene, SYS-0001 §6.1, Blatt WI-0119 Fassung 2). Links die Bereiche „Personen & Sicherheit“ (Personen · Einladungen · Rollen & Rechte · Protokoll) und „System &
 * Betrieb“ (Betriebszustand seit SYS-5 · Backups · Statusseite ↗ · Claudia & Claudio, später), rechts die gewählte Ansicht. 🔴 Jeder
 * Eintrag hängt an seinem eigenen Recht (Register `SYSTEMSTEUERUNG`), nie an „ist Admin“; wer ein Recht nicht hat, sieht den Eintrag nicht,
 * und ein Bereich ohne Ansicht fällt weg. Geprüft wird trotzdem jede Anfrage auf dem Server - die Oberfläche steuert nur die Ansicht. Die Systemsteuerung
 * (WI-0119) erweitert dieses Fenster um Einträge in „System & Betrieb“, statt ein zweites zu bauen; „Redaktion & Integrationen“ trägt
 * seit SYS-14 die „Abgleiche“ (Legacy-Zug und Medien aus Legacy).
 *
 * - Schiene und Filter stehen (Hülle `schiene` und `leiste`), nur der Inhalt rollt. Am Telefon wird die Schiene eine Auswahl
 *   in der Leiste.
 * - Im Zusatz steht die Umgebung statt „nur Admins“: Rollen gelten je Umgebung (D1 C), und Stage darf nicht mit Avesmaps
 *   verwechselt werden (T19).
 * - Am Telefon werden die Personen zu Karten (Mockup `07-handy`).
 */
import { computed, defineAsyncComponent, provide, ref, watch } from "vue";
import { nachtsFreigeben } from "@avesmaps3d/shared";
import AvmEingabe from "../controls/avm-eingabe.vue";
import type { FilterAbschnitt, FilterWahl } from "../controls/avm-filterknopf";
import AvmFilterknopf from "../controls/avm-filterknopf.vue";
import AvmListenleiste from "../controls/avm-listenleiste.vue";
import { phoneViewport } from "../controls/phone-viewport";
import AvmFenster from "../fenster/avm-fenster.vue";
import type { SchienenBereich } from "../fenster/fenster-schiene";
import FensterSchiene from "../fenster/fenster-schiene.vue";
import { t } from "../i18n/i18n";
import { entprellt } from "../system/entprellt";
import { createAbgleiche } from "./abgleiche";
import { createAbzug } from "./abzug";
import { createHoehenmodell, fassungNummer } from "./hoehenmodell";
import { createSicherung } from "./sicherung";
import { createSystemzustand, schienenWert as systemzustandWert } from "./systemzustand";
import { createVersionen, schienenWert as versionenWert } from "./versionen";
import { createInhalte, schienenWert as inhalteWert } from "./inhalte";
import { createWegfindung, schienenWert as wegfindungWert } from "./wegfindung";
import { createKarteneinstellungen, schienenWert as karteneinstellungenWert } from "./karteneinstellungen";
import { createKanal, schienenWert as kanalWert } from "./kanal";
import { createReadConfirmation } from "./bestaetigen";
import { createOperations, schienenWert } from "./betriebszustand";
import { authState } from "./session-state";
import {
    adminAreasFor,
    adminViewsFor,
    createAdministration,
    type AdminEntryId,
    type AdminView,
    type VerwaltungsTafel,
} from "./verwaltung";
import VerwaltungDatenabgleich from "../wikisync/verwaltung-datenabgleich.vue";
import { createWikisync } from "../wikisync/wikisync";
import VerwaltungBackup from "./verwaltung-backup.vue";
import VerwaltungBetrieb from "./verwaltung-betrieb.vue";
import VerwaltungEinladungen from "./verwaltung-einladungen.vue";
import VerwaltungHoehenmodell from "./verwaltung-hoehenmodell.vue";
import VerwaltungInhalte from "./verwaltung-inhalte.vue";
import VerwaltungWegfindung from "./verwaltung-wegfindung.vue";
import VerwaltungKarteneinstellungen from "./verwaltung-karteneinstellungen.vue";
import VerwaltungKartenserien from "../kartenserien/verwaltung-kartenserien.vue";
import { createKartenserien } from "../kartenserien/kartenserien";
import VerwaltungZoombaender from "../zoombaender/verwaltung-zoombaender.vue";
import VerwaltungWettermodell from "../wettermodell/verwaltung-wettermodell.vue";
import { createWettermodell, schienenWert as wettermodellWert } from "../wettermodell/wettermodell";
import { createZoombaender, schienenWert as zoombaenderWert } from "../zoombaender/zoombaender";
import VerwaltungKanal from "./verwaltung-kanal.vue";
import { usePersonActions } from "./verwaltung-handlungen";
import VerwaltungPersonen from "./verwaltung-personen.vue";
import VerwaltungProtokoll from "./verwaltung-protokoll.vue";
import KanalBerichte from "./kanal-berichte.vue";
import VerwaltungRollen from "./verwaltung-rollen.vue";
import VerwaltungSonderrollen from "./verwaltung-sonderrollen.vue";
import VerwaltungSystemzustand from "./verwaltung-systemzustand.vue";
import VerwaltungVersionen from "./verwaltung-versionen.vue";
import VerwaltungNeuigkeiten from "../news/verwaltung-neuigkeiten-reiter.vue";
import VerwaltungMail from "../community/mail-verwaltung.vue";
import { createMailVerwaltung } from "../community/mail-verwaltung";
import VerwaltungSocial from "../community/social-verwaltung.vue";
import VerwaltungUmgebungen from "../freigabe/verwaltung-umgebungen.vue";
import { createFreigabe, schienenWert as freigabeWert } from "../freigabe/freigabe";
import { createNeuigkeitenPflege, schienenWert as neuigkeitenWert } from "../news/pflege";
import { ZEIGE_ANSICHT, ZEIGE_VORGANG } from "./verwaltung";

/** Die Statusseite im Fenster (Betreiber 2026-10-11), geladen erst, wenn jemand sie öffnet. */
const StatusSeite = defineAsyncComponent(() => import("../status/status-app.vue"));
import {
    AUDIT_RANGES,
    EVENT_GROUPS,
    SYSTEM_EVENT_GROUPS,
    label,
    type AuditRange,
    type EventGroup,
} from "./verwaltung-text";

const offen = defineModel<boolean>("offen", { required: true });
const props = defineProps<{
    tafel: VerwaltungsTafel;
    /** Die Ansicht aus einem tiefen Link (`?verwaltung=<eintrag>`, SYS-0001 §9d.1); ohne sie die erste sichtbare. */
    eintrag?: AdminView | undefined;
    /** Ein Vorgang des Kanals zu `eintrag: "claudio"` (die OPS-Nummer in der Glocke, `&ops=` im tiefen Link). */
    ops?: string | undefined;
}>();

const session = authState.value;
const sichtbar = adminViewsFor(session.capabilities, props.tafel);
const bereiche = adminAreasFor(session.capabilities, props.tafel);
/**
 * EINE Bestätigung für alle Lesewege des Fensters (Hotfix 2026-10-10): Beim Öffnen laden Personen, Einladungen und Betriebszustand
 * gleichzeitig; fehlt der zweite Faktor, geht genau ein „Kurz bestätigen“ auf. Abgebrochen, sagt jeder Bereich, was fehlt, und
 * ein Knopf bietet es für alle erneut an.
 */
const lesen = createReadConfirmation();
const verwaltung = createAdministration({ reads: lesen });
const aktionen = usePersonActions(verwaltung);
/** Der Betriebszustand (SYS-5): sein Stand steht auch dann rechts in der Schiene, wenn ein anderer Eintrag offen ist. */
const betrieb = createOperations({ reads: lesen });
/** Die Abgleiche (SYS-14): laden erst, wenn der Eintrag offen ist. */
const abgleiche = createAbgleiche({ reads: lesen });
/** Der Abzug für lokal (WI-0251): gehört in den Eintrag der Abgleiche und lädt mit ihm. */
const abzug = createAbzug({ reads: lesen });
/** Der WikiSync (WI-0253): der zweite Unterreiter des Datenabgleichs; lädt erst, wenn er gewählt ist. */
const wikisync = createWikisync({ reads: lesen });
/** Die Sicherung (SYS-9): lädt erst, wenn der Eintrag offen ist. */
const sicherung = createSicherung({ reads: lesen });
/** Das Höhenmodell (SYS-13): lädt erst, wenn der Eintrag offen ist; danach steht die eingestellte Fassung in der Schiene. */
const hoehenmodell = createHoehenmodell({ reads: lesen });
/** Der Systemzustand (SYS-8): lädt, wenn der Eintrag offen ist; danach steht das Schwerste mit Zahl in der Schiene. */
const systemzustand = createSystemzustand({ reads: lesen });
/** Die Versionen (WI-0137): laden, wenn der Eintrag offen ist; danach steht das laufende Release in der Schiene. */
const versionen = createVersionen({ reads: lesen });
const neuigkeiten = createNeuigkeitenPflege({ reads: lesen });
/** Das Mailpostfach (WI-0268 C6c): lädt, wenn der Eintrag offen ist. */
const mail = createMailVerwaltung({ reads: lesen });
/** Die Umgebungen samt Production-Freigabe (FREIGABE-0001, WI-0204): lädt mit dem Fenster, damit die Zahl an der Schiene steht. */
const freigabe = createFreigabe({ reads: lesen, mitUmgebungen: session.capabilities.includes("switch_environment") });
/** Die Inhaltsschalter (SYS-10): laden, wenn der Eintrag offen ist; danach steht „N aus“ in der Schiene. */
const inhalte = createInhalte({ reads: lesen });
/** Die Wegfindung (WI-0153): lädt, wenn der Eintrag offen ist; danach steht „N abweichend“ in der Schiene. */
const wegfindung = createWegfindung({ reads: lesen });
/** Die Karteneinstellungen (WI-0166): laden, wenn der Eintrag offen ist; danach steht „N verstellt“ in der Schiene. */
const karteneinstellungen = createKarteneinstellungen({ reads: lesen });
/** Die Kartenserien (WI-0220): laden, wenn der Eintrag offen ist. */
const kartenserien = createKartenserien({ reads: lesen });
/** Die Zoombänder (WI-0221): laden, wenn der Eintrag offen ist; danach steht „N verstellt“ in der Schiene. */
const zoombaender = createZoombaender({ reads: lesen });
/** Das Wettermodell (WI-0288 Stufe 4): lädt, wenn der Eintrag offen ist; danach steht „N abweichend“ in der Schiene. */
const wettermodell = createWettermodell();
/** Der Betreiber-Kanal (WI-0124): „N zur Abnahme“ steht in der Schiene, sobald das Fenster offen ist; die Liste lädt mit dem Eintrag. */
const kanal = createKanal({ reads: lesen });

/** Die gewählte Ansicht; die Schiene wählt nur Einträge der Art `ansicht`. */
const ansicht = ref<string>(
    props.eintrag !== undefined && sichtbar.includes(props.eintrag) ? props.eintrag : (sichtbar[0] ?? "personen"),
);

// Eine Ansicht darf das Fenster auf eine andere schalten (der Verweis „Statusseite“ im Betriebszustand).
provide(ZEIGE_ANSICHT, (id: string) => {
    if ((sichtbar as readonly string[]).includes(id)) ansicht.value = id;
});

/** Eine Zählung gehört in die Beschriftung, die sie zählt (Guide §13.12): Personen und offene Einladungen. */
function zahl(id: AdminEntryId): number | undefined {
    if (id === "personen" && verwaltung.people.value.length > 0) return verwaltung.people.value.length;
    if (id === "einladungen") {
        const offene = verwaltung.invitations.value.filter((invitation) => invitation.status === "open").length;
        if (offene > 0) return offene;
    }
    if (id === "sonderrollen") {
        const aktive =
            verwaltung.sonderrollen.value?.zuteilungen.filter((zeile) => zeile.entzogenAm === null).length ?? 0;
        if (aktive > 0) return aktive;
    }
    return undefined;
}

const SCHIENE = computed<SchienenBereich[]>(() =>
    bereiche.map(({ area, entries }) => ({
        id: area,
        name: label("admin.area", area),
        eintraege: entries.map((entry) => ({
            id: entry.id,
            name: label("admin.tab", entry.id),
            art: entry.kind,
            zahl: zahl(entry.id),
            wert:
                entry.id === "betrieb"
                    ? schienenWert(betrieb.overview.value)
                    : entry.id === "hoehenmodell" && hoehenmodell.stand.value !== null
                      ? fassungNummer(hoehenmodell.stand.value, hoehenmodell.stand.value.eingestellt.version)
                      : entry.id === "systemzustand"
                        ? systemzustandWert(systemzustand.stand.value)
                        : entry.id === "production"
                          ? freigabeWert(freigabe.sicht.value)
                          : entry.id === "neuigkeiten"
                            ? neuigkeitenWert(neuigkeiten.stand.value)
                            : entry.id === "versionen"
                              ? versionenWert(versionen.liste.value)
                              : entry.id === "inhalte"
                                ? inhalteWert(inhalte.stand.value)
                                : entry.id === "wegfindung"
                                  ? wegfindungWert(wegfindung.stand.value)
                                  : entry.id === "claudio"
                                    ? kanalWert(kanal.zaehler.value)
                                    : entry.id === "karteneinstellungen"
                                      ? karteneinstellungenWert(karteneinstellungen.stand.value)
                                      : entry.id === "zoombaender"
                                        ? zoombaenderWert(zoombaender.stand.value)
                                        : entry.id === "wettermodell"
                                          ? wettermodellWert(wettermodell.stand.value)
                                          : undefined,
            href: "href" in entry ? entry.href : undefined,
        })),
    })),
);
const umgebung = label("auth.environment.name", session.environment ?? "");

// Beim Öffnen laden, was die Ansichten und ihre Zählungen brauchen; „Rollen“ und „Protokoll“ laden, wenn man sie wählt.
watch(
    offen,
    (jetzt) => {
        if (!jetzt) return;
        if (sichtbar.includes("personen") || sichtbar.includes("protokoll")) void verwaltung.loadPeople();
        if (sichtbar.includes("einladungen")) void verwaltung.loadInvitations();
        if (sichtbar.includes("sonderrollen")) void verwaltung.loadSonderrollen();
        // Der Eintrag lädt beim Öffnen selbst; sonst steht sein Stand nur in der Schiene.
        if (sichtbar.includes("betrieb") && ansicht.value !== "betrieb") void betrieb.load();
        if (ansicht.value === "rollen") void verwaltung.loadRoles();
        if (ansicht.value === "protokoll-system") void verwaltung.loadPeople();
        if (sichtbar.includes("claudio") && ansicht.value !== "claudio") void kanal.ladeZaehler();
        // Die Zahl der wartenden Entwürfe steht an der Schiene, also auch ohne geöffnete Ansicht.
        if (sichtbar.includes("neuigkeiten")) void neuigkeiten.laden();
        if (sichtbar.includes("production")) void freigabe.laden();
    },
    { immediate: true },
);
watch(ansicht, (jetzt) => {
    aktionen.reset();
    if (jetzt === "rollen") {
        void verwaltung.loadRoles();
        void verwaltung.loadSonderrollen();
    }
    // Das Protokoll der Systemsteuerung braucht die Personen nur für den Filter „Wer“; es lädt sie, wenn man es wählt.
    if (jetzt === "protokoll-system" && verwaltung.people.value.length === 0) void verwaltung.loadPeople();
});

// Die Filter in der Leiste.
const suche = ref("");
const offenePerson = ref<string | null>(null);
const gruppe = ref<EventGroup>("alle");
const wer = ref("");
const zeitraum = ref<AuditRange>("30");
/** Die Suche des Protokolls (Freitext, im Server; Betreiber 2026-10-11): nach einer Tipp-Pause an das Protokoll und die Fix-Berichte. */
const protokollSuche = ref("");
const protokollQ = entprellt(protokollSuche);
/**
 * Die Gruppen des Protokolls dieses Fensters; „Alles“ (auch die Konten) nur für die Rolle Betreiber (SYS-0001 §9d.1), „Fix-Berichte“ nur
 * mit dem Kanal (KANAL-0001 §3.1).
 */
const gruppenListe = (props.tafel === "konten" ? EVENT_GROUPS : SYSTEM_EVENT_GROUPS).filter(
    (group) =>
        (group.id !== "gesamt" || session.person?.role === "operator") &&
        (group.id !== "aenderungen" || session.capabilities.includes("use_operator_channel")),
);
/** „Fix-Berichte“ zeigt die Änderungen von Claudia und Claudio statt des Protokolls; Wer und Zeitraum gelten dort nicht. */
const fixBerichte = computed(() => ansicht.value === "protokoll-system" && gruppe.value === "aenderungen");

/** Die OPS-ID in den Fix-Berichten und unter „Backups“ öffnet den Vorgang im Kanal. */
function zumVorgang(ops: string): void {
    kanal.ziel.value = ops;
    ansicht.value = "claudio";
}
if (sichtbar.includes("claudio")) provide(ZEIGE_VORGANG, zumVorgang);
if (props.eintrag === "claudio" && props.ops !== undefined && sichtbar.includes("claudio"))
    kanal.ziel.value = props.ops;
// Ist das Fenster schon offen, schaltet ein neuer Aufruf (Glocke, Menü) auf seine Ansicht und seinen Vorgang.
watch(
    () => [props.eintrag, props.ops] as const,
    ([eintrag, ops]) => {
        if (eintrag === undefined || !(sichtbar as readonly string[]).includes(eintrag)) return;
        if (eintrag === "claudio" && ops !== undefined) zumVorgang(ops);
        else ansicht.value = eintrag;
    },
);
/**
 * Der Trichter des Protokolls (Hausregel §13.45, Betreiber 2026-10-11): Art der Einträge, Wer und Zeitraum als je eine Wahl. „Alle“ im
 * Blatt heißt bei der Art die Gruppe „Alle“, bei Wer niemand bestimmtes und beim Zeitraum „alles“. Fix-Berichte kennen weder Wer noch
 * Zeitraum; dort stehen nur die Arten.
 */
const filterAbschnitte = computed<FilterAbschnitt[]>(() => [
    {
        id: "art",
        titel: t("admin.audit.group"),
        art: "eins",
        werte: gruppenListe
            .filter((group) => group.id !== "alle")
            .map((group) => ({ wert: group.id, text: label("admin.group", group.id) })),
    },
    ...(fixBerichte.value
        ? []
        : ([
              {
                  id: "wer",
                  titel: t("admin.audit.who"),
                  art: "eins",
                  werte: [...verwaltung.people.value]
                      .sort((a, b) => a.displayName.localeCompare(b.displayName))
                      .map((person) => ({ wert: person.id, text: person.displayName })),
              },
              {
                  id: "zeitraum",
                  titel: t("admin.audit.range"),
                  art: "eins",
                  werte: AUDIT_RANGES.filter((range) => range !== "alles").map((range) => ({
                      wert: range,
                      text: label("admin.audit.range", range),
                  })),
              },
          ] satisfies FilterAbschnitt[])),
]);
/** Die Zahl im Trichter zählt nur, was gilt: bei den Fix-Berichten nur die Art. */
const filterWahl = computed<FilterWahl>(() => ({
    art: gruppe.value === "alle" ? [] : [gruppe.value],
    ...(fixBerichte.value
        ? {}
        : {
              wer: wer.value === "" ? [] : [wer.value],
              zeitraum: zeitraum.value === "alles" ? [] : [zeitraum.value],
          }),
}));
function setzeFilter(abschnitt: string, werte: string[]): void {
    const [wert] = werte;
    if (abschnitt === "art") gruppe.value = (wert as EventGroup | undefined) ?? "alle";
    else if (abschnitt === "wer") wer.value = wert ?? "";
    else if (abschnitt === "zeitraum") zeitraum.value = (wert as AuditRange | undefined) ?? "alles";
}
function loeseFilter(): void {
    gruppe.value = "alle";
    wer.value = "";
    zeitraum.value = "alles";
}

const fuss = computed(() => {
    if (ansicht.value === "personen")
        return phoneViewport.value ? t("admin.foot.personenPhone") : t("admin.foot.personen");
    if (ansicht.value === "betrieb")
        return phoneViewport.value ? t("admin.foot.betriebPhone") : t("admin.foot.betrieb");
    if (fixBerichte.value) return t("admin.foot.aenderungen");
    // Auf Production steht im Reiter „Umgebungen“ kein Knopf: Freigabe und Rückweg laufen auf der Stage (WI-0204 §10).
    if (ansicht.value === "production" && session.environment === "production") return t("admin.foot.productionHier");
    // Nachts ausliefern (WI-0234): Die Fußzeile sagt, was „Freigeben“ heißt; „es geht genau der Stand raus“ stimmte nur für das sofortige Schieben.
    if (ansicht.value === "production" && nachtsFreigeben(freigabe.sicht.value?.datei ?? null))
        return t("admin.foot.productionNacht");
    // Testwerte der offenen Fassung speichern ohne Passkey (WI-0240); es gibt sie nur, wo der Server sie anbietet.
    if (ansicht.value === "hoehenmodell" && hoehenmodell.stand.value?.test !== undefined)
        return t("admin.foot.hoehenmodellTest");
    return label("admin.foot", ansicht.value);
});
</script>

<template>
    <AvmFenster
        v-model:offen="offen"
        bauart="blatt"
        breite="verwaltung"
        :hoeher="props.tafel === 'system'"
        :titel="t(props.tafel === 'konten' ? 'admin.window.konten' : 'admin.window.system')"
        :zusatz="umgebung"
        :testid="props.tafel === 'konten' ? 'kontenverwaltung-fenster' : 'systemsteuerung-fenster'"
    >
        <template v-if="SCHIENE.length > 0" #schiene="{ telefon }">
            <FensterSchiene
                v-model="ansicht"
                :bereiche="SCHIENE"
                :beschriftung="t('admin.tabs')"
                kennung="verwaltung"
                :telefon="telefon"
                :ohne-kopf="props.tafel !== 'system'"
                :feste-koepfe="props.tafel === 'system'"
            />
        </template>
        <template v-if="ansicht === 'personen' && offenePerson === null" #leiste>
            <AvmEingabe
                v-model="suche"
                art="suche"
                class="verwaltung__suche"
                :aria-label="t('admin.people.searchLabel')"
                :placeholder="t('admin.people.search')"
                testid="verwaltung-suche"
            />
        </template>
        <template v-else-if="ansicht === 'protokoll' || ansicht === 'protokoll-system'" #leiste>
            <AvmListenleiste
                v-model="protokollSuche"
                class="verwaltung__leiste"
                :platzhalter="t('admin.audit.search.placeholder')"
                :beschriftung="t('admin.audit.search.label')"
                testid="protokoll-leiste"
            >
                <AvmFilterknopf
                    :abschnitte="filterAbschnitte"
                    :wahl="filterWahl"
                    testid="protokoll-filter"
                    @setze="setzeFilter"
                    @loesen="loeseFilter"
                />
            </AvmListenleiste>
        </template>

        <section
            :id="`verwaltung-inhalt-${ansicht}`"
            class="verwaltung__inhalt"
            :aria-label="label('admin.tab', ansicht)"
            :data-testid="`verwaltung-${ansicht}`"
        >
            <p v-if="sichtbar.length === 0" class="verwaltung__satz">{{ t("admin.noTabs") }}</p>
            <VerwaltungPersonen
                v-else-if="ansicht === 'personen'"
                v-model:offen="offenePerson"
                :verwaltung="verwaltung"
                :aktionen="aktionen"
                :suche="suche"
                :telefon="phoneViewport"
            />
            <VerwaltungEinladungen v-else-if="ansicht === 'einladungen'" :verwaltung="verwaltung" />
            <VerwaltungBetrieb v-else-if="ansicht === 'betrieb'" :betrieb="betrieb" :telefon="phoneViewport" />
            <VerwaltungDatenabgleich
                v-else-if="ansicht === 'abgleiche'"
                :abgleiche="abgleiche"
                :abzug="abzug"
                :wikisync="wikisync"
                :telefon="phoneViewport"
            />
            <VerwaltungRollen v-else-if="ansicht === 'rollen'" :verwaltung="verwaltung" />
            <VerwaltungSonderrollen v-else-if="ansicht === 'sonderrollen'" :verwaltung="verwaltung" />
            <KanalBerichte
                v-else-if="fixBerichte"
                :kanal="kanal"
                :telefon="phoneViewport"
                :suche="protokollQ"
                @oeffne="zumVorgang"
            />
            <VerwaltungProtokoll
                v-else-if="ansicht === 'protokoll' || ansicht === 'protokoll-system'"
                :verwaltung="verwaltung"
                :tafel="props.tafel"
                :gruppe="gruppe"
                :wer="wer"
                :zeitraum="zeitraum"
                :suche="protokollQ"
            />
            <VerwaltungBackup v-else-if="ansicht === 'backup'" :sicherung="sicherung" :telefon="phoneViewport" />
            <VerwaltungSystemzustand
                v-else-if="ansicht === 'systemzustand'"
                :systemzustand="systemzustand"
                :telefon="phoneViewport"
            />
            <VerwaltungVersionen v-else-if="ansicht === 'versionen'" :versionen="versionen" :telefon="phoneViewport" />
            <VerwaltungNeuigkeiten v-else-if="ansicht === 'neuigkeiten'" :pflege="neuigkeiten" :lesen="lesen" />
            <VerwaltungMail v-else-if="ansicht === 'mail'" :mail="mail" />
            <VerwaltungSocial v-else-if="ansicht === 'social'" :lesen="lesen" />
            <VerwaltungUmgebungen v-else-if="ansicht === 'production'" :freigabe="freigabe" />
            <VerwaltungInhalte v-else-if="ansicht === 'inhalte'" :inhalte="inhalte" :telefon="phoneViewport" />
            <VerwaltungKartenserien
                v-else-if="ansicht === 'kartenserien'"
                :kartenserien="kartenserien"
                :telefon="phoneViewport"
            />
            <VerwaltungKarteneinstellungen
                v-else-if="ansicht === 'karteneinstellungen'"
                :karteneinstellungen="karteneinstellungen"
                :telefon="phoneViewport"
            />
            <VerwaltungZoombaender
                v-else-if="ansicht === 'zoombaender'"
                :zoombaender="zoombaender"
                :telefon="phoneViewport"
            />
            <VerwaltungWegfindung
                v-else-if="ansicht === 'wegfindung'"
                :wegfindung="wegfindung"
                :telefon="phoneViewport"
            />
            <VerwaltungWettermodell
                v-else-if="ansicht === 'wettermodell'"
                :wettermodell="wettermodell"
                :telefon="phoneViewport"
            />
            <VerwaltungHoehenmodell
                v-else-if="ansicht === 'hoehenmodell'"
                :hoehenmodell="hoehenmodell"
                :telefon="phoneViewport"
            />
            <StatusSeite v-else-if="ansicht === 'statusseite'" eingebettet />
            <VerwaltungKanal v-else-if="ansicht === 'claudio'" :kanal="kanal" :telefon="phoneViewport" />
        </section>

        <template #fuss-hinweis>{{ fuss }}</template>
        <template #fuss-haupt>
            <button type="button" data-testid="verwaltung-schliessen" @click="offen = false">
                {{ t("fenster.close") }}
            </button>
        </template>
    </AvmFenster>
</template>

<style scoped>
.verwaltung__inhalt {
    display: flex;
    flex-direction: column;
    gap: var(--divider-gap);
    min-width: 0;
}

.verwaltung__suche {
    max-width: calc(var(--avm-field-label-w) * 2.5);
}

.verwaltung__leiste {
    flex: 1 1 auto;
}

.verwaltung__satz {
    margin: 0;
    color: var(--color-text);
    font-size: var(--font-size-body);
}

.verwaltung__erst {
    color: var(--color-accent-strong);
    font-weight: var(--font-weight-regular);
}
</style>
