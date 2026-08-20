import { useQuery } from "@tanstack/react-query";
import { api } from "../api";

export type SalesMode = "ecommerce" | "catalogo_whatsapp";

type SalesModeResponse = {
  modo: SalesMode;
  catalogo_whatsapp: boolean;
};

export function useSalesMode() {
  const query = useQuery({
    queryKey: ["layout", "modo-venta"],
    queryFn: () => api.get<SalesModeResponse>("/productos/modo-venta"),
    staleTime: 0,
    refetchInterval: 15000,
    refetchIntervalInBackground: true,
  });

  return {
    ...query,
    mode: query.data?.modo ?? "ecommerce",
    isWhatsappCatalog: query.data?.catalogo_whatsapp === true,
  };
}
