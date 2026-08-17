import { useQuery } from "@tanstack/react-query";
import { api } from "../api";

type PointsStatusResponse = { enabled: boolean };

/**
 * Estado global del programa de puntos (toggle de superAdmin).
 *
 * Devuelve `null` mientras carga: los consumidores deben tratar `null`
 * como "todavía no sé" y no ocultar ni redirigir hasta tener respuesta,
 * para que el menú no parpadee en cada carga de página.
 *
 * `false` SOLO cuando el backend confirmó que el programa está apagado.
 * Si el request falla, se asume activo (mismo default seguro que el backend).
 */
export function usePointsEnabled(): boolean | null {
  const query = useQuery({
    queryKey: ["layout", "puntos"],
    queryFn: () => api.get<PointsStatusResponse>("/layout/puntos"),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    retry: 1,
  });

  if (query.isError) return true;
  if (query.data === undefined) return null;
  return query.data.enabled !== false;
}

/** Azúcar para el caso común: ocultar solo cuando está confirmado apagado. */
export function usePointsVisible(): boolean {
  return usePointsEnabled() !== false;
}
