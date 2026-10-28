# StimmenClon Studio

Eine schlanke, vollständig **lokale** Web-App, mit der du deine eigene Stimme für ein
späteres Voice-Cloning-Projekt aufnimmst.

> **Die Aufnahmen bleiben auf diesem Gerät, bis du sie selbst herunterlädst oder löschst.
> Es erfolgt kein automatischer Upload.**

> **Verwende ausschließlich deine eigene Stimme oder eine Stimme, für deren Nutzung du eine
> ausdrückliche Einwilligung besitzt.**

**Umfang dieser Version:** ausschließlich die Aufnahme-App. Es gibt **keine** Verbindung zu
einem Voice-Cloning-Anbieter, **keinen** automatischen Upload und **keine** Veröffentlichung
von Audiodateien.

*Kein Upload · WAV 48 kHz / 16 Bit / Mono · keine Abhängigkeiten · offline nutzbar*

---

## 1. Schnellstart

Die App besteht aus reinen HTML-, CSS- und JavaScript-Dateien – ohne Build-Schritt,
ohne Framework, ohne `npm install`, ohne externe Bibliotheken.

### Variante A: mit Python (überall vorhanden)

```bash
cd StimmenClon
python3 -m http.server 8000
```

Danach im Browser öffnen: **<http://localhost:8000>**

### Variante B: mit Node.js

```bash
cd StimmenClon
npm start          # startet python3 -m http.server 8000
# oder, ohne Python:
npm run start:node # startet den mitgelieferten server.js
```

### Variante C: mit npx (einmalig Internet nötig)

```bash
cd StimmenClon
npx serve . -l 8000
```

> **Wichtig:** Öffne die App über `http://localhost:8000` – **nicht** per Doppelklick als
> `file:///…/index.html`. Browser erlauben das Mikrofon nur in einem „sicheren Kontext“
> (HTTPS oder `localhost`). Bei `file://` bleibt der Mikrofon-Button wirkungslos.

Der mitgelieferte `server.js` liefert **nur** statische Dateien aus. Er hat keine
Upload-Schnittstelle und speichert nichts.

### Warum verlangt der Browser HTTPS?

Browser erlauben das Mikrofon nur in einem „sicheren Kontext“. Das ist erfüllt bei
`https://…` **und** bei `http://localhost`. Blockiert der Browser den Zugriff, liegt es fast
immer an einer dieser Ursachen:

| Ursache | Lösung |
| --- | --- |
| Seite über `file://` geöffnet | lokalen Server starten (Abschnitt 1) |
| `http://` mit IP oder Hostname, z. B. `http://192.168.1.20:8000` | HTTPS nutzen (siehe unten) oder `localhost` am aufnehmenden Gerät |
| App läuft in einem eingebetteten Frame/Vorschau | Seite in einem eigenen Tab öffnen – Frames brauchen zusätzlich `allow="microphone"` |
| Zugriff zuvor „blockiert“ | Schloss-Symbol in der Adressleiste → Mikrofon erlauben, Seite neu laden |

Am PC genügt `http://localhost:8000`. Für Smartphone, Tablet oder Zugriff aus dem Netz brauchst
du echtes HTTPS – dafür liegen zwei Wege bereit:

**GitHub Pages** (kostenlos, Datei `.github/workflows/deploy-pages.yml` ist enthalten):

1. Repository → **Settings → Pages** → bei *Source* „**GitHub Actions**“ wählen.
2. Ein Push auf `main` (oder „Run workflow“ im Actions-Tab) veröffentlicht die App.
3. Adresse: `https://<benutzer>.github.io/StimmenClon/` – HTTPS inklusive.

Der Workflow kopiert ausschließlich `index.html`, `styles.css` und `js/` in die Veröffentlichung.
Es werden keine Audiodateien hochgeladen und keine Aufnahmen gespeichert.

**Vercel / Netlify** funktionieren ebenso: Repository importieren, Framework „Other“, kein Build-
Command, Output-Verzeichnis `.` (die App ist bereits statisch). Achte bei Vercel darauf, den
Deployment-Schutz („Vercel Authentication“) zu deaktivieren, sonst ist die Seite nur nach Login
erreichbar.

> Hinweis: Auf einer veröffentlichten HTTPS-Adresse werden nur die Programmdateien gehostet.
> Aufnahmen entstehen im Browser des jeweiligen Geräts und bleiben dort – der Hosting-Anbieter
> bekommt keine Audiodaten zu sehen.

---

## 2. Funktionen

| Bereich | Umsetzung |
| --- | --- |
| Mikrofonauswahl | Geräteliste mit allen Eingängen, Wechsel jederzeit möglich (außer während einer Aufnahme) |
| Zustimmung | `getUserMedia` wird **erst** nach Klick auf „Mikrofonzugriff erlauben“ angefordert |
| Pegelanzeige | Live-Pegel in dBFS, Spitzenwert-Halteanzeige, Skala von −60 bis 0 dB |
| Übersteuerung | Warnung bei Sample-Werten ≥ 0,999 (also praktisch Vollaussteuerung), Zähler pro Take |
| Aufnahme | Start, Pause, Fortsetzen, Beenden – per Maus, Touch oder Tastatur |
| Dauer | Live-Timer mit Zehntelsekunden, Fortschrittsbalken bis zur wählbaren Zielzeit (1–30 min) |
| Länge | mindestens 10 Minuten pro Take; auf Geräten mit viel RAM bis 60 Minuten (siehe Abschnitt 9) |
| Anhören | integrierter Player pro Take |
| Download | einzelne Takes als `.wav`, alle Takes gesammelt als `.zip` |
| Verwaltung | nummerierte Takes, Löschen einzeln oder komplett |
| Persistenz | Takes überleben ein Neuladen der Seite (IndexedDB des Browsers) |
| Sprechtext | zwei deutsche Beispieltexte direkt in der App |
| Design | dunkel, warme Goldakzente, große Aufnahmetaste, responsive ab 320 px Breite |
| Barrierefreiheit | vollständige Tastaturbedienung, Fokusrahmen, ARIA-Labels, Live-Regionen, `prefers-reduced-motion`, `prefers-contrast` |

### Tastaturkürzel

| Taste | Funktion |
| --- | --- |
| `R` | Aufnahme starten bzw. beenden |
| `Leertaste` | Pause / Fortsetzen |
| `Esc` | Aufnahme beenden |
| `Tab` / `Shift+Tab` | durch alle Bedienelemente navigieren |

Kürzel greifen nicht, während du in einem Auswahlfeld oder auf einem Button bist – dort
behält die Leertaste ihre native Funktion.

---

## 3. Audioqualität

Die Aufnahme wird bewusst so roh wie möglich gespeichert:

* **Mono**, **48.000 Hz**, **16 Bit**, **PCM-WAV** (unkomprimiert)
* **keine** Rauschunterdrückung, **kein** Echo-Cancel, **keine** Sprachverbesserung,
  **keine** Effekte, **keine** automatische Lautstärkeveränderung
* keine Normalisierung, keine Kompression, kein Limiter, kein Gate

Um das zu erreichen, fordert die App beim Mikrofonzugriff explizit an:

```js
{
  channelCount: { ideal: 1 },
  sampleRate: { ideal: 48000 },
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: false
}
```

Zusätzlich wird ein `AudioContext` mit `sampleRate: 48000` erstellt. Die Samples werden in
einem `AudioWorklet` (Fallback: `ScriptProcessorNode`) **unverändert** in 16-Bit-Integer
umgewandelt und blockweise in den Hauptthread übertragen – ohne Filterkette.

Unter „Technische Details“ in der App siehst du jederzeit, welche Rate das Mikrofon liefert
und ob der Browser eine der Verarbeitungen trotzdem aktiviert hat. Falls dein Betriebssystem
oder Treiber eine dieser Funktionen erzwingt, steht dort ein Hinweis – dann lohnt ein Blick in
die Systemeinstellungen deines Mikrofons.

### Dateigröße

48 kHz · 16 Bit · Mono entsprechen **96 kB pro Sekunde** bzw. **ca. 5,8 MB pro Minute**:

| Länge | Größe (WAV) |
| --- | --- |
| 1 Minute | ca. 5,8 MB |
| 10 Minuten | ca. 58 MB |
| 30 Minuten | ca. 173 MB |

### Ergebnis prüfen (optional)

```bash
ffprobe stimme-take-01.wav
# Stream #0:0: Audio: pcm_s16le, 48000 Hz, mono, s16

python3 - <<'PY'
import wave
w = wave.open('stimme-take-01.wav')
print(w.getnchannels(), 'Kanal', w.getframerate(), 'Hz', w.getsampwidth() * 8, 'Bit')
w.close()
PY
```

---

## 4. Bedienung in fünf Schritten

1. **Mikrofon wählen** (optional) – im Auswahlfeld unter „Aufnahme“. Der Gerätename wird erst
   sichtbar, wenn du den Zugriff erlaubt hast (Browser-Vorgabe, kein Fehler der App).
2. **„Mikrofonzugriff erlauben“** klicken und im Browser-Dialog zustimmen.
   Bei „Blockieren“ wird nichts aufgenommen – du kannst es über das Schloss-Symbol in der
   Adressleiste korrigieren.
3. **Pegel prüfen** – sprich probeweise. Gute Aussteuerung: Ausschläge zwischen −18 und −6 dB,
   die Warnung „Übersteuerung erkannt“ darf nicht erscheinen.
4. **Aufnahmetaste** drücken. Mit **Pause** unterbrichst du, mit **Fortsetzen** machst du
   weiter, mit **Beenden** schließt du den Take ab. Pausen werden **nicht** mitgeschnitten.
5. **Anhören, herunterladen, löschen** – im Bereich „Aufnahmen“ unterhalb des Studios.

Mehrere Takes werden automatisch als `Take 01`, `Take 02`, … nummeriert. Die Nummer findest du
auch im Dateinamen wieder.

---

## 5. Wo werden die WAV-Dateien gespeichert?

Kurz gesagt: **zuerst nur im Arbeitsspeicher deines Browsers, dann in der lokalen
Browser-Datenbank – und erst auf deinem Laufwerk, wenn du selbst exportierst.**

### Während der Aufnahme

Die Audiodaten liegen als 16-Bit-Blöcke im Arbeitsspeicher des Browser-Tabs. Es gibt keinen
Server, an den etwas gesendet werden könnte: Die Seite blockiert Netzwerkverbindungen aktiv
per Content-Security-Policy (`connect-src 'none'`).

### Nach dem Beenden eines Takes

Der Take wird als WAV im Speicher erzeugt und zusätzlich in der **IndexedDB** deines Browsers
abgelegt (Datenbank `stimmenclon-studio`, Objektspeicher `takes`). Das ist eine lokale
Datenbank, die zum Browserprofil auf **deinem** Gerät gehört. Deshalb bleiben die Takes nach
einem Neuladen der Seite erhalten – auch ohne Internetverbindung.

Die Daten liegen nicht in einem normalen Ordner, den du im Dateimanager siehst. Ansehen,
prüfen und weiterverwenden kannst du sie über den Download in der App.

### Beim Herunterladen

* **„WAV herunterladen“** speichert `stimme-take-01.wav` in den Download-Ordner deines Systems
  (Windows: `C:\Users\<Name>\Downloads`, macOS/Linux: `~/Downloads`, Smartphone: „Downloads“
  bzw. „Dateien“). Der Ort lässt sich im Browser-Dialog ändern, wenn du „Nach dem Download
  fragen“ aktiviert hast.
* **„Alle als ZIP exportieren“** erzeugt `stimmenclon-takes_JJJJ-MM-TT.zip`. Das Archiv
  enthält alle Takes als WAV sowie eine `README.txt` mit Formatangaben. ZIP-Datei
  herunterladen, dann entpacken (Windows: Rechtsklick → „Alle extrahieren“, macOS:
  Doppelklick, Linux/Android: „Extrahieren“).
* Das ZIP ist **ungepackt** gespeichert (Methode „STORE“), weil WAV-Daten sich praktisch nicht
  komprimieren lassen. Die WAV-Dateien darin sind bitgenau identisch mit den Einzel-Downloads.

### Beim Löschen

„Löschen“ entfernt den Take aus der Liste und aus der IndexedDB. Bereits heruntergeladene
Dateien bleiben natürlich in deinem Download-Ordner, bis du sie dort selbst löschst. Mit
„Alle löschen“ wird die lokale Take-Liste vollständig geleert.

### Wenn du den Browser-Speicher leerst

„Websitedaten löschen“ im Browser entfernt auch die gespeicherten Takes. Lade wichtige
Aufnahmen vorher herunter. Ist der Speicher voll oder blockiert (z. B. privates Fenster in
manchen Browsern), zeigt die App einen Hinweis und hält die Takes nur im Arbeitsspeicher.

---

## 6. Browser-Kompatibilität

| Browser | Aufnahme | Hinweise |
| --- | --- | --- |
| **Chrome / Edge 94+** (Desktop, Android) | ✅ vollständig | AudioWorklet, IndexedDB, WAV-Player; beste Wahl |
| **Firefox 100+** (Desktop, Android) | ✅ vollständig | AudioWorklet; Gerätenamen erscheinen nach Freigabe |
| **Safari 15+** (macOS) | ✅ vollständig | ggf. Fallback auf `ScriptProcessorNode` |
| **Safari iOS 15+** | ✅ meist vollständig | Aufnahme im Vordergrund; bei gesperrtem Bildschirm oder App-Wechsel kann iOS die Aufnahme unterbrechen |
| Chrome iOS / Firefox iOS | ⚠️ eingeschränkt | nutzen WebKit; Aufnahme funktioniert, Hintergrundverhalten wie Safari |
| Internet Explorer | ❌ | nicht unterstützt |
| ältere Browser ohne `getUserMedia` | ❌ | die App zeigt einen entsprechenden Hinweis |

**Voraussetzungen**

* **Sicherer Kontext:** `https://…` oder `http://localhost` – bei `file://` blockieren alle
  gängigen Browser das Mikrofon. Deshalb der lokale Server aus Abschnitt 1.
* **Berechtigung:** Der Browser fragt einmal pro Seite/Origin. Danach merkt er sich die
  Entscheidung.
* **Mikrofon im System:** muss vorhanden und für den Browser freigegeben sein (Windows:
  Einstellungen → Datenschutz → Mikrofon; macOS: Systemeinstellungen → Datenschutz &
  Sicherheit → Mikrofon; Linux: PipeWire/PulseAudio).
* **Autoplay-Regel:** Der `AudioContext` wird erst nach deinem Klick erzeugt – das ist Absicht
  und verhindert, dass der Browser die Aufnahme stillschweigend blockiert.

**Bekannte Eigenheiten**

* **Gerätenamen fehlen anfangs:** Das ist Datenschutz des Browsers – Namen erscheinen erst
  nach erteilter Freigabe.
* **Mikrofon liefert 44,1 kHz:** Manche Geräte können nur 44,1 kHz. Der Browser rechnet dann
  auf die 48 kHz des AudioContext um; die App weist unter „Technische Details“ darauf hin.
  Für einen sauberen Datensatz ist ein Mikrofon, das nativ 48 kHz liefert, die bessere Wahl.
* **Erzwungene Verarbeitung:** Einige Treiber aktivieren Echo- bzw. Rauschunterdrückung
  unabhängig von der Anfrage. Die App zeigt das an; schalte es zusätzlich im System aus.
* **Sehr lange Takes:** Der Arbeitsspeicher begrenzt die Länge (siehe Abschnitt 9).
* **Privates Fenster:** IndexedDB kann dort eingeschränkt sein; die App weist dann darauf hin,
  dass Takes nur bis zum Schließen des Tabs erhalten bleiben.

---

## 7. Anleitung für saubere Sprachaufnahmen

**Raum**

* Kleiner, möblierter Raum mit Teppich, Vorhängen, Bücherregal oder Bett – weiche Flächen
  schlucken Hall.
* Keine parallelen, kahlen Wände; nicht im Badezimmer oder Flur aufnehmen.
* Lüftung, Kühlschrank, Heizung und Lüfter ausschalten. Handy stummschalten, Musik aus.
* Fenster schließen: Straßenlärm ist später nicht mehr zu entfernen.

**Mikrofon**

* Abstand **15–25 cm**, leicht seitlich am Mund vorbei (nicht direkt hinein) – das reduziert
  harte S-, P- und Atemgeräusche.
* Ein USB-Mikrofon oder Headset klingt deutlich besser als das eingebaute Laptop-Mikrofon.
* Mikrofonständer oder Buch unterlegen, nicht in der Hand halten (Körperschall, Griffgeräusche).
* Popfilter oder ein Stück Schaumstoff vor dem Mikrofon hilft gegen Plosive.

**Pegel**

* Zielkorridor: **−18 bis −6 dBFS** bei normaler Sprechlautstärke.
* Nie im roten Bereich: Übersteuerung ist irreversibel und macht Takes fürs Training unbrauchbar.
* Etwas zu leise ist besser als zu laut – aber nicht zu leise, sonst rauscht es relativ stark.
* Vor jedem Take 5 Sekunden Probe sprechen und den Pegel prüfen.

**Sprechen**

* Aufrecht sitzen, ruhig atmen, in natürlicher Tonhöhe und normalem Tempo sprechen.
* Nach jedem Satz oder Absatz **2–3 Sekunden Pause** – das erleichtert das spätere Schneiden.
* Lippengeräusche und Zungenschnalzen vermeiden; vor dem Take einen Schluck Wasser trinken.
* Kein Flüstern, kein Schreien, keine „Vorlese-Stimme“: nimm die Stimme auf, die du später
  klonen möchtest.
* Mindestens **5–10 Minuten** saubere Sprache pro Takesammlung sind eine gute Basis;
  mehr Vielfalt (Fragen, Zahlen, Emotionen) verbessert das Ergebnis.

**Takes**

* Lieber **mehrere kurze Takes** (3–5 Minuten) als ein sehr langer, in dem etwas schiefgeht.
* Versprecher: kurze Pause, Satz komplett wiederholen – nicht mitten im Wort neu ansetzen.
* Nach jedem Take anhören: Rauschen, Hall, Übersteuerung und Störgeräusche prüfen.
* Dateien sofort herunterladen und zusätzlich an einem zweiten Ort sichern.

---

## 8. Beispieltext zum Einsprechen

Der Text ist auch direkt in der App hinterlegt (Umschalter „Text A“ / „Text B“).

### Text A – neutral und deutlich (ca. 2 Minuten)

> Guten Tag. Ich spreche jetzt einige Sätze ein, damit meine Stimme klar und deutlich
> aufgenommen wird. Ich sitze aufrecht, halte einen ruhigen Abstand zum Mikrofon und spreche in
> gleichmäßigem Tempo.
>
> Zwölf große Würfel lagen neben dem offenen Fenster, während draußen leise der Regen fiel.
> Jürgen fuhr mit dem Fahrrad über die Brücke, grüßte die Nachbarin und lächelte über den kleinen
> Hund, der fröhlich durch die Pfützen sprang.
>
> Eine gute Aufnahme braucht keine Eile. Ich atme ruhig, mache nach jedem Satz eine kurze Pause
> und beginne den nächsten Satz erst, wenn ich wieder Luft geholt habe. So bleiben die Wörter
> sauber getrennt und später gut zu bearbeiten.
>
> Im Jahr 2026 sind schnelle Verbindungen selbstverständlich. Trotzdem prüfe ich jede Zahl
> zweimal: siebenundzwanzig, dreiundvierzig, einhundertfünf, neunhundertneunundneunzig. Zahlen
> sind ein guter Test für eine deutliche Aussprache.
>
> Zum Schluss lese ich noch eine Frage vor: Möchtest du die Aufnahme jetzt anhören, erneut
> einsprechen oder als WAV-Datei sichern? Jede dieser Möglichkeiten steht dir jederzeit offen,
> und nichts davon verlässt dieses Gerät.

### Text B – ruhig und erzählend (ca. 2 Minuten)

> Meine Stimme ist heute ruhig und ausgeruht. Ich spreche langsam, deutlich und in natürlicher
> Tonhöhe, so wie ich auch im Gespräch mit Freunden sprechen würde.
>
> Am frühen Morgen lag Nebel über den Feldern. Die Straßen waren still, nur ein einzelner Vogel
> sang, und der Kaffee dampfte in der Tasse. Ich mag diese Stunden, in denen die Welt noch
> schläft und alles langsam beginnt.
>
> Emotion entsteht durch kleine Unterschiede: ein leichtes Heben der Stimme, eine kurze Pause,
> ein freundliches Lächeln im Klang. Ich lasse den Sätzen Zeit und betone nicht jedes Wort gleich
> stark.
>
> Äpfel, Öl, Übermut, Eis, Augen, Eule – fünf Vokale, viele Möglichkeiten. Ich spreche sie
> deutlich und ohne zu übertreiben, denn natürlich klingt besser als künstlich.
>
> Ich beende den Text mit einem ruhigen Satz: Danke, dass du dir Zeit nimmst, deine Stimme
> sorgfältig aufzunehmen. Sie ist etwas Persönliches, und sie verdient eine gute Aufnahme.

Tipp: Lies den Text mehrmals. Wenn du dich sicher fühlst, klingt die Aufnahme entspannter –
und genau so sollte die Stimme im Datensatz später klingen.

---

## 9. Datenschutz und Grenzen

**Was die App technisch garantiert**

* Kein `fetch`, kein `XMLHttpRequest`, kein WebSocket, kein Beacon: Die Content-Security-Policy
  setzt `connect-src 'none'`.
* Keine externen Schriften, Skripte, Bibliotheken oder Tracker. Alles ist lokal eingebunden.
* Keine Analyse, keine Cookies, kein Login.
* Audio wird ausschließlich über die lokale Blob-URL im Browser abgespielt.

**Was du selbst beachten musst**

* Nur die eigene Stimme aufnehmen – oder eine Stimme, für deren Nutzung du eine ausdrückliche
  Einwilligung hast. Das gilt auch für eingesprochene Texte Dritter.
* Die Stimme ist ein personenbezogenes Datum. Bewahre die WAV-Dateien sicher auf und teile sie
  nur mit Stellen, denen du vertraust.
* Ein Voice-Cloning-Modell darf nicht dazu genutzt werden, Menschen zu täuschen oder Inhalte in
  ihrem Namen zu verbreiten.

**Grenzen dieser Version**

* Es gibt **keine** Cloud, **keinen** Upload und **keine** Anbindung an einen Cloning-Anbieter.
* Sehr lange Takes kosten Arbeitsspeicher. Die App begrenzt einen Take auf 60 Minuten, auf
  Geräten mit wenig RAM (≤ 4 GB) auf 20 Minuten. Für Datensätze sind mehrere Takes von 3–10
  Minuten die bessere Wahl.
* Ein Tab-Wechsel oder Standby kann auf Smartphones die Aufnahme unterbrechen. Lass den
  Bildschirm während der Aufnahme an.
* Aufnahmen lassen sich nicht nachträglich zuschneiden – lieber neu einsprechen.

---

## 10. Projektstruktur

```
StimmenClon/
├── index.html            Aufbau der Oberfläche (deutsch, semantisch, ARIA)
├── styles.css            dunkles Design mit Goldakzenten, responsive
├── js/
│   ├── app.js            Zustandslogik: Mikrofon, Aufnahme, Takes, Export, Tastatur
│   ├── wav.js            WAV-Encoder (PCM 16 Bit, ohne Kopie der Audiodaten)
│   ├── zip.js            ZIP-Writer (Methode STORE, ohne Abhängigkeiten)
│   ├── db.js             IndexedDB-Ablage der Takes
│   └── worklet-source.js AudioWorklet-Prozessor (sampelgenaue Übernahme)
├── server.js             optionaler statischer Dev-Server (keine Upload-Schnittstelle)
├── package.json          Startskripte
└── README.md             diese Datei
```

**Nächste Schritte (bewusst noch nicht enthalten):** Datensatzprüfung (Rauschabstand,
Sprachanteil), Zuschneiden und Segmentieren, Transkription, Training bzw. Anbindung eines
Cloning-Dienstes – jeweils nur mit ausdrücklicher Zustimmung und ohne automatischen Upload.

---

## 11. Lizenz

Für den privaten Gebrauch erstellt. Es ist keine Open-Source-Lizenz hinterlegt – nutze den
Code im Rahmen deines eigenen Projekts.
