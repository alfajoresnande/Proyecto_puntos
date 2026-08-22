import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { ToastProvider } from "./components/ToastProvider";
import { useAuthStore } from "./store/authStore";
import { purgeLegacyBrowserTokens, refreshCsrfToken } from "./lib/csrf";
import "./styles/styles.css";
import "./styles/login.css";
import "./styles/layout.css";
import "./styles/catalog.css";
import "./styles/admin.css";
import "./styles/local-sale-pos.css";
import "./styles/react.css";
import "./styles/mobile-navbar.css";
import "./styles/store-page.css";
import "./styles/footer.css";
import "./styles/home.css";
import "./styles/addresses.css";
import "./styles/shipping-zones.css";
import "./styles/ai-chat-widget.css";

// SEC-03: migracion del cliente. Retira el JWT que el esquema anterior dejaba
// en localStorage (`nande-auth.state.token`) y el pseudo-token CSRF viejo.
// Tiene que correr ANTES de restoreSession para que ningun navegador siga
// arrastrando un token de sesion legible por JavaScript.
purgeLegacyBrowserTokens();

// El token CSRF lo emite el servidor y queda en una cookie propia.
void refreshCsrfToken();

void useAuthStore.getState().restoreSession();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: true,
      retry: false,
      staleTime: 0,
    },
  },
});

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <ToastProvider>
          <App />
        </ToastProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);
