import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api";

/**
 * Checks for configuration updates globally.
 * If the configuration version on the server is newer than the one loaded at startup,
 * it forces a hard reload of the page to apply the new layout/configuration (e.g. Chatbot vs WhatsApp).
 */
export function AppVersionChecker() {
  const initialVersion = useRef<string | null>(null);

  const { data } = useQuery({
    queryKey: ["app", "version"],
    queryFn: () => api.get<{ version: string }>("/layout/version"),
    refetchInterval: 120 * 1000, // Poll every 2 minutes
    refetchOnWindowFocus: true,  // Poll when user returns to tab
    refetchOnReconnect: true,
  });

  useEffect(() => {
    if (!data?.version) return;

    if (initialVersion.current === null) {
      // First load, save the current version
      initialVersion.current = data.version;
    } else if (initialVersion.current !== data.version) {
      // Version changed! A setting was modified in the admin panel.
      console.log("Configuration updated on server. Reloading app to apply changes...");
      window.location.reload();
    }
  }, [data?.version]);

  return null;
}
