// npc-generator.js
// Basierend auf https://raw.githubusercontent.com/WhatTheWulf/npc-generator-gpt/refs/heads/main/scripts/npc-generator.js
// Angepasst für direkten Import in Foundry VTT 13 mit vordefinierter ChatGPT-Datenstruktur
// Button im Actors Directory platziert

class NPCGeneratorDialog extends FormApplication {
    static get defaultOptions() {
        return mergeObject(super.defaultOptions, {
            classes: ["form", "npc-generator"],
            // Der Pfad zum HTML-Template ist korrekt, da die Modul-ID "npc-generator-gpt" ist
            template: "modules/npc-generator-gpt/templates/npc-generator.html",
            width: 500,
            height: "auto",
            title: "ChatGPT NPC Generator"
        });
    }

    get id() {
        return "npc-generator-dialog";
    }

    async getData() {
        return {};
    }

    activateListeners(html) {
        super.activateListeners(html);
        html.find(".generate-button").click(this._onClickGenerate.bind(this));
        html.find(".openai-key-button").click(this._onClickOpenAIKeySettings.bind(this));
    }

    _onClickOpenAIKeySettings(event) {
        event.preventDefault();
        new SettingsConfig().render(true);
        setTimeout(() => {
            const moduleSettingsTab = document.querySelector('nav.tabs a[data-tab="modules"]');
            if (moduleSettingsTab) {
                moduleSettingsTab.click();
            }
        }, 100);
    }

    async _onClickGenerate(event) {
        event.preventDefault();
        const formData = new FormData(this.form);
        const numNpcs = parseInt(formData.get("numNpcs"));
        const userPromptText = formData.get("prompt").trim(); // Benutzerdefinierter Prompt
        const customModel = formData.get("customModel");
        const temperature = parseFloat(formData.get("temperature"));
        const topP = parseFloat(formData.get("topP"));

        if (numNpcs <= 0) {
            ui.notifications.error("Die Anzahl der NPCs muss größer als 0 sein.");
            return;
        }

        const apiKey = game.settings.get("npc-generator-gpt", "openaiApiKey");
        if (!apiKey) {
            ui.notifications.error("OpenAI API Schlüssel nicht konfiguriert. Bitte gehe zu den Moduleinstellungen.");
            return;
        }

        const model = customModel || game.settings.get("npc-generator-gpt", "openaiModel");
        if (!model) {
            ui.notifications.error("Kein OpenAI Modell ausgewählt. Bitte konfiguriere es in den Moduleinstellungen oder gib ein benutzerdefiniertes Modell an.");
            return;
        }

        // --- Feste Vorlage für ChatGPT mit D&D5e spezifischen Feldern ---
        // Dies stellt sicher, dass ChatGPT die benötigten Daten in korrektem Format liefert.
        // Die 'data' für Items ist jetzt 'system' im D&D5e-System.
        const dnd5eItemTypes = game.system.documentTypes.Item.join(', '); // Holt alle gültigen Item-Typen des D&D5e Systems

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

        // Füge den benutzerdefinierten Prompt hinzu, falls vorhanden
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
            response_format: { "type": "json_object" } // Erzwingt JSON-Ausgabe (für neuere Modelle)
        });

        const requestOptions = {
            method: "POST",
            headers: headers,
            body: body
        };

        try {
            const response = await fetch(url, requestOptions);
            const data = await response.json();

            if (data.error) {
                ui.notifications.error(`ChatGPT API Fehler: ${data.error.message}`);
                console.error("ChatGPT API Error:", data.error);
                return;
            }

            const result = data.choices[0].message.content;

            let generatedNpcsData;
            try {
                generatedNpcsData = JSON.parse(result);
                if (!Array.isArray(generatedNpcsData)) {
                    generatedNpcsData = [generatedNpcsData];
                }
            } catch (parseError) {
                ui.notifications.error("Fehler beim Parsen der JSON-Antwort von ChatGPT. Überprüfe den Prompt und das Antwortformat.");
                console.error("JSON Parse Error:", parseError);
                console.error("ChatGPT Raw Response:", result);
                return;
            }

            // --- DIREKTE ERSTELLUNG VON FOUNDRY VTT DOKUMENTEN HIER ---
            for (const npcData of generatedNpcsData) {
                try {
                    // 1. Actor erstellen
                    const actorType = npcData.type || "npc"; // Standardmäßig "npc" für D&D5e
                    if (!game.system.documentTypes.Actor.includes(actorType)) {
                        ui.notifications.warn(`Ungültiger Actor-Typ "${actorType}" für NPC "${npcData.name || 'Unbekannt'}" ignoriert. Verwende "npc".`);
                        // Setze den Typ auf einen gültigen Fallback, um die Erstellung zu ermöglichen
                        npcData.type = "npc";
                    }

                    const actor = await Actor.create({
                        name: npcData.name || "Unbekannter NPC",
                        type: actorType,
                        img: "icons/svg/mystery-man.svg", // Standard-Icon
                        system: { // Daten für den Actor (für D&D5e ist dies 'system')
                            details: {
                                biography: {
                                    value: npcData.description || ""
                                }
                            }
                            // Füge hier weitere standardmäßige NPC-Attribute hinzu, die du möchtest
                            // z.B. attributes.hp.value: 10, attributes.ac.value: 10, etc.
                        }
                    });

                    ui.notifications.info(`NPC "${actor.name}" erfolgreich erstellt.`);
                    console.log(`Created Actor: ${actor.name}`, actor);

                    // 2. Items erstellen und zum Actor hinzufügen
                    if (npcData.items && Array.isArray(npcData.items)) {
                        const itemsToCreate = [];
                        const validItemTypes = game.system.documentTypes.Item; // Gültige Item-Typen des Systems

                        for (const item of npcData.items) {
                            // Prüfe, ob der Item-Typ gültig ist
                            if (validItemTypes.includes(item.type)) {
                                itemsToCreate.push({
                                    name: item.name || "Unbenanntes Item",
                                    type: item.type,
                                    img: `icons/svg/${item.type}.svg`, // Versucht ein passendes Icon
                                    system: item.system || {} // Wichtig: 'system' statt 'data' für D&D5e
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
                    ui.notifications.error(`Fehler beim Erstellen von NPC oder Items für "${npcData.name || 'Unbekannt'}": ${creationError.message}`);
                    console.error(`Error during NPC/Item creation for ${npcData.name || 'Unknown'}:`, creationError);
                }
            }

            ui.notifications.info("Alle generierten NPCs wurden erstellt!");
            this.close(); // Schließt den Dialog nach erfolgreicher Erstellung

        } catch (error) {
            ui.notifications.error(`Fehler während des API-Aufrufs: ${error.message}`);
            console.error("API Error:", error);
        }
    }
}

// --- Hooks für Foundry VTT Einstellungen und Buttonplatzierung ---
Hooks.on("init", () => {
    game.settings.register("npc-generator-gpt", "openaiApiKey", {
        name: "OpenAI API Schlüssel",
        hint: "Dein OpenAI API-Schlüssel (z.B. sk-XXXXXXXXXXXX). Kann hier generiert werden: platform.openai.com/account/api-keys",
        scope: "world",
        config: true,
        type: String,
        default: ""
    });

    game.settings.register("npc-generator-gpt", "openaiModel", {
        name: "OpenAI Modell",
        hint: "Das Standardmodell, das für die Generierung verwendet werden soll (z.B. gpt-4o, gpt-3.5-turbo).",
        scope: "world",
        config: true,
        type: String,
        choices: {
            "gpt-4o": "GPT-4o (Empfohlen)",
            "gpt-4-turbo": "GPT-4 Turbo",
            "gpt-3.5-turbo": "GPT-3.5 Turbo",
            // Füge hier weitere Modelle hinzu, die du unterstützen möchtest
        },
        default: "gpt-4o"
    });
});

// Platziert den Button direkt im Actors Directory
Hooks.on("renderActorDirectory", (app, html, data) => {
    // Finde den Bereich, wo der "Create Actor" Button ist
    const createActorButton = html.find('button[data-action="create"]');
    if (createActorButton.length > 0) {
        // Füge unseren Button direkt vor dem "Create Actor" Button ein
        const npcGeneratorButton = $(`
            <button class="npc-generator-button" type="button" title="Generate NPCs with ChatGPT">
                <i class="fas fa-robot"></i> ChatGPT NPCs
            </button>
        `);
        createActorButton.before(npcGeneratorButton);

        // Füge den Event Listener hinzu
        npcGeneratorButton.click(() => {
            new NPCGeneratorDialog().render(true);
        });
    } else {
        // Fallback, falls der Button nicht gefunden wird (z.B. bei Änderungen in Foundry VTT)
        // Füge ihn stattdessen am Ende des Headers hinzu
        const directoryHeader = html.find('.directory-header');
        if (directoryHeader.length > 0) {
             const npcGeneratorButton = $(`
                <button class="npc-generator-button" type="button" title="Generate NPCs with ChatGPT">
                    <i class="fas fa-robot"></i> ChatGPT NPCs
                </button>
            `);
            directoryHeader.append(npcGeneratorButton);
            npcGeneratorButton.click(() => {
                new NPCGeneratorDialog().render(true);
            });
        }
    }
});


Hooks.on("ready", () => {
    console.log("NPC Generator GPT | Ready!");
    // Überprüfe, ob das D&D5e System aktiv ist, da der Prompt spezifisch dafür ist.
    if (game.system.id !== "dnd5e") {
        ui.notifications.warn("NPC Generator GPT Modul ist für das D&D5e System optimiert. Es kann bei anderen Systemen zu unerwartetem Verhalten oder Fehlern kommen.");
    }
});
