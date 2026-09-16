# Fall #130: Audit-Aggregationen – Review und Bauplan

Stand: 16.09.2026. Quellstand: `52d80a76d24dd316833fc027fb2a3f1dd4ec2d68`.
Anlass: Discord-Fall #130 von Valentin, „Audit-Aggregationen“.

## Umsetzung des ersten Ausbaus

Der Wege-Pilot verwendet bewusst **einen atomaren Sammelbeleg** statt einer neuen Tabelle: Dieser Schreibweg ist schon ein einzelner begrenzter Request mit einer Transaktion. Versionierte Mitglieder in Vorher/Nachher enthalten alle tatsächlich geänderten Abschnitte, aber keine unveränderten Geometriekopien. Dadurch zählen bestehender Personenfilter und Aufräumer einen Vorgang, und kein Aufräumen kann einzelne Mitglieder entfernen. Die unten beschriebene Operationstabelle bleibt ein Entwurf für mehrstufige und domänenübergreifende Aufträge; sie ist nicht Bestandteil dieses Piloten.

Umgesetzt: Wegegruppe speichern, gemeinsam rückgängig machen, einmal gemeinsam wiederherstellen; gleiche Detailspalten-Konfliktprüfung wie beim Einzelweg, Bearbeitungssperren, feste Sperrreihenfolge und gemeinsame Revision. Die Antwort nennt entfernte Eigenschaften ausdrücklich. Der Client übernimmt erst alle Abschnitte und aktualisiert anschließend Darstellungen und Planer; kein alter JSON-Schlüssel bleibt lokal stehen.

Speichergrenzen des Piloten: höchstens 250 Mitglieder und 512 KiB für das gesamte Vorher/Nachher-Paar. Zusätzlich maximal 8 MiB Gruppenbelege je Person und 32 MiB global; Einzelbelege der anderen Aktionen behalten ihre bisherigen Grenzen. Die Bytequoten entfernen die ältesten **ganzen** Gruppen. Deshalb können weniger als 200 Vorgänge erhalten bleiben; die Grenze ist ein Maximum, keine Aufbewahrungsgarantie. Die Quoten werden einmal pro Gruppenbeleg geprüft und übertragen nur IDs und Bytezahlen. Der Listenabruf entfernt `members` bereits in SQL aus beiden JSON-Feldern.

Lokal geprüft: vollständige Schreib-/Undo-/Redo-Abläufe mit 1, 27 und 250 Mitgliedern, Konflikt/Sperre am letzten Mitglied, beschädigte Belege, Größenüberschreitung, Rollback beim letzten Update, verschiedene Akteure, Personen-/Globalquota sowie entfernte Eigenschaften und genau eine Planeraktualisierung. Zusätzlich echter MySQL 8.0: 250er-Speicherung rund 175 ms, Undo rund 287 ms, Listenantwort rund 499 Bytes an der kleinen Fixture; eine fremde InnoDB-Zeilensperre führt zum vollständigen Rollback. Das sind lokale Messungen, keine STRATO-Leistungszusagen.

Browserprüfung an einer eigenen lokalen MySQL-Fixture mit Original-Verlaufsdarstellung und Original-Rücknahmefunktionen: Gruppe speichern, Verlauf aufklappen, 27 Abschnitte gemeinsam zurücknehmen und wiederherstellen. Die Fixture ersetzt die Produktionsanmeldung und Teile der Kartenumgebung; sie ist kein vollständiger Live-Abnahmelauf. Im Workflow-Testfeld unter Linux/LF blieb bei 402 PHP- und 515 JS-Dateien nur der bereits bekannte externe DNS-Test rot; Windows/Bash-Pfadfehler entfielen unter Linux.

Abnahmepunkte aus dem Entwurf: Gruppenvollständigkeit, Grenzen, Konflikte, feste Sperren, Transaktion, Redo, Akteurszuordnung und schlanker Listenabruf sind für den Piloten umgesetzt und geprüft. Große Importe, Landschaftshärtung, gemeinsame Operationstabelle, neue Detail-Nachladeendpunkte und domänenübergreifende Rücknahmen sind ausdrücklich spätere Ausbaustufen. Strg-Z bleibt unverändert. Die Oberfläche verwendet das bestehende Raster; die Wiederherstellung heißt ausdrücklich „Wegegruppe wiederhergestellt“.

Auslieferungsprüfung: Der Pilot wurde isoliert auf `801493bd2` übernommen. Dort wurden alle 446 PHP- und 635 JavaScript-Testdateien unter Linux mit LF ausgeführt; einzig der bekannte externe DNS-Test blieb rot. Ein inzwischen ergänzter Clienttest musste seinen Funktionsausschnitt unabhängig von der erweiterten Parameterliste finden; seine fachlichen Assertions bleiben unverändert. Auch auf diesem Stand bestanden die echten MySQL-Abläufe mit 1/27/250 Mitgliedern und dem gesperrten letzten Abschnitt. Hell-/Dunkelansicht, Wiederherstellung und Kartensprung aus dem Sammelbeleg wurden in der lokalen Browser-Fixture geprüft.

## Zweiter Ausbau: Saisonweitergabe

Die Saisonweitergabe aus dem Abschnittsdialog nutzt denselben vollständigen Sammelbeleg wie der Wege-Pilot. Ausgangsabschnitt und tatsächlich geänderte Wiki-Geschwister werden zusammen erfasst; gleichzeitig gespeicherte Abschnittsdetails gehören ausdrücklich zur Rücknahme. Die Darstellung nennt deshalb „Abschnittsdetails, Saisonfenster“. Ohne veränderte Geschwister bleibt der bestehende Einzelbeleg erhalten. Historische Belege werden nicht nachträglich gruppiert.

Die Kandidaten werden vor der Transaktion gelesen, anschließend werden Ausgangsabschnitt und aktive Geschwister einzeln nach aufsteigender interner ID gesperrt. Der JSON-Scan selbst sperrt keine Kartenzeilen und erzeugt keinen alten Lesesnapshot innerhalb der Transaktion. Eine inzwischen geänderte Zuordnung bricht ab. Maximal 250 Abschnitte werden zugelassen; auch eine reine Detailänderung an einem größeren Wiki-Verbund wird abgelehnt, weil dieser Schreibweg die Saisonweitergabe bisher bei jedem Speichern ausführt. Die Snapshot- und Aufbewahrungsgrenzen des Piloten gelten unverändert. Jede tatsächlich geschriebene Geschwisteränderung prüft jetzt auch die Bearbeitungssperre.

Abnahme: 1/27/250 Abschnitte, eigener Ausgangsabschnitt am Ende der ID-Reihenfolge, unterschiedliche Verkehrsmittel, Entfernen und Wiederherstellen der Fenster, unveränderte Geschwister, fehlende Wiki-Zuordnung, Grenze 251, fremde Sperre und Fehler am letzten Update, späterer Konflikt beim Undo. Gleichzeitige Namensänderungen am Ausgangsabschnitt müssen mit zurückgenommen werden. Der gesamte Vorgang bleibt in einer Transaktion; Strg-Z und die Reichweite über `wiki_path.wiki_key` bleiben unverändert.

Prüfergebnis des zweiten Ausbaus: Die MySQL-8-Abläufe mit 1/27/250 Abschnitten bestehen (250er-Speichern lokal rund 208 ms, Listenantwort 534 Bytes). Eine unbeteiligte Kartenzeile bleibt während der Gruppensperren aus einer zweiten Verbindung schreibbar. Ein separater Prozess hielt den letzten Abschnitt gesperrt und setzte vor Freigabe eine fremde Editorsperre: Der wartende Speichervorgang erkannte sie und brach ohne Änderungen oder Auditbeleg ab.

Der vollständige Linux-/LF-Lauf umfasst nun 447 PHP- und 635 JavaScript-Dateien; nur der bekannte externe DNS-Test blieb lokal rot. Die lokale Browser-Fixture mit Original-Verlaufs- und Rücknahmefunktionen zeigte nach Speichern 27 Saisonfenster, nach Undo null und nach Redo wieder 27; die gleichzeitig geänderten Abschnittsdetails wurden mit zurückgenommen. Helle und dunkle Darstellung wurden geprüft. Wie beim Piloten ersetzt diese Fixture Anmeldung und Teile der Kartenumgebung.

## Dritter Ausbau: Kraftlinien

Linienweite Details und Umordnungen schreiben jeweils einen atomaren Sammelbeleg. Name, Darstellung, Beschreibung und segmentweise Kurvenwerte sind gemeinsam rücknehmbar. Beim Umordnen enthält der Beleg zusätzlich alte und neue Abschnitte, Geometrien, Aktivzustände, die vollständigen Quellenverknüpfungen und die beteiligten Nodix-Punkte. Neu angelegte Abschnitte werden beim Undo deaktiviert und beim einmaligen Redo wiederhergestellt.

Alle Objekte werden in fester Reihenfolge gesperrt, bevor Editorsperren gelesen werden. Der Quellenanker wird ausschließlich aus erfassten aktiven Mitgliedern bestimmt. Veränderte Quellen, verschobene oder nicht mehr geeignete Nodix-Punkte, spätere Abschnittsänderungen und fremde Sperren verhindern die ganze Rücknahme. Quellenkatalog und sonstige Quellenmetadaten werden nicht überschrieben. Der Client übernimmt alle Abschnitte, Quellenhinweise und Kanonkennzeichnungen vor einer gemeinsamen Aktualisierung.

Grenzen: höchstens 250 erfasste Abschnitte einschließlich neu angelegter und entfallener Abschnitte, 512 KiB Vorher/Nachher, 2.500 Quellenverknüpfungen. Wege und Kraftlinien teilen sich die bisherigen Bytequoten. Der Listenabruf entfernt Mitglieder, Quellen und Abhängigkeiten bereits in SQL. Bestehende Einzelbelege und Strg-Z bleiben unverändert.

Abnahme: Details mit 1/27/250 Mitgliedern einschließlich Kurvenwert und Namensverschmelzung; Umordnung mit Entfall, Neuanlage, Quellenwanderung und eigenen Quellen am Zielanker; Undo/Redo, spätere Quellenänderung, verschobener Nodix, verlorene Nodix-Eignung, Editorsperre und Grenze 251. Echte MySQL-8-Parallelprobe: unbeteiligte Zeile bleibt schreibbar; während des Wartens hinzugekommene Editorsperre wird erkannt und verhindert jeden Write. Die separate lokale MySQL-Fixture verwendet den Produktionsstandard `is_active = 1`; eine zusätzliche Assertion prüft die Zahl aktiver Abschnitte.

Die Browser-Fixture führt die originale Verlaufsdarstellung, Rücknahme, Quellenübernahme und Datenvorbereitung aus; Anmeldung und Kartenrenderer sind vereinfacht. Umordnung speichern, Verlauf aufklappen, gemeinsam zurücknehmen und wiederherstellen wurden mit Quellenanker und Verbindungen geprüft, einschließlich heller und dunkler Darstellung. Das vollständige Workflow-Muster umfasst 448 PHP- und 636 JS-Tests; lokal bleibt allein der bekannte externe DNS-Test rot. Die Prüfagenten fanden nach den Korrekturen keine blockierenden Befunde.

Weiter offen sind die unten inventarisierten Wiki-Schreibwege, Landschaftshärtung und domänenübergreifenden Importoperationen. Der Kraftlinienausbau schließt diese Punkte nicht mit ab.

## Vierter Ausbau: Wiki-Wegezuordnung

`assign`, `assign_to` und `clear_assign` planen zunächst ihre bisherigen Zielmengen und schreiben anschließend in einer gemeinsamen Transaktion. Die unterschiedlichen Auswahlregeln bleiben erhalten: Namen vereinheitlichen und Lösen erfassen Namensschlüssel oder Wiki-Zuordnung; Zuweisen an ein Ziel verwendet dessen Namensschlüssel; explizite Kennungen und Einzelabschnitt bleiben begrenzt. Eine unvollständige explizite Gruppe wird jetzt abgelehnt statt teilweise gespeichert.

Der Commithelfer sperrt alle Kandidaten nach interner ID, prüft gelesene Revision, Typ, Namen und Eigenschaften, serialisiert die Schreibphase über die Kartenrevision und prüft danach die Editorsperren. Erst diese Reihenfolge eröffnet eine aktuelle InnoDB-Lesesicht für die erneute Prüfung generischer Namen. Ein konkurrierender Vorgang, der denselben neuen Namen vergeben hat, führt zur vollständigen Ablehnung. Maximal 250 Kandidaten; bestehende 512-KiB- und Aufbewahrungsgrenzen. Unveränderte Zuweisungen erzeugen weder Revision noch Beleg; die bisherigen Antwortzählungen bleiben kompatibel. Alle Properties einschließlich weiterer Artikel, Anzeigeentscheidung und Verlauf-Provenienz reisen im Beleg mit.

Undo/Redo liefern zusätzlich einen Kanonnachtrag für die alten und neuen Namensnachbarn, maximal 1.000 aktive Abschnitte und 2.500 Quellenverknüpfungen. Bestehende reine Rechner bestimmen die Namensraum-Erbschaft und den Kanon. `reference_kind` bleibt erhalten: Publikationen allein erzeugen kein Etikett. Der Client übernimmt den Nachtrag vor den Popups und erneuert auch das zwischengespeicherte Popup unveränderter Nachbarn. Quellenzuordnungen werden nicht verändert. Die bisherigen separaten Zuweisungsoberflächen werden in diesem Schritt nicht umgebaut.

Die MySQL-Probe verwendet nun echte JSON-Spalten für Feature- und Auditdaten. Damit wurden zusätzlich zwei bestehende Fehler sichtbar und korrigiert: Der Wiki-Key-Vorfilter darf keine kompakte JSON-Schreibweise voraussetzen; die Bytequota darf große JSON-Werte nicht durch einen SQL-Filesort materialisieren. Sie liest stattdessen die begrenzte ID-/Byte-Liste und sortiert diese in PHP. Die No-op-Prüfung normalisiert Objektschlüssel, ohne Listenreihenfolge oder Skalartypen gleichzusetzen; maximale Verschachtelungstiefe 64.

Abnahme: 1/27/250 Mitglieder, 251 abgelehnt, unvollständige explizite Gruppe, gemischter Fluss-/Landwegtyp, Wiki-Zuordnung unter altem Namen, unveränderte Zuweisung ohne neue Revision, vollständiges Undo/Redo, Fehler am letzten Write, veraltete Planung, fremde Editorsperre, Namenskollision und späterer Undo-Konflikt. MySQL-Zweiverbindungsproben bestätigen freie unbeteiligte Zeilen, während des Wartens gesetzte Editorsperren und die Ablehnung einer zweiten konkurrierenden Vergabe von `Weg-1`. Kanontests decken unveränderte Nachbarn, eigene inoffizielle Quellen und reine Publikationsbelege ab. Der Clienttest prüft genau eine Planeraktualisierung und einmalige Popup-Erneuerung der Nachbarn.

Der vollständige Workflow-Testlauf unter Linux/LF umfasst 449 PHP- und 636 JavaScript-Dateien; lokal bleibt nur der bekannte externe DNS-Test rot. Die Prüfagenten haben die Änderungen nach Korrektur ihrer Befunde freigegeben. Die lokale Browser-Fixture verwendet originale Verlaufsdarstellung, Gruppenrücknahme, Datenvorbereitung und Kanon-Nachtrag; Anmeldung und Kartenrenderer sind vereinfacht. Zuweisung, Aufklappen, Undo und Redo stellten Namen und weitere Artikel sichtbar wieder her; auch Lösen und Rücknahme wurden in heller und dunkler Ansicht geprüft.

Weiter offen: `assign_all` (bisher ohne Auditbelege und ohne Akteursparameter), gesamte Wegverlauf-Sync-Aufträge mit ihren zusätzlichen Restamping-/Flussrichtungsschritten, Wiki-Regionen/Siedlungen, Landschaftshärtung und domänenübergreifende Importe. Einzelne durch den Verlauf-Sync gerufene Zuweisungen sind rücknehmbar; dies ist keine Zusage einer gemeinsamen Rücknahme des vollständigen Sync-Laufs.

## Fünfter Ausbau: Wiki-Wege-Massenlauf

`assign_all` erhält den angemeldeten Akteur und verwendet denselben geschützten Schreibweg in Paketen mit höchstens 250 Kandidaten. Jeder tatsächlich veränderte Teil wird als „Wiki-Massenlauf: Teilpaket zugewiesen“ protokolliert und lässt sich einzeln zurücknehmen und wiederherstellen. Namensabgleich, Kontinentfilter, weitere Artikel und Anzeigeentscheidung bleiben erhalten; der Massenlauf benennt weiterhin nicht um. Vorschau und `applied` zählen wie bisher passende beziehungsweise abgeschlossene Kandidaten einschließlich unveränderter Zuordnungen. Ein unverändertes Paket erzeugt weder Beleg noch neue Revision. Der Endpunkt hebt die Revision der vier bereits selbst transaktionalen Zuweiser nicht mehr ein zweites Mal an.

Ein Massenlauf ist ausdrücklich **nicht insgesamt atomar**. Bei einem Paketfehler bricht er mit HTTP 409, `ok: false`, `complete: false`, Teilfortschritt und einer verständlichen Meldung ab. Frühere Pakete bleiben gespeichert, das fehlerhafte Paket rollt vollständig zurück; spätere Pakete laufen nicht mehr. Eine Wiederholung gleicht den aktuellen Zustand erneut ab und erzeugt für unveränderte Pakete keine doppelten Belege. Der frühere Massenlaufknopf bleibt entfernt; dieser Ausbau reaktiviert keine Oberfläche.

Die Kanon-/Nachbarschaftsgrenzen der Rücknahme werden schon innerhalb des Schreibpakets geprüft. Nach dem Audit-Aufräumen prüft dieselbe Transaktion außerdem, ob alle Belege dieses Requests noch vorhanden sind. Würde ein Paket frühere eigene Belege verdrängen, rollt es einschließlich Aufräumen zurück. Dadurch kann sich ein großer Lauf nicht selbst seine Rücknahme entziehen. Die normale spätere Aufbewahrung durch andere Vorgänge bleibt begrenzt; dies ist keine dauerhafte Aufbewahrungsgarantie. Ein Prozessabbruch kann bereits abgeschlossene Pakete hinterlassen; ihre Belege bleiben die maßgebliche Fortschrittsinformation.

Abnahme: Vorschau, Akteurszuordnung, 1/250/501 Kandidaten, paketweises Undo/Redo, No-op ohne Revision, Wiederholung nach Sperre im zweiten Paket, vollständiger Rollback bei Fehler am letzten Write, Ablehnung nicht rücknehmbarer Namensgruppen und Aufbewahrungsgrenze mit 6.000 Abschnitten in 24 schweren Namensgruppen. Der Linux-/LF-Lauf umfasst 450 PHP- und 636 JavaScript-Dateien; lokal bleibt nur der bekannte externe DNS-Test rot. Die Prüfagenten haben nach Korrektur der Selbstverdrängung keine blockierenden Befunde mehr. Dieselben Massenlauf-Abläufe einschließlich der 6.000er-Aufbewahrungsprobe bestehen mit echtem MySQL 8 und JSON-Spalten in der isolierten lokalen Datenbank.

Der Listenabruf sortiert zuerst nur die jüngsten 200 IDs mit unverändertem Personenfilter und lädt danach deren verkleinerte Belege ohne SQL-Sortierung. Die begrenzte Reihenfolge wird in PHP wiederhergestellt. Eine MySQL-Bedienprobe mit mehreren großen JSON-Belegen hatte vorher Fehler 1038 (Sortierspeicher) ausgelöst; dieselben Belege laden damit wieder. In der lokalen Browser-Fixture wurden 251 Abschnitte als zwei Pakete gespeichert, das 250er-Paket zurückgenommen und wiederhergestellt und danach der einzelne Abschnitt unabhängig zurückgenommen. Der Verlauf wurde in heller und dunkler Ansicht geprüft; Anmeldung und Kartenumgebung bleiben wie in den vorherigen Proben vereinfacht. Tests sichern Zeit-/ID-Reihenfolge, Personenfilter und die 200er-Grenze.

Weiter offen bleiben vollständige Wegverlauf-Sync-Aufträge, Wiki-Regionen/Siedlungen, Landschaftshärtung und domänenübergreifende Importe. Dieser Ausbau schließt diese eigenständigen Schreibwege nicht mit ab.

## Sechster Ausbau: Ortszuweisung zu Herrschaftsgebieten

`bulk_assign_territories` schreibt pro bestehendem 200er-Paket einen atomaren Sammelbeleg mit angemeldetem Akteur. Die Planung wird unter Objektsperren gegen Revision und Eigenschaften geprüft; fehlende oder doppelte Ziele, fremde Editorsperren und ein Fehler beim letzten Write verhindern sämtliche Änderungen dieses Pakets. Manuelle Zuordnungen bleiben ohne ausdrückliches Überschreiben geschützt. Unveränderte Pakete erzeugen weder Revision noch Beleg. Die bisherigen Bytequoten und die spätere begrenzte Aufbewahrung gelten weiter.

Undo und Redo stellen die Eigenschaften gemeinsam wieder her. Später geänderte Namen und Koordinaten bleiben erhalten; spätere Änderungen der Eigenschaften verhindern die Rücknahme. Der Client lädt die politische Hierarchie über einen gemeinsamen Karten-Deltaabruf nach, übernimmt alle Zuordnungen vor der Popup-Aktualisierung und erneuert das offene Infopanel einmal. Fehlende Mitglieder, ein Abruffehler oder inzwischen höhere Ortsrevisionen führen zu einer verständlichen Neulademeldung, ohne lokale Teilaktualisierung oder vorgezogenen Revisionstoken. Der Aktionsname bleibt einschließlich zweier Undo-Präfixe innerhalb der 40-Zeichen-Spaltengrenze; der Test prüft auch den gespeicherten Redo-Namen.

Mehrere Pakete sind kein gemeinsamer atomarer Auftrag. Bei HTTP- oder Netzfehlern endet der Lauf; die Meldung nennt die bereits abgeschlossenen Zuordnungen und verweist für den möglicherweise gespeicherten letzten Teil auf den Verlauf. Die Antwortzählung umfasst wie bisher auch unveränderte Kandidaten. Weitere erfolgreiche Requests können ältere Belege entsprechend der normalen Aufbewahrung verdrängen.

Abnahme: 1/27/200 Orte, 201 Kandidaten mit Rest, Vorschau, No-op, manuelle Zuordnung und ausdrückliches Überschreiben, fehlende/doppelte/ungültige Ziele, veraltete Planung, letzte Schreiboperation mit Fehler, Sperre und spätere Änderungen. Echte MySQL-8-Tests mit JSON-Spalten bestehen; ein konkurrierender Prozess kann einen unbeteiligten Ort bearbeiten, während eine beim Warten neu gesetzte Sperre am letzten Ziel das ganze Paket verhindert. JavaScript-Tests prüfen Delta-Vollständigkeit, Revisionen, Infopanel-Aktualisierung und Abbruch nach teilweise erfolgreichem Massenlauf.

Die lokale Browserprobe speicherte 27 Ortszuweisungen, klappte den originalen Verlauf auf und nahm das Paket zurück beziehungsweise stellte es wieder her. Das offen gebliebene originale Infopanel wechselte dabei unmittelbar zwischen altem und neuem Herrschaftsgebiet. Helle und dunkle Darstellung wurden geprüft. Anmeldung, Kartenrahmen und Endpunktrouting der Fixture sind vereinfacht; die politische Hierarchie berechnet der originale Resolver. Es wurden keine Produktionszuordnungen geändert. Das vollständige Linux-/LF-Testfeld umfasst 451 PHP- und 638 JavaScript-Dateien; lokal bleibt der bekannte externe DNS-Test rot.

Offen bleiben andere Wiki-Siedlungsschreiber (Verknüpfen, Ruinen, Wappen), Wiki-Regionen, vollständige Wegverlauf-Sync-Aufträge, Landschaftshärtung und domänenübergreifende Importe. Dieser Schritt stellt keine gemeinsame Rücknahme dieser anderen Vorgänge bereit.

## Siebter Ausbau: Wiki-Ruinenstatus

`bulk_record_ruins` übernimmt den Karten-Ruinenstatus in atomaren Paketen mit höchstens 200 Orten und einem Sammelbeleg je Paket. Akteur, feste Sperrreihenfolge, Planungsprüfung, Editorsperren, Bytequoten und Properties-Rücknahme verwenden den gemeinsamen Orts-Schreibweg. Bereits markierte Orte, inaktive Kartenobjekte und nicht passende Wiki-Verknüpfungen bleiben unberührt. Vorschau und unveränderter Folgelauf schreiben weder Revision noch Beleg. Die bestehende additive Bedeutung bleibt erhalten: Der Abgleich entfernt keine Ruinenmarkierungen.

Ein Fehler im zweiten oder späteren Paket liefert HTTP 409 mit Teilfortschritt. Frühere vollständige Pakete bleiben gespeichert und rücknehmbar, das fehlerhafte Paket wird vollständig zurückgerollt; spätere werden nicht gestartet. Wiederholung verarbeitet die noch unmarkierten Orte. Die Aufbewahrungsprüfung innerhalb derselben Transaktion verhindert, dass dieser Request seine ersten eigenen Belege verdrängt. Normale spätere Aufbewahrung bleibt begrenzt. Ein Verbindungs- oder Prozessabbruch kann abgeschlossene Pakete hinterlassen; maßgeblich ist dann der Verlauf.

Undo/Redo ändern weiterhin nur die gespeicherten Eigenschaften. Der Karten-Deltaabruf aktualisiert `isRuined` vor allen Popups, erneuert die Namensbeschriftungen einmal und zieht das offene Infopanel nach. Der bestehende Wiki-Hinweis auf eine Ruine bleibt unabhängig davon bestehen: Rücknahme entfernt die übernommene Kartenmarkierung, nicht den Wiki-Befund. Es gibt keinen neuen globalen Rücknahmeknopf und keinen neuen Übernahmeknopf.

Prüfungen: 1/27/200/401 Orte, Vorschau, unveränderter Folgelauf, ausgeschlossene und bereits markierte Orte, Sperre im zweiten Paket mit Wiederholung, Fehler beim letzten Write, späterer Eigenschaften-Konflikt beim Undo und Selbstverdrängungsschutz mit 5.000 Orten. Diese Abläufe bestehen mit SQLite und echtem MySQL 8 mit JSON-Spalten. Eine Zweiprozessprobe bestätigt freie unbeteiligte Kartenzeilen sowie das vollständige Zurückrollen bei einer während des Wartens hinzugekommenen Editorsperre. Der JS-Test prüft beide Statusrichtungen sowie die Reihenfolge Daten → Popups → Namensbeschriftungen → Infopanel. Das vollständige Linux-/LF-Testfeld umfasst 452 PHP- und 639 JavaScript-Dateien; lokal bleibt allein der bekannte DNS-Test rot.

Die lokale Bedienprobe verwendet originalen Verlauf, Gruppenrücknahme, Infopanel und Namenslabel-Renderer. Anmeldung, Kartenausschnitt und Datenprojektion sind vereinfacht; Produktionseinträge wurden nicht verändert. Speichern, Aufklappen, Rücknahme und Wiederherstellen wurden an 27 Testorten geprüft, einschließlich der Kursivdarstellung in heller und dunkler Ansicht.

Offen bleiben Wiki-Verknüpfungen, Wappen einschließlich ihrer nachgelagerten Lokalisierung, Wiki-Regionen, vollständige Wegverlauf-Sync-Aufträge, Landschaftshärtung und domänenübergreifende Importe. Die Wappenlokalisierung schreibt nach dem Download erneut Orts-Eigenschaften; sie muss mit der Übernahme zusammen untersucht werden, sonst wäre deren Rücknahme direkt nach dem erfolgreichen Bedienablauf durch einen Folgekonflikt blockiert.

## Achter Ausbau: Wiki-Ortsverknüpfungen

`bulk_connect` schreibt bis zu 200 Orte je Anfrage als einen vollständigen Sammelbeleg. Die bestehende Titelauswahl bleibt erhalten; Kreuzungen, mehrdeutige Treffer und bereits zugewiesene Orte werden nicht neu verknüpft. Artikelabrufe erfolgen vor der Schreibtransaktion in Paketen zu höchstens 50 Titeln. Fehlt ein benötigter Artikel, wird das ganze geplante Paket abgewiesen. Der authentifizierte Akteur wird am Beleg geführt.

Wiki-Verknüpfung und bisherige eigene Beschreibung werden gemeinsam zurückgenommen und wiederhergestellt. Spätere Änderungen an Ortsdetails oder fremde Sperren verhindern jede Teilrücknahme; spätere Namen und Geometrien bleiben erhalten. Die Schreibseite prüft zusätzlich den ursprünglich zur Titelauswahl verwendeten Namen und Untertyp. Ein optionaler Wiki-Lesevorrat wird erst nach erfolgreichem Commit erneuert und bleibt unabhängig von der Rücknahme bestehen.

Die offene Infobox übernimmt Artikel, Beschreibung, Wiki-Adresse und angereichertes Wappen aus einem gemeinsamen Deltaabruf. **Dieser Deltaabruf enthält absichtlich keinen Kanon.** Deshalb liefert die Rücknahme eine ausdrückliche Kanonantwort für sämtliche betroffenen Kennungen; fehlende Mitglieder werden vor jeder Clientänderung abgewiesen. Der begrenzte Leser verwendet die bestehende zentrale Kanonableitung. Seine Grenze von 2.500 Quellenverweisen wird auch beim ursprünglichen Schreiben geprüft, damit kein sofort unrücknehmbares Paket entsteht.

Verifiziert: 1/27/200 Orte, 201 Orte in zwei getrennten Anfragen, Vorschau/No-op, fehlende Artikel und Netzfehler, Änderung während des Abrufs, Sperren, Rollback am letzten Ort, Snapshot- und Quellengrenze, Undo/Redo einschließlich ursprünglicher Beschreibung und Kanon. SQLite sowie echte MySQL-Transaktionen bestanden; zwei MySQL-Prozesse prüften eine während des Wartens hinzugekommene Sperre und die weiterhin bearbeitbare unbeteiligte Zeile. Im Browser auf lokaler MySQL-Fixture: 27 Orte speichern, Originalverlauf öffnen/aufklappen, Original-Infopanel öffnen, gemeinsam zurücknehmen und wiederherstellen; Beschreibung, Wiki-Link und Kanon wechseln ohne Neuladen in Hell/Dunkel. Die Fixture verwendet eine vereinfachte Ortsdarstellung mit originalen Kanon-, Verlauf- und Infopanel-Funktionen. Das gesamte Workflow-Muster umfasst 453 PHP- und 640 JS-Dateien; lokal bleibt allein der bekannte DNS-abhängige Linkcheck rot. Beide Prüfagenten gaben den abschließenden Diff frei.

Die vorhandene API-Aktion wird abgesichert; ein stillgelegter Massenknopf wird nicht wieder eingeführt. Ein mehrteiliger Lauf bleibt ausdrücklich mehrere begrenzte Vorgänge, keine unbegrenzte Gesamtoperation oder Aufbewahrungszusage. Wappen-Massenabgleich, weitere Wiki-/Importaktionen und das domänenübergreifende Zielmodell bleiben offen. **Fall #130 ist insgesamt noch nicht abgeschlossen.**

## Ergebnis

Sammel-Undos sind machbar. Der erste geeignete Anwendungsfall ist die Bearbeitung einer Wegegruppe. Eine reine Zusammenfassung der Anzeige reicht nicht: Gruppenzugehörigkeit, Vollständigkeit, Konfliktprüfung und Aufbewahrung müssen gemeinsam umgesetzt werden. Die Einzeländerungen bleiben als Belege erhalten; eine Operation verbindet sie.

Es gibt bereits zwei Vorbilder: Landschaften gruppieren Audit-Zeilen über `operation_id`; politische Geometrieoperationen speichern mehrere Objekte in einem Audit-Eintrag. Beide decken jeweils nur ihren Bereich ab. Die Landschaftslösung sollte wegen ihrer unten genannten Schutzlücken nicht unverändert auf alle Bereiche übertragen werden.

Die folgende Bestandsaufnahme entstand durch statische Codeprüfung und Abruf des Falls. Dabei wurden keine Produktionsdaten verändert und keine produktiven Rücknahmen, Datenbankgrößen oder Laufzeiten geprüft. Die anschließend ausgeführten lokalen Prüfungen des Piloten stehen oben. Die nachstehende Inventur unterscheidet direkt geeignete Schreibwege von Erweiterungskandidaten. Eine vollständige Aussage über sämtliche Nebenwirkungen aller Import- und Sync-Zweige erfordert deren gesonderte Prüfung vor der jeweiligen Umsetzung.

## Bestehende Architektur und Befunde

### Karte

- `api/_internal/map/features.php:2824`, `avesmapsUpdatePathGroupDetails`: bis zu **250 Abschnitte**, eine Transaktion, eine gemeinsame Kartenrevision, aber je geschriebenem Abschnitt ein `update_path_details`-Audit. `via_path_group` nennt nur die Anzahl und ist keine eindeutige Vorgangskennung.
- `features.php:509`, `avesmapsUndoAuditChange`: sperrt Audit und Objekt, prüft Bearbeitbarkeit, vergleicht die betroffenen Spalten mit dem Nachher-Zustand und schreibt einen Gegenbeleg. Die Funktion besitzt selbst die Transaktion und kann daher nicht einfach innerhalb einer äußeren Sammeltransaktion aufgerufen werden.
- Der Konfliktvergleich arbeitet auf Spaltenebene. Bei `properties_json` führt auch eine inzwischen geänderte andere Eigenschaft derselben JSON-Spalte zur Ablehnung. Das ist konservativ, aber sicherer als das Überschreiben fremder Änderungen. Eine spätere feinere Feldprüfung wäre ein eigener Umbau.
- Die Karte unterstützt einmaliges Wiederherstellen durch Rücknahme eines `undo_`-Eintrags; `undo_undo_` ist nicht erneut rücknehmbar. Diese bestehende Grenze muss auch bei Gruppen ausdrücklich gelten.
- **Zwei zentrale Kartenschreiber**: `avesmapsWriteMapAuditLog` und `avesmapsWikiSyncWriteMapAuditLog` in `api/_internal/wiki/locations-helpers.php:210`. Beide müssen dieselbe Operationszuordnung und Aufräumpolitik erhalten. Zusätzlich gibt es direkte Audit-INSERTs, etwa für Meldungen; ein Umbau nur des ersten Schreibers ist unvollständig.

### Landschaften

- `api/_internal/app/ecosystem.php:1975`: übernimmt eine vom Client gelieferte Kennung und Beschriftung für den Aufruf. `js/map-features/map-features-ecosystem-region-store.js:54` verbindet mehrere Requests einer Geste.
- `ecosystem.php:5045`: liest Audit-Zeilen und gruppiert sie anschließend. Damit ist die Begrenzung der gelesenen Zeilen noch keine Begrenzung auf vollständige Operationen.
- `ecosystem.php:5342`: lädt eine Operation und nimmt ihre Zeilen in umgekehrter Reihenfolge innerhalb einer Transaktion zurück.
- **Konfliktschutz fehlt hier gegenüber der Kartenlösung:** `avesmapsEcosystemRestoreAuditRow` schreibt alte Werte zurück, ohne zuvor für die betroffenen Objekte den aktuellen Stand gegen `after_json` zu prüfen. Die vorgelagerte Prüfung betrifft nur Rücknahmestatus und unterstützte Aktionsarten. Spätere Änderungen können dadurch überschrieben werden.
- Die Gruppenauswahl erfolgt nur über `operation_id`, ohne zusätzliche Bindung an den ursprünglichen Akteur. UUID-Syntaxprüfung ersetzt keine serverseitige Zuordnung zu Konto, Operationstyp und Abschlusszustand.
- Eine gemeinsame Kennung macht mehrere ursprüngliche Requests nicht atomar. Ein abgebrochener Vorgang kann bereits gespeicherte Teiländerungen hinterlassen. Ein Gruppenkopf muss das sichtbar unterscheiden.

### Herrschaftsgebiete

- `api/_internal/political/territories-audit.php:361`: eine Rücknahme kann mehrere Geometrien und Territorien aus einem Snapshot wiederherstellen; aktuelle Snapshots werden verglichen, Änderungen erfolgen transaktional.
- `territories-audit.php:289`: nur die freigegebenen Geometrieaktionen sind rücknehmbar. Politische `undo_`-Einträge sind nicht erneut rücknehmbar. Nicht stillschweigend das Karten-Redo auf diese Domäne übertragen.
- Ableitungs- und Hard-Delete-Protokolle sind nicht automatisch rücknehmbar. Insbesondere abgeleitete Außengrenzen liegen nicht in derselben Tabelle wie die vom Geometrie-Undo bedienten Originale.

### Aufbewahrung und individuelle Historien

`api/_internal/audit-prune.php` begrenzt auf **200 physische Audit-Zeilen pro Person über alle drei Protokolle zusammen**. Systemakteure `0` und `NULL` bilden einen gemeinsamen Topf. Globale Unfallbremsen: Karte 10.000, Landschaften 4.000, Politik 3.000 Zeilen.

**Konkreter Widerspruch:** Eine Wegegruppe darf 250 Abschnitte umfassen, die Historie derselben Person aber nur 200 Zeilen. Weil nach jeder Audit-Schreibung aufgeräumt wird, kann eine tatsächlich 250 Änderungen erzeugende Operation ihre eigenen ersten Belege bereits während des Schreibens verlieren. Das folgt aus den Codegrenzen; es ist keine Messung eines konkreten Live-Vorgangs.

Auch das Schreiben von Gegenbelegen beim Undo konkurriert mit den Originalen um dieses Budget. Eine gruppierte Oberfläche darf deshalb nie aus einer verbliebenen Teilmenge eine vollständig rücknehmbare Operation ableiten.

Der Personenfilter steuert die Anzeige, nicht die Rücknahmeberechtigung. Der Kartenverlauf benötigt `review` zum Lesen und bietet Rücknahmen bei `edit`; der Schreibweg prüft zusätzlich die Bearbeitbarkeit. Eine neue Operationskennung darf diese bestehenden Prüfungen nicht umgehen. Ursprünglicher Akteur und rücknehmender Akteur bleiben getrennt dokumentiert.

## Inventur der Sammelaktionen

| Bereich und Einstieg | Heutiges Verhalten / Nutzen | Einordnung |
|---|---|---|
| Wegegruppe: `avesmapsUpdatePathGroupDetails` | Viele gleichartige Belege in einer Transaktion; Name, Typ, Anzeige und Verkehrsmittel | **Erster Ausbau**; klare Operationsgrenze |
| Saisonfenster: `avesmapsApplyTransportSeasonsToWikiSiblings` | Eine Detailänderung pflanzt sich auf Geschwisterabschnitte fort | Hoher Nutzen; Ursprungsabschnitt und Weitergabe gemeinsam erfassen |
| Kraftlinien: `avesmapsUpdatePowerlineLine`, `avesmapsReorderPowerlineLine` | Eine Linienaktion schreibt mehrere Abschnitte; Umordnung kann Bestand und Geometrie verändern | Hoher Nutzen; vollständige Aktionsfolge und Abhängigkeiten zuerst prüfen |
| Wiki-Wege: `avesmapsWikiPathAssign`, `AssignTo`, `ClearAssign`, `AssignAll` in `wiki/paths.php` | Zuweisung/Lösen betrifft mehrere Segmente; Audit über Wiki-Schreiber | Pro Benutzerauftrag gruppieren, nicht bloß nach Artikel oder Zeit |
| Wegverlauf: `avesmapsWikiPathVerlaufApplyCaseWithContext`, `ApplyCleanCases` | Ein Verlauf betrifft mehrere Zuordnungen; weitere Ableitungen folgen | Erst Nebenwirkungen und Transaktionsgrenzen aufnehmen |
| Siedlungen: `BulkConnect`, `BulkAssignTerritories`, `BulkRecordRuins`, `BulkRecordCoats` in `wiki/settlements.php` | Unterschiedliche Sammelschreiber; Zuweisungen besitzen Audit-Helfer | Gute Kandidaten; Audit-Abdeckung jeder Variante separat schließen |
| Regionen: `avesmapsWikiRegionAssignAll` in `wiki/regions.php` | Mehrere Beschriftungen / Zuweisungen, Wiki-Audit | Gruppierbar; gebundene Landschaften mitprüfen |
| Landschaften: Malen, Radieren, Verschmelzen, Zerschneiden | `withEcosystemOperation` ist bereits an Pinsel und Geometrieoperationen angebunden | Bestehende Aggregation härten statt doppelt bauen |
| Landschaften: Löschen/Kaskaden, `PushRegionDataToLabelsAll` und Unterfunktionen | Region, Flächen und Kartenbeschriftungen können gemeinsam betroffen sein | Domänenübergreifende Abhängigkeiten; eigene Ausbaustufe |
| Politische Geometrie: Teilen, boolesche Operationen, Löschen | Mehrere Objekt-Snapshots bereits in einem Beleg | Vorhandene Semantik bewahren, einheitlich anzeigen |
| Politische gemeinsam verschobene Grenzen | Lokaler Undo-Schritt enthält mehrere Regionen; Speicherung einzeln | Geste als Operationsgrenze; unabhängige HTTP-Transaktionen beachten |
| Garetien: `avesmapsGaretienApplyStep`, `avesmapsGaretienUebernehmen` in `import/garetien-uebernahme.php` | Wiederaufnehmbare Übernahme mit verschiedenen Karten-/Landschaftsschreibern und Quellenarbeit | Lauf anzeigen, zunächst nur klar begrenzte Teiloperationen rücknehmbar machen |
| Wiki-Sync-Plan und Sync-Monitor | Ausgewählte Übernahmen, Löschungen und mehrstufige Läufe | Sammelprotokoll ist teilweise schon vorhanden; kein allgemeines Undo allein daraus ableiten |
| Sammlungs-/Meldungsaktionen | `collection-audit.php`, `report-audit.php`; teils nach Commit und best effort protokolliert | Ohne vollständigen atomaren Vorher-Zustand nur Nachweis, kein Sammel-Undo |
| Reisewerte, Zoombänder, Landschaftsdarstellung | `travel-values.php`, `zoom-bands.php`, `ecosystem-display.php` protokollieren bereits ganze Einstellungen | Keine Zeilenflut; Rücknehmbarkeit wäre ein eigener Adapter |
| Quellenabgleich, Publikationsabgleich, technische Reparaturen, Medienabrufe und Import-Staging | Große Läufe, teils externe Effekte oder nicht in diesen drei Undo-Protokollen repräsentierte Daten | Nicht pauschal einschließen; eigene reversible Zustände und Grenzen nachweisen |

Die letzten Kategorien sind bewusst keine Zusage, ihre Aktionen seien bereits rücknehmbar. Ein zusammenfassender Beleg enthält nicht automatisch die Daten für eine inverse Operation.

## Zielmodell

Eine kleine Tabelle `audit_operation` ergänzt die bestehenden Protokolle. Sie hält Identität, ursprünglichen Akteur, fachlichen Operationstyp, Beschriftung, Status, Anzahl und Bytegewicht der Mitglieder sowie Verknüpfungen zur Rücknahme/Wiederherstellung. Die drei Protokolle referenzieren den Kopf; Snapshots werden **nicht zusätzlich im Kopf dupliziert**.

Für neue serverseitige Sammelbefehle entsteht die Kennung im Server. Bei mehreren Requests bindet der Server die Client-Kennung an das authentifizierte Konto und den Auftrag; abgeschlossene Operationen nehmen keine weiteren Mitglieder an. Ein serverseitiger Sequenzwert ordnet Mitglieder auch über Tabellen hinweg. Zeitstempel und tabellenlokale IDs reichen dafür nicht.

Sinnvolle Zustände: `open`, `complete`, `partial`, `undone`, `expired`. Ein Verbindungsabbruch bedeutet nicht automatisch `complete`. Erwartete und tatsächlich gespeicherte Mitglieder werden unterschieden. Idempotenz pro Teilauftrag verhindert doppelte Writes nach einem Retry; eine UUID allein verhindert sie nicht.

Einzelaktionen ohne Kennung bleiben Einzelaktionen. Historische Belege werden nicht anhand ähnlicher Zeitstempel oder Namen nachträglich zusammengefasst. Für bereits existierende Landschaftskennungen lässt sich die ursprüngliche Vollständigkeit nach früherem Pruning nicht zuverlässig rekonstruieren; solche Altgruppen dürfen keine neue Vollständigkeitsgarantie erhalten.

## Rücknahmeablauf

1. Optional eine lesende Vorschau mit Anzahl, betroffenen Objekten und bereits erkennbaren Hindernissen laden. Die Vorschau ist keine Schreibfreigabe und reserviert nichts.
2. In einem POST Berechtigung prüfen und eine Transaktion eröffnen; Operationskopf sperren und Abschluss, Vollständigkeit und Rücknahmestatus prüfen.
3. Alle Mitglieder und betroffenen Fachobjekte in fester Reihenfolge sperren. Mehrfachänderungen desselben Objekts in umgekehrter Operationsreihenfolge auswerten; nicht jede ältere Zwischenstufe gegen denselben heutigen Zustand vergleichen.
4. Sämtliche Konflikt-, Namens-, Sperr- und Abhängigkeitsprüfungen ausführen. Bei einem Konflikt die ganze Rücknahme abbrechen. Keine still übersprungenen Mitglieder.
5. Inverse Änderungen über transaktionslose interne Domänenfunktionen anwenden. Bestehende öffentliche Einzel-Undo-Funktionen bleiben Transaktionsbesitzer ihrer eigenen Requests und dürfen nicht verschachtelt aufgerufen werden.
6. Eine neue Gegenoperation mit dem rücknehmenden Akteur und ihren Belegen schreiben, Originale markieren, relevante Revisionen erhöhen und committen. Originalaktion und Rücknahme müssen anschließend unabhängig zuordenbar bleiben.
7. Betroffene Karten-/Landschafts-/Politikdaten einmal aktualisieren. Keine vollständige Neuladung je Kindzeile.

DDL gehört vor die Transaktion. Externe Wiki-, Bild- oder Netzwerkabrufe gehören nicht in die Rücknahme. Ein Wiederherstellen bekommt die gleichen Konfliktprüfungen; es ist im ersten Ausbau nur dort verfügbar, wo der vorhandene Kartenvertrag es unterstützt.

## Serverlast und Speicher

- Die vorhandenen Aufräumer laufen bei beiden Kartenschreibern nach **jedem** Kindbeleg. Bei einer Gruppe soll die Aufbewahrung einmal am Operationsabschluss geprüft werden. Offene Operationen benötigen trotzdem harte Größen-/Laufzeitgrenzen und eine begrenzte Bereinigung, damit ein abgebrochener Auftrag nicht unbegrenzt Daten hält.
- Ein Sammel-Undo benötigt einen Request statt N Requests, aber weiterhin ungefähr O(N) Datenprüfungen und Writes. Es beseitigt wiederholte Initialisierung und Reloads, nicht die fachliche Arbeit.
- Indexe: Operationskopf nach `(actor_user_id, created_at, id)`, Mitglieder nach `(operation_id, sequence)`; bestehende Objektindexe nutzen. Mitglieds- und Bytezähler beim Schreiben pflegen, nicht bei jedem Listenabruf alle JSON-Daten summieren.
- Listen liefern kleine Operationszusammenfassungen; Kinddetails werden begrenzt nachgeladen. Gruppieren muss **vor** Pagination stattfinden. Personenfilter, Zähler und Liste müssen dieselbe Einheit zählen.
- Die dokumentierten alten Größen von etwa 2 KB je Karten- und 40 KB je Landschaftsbeleg sind nur Planungswerte aus August. Beispiel: 200 Operationen × 100 Kinder × 40 KB wären ungefähr **800 MB je Person**. Bloße Gruppierung spart keine Snapshot-Bytes.
- Daher: höchstens 200 sichtbare Vorgänge je Person als vorgeschlagene neue Obergrenze, zusätzlich begrenzte Snapshot-Bytes und Mitglieder je Person und global. Diese Änderung von „200 Zeilen“ zu „200 Vorgängen“ ist eine bewusste Produktentscheidung, keine automatische Folge des Datenmodells.
- Retention entfernt komplette abgeschlossene Operationen, niemals beliebige Kinder. Große Löschmengen dürfen intern portioniert werden, müssen aber vorher die gesamte Operation als nicht mehr rücknehmbar markieren. Ein kleiner verbleibender Hinweis „Rücknahme abgelaufen“ braucht selbst eine Aufbewahrungsgrenze.
- Für den Wege-Piloten die vorhandenen 250 Segmente als Obergrenze beibehalten; zusätzlich Snapshot-Bytegrenze setzen. Konkrete Byte-/Zeitbudgets erst anhand aktueller Daten und STRATO-Messungen festlegen. Große Importläufe bleiben in begrenzte Teiloperationen untergliedert; keine minutenlange Alles-oder-nichts-Transaktion versprechen.
- Snapshot-Kompression oder Feld-Patches nicht mit dem ersten Ausbau vermischen. Sie ändern Wiederherstellung und Konfliktvergleich und benötigen eine eigene Versionierung und Migration.

## Audit gegenüber Strg-Z

Audit-Rücknahme ist eine ausdrücklich gewählte, persistierte Korrektur eines benannten Vorgangs. Sie kann nach einem Reload erfolgen und muss spätere Änderungen anderer Editoren respektieren.

Strg-Z bleibt bei den lokalen Bearbeitungsschritten: Landschaftsecken, Pinsel und politische Geometriesitzung. `map-features-ecosystem-edit.js:875` stellt lokalen Zustand wieder her und löst bei bereits gespeichertem Zustand eine normale neue Speicherung aus. `map-features-region-geometry-undo.js` erfasst auch mitbewegte Nachbarregionen. Texteingaben behalten ihr eigenes Undo.

`review-panels-change-log.js:1092` dokumentiert ausdrücklich die Entfernung des globalen Audit-Strg-Z. Der neue Sammelknopf darf diese Trennung nicht wieder aufheben. Ein lokaler Undo-Write gehört zu einer neuen Korrekturoperation, nicht als nachträgliches Mitglied zur bereits abgeschlossenen Originaloperation.

## Baufolge und Abnahme

1. **Gemeinsame Grundlage:** Schema, Operationskontext, beide Kartenschreiber und direkte Schreiber inventarisieren/abgrenzen; gruppensichere Retention, Zähler und abgelaufene Operationen. Alte Einzelbelege bleiben lesbar.
2. **Wege-Pilot:** `update_path_group_details` bekommt einen vollständigen Operationskopf. Karten-Undo in Transaktionshülle und interne Rücknahme zerlegen. Eintrag „Weg bearbeitet – 27 Abschnitte“ mit Details und gemeinsamem Rücknahmeknopf. Bestehendes Karten-Redo als Gruppe erhalten.
3. **Nahe Kartenfälle:** Saisonweitergabe und Kraftlinien; anschließend Wiki-Wege/-Regionen/-Siedlungen nach Prüfung ihrer Nebenwirkungen. Jeden sichtbaren Ausbau einzeln ausliefern und abnehmen.
4. **Landschaften härten:** aktueller Zustand gegen Nachher-Snapshot, Akteursbindung, Abschlusszustand und Vollständigkeit; danach vorhandene Gesten an gemeinsame Köpfe anbinden.
5. **Domänenübergreifende Fälle:** Beschriftungskaskaden, Garetien und ausgewählte Sync-Läufe mit eigenen Adaptern und begrenzten Teiloperationen. Nicht rücknehmbare Bestandteile offen kennzeichnen.

Erforderliche Verifikation vor Auslieferung:

- 1, 27 und 250 tatsächlich geänderte Wegabschnitte; No-op-Speicherung erzeugt keinen leeren Vorgang.
- Ein einzelner Konflikt oder eine fremde Objektsperre verhindert jede Teilrücknahme; auch Mehrfachänderungen desselben Objekts funktionieren in richtiger Reihenfolge.
- Zwei Editoren, gleiche Zeitstempel, gleiche/fremde Client-Kennung, Doppelklick und Retry: keine vermischten oder doppelten Operationen.
- Fehler beim letzten Kind, Abbruch vor Abschluss und fehlendes Mitglied: kein unberechtigtes „vollständig“ und keine halbe Rücknahme.
- Aufbewahrung über alle drei Protokolle, Systemakteure 0/NULL, Original plus Gegenbeleg, Bytebudget und Löschportionierung: keine zerrissenen rücknehmbaren Gruppen.
- MySQL-Integration mit Transaktionen und Sperren; SQLite allein belegt weder Sperrverhalten noch MySQL-Kompatibilität.
- Echte Oberfläche: Wegegruppe speichern, Verlauf öffnen, Gruppe aufklappen, rückgängig machen, Karte prüfen, wiederherstellen; anderer Editor und Personenfilter; Strg-Z in Textfeld und Geometriesitzung.
- Requestzahl, SQL-Zahl, Snapshot-Bytes und Laufzeit für die Obergrenze messen. Vor Push das gesamte Testfeld nach den Workflow-Mustern fahren; Prüfagenten und getrennte Live-Abnahme nach AGENTS.md einplanen.

**Empfehlung:** zuerst gemeinsame Aufbewahrung plus Wege-Pilot. Eine umfassende, universelle Rücknahme aller Importe im ersten Schritt wäre wegen der unterschiedlichen Datenmodelle und Transaktionsgrenzen erheblich riskanter und für den gemeldeten Alltagsfall nicht nötig.
