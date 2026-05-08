import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
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
  method: "brick" | "wallet" | "cash";
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
    metodo: "brick" | "wallet" | "cash" | null;
    checkout_url: string | null;
    preference_id: string | null;
    public_key: string | null;
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
}: {
  confirmed: CheckoutConfirmResponse;
  onPaid: (response: ProcessPaymentResponse) => void;
  onApproved: () => void;
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
      setBrickError(`Mercado Pago dejo el pago en estado ${response.pago_estado || "pendiente"}.`);
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
          },
          customization: {
            visual: {
              style: {
                theme: "default",
              },
            },
            paymentMethods: {
              creditCard: "all",
              debitCard: "all",
              ticket: "all",
              mercadoPago: "all",
              maxInstallments: 12,
            },
          },
          callbacks: {
            onReady: () => setBrickReady(true),
            onSubmit: (
              data: { selectedPaymentMethod?: string | null; formData?: Record<string, unknown> },
              additionalData?: Record<string, unknown>,
            ) =>
              processPayment.mutateAsync({
                selectedPaymentMethod: data.selectedPaymentMethod ?? null,
                formData: data.formData ?? {},
                additionalData: additionalData ?? null,
              }).then(() => undefined),
            onError: (error: unknown) => {
              const message = error instanceof Error ? error.message : "Mercado Pago no pudo renderizar el checkout.";
              setBrickError(message);
            },
          },
        });
      })
      .catch((error: Error) => setBrickError(error.message));

    return () => {
      cancelled = true;
      controller?.unmount?.();
    };
  }, [confirmed.orden_id, confirmed.pago?.preference_id, confirmed.pago?.public_key, confirmed.total_dinero]);

  return (
    <div className="catalog-confirm-branch-detail catalog-canje-block">
      <p style={{ margin: 0, fontWeight: 800 }}>Pago online</p>
      {!brickReady && !brickError ? <p className="catalog-confirm-hint">Cargando checkout seguro...</p> : null}
      <div id="mercadopago-payment-brick" />
      {processPayment.isPending ? <p className="catalog-confirm-hint">Procesando pago...</p> : null}
      {brickError ? <p className="catalog-confirm-hint" style={{ color: "#9B2C2C" }}>{brickError}</p> : null}
    </div>
  );
}

export function CarritoTienda() {
  const queryClient = useQueryClient();
  const user = useAuthStore((state) => state.user);
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
            <h1 className="catalog-title">{paymentApproved ? "Pago aprobado" : "Pedido confirmado"}</h1>
            <p className="catalog-subtitle">Orden #{confirmed.orden_id} - {money(confirmed.total_dinero)}</p>
          </div>
          {paymentApproved ? (
            <div className="checkout-approved-card" role="status" aria-live="polite">
              <p className="checkout-approved-title">Muchas gracias por tu compra</p>
              <p className="checkout-approved-text">
                Pago aprobado. Ya registramos tu pedido y el equipo va a prepararlo.
              </p>
            </div>
          ) : null}
          <div className="catalog-confirm-branch-detail catalog-canje-block">
            <p><strong>Estado:</strong> {estadoLabel}</p>
            {confirmed.pago?.metodo === "wallet" && confirmed.pago.checkout_url ? (
              <a className="product-card-btn product-card-btn-canjear" href={confirmed.pago.checkout_url} rel="noreferrer">
                Abrir Mercado Pago
              </a>
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
              onApproved={() => setPaymentApproved(true)}
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
                    <option key={option.id} value={option.id}>
                      {option.label}{option.enabled ? "" : ` (${option.reason_disabled})`}
                    </option>
                  ))}
                </select>
                {selectedPayment?.provider === "efectivo" ? (
                  <p className="catalog-confirm-hint">Se genera una reserva pendiente de pago. Si no se paga a tiempo, expira automaticamente.</p>
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
