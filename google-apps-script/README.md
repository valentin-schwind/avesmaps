# Avesmaps Ortsmeldungen mit Google Apps Script

## Zweck
- Meldungen aus dem Avesmaps-Formular landen als neue Zeile in Google Sheets.
- Die Tabelle dient als Moderations-Queue fuer neue Orte.

## Ziel-Tabelle
- Spreadsheet-ID: `1BCAH1WFP49YqcMYAYK2GEBf_IGmy3KM9hrWqTqMGebo`
- Tabellenblatt: `Ortsmeldungen`

## Spalten
1. `created_at`
2. `status`
3. `name`
4. `size`
5. `lat`
6. `lng`
7. `source`
8. `wiki_url`
9. `comment`
10. `page_url`
11. `client_version`
12. `review_note`

## Deployment
1. Neues Apps-Script-Projekt anlegen.
2. Inhalt aus [location-report-web-app.gs](./location-report-web-app.gs) einfuegen.
3. `Deploy -> New deployment -> Web app`.
4. Ausfuehren als: `Me`.
5. Zugriff: `Anyone`.
6. Deployen und die `/exec`-URL kopieren.
7. Nach spaeteren Skript-Aenderungen immer `Manage deployments -> Edit -> New version` veroeffentlichen.

## Avesmaps verbinden
- In [index.html](../index.html) die Konstante `LOCATION_REPORT_FORM_ENDPOINT_URL` mit der Web-App-URL fuellen.
- Danach deployen.
- Das Formular uebergibt automatisch eine Ruecksprung-URL an `location-report-result.html`, damit die Erfolgsmeldung zu Avesmaps zurueckkommt.

## Moderation
- Neue Meldungen kommen mit `status = neu`.
- Spaeter koennen `angenommen` und `abgelehnt` fuer Import-Skripte genutzt werden.
