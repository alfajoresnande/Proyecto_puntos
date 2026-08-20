import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { api } from "../api";
import { formatBuenosAiresDateTime } from "../lib/dateTime";

type WhatsappOrderItem = {
  producto_id: number;
  nombre: string;
  cantidad: number;
  precio_unitario: number;
  subtotal: number;
  sabores?: Array<{ sabor_id: number; nombre: string; cantidad: number }>;
};

type WhatsappOrder = {
  id: number;
  estado: "generado" | "contactado" | "cancelado";
  entrega: "retiro" | "consultar_envio";
  localidad: string | null;
  notas: string | null;
  moneda: string;
  subtotal_estimado: number;
  cliente_nombre: string;
  cliente_telefono: string | null;
  mensaje: string;
  items: WhatsappOrderItem[];
  whatsapp_cliente_url: string | null;
  created_at: string;
  updated_at: string;
};

function money(value: number): string {
  return Number(value || 0).toLocaleString("es-AR", { style: "currency", currency: "ARS" });
}

function statusLabel(status: WhatsappOrder["estado"]): string {
  if (status === "contactado") return "Contactado";
  if (status === "cancelado") return "Cancelado";
  return "Nuevo";
}

export function WhatsappOrdersPanel() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [copyMessage, setCopyMessage] = useState("");
  const ordersQuery = useQuery({
    queryKey: ["vendedor", "pedidos-whatsapp"],
    queryFn: () => api.get<WhatsappOrder[]>("/vendedor/pedidos-whatsapp"),
    refetchInterval: 10_000,
  });
  const statusMutation = useMutation({
    mutationFn: ({ id, estado }: { id: number; estado: WhatsappOrder["estado"] }) =>
      api.patch<{ ok: true }>(`/vendedor/pedidos-whatsapp/${id}/estado`, { estado }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["vendedor", "pedidos-whatsapp"] });
    },
  });

  const filteredOrders = useMemo(() => {
    const query = search.trim().toLowerCase().replace(/^#/, "");
    const rows = ordersQuery.data ?? [];
    if (!query) return rows;
    return rows.filter((order) => [
      String(order.id),
      order.cliente_nombre,
      order.cliente_telefono ?? "",
      order.localidad ?? "",
      ...order.items.map((item) => item.nombre),
    ].some((value) => value.toLowerCase().includes(query)));
  }, [ordersQuery.data, search]);

  async function copyOriginalMessage(order: WhatsappOrder) {
    try {
      await navigator.clipboard.writeText(order.mensaje);
      setCopyMessage(`Mensaje del Pedido web #${order.id} copiado.`);
    } catch {
      setCopyMessage("No se pudo copiar el mensaje. Revisa los permisos del navegador.");
    }
  }

  return (
    <section aria-labelledby="whatsapp-orders-title" style={{ display: "grid", gap: "0.9rem" }}>
      <div>
        <h2 id="whatsapp-orders-title" style={{ margin: 0, color: "#3D1A02", fontSize: "1.15rem", fontWeight: 800 }}>
          Pedidos recibidos por WhatsApp
        </h2>
        <p style={{ margin: "0.35rem 0 0", color: "#7C5A40", fontSize: "0.9rem" }}>
          Busca el numero que aparece en el mensaje del cliente, confirma disponibilidad y genera debajo el cobro por el total final.
        </p>
      </div>

      <input
        className="ios-input"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder="Buscar por # de pedido, cliente, telefono o producto"
        aria-label="Buscar pedidos de WhatsApp"
      />
      {copyMessage ? <p style={{ margin: 0, color: "#7C5A40", fontSize: "0.85rem" }}>{copyMessage}</p> : null}
      {ordersQuery.isLoading ? <p>Cargando pedidos...</p> : null}
      {ordersQuery.isError ? <p role="alert" style={{ color: "#b42318" }}>{(ordersQuery.error as Error).message}</p> : null}
      {statusMutation.isError ? <p role="alert" style={{ color: "#b42318" }}>{(statusMutation.error as Error).message}</p> : null}
      {!ordersQuery.isLoading && filteredOrders.length === 0 ? <p style={{ color: "#7C5A40" }}>No hay pedidos para mostrar.</p> : null}

      <div style={{ display: "grid", gap: "0.75rem" }}>
        {filteredOrders.slice(0, 30).map((order) => (
          <article key={order.id} className="ios-card p-3" style={{ background: "#FFFDF8", border: "1px solid #ead8ca", display: "grid", gap: "0.55rem" }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: "0.75rem", flexWrap: "wrap" }}>
              <strong>Pedido web #{order.id} · {money(order.subtotal_estimado)}</strong>
              <span>{statusLabel(order.estado)} · {formatBuenosAiresDateTime(order.created_at)}</span>
            </div>
            <div style={{ color: "#5B371E", fontSize: "0.9rem" }}>
              <strong>{order.cliente_nombre}</strong>{order.cliente_telefono ? ` · ${order.cliente_telefono}` : ""}
              <div>{order.entrega === "consultar_envio" ? `Consulta envio${order.localidad ? ` a ${order.localidad}` : ""}` : "Retiro a coordinar"}</div>
              {order.notas ? <div>Notas: {order.notas}</div> : null}
            </div>
            <ul style={{ margin: 0, paddingLeft: "1.15rem", color: "#5B371E", fontSize: "0.88rem" }}>
              {order.items.map((item, index) => (
                <li key={`${order.id}-${item.producto_id}-${index}`}>
                  {item.cantidad} x {item.nombre} · {money(item.subtotal)}
                  {item.sabores?.length ? ` · ${item.sabores.map((flavor) => `${flavor.nombre} x${flavor.cantidad}`).join(", ")}` : ""}
                </li>
              ))}
            </ul>
            <div style={{ display: "flex", gap: "0.55rem", flexWrap: "wrap" }}>
              {order.whatsapp_cliente_url ? (
                <a className="ios-btn-secondary" href={order.whatsapp_cliente_url} target="_blank" rel="noreferrer" style={{ width: "auto", textDecoration: "none" }}>
                  Responder por WhatsApp
                </a>
              ) : null}
              <button type="button" className="ios-btn-secondary" style={{ width: "auto" }} onClick={() => void copyOriginalMessage(order)}>
                Copiar pedido
              </button>
              {order.estado !== "contactado" ? (
                <button type="button" className="ios-btn-secondary" style={{ width: "auto" }} disabled={statusMutation.isPending} onClick={() => statusMutation.mutate({ id: order.id, estado: "contactado" })}>
                  Marcar contactado
                </button>
              ) : null}
              {order.estado !== "cancelado" ? (
                <button type="button" className="ios-btn-secondary" style={{ width: "auto" }} disabled={statusMutation.isPending} onClick={() => statusMutation.mutate({ id: order.id, estado: "cancelado" })}>
                  Marcar cancelado
                </button>
              ) : null}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
