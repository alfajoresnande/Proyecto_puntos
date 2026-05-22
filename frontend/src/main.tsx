import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { ToastProvider } from "./components/ToastProvider";
import { useAuthStore } from "./store/authStore";
import "./styles/styles.css";
import "./styles/login.css";
import "./styles/layout.css";
import "./styles/catalog.css";
import "./styles/admin.css";
import "./styles/react.css";
import "./styles/mobile-navbar.css";
import "./styles/store-page.css";
import "./styles/footer.css";
import "./styles/home.css";
import "./styles/addresses.css";
import "./styles/shipping-zones.css";

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
      <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <ToastProvider>
          <App />
        </ToastProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);
