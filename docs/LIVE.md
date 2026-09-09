# Live-Mikrofon mit periodischer Whisper-Nachbearbeitung

Dieser Modus ist implementiert. Die Modelltrainingsfunktionen im
[Lernplan](LERNPLAN.md) bleiben ein eigener, noch geplanter Ausbau.

## Audio und Abschnittsgrenzen

`MicrophoneCapture` öffnet einen AudioContext mit 16 kHz und verbindet den
Mikrofonstream mit `public/audio-capture.js`. Dieser AudioWorklet mischt
gegebenenfalls mehrere Kanäle auf Mono und überträgt Blöcke mit bis zu 4096
Samples. Die Audioausgabe des Worklets ist stumm; das Mikrofon wird nicht über
die Lautsprecher wiedergegeben.

Dieselben Samples gehen an den fortlaufenden Vosk-Recognizer und an
`WindowAssembler`. Der Assembler bestimmt Grenzen anhand der Sampleanzahl;
ein verzögerter JavaScript-Timer verschiebt deshalb keine Aufnahmeabschnitte.
Er kodiert jeden abgeschlossenen Ausschnitt als eigenständige PCM16-WAV-Datei.
Es werden keine voneinander abhängigen MediaRecorder-WebM-Fragmente als einzelne
Audiodateien verschickt.

Bei einem Fünf-Minuten-Intervall entstehen zum Beispiel:

| Abschnitt | Zuständiger Textbereich | An Whisper übertragenes Audio | Frühester Versand |
|---|---|---|---|
| 1 | 0:00–5:00 | 0:00–5:05 | 5:05 |
| 2 | 5:00–10:00 | 4:55–10:05 | 10:05 |
| 3, Stop bei 12:00 | 10:00–12:00 | 9:55–12:00 | Beim Stoppen |

Der Kontext überlappt an einer regulären Grenze insgesamt zehn Sekunden.
Beim Stoppen werden die Mikrofon-Tracks sofort geschlossen und bereits erfasste
Worklet-Nachrichten einschließlich des kleinen letzten Puffers abgeholt. Der
Audio-Rest wird unabhängig vom Abschluss der Vosk-Vorschau eingereiht. Vosk darf
seine letzten Wörter noch abschließen; dafür gilt ein eigenes Zeitlimit.

## Ergebnisse und Zusammenführung

Jede Sitzung und jeder Abschnitt haben eine UUID. Ein Abschnitt enthält außerdem
eine Sequenznummer, Anfang des Audiofensters und die exklusiven Grenzen seines
zuständigen Textbereichs, jeweils in 16-kHz-Samples.

`POST /api/live/transcribe` prüft Dateiformat, Länge, IDs und Zeitgrenzen, nutzt
die vorhandene Whisper-Inferenz und verschiebt Wort- und Segmentzeitstempel auf
die gemeinsame Sitzungszeitachse. Die vollständige Antwort mit Kontext wird
aufbewahrt.

`stitch()` gleicht zeitlich benachbarte gleiche Wörter in überlappenden Fenstern
ab. Ein möglichst grenznahes Wortpaar bildet den Übergang zwischen den
Ergebnissen. Echte Wortwiederholungen außerhalb dieses gemeinsamen Audiobereichs
werden erhalten. Ohne übereinstimmenden Übergang erfolgt eine Zuordnung anhand
der Wortmitten; widersprüchliche Sprache direkt an der Grenze wird markiert.
Das Verfahren ist eine Heuristik, keine Garantie für fehlerfreie Satzgrenzen.
Originaltexte und WAV-Kontext ermöglichen die Kontrolle.

Die Anzeige besitzt pro Abschnitt einen automatisch aktualisierbaren Vorschlag
und einen optionalen manuellen Entwurf. Sobald ein Entwurf vorhanden ist,
einschließlich eines absichtlich leeren Texts, hat er Vorrang. Neue Whisper-
Ergebnisse oder ein späterer Grenzabgleich ändern ausschließlich den Vorschlag.
„Modelltext übernehmen“ entfernt den manuellen Entwurf bewusst.

Vosk-Konfidenzen und Originalwortstempel bleiben im JSON-Export der Sitzung
erhalten; Whisper-Metriken sind zusätzlich direkt in den Abschnittsdetails
sichtbar. Das LLM der Datei-Transkriptionsseite wird im Live-Modus nicht automatisch
aufgerufen.

## Warteschlange und Wiederherstellung

IndexedDB `little-stt-live` (Schema 2) speichert mehrere Sitzungen in der
[Bibliothek](BIBLIOTHEK.md) und einen Zeiger auf die aktuelle Sitzung. Metadaten,
Abschnittstexte und WAV-Blobs haben getrennte Stores. Die erstmalige Ablage eines
Abschnitts und seines Audios erfolgt in einer gemeinsamen Transaktion. Nur
abgeschlossene Audiofenster sind dauerhaft gespeichert; der gerade erfasste
Abschnitt bleibt im RAM. Bei einem Neuladen wird auf diese mögliche Lücke
hingewiesen. Eine Wiederherstellung aktiviert niemals automatisch das Mikrofon. Neue Aufnahmen
lassen bisherige Sitzungen bestehen. Die Warteschlange verarbeitet nur die
ausgewählte Sitzung; andere Rückstände bleiben gespeichert und laufen beim
erneuten Öffnen über die Bibliothek weiter.

Die Anwendung sendet höchstens einen Live-Auftrag gleichzeitig. Netzwerkfehler,
HTTP 408/425/429 und Serverfehler werden nach 5, 10, 20, 40 und anschließend
höchstens 60 Sekunden erneut versucht. Jede Wiederholung nutzt dieselbe UUID und
dieselben Audiodaten. Dauerhafte Fehler wie ungültige Metadaten werden angezeigt
und halten die Reihenfolge an, bis der Nutzer erneut versucht oder die Sitzung
bewusst löscht. Eine laufende Anfrage hat ein Zeitlimit von 15 Minuten.

Die pausierte Verarbeitung lässt den aktuellen Auftrag auslaufen und verhindert
weitere Anfragen. Das Mikrofon läuft bis zum Stoppen oder bis zur lokalen Grenze
weiter. Rückstände gehen nicht durch stilles Überspringen eines Abschnitts verloren.

Das Backend hält die letzten 32 erfolgreichen Live-Antworten in einem
Arbeitsspeicher-Cache. Die Identität enthält auch Audiohash und Parameter.
Ein identischer erneuter Auftrag erhält die gespeicherte Antwort; dieselbe UUID
mit anderen Daten wird abgewiesen. Laufende identische Aufträge erhalten einen
Belegt-Status. Nach einem Backend-Neustart oder nach Cache-Verdrängung kann ein
Abschnitt erneut berechnet werden; im Frontend ersetzt das Ergebnis weiterhin
denselben Abschnitt und erzeugt keinen doppelten Textblock.

Web Locks verhindert konkurrierende Bearbeitungen derselben Bibliothek in mehreren
Tabs. Während Aufnahme oder einer laufenden Anfrage bleiben Änderungen in der
Bibliothek gesperrt. Bereits eingeplante Schreibvorgänge werden vor einer Freigabe
oder Löschung abgewartet. Mikrofonverlust, Stummschaltung oder ein suspendierter AudioContext beenden
die Aufnahme mit sichtbarer Meldung. Ein Ausfall oder mehr als ungefähr 30 Sekunden
Vosk-Rückstand beendet dagegen nur die Vorschau; Audioaufnahme und Whisper laufen
weiter. Der Adapter für das festgeschriebene `vosk-browser@0.0.8` beendet seinen
Worker auch bei abgebrochenen Modellladevorgängen.

Bei zwölf ausstehenden Abschnitten oder etwa 512 MB WAV-Daten stoppt die Aufnahme
kontrolliert und sichert den letzten Rest zusätzlich. Ein voller Browser-Datenträger
stoppt ebenfalls die Aufnahme. Noch im RAM verfügbare, nicht gespeicherte Blobs
können über den jeweiligen WAV-Download gerettet werden. Solange sie nicht
gesichert sind, warnt die Seite vor dem Schließen.

## Prüfung

```bash
uv run pytest
cd frontend
npm ci
npm test
npm run build
```

Die Backend-Tests prüfen unter anderem echte WAV-Validierung, vollständige
310-Sekunden-Audiofenster, globale Zeitstempel, Wiederholbarkeit und ID-Konflikte.
Frontend-Tests prüfen Samplekontinuität, Stop-Reste, WAV-Kodierung, Grenzabgleich,
geschützte Änderungen, IndexedDB-Wiederherstellung und die Ausfallwarteschlange.
Ein Worklet-Test prüft die Kanalzusammenführung und das vollständige Leeren des
letzten Puffers. Die Modellantworten sind in diesen schnellen Tests simuliert.

Für den manuellen bzw. Browser-Integrationstest: Mikrofon starten, einen
Intervallwechsel abwarten, während einer verzögerten Whisper-Antwort einen
Abschnitt bearbeiten, Backend kurz unterbrechen, Aufnahme beenden und nach
vollständiger Verarbeitung neu laden. Mikrofon muss aus bleiben, Texte müssen
erhalten sein und ein bearbeiteter Abschnitt darf nicht überschrieben werden.

## Browser-Referenzen

- [AudioWorklet-Verarbeitung](https://developer.mozilla.org/en-US/docs/Web/API/AudioWorkletProcessor/process)
- [Mikrofonzugriff und sichere Kontexte](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia)
- [IndexedDB-Transaktionen](https://developer.mozilla.org/en-US/docs/Web/API/IDBTransaction)
- [Vosk-Browser-Recognizer](https://github.com/ccoreilly/vosk-browser/blob/master/lib/src/model.ts)
