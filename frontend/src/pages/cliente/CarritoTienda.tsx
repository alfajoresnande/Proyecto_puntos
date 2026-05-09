import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../../api";
import { useAuthStore } from "../../store/authStore";

type CartItem = {
  id: number;
  producto_id: number;
  cantidad: number;
  modo_compra: "dinero" | "puntos";
  precio_dinero_unit: number | null;
  subtotal_dinero: number;
  nombre: string;
  imagen_url: string | null;
  permite_envio?: number | boolean;
};

type CartResponse = {
  items: CartItem[];
  resumen: {
    total_items: number;
    total_unidades: number;
    total_dinero: number;
    total_puntos: number;
  };
};

type SucursalRetiro = {
  id: number;
  nombre: string;
  direccion: string;
  piso?: string | null;
  localidad: string;
  provincia: string;
};

type PaymentOption = {
  id: string;
  provider: "mercadopago" | "efectivo";
  method: "brick" | "wallet" | "qr" | "cash";
  label: string;
  description: string;
  enabled: boolean;
  reason_disabled: string | null;
};

type PaymentOptionsResponse = {
  options: PaymentOption[];
  default_option: string;
};

type CheckoutConfirmResponse = {
  orden_id: number;
  estado: string;
  total_dinero: number;
  pago_pendiente: boolean;
  pago: null | {
    proveedor: string | null;
    metodo: "brick" | "wallet" | "qr" | "cash" | null;
    checkout_url: string | null;
    preference_id: string | null;
    public_key: string | null;
    qr_data?: string | null;
    qr_image?: string | null;
    expires_at?: string | null;
    provider_payment_id: string | null;
    setup_status: "ready" | "requires_configuration" | null;
    setup_message: string | null;
  };
};

type ProcessPaymentResponse = {
  ok: boolean;
  orden_id: number;
  estado: string;
  pago_estado?: string;
  status_detail?: string | null;
};

type OrdenCheckoutStatus = {
  ok?: boolean;
  orden_id?: number;
  id: number;
  estado: string;
  pago_estado?: string | null;
  provider_payment_id?: string | null;
  status_detail?: string | null;
};

type PaymentNotice = {
  variant: "success" | "error" | "info";
  msg: string;
};

type MetodoEntrega = "retiro" | "envio";

type ShippingDraft = {
  nombre: string;
  telefono: string;
  direccion: string;
  codigo_postal: string;
  localidad: string;
  provincia: string;
  referencias: string;
};

function money(value: number | string | null | undefined): string {
  const n = Number(value ?? 0);
  return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" }).format(Number.isFinite(n) ? n : 0);
}

function estadoPedidoLabel(estado: string): string {
  const normalized = estado.trim().toLowerCase();
  const labels: Record<string, string> = {
    pendiente_pago: "Pendiente de pago",
    pagada: "Pago aprobado",
    preparada: "Preparando pedido",
    enviada: "En camino",
    entregada: "Entregado",
    cancelada: "Cancelado",
    expirada: "Expirado",
  };
  return labels[normalized] ?? estado;
}

type MercadoPagoConstructor = new (
  publicKey: string,
  options?: { locale?: string },
) => {
  bricks: () => {
    create: (
      type: "payment",
      containerId: string,
      settings: Record<string, unknown>,
    ) => Promise<{ unmount?: () => void }>;
  };
};

declare global {
  interface Window {
    MercadoPago?: MercadoPagoConstructor;
  }
}

let mercadoPagoSdkPromise: Promise<void> | null = null;

function mercadoPagoErrorMessage(error: unknown): string {
  const normalizeMessage = (raw: string): string => {
    const value = raw.trim();
    if (!value) return "";
    if (value === "payment_method_not_allowed_types") {
      return "Ese tipo de tarjeta no esta habilitado para este pago. Proba con otra tarjeta o usa Abrir Mercado Pago.";
    }
    if (value === "empty_installments") {
      return "Mercado Pago no pudo calcular las cuotas para esta tarjeta. Revisa los datos y, si estas probando, confirma que la public key y el access token sean del mismo entorno.";
    }
    if (value.toLowerCase().includes("no pudimos obtener la informacion de pago") || value.toLowerCase().includes("no pudimos obtener la información de pago")) {
      return "Mercado Pago no pudo identificar esa tarjeta. Si estas probando, usa una tarjeta de prueba de Argentina y confirma que public key y access token sean del mismo entorno.";
    }
    return value;
  };

  if (error instanceof Error && error.message) return normalizeMessage(error.message);
  if (typeof error === "string" && error.trim()) return normalizeMessage(error);
  if (error && typeof error === "object") {
    const err = error as { message?: unknown; cause?: unknown; error?: unknown };
    if (typeof err.message === "string" && err.message.trim()) return normalizeMessage(err.message);
    if (typeof err.error === "string" && err.error.trim()) return normalizeMessage(err.error);
    if (Array.isArray(err.cause)) {
      const causeMessage = err.cause
        .map((item) => {
          if (typeof item === "string") return item;
          if (item && typeof item === "object" && "description" in item) {
            const description = (item as { description?: unknown }).description;
            return typeof description === "string" ? description : "";
          }
          if (item && typeof item === "object" && "message" in item) {
            const message = (item as { message?: unknown }).message;
            return typeof message === "string" ? message : "";
          }
          return "";
        })
        .find((item) => item.trim());
      if (causeMessage) return normalizeMessage(causeMessage);
    }
  }
  return "Mercado Pago no pudo identificar esa tarjeta. Si estas probando, usa una tarjeta de prueba de Argentina y confirma que public key y access token sean del mismo entorno.";
}

function loadMercadoPagoSdk(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (window.MercadoPago) return Promise.resolve();
  if (!mercadoPagoSdkPromise) {
    mercadoPagoSdkPromise = new Promise((resolve, reject) => {
      const existing = document.querySelector<HTMLScriptElement>('script[src="https://sdk.mercadopago.com/js/v2"]');
      if (existing) {
        existing.addEventListener("load", () => resolve(), { once: true });
        existing.addEventListener("error", () => reject(new Error("No se pudo cargar Mercado Pago.")), { once: true });
        return;
      }
      const script = document.createElement("script");
      script.src = "https://sdk.mercadopago.com/js/v2";
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("No se pudo cargar Mercado Pago."));
      document.head.appendChild(script);
    });
  }
  return mercadoPagoSdkPromise;
}

function MercadoPagoBrick({
  confirmed,
  onPaid,
  onApproved,
  buyerEmail,
}: {
  confirmed: CheckoutConfirmResponse;
  onPaid: (response: ProcessPaymentResponse) => void;
  onApproved: () => void;
  buyerEmail: string;
}) {
  const [brickReady, setBrickReady] = useState(false);
  const [brickError, setBrickError] = useState<string | null>(null);

  const processPayment = useMutation({
    mutationFn: (payload: {
      selectedPaymentMethod?: string | null;
      formData: Record<string, unknown>;
      additionalData?: Record<string, unknown> | null;
    }) =>
      api.post<ProcessPaymentResponse>(`/cliente/checkout/ordenes/${confirmed.orden_id}/process-payment`, {
        selected_payment_method: payload.selectedPaymentMethod ?? null,
        form_data: payload.formData,
        additional_data: payload.additionalData ?? null,
      }),
    onSuccess: (response) => {
      if (response.ok) {
        setBrickError(null);
        onApproved();
        onPaid(response);
        return;
      }
      const detail = response.status_detail ? ` (${response.status_detail})` : "";
      setBrickError(`Mercado Pago dejo el pago en estado ${response.pago_estado || "pendiente"}${detail}.`);
    },
    onError: (error: Error) => setBrickError(error.message || "No se pudo procesar el pago."),
  });

  useEffect(() => {
    const publicKey = confirmed.pago?.public_key;
    const preferenceId = confirmed.pago?.preference_id;
    if (!publicKey || !preferenceId) return;

    let cancelled = false;
    let controller: { unmount?: () => void } | null = null;
    setBrickReady(false);
    setBrickError(null);

    loadMercadoPagoSdk()
      .then(async () => {
        if (cancelled || !window.MercadoPago) return;
        const mp = new window.MercadoPago(publicKey, { locale: "es-AR" });
        const bricksBuilder = mp.bricks();
        controller = await bricksBuilder.create("payment", "mercadopago-payment-brick", {
          initialization: {
            amount: Number(confirmed.total_dinero),
            preferenceId,
            payer: buyerEmail && buyerEmail.includes("@")
              ? {
                  email: buyerEmail.trim(),
                }
              : undefined,
          },
          customization: {
            visual: {
              style: {
                theme: "default",
              },
            },
            paymentMethods: {
              ticket: "all",
              creditCard: "all",
              prepaidCard: "all",
              debitCard: "all",
              mercadoPago: "all",
              maxInstallments: 12,
            },
          },
          callbacks: {
            onReady: () => setBrickReady(true),
            onSubmit: (
              data: { selectedPaymentMethod?: string | null; formData?: Record<string, unknown> },
              additionalData?: Record<string, unknown>,
            ) => {
              const isRedirectFlow = data.selectedPaymentMethod === "wallet_purchase";

              if (isRedirectFlow) {
                setBrickError(null);
                return Promise.resolve();
              }

              if (!data.formData?.token) {
                const message = "Mercado Pago no devolvio el token de la tarjeta. Revisa los datos de debito/credito e intenta de nuevo.";
                setBrickError(message);
                return Promise.reject(new Error(message));
              }

              return processPayment.mutateAsync({
                selectedPaymentMethod: data.selectedPaymentMethod ?? null,
                formData: data.formData ?? {},
                additionalData: additionalData ?? null,
              }).then(() => undefined);
            },
            onError: (error: unknown) => {
              console.error("Mercado Pago Brick error:", error);
              setBrickError(mercadoPagoErrorMessage(error));
            },
          },
        });
      })
      .catch((error: Error) => setBrickError(error.message || "No se pudo cargar Mercado Pago."));

    return () => {
      cancelled = true;
      controller?.unmount?.();
    };
  }, [buyerEmail, confirmed.orden_id, confirmed.pago?.preference_id, confirmed.pago?.public_key, confirmed.total_dinero]);

  return (
    <div className="catalog-confirm-branch-detail catalog-canje-block">
      <p style={{ margin: 0, fontWeight: 800 }}>Pago online</p>
      {!brickReady && !brickError ? <p className="catalog-confirm-hint">Cargando checkout seguro...</p> : null}
      <div id="mercadopago-payment-brick" />
      {processPayment.isPending ? <p className="catalog-confirm-hint">Procesando pago...</p> : null}
      {brickError ? <p className="catalog-confirm-hint" style={{ color: "#9B2C2C" }}>{brickError}</p> : null}
      {brickError && confirmed.pago?.checkout_url ? (
        <a className="product-card-btn product-card-btn-canjear" href={confirmed.pago.checkout_url} rel="noreferrer">
          Abrir Mercado Pago
        </a>
      ) : null}
    </div>
  );
}

export function CarritoTienda() {
  const queryClient = useQueryClient();
  const user = useAuthStore((state) => state.user);
  const [searchParams, setSearchParams] = useSearchParams();
  const resumeOrderId = searchParams.get("pagar_orden");
  const [sucursalId, setSucursalId] = useState(() =>
    typeof window !== "undefined" ? window.localStorage.getItem("sucursal_retiro_id") ?? "" : ""
  );
  const [paymentId, setPaymentId] = useState("");
  const [metodoEntrega, setMetodoEntrega] = useState<MetodoEntrega>("retiro");
  const [shippingDraft, setShippingDraft] = useState<ShippingDraft>({
    nombre: user?.nombre ?? "",
    telefono: "",
    direccion: "",
    codigo_postal: "",
    localidad: "",
    provincia: "",
    referencias: "",
  });
  const [message, setMessage] = useState<string | null>(null);
  const [needsProfile, setNeedsProfile] = useState(false);
  const [confirmed, setConfirmed] = useState<CheckoutConfirmResponse | null>(null);
  const [paymentApproved, setPaymentApproved] = useState(false);
  const [paymentNotice, setPaymentNotice] = useState<PaymentNotice | null>(null);

  const cartQuery = useQuery({
    queryKey: ["cliente", "carrito-online"],
    queryFn: () => api.get<CartResponse>("/cliente/carrito"),
  });

  const sucursalesQuery = useQuery({
    queryKey: ["cliente", "sucursales-retiro"],
    queryFn: () => api.get<SucursalRetiro[]>("/cliente/sucursales"),
  });

  const paymentOptionsQuery = useQuery({
    queryKey: ["cliente", "payment-options"],
    queryFn: () => api.get<PaymentOptionsResponse>("/cliente/checkout/payment-options"),
  });

  const resumePaymentQuery = useQuery({
    queryKey: ["cliente", "resume-payment", resumeOrderId],
    queryFn: () => api.get<CheckoutConfirmResponse>(`/cliente/checkout/ordenes/${resumeOrderId}/resume-payment`),
    enabled: Boolean(resumeOrderId),
    retry: false,
  });

  const cartItems = useMemo(
    () => (cartQuery.data?.items ?? []).filter((item) => item.modo_compra === "dinero"),
    [cartQuery.data?.items],
  );
  const total = cartItems.reduce((acc, item) => acc + Number(item.subtotal_dinero ?? 0), 0);
  const totalUnidades = cartItems.reduce((acc, item) => acc + Number(item.cantidad ?? 0), 0);
  const sucursales = sucursalesQuery.data ?? [];
  const sucursalSeleccionada =
    (sucursalId ? sucursales.find((s) => String(s.id) === sucursalId) : undefined) ||
    (sucursales.length === 1 ? sucursales[0] : undefined);
  const paymentOptions = paymentOptionsQuery.data?.options ?? [];
  const visiblePaymentOptions = paymentOptions.filter((option) => metodoEntrega === "retiro" || option.provider !== "efectivo");
  const selectedPayment =
    visiblePaymentOptions.find((option) => option.id === (paymentId || paymentOptionsQuery.data?.default_option)) ??
    visiblePaymentOptions[0];
  const todosPermitenEnvio = cartItems.every((item) => item.permite_envio === true || Number(item.permite_envio ?? 0) === 1);
  const shouldPollMercadoPagoOrder = Boolean(
    confirmed?.orden_id &&
    confirmed.pago_pendiente &&
    !paymentApproved &&
    confirmed.pago?.proveedor === "mercadopago",
  );
  const isCashOrder = confirmed?.pago?.proveedor === "efectivo" || confirmed?.pago?.metodo === "cash";
  const confirmedTitle = paymentApproved
    ? "Pago aprobado"
    : isCashOrder
      ? "Pedido reservado"
      : "Pedido pendiente de pago";

  const confirmedOrderQuery = useQuery({
    queryKey: ["cliente", "orden-payment-status", confirmed?.orden_id],
    queryFn: () => api.get<OrdenCheckoutStatus>(`/cliente/checkout/ordenes/${confirmed?.orden_id}/payment-status`),
    enabled: shouldPollMercadoPagoOrder,
    refetchInterval: (query) => {
      if (!shouldPollMercadoPagoOrder || !confirmed?.orden_id) return false;
      const currentOrder = query.state.data;
      return currentOrder?.estado === "pendiente_pago" || !currentOrder ? 5000 : false;
    },
  });

  useEffect(() => {
    if (!resumeOrderId) return;
    if (resumePaymentQuery.data) {
      setConfirmed(resumePaymentQuery.data);
      setPaymentApproved(resumePaymentQuery.data.estado === "pagada");
      setPaymentNotice(null);
      setMessage(null);
      setNeedsProfile(false);
      const nextParams = new URLSearchParams(searchParams);
      nextParams.delete("pagar_orden");
      setSearchParams(nextParams, { replace: true });
      return;
    }
    if (resumePaymentQuery.error instanceof Error) {
      setMessage(resumePaymentQuery.error.message || "No se pudo reanudar el pago de la orden.");
      const nextParams = new URLSearchParams(searchParams);
      nextParams.delete("pagar_orden");
      setSearchParams(nextParams, { replace: true });
    }
  }, [resumeOrderId, resumePaymentQuery.data, resumePaymentQuery.error, searchParams, setSearchParams]);

  useEffect(() => {
    if (!sucursales.length) return;
    if (!sucursalId || !sucursales.some((sucursal) => String(sucursal.id) === sucursalId)) {
      setSucursalId(String(sucursales[0].id));
    }
  }, [sucursalId, sucursales]);

  useEffect(() => {
    if (sucursalId && typeof window !== "undefined") {
      window.localStorage.setItem("sucursal_retiro_id", sucursalId);
    }
  }, [sucursalId]);

  useEffect(() => {
    if (metodoEntrega === "envio" && selectedPayment?.provider === "efectivo") {
      setPaymentId("");
    }
  }, [metodoEntrega, selectedPayment?.provider]);

  useEffect(() => {
    if (!confirmed?.orden_id || !confirmedOrderQuery.data) return;
    const currentOrder = confirmedOrderQuery.data;
    const nextState = currentOrder?.estado?.trim().toLowerCase();
    if (!nextState || nextState === "pendiente_pago") return;

    if (nextState === "pagada") {
      if (!paymentApproved || confirmed.estado !== "pagada") {
        setPaymentApproved(true);
        setPaymentNotice({
          variant: "success",
          msg: "Pago aprobado. Ya registramos tu pedido y el equipo va a prepararlo.",
        });
        setConfirmed((prev) =>
          prev && Number(prev.orden_id) === Number(confirmed.orden_id)
            ? { ...prev, estado: "pagada", pago_pendiente: false }
            : prev,
        );
        void queryClient.invalidateQueries({ queryKey: ["cliente", "carrito-online"] });
      }
      return;
    }

    if (nextState === "cancelada" || nextState === "expirada") {
      setPaymentNotice({
        variant: "error",
        msg: nextState === "expirada"
          ? "El pago expiro en Mercado Pago. Puedes generar una compra nueva cuando quieras."
          : "Mercado Pago rechazo o cancelo el pago.",
      });
      setConfirmed((prev) =>
        prev && Number(prev.orden_id) === Number(confirmed.orden_id)
          ? { ...prev, estado: nextState, pago_pendiente: false }
          : prev,
      );
    }
  }, [
    confirmed?.estado,
    confirmed?.orden_id,
    confirmedOrderQuery.data,
    paymentApproved,
    queryClient,
  ]);

  const updateQuantity = useMutation({
    mutationFn: ({ itemId, cantidad }: { itemId: number; cantidad: number }) =>
      api.patch<{ ok: true }>(`/cliente/carrito/items/${itemId}`, { cantidad }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["cliente", "carrito-online"] }),
  });

  const deleteItem = useMutation({
    mutationFn: (itemId: number) => api.delete<{ ok: true }>(`/cliente/carrito/items/${itemId}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["cliente", "carrito-online"] }),
  });

  const confirmCheckout = useMutation({
    mutationFn: () =>
      api.post<CheckoutConfirmResponse>("/cliente/checkout/confirm", {
        sucursal_id: sucursalSeleccionada?.id,
        metodo_entrega: metodoEntrega,
        direccion_envio: metodoEntrega === "envio"
          ? {
              nombre: shippingDraft.nombre.trim(),
              telefono: shippingDraft.telefono.trim(),
              direccion: shippingDraft.direccion.trim(),
              codigo_postal: shippingDraft.codigo_postal.trim(),
              localidad: shippingDraft.localidad.trim(),
              provincia: shippingDraft.provincia.trim(),
              referencias: shippingDraft.referencias.trim() || null,
            }
          : null,
        pago: selectedPayment ? { provider: selectedPayment.provider, method: selectedPayment.method } : undefined,
      }),
    onSuccess: async (data) => {
      setConfirmed(data);
      setPaymentApproved(data.estado === "pagada");
      setPaymentNotice(data.estado === "pagada"
        ? {
            variant: "success",
            msg: "Pago aprobado. Ya registramos tu pedido y el equipo va a prepararlo.",
          }
        : null);
      setMessage(null);
      setNeedsProfile(false);
      await queryClient.invalidateQueries({ queryKey: ["cliente", "carrito-online"] });
      await queryClient.invalidateQueries({ queryKey: ["cliente", "ordenes"] });
    },
    onError: (error: Error) => {
      const msg = error.message || "No se pudo confirmar el checkout.";
      setNeedsProfile(msg.toLowerCase().includes("completa tus datos obligatorios"));
      setMessage(msg);
    },
  });

  function confirmar() {
    if (!cartItems.length) {
      setMessage("Tu carrito esta vacio.");
      return;
    }
    if (sucursales.length > 1 && !sucursalSeleccionada) {
      setMessage(metodoEntrega === "envio" ? "Selecciona una sucursal para preparar el envio." : "Selecciona una sucursal para reservar stock.");
      return;
    }
    if (metodoEntrega === "envio") {
      if (!todosPermitenEnvio) {
        setMessage("Hay productos del carrito que no permiten envio.");
        return;
      }
      const required = [
        shippingDraft.nombre,
        shippingDraft.telefono,
        shippingDraft.direccion,
        shippingDraft.codigo_postal,
        shippingDraft.localidad,
        shippingDraft.provincia,
      ];
      if (required.some((value) => !value.trim())) {
        setMessage("Completa nombre, telefono, direccion, codigo postal, localidad y provincia para el envio.");
        return;
      }
    }
    setMessage(null);
    setNeedsProfile(false);
    confirmCheckout.mutate();
  }

  if (confirmed) {
    const estadoLabel = estadoPedidoLabel(confirmed.estado);
    return (
      <section className="catalog-page catalog-canje-page">
        <div className="catalog-products-shell">
          <div className="catalog-header">
            <h1 className="catalog-title">{confirmedTitle}</h1>
            <p className="catalog-subtitle">Orden #{confirmed.orden_id} - {money(confirmed.total_dinero)}</p>
          </div>
          {paymentNotice ? (
            <div className="catalog-canje-block" role="status" aria-live="polite">
              <p>{paymentNotice.msg}</p>
              <div className="catalog-float-toast-actions catalog-canje-actions">
                {paymentNotice.variant === "success" ? (
                  <Link to="/mis-pedidos" className="catalog-float-toast-btn-primary">Ver mis pedidos</Link>
                ) : null}
                <button className="catalog-float-toast-btn-secondary" onClick={() => setPaymentNotice(null)}>
                  Cerrar
                </button>
              </div>
            </div>
          ) : null}
          {paymentApproved ? (
            <div className="checkout-approved-card" role="status" aria-live="polite">
              <img
                src="/nande_muchas_gracias.webp"
                alt="Pedido pagado con exito"
                className="store-order-thanks-image"
              />
              <p className="checkout-approved-title">Muchas gracias por tu compra</p>
              <p className="checkout-approved-text">
                Pago aprobado. Ya registramos tu pedido y el equipo va a prepararlo.
              </p>
            </div>
          ) : isCashOrder ? (
            <div className="catalog-canje-block" role="status" aria-live="polite">
              <p><strong>Reservamos tu pedido.</strong> Lo pagas en efectivo al retirar en sucursal.</p>
            </div>
          ) : (
            <div className="catalog-canje-block" role="status" aria-live="polite">
              <p><strong>Tu pedido todavia no esta confirmado.</strong> Se confirma automaticamente cuando Mercado Pago aprueba el pago.</p>
            </div>
          )}
          <div className="catalog-confirm-branch-detail catalog-canje-block">
            <p><strong>Estado:</strong> {estadoLabel}</p>
            {shouldPollMercadoPagoOrder ? (
              <p className="catalog-confirm-hint">
                Si Mercado Pago abre la app, termina el pago ahi. Cuando llegue la confirmacion, esta pantalla se actualiza sola.
              </p>
            ) : null}
            {confirmed.pago?.metodo === "wallet" && confirmed.pago.checkout_url ? (
              <a className="product-card-btn product-card-btn-canjear" href={confirmed.pago.checkout_url} rel="noreferrer">
                Abrir Mercado Pago
              </a>
            ) : confirmed.pago?.metodo === "qr" && confirmed.pago.qr_image ? (
              <div className="store-qr-payment-card">
                <p className="store-qr-payment-title">Escanea este QR con Mercado Pago</p>
                <img src={confirmed.pago.qr_image} alt={`QR de pago para orden ${confirmed.orden_id}`} />
                <p className="catalog-confirm-hint">
                  Cuando Mercado Pago apruebe el pago, el pedido se confirma automaticamente.
                  {confirmed.pago.expires_at ? " Si vence, genera una compra nueva." : ""}
                </p>
              </div>
            ) : confirmed.pago?.setup_message ? (
              <p>{confirmed.pago.setup_message}</p>
            ) : null}
            <div className="catalog-float-toast-actions catalog-canje-actions">
              <Link to="/mis-pedidos" className="catalog-float-toast-btn-primary">Ver mis pedidos</Link>
              <Link to="/tienda" className="catalog-float-toast-btn-secondary">Volver a tienda</Link>
            </div>
          </div>
          {confirmed.pago?.metodo === "brick" && confirmed.pago.public_key && confirmed.pago.preference_id ? (
            <MercadoPagoBrick
              confirmed={confirmed}
              buyerEmail={user?.email ?? ""}
              onPaid={(response) =>
                setConfirmed((prev) =>
                  prev
                    ? {
                        ...prev,
                        estado: response.estado,
                        pago_pendiente: response.estado !== "pagada",
                      }
                    : prev,
                )
              }
              onApproved={() => {
                setPaymentApproved(true);
                setPaymentNotice({
                  variant: "success",
                  msg: "Pago aprobado. Ya registramos tu pedido y el equipo va a prepararlo.",
                });
              }}
            />
          ) : null}
        </div>
      </section>
    );
  }

  return (
    <section className="catalog-page catalog-canje-page">
      <div className="catalog-products-shell">
        <div className="catalog-header">
          <h1 className="catalog-title">Carrito tienda</h1>
          <p className="catalog-subtitle">Revisa tu compra, elegi entrega y confirma el pago</p>
        </div>

        {!user ? (
          <div className="catalog-canje-block">
            <p>Inicia sesion para comprar online.</p>
            <Link className="product-card-btn product-card-btn-canjear" to="/login">Ir a login</Link>
          </div>
        ) : resumePaymentQuery.isFetching ? (
          <div className="catalog-canje-block">
            <p>Reabriendo el pago pendiente...</p>
          </div>
        ) : cartQuery.isLoading ? (
          <div className="catalog-skeleton store-skeleton" />
        ) : !cartItems.length ? (
          <div className="catalog-canje-block">
            <p>Tu carrito esta vacio.</p>
            <Link className="product-card-btn product-card-btn-canjear" to="/tienda">Ir a tienda</Link>
          </div>
        ) : (
          <>
            <div className="catalog-confirm-branch-detail catalog-canje-block catalog-canje-list">
              {cartItems.map((item) => (
                <div key={item.id} className="catalog-canje-item">
                  <div>
                    <p style={{ margin: 0, fontWeight: 800 }}>{item.nombre}</p>
                    <p style={{ margin: "0.1rem 0 0", color: "#8B5A30" }}>{money(item.subtotal_dinero)}</p>
                  </div>
                  <div className="catalog-canje-item-qty">
                    <button
                      type="button"
                      disabled={updateQuantity.isPending || deleteItem.isPending}
                      onClick={() => item.cantidad <= 1 ? deleteItem.mutate(item.id) : updateQuantity.mutate({ itemId: item.id, cantidad: item.cantidad - 1 })}
                    >
                      -
                    </button>
                    <span>{item.cantidad}</span>
                    <button
                      type="button"
                      disabled={updateQuantity.isPending || deleteItem.isPending}
                      onClick={() => updateQuantity.mutate({ itemId: item.id, cantidad: item.cantidad + 1 })}
                    >
                      +
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <div className="catalog-confirm-branch-detail catalog-canje-block catalog-canje-summary">
              <p>Total de productos: <strong>{totalUnidades}</strong></p>
              <p>Total a pagar: <strong>{money(total)}</strong></p>
            </div>

            <div className="catalog-confirm-field catalog-canje-pickup">
              <label className="catalog-confirm-label" htmlFor="carrito-tienda-entrega">Forma de entrega</label>
              <select
                id="carrito-tienda-entrega"
                className="catalog-pickup-select"
                value={metodoEntrega}
                onChange={(event) => setMetodoEntrega(event.target.value as MetodoEntrega)}
                disabled={confirmCheckout.isPending}
              >
                <option value="retiro">Retiro en sucursal</option>
                <option value="envio" disabled={!todosPermitenEnvio}>Envio a domicilio</option>
              </select>
              {!todosPermitenEnvio ? (
                <p className="catalog-confirm-hint">Algunos productos del carrito solo permiten retiro en sucursal.</p>
              ) : null}
            </div>

            <div className="catalog-confirm-field catalog-canje-pickup">
              <label className="catalog-confirm-label" htmlFor="carrito-tienda-sucursal">
                {metodoEntrega === "envio" ? "Sucursal que prepara el envio" : "Sucursal de retiro"}
              </label>
              <select
                id="carrito-tienda-sucursal"
                className="catalog-pickup-select"
                value={sucursalId}
                onChange={(event) => setSucursalId(event.target.value)}
                disabled={sucursalesQuery.isLoading || confirmCheckout.isPending}
              >
                {sucursales.length > 1 ? <option value="">Selecciona una sucursal</option> : null}
                {sucursales.map((sucursal) => <option key={sucursal.id} value={sucursal.id}>{sucursal.nombre}</option>)}
              </select>
            </div>

            {metodoEntrega === "envio" ? (
              <div className="catalog-confirm-branch-detail catalog-canje-block">
                <p style={{ margin: 0, fontWeight: 800 }}>Datos de envio</p>
                <div className="adm-form-grid">
                  <input
                    className="adm-input"
                    placeholder="Nombre de quien recibe"
                    value={shippingDraft.nombre}
                    onChange={(event) => setShippingDraft((prev) => ({ ...prev, nombre: event.target.value }))}
                  />
                  <input
                    className="adm-input"
                    placeholder="Telefono"
                    value={shippingDraft.telefono}
                    onChange={(event) => setShippingDraft((prev) => ({ ...prev, telefono: event.target.value }))}
                  />
                </div>
                <input
                  className="adm-input"
                  placeholder="Direccion completa"
                  value={shippingDraft.direccion}
                  onChange={(event) => setShippingDraft((prev) => ({ ...prev, direccion: event.target.value }))}
                />
                <div className="adm-form-grid">
                  <input
                    className="adm-input"
                    placeholder="Codigo postal"
                    value={shippingDraft.codigo_postal}
                    onChange={(event) => setShippingDraft((prev) => ({ ...prev, codigo_postal: event.target.value }))}
                  />
                  <input
                    className="adm-input"
                    placeholder="Localidad"
                    value={shippingDraft.localidad}
                    onChange={(event) => setShippingDraft((prev) => ({ ...prev, localidad: event.target.value }))}
                  />
                </div>
                <input
                  className="adm-input"
                  placeholder="Provincia"
                  value={shippingDraft.provincia}
                  onChange={(event) => setShippingDraft((prev) => ({ ...prev, provincia: event.target.value }))}
                />
                <textarea
                  className="adm-input"
                  placeholder="Referencias para el envio (opcional)"
                  value={shippingDraft.referencias}
                  onChange={(event) => setShippingDraft((prev) => ({ ...prev, referencias: event.target.value }))}
                />
              </div>
            ) : null}

            {visiblePaymentOptions.length ? (
              <div className="catalog-confirm-field catalog-canje-pickup">
                <label className="catalog-confirm-label" htmlFor="carrito-tienda-pago">Medio de pago</label>
                <select
                  id="carrito-tienda-pago"
                  className="catalog-pickup-select"
                  value={selectedPayment?.id || ""}
                  onChange={(event) => setPaymentId(event.target.value)}
                >
                  {visiblePaymentOptions.map((option) => (
                    <option key={option.id} value={option.id} disabled={!option.enabled}>
                      {option.label}{option.enabled ? "" : " (no disponible)"}
                    </option>
                  ))}
                </select>
                {selectedPayment?.description ? (
                  <p className="catalog-confirm-hint">{selectedPayment.description}</p>
                ) : null}
                {selectedPayment?.provider === "efectivo" ? (
                  <p className="catalog-confirm-hint">Se reserva el pedido para retiro. El equipo no lo toma como pago aprobado hasta cobrarlo en sucursal.</p>
                ) : selectedPayment?.method === "brick" ? (
                  <p className="catalog-confirm-hint">Esta opcion deja el pago con tarjeta dentro del sitio. Si prefieres usar tu cuenta o la app, elige "Pagar con Mercado Pago".</p>
                ) : selectedPayment?.method === "qr" ? (
                  <p className="catalog-confirm-hint">Te vamos a mostrar un QR de Mercado Pago para escanear y pagar desde la app.</p>
                ) : null}
              </div>
            ) : null}

            {message ? <p className="catalog-confirm-hint" style={{ color: "#9B2C2C" }}>{message}</p> : null}
            {needsProfile ? (
              <div className="catalog-float-toast-actions catalog-canje-actions">
                <Link to="/mi-perfil" className="product-card-btn product-card-btn-canjear">Completar mi perfil</Link>
              </div>
            ) : null}

            <div className="catalog-float-toast-actions catalog-canje-actions">
              <button className="catalog-float-toast-btn-primary" onClick={confirmar} disabled={confirmCheckout.isPending}>
                {confirmCheckout.isPending ? "Confirmando..." : "Confirmar compra"}
              </button>
              <Link className="catalog-float-toast-btn-secondary" to="/tienda">Seguir comprando</Link>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
