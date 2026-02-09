import { createApp } from "vue";
import { createPinia } from "pinia";
import PrimeVue from "primevue/config";
import App from "./App.vue";
import "./styles/tokens.css";
import "./styles/base.css";

const app = createApp(App);
const pinia = createPinia();

app.use(pinia);
app.use(PrimeVue, {
  unstyled: true
});

app.mount("#app");
