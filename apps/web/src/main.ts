import { createApp } from "vue";
import { createPinia } from "pinia";
import App from "./App.vue";
import { i18n } from "./i18n";
import { installUnauthorizedHandler, router } from "./router";
import "./styles.css";

const pinia = createPinia();
installUnauthorizedHandler(router);
createApp(App).use(pinia).use(i18n).use(router).mount("#app");
