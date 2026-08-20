import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { api } from "../api";
import { formatBuenosAiresDateTime } from "../lib/dateTime";

type ManualCharge = {
  id: number;
  monto: number;
  moneda: string;
  concepto: string;
  cliente_nombre: string | null;
  cliente_telefono: string | null;
  estado: string;
  checkout_url: string | null;
  qr_image_data?: string | null;
  whatsapp_url?: string | null;
  provider_payment_id: string | null;
  creado_por_nombre?: string;
  error_mensaje?: string | null;
  approved_at?: string | null;
  created_at?: string;
};

function formatMoney(value: number): string {
  return Number(value || 0).toLocaleString("es-AR", { style: "currency", currency: "ARS" });
}

function statusLabel(status: string): string {
  if (status === "aprobado") return "Pagado";
  if (status === "rechazado") return "Rechazado";
  if (status === "expirado") return "Vencido";
  if (status === "error") return "Error";
  return "Pendiente";
}

export function ManualPaymentGenerator() {
  const queryClient = useQueryClient();
  const [monto, setMonto] = useState("");
  const [concepto, setConcepto] = useState("Pedido confirmado por WhatsApp");
  const [clienteNombre, setClienteNombre] = useState("");
  const [clienteTelefono, setClienteTelefono] = useState("");
  const [latestCharge, setLatestCharge] = useState<ManualCharge | null>(null);
  const [copied, setCopied] = useState(false);

  const amountNumber = useMemo(() => Number(String(monto).replace(",", ".")), [monto]);
  const historyQuery = useQuery({
    queryKey: ["vendedor", "cobros-manuales"],
    queryFn: () => api.get<ManualCharge[]>("/vendedor/cobros-manuales"),
    refetchInterval: 10_000,
  });
  const createMutation = useMutation({
    mutationFn: () => api.post<ManualCharge>("/vendedor/cobros-manuales", {
      monto: amountNumber,
      concepto: concepto.trim(),
      cliente_nombre: clienteNombre.trim() || null,
      cliente_telefono: clienteTelefono.trim() || null,
    }),
    onSuccess: async (charge) => {
      setLatestCharge(charge);
      setCopied(false);
      await queryClient.invalidateQueries({ queryKey: ["vendedor", "cobros-manuales"] });
    },
  });

  const canCreate = Number.isFinite(amountNumber) && amountNumber > 0 && concepto.trim().length >= 3;

  function confirmAndCreate() {
    if (!canCreate) return;
    const accepted = window.confirm(`Vas a generar un link de Mercado Pago por ${formatMoney(amountNumber)}. ¿Confirmas el importe?`);
    if (accepted) createMutation.mutate();
  }

  async function copyPaymentLink() {
    if (!latestCharge?.checkout_url) return;
    await navigator.clipboard.writeText(latestCharge.checkout_url);
    setCopied(true);
  }

  const recentCharges = historyQuery.data ?? [];

  return (
    <section aria-labelledby="manual-payment-title" style={{ display: "grid", gap: "1rem" }}>
      <div>
        <h2 id="manual-payment-title" style={{ margin: 0, color: "#3D1A02", fontSize: "1.15rem", fontWeight: 800 }}>
          Generar link de cobro
        </h2>
        <p style={{ margin: "0.35rem 0 0", color: "#7C5A40", fontSize: "0.9rem" }}>
          Ingresa el total final acordado, incluido el envio si corresponde. El QR abre exactamente el mismo link: no genera un segundo cobro.
        </p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: "0.75rem" }}>
        <label style={{ display: "grid", gap: "0.3rem", fontWeight: 700 }}>
          Importe final (ARS)
          <input className="ios-input" type="number" min="0.01" step="0.01" inputMode="decimal" value={monto} onChange={(event) => setMonto(event.target.value)} placeholder="54000" />
        </label>
        <label style={{ display: "grid", gap: "0.3rem", fontWeight: 700 }}>
          Concepto
          <input className="ios-input" value={concepto} maxLength={180} onChange={(event) => setConcepto(event.target.value)} />
        </label>
        <label style={{ display: "grid", gap: "0.3rem", fontWeight: 700 }}>
          Nombre del cliente (opcional)
          <input className="ios-input" value={clienteNombre} maxLength={160} onChange={(event) => setClienteNombre(event.target.value)} />
        </label>
        <label style={{ display: "grid", gap: "0.3rem", fontWeight: 700 }}>
          WhatsApp con codigo de pais (opcional)
          <input className="ios-input" type="tel" value={clienteTelefono} maxLength={40} onChange={(event) => setClienteTelefono(event.target.value)} placeholder="54911..." />
        </label>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
        <button type="button" className="ios-btn-primary" style={{ width: "auto" }} disabled={!canCreate || createMutation.isPending} onClick={confirmAndCreate}>
          {createMutation.isPending ? "Generando..." : `Generar por ${canCreate ? formatMoney(amountNumber) : "$ 0"}`}
        </button>
        {createMutation.isError ? <span role="alert" style={{ color: "#b42318" }}>{(createMutation.error as Error).message}</span> : null}
      </div>

      {latestCharge?.checkout_url ? (
        <div style={{ border: "1px solid #F0B88F", borderRadius: "16px", padding: "1rem", background: "#FFF8F1", display: "grid", gap: "1rem" }}>
          <div>
            <strong>Link listo por {formatMoney(latestCharge.monto)}</strong>
            <p style={{ margin: "0.25rem 0 0", overflowWrap: "anywhere", fontSize: "0.85rem" }}>{latestCharge.checkout_url}</p>
          </div>
          <div style={{ display: "flex", gap: "0.6rem", flexWrap: "wrap" }}>
            <button type="button" className="ios-btn-secondary" style={{ width: "auto" }} onClick={() => void copyPaymentLink()}>{copied ? "Link copiado" : "Copiar link"}</button>
            <a className="ios-btn-secondary" href={latestCharge.checkout_url} target="_blank" rel="noreferrer" style={{ width: "auto", textDecoration: "none" }}>Abrir Mercado Pago</a>
            {latestCharge.whatsapp_url ? <a className="ios-btn-secondary" href={latestCharge.whatsapp_url} target="_blank" rel="noreferrer" style={{ width: "auto", textDecoration: "none" }}>Enviar por WhatsApp</a> : null}
          </div>
          {latestCharge.qr_image_data ? (
            <div style={{ display: "grid", justifyItems: "start", gap: "0.5rem" }}>
              <img src={latestCharge.qr_image_data} alt={`QR del cobro por ${formatMoney(latestCharge.monto)}`} width={240} height={240} style={{ maxWidth: "100%", borderRadius: "12px" }} />
              <a href={latestCharge.qr_image_data} download={`cobro-${latestCharge.id}-qr.png`}>Descargar QR</a>
            </div>
          ) : null}
        </div>
      ) : null}

      <div style={{ display: "grid", gap: "0.5rem" }}>
        <h3 style={{ margin: 0, color: "#3D1A02", fontSize: "1rem" }}>Cobros recientes</h3>
        {historyQuery.isLoading ? <p>Cargando cobros...</p> : null}
        {historyQuery.isError ? <p role="alert" style={{ color: "#b42318" }}>{(historyQuery.error as Error).message}</p> : null}
        {recentCharges.length === 0 && !historyQuery.isLoading ? <p style={{ color: "#7C5A40" }}>Todavia no hay links generados.</p> : null}
        {recentCharges.slice(0, 12).map((charge) => (
          <div key={charge.id} style={{ display: "flex", justifyContent: "space-between", gap: "0.75rem", flexWrap: "wrap", padding: "0.7rem 0", borderBottom: "1px solid #ead8ca" }}>
            <div>
              <strong>#{charge.id} · {formatMoney(charge.monto)} · {statusLabel(charge.estado)}</strong>
              <div style={{ fontSize: "0.82rem", color: "#7C5A40" }}>
                {charge.concepto}{charge.cliente_nombre ? ` · ${charge.cliente_nombre}` : ""}{charge.created_at ? ` · ${formatBuenosAiresDateTime(charge.created_at)}` : ""}
              </div>
            </div>
            {charge.checkout_url ? <a href={charge.checkout_url} target="_blank" rel="noreferrer">Abrir link</a> : null}
          </div>
        ))}
      </div>
    </section>
  );
}
