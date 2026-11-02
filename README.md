# Tinkercad SpaceMouse for Mac

A Chrome extension that lets you navigate the [Tinkercad](https://www.tinkercad.com) 3D editor with a **3Dconnexion SpaceMouse on macOS**: orbit, pan and zoom, plus a button to fit the view.

The existing Tinkercad SpaceMouse extensions rely on the browser's Gamepad API, which does not see the SpaceMouse on a Mac. This extension takes a different route: it talks to the official **3Dconnexion driver (3DxWare)** through the driver's local web interface, the same mechanism that browser CAD tools such as Onshape use.

> Unofficial project. Not affiliated with or endorsed by Autodesk or 3Dconnexion.

*Deutsche Anleitung weiter unten.*

---

## Requirements

- macOS with the **3Dconnexion driver (3DxWare 10)** installed and running
- **Google Chrome** (or another Chromium browser that supports unpacked extensions)
- Tested with a **SpaceMouse Wireless**; other 3Dconnexion devices should work as well

## Installation

1. Download this repository (green **Code** button → **Download ZIP**) and unzip it.
2. Open `chrome://extensions` and turn on **Developer mode** (top right).
3. Click **Load unpacked** and select the `extension` folder.
4. Open a design in Tinkercad. A small panel appears in the bottom-left corner and should say **"Mit Treiber verbunden"** (connected to driver).

## Usage

| SpaceMouse | Tinkercad |
|---|---|
| Twist / tilt the cap | Orbit |
| Slide the cap sideways / lift and press | Pan |
| Push / pull the cap | Zoom |
| Button mapped to the key **F** | Fit view (selection, or everything if nothing is selected) |

**Setting up the fit button:** open the 3Dconnexion settings while Chrome/Tinkercad is in front (so the profile at the top shows Chrome or Tinkercad), go to **Buttons**, and assign the keystroke **F** to one of the buttons (via a keystroke entry or a macro).

Speed and direction of each movement can be adjusted in the panel. General sensitivity is set in the 3Dconnexion settings.

## Good to know

- **Yellow "debugging this browser" bar:** Tinkercad only zooms on *real* mouse-wheel input and ignores synthetic events. The extension therefore sends the zoom through Chrome's debugger interface, and Chrome shows this notice while it is active. You can leave it open. If you press *Cancel*, it reconnects on the next zoom.
- **Rotation does nothing:** check the 3Dconnexion profile for Chrome/Tinkercad. Rotation axes may be disabled there (Axes/Device tab, or the rotation toggle in the radial menu). *Use Defaults* resets the profile.
- **Not connected:** make sure 3DxWare is running. Opening `https://127.51.68.120:8181/3dconnexion/nlproxy` in Chrome should show a short line containing `"port"`.
- Orbit and pan are sent to Tinkercad as emulated mouse drags, so orbit and zoom do not happen at the same time.

## How it works

- `bg.js` connects to the 3DxWare navigation server (WAMP over a local WebSocket), reports a virtual camera to the driver and converts the driver's camera updates into orbit / pan / zoom deltas.
- `content.js` turns these deltas into right-drag (orbit) and middle-drag (pan) mouse gestures on the Tinkercad canvas and draws the settings panel.
- Zoom and the fit key are delivered as trusted input through `chrome.debugger`.

Thanks to [schwa/SpaceMouse](https://github.com/schwa/SpaceMouse) for documenting the 3DxWare WebSocket protocol.

---

## Deutsch

Eine Chrome-Erweiterung, mit der du den 3D-Editor von [Tinkercad](https://www.tinkercad.com) **auf dem Mac mit einer 3Dconnexion SpaceMouse** steuern kannst: drehen, verschieben, zoomen und per Taste die Ansicht einpassen.

Die bisherigen Tinkercad-SpaceMouse-Erweiterungen nutzen die Gamepad-Schnittstelle des Browsers. Die erkennt die SpaceMouse auf dem Mac nicht. Diese Erweiterung holt die Bewegungen stattdessen vom offiziellen **3Dconnexion-Treiber (3DxWare)**, über dieselbe Schnittstelle, die z. B. Onshape im Browser nutzt.

> Inoffizielles Projekt, nicht von Autodesk oder 3Dconnexion.

### Voraussetzungen

- macOS mit installiertem **3Dconnexion-Treiber (3DxWare 10)**
- **Google Chrome** (oder ein anderer Chromium-Browser)
- Getestet mit der **SpaceMouse Wireless**

### Installation

1. Dieses Repository herunterladen (grüner Knopf **Code** → **Download ZIP**) und entpacken.
2. `chrome://extensions` öffnen und oben rechts den **Entwicklermodus** einschalten.
3. **Entpackte Erweiterung laden** und den Ordner `extension` wählen.
4. Ein Design in Tinkercad öffnen. Unten links erscheint ein Panel mit **„Mit Treiber verbunden“**.

### Bedienung

| SpaceMouse | Tinkercad |
|---|---|
| Kappe verdrehen / kippen | Drehen |
| Kappe seitlich schieben / hochziehen und drücken | Verschieben |
| Kappe vor / zurück schieben | Zoomen |
| Taste mit Tastendruck **F** belegt | Ansicht einpassen (Auswahl oder alles) |

**Taste einrichten:** 3Dconnexion-Einstellungen öffnen, während Chrome/Tinkercad im Vordergrund ist (oben steht dann das Chrome- bzw. Tinkercad-Profil), Reiter **Buttons**, einer Taste den Tastendruck **F** zuweisen (als Tastenanschlag oder Makro).

Tempo und Richtung stellst du im Panel ein, die allgemeine Empfindlichkeit in den 3Dconnexion-Einstellungen.

### Gut zu wissen

- **Gelber Hinweis „debugging this browser“:** Tinkercad zoomt nur bei *echten* Mausrad-Eingaben. Deshalb läuft der Zoom über Chromes Debugger-Schnittstelle, und Chrome zeigt diesen Hinweis an. Einfach stehen lassen.
- **Drehen geht nicht:** Im 3Dconnexion-Profil für Chrome/Tinkercad könnten die Drehachsen ausgeschaltet sein. *Use Defaults* setzt das Profil zurück.
- **Keine Verbindung:** Prüfen, ob 3DxWare läuft. `https://127.51.68.120:8181/3dconnexion/nlproxy` in Chrome sollte eine kurze Zeile mit `"port"` zeigen.

### Lizenz

MIT, siehe [LICENSE](LICENSE).
