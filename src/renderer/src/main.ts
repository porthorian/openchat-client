import { createApp } from "vue";
import { createPinia } from "pinia";
import App from "./App.vue";
import { useSettingsStore } from "./stores/settings";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/appearance.css";

const app = createApp(App);
const pinia = createPinia();

app.use(pinia);
const settings = useSettingsStore(pinia);
settings.hydrate();
for (const query of ["(prefers-color-scheme: dark)", "(prefers-contrast: more)", "(forced-colors: active)", "(prefers-reduced-motion: reduce)"]) {
  window.matchMedia(query).addEventListener("change", () => settings.applyAppearance());
}

app.mount("#app");
