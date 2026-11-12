import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { buildApp } from "../src/app.ts";
import type { ServerConfig } from "../src/config.ts";
import type { SystemSetter } from "../src/system/state-row.ts";
import type { SystemStateSnapshot, SystemStateStore } from "../src/system/state-store.ts";
import { WRITE_CLASSES, WRITE_METHODS, assertWritable, type RouteWriteClass } from "../src/system/write-guard.ts";

/**
 * Die Naht an den Schreibwegen (WI-0127 SYS-4, SYS-0001 §3.3, §4.4, §7.1 Zeile SYS-4), ohne Datenbank:
 *
 * - 🔴 **Positivliste:** Jede registrierte Route mit POST, PUT, PATCH oder DELETE trägt eine Klasse, und die Tafel unten nennt jede
 *   einzelne. Eine neue schreibende Route lässt den Test fallen, bis sie hier steht: keine Route fällt still durch.
 * - **Matrix:** jede Klasse gegen Normal, Kartensperre, Systemsperre, beide, unbekannt und „Tabelle fehlt“ (vor `migrate`).
 *
 * Gegen echtes PostgreSQL mit echten Sitzungen: `system-write-locks.test.ts`.
 */

/**
 * Die Klassen-Tafel (Bauplan §3.3 und E4). `security` bleibt unter beiden Sperren offen, dazu gehört das Umschalten selbst; `system`
 * ist, was etwas gewährt oder einrichtet; `account` das eigene Konto und die Anmeldung; `public` ohne Anmeldung. Kartendaten (`map`)
 * schreibt heute noch keine Route: Die Naht steht, damit jeder künftige Editor-Schreibweg sie von Anfang an erklärt (§3.3).
 */
const EXPECTED: Record<string, RouteWriteClass> = {
    // Anmeldung und eigenes Konto: unter jeder Sperre offen (Abmelden immer).
    "POST /api/auth/logout": "account",
    "POST /api/auth/login": "account",
    "POST /api/auth/links/inspect": "account",
    "POST /api/auth/password-reset": "account",
    "POST /api/auth/recovery": "account",
    "POST /api/auth/discord/start": "account",
    "POST /api/auth/passkey/confirm/options": "account",
    "POST /api/auth/passkey/confirm/verify": "account",
    "POST /api/auth/invitations/inspect": "account",
    "POST /api/auth/invitations/accept": "account",
    "POST /api/account/password": "account",
    "POST /api/account/passkeys/register/options": "account",
    "POST /api/account/passkeys/register/verify": "account",
    "POST /api/account/passkeys/revoke": "account",
    "POST /api/account/sessions/revoke": "account",
    "POST /api/account/display-name": "account",
    "POST /api/account/discord/unlink": "account",
    "POST /api/account/responsibility": "account",
    "POST /api/account/bezeichnung": "account",
    // Verwaltung, die etwas gewährt oder einrichtet: die Systemsperre hält sie an.
    "POST /api/admin/people/unlock": "system",
    "POST /api/admin/people/reset-link": "system",
    "POST /api/admin/people/passkey-link": "system",
    "POST /api/admin/people/capabilities/grant": "system",
    "POST /api/admin/sonderrollen/vergeben": "system",
    "POST /api/admin/invitations": "system",
    "POST /api/admin/invitations/reissue": "system",
    "POST /api/admin/legacy/map": "system",
    "POST /api/admin/legacy/unmap": "system",
    // „Verantwortlich für:“ einer anderen Person (WI-0133): Verwaltung, die Systemsperre hält sie an; den eigenen Eintrag nicht.
    "POST /api/admin/people/responsibility": "system",
    // Rolle hoch oder Zugang zurück: `system`; herab: `security` (im Handler, `assertWritable`).
    "POST /api/admin/people/role": "by_direction",
    // Sicherheitshandgriffe und das Umschalten: immer offen.
    "POST /api/admin/people/lock": "security",
    "POST /api/admin/people/sessions/revoke": "security",
    "POST /api/admin/people/access/revoke": "security",
    "POST /api/admin/people/passkeys/revoke": "security",
    "POST /api/admin/people/capabilities/revoke": "security",
    "POST /api/admin/sonderrollen/entziehen": "security",
    "POST /api/admin/invitations/revoke": "security",
    "POST /api/admin/system/mode": "security",
    "POST /api/admin/system/lock": "security",
    // Die Pause der Warteschlange (WI-0160): dasselbe Argument wie bei den Sperren — eine Sperre darf nicht verhindern, dass man
    // die Warteschlange anhält oder wieder anwirft.
    "POST /api/admin/system/queue": "security",
    // Medienverwaltung (WI-0068 P4a): Inhalte, die Kartensperre hält sie an.
    "POST /api/editor/media": "map",
    "POST /api/editor/media/:id/metadata": "map",
    "POST /api/editor/media/:id/creation": "map",
    "POST /api/editor/media/:id/rights": "map",
    "POST /api/editor/media/:id/rights/review": "map",
    "POST /api/editor/media/:id/evidence": "map",
    // Der Einzelbild-Notaus (WI-0068): Ausblenden ist ein Sicherheitshandgriff und laeuft auch unter Kartensperre (SYS-4);
    // das Aufheben macht Inhalt wieder oeffentlich und wartet darum wie jede Inhaltsaenderung auf sie.
    "POST /api/editor/media/:id/suspend": "security",
    "POST /api/editor/media/:id/suspend/lift": "map",
    "POST /api/editor/media/:id/delete": "map",
    "POST /api/editor/media/merge/all": "map",
    "POST /api/editor/media/bindings/coat": "map",
    "POST /api/editor/media/bindings/coat/none": "map",
    "POST /api/editor/media/bindings/header/set": "map",
    "POST /api/editor/media/bindings/header/none": "map",
    "POST /api/editor/media/bindings/header/relation": "map",
    // Die Galerie als eigenes Medienobjekt (WI-0068 P6): Sie entscheidet, welche Bilder an einem Ort oeffentlich sind - also
    // dieselbe Klasse wie die ortsbezogenen Bindungen. Auch `create` und `title`: eine Galerie ist Kartengegenstand, kein Konto.
    "POST /api/editor/media/galleries/create": "map",
    "POST /api/editor/media/galleries/title": "map",
    "POST /api/editor/media/galleries/add": "map",
    "POST /api/editor/media/galleries/order": "map",
    "POST /api/editor/media/galleries/cover": "map",
    "POST /api/editor/media/galleries/caption": "map",
    "POST /api/editor/media/galleries/remove": "map",
    "POST /api/editor/media/galleries/bind": "map",
    "POST /api/editor/media/galleries/unbind": "map",
    "POST /api/editor/media/galleries/delete": "map",
    // Zusammenfuehren bytegleicher Werke (WI-0068 D1): haengt Verwendungen an Fachobjekten um - dieselbe Klasse wie eine Bindung.
    // Kein frischer Passkey: Es geht nichts offline, und es ist umkehrbar.
    "POST /api/editor/media/merge": "map",
    "POST /api/editor/media/:id/merge/lift": "map",
    "POST /api/editor/media/type-images/adopt": "map",
    "POST /api/editor/media/type-images/set": "map",
    // Eine Variante lösen (WI-0281): wie das Setzen, es entscheidet, was öffentlich als Typbild erscheint.
    "POST /api/editor/media/type-images/release": "map",
    // Die Kartensammlung (WI-0068 R5): Eigenschaften und Typen einer Karte, wie ein Werk.
    "POST /api/editor/media/citymaps/:id/update": "map",
    // Einen Eintrag der Kartensammlung entfernen und zurückholen (WI-0287): wie das Ändern.
    // Einen Eintrag anlegen, Karte und Vorschau zuweisen, ändern, lösen und die Kartendatei hochladen (WI-0287): wie das Ändern.
    "POST /api/editor/media/citymaps": "map",
    "POST /api/editor/media/citymaps/:id/image": "map",
    "POST /api/editor/media/citymaps/:id/image/remove": "map",
    // Bezeichnung und Reihenfolge einer Version der Karte (WI-0287 Stufe 2): wie das Zuweisen.
    "POST /api/editor/media/citymaps/:id/version": "map",
    "POST /api/editor/media/citymaps/:id/links": "map",
    // Orte und Regionen eines Eintrags (WI-0287 Stufe 3): wie die Fundstellen.
    "POST /api/editor/media/citymaps/:id/places": "map",
    "POST /api/editor/media/citymaps/:id/sources": "map",
    // „Vorschau erzeugen“ (WI-0287 Punkt 5): ein neues Werk, sofort als Vorschau gebunden; wie das Zuweisen.
    "POST /api/editor/media/citymaps/:id/preview": "map",
    "PUT /api/editor/media/citymaps/datei": "map",
    "POST /api/editor/media/citymaps/:id/retire": "map",
    "POST /api/editor/media/citymaps/:id/restore": "map",
    // Zwei Einträge zusammenlegen (WI-0287 Stufe 2): übergeben und stilllegen in einer Operation, wie das Entfernen.
    "POST /api/editor/media/citymaps/:id/merge": "map",
    // Reisebilder prüfen und freigeben (WI-0272 S3): Freigeben, Rückfrage, Ablehnen, Korrigieren und Offline nehmen entscheiden, was von Besuchern
    // öffentlich wird - Inhalt der Medienverwaltung, also dieselbe Klasse wie ein Werk. Kartendaten (`place`, Wege, Gebiete) schreibt keine.
    "POST /api/editor/media/photobox/:id/approve": "map",
    "POST /api/editor/media/photobox/:id/ask": "map",
    "POST /api/editor/media/photobox/:id/reject": "map",
    // „Erneut zur Prüfung“ (96ea49eae, OPS-000101): fehlte hier seit dem Bau.
    "POST /api/editor/media/photobox/:id/reopen": "map",
    "POST /api/editor/media/photobox/:id/correct": "map",
    "POST /api/editor/media/photobox/:id/offline": "map",
    // Das Fenster „Inhalte bearbeiten“, Reiter Quellen (WI-0254): Katalogquellen und ihre Verwendungen, Inhalt der Karte wie Medien und Ort.
    "POST /api/editor/inhalte/quellen": "map",
    "POST /api/editor/inhalte/quellen/:id/update": "map",
    // Quelle, Werk und Korpus zurücknehmen (WI-0265 B6g1): die Vorprüfung liest nur (unter der Kartensperre), die Rücknahme schreibt EINE Operation.
    "POST /api/editor/inhalte/quellen/:id/restore-series/preview": "map",
    "POST /api/editor/inhalte/quellen/:id/restore-series": "map",
    "POST /api/editor/inhalte/literatur/:id/restore-series/preview": "map",
    "POST /api/editor/inhalte/literatur/:id/restore-series": "map",
    "POST /api/editor/inhalte/korpora/:id/restore-series/preview": "map",
    "POST /api/editor/inhalte/korpora/:id/restore-series": "map",
    // Das Vorkommen zurücknehmen (WI-0265 B6g2): wie Quelle, Werk und Korpus.
    "POST /api/editor/inhalte/vorkommen/:id/restore-series/preview": "map",
    "POST /api/editor/inhalte/vorkommen/:id/restore-series": "map",
    // Die Quellen eines Kartenobjekts in den Editoren (WI-0254 §12): vom Objekt her.
    "POST /api/editor/inhalte/traeger/:kind/:id/quellen": "map",
    "POST /api/editor/inhalte/literatur": "map",
    "POST /api/editor/inhalte/literatur/:id/update": "map",
    "POST /api/editor/inhalte/korpora": "map",
    "POST /api/editor/inhalte/korpora/:id/wirkung": "map",
    "POST /api/editor/inhalte/korpora/:id/update": "map",
    "POST /api/editor/inhalte/vorkommen": "map",
    "POST /api/editor/inhalte/vorkommen/:id/update": "map",
    // „Regeln als Text“ im Reiter Vorkommen (WI-0254 §13): prüfen liest nur (Klasse wie eine Vorschau), übernehmen schreibt EINE Operation über viele Einträge.
    "POST /api/editor/inhalte/vorkommen-text/pruefen": "map",
    "POST /api/editor/inhalte/vorkommen-text/uebernehmen": "map",
    // Ortseditor (WI-0128 E10): Fachoperationen am Ort, dazu der Schalter MAP_EDITING.
    "PATCH /api/editor/places/:id": "map",
    "POST /api/editor/places/:id/move": "map",
    "POST /api/editor/places": "map",
    // „Ort entfernen“ (WI-0128 E22): von der Karte nehmen, weich löschen, ↺ unter „Änderungen“.
    "POST /api/editor/places/:id/take-off-map": "map",
    "POST /api/editor/places/:id/delete": "map",
    "POST /api/editor/places/:id/restore": "map",
    // Orte zurücknehmen (WI-0265 B4): die Vorprüfung liest nur (unter der Kartensperre wie die Vorschau der Flächenwerkzeuge), die Rücknahme schreibt EINE Operation.
    "POST /api/editor/places/:id/restore-series/preview": "map",
    "POST /api/editor/places/:id/restore-series": "map",
    // Die Mehrfachauswahl der Ortsliste (WI-0237).
    "POST /api/editor/places/sammel": "map",
    "POST /api/editor/places/sammel/delete": "map",
    // Die Innerorts-Beziehung einer Stätte (WI-0128 E10b): zuordnen, verlagern, lösen - eine Sache der Karte wie `place.update`.
    "POST /api/editor/places/:id/sites/add": "map",
    "POST /api/editor/places/:id/sites/relation": "map",
    // Wegeditor (WI-0177): „Neuer Weg“, Teilen, Löschen; die Wegkurve schreibt seit W5b Schritt 3 mit `path.update`.
    "POST /api/editor/paths": "map",
    "POST /api/editor/paths/:id/split": "map",
    "POST /api/editor/paths/:id/delete": "map",
    "POST /api/editor/paths/:id/restore": "map",
    "POST /api/editor/paths/:id/take-off-map": "map",
    "POST /api/editor/paths/:id/put-on-map": "map",
    "POST /api/editor/paths/:id/street/delete": "map",
    "POST /api/editor/paths/:id/street/take-off-map": "map",
    // „Weg entfernen …“ an der Mehrfachauswahl (WI-0252): mehrere Wege in EINER Operation.
    "POST /api/editor/paths/sammel/delete": "map",
    "POST /api/editor/paths/sammel/take-off-map": "map",
    "POST /api/editor/paths/:id/update": "map",
    // Wege zurücknehmen (WI-0265 B6a): die Vorprüfung liest nur (unter der Kartensperre wie die Vorschau der Flächenwerkzeuge), die Rücknahme schreibt EINE Operation.
    "POST /api/editor/paths/:id/restore-series/preview": "map",
    "POST /api/editor/paths/:id/restore-series": "map",
    // „Auswahl zu neuem Weg“ und „Wege verbinden“, je samt ↺ (WI-0252).
    "POST /api/editor/paths/neuer-weg": "map",
    "POST /api/editor/paths/verbinden": "map",
    // Der Straßen-Assistent (WI-0310): die Strecke liest nur (Klasse wie die Vorprüfung der Rücknahme), Zuweisen schreibt.
    "POST /api/editor/paths/strassen-assistent/strecke": "map",
    "POST /api/editor/paths/strassen-assistent/zuweisen": "map",
    "POST /api/editor/landscapes/vereinigen": "map",
    "POST /api/editor/territories/vereinigen": "map",
    // Die Wiki-Box im Objekteditor (WI-0253): Zuweisen und Entfernen schreiben die Karte, der Sync reiht einen Auftrag ein, der sie schreibt (Kartensperre und Schalter gelten für alle drei).
    "POST /api/editor/wiki-box/:art/:id/entfernen": "map",
    "POST /api/editor/wiki-box/:art/:id/sync": "map",
    "POST /api/editor/wikisync/:id/restore-series": "map",
    "POST /api/editor/wikisync/:id/restore-series/preview": "map",
    "POST /api/editor/wikisync-schritt/:id/restore-series": "map",
    "POST /api/editor/wikisync-schritt/:id/restore-series/preview": "map",
    "POST /api/editor/wiki-box/:art/:id/restore-series": "map",
    "POST /api/editor/wiki-box/:art/:id/restore-series/preview": "map",
    "POST /api/editor/wiki-box/:art/:id/zuweisen": "map",
    // Kraftlinien-Editor (WI-0205 K6): die Felder einer Linie (`powerline.update_line`).
    "POST /api/editor/powerlines": "map",
    "POST /api/editor/nodices": "map",
    "POST /api/editor/powerlines/:id/update": "map",
    "POST /api/editor/powerlines/sammel/stand": "map",
    "POST /api/editor/powerlines/sammel/wiki": "map",
    "POST /api/editor/powerlines/:id/retire": "map",
    // Kraftlinien und Gebiete zurücknehmen (WI-0265 B6b): die Vorprüfung liest nur, trägt aber die Klasse `map` wie die der Orte und Gebirge.
    "POST /api/editor/powerlines/:id/restore-series/preview": "map",
    "POST /api/editor/powerlines/:id/restore-series": "map",
    "POST /api/editor/territories/:id/restore-series/preview": "map",
    "POST /api/editor/territories/:id/restore-series": "map",
    // Der Stand einer Linie und ein Kraftlinienpunkt ohne Linie (K10).
    "POST /api/editor/powerlines/:id/restore": "map",
    "POST /api/editor/powerlines/:id/take-off-map": "map",
    "POST /api/editor/powerlines/:id/put-on-map": "map",
    "POST /api/editor/nodices/:id/retire": "map",
    "POST /api/editor/nodices/:id/move": "map",
    "POST /api/editor/nodices/:id/restore-series": "map",
    "POST /api/editor/nodices/:id/restore-series/preview": "map",
    // Herrschaftsgebiete (WI-0209 C2): „Fertig“ in „Grenzen bearbeiten“ schreibt Flächen samt mitgezogener Nachbarn.
    "POST /api/editor/territories/display": "map",
    "POST /api/editor/territories/sammel": "map",
    "POST /api/editor/territories/sammel/retire": "map",
    "POST /api/editor/territories/sammel/obergebiet": "map",
    // Liest nur (der Stand der Mehrfachauswahl), POST wegen der Länge der Kennungen.
    "POST /api/editor/territories/sammel/stand": "account",
    "POST /api/editor/territories/:id/retire": "map",
    "POST /api/editor/territories/:id/restore": "map",
    "PATCH /api/editor/territories/:id": "map",
    // „Neue Fläche“ (WI-0209 C3): ein neues Gebiet samt Fläche, eine Grenze an einem Gebiet ohne Fläche.
    "POST /api/editor/territories": "map",
    "POST /api/editor/territories/:id/areas": "map",
    // Felder, Beschriftungen und Form einer Landschaft in EINER Operation (WI-0178 B2, `landscape.update`).
    "PATCH /api/editor/landscapes/:id": "map",
    // „Neue Fläche“ (WI-0178 T47, `landscape.create`): Fläche samt erster Teilfläche in EINER Operation.
    "POST /api/editor/landscapes": "map",
    // Gipfel und Vulkane (WI-0178 P1, `peak.update`): Name, Höhe, „Auf der Karte anzeigen“, Lage.
    "PATCH /api/editor/peaks/:id": "map",
    "POST /api/editor/peaks": "map",
    // „Fläche entfernen …“ und ↺ im Verlauf (WI-0178 D2, T54): von der Karte nehmen oder löschen, zurückholen.
    "POST /api/editor/landscapes/:id/retire": "map",
    // Eine Gebirgsserie zurücknehmen (WI-0265 B3): die Vorprüfung liest nur (wie die Vorschau der Flächenwerkzeuge unter der Kartensperre), die Rücknahme schreibt EINE Operation.
    "POST /api/editor/landscapes/:id/restore-series/preview": "map",
    "POST /api/editor/landscapes/:id/restore-series": "map",
    // Beschriftungen anlegen und löschen (WI-0232, Topographie): je eine Sofort-Operation an der Landschaft.
    "POST /api/editor/landscapes/:id/labels": "map",
    "POST /api/editor/landscapes/:id/labels/:labelId/retire": "map",
    // „Mit anderer Fläche ›“ (WI-0178 Werkzeug 1, Thomas 4.1): die Vorschau rechnet nur, steht aber mit dem Schreiben unter derselben Sperre.
    "POST /api/editor/landscapes/:id/boolean-preview": "map",
    "POST /api/editor/landscapes/:id/boolean": "map",
    // „Unterflächen ›“ (WI-0178 Werkzeug 3).
    "POST /api/editor/landscapes/:id/parts": "map",
    // „Zerschneiden“ (WI-0178 Werkzeug 5).
    "POST /api/editor/landscapes/:id/split": "map",
    // „Kopieren …“ (WI-0178 Werkzeug 8).
    "POST /api/editor/landscapes/:id/copy": "map",
    // „Fläche malen“ und „Fläche radieren“ (WI-0178 Werkzeug 6): rechnet nur.
    "POST /api/editor/landscapes/:id/brush": "map",
    // Die Mehrfachauswahl der Derographie (EDIT-0003 T57): Felder und „Entfernen …“ für alle gewählten.
    "POST /api/editor/landscapes/batch": "map",
    "POST /api/editor/landscapes/batch-retire": "map",
    "POST /api/editor/peaks/:id/retire": "map",
    // Einen Gipfel zurücknehmen (WI-0265 B6c): die Vorprüfung liest nur (unter der Kartensperre), die Rücknahme schreibt EINE Operation.
    "POST /api/editor/peaks/:id/restore-series/preview": "map",
    "POST /api/editor/peaks/:id/restore-series": "map",
    // Die Sperre während der Bearbeitung (WI-0178, EDIT-0003 §4): Nehmen ist Kartenarbeit; Herzschlag und Freigeben gehen unter jeder
    // Sperre, damit ein Lauf sauber endet; Aufheben durch einen Admin ist Verwaltung.
    "POST /api/editor/locks": "map",
    "POST /api/editor/locks/heartbeat": "account",
    "POST /api/editor/locks/release": "account",
    "POST /api/editor/locks/lift": "system",
    // Um Freigabe einer fremden Sperre bitten ist Kartenarbeit; die Antwort des Inhabers geht wie Herzschlag und Freigeben unter jeder Sperre (WI-0262).
    "POST /api/editor/locks/request": "map",
    "POST /api/editor/locks/request/answer": "account",
    // „Nicht auf die Karte“ an einem Landmarken-Kandidaten (WI-0271 L7): Kartenarbeit wie das Setzen, das der Kandidat sonst bekäme.
    "POST /api/editor/landmarken-kandidaten/:id/unterdruecken": "map",
    // „In Landmarke umwandeln …“ und seine Rücknahme (WI-0271 L8): Kartenarbeit.
    "POST /api/editor/places/:id/in-landmarke": "map",
    "POST /api/editor/landmarken-umwandlung/:id/restore-series/preview": "map",
    "POST /api/editor/landmarken-umwandlung/:id/restore-series": "map",
    // Der Spracheditor (WI-0261 S5d1): Sprachen, ihre Teilflächen, Wiki-Zuordnung und das Nachrechnen der Treffer sind Kartenarbeit.
    "POST /api/editor/sprachen": "map",
    "POST /api/editor/sprachen/aus-landschaft": "map",
    "POST /api/editor/sprachen/:id/update": "map",
    "POST /api/editor/sprachen/:id/retire": "map",
    // Der Wetter-Editor (WI-0288 Stufe 2): Presets und Icons sind Karteninhalt, die Kartensperre hält sie an.
    "PATCH /api/editor/wetter/presets/:id": "map",
    "POST /api/editor/wetter/presets/:id/zeitpunkt": "map",
    // Presets anlegen und angelegte entfernen (Betreiber 2026-11-08).
    "POST /api/editor/wetter/presets": "map",
    "POST /api/editor/wetter/presets/:id/entfernen": "map",
    "POST /api/editor/wetter/symbole": "map",
    "PATCH /api/editor/wetter/symbole/:id": "map",
    "POST /api/editor/wetter/symbole/:id/entfernen": "map",
    "POST /api/editor/sprachen/:id/restore": "map",
    // Sprachen zurücknehmen (WI-0265 B6e): die Vorprüfung liest nur (wie die Vorschau der Flächenwerkzeuge unter der Kartensperre), die Rücknahme schreibt EINE Operation.
    "POST /api/editor/sprachen/:id/restore-series/preview": "map",
    "POST /api/editor/sprachen/:id/restore-series": "map",
    "POST /api/editor/sprachen/:id/wiki": "map",
    "POST /api/editor/sprachen/:id/treffer": "map",
    "POST /api/editor/sprachen/:id/flaechen": "map",
    "POST /api/editor/sprachen/:id/flaechen/:flaeche/reshape": "map",
    "POST /api/editor/sprachen/:id/flaechen/:flaeche/brush": "map",
    "POST /api/editor/sprachen/:id/flaechen/:flaeche/parts": "map",
    "POST /api/editor/sprachen/:id/flaechen/:flaeche/split": "map",
    "POST /api/editor/sprachen/:id/flaechen/:flaeche/boolean-preview": "map",
    "POST /api/editor/sprachen/:id/flaechen/:flaeche/boolean": "map",
    "POST /api/editor/sprachen/:id/flaechen/:flaeche/copy": "map",
    "POST /api/editor/sprachen/:id/flaechen/:flaeche/retire": "map",
    "POST /api/editor/sprachen/:id/flaechen/:flaeche/restore": "map",
    // Ohne Anmeldung: rechnen per POST, Kurzlink.
    "POST /api/route/landscapes": "public",
    "POST /api/route/stage/lore": "public",
    "POST /api/route/unterwegs": "public",
    // Die Gegenden eines Vorkommens an der Route (WI-0257).
    "POST /api/route/unterwegs/gegenden": "public",
    "POST /api/share": "public",
    // Die alte Entwickler-API von Legacy: nur noch 410 (WI-0303 P7), schreibt nichts.
    "POST /api/route/": "public",
    "POST /api/route": "public",
    "POST /api/route.php": "public",
    // Die anonyme Zählung (WI-0138): Besuch und Lebenszeichen kommen aus dem Browser jedes Besuchers, also `public`.
    // Sie schreiben nur Summen und eine Tageskennung, nie eine Person und nie eine Adresse.
    "POST /api/besuch": "public",
    "POST /api/besuch/ping": "public",
    // Die Reisebilder (WI-0272 S2): einreichen und die Statusseite des Einreichers kommen ohne Anmeldung von außen (`public`); sie schreiben keine Kartendaten und hängen an keiner Sperre.
    // Karte vorschlagen (WI-0275 Stufe B): Besucher ohne Konto; die Redaktion schreibt als Community.
    "POST /api/kartenvorschlaege/einreichungen": "public",
    "POST /api/kartenvorschlaege/status": "public",
    "POST /api/kartenvorschlaege/status/zurueckziehen": "public",
    "PUT /api/kartenvorschlaege/datei": "public",
    "POST /api/community/kartenvorschlaege/:id/ablehnen": "community",
    // Annehmen legt eine Karte der Kartensammlung an: Kartendaten und Inhalte, also unter der Kartensperre (WI-0275 B2).
    "POST /api/community/kartenvorschlaege/:id/annehmen": "map",
    "POST /api/photobox/einreichungen": "public",
    "POST /api/photobox/status": "public",
    "POST /api/photobox/status/vorschau": "public",
    "POST /api/photobox/status/beschreibung": "public",
    "POST /api/photobox/status/bild": "public",
    "POST /api/photobox/status/zurueckziehen": "public",
    "POST /api/photobox/status/offline": "public",
    "POST /api/photobox/status/nutzung": "public",
    "POST /api/photobox/reisebilder/:id/gefaellt": "public",
    // Das Community-Modul (WI-0268): Meldeformular und Statusseite kommen ohne Anmeldung von außen (`public`), die Redaktion arbeitet in der Klasse
    // `community`; beide hängen an keiner Sperre, denn gemeldet wird gerade dann, wenn etwas gesperrt ist (auch bei einem Legacy-Zug).
    "POST /api/community/meldungen": "public",
    "POST /api/community/status": "public",
    "POST /api/community/status/antwort": "public",
    "POST /api/community/status/zurueckziehen": "public",
    // „Mit Discord verbinden“ (WI-0268 C8): Lösen ist eine Handlung des Melders (`public`). Die Brücke der Stage kommt ohne Sitzung mit dem Dienstschlüssel: `offen` liest nur (`public`), das Zurückziehen ist eine Handlung an einem Vorgang (`community`).
    "POST /api/community/status/discord-loesen": "public",
    "POST /api/community/discord/offen": "public",
    "POST /api/community/discord/zurueckziehen": "community",
    // Eine Meldung aus dem Kanal der Stage wird eine Anfrage der Redaktion (WI-0297), über dieselbe Brücke.
    "POST /api/community/discord/uebernehmen": "community",
    "POST /api/community/vorgaenge/:com/sichten": "community",
    "POST /api/community/vorgaenge/:com/uebernehmen": "community",
    "POST /api/community/vorgaenge/:com/archivieren": "community",
    "POST /api/community/vorgaenge/:com/prioritaet": "community",
    "POST /api/community/vorgaenge/:com/notiz": "community",
    "POST /api/community/vorgaenge/:com/rueckfrage": "community",
    "POST /api/community/vorgaenge/:com/abschliessen": "community",
    "POST /api/community/vorgaenge/:com/wiedereroeffnen": "community",
    "POST /api/community/vorgaenge/:com/zustaendig": "community",
    "POST /api/community/vorgaenge/:com/rollen": "community",
    "POST /api/community/vorgaenge/:com/papierkorb": "community",
    "POST /api/community/vorgaenge/:com/wiederherstellen": "community",
    "POST /api/community/vorgaenge/:com/personenbezug-loeschen": "community",
    // Mails (WI-0268 C4): das Kontaktformular kommt von außen (`public`), Antworten, Archivieren, Zurückholen und Weiterführen arbeitet die Redaktion in der Klasse `community`.
    "POST /api/community/anfragen": "public",
    "POST /api/community/vorgaenge/:com/antworten": "community",
    // Mailweg (WI-0268 C6a): eine neue Mail und Erneut senden arbeitet die Redaktion in der Klasse `community`.
    "POST /api/community/mails": "community",
    "POST /api/community/vorgaenge/:com/nachrichten/:id/erneut-senden": "community",
    "POST /api/community/vorgaenge/:com/ins-archiv": "community",
    "POST /api/community/vorgaenge/:com/zurueck-in-eingang": "community",
    "POST /api/community/vorgaenge/:com/als-meldung": "community",
    // Verknüpfungen (WI-0268 C7): eine Korrektur verknüpfen und an den Betreiber-Kanal weiterreichen arbeitet die Redaktion in der Klasse `community` (der Kanal selbst bleibt `kanal`).
    "POST /api/community/vorgaenge/:com/korrektur": "community",
    "POST /api/community/vorgaenge/:com/an-kanal": "community",
    // Bewertungen (WI-0269): schreiben, „Gefällt mir“ und melden sind öffentlich; die Redaktion arbeitet in der Klasse `community`.
    "POST /api/community/bewertungen": "public",
    "POST /api/community/bewertungen/:id/gefaellt": "public",
    "POST /api/community/bewertungen/:id/melden": "public",
    "POST /api/community/bewertungen/:id/sichten": "community",
    "POST /api/community/bewertungen/:id/freigeben": "community",
    "POST /api/community/bewertungen/:id/verbergen": "community",
    "POST /api/community/bewertungen/:id/einblenden": "community",
    "POST /api/community/bewertungen/:id/inhalt-loeschen": "community",
    // Social Hub (WI-0270): die Redaktion arbeitet in der Klasse `community`; die Sperre der Karte hält ihn nicht an.
    "POST /api/community/social": "community",
    "POST /api/community/social/:id/aendern": "community",
    "POST /api/community/social/:id/vorlegen": "community",
    "POST /api/community/social/:id/zurueckziehen": "community",
    "POST /api/community/social/:id/papierkorb": "community",
    "POST /api/community/social/:id/zurueckholen": "community",
    "POST /api/community/social/:id/zurueckgeben": "community",
    "POST /api/community/social/:id/freigeben": "community",
    "POST /api/community/social/:id/aenderung": "community",
    "POST /api/community/social/:id/zuruecknehmen": "community",
    "POST /api/community/social/:id/erneut": "community",
    "POST /api/community/social/:id/kanal-zuruecknehmen": "community",
    "POST /api/community/social/kanaele/:kanal/notschalter": "security",
    "POST /api/community/social/bilder/:asset/rechte": "community",
    "POST /api/community/social/kanaele/:kanal/grenzen": "community",
    "POST /api/community/social/hashtags": "community",
    // Abgleiche (WI-0127 SYS-14): einen Import auslösen, unter beiden Sperren offen (Betreiber 2026-10-10, Frage 3).
    "POST /api/admin/system/abgleiche/start": "import",
    // „Sicherung jetzt“ (WI-0127 SYS-9): ein Sicherheitshandgriff, keine Sperre hält eine zusätzliche Sicherung an.
    "POST /api/admin/system/backup/start": "security",
    // „Wiederherstellung beantragen“ (WI-0124 K5): gerade dann nötig, wenn etwas kaputt ist; der Antrag spielt nichts zurück.
    "POST /api/admin/system/backup/wiederherstellung": "security",
    // Der Betreiber-Kanal (WI-0124): unter jeder Sperre offen, gemeldet wird gerade dann, wenn etwas gesperrt ist.
    "POST /api/kanal/vorgaenge": "kanal",
    "POST /api/kanal/vorgaenge/:ops/nachricht": "kanal",
    "POST /api/kanal/vorgaenge/:ops/abnehmen": "kanal",
    "POST /api/kanal/vorgaenge/:ops/wieder-oeffnen": "kanal",
    "POST /api/kanal/vorgaenge/:ops/loeschen": "kanal",
    "POST /api/kanal/vorgaenge/:ops/abschliessen": "kanal",
    "POST /api/kanal/bilder/:id/entfernen": "kanal",
    "POST /api/kanal/vorgaenge/:ops/bilder": "kanal",
    // Discord (WI-0255 Paket 2): Ein Betreiber gibt eine Meldung frei; Discord meldet ohne Anmeldung, signiert, in den Kanal (beide Pfade).
    "POST /api/kanal/vorgaenge/:ops/sichten": "kanal",
    // An die Community weiterleiten (WI-0297): eine Handlung im Kanal wie die Freigabe.
    "POST /api/kanal/vorgaenge/:ops/an-community": "kanal",
    "POST /api/discord/interactions": "kanal",
    "POST /api/discord/interactions.php": "kanal",
    // Benachrichtigungen (WI-0136 N2): „gelesen“ gehört zum eigenen Konto, die Antwort auf „Fix ist live“ ist eine Handlung im Kanal.
    "POST /api/benachrichtigungen/gelesen": "account",
    "POST /api/benachrichtigungen/:id/antwort": "kanal",
    // Inhaltsschalter (WI-0127 SYS-10): ausschalten schützt (`security`), einschalten gibt frei (`system`).
    "POST /api/admin/system/content-switches": "by_direction",
    // Wegfindung (WI-0153): eine Kenngröße verstellen ist eine Einstellung, kein Sicherheitshandgriff — es gibt keine Richtung.
    "POST /api/admin/system/wegfindung": "system",
    "POST /api/admin/system/wegfindung/freigeben": "system",
    // Karteneinstellungen (WI-0166): eine Voreinstellung verstellen ist eine Einstellung, kein Sicherheitshandgriff.
    "POST /api/admin/system/karteneinstellungen": "system",
    // Karten herunterladen (WI-0280): Ausstellen gewährt etwas, Zurücknehmen schützt und läuft auch unter einer Systemsperre.
    "POST /api/karten-export/zugaenge": "system",
    "POST /api/karten-export/zugaenge/:id/neu": "system",
    "POST /api/karten-export/zugaenge/:id/weg": "security",
    "POST /api/karten-export/svg": "system",
    "POST /api/admin/system/kartenserien": "system",
    // Hochladen (WI-0220 Schnitt 3): Anlegen, Stücke und Abschluss sind Einstellungen der Darstellung, keine Sicherheitshandgriffe.
    "POST /api/admin/system/kartenserien/uploads": "system",
    "PUT /api/admin/system/kartenserien/uploads/:id": "system",
    "POST /api/admin/system/kartenserien/uploads/:id/abschluss": "system",
    "POST /api/admin/system/kartenserien/production": "system",
    "POST /api/admin/system/zoombaender": "system",
    // Das Wettermodell (WI-0288 Stufe 2): eine Einstellung wie die Wegfindung.
    "POST /api/admin/system/wettermodell": "system",
    // WikiSync (WI-0253 D-1): Die Vorschau liest nur (`import`, keine Sperre hält sie an), Übernehmen und Zurücknehmen
    // ändern Kartendaten (`map`: die Kartensperre hält sie an, wie jeden Editor).
    "POST /api/admin/wikisync/vorschau": "import",
    "POST /api/admin/wikisync/uebernehmen": "map",
    "POST /api/admin/wikisync/zuruecknehmen": "map",
    "POST /api/admin/wikisync/artikel": "import",
    // Das Holen des Dumps reiht nur einen Auftrag für Claudios Korridor ein (WI-0253 §22): Es liest das Wiki und legt eine Datei ab, es ändert keine Kartendaten.
    "POST /api/admin/wikisync/dump": "import",
    // Die Kanon-Tafeln (WI-0253 UI-1): eine Einstellung der Umgebung wie die Zoombänder.
    "POST /api/admin/wikisync/tafeln": "system",
    // Die Regelvorschläge und die Begriffstafel (WI-0253 §24): Übernahme und Rücknahme ändern Regeln der Vorkommen (Kartensperre), die Begriffstafel ist eine Einstellung der Umgebung.
    "POST /api/admin/wikisync/regeln/uebernehmen": "map",
    "POST /api/admin/wikisync/regeln/zuruecknehmen": "map",
    // Einer Fläche ohne Wiki-Schlüssel ihren Artikel zuweisen und diese Zuweisung zurücknehmen (§25): ändert die Zuordnung einer Landschaft (Kartensperre).
    "POST /api/admin/wikisync/regeln/flaeche-zuweisen": "map",
    "POST /api/admin/wikisync/regeln/flaeche-zuruecknehmen": "map",
    "POST /api/admin/wikisync/begriffe": "system",
    // Höhenmodell (WI-0127 SYS-13, §9c.7): wählen, abnehmen, Entwürfe `system`; der Rückweg `security` (Frage 4 A).
    "POST /api/admin/system/hoehenmodell/waehlen": "system",
    // Neuigkeiten pflegen (WI-0139): anlegen und aendern, beide `protect("manage_news", { writeClass: "system" })`.
    "POST /api/admin/system/news": "system",
    "POST /api/admin/system/news/:id": "system",
    // Der Discord-Tagesbericht (WI-0255): Routine schalten und Wiederholen, beide `protect("manage_news", { confirm: "passkey", writeClass: "system" })`.
    "POST /api/admin/system/discord/routine": "system",
    "POST /api/admin/system/discord/zustellungen/:id/wiederholen": "system",
    "POST /api/admin/system/discord/einstellungen": "system",
    // Das Panel Mailpostfach (WI-0268 C6c): die Routine von Abruf oder Versand schalten, `protect("manage_system_settings", { confirm: "passkey", writeClass: "system" })`.
    "POST /api/admin/system/mail/routine": "system",
    // Production-Freigabe (FREIGABE-0001, Stufe 1): beide `protect("release_to_production", { writeClass: "system" })`.
    "POST /api/admin/system/production/release": "system",
    "POST /api/admin/system/production/rollback": "system",
    // Eine Nacht-Freigabe abbrechen (WI-0234): dasselbe Recht, ohne Passkey.
    "POST /api/admin/system/production/abbrechen": "system",
    // Der Release-Test auf dem Entwicklungsrechner (WI-0248 L; die Routen gibt es nur mit `config.releaseTest`, also nur lokal): beide
    // `protect("switch_environment", …)`, Starten mit Passkey, Abbrechen ohne.
    "POST /api/admin/system/release-test/starten": "system",
    "POST /api/admin/system/release-test/abbrechen": "system",
    // Der Abzug für lokal (WI-0251; die Routen gibt es nur mit `config.abzug`): Er LIEST die Karte (Erstellen, Link) beziehungsweise legt eine Datei in den
    // Eingang und ersetzt auf Knopfdruck die lokale Datenbank, so wie ein Import: unter keiner Sperre gehalten (`import`).
    "POST /api/admin/system/abzug/erstellen": "import",
    "POST /api/admin/system/abzug/link": "import",
    "PUT /api/admin/system/abzug/eingang": "import",
    "POST /api/admin/system/abzug/einspielen": "import",
    // Den Abzug selbst abholen (WI-0251): Schlüssel anlegen und widerrufen (Stage, Production: ein Schlüssel gewährt Zugriff, die Systemsperre hält das Anlegen an; das Widerrufen ist ein Sicherheitshandgriff und geht immer),
    // lokal einen Schlüssel hinterlegen und holen (Holen ersetzt auf Knopfdruck die lokale Datenbank wie das Einspielen).
    "POST /api/admin/system/abzug/schluessel": "system",
    "POST /api/admin/system/abzug/schluessel/widerrufen": "security",
    "POST /api/admin/system/abzug/quelle": "import",
    "POST /api/admin/system/abzug/holen": "import",
    "POST /api/admin/system/hoehenmodell/zurueck": "security",
    "POST /api/admin/system/hoehenmodell/neu-rechnen": "system",
    "POST /api/admin/system/hoehenmodell/abnehmen": "system",
    "POST /api/admin/system/hoehenmodell/entwurf": "system",
    "POST /api/admin/system/hoehenmodell/entwurf/messen": "system",
    "POST /api/admin/system/hoehenmodell/entwurf/verwerfen": "system",
    // „19 (Test)“ (WI-0240): die Werte setzen, ohne Passkey wie ein Entwurf.
    "POST /api/admin/system/hoehenmodell/test": "system",
};

const config: ServerConfig = {
    port: 0,
    host: "127.0.0.1",
    releaseId: "test",
    databaseUrl: undefined,
    tileRoot: undefined,
    statusPage: true,
    // Die Routen des Release-Tests gibt es nur lokal; für die Aufzählung der Schreibwege gilt die Konfiguration, die sie anmeldet (WI-0248 L).
    releaseTest: { starter: undefined },
    // Beide Rollen des Abzugs, damit die Aufzählung alle Schreibwege sieht; im Betrieb hat jede Instanz genau eine (WI-0251).
    abzug: { rollen: ["erstellen", "einspielen"], quelle: "staging", wurzel: undefined },
};
const SILENT = { write: () => undefined };

async function writeRoutes(): Promise<Map<string, unknown>> {
    const app = buildApp({ config, logStream: SILENT });
    const found = new Map<string, unknown>();
    app.addHook("onRoute", (options) => {
        const methods = Array.isArray(options.method) ? options.method : [options.method];
        for (const method of methods) {
            if (WRITE_METHODS.has(method)) found.set(`${method} ${options.url}`, options.config?.writeClass);
        }
    });
    await app.ready();
    await app.close();
    return found;
}

describe("Klassen-Tafel der Schreibwege", () => {
    it("🔴 jede schreibende Route trägt eine Klasse, und die Tafel nennt jede (keine fällt still durch)", async () => {
        const routes = await writeRoutes();
        expect(routes.size).toBeGreaterThanOrEqual(37);
        const allowed: readonly unknown[] = [...WRITE_CLASSES, "by_direction"];
        const undeclared = [...routes].filter(([, writeClass]) => !allowed.includes(writeClass)).map(([key]) => key);
        expect(undeclared).toEqual([]);
        expect(Object.fromEntries(routes)).toEqual(EXPECTED);
    });

    it("🔴 das Umschalten von Betrieb, Sperren und Warteschlange ist `security`: keine Sperre sperrt sich selbst ein", () => {
        expect(EXPECTED["POST /api/admin/system/mode"]).toBe("security");
        expect(EXPECTED["POST /api/admin/system/lock"]).toBe("security");
        expect(EXPECTED["POST /api/admin/system/queue"]).toBe("security");
    });
});

// --- Der Wächter gegen einen gesteuerten Zustand ---------------------------------------------------------------------------

const SINCE = new Date("2026-10-10T09:00:00.000Z");

function store(state: Partial<SystemStateSnapshot>): SystemStateStore {
    const snapshot: SystemStateSnapshot = {
        source: "database",
        mode: "normal",
        mapLock: false,
        systemLock: false,
        revision: 3,
        contentRevision: 1,
        readAt: new Date(),
        ready: true,
        listen: { connected: true, generation: 1, lastResyncAt: null },
        ...state,
    };
    const setter: SystemSetter = { since: SINCE, by: null, byLabel: "cli:test", reason: "Abnahme mit Grund" };
    const fake = {
        start: async () => undefined,
        close: async () => undefined,
        refresh: async () => snapshot,
        snapshot: () => snapshot,
        lockSetter: () => setter,
        onChange: () => () => undefined,
    };
    return fake as unknown as SystemStateStore;
}

const STATES: Record<string, Partial<SystemStateSnapshot>> = {
    normal: {},
    karte: { mapLock: true },
    system: { systemLock: true },
    beide: { mapLock: true, systemLock: true },
    eingeschraenkt: { mode: "restricted" },
    unbekannt: { source: "unknown", mode: null, mapLock: null, systemLock: null, revision: null, ready: false },
    "vor migrate": { source: "unprovisioned", revision: null },
};

const PROBES: Record<string, RouteWriteClass | undefined> = {
    map: "map",
    system: "system",
    security: "security",
    account: "account",
    public: "public",
    import: "import",
    ohne: undefined,
};

/** Erwartet je Zustand und Probe: Status und Code (`ok` heißt 200). */
const MATRIX: Record<string, Record<string, string>> = {
    normal: { map: "ok", system: "ok", security: "ok", account: "ok", public: "ok", import: "ok", ohne: "ok" },
    karte: {
        map: "423 map_locked",
        system: "ok",
        security: "ok",
        account: "ok",
        public: "ok",
        import: "ok",
        ohne: "423 map_locked",
    },
    system: {
        map: "ok",
        system: "423 system_locked",
        security: "ok",
        account: "ok",
        public: "ok",
        import: "ok",
        ohne: "ok",
    },
    beide: {
        map: "423 map_locked",
        system: "423 system_locked",
        security: "ok",
        account: "ok",
        public: "ok",
        import: "ok",
        ohne: "423 map_locked",
    },
    // Den eingeschränkten Betrieb für HTTP prüft der App-Hook der Tür (SYS-3), nicht diese Naht.
    eingeschraenkt: { map: "ok", system: "ok", security: "ok", account: "ok", public: "ok", import: "ok", ohne: "ok" },
    unbekannt: {
        map: "503 system_state_unknown",
        system: "503 system_state_unknown",
        security: "ok",
        account: "ok",
        public: "ok",
        import: "ok",
        ohne: "503 system_state_unknown",
    },
    "vor migrate": { map: "ok", system: "ok", security: "ok", account: "ok", public: "ok", import: "ok", ohne: "ok" },
};

let app: FastifyInstance | undefined;
afterEach(async () => {
    await app?.close();
    app = undefined;
});

async function probeApp(state: Partial<SystemStateSnapshot>): Promise<FastifyInstance> {
    const instance = buildApp({ config, logStream: SILENT, systemState: store(state) });
    for (const [name, writeClass] of Object.entries(PROBES)) {
        const options = writeClass === undefined ? {} : { config: { writeClass } };
        instance.post(`/probe/${name}`, options, async () => ({ ok: true }));
        instance.delete(`/probe/${name}`, options, async () => ({ ok: true }));
        instance.get(`/probe/${name}`, async () => ({ ok: true }));
    }
    instance.post(
        "/probe/richtung",
        { config: { writeClass: "by_direction" } },
        async (request: FastifyRequest<{ Body: { grants: boolean } }>) => {
            await assertWritable(request, request.body.grants ? "system" : "security");
            return { ok: true };
        },
    );
    await instance.ready();
    return instance;
}

function verdict(response: { statusCode: number; json(): unknown }): string {
    if (response.statusCode === 200) return "ok";
    const body = response.json() as { error: { code: string } };
    return `${String(response.statusCode)} ${body.error.code}`;
}

describe("Der Wächter: jede Klasse gegen jeden Zustand", () => {
    for (const [stateName, state] of Object.entries(STATES)) {
        it(`🔴 ${stateName}`, async () => {
            app = await probeApp(state);
            const seen: Record<string, string> = {};
            for (const name of Object.keys(PROBES)) {
                const post = await app.inject({ method: "POST", url: `/probe/${name}` });
                const remove = await app.inject({ method: "DELETE", url: `/probe/${name}` });
                expect(verdict(remove), `DELETE ${name}`).toBe(verdict(post));
                // Lesen hält keine Sperre und kein unbekannter Zustand an.
                expect((await app.inject({ method: "GET", url: `/probe/${name}` })).statusCode).toBe(200);
                seen[name] = verdict(post);
            }
            expect(seen).toEqual(MATRIX[stateName]);
        });
    }

    it("🔴 423 sagt, seit wann; den Grund nur mit `view_operations`; 503 sagt, wann es wieder geht", async () => {
        app = await probeApp({ mapLock: true, systemLock: true });
        const locked = await app.inject({ method: "POST", url: "/probe/system" });
        expect(locked.statusCode).toBe(423);
        expect(locked.headers["cache-control"]).toBe("no-store");
        // Ohne eingerichtete Anmeldung hat niemand `view_operations`: kein Grund in der Antwort.
        expect(locked.json()).toEqual({
            error: {
                code: "system_locked",
                message: "Das System ist gerade gesperrt: Änderungen an Einstellungen und Verwaltung sind angehalten.",
                details: { since: SINCE.toISOString() },
            },
        });
        await app.close();

        app = await probeApp(STATES["unbekannt"]!);
        const unknown = await app.inject({ method: "POST", url: "/probe/map" });
        expect(unknown.statusCode).toBe(503);
        expect(unknown.headers["retry-after"]).toBe("5");
    });

    it("🔴 mit Richtung entscheidet der Handler: gewähren unter Systemsperre 423, schützen offen", async () => {
        app = await probeApp({ systemLock: true });
        const grant = await app.inject({ method: "POST", url: "/probe/richtung", payload: { grants: true } });
        const protect = await app.inject({ method: "POST", url: "/probe/richtung", payload: { grants: false } });
        expect(verdict(grant)).toBe("423 system_locked");
        expect(verdict(protect)).toBe("ok");
    });

    it("eine unbekannte Adresse bleibt 404, auch unter Sperre", async () => {
        app = await probeApp({ mapLock: true });
        expect((await app.inject({ method: "POST", url: "/gibt-es-nicht" })).statusCode).toBe(404);
    });
});
