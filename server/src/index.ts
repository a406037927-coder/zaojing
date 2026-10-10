import { createApp } from "./app.js";
import { config, isAiConfigured } from "./config.js";

const app = createApp();
app.listen(config.port, "0.0.0.0", () => {
  console.log(`造境 AI server listening on http://0.0.0.0:${config.port}`);
  console.log(`AI provider configured: ${isAiConfigured() ? "yes" : "no"}`);
});
