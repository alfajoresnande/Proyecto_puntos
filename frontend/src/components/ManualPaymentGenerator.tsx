import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { api } from "../api";
import { formatBuenosAiresDateTime } from "../lib/dateTime";
import { WhatsappOrdersPanel } from "./WhatsappOrdersPanel";
import "../styles/cobros-panel.css";

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
  oculto?: boolean;
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
  if (status === "cancelado") return "Cancelado";
  if (status === "error") return "Error";
  return "Pendiente";
}

function statusClass(status: string): string {
  if (status === "aprobado") return "cp-e-pago";
  if (status === "rechazado" || status === "error") return "cp-e-err";
  if (status === "cancelado" || status === "expirado") return "cp-e-off";
  return "cp-e-pend";
}

/** Redondea a miles/millones para confirmar el importe en palabras. */
function amountInWords(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toLocaleString("es-AR", { maximumFractionDigits: 1 })} millones`;
  if (value >= 1_000) return `${(value / 1_000).toLocaleString("es-AR", { maximumFractionDigits: 1 })} mil`;
  return String(value);
}

/** Acciones para volver a pasarle el cobro al cliente: link, WhatsApp y QR. */
function ChargeShareActions({
  charge,
  copied,
  onCopy,
}: {
  charge: ManualCharge;
  copied: boolean;
  onCopy: (charge: ManualCharge) => void;
}) {
  if (!charge.checkout_url) return null;
  return (
    <div className="cp-detalle">
      {charge.qr_image_data ? (
        <img src={charge.qr_image_data} alt={`QR del cobro por ${formatMoney(charge.monto)}`} width={128} height={128} />
      ) : null}
      <div>
        <p className="cp-url">{charge.checkout_url}</p>
        <div className="cp-acciones">
          <button type="button" className="cp-acc" onClick={() => onCopy(charge)}>
            {copied ? "Link copiado" : "Copiar link"}
          </button>
          <a className="cp-acc" href={charge.checkout_url} target="_blank" rel="noreferrer">
            Abrir Mercado Pago
          </a>
          {charge.whatsapp_url ? (
            <a className="cp-acc" href={charge.whatsapp_url} target="_blank" rel="noreferrer">
              Enviar por WhatsApp
            </a>
          ) : null}
          {charge.qr_image_data ? (
            <a className="cp-acc" href={charge.qr_image_data} download={`cobro-${charge.id}-qr.png`}>
              Descargar QR
            </a>
          ) : null}
        </div>
        {!charge.qr_image_data ? <p className="cp-meta">Este cobro no tiene QR guardado.</p> : null}
      </div>
    </div>
  );
}

export function ManualPaymentGenerator() {
  const queryClient = useQueryClient();
  const [monto, setMonto] = useState("");
  const [concepto, setConcepto] = useState("Pedido confirmado por WhatsApp");
  const [clienteNombre, setClienteNombre] = useState("");
  const [clienteTelefono, setClienteTelefono] = useState("");
  const [latestCharge, setLatestCharge] = useState<ManualCharge | null>(null);
  const [copiedChargeId, setCopiedChargeId] = useState<number | null>(null);
  const [copyError, setCopyError] = useState("");
  const [expandedChargeId, setExpandedChargeId] = useState<number | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  const [actionError, setActionError] = useState("");

  const amountNumber = useMemo(() => Number(String(monto).replace(",", ".")), [monto]);
  const historyQuery = useQuery({
    queryKey: ["vendedor", "cobros-manuales", { ocultos: showHidden }],
    queryFn: () => api.get<ManualCharge[]>(`/vendedor/cobros-manuales${showHidden ? "?incluir_ocultos=1" : ""}`),
    refetchInterval: 10_000,
  });

  async function refreshHistory() {
    await queryClient.invalidateQueries({ queryKey: ["vendedor", "cobros-manuales"] });
  }

  const createMutation = useMutation({
    mutationFn: () => api.post<ManualCharge>("/vendedor/cobros-manuales", {
      monto: amountNumber,
      concepto: concepto.trim(),
      cliente_nombre: clienteNombre.trim() || null,
      cliente_telefono: clienteTelefono.trim() || null,
    }),
    onSuccess: async (charge) => {
      setLatestCharge(charge);
      setCopiedChargeId(null);
      setCopyError("");
      await refreshHistory();
    },
  });

  const cancelMutation = useMutation({
    mutationFn: (chargeId: number) => api.post(`/vendedor/cobros-manuales/${chargeId}/cancelar`, {}),
    onSuccess: async (_data, chargeId) => {
      setActionError("");
      // La tarjeta de arriba quedaria ofreciendo un link que ya no cobra.
      setLatestCharge((current) => (current?.id === chargeId ? null : current));
      await refreshHistory();
    },
    onError: (error: Error) => setActionError(error.message || "No se pudo cancelar el cobro."),
  });

  const visibilityMutation = useMutation({
    mutationFn: ({ chargeId, oculto }: { chargeId: number; oculto: boolean }) =>
      api.post(`/vendedor/cobros-manuales/${chargeId}/visibilidad`, { oculto }),
    onSuccess: async (_data, variables) => {
      setActionError("");
      if (variables.oculto) {
        setExpandedChargeId(null);
        setLatestCharge((current) => (current?.id === variables.chargeId ? null : current));
      }
      await refreshHistory();
    },
    onError: (error: Error) => setActionError(error.message || "No se pudo cambiar la visibilidad del cobro."),
  });

  const canCreate = Number.isFinite(amountNumber) && amountNumber > 0 && concepto.trim().length >= 3;
  const busyChargeId = cancelMutation.isPending
    ? cancelMutation.variables ?? null
    : visibilityMutation.isPending
      ? visibilityMutation.variables?.chargeId ?? null
      : null;

  // Digitos del telefono: el backend arma el link de WhatsApp solo con 8 a 15.
  const phoneDigits = clienteTelefono.replace(/\D/g, "");
  const phoneHint = !phoneDigits
    ? ""
    : phoneDigits.length < 8 || phoneDigits.length > 15
      ? "Faltan digitos: sin codigo de pais no se arma el envio por WhatsApp."
      : `Listo para enviar a +${phoneDigits}`;
  const phoneHintOk = Boolean(phoneDigits) && phoneDigits.length >= 8 && phoneDigits.length <= 15;

  function confirmAndCreate() {
    if (!canCreate) return;
    const accepted = window.confirm(`Vas a generar un link de Mercado Pago por ${formatMoney(amountNumber)}. ¿Confirmas el importe?`);
    if (accepted) createMutation.mutate();
  }

  function confirmCancel(charge: ManualCharge) {
    const accepted = window.confirm(
      `¿Cancelar el cobro #${charge.id} por ${formatMoney(charge.monto)}?\n\nEl link y el QR dejan de funcionar para el cliente.`,
    );
    if (accepted) cancelMutation.mutate(charge.id);
  }

  function confirmHide(charge: ManualCharge) {
    const accepted = window.confirm(
      `¿Ocultar el cobro #${charge.id} de la lista?\n\nNo se borra: podes volver a verlo marcando "Ver ocultos".`,
    );
    if (accepted) visibilityMutation.mutate({ chargeId: charge.id, oculto: true });
  }

  async function copyPaymentLink(charge: ManualCharge) {
    if (!charge.checkout_url) return;
    try {
      await navigator.clipboard.writeText(charge.checkout_url);
      setCopiedChargeId(charge.id);
      setCopyError("");
    } catch {
      setCopiedChargeId(null);
      setCopyError("No se pudo copiar el link. Revisa los permisos del navegador.");
    }
  }

  const recentCharges = historyQuery.data ?? [];

  return (
    <section aria-labelledby="manual-payment-title" style={{ display: "grid", gap: "1rem" }}>
      <WhatsappOrdersPanel />
      <div style={{ borderTop: "1px solid #ead8ca", marginTop: "0.35rem" }} />

      <div className="cobros-panel">
        <div>
          <h2 id="manual-payment-title">Generar link de cobro</h2>
          <p className="cp-ayuda" style={{ marginTop: "0.35rem" }}>
            Ingresa el total final acordado, incluido el envio si corresponde. El QR abre exactamente el mismo link: no genera un segundo cobro.
          </p>
        </div>

        <div className="cp-campo">
          <span className="cp-lbl">Importe final</span>
          <label className="cp-imp-row">
            <span className="cp-peso" aria-hidden="true">$</span>
            <input
              type="number"
              min="0.01"
              step="0.01"
              inputMode="decimal"
              value={monto}
              onChange={(event) => setMonto(event.target.value)}
              placeholder="0"
              aria-label="Importe final en pesos"
            />
          </label>
          <p className="cp-eco">
            {canCreate ? `${formatMoney(amountNumber)} · ${amountInWords(amountNumber)} pesos` : "Inclui el envio si corresponde."}
          </p>
        </div>

        <label className="cp-campo">
          <span className="cp-lbl">Concepto</span>
          <input value={concepto} maxLength={180} onChange={(event) => setConcepto(event.target.value)} />
        </label>

        <div className="cp-grupo">
          <span className="cp-lbl">Cliente · opcional</span>
          <label className="cp-campo">
            <span className="cp-lbl">Nombre</span>
            <input value={clienteNombre} maxLength={160} onChange={(event) => setClienteNombre(event.target.value)} />
          </label>
          <div>
            <label className="cp-campo">
              <span className="cp-lbl">WhatsApp con codigo de pais</span>
              <input
                type="tel"
                value={clienteTelefono}
                maxLength={40}
                onChange={(event) => setClienteTelefono(event.target.value)}
                placeholder="5493794632610"
              />
            </label>
            <p className={`cp-eco${phoneHint ? (phoneHintOk ? " cp-eco-ok" : " cp-eco-err") : ""}`}>{phoneHint}</p>
          </div>
        </div>

        <div style={{ display: "grid", gap: "0.6rem", justifyItems: "start" }}>
          <button type="button" className="cp-btn" disabled={!canCreate || createMutation.isPending} onClick={confirmAndCreate}>
            {createMutation.isPending ? "Generando..." : `Generar por ${canCreate ? formatMoney(amountNumber) : "$ 0"}`}
          </button>
          {createMutation.isError ? <p role="alert" className="cp-alerta">{(createMutation.error as Error).message}</p> : null}
        </div>

        {latestCharge?.checkout_url ? (
          <div>
            <span className="cp-lbl">Link listo por {formatMoney(latestCharge.monto)}</span>
            <ChargeShareActions charge={latestCharge} copied={copiedChargeId === latestCharge.id} onCopy={(charge) => void copyPaymentLink(charge)} />
          </div>
        ) : null}
        {copyError ? <p role="alert" className="cp-alerta">{copyError}</p> : null}

        <div style={{ display: "grid", gap: "0.35rem" }}>
          <div className="cp-cabecera">
            <h3>Cobros recientes</h3>
            <label className="cp-check">
              <input type="checkbox" checked={showHidden} onChange={(event) => setShowHidden(event.target.checked)} />
              Ver ocultos
            </label>
          </div>
          {actionError ? <p role="alert" className="cp-alerta">{actionError}</p> : null}
          {historyQuery.isLoading ? <p className="cp-meta">Cargando cobros...</p> : null}
          {historyQuery.isError ? <p role="alert" className="cp-alerta">{(historyQuery.error as Error).message}</p> : null}
          {recentCharges.length === 0 && !historyQuery.isLoading ? <p className="cp-meta">Todavia no hay links generados.</p> : null}

          <div className="cp-lista">
            {recentCharges.slice(0, 12).map((charge) => {
              const expanded = expandedChargeId === charge.id;
              const pendiente = charge.estado === "iniciado";
              const busy = busyChargeId === charge.id;
              return (
                <div key={charge.id} className={`cp-fila${charge.oculto ? " cp-oculta" : ""}`}>
                  <div className="cp-fila-top">
                    <div>
                      <span className="cp-monto">{formatMoney(charge.monto)}</span>
                      <span className={`cp-estado ${statusClass(charge.estado)}`}>
                        {statusLabel(charge.estado)}
                        {charge.oculto ? " · oculto" : ""}
                      </span>
                      <p className="cp-meta">
                        #{charge.id} · {charge.concepto}
                        {charge.cliente_nombre ? ` · ${charge.cliente_nombre}` : ""}
                        {charge.created_at ? ` · ${formatBuenosAiresDateTime(charge.created_at)}` : ""}
                      </p>
                    </div>
                    <div className="cp-acciones">
                      {charge.checkout_url ? (
                        <button
                          type="button"
                          className="cp-acc"
                          aria-expanded={expanded}
                          onClick={() => setExpandedChargeId(expanded ? null : charge.id)}
                        >
                          {expanded ? "Cerrar" : "Ver QR"}
                        </button>
                      ) : null}
                      {pendiente ? (
                        <button type="button" className="cp-acc cp-acc-baja" disabled={busy} onClick={() => confirmCancel(charge)}>
                          {busy ? "Cancelando..." : "Cancelar"}
                        </button>
                      ) : null}
                      {charge.oculto ? (
                        <button
                          type="button"
                          className="cp-acc cp-acc-baja"
                          disabled={busy}
                          onClick={() => visibilityMutation.mutate({ chargeId: charge.id, oculto: false })}
                        >
                          {busy ? "Mostrando..." : "Mostrar"}
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="cp-acc cp-acc-baja"
                          disabled={busy || pendiente}
                          title={pendiente ? "Cancela el cobro antes de ocultarlo: el link todavia puede cobrarse." : undefined}
                          onClick={() => confirmHide(charge)}
                        >
                          {busy ? "Ocultando..." : "Ocultar"}
                        </button>
                      )}
                    </div>
                  </div>
                  {expanded ? (
                    <ChargeShareActions charge={charge} copied={copiedChargeId === charge.id} onCopy={(item) => void copyPaymentLink(item)} />
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
