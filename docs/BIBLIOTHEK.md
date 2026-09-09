# Lokale Transkriptbibliothek

Die Bibliothek ergänzt den Datei- und Live-Modus. Sie speichert beliebig viele
Transkripte innerhalb der verfügbaren Browserquote, organisiert sie in flachen
Ordnern und trennt die Lebensdauer der Texte von der Lebensdauer der Tonaufnahmen.
Eine Serverdatenbank oder Benutzerverwaltung ist dafür nicht erforderlich.

## Bedienung

1. Datei transkribieren oder Live-Aufnahme starten. Die Bibliothek übernimmt das
   Ergebnis automatisch; Live-Aufnahmen erscheinen schon während der Aufnahme.
2. Unter **Bibliothek** das Transkript auswählen, Titel vergeben und einen Ordner
   wählen. Suche berücksichtigt Titel und finalen Text. Filter zeigen freigegebene,
   noch ungeprüfte oder unvollständige Transkripte.
3. Zum Prüfen **Transkript öffnen / bearbeiten** verwenden. Datei-Transkripte
   öffnen den Dateieditor, Live-Sitzungen ihre Abschnitte mit Originaltexten und
   Modellwerten. Änderungen werden gespeichert. Audio kann in der Bibliothek
   angehört und als Datei heruntergeladen werden. Live-WAVs enthalten Randkontext;
   sie überlappen und sind keine lückenlos aneinanderzureihenden MP3-Tracks.
4. Die Aufbewahrung steht je Transkript standardmäßig auf **Nach Freigabe löschen**.
   Bei Bedarf vor der Freigabe **Audio behalten** wählen.
5. Nach der Prüfung freigeben. Die Bestätigung sagt ausdrücklich, ob Audio erhalten
   oder endgültig gelöscht wird. Danach bleiben Text und Modellwerte editierbar;
   eine Änderung setzt die Freigabe zurück.

Ordner löschen entfernt keine Transkripte: Sie erscheinen anschließend ohne
Ordner. Ein Transkript kann einschließlich aller gespeicherten Abschnitte bewusst
gelöscht werden. Beim Löschen der aktuell geöffneten Sitzung wird auch die
Live-Ansicht zurückgesetzt. **+ Neue Aufnahme** im Live-Modus bzw. **+ Neue Live-Aufnahme** in der
Bibliothek bereiten eine leere Sitzung mit wählbarer Sprache und Intervall vor.
Erst **Mikrofon starten** aktiviert die Aufnahme. Ältere Transkripte bleiben erhalten.

Es läuft immer nur die Warteschlange der aktuell ausgewählten Live-Sitzung.
Das Öffnen eines anderen gespeicherten Transkripts ist während einer laufenden
Anfrage gesperrt. Eine **neue Aufnahme** kann trotzdem vorbereitet werden: Der
Browser bricht die alte Anfrage ab, wartet auf deren Abschluss im Client und
speichert den ausstehenden Auftrag mit derselben ID und WAV-Datei. Das Backend
kann die Inferenz noch abschließen; beim Wiederholen greift dessen Ergebniscache.
Bei abgelegten Sitzungen
mit Rückständen zeigt die Bibliothek „Verarbeitung / unvollständig“; erneutes
Öffnen setzt deren Verarbeitung fort. Ein Mikrofon startet dadurch niemals.

## Freigabe und Löschung

„Freigabe“ ist in dieser lokalen Anwendung die Bestätigung der Textprüfung durch
den Nutzer. Sie veröffentlicht nichts und erteilt keine Trainings- oder
Nutzungsfreigabe an andere Personen. Es gibt keine Links zum Teilen oder Rollen.

| Aktion | Transkript und Modellwerte | Gespeichertes Audio |
| --- | --- | --- |
| Freigabe mit Standard-Aufbewahrung | Bleiben erhalten; Freigabezeit wird gesetzt | Wird gelöscht |
| Freigabe mit „Audio behalten“ | Bleiben erhalten; Freigabezeit wird gesetzt | Bleibt erhalten |
| Aufbewahrung nach Freigabe auf Standard ändern | Freigabe bleibt erhalten | Wird nach gesonderter Bestätigung gelöscht |
| Text bearbeiten | Änderung gespeichert, Freigabe aufgehoben | Unverändert; gelöschtes Audio bleibt gelöscht |
| Nur Audio löschen | Bleiben erhalten | Wird gelöscht |
| Transkript löschen | Wird gelöscht | Wird gelöscht |
| Ordner entfernen | Ohne Ordner weiter vorhanden | Unverändert |

Bei Live-Sitzungen prüfen Freigabe und separates Audiolöschen innerhalb derselben
IndexedDB-Transaktion, dass die Aufnahme beendet ist, Abschnitte vorhanden sind,
alle Whisper-Aufträge abgeschlossen sind und kein anhand der gespeicherten Dauer
erkennbarer ungesicherter Rest vorliegt. Fehlgeschlagene, laufende oder zur
Wiederholung anstehende Aufträge brauchen ihre WAVs weiterhin. Im Ganzen darf ein
solches Transkript nach ausdrücklicher Bestätigung gelöscht werden, sobald gerade
keine Aufnahme oder Anfrage läuft. Nach einem Aufnahmeabbruch kann ein kurzer Rest
seit dem letzten Metadaten-Checkpoint unentdeckt bleiben; die Unterbrechungsmeldung
und die eigene Prüfung bleiben daher wichtig.

Freigabezeit, Löschen der Audio-Blobs und Aktualisierung der Audiometadaten erfolgen
atomar. Schlägt die Transaktion fehl, bleibt der vorherige Zustand bestehen.
Ein späteres Speichern von Datei-Textkorrekturen legt bereits gelöschtes Audio nicht
wieder an. Änderungen an Titel, Ordner oder Aufbewahrung überschreiben keine
Abschnittstexte. Vor Bibliotheksänderungen werden ausstehende Editor-Schreibvorgänge
abgewartet; bekannte Speicherfehler verhindern die Freigabe eines veralteten Stands.
Bei vollem Speicher darf Audio anderer abgeschlossener Transkripte entfernt werden.
Anschließend **Lokales Speichern erneut versuchen** im Live-Modus bzw. **Erneut
speichern** im Dateieditor verwenden. Ungesicherte WAVs bleiben bis dahin im RAM
und können über die Abschnittsdetails exportiert werden.

„Löschen“ entfernt die Datensätze und Audioverweise dieser Anwendung. Quelldateien
auf der Festplatte, eigene Downloads, Browser-/Geräte-Backups werden dadurch nicht
entfernt. Eine forensisch sichere Löschung von Speichermedien wird nicht zugesagt.
Das Backend speichert kein dauerhaftes Audioarchiv. Sein kleiner Live-Ergebniscache
enthält weiterhin Texte und wird durch diese lokale Bibliotheksaktion nicht geleert.

## Speicheranzeige und Lebensdauer

Die Summe der `Blob.size`-Werte zeigt die gespeicherten Audiodaten insgesamt und je
Transkript, in B/KiB/MiB. Audio wird nicht zum Zählen in den Arbeitsspeicher geladen.
Live-Aufnahmen zählen die PCM16-WAVs einschließlich Kontext; Datei-Uploads ihre
Originaldatei. Die Anzeige berücksichtigt ausschließlich erfolgreich gespeicherte
Audio-Blobs, nicht den aktuellen Mikrofonpuffer im Arbeitsspeicher.

`navigator.storage.estimate()` liefert zusätzlich den geschätzten Gesamtbedarf der
Origin und ihre Quote. Dazu zählen auch Transkripte, Datenbankaufwand und eventuell
der Vosk-Modellcache. Diese Schätzung kann verzögert oder ungenau sein und ist
keine Anzeige des freien Festplattenspeichers. Fehlt die API, bleibt die genaue
Audiozählung verfügbar. [MDN: estimate](https://developer.mozilla.org/en-US/docs/Web/API/StorageManager/estimate)

**Dauerhaften Speicherschutz anfragen** ruft `navigator.storage.persist()` auf und
zeigt, ob der Browser den Schutz gewährt. Der Browser entscheidet; die Anwendung
kann ihn nicht erzwingen. Manuelles Löschen von Browserdaten wird damit nicht
verhindert. [MDN: persist](https://developer.mozilla.org/en-US/docs/Web/API/StorageManager/persist)

Die Bibliothek gehört zu Browserprofil und Origin. `localhost:4200`,
`localhost:8000` und `127.0.0.1:8000` sind getrennte Ablagen. Private Fenster sind
für langfristige Ablage ungeeignet. JSON/TXT-Export erfolgt je Transkript; JSON
enthält Metadaten, Originalergebnisse und Korrekturen, aber keine Audiodaten. Audio
separat herunterladen. Ein JSON-Import und komplette Archiv-Backups sind bisher
nicht enthalten.

## Datenmodell und Migration

Datenbank: `little-stt-live`, Schema-Version 2.

| Object Store | Inhalt |
| --- | --- |
| `documents` | ID, Typ, Titel, Ordner, Erstell-/Änderungsdatum, Aufbewahrung, Freigabe-/Löschzeit; Live-Sitzungsdaten oder Datei-Ergebnis |
| `folders` | ID und eindeutiger Name; eine Ebene |
| `session` | Aktuelle Live-Sitzung unter Schlüssel `current` als kompatibler Wiederherstellungszeiger |
| `chunks` | Live-Abschnitte mit Sitzungsschlüssel, Modellresultat, Vorschlag, optionaler manueller Fassung und Verarbeitungsstatus |
| `audio` | WAV je Abschnitt bzw. Original-Upload als Blob, getrennt von Texten |
| `audioInfo` | Audio-ID, Transkript-ID, Bytezahl, Downloadname |

Die Upgrade-Transaktion übernimmt eine vorhandene v1-Sitzung als Dokument und
ermittelt Audiometadaten aus den vorhandenen Blobs. Texte und Audiodateien bleiben
unverändert. Andere alte Tabs müssen geschlossen werden, wenn sie das Upgrade
blockieren. [MDN: IndexedDB-Upgrade](https://developer.mozilla.org/en-US/docs/Web/API/IDBOpenDBRequest/upgradeneeded_event)

Der bisherige Web Lock schützt nun die gesamte Bibliothek vor gleichzeitiger
Bearbeitung in mehreren Tabs. Die Datei-Transkription kann in einem zweiten Tab
weiterhin Ergebnisse anzeigen/exportieren, aber nicht in die gesperrte Bibliothek
schreiben. Während einer laufenden Aufnahme oder Anfrage ist die Bibliothek lesbar,
ihre Änderungen sind vorübergehend gesperrt.

## Prüfung

`npm test` prüft mit `fake-indexeddb` unter anderem Migration, mehrere Sitzungen,
Wiederherstellung von Rückständen, atomare Freigabe, Audio-Aufbewahrung, Schutz
unvollständiger Aufnahmen, Zurücksetzen der Freigabe nach Korrekturen, Verschieben,
Ordnerlöschung und die vollständige Löschung genau eines Transkripts. Die bestehenden
Tests prüfen zusätzlich Aufnahmefenster, Whisper-Warteschlange und Textschutz.

Manueller Browsertest: zwei Mikrofonaufnahmen erzeugen, beide über die Bibliothek
öffnen, Ordner anlegen/umbenennen/entfernen, Titel/Text ändern, mit beiden
Aufbewahrungsoptionen freigeben und die Audioanzeige prüfen. Eine Audiodatei
transkribieren, nach Freigabe ohne Audio erneut bearbeiten, suchen, exportieren,
neu laden und die mobile Darstellung sowie die Sperre eines zweiten Tabs prüfen.
Die automatisiert durchgeführte Browserprüfung verwendet einen simulierten
Mikrofoneingang und gemockte Whisper-Antworten; echte Inferenz bleibt eine eigene
Integrationsprüfung. Beispielaufnahmen oder Nutzertranskripte gehören nicht ins Repo.
