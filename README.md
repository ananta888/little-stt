# little stt

[![CI](https://github.com/ananta888/little-stt/actions/workflows/ci.yml/badge.svg)](https://github.com/ananta888/little-stt/actions/workflows/ci.yml)
[![License: BSD-3-Clause](https://img.shields.io/badge/License-BSD--3--Clause-blue.svg)](LICENSE)

Kleine lokale Transkriptions-App: Angular 21 im Frontend, Python/FastAPI mit
faster-whisper im Backend, Vosk als WebAssembly-Worker im Browser. Eine lokale Bibliothek in IndexedDB
verwaltet Dateien und Live-Sitzungen. Keine Serverdatenbank, keine Benutzerkonten,
keine Cloud-Transkriptions-API.

Der [Umsetzungsplan für die Lernschleife](docs/LERNPLAN.md) beschreibt den geplanten
Ausbau: geprüfte Whisper-Transkripte sammeln, Vosk anpassen, Qualität vergleichen
und Modellversionen im Browser wechseln. Diese Lernfunktionen sind noch nicht
implementiert.

## Starten

Voraussetzungen: Python ≥ 3.11, [uv](https://docs.astral.sh/uv/), Node.js 22 ≥ 22.12
oder Node.js 24. Ein System-FFmpeg ist nicht erforderlich; PyAV bringt die Decoder mit.

Repository klonen und Abhängigkeiten installieren:

```bash
git clone https://github.com/ananta888/little-stt.git
cd little-stt
uv sync
python3 scripts/download_vosk.py
cp .env.example .env
cd frontend
npm ci
```

Terminal 1, im Projektverzeichnis:

```bash
uv run uvicorn backend.main:app --reload --host 127.0.0.1 --port 8000
```

Terminal 2:

```bash
cd frontend
npm start
```

Öffnen: **http://localhost:4200**. API-Dokumentation: http://127.0.0.1:8000/docs.

Datei wählen, Sprache festlegen, **Transkribieren** klicken. Für Deutsch laufen Vosk
und Whisper parallel. Die Vosk-Vorschau erscheint während der Verarbeitung, das
Whisper-Ergebnis wird zum bearbeitbaren finalen Text. Ohne Whisper-Ergebnis bleibt
die Vosk-Vorschau verfügbar. Originale und Fehler bleiben getrennt sichtbar.

Unter **Vergleich** stehen beide Texte, unter **Wörter & Konfidenz** die Modellwerte.
TXT exportiert den bearbeiteten Text; JSON enthält zusätzlich Originaltexte,
Zeitstempel, Wortwerte, Segmentmetriken und die Herkunft des finalen Texts.

## Live-Transkription

**Live-Mikrofon** öffnen, Sprache wählen und **Mikrofon starten** klicken.
Den Mikrofonzugriff im Browser erlauben und erst sprechen, wenn der Aufnahmezähler
läuft. Für Deutsch zeigt Vosk sofort eine Vorschau. Bei Englisch oder automatischer
Spracherkennung entsteht der Text mit der anschließenden Whisper-Analyse.

Whisper verarbeitet standardmäßig ungefähr alle **5 Minuten** einen neuen
Audioabschnitt; alternativ ist **1 Minute** wählbar. Fünf zusätzliche Sekunden
Kontext nach der Grenze helfen beim Übergang. Das Mikrofon läuft währenddessen
weiter. Beim Beenden wird der verbleibende Abschnitt sofort eingereiht, auch
wenn er kürzer als das gewählte Intervall ist.

Jeder Abschnitt zeigt Vorschau bzw. Whisper-Ergebnis und lässt sich bearbeiten.
**Manuelle Änderungen werden von späteren Ergebnissen nicht überschrieben.**
Mit „Modelltext übernehmen“ kannst du bewusst zum aktuellen Vorschlag wechseln.
Die Originale, Wortwerte und Zeitstempel bleiben unter den Abschnittsdetails
verfügbar. Unklare Übergänge werden zum Nachhören markiert.

Bei einem nicht erreichbaren oder belegten Backend wiederholt die Anwendung den
Auftrag automatisch mit derselben Abschnitts-ID. Die Verarbeitung kann pausiert
und manuell erneut angestoßen werden. TXT exportiert den aktuellen Text; JSON
enthält zusätzlich Originalergebnisse, Abschnittsgrenzen und Bearbeitungen.
Die WAV-Datei jedes abgeschlossenen Abschnitts kann separat heruntergeladen werden.

Live-Sitzungen mit ihren **abgeschlossenen** Audioabschnitten und
Bearbeitungen liegen lokal in der Bibliothek in IndexedDB. Nach einem Neuladen werden die Texte
wiederhergestellt und ausstehende Aufträge fortgesetzt; das Mikrofon bleibt aus.
Der gerade laufende, noch nicht abgeschlossene Audioabschnitt liegt im RAM und
kann beim Schließen des Tabs verloren gehen. Deshalb die Aufnahme zuerst beenden.
Browserdaten gehören zur jeweiligen Adresse: `localhost:4200` und
`127.0.0.1:8000` haben unterschiedliche Sammlungen.

Voraussetzungen: ein aktueller Browser mit AudioWorklet, Web Locks und
Mikrofonzugriff, **localhost oder HTTPS**. Den Tab geöffnet und das Gerät wach
halten; Hintergrundbetrieb und gesperrte Mobilgeräte können die Aufnahme
unterbrechen. Solche Unterbrechungen beenden die Aufnahme mit einem Hinweis.
Nur ein Tab darf dieselbe lokale Bibliothek bearbeiten. **Neue Aufnahme · bisherige
behalten** beginnt eine weitere Sitzung. Die vorherige bleibt in der Bibliothek.
Ausstehende Aufträge einer abgelegten Sitzung werden beim erneuten Öffnen dieser
Sitzung fortgesetzt; die Warteschlange arbeitet jeweils für die ausgewählte Sitzung.

Bei 12 ausstehenden Abschnitten oder etwa 512 MB aufgenommenen Abschnittsdateien
wird die Aufnahme beendet und ihr Rest gesichert. Auch bei vollem Browserspeicher
wird gestoppt; noch nicht gespeicherte WAVs können vor dem Schließen exportiert
werden. Das Backend verarbeitet jeweils einen Whisper-Auftrag, daher kann bei
langsamer Hardware ein Rückstand entstehen.

Technische Details und Testumfang: [Live-Modus](docs/LIVE.md).

## Transkripte, Ordner und Speicher verwalten

Unter **Bibliothek** erscheinen Live-Sitzungen automatisch ab Aufnahmestart und
Datei-Transkripte nach Abschluss der Verarbeitung. Auch eine vorhandene
Vosk-Vorschau bei fehlgeschlagenem Whisper kann gespeichert und geprüft werden.
Eine neue Datei oder Live-Aufnahme ersetzt keine bereits gespeicherten Transkripte.
Bisherige Live-Daten werden beim ersten Start der neuen Version übernommen.

- Ordner anlegen, umbenennen und entfernen. Beim Entfernen eines Ordners bleiben
  seine Transkripte unter **Ohne Ordner** erhalten.
- Titel ändern, Transkripte verschieben, nach Titel oder Text suchen und nach
  Prüfstatus filtern. **Transkript öffnen / bearbeiten** führt zum passenden Editor;
  Änderungen werden automatisch gespeichert.
- **Freigabe** bestätigt deine Textprüfung. Standardmäßig löscht
  **Freigeben & Audio löschen** die gespeicherten Originalaufnahmen nach einer
  ausdrücklichen Bestätigung. Texte, Vosk-/Whisper-Ergebnisse, Zeitstempel und
  manuelle Korrekturen bleiben erhalten.
- **Audio behalten** bewahrt Aufnahmen auch nach der Freigabe auf. Bereits
  freigegebene Transkripte beim Wechsel zurück zum Standard: Die Oberfläche
  bestätigt die sofortige Audiolöschung gesondert. Eine spätere Textänderung hebt
  die Freigabe auf, stellt gelöschtes Audio aber nicht wieder her.
- Aufnahmen anhören oder einzeln herunterladen, nur Audio entfernen oder das
  gesamte Transkript löschen. Eine Freigabe und das separate Entfernen von Audio
  sind bei laufender Aufnahme, ausstehenden Whisper-Aufträgen oder ungesichertem
  Aufnahmerest gesperrt. Das gesamte Transkript kann bewusst gelöscht werden.

Die Speicheranzeige zählt gespeicherte Audio-Bytes insgesamt und je Transkript.
Daneben steht die **geschätzte** Browserbelegung inklusive Texten und Modellcache
sowie die Browserquote. Freigegebenes Audio wird aus der Anwendung entfernt;
Quelldateien und zuvor heruntergeladene Kopien auf deinem Gerät bleiben bestehen.
Die Bibliothek ist lokal pro Browserprofil und Adresse, kein geteiltes Archiv.
**Dauerhaften Speicherschutz anfragen** bittet den Browser um Schutz vor automatischer
Verdrängung. Wichtige Texte weiterhin als TXT/JSON exportieren; Browserdaten können
manuell gelöscht werden. JSON enthält kein Audio und wird derzeit nicht importiert.

Details zu Ablage, Löschregeln und Tests: [Bibliothek](docs/BIBLIOTHEK.md).

## Modelle und Formate

- Vosk: offizielles `vosk-model-small-de-0.15` (ca. 45 MB Download, Apache 2.0).
  Das Skript packt es als `frontend/public/models/vosk-de.tar.gz` für vosk-browser.
  Das Modell wird vom eigenen Server geladen und im Browser per IndexedDB gecacht.
  Englisch/automatische Spracherkennung verwenden in dieser kleinen Version nur Whisper.
- Whisper: standardmäßig `base`, CPU/int8. Beim ersten Aufruf lädt faster-whisper
  das Modell von Hugging Face in den lokalen Cache; dafür ist Internet nötig.
  `WHISPER_MODEL=small` erhöht typischerweise Genauigkeit und Rechenbedarf.
  Ein lokaler Modellpfad ist ebenfalls möglich. `.env` ändern, Backend neu starten.
- OGG/Opus, MP3, WAV, M4A/AAC, FLAC, WebM und weitere von PyAV unterstützte Formate.
  Der Browser dekodiert für Vosk selbst, mischt auf Mono und resampelt auf 16 kHz.
  Falls der Browser das Format nicht versteht, konvertiert `/api/audio/wav` es im
  Backend. Enthält die Datei mehrere Audiospuren, wird im Backend die erste verwendet.
- Grenzen: 100 MB und 15 Minuten pro Datei, ein gleichzeitiger Whisper-Auftrag.
  Die Browser-Dekodierung hält die Aufnahme im RAM; für lange Dateien auf schwachen
  Geräten die Vosk-Vorschau abschalten. Das Backend prüft die Dauer beim Dekodieren.

## Optional: beide Texte mit einem LLM zusammenführen

Ein laufendes [Ollama](https://docs.ollama.com/) mit einem bereits installierten,
für Deutsch geeigneten Chat-Modell genügt. In `.env` setzen:

```dotenv
OLLAMA_URL=http://127.0.0.1:11434
OLLAMA_MODEL=dein-installierter-modellname
```

Backend neu starten und Seite neu laden. Sobald beide Transkripte erfolgreich
vorliegen, wird **Mit LLM zusammenführen** verfügbar. Es sendet die beiden
Originaltexte an Ollama, nutzt Whisper als Basis und fordert konservative Korrekturen
sowie Markierung ungelöster Widersprüche an. Die gemeinsame Fassung ersetzt den
bearbeitbaren Text; die Originale bleiben erhalten. Bei einem LLM-Fehler bleibt der
bisherige Text bestehen. Das LLM hört kein Audio und kann Fehler hinzufügen;
deshalb ist sein Ergebnis als prüfbedürftig gekennzeichnet. Keine automatische
Wortfusion anhand der Scores, keine erfundenen LLM-Konfidenzwerte.

## Was die Werte bedeuten

Vosk liefert `conf`, Wortanfang und Wortende. Whisper liefert pro Wort `probability`
und Zeitstempel, pro Segment `avg_logprob`, `no_speech_prob`, `compression_ratio`
und `temperature`, außerdem erkannte Sprache und `language_probability`.
Diese Werte sind Modellindikatoren, keine kalibrierten Wahrscheinlichkeiten für
inhaltliche Richtigkeit. Die Werte der beiden Erkenner dürfen nicht direkt
gegeneinander aufgerechnet werden. Die orange Markierung bei Whisper-Werten unter
0,70 ist nur eine einfache Hilfe zum Nachhören.

## Prüfen und als eine Anwendung starten

```bash
uv run pytest
cd frontend
npm test
npm run build
cd ..
uv run uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

Nach dem Build liefert FastAPI auch das Frontend auf **http://127.0.0.1:8000** aus.
Vosk-Modell vor dem Build herunterladen, damit es mitkopiert wird. Falls das Backend
bereits läuft, nach dem Build neu starten. Für Tests werden Whisper-Inferenz und
Ollama gemockt; die Audio-Dekodierung wird tatsächlich ausgeführt.

Für die lokale Nutzung durch eine Person gedacht, ohne Authentifizierung.
Das Backend puffert Uploads temporär und schließt sie nach der Verarbeitung.
Die Bibliothek speichert Transkripte und aufbewahrte Originalaufnahmen im Browser.
Freigaben und Löschregeln betreffen diese Browserkopien. Browser-Modelle und
Whisper-Modellcache bleiben unabhängig davon bestehen.

## Mitwirken und Lizenz

Hinweise für Beiträge und Tests stehen in [CONTRIBUTING.md](CONTRIBUTING.md).
Die GitHub Actions prüfen Backend- und Frontend-Tests sowie den Angular-Build;
echte Modellinferenz und Training sind keine Bestandteile dieser CI-Prüfung.

Der eigene Quellcode und die Projektdokumentation stehen unter der
[BSD-3-Clause-Lizenz](LICENSE). Abhängigkeiten und heruntergeladene Modelle
behalten ihre jeweiligen Lizenzen. Insbesondere werden die Vosk-Modellgewichte
nicht durch die Projektlizenz neu lizenziert. Modellarchive, Aufnahmen,
Transkripte und lokale Konfiguration werden nicht im Repository mitgeliefert.

## Technische Quellen

- [vosk-browser: API und Modellformat](https://github.com/ccoreilly/vosk-browser/tree/master/lib)
- [Offizielle Vosk-Modelle und Lizenzen](https://alphacephei.com/vosk/models)
- [faster-whisper: Installation und Inferenz](https://github.com/SYSTRAN/faster-whisper)
- [Whisper-Datenfelder](https://github.com/SYSTRAN/faster-whisper/blob/master/faster_whisper/transcribe.py)
- [Ollama Chat-API](https://docs.ollama.com/api/chat)
- [Angular-Kompatibilität](https://angular.dev/reference/versions)
