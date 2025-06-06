// Registrierung des Settings: Direkt am Anfang!
game.settings.register("npc-generator-gpt", "openaiApiKey", {
  name: "OpenAI API Key",
  hint: "Dein persönlicher OpenAI API Key. Wird nur lokal gespeichert.",
  scope: "client",
  config: true,
  type: String,
  default: ""
});

Hooks.once('ready', async function () {
  if (!game.system.id.includes("dnd5e")) {
    ui.notifications.warn("NPC Generator GPT funktioniert nur mit D&D5e");
    return;
  }

  const buttonHTML = `<button class="npc-gpt-button"><i class="fas fa-robot"></i> GPT NPC</button>`;
  $(buttonHTML).insertBefore("#actors .directory-footer");

  $(".npc-gpt-button").click(async () => {
    const input = await Dialog.prompt({
      title: "Neuer NPC mit GPT",
      content: `<label>Beschreibung oder Beruf:</label><input type="text" id="gpt-desc">`,
      callback: async (html) => {
        const desc = html.querySelector("#gpt-desc").value || "mysteriöser Fremder";
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
        { role: "system", content: "Gib mir eine vollständige Actor JSON für D&D5e." },
        { role: "user", content: `Erzeuge einen NPC: ${promptText}` }
      ],
      temperature: 0.8,
      max_tokens: 500
    })
  });

  if (!response.ok) {
    ui.notifications.error("Fehler bei der OpenAI API.");
    return null;
  }

  try {
    const result = await response.json();
    const npcJSON = JSON.parse(result.choices[0].message.content);
    return npcJSON;
  } catch (e) {
    console.warn("Antwort war kein valides JSON:", result);
    ui.notifications.warn("Konnte KI-Antwort nicht verarbeiten.");
    return null;
  }
}
