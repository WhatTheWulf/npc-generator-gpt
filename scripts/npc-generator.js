// npc-generator.js
// Dieses Skript ermöglicht die Generierung von D&D5e NPCs und ihren Items über ChatGPT
// Es integriert sich als Button im Actors Directory von Foundry VTT.

class NPCGeneratorDialog extends FormApplication {
    static get defaultOptions() {
        // Standardoptionen für das FormApplication-Fenster
        return mergeObject(super.defaultOptions, {
            classes: ["form", "npc-generator"], // CSS-Klassen für Styling
            // Der Pfad zum HTML-Template. 'modules/MODUL-ID/pfad/zur/datei.html'
            // Die Modul-ID ist 'npc-generator-gpt', daher ist der Pfad korrekt.
            template: "modules/npc-generator-gpt/templates/npc-generator.html",
            width: 500, // Breite des Dialogfensters
            height: "auto", // Automatische Höhe
            title: "ChatGPT NPC Generator" // Titel des Dialogfensters
        });
    }

    // Eindeutige ID für dieses FormApplication-Fenster
    get id() {
        return "npc-generator-dialog";
    }

    // Methode zum Bereitstellen von Daten für das HTML-Template (hier keine spezifischen Daten benötigt)
    async getData() {
        return {};
    }

    // Aktiviert Event-Listener für Buttons im HTML-Template
    activateListeners(html) {
        super.activateListeners(html);
        // Listener für den "NPC generieren"-Button
        // Da 'html' hier bereits ein jQuery-Objekt ist (durch FormApplication), ist $(html) nicht nötig.
        html.find(".generate-button").click(this._onClickGenerate.bind(this));
        // Listener für den "OpenAI Schlüssel einstellen"-Button
        html.find(".openai-key-button").click(this._onClickOpenAIKeySettings.bind(this));
    }

    // Event-Handler für das Öffnen der OpenAI-API-Schlüssel-Einstellungen
    _onClickOpenAIKeySettings(event) {
        event.preventDefault();
        // Öffnet das allgemeine Einstellungsfenster von Foundry VTT
        new SettingsConfig().render(true);
        // Wartet kurz und klickt dann auf den "Moduleinstellungen"-Tab, um den Benutzer zu führen
        setTimeout(() => {
            const moduleSettingsTab = document.querySelector('nav.tabs a[data-tab="modules"]');
            if (moduleSettingsTab) {
                moduleSettingsTab.click();
            }
        }, 100);
    }

    // Event-Handler für den "NPC generieren"-Button
    async _onClickGenerate(event) {
        event.preventDefault();
        const formData = new FormData(this.form); // Erfasst Formulardaten
        const numNpcs = parseInt(formData.get("numNpcs")); // Anzahl der zu generierenden NPCs
        const userPromptText = formData.get("prompt").trim(); // Benutzerdefinierter Prompt
        const customModel = formData.get("customModel"); // Benutzerdefiniertes OpenAI-Modell
        const temperature = parseFloat(formData.get("temperature")); // Kreativität des Modells
        const topP = parseFloat(formData.get("topP")); // Diversität der Antworten

        // Validierung der Eingabe für die Anzahl der NPCs
        if (numNpcs <= 0) {
            ui.notifications.error("Die Anzahl der NPCs muss größer als 0 sein.");
            return;
        }

        // Überprüfung des OpenAI API Schlüssels
        const apiKey = game.settings.get("npc-generator-gpt", "openaiApiKey");
        if (!apiKey) {
            ui.notifications.error("OpenAI API Schlüssel nicht konfiguriert. Bitte gehe zu den Moduleinstellungen.");
            return;
        }

        // Auswahl des OpenAI Modells
        const model = customModel || game.settings.get("npc-generator-gpt", "openaiModel");
        if (!model) {
            ui.notifications.error("Kein OpenAI Modell ausgewählt. Bitte konfiguriere es in den Moduleinstellungen oder gib ein benutzerdefiniertes Modell an.");
            return;
        }

        // --- Feste Vorlage für ChatGPT mit D&D5e spezifischen Feldern ---
        // Diese Vorlage stellt sicher, dass ChatGPT die benötigten Daten im korrekten JSON-Format liegert.
        // Beachtet, dass Item-Daten in D&D5e unter 'system' statt 'data' liegen.
        // Listet alle gültigen Item-Typen des aktuellen D&D5e Systems auf.
        const dnd5eItemTypes = game.system.documentTypes.Item.join(', ');

        const basePrompt = `
Generate ${numNpcs} D&D5e NPCs as a JSON array. Each NPC must have the following structure:
- "name": String, the NPC's name.
- "type": String, the NPC type (for D&D5e usually "npc" or "character").
- "description": String, a short description of the NPC.
- "items": Array of Item objects.

Each Item object in the "items" array must have the following structure:
- "name": String, the item's name.
- "type": String, a valid D&D5e Item type (ONE of: ${dnd5eItemTypes}).
- "system": Object containing the D&D5e specific item data.

Examples for "system" data based on "type":

For "weapon":
  "system": {
    "description": {"value": "A description of the weapon."},
    "damage": {"parts": [["1d6", "piercing"]]}, // Example damage
    "range": {"value": 5, "long": 20, "units": "ft"},
    "properties": {"fin": true, "lgt": true} // Example: Finesse, Light
  }

For "equipment":
  "system": {
    "description": {"value": "A description of the equipment."},
    "armor": {"value": 12, "type": "light"} // Example: Armor value
  }

For "consumable":
  "system": {
    "description": {"value": "A description of the consumable."},
    "consumableType": "potion", // Or "scroll", "food", etc.
    "uses": {"value": 1, "max": 1, "per": "charges"}
  }

For "tool":
  "system": {
    "description": {"value": "A description of the tool."},
    "ability": "dex", // The ability associated with the tool
    "proficient": true
  }

For "spell":
  "system": {
    "description": {"value": "A description of the spell."},
    "level": 1,
    "school": "abj", // Or evn, nec, etc.
    "components": {"v": true, "s": true, "m": false},
    "preparation": {"mode": "prepared", "prepared": true}
  }

The response MUST be a valid JSON array containing only the generated NPCs.
`;

        // Kombiniert den festen Prompt mit dem optionalen benutzerdefinierten Prompt
        const finalPrompt = userPromptText ? `${userPromptText}\n\n${basePrompt}` : basePrompt;

        ui.notifications.info("Sende Anfrage an ChatGPT...");

        const url = "https://api.openai.com/v1/chat/completions";
        const headers = {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${apiKey}`
        };
        const body = JSON.stringify({
            model: model,
            messages: [{
                role: "user",
                content: finalPrompt
            }],
            temperature: temperature,
            top_p: topP,
            response_format: { "type": "json_object" } // Erzwingt JSON-Ausgabe von OpenAI (für neuere Modelle)
        });

        const requestOptions = {
            method: "POST",
            headers: headers,
            body: body
        };

        try {
            const response = await fetch(url, requestOptions);
            const data = await response.json();

            // Fehlerbehandlung für OpenAI API-Antworten
            if (data.error) {
                ui.notifications.error(`ChatGPT API Fehler: ${data.error.message}`);
                console.error("ChatGPT API Error:", data.error);
                return;
            }

            const result = data.choices[0].message.content;

            let generatedNpcsData;
            try {
                // Versucht, die Antwort als JSON zu parsen
                generatedNpcsData = JSON.parse(result);
                // Stellt sicher, dass das Ergebnis ein Array ist, auch wenn nur ein NPC generiert wurde
                if (!Array.isArray(generatedNpcsData)) {
                    generatedNpcsData = [generatedNpcsData];
                }
            } catch (parseError) {
                // Fehlerbehandlung, falls die JSON-Antwort ungültig ist
                ui.notifications.error("Fehler beim Parsen der JSON-Antwort von ChatGPT. Überprüfe den Prompt und das Antwortformat.");
                console.error("JSON Parse Error:", parseError);
                console.error("ChatGPT Raw Response:", result);
                return;
            }

            // --- DIREKTE ERSTELLUNG VON FOUNDRY VTT DOKUMENTEN ---
            for (const npcData of generatedNpcsData) {
                try {
                    // 1. Actor (NPC) erstellen
                    const actorType = npcData.type || "npc"; // Standardtyp "npc" für D&D5e
                    // Validierung des Actor-Typs gegen die System-definierten Typen
                    if (!game.system.documentTypes.Actor.includes(actorType)) {
                        ui.notifications.warn(`Ungültiger Actor-Typ "${actorType}" für NPC "${npcData.name || 'Unbekannt'}" ignoriert. Verwende stattdessen "npc".`);
                        npcData.type = "npc"; // Fallback auf gültigen Typ
                    }

                    const actor = await Actor.create({
                        name: npcData.name || "Unbekannter NPC",
                        type: actorType,
                        img: "icons/svg/mystery-man.svg", // Standard-Icon für den Actor
                        system: { // Die system-spezifischen Daten für D&D5e
                            details: {
                                biography: {
                                    value: npcData.description || "" // Beschreibung als Biografie
                                }
                            }
                            // Hier könnten weitere standardmäßige D&D5e NPC-Attribute hinzugefügt werden
                        }
                    });

                    ui.notifications.info(`NPC "${actor.name}" erfolgreich erstellt.`);
                    console.log(`Created Actor: ${actor.name}`, actor);

                    // 2. Items erstellen und zum Actor hinzufügen
                    if (npcData.items && Array.isArray(npcData.items)) {
                        const itemsToCreate = [];
                        const validItemTypes = game.system.documentTypes.Item; // Gültige Item-Typen des Systems

                        for (const item of npcData.items) {
                            // Prüfe, ob der Item-Typ gültig ist, bevor das Item erstellt wird
                            if (validItemTypes.includes(item.type)) {
                                itemsToCreate.push({
                                    name: item.name || "Unbenanntes Item",
                                    type: item.type,
                                    img: `icons/svg/${item.type}.svg`, // Versucht ein passendes Standard-Icon
                                    system: item.system || {} // Wichtig: 'system' für D&D5e Item-Daten
                                });
                            } else {
                                ui.notifications.warn(`Ungültiger Item-Typ "${item.type}" für "${item.name}" bei NPC "${npcData.name}" ignoriert. Gültige Typen sind: ${validItemTypes.join(', ')}`);
                                console.warn(`Invalid item type "${item.type}" for "${item.name}" of NPC "${npcData.name}". Skipped.`);
                            }
                        }

                        if (itemsToCreate.length > 0) {
                            await actor.createEmbeddedDocuments("Item", itemsToCreate);
                            ui.notifications.info(`Items für "${actor.name}" hinzugefügt.`);
                            console.log(`Created Items for ${actor.name}:`, itemsToCreate);
                        }
                    }

                } catch (creationError) {
                    // Fehlerbehandlung bei der Erstellung von Foundry VTT Dokumenten
                    ui.notifications.error(`Fehler beim Erstellen von NPC oder Items für "${npcData.name || 'Unbekannt'}": ${creationError.message}`);
                    console.error(`Error during NPC/Item creation for ${npcData.name || 'Unknown'}:`, creationError);
                }
            }

            ui.notifications.info("Alle generierten NPCs wurden erstellt!");
            this.close(); // Schließt den Dialog nach erfolgreicher Erstellung

        } catch (error) {
            // Allgemeine Fehlerbehandlung für den API-Aufruf
            ui.notifications.error(`Fehler während des API-Aufrufs: ${error.message}`);
            console.error("API Error:", error);
        }
    }
}

---

### Foundry VTT Hooks für Einstellungen und Benutzeroberflächen-Integration

// Wird während der Initialisierung von Foundry VTT ausgeführt. Registriert die Moduleinstellungen.
Hooks.on("init", () => {
    game.settings.register("npc-generator-gpt", "openaiApiKey", {
        name: "OpenAI API Schlüssel",
        hint: "Dein OpenAI API-Schlüssel (z.B. sk-XXXXXXXXXXXX). Kann hier generiert werden: platform.openai.com/account/api-keys",
        scope: "world", // Diese Einstellung ist Welt-spezifisch
        config: true, // Erscheint in den Foundry VTT Einstellungen
        type: String, // Datentyp der Einstellung
        default: "" // Standardwert
    });

    game.settings.register("npc-generator-gpt", "openaiModel", {
        name: "OpenAI Modell",
        hint: "Das Standardmodell, das für die Generierung verwendet werden soll (z.B. gpt-4o, gpt-3.5-turbo).",
        scope: "world",
        config: true,
        type: String,
        choices: { // Dropdown-Auswahl für Modelle
            "gpt-4o": "GPT-4o (Empfohlen)",
            "gpt-4-turbo": "GPT-4 Turbo",
            "gpt-3.5-turbo": "GPT-3.5 Turbo",
            // Füge hier weitere Modelle hinzu, die du unterstützen möchtest
        },
        default: "gpt-4o" // Standardmodell
    });
});

Hooks.on("renderActorDirectory", (app, html, data) => {
    // Stellen Sie sicher, dass 'html' ein jQuery-Objekt ist,
    // da Foundry VTT v13 jetzt native DOM-Elemente übergibt.
    const jQ_html = $(html);

    // Erstelle den Button
    const npcGeneratorButton = $(`
        <button type="button" class="create-chatgpt-npc-button" data-action="createChatGPTNpc">
            <i class="fas fa-robot"></i> ChatGPT NPCs
        </button>
    `);

    // Versuche, den Standardplatz zu nutzen:
    // Sucht zuerst nach dem neuen data-action="createEntry" und dann nach dem älteren "create".
    const createActorButton = jQ_html.find('button[data-action="createEntry"], button[data-action="create"]');
    if (createActorButton.length > 0) {
        // Fügt unseren Button direkt vor dem gefundenen "Create Actor"-Button ein
        createActorButton.before(npcGeneratorButton);
    } else {
        // Alternativer Platzierungspfad, falls der "Create Actor" Button nicht gefunden wird.
        // Versuche, den Button am Ende des '.directory-header' zu platzieren.
        const directoryHeader = jQ_html.find('.directory-header');
        if (directoryHeader.length > 0) {
            directoryHeader.append(npcGeneratorButton); // Fügt den Button am Ende des Headers hinzu
        } else {
            // Als absolute Fallback-Maßnahme: Versuche, den Button direkt am Anfang der .directory-list zu platzieren.
            // Dies ist ein eher unwahrscheinlicher, aber robuster Fallback für extreme UI-Änderungen.
            jQ_html.find('.directory-list').prepend(npcGeneratorButton);
            console.warn("NPC Generator GPT | Placed button in '.directory-list' as no better location found.");
        }
    }

    // Fügt den Event Listener hinzu, um den Dialog zu öffnen, wenn der Button geklickt wird.
    // .on("click") ist oft robuster für dynamisch eingefügte Elemente als .click().
    npcGeneratorButton.on("click", () => {
        new NPCGeneratorDialog().render(true);
    });
});

// Wird ausgeführt, sobald Foundry VTT vollständig geladen und bereit ist.
Hooks.on("ready", () => {
    console.log("NPC Generator GPT | Ready!");
    // Zeigt eine Warnung an, wenn das Modul nicht mit dem D&D5e-System verwendet wird.
    if (game.system.id !== "dnd5e") {
        ui.notifications.warn("NPC Generator GPT Modul ist für das D&D5e System optimiert. Es kann bei anderen Systemen zu unerwartetem Verhalten oder Fehlern kommen.");
    }
});
