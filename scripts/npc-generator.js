// npc-generator.js
// Dieses Skript ermöglicht die Generierung von D&D5e NPCs und ihren Items über ChatGPT
// Es integriert sich als Button im Actors Directory von Foundry VTT.

function getValidItemTypes() {
    let itemTypes = game.system?.documentTypes?.Item;
    if (!Array.isArray(itemTypes)) itemTypes = game.documentTypes?.Item;
    if (!Array.isArray(itemTypes)) itemTypes = Object.keys(CONFIG.Item.typeLabels || {});
    return Array.isArray(itemTypes) ? itemTypes : [];
}

function getValidActorTypes() {
    let actorTypes = game.system?.documentTypes?.Actor;
    if (!Array.isArray(actorTypes)) actorTypes = game.documentTypes?.Actor;
    if (!Array.isArray(actorTypes)) actorTypes = Object.keys(CONFIG.Actor.typeLabels || {});
    return Array.isArray(actorTypes) ? actorTypes : [];
}

// Suche nach einem offiziellen D&D5e Zauber im Compendium
async function findCompendiumSpellByName(spellName) {
    const pack = game.packs.get("dnd5e.spells");
    if (!pack) return null;
    const index = await pack.getIndex();
    const entry = index.find(e => e.name?.toLowerCase() === spellName.toLowerCase());
    return entry ? await pack.getDocument(entry._id) : null;
}

async function findCompendiumFeatByName(featName) {
    for (const pack of game.packs) {
        if (pack.documentName !== "Item") continue;
        const index = await pack.getIndex();
        const entry = index.find(e => e.name?.toLowerCase() === featName.toLowerCase() && e.type === "feat");
        if (entry) return await pack.getDocument(entry._id);
    }
    return null;
}

const skillMap = {
    acrobatics: "acr",
    animalHandling: "ani",
    arcana: "arc",
    athletics: "ath",
    deception: "dec",
    history: "his",
    insight: "ins",
    intimidation: "itm",
    investigation: "inv",
    medicine: "med",
    nature: "nat",
    perception: "prc",
    performance: "prf",
    persuasion: "per",
    religion: "rel",
    sleightOfHand: "slt",
    stealth: "ste",
    survival: "sur"
};

function showNPCExportDialog(jsonString) {
    const blob = new Blob([jsonString], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const content = `
        <div>
            <textarea style="width:100%;height:300px;" readonly>${jsonString}</textarea>
            <p><a href="${url}" download="generated-npcs.json">JSON herunterladen</a></p>
            <button type="button" class="copy-json">In Zwischenablage</button>
        </div>`;
    const dialog = new Dialog({
        title: "Generierte NPCs (JSON)",
        content,
        buttons: { close: { label: "Schließen" } },
        render: html => {
            html.find('.copy-json').click(() => {
                const ta = html.find('textarea')[0];
                ta.select();
                document.execCommand('copy');
                ui.notifications.info('JSON in Zwischenablage kopiert');
            });
        }
    });
    dialog.render(true);
}

class NPCGeneratorDialog extends FormApplication {
    static get defaultOptions() {
        // Standardoptionen für das FormApplication-Fenster
        return foundry.utils.mergeObject(super.defaultOptions, {
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
        const maxTokensInput = parseInt(formData.get("maxTokens"));
        const maxTokens = isNaN(maxTokensInput) || maxTokensInput <= 0 ? 2000 : maxTokensInput; // Maximale Tokenzahl

        // Validierung der Eingabe für die Anzahl der NPCs
        if (isNaN(numNpcs) || numNpcs <= 0) {
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
        // Verwende die Hilfsfunktion, um eine valide Liste aller Item-Typen
        // des aktuellen Systems zu erhalten. Damit stellen wir sicher, dass
        // immer ein Array vorliegt, selbst wenn das System die Informationen
        // anders bereitstellt.
        const dnd5eItemTypes = getValidItemTypes().join(', ');

        const basePrompt = `
Generate ${numNpcs} D&D5e NPCs as a JSON array. Each NPC must have the following structure.
The NPC's overall power should scale with its challenge rating: higher CR means stronger spells, better actions, improved items and legendary actions when appropriate.
Use these guidelines when deciding on features:
 - CR 1–4: few simple abilities or actions with low damage and effect strength.
 - CR 5–8: more abilities and/or stronger effects, optionally single damage resistances.
 - CR 9–11: advanced features or multiple special actions per round, stronger spells or special attacks.
 - CR 12 and higher: typically grant legendary actions. The number and strength of these actions should match the CR (e.g., several small actions or one powerful action).
- "name": String, the NPC's name.
- "type": String, the NPC type (for D&D5e usually "npc" or "character").
- "description": String, a brief biography of the NPC with at least three sentences.
- "species": String representing the NPC's species.
- "background": String describing the NPC's background.
- "abilities": { "str": Number, "dex": Number, "con": Number, "int": Number, "wis": Number, "cha": Number }.
- "hp": Number representing the NPC's hit points.
- "cr": Number representing the NPC's challenge rating.
- "savingThrows": { "str": Boolean, "dex": Boolean, "con": Boolean, "int": Boolean, "wis": Boolean, "cha": Boolean } where true means the NPC is proficient in that saving throw.
- "skills": { "acrobatics": Number, "animalHandling": Number, "arcana": Number, "athletics": Number, "deception": Number, "history": Number, "insight": Number, "intimidation": Number, "investigation": Number, "medicine": Number, "nature": Number, "perception": Number, "performance": Number, "persuasion": Number, "religion": Number, "sleightOfHand": Number, "stealth": Number, "survival": Number } with 0 for no proficiency, 1 for proficiency and 2 for expertise.
- "movementSpeed": String describing the NPC's typical movement speed (e.g., "30 ft").
- "languages": "" (leave empty).
- "habitat": "" (leave empty).
- "immunities": "" (leave empty).
- "actions": Array of 1 to 10 actions taken directly from the official D&D5e compendium (no homebrew). The number of actions should scale with the NPC's CR.
 - If "cr" is 12 or higher, include "legendaryActions": an array of official legendary actions from the compendium.
- Spell levels should match the NPC's challenge rating (about CR/2, capped at 9).
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

For "spell" (include damage.parts for damage-dealing spells):
  "system": {
    "description": {"value": "A description of the spell."},
    "damage": {"parts": [["1d8", "fire"]]}, // Example damage
    "level": 2, // Spell level should scale with the NPC's CR (about CR/2, max 9)
    "school": "abj", // Or evn, nec, etc.
    "components": {"v": true, "s": true, "m": false},
    "preparation": {"mode": "prepared", "prepared": true}
  }

Only use official D&D5e spells from the compendium and never invent new spells.
Spellcasting NPCs (wizards, sorcerers, etc.) must include spells in their items array. The number of spells should fit the NPC's challenge rating and be between 1 and 10 so that they have multiple options.

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
            max_tokens: maxTokens,
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
            const exportedActors = [];
            for (const npcData of generatedNpcsData) {
                try {
                    // 1. Actor (NPC) erstellen
                    const actorType = npcData.type || "npc"; // Standardtyp "npc" für D&D5e
                    // Validierung des Actor-Typs gegen die System-definierten Typen
                    const validActorTypes = getValidActorTypes();
                    if (!validActorTypes.includes(actorType)) {
                        ui.notifications.warn(`Ungültiger Actor-Typ "${actorType}" für NPC "${npcData.name || 'Unbekannt'}" ignoriert. Verwende stattdessen "npc".`);
                        npcData.type = "npc"; // Fallback auf gültigen Typ
                    }

                    const abilityData = {
                        str: { value: npcData.abilities?.str || 10 },
                        dex: { value: npcData.abilities?.dex || 10 },
                        con: { value: npcData.abilities?.con || 10 },
                        int: { value: npcData.abilities?.int || 10 },
                        wis: { value: npcData.abilities?.wis || 10 },
                        cha: { value: npcData.abilities?.cha || 10 }
                    };

                    const savingData = npcData.savingThrows || {};
                    for (const [ability, prof] of Object.entries(savingData)) {
                        if (abilityData[ability]) abilityData[ability].proficient = prof ? 1 : 0;
                    }

                    const skills = {};
                    if (npcData.skills) {
                        for (const [skillName, value] of Object.entries(npcData.skills)) {
                            const key = skillMap[skillName];
                            if (key) skills[key] = { value };
                        }
                    }

                    // Challenge Rating muss eine gültige Zahl sein. Wandelt
                    // Strings wie "1/2" oder "0.5" sicher in eine Zahl um.
                    function parseCR(value) {
                        if (typeof value === "number" && isFinite(value)) return value;
                        if (typeof value === "string") {
                            const trimmed = value.trim();
                            // Unterstützt Bruchangaben wie "1/2" oder Dezimalzahlen
                            if (trimmed.includes("/")) {
                                const [num, denom] = trimmed.split("/").map(Number);
                                if (!isNaN(num) && !isNaN(denom) && denom !== 0) {
                                    return num / denom;
                                }
                            }
                            const parsed = parseFloat(trimmed);
                            if (!isNaN(parsed)) return parsed;
                        }
                        return null;
                    }

                    let cr = parseCR(npcData.cr);
                    if (!Number.isFinite(cr)) cr = Math.floor(Math.random() * 20) + 1;

                    const details = {
                        biography: {
                            value: npcData.description || ""
                        },
                        background: { value: npcData.background || "" }
                    };
                    if (actorType === "npc") {
                        details.type = { value: npcData.species || "" };
                        details.cr = cr;
                    } else {
                        details.race = { value: npcData.species || "" };
                        details.cr = cr;
                    }
                    const movement = {};
                    if (npcData.movementSpeed) {
                        const speedMatch = String(npcData.movementSpeed).match(/d+/);
                        if (speedMatch) movement.walk = parseInt(speedMatch[0], 10);
                    }

                    const actorData = {
                        name: npcData.name || "Unbekannter NPC",
                        type: actorType,
                        system: {
                            abilities: abilityData,
                            attributes: {
                                hp: {
                                    value: npcData.hp || 1,
                                    max: npcData.hp || 1
                                },
                                movement,
                            },
                            details,
                            skills
                        }
                    };

                    const actor = await Actor.create(actorData);

                    if (actor) {
                        ui.notifications.info(`NPC "${actor.name}" erfolgreich erstellt.`);
                        console.log(`Created Actor: ${actor.name}`, actor);
                    } else {
                        throw new Error("Actor creation failed");
                    }

                    // 2. Items erstellen und zum Actor hinzufügen
                    if (npcData.items && Array.isArray(npcData.items)) {
                        const itemsToCreate = [];
                        const validItemTypes = getValidItemTypes(); // Gültige Item-Typen des Systems

                        for (const item of npcData.items) {
                            if (item && typeof item === "object" && validItemTypes.includes(item.type)) {
                                if (item.type === "spell") {
                                    const compendiumSpell = await findCompendiumSpellByName(item.name || "");
                                    if (compendiumSpell) {
                                        itemsToCreate.push(compendiumSpell.toObject());
                                        continue;
                                    }
                                }

                                itemsToCreate.push({
                                    name: item.name || "Unbenanntes Item",
                                    type: item.type,
                                    system: item.system || {}
                                });
                            } else {
                                const type = item?.type || "unbekannt";
                                const name = item?.name || "Unbenanntes Item";
                                ui.notifications.warn(`Ungültiger Item-Typ "${type}" für "${name}" bei NPC "${npcData.name}" ignoriert. Gültige Typen sind: ${validItemTypes.join(', ')}`);
                                console.warn(`Invalid item type "${type}" for "${name}" of NPC "${npcData.name}". Skipped.`);
                            }
                        }
                        if (npcData.actions && Array.isArray(npcData.actions)) {
                            for (const action of npcData.actions) {
                                const name = typeof action === "string" ? action : action.name;
                                const feat = await findCompendiumFeatByName(name || "");
                                if (feat) itemsToCreate.push(feat.toObject());
                            }
                        }
                        if (npcData.legendaryActions && Array.isArray(npcData.legendaryActions)) {
                            for (const action of npcData.legendaryActions) {
                                const name = typeof action === "string" ? action : action.name;
                                const feat = await findCompendiumFeatByName(name || "");
                                if (feat) itemsToCreate.push(feat.toObject());
                            }
                        }

                        if (itemsToCreate.length > 0) {
                            await actor.createEmbeddedDocuments("Item", itemsToCreate);
                            ui.notifications.info(`Items für "${actor.name}" hinzugefügt.`);
                            console.log(`Created Items for ${actor.name}:`, itemsToCreate);
                        }

                        exportedActors.push(actor.toObject());
                    }

                } catch (creationError) {
                    // Fehlerbehandlung bei der Erstellung von Foundry VTT Dokumenten
                    ui.notifications.error(`Fehler beim Erstellen von NPC oder Items für "${npcData.name || 'Unbekannt'}": ${creationError.message}`);
                    console.error(`Error during NPC/Item creation for ${npcData.name || 'Unknown'}:`, creationError);
                }
            }

            ui.notifications.info("Alle generierten NPCs wurden erstellt!");

            if (exportedActors.length > 0) {
                const jsonString = JSON.stringify(exportedActors, null, 2);
                showNPCExportDialog(jsonString);
            }

            this.close(); // Schließt den Dialog nach erfolgreicher Erstellung

        } catch (error) {
            // Allgemeine Fehlerbehandlung für den API-Aufruf
            ui.notifications.error(`Fehler während des API-Aufrufs: ${error.message}`);
            console.error("API Error:", error);
        }
    }
}

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
