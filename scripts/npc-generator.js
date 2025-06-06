// Registrierung des Settings: Im init-Hook
Hooks.once("init", () => {
  game.settings.register("npc-generator-gpt", "openaiApiKey", {
    name: "OpenAI API Key",
    hint: "Dein persönlicher OpenAI API Key. Wird nur lokal gespeichert.",
    scope: "client",
    config: true,
    type: String,
    default: ""
  });
});

Hooks.once('ready', async function () {
  // Funktioniert nur mit D&D5e
  if (!game.system.id.includes("dnd5e")) {
    ui.notifications.warn("NPC Generator GPT funktioniert nur mit D&D5e");
    return;
  }

  // GPT-NPC Button einfügen
  const buttonHTML = `<button class="npc-gpt-button"><i class="fas fa-robot"></i> GPT NPC</button>`;
  $(buttonHTML).insertBefore("#actors .directory-footer");

  // Bei Klick Dialog öffnen
  $(".npc-gpt-button").click(async () => {
    const input = await Dialog.prompt({
      title: "Neuer NPC mit GPT",
      content: `<label>Beschreibung oder Beruf:</label><input type="text" id="gpt-desc">`,
      callback: async (html) => {
        const desc = html.find("#gpt-desc").val() || "mysteriöser Fremder";
        const npcData = await generateNPC(desc);
        if (npcData) await Actor.create(npcData);
      },
      rejectClose: false
    });
  });
});

async function generateNPC(promptText) {
  const apiKey = game.settings.get("npc-generator-gpt", "openaiApiKey");
  if (!apiKey) {
    ui.notifications.warn("Kein OpenAI API Key gesetzt. Bitte trage ihn in den Moduleinstellungen ein.");
    return null;
  }

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: `Du bist ein JSON-Generator für FoundryVTT 13 D&D5e. 
          { 
            role: "system", 
            content: "Gib mir eine vollständige, valide FoundryVTT Actor JSON für D&D5e. Der NPC soll Persönlichkeit, Beruf, Gesinnung, Hintergrund, Motivation, Fähigkeiten und Ausrüstung enthalten. Baue ihn abwechslungsreich, kreativ und vollständig." },
            KEINE Kommentare, KEINE Einleitung, KEIN Text – nur das JSON.`
        },
        {
          role: "user",
          content: `Erstelle einen einzigartigen D&D5e-NPC mit folgendem Fokus: ${promptText}. Gib die Daten als vollständige Actor JSON zurück.`
        }
      ],
      temperature: 0.8,
      max_tokens: 700
    })
  });

  let result;
  try {
    result = await response.json();
    console.log("GPT-Rohantwort:", result.choices[0].message.content);

    const content = result.choices[0].message.content.trim();
    const jsonStart = content.indexOf("{");
    const jsonEnd = content.lastIndexOf("}");
    const jsonString = content.slice(jsonStart, jsonEnd + 1);

    const npcJSON = JSON.parse(jsonString);
    return npcJSON;

  } catch (e) {
    console.warn("Antwort war kein valides JSON:", result);
    ui.notifications.warn("Konnte KI-Antwort nicht verarbeiten.");
    return null;
  }
}
