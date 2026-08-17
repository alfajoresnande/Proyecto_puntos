import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../../api";
import { AddressSelector } from "../../components/addresses/AddressSelector";
import { useToast } from "../../components/ToastProvider";
import { useAuthStore } from "../../store/authStore";
import { usePickupStore } from "../../store/pickupStore";
import type { ShippingQuote, UserAddress } from "../../types";

type CartItem = {
  id: number;
  producto_id: number;
  cantidad: number;
  modo_compra: "dinero" | "puntos";
  config_hash?: string;
  precio_dinero_unit: number | null;
  subtotal_dinero: number;
  nombre: string;
  imagen_url: string | null;
  permite_envio?: number | boolean;
  envio_gratis?: number | boolean;
  configuracion_tipo?: "simple" | "caja_sabores";
  capacidad_sabores?: number | null;
  promo_eventbar_activa?: boolean;
  promo_eventbar_aplicada?: boolean;
  promo_eventbar_tipo?: "2x1" | "3x2" | "4x3" | null;
  promo_eventbar_label?: string | null;
  promo_eventbar_cantidad_requerida?: number | null;
  promo_eventbar_cantidad_paga?: number | null;
  promo_eventbar_precio_unitario_efectivo?: number | null;
  promo_eventbar_subtotal_regular?: number | null;
  promo_eventbar_ahorro?: number | null;
  sabores?: Array<{
    sabor_id: number;
    nombre: string;
    cantidad: number;
  }>;
};

type CartResponse = {
  items: CartItem[];
  resumen: {
    total_items: number;
    total_unidades: number;
    total_dinero: number;
    total_puntos: number;
    total_puntos_ganados?: number;
    envio_gratis_monto_minimo?: number;
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
  total_dinero_productos?: number;
  costo_envio?: number;
  total_puntos_ganados?: number;
  metodo_entrega?: "retiro" | "envio";
  envio?: ShippingQuote | null;
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

type MercadoPagoReturnResponse = {
  ok: boolean;
  orden_id: number;
  estado: string;
  pago_estado?: string;
  status_detail?: string | null;
  already_paid?: boolean;
  provider_payment_id?: string | null;
};

type OrdenCheckoutStatus = {
  ok?: boolean;
  orden_id?: number;
  id: number;
  estado: string;
  total_puntos_ganados?: number;
  pago_estado?: string | null;
  provider_payment_id?: string | null;
  status_detail?: string | null;
};

type PaymentNotice = {
  variant: "success" | "error" | "info";
  msg: string;
};

type CartToast = {
  variant: "success" | "error";
  msg: string;
};

type CheckoutOrderDetail = {
  id: number;
  estado: string;
  total_dinero: number;
  total_puntos_ganados?: number;
  direccion_envio?: {
    costo_envio?: number | null;
    envio?: ShippingQuote | null;
  } | null;
  pago?: {
    proveedor: string;
    metodo: "brick" | "wallet" | "qr" | "cash" | null;
    estado: string;
    provider_payment_id?: string | null;
    checkout_url?: string | null;
  } | null;
  items?: Array<{
    cantidad: number;
    puntaje_al_comprar_unitario?: number | null;
  }>;
};

const LAST_APPROVED_ORDER_STORAGE_KEY = "nande-last-approved-order";
const APPROVED_ORDER_STATES = new Set(["pagada", "preparandose", "preparada", "enviada", "entregando", "entregada"]);

function isApprovedOrderState(estado: string | null | undefined): boolean {
  return APPROVED_ORDER_STATES.has(String(estado ?? "").trim().toLowerCase());
}

function readStoredApprovedCheckout(): CheckoutConfirmResponse | null {
  if (typeof window === "undefined") return null;
  const raw = window.sessionStorage.getItem(LAST_APPROVED_ORDER_STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as CheckoutConfirmResponse | null;
    if (!parsed || !Number.isInteger(Number(parsed.orden_id)) || Number(parsed.orden_id) <= 0 || !isApprovedOrderState(parsed.estado)) {
      window.sessionStorage.removeItem(LAST_APPROVED_ORDER_STORAGE_KEY);
      return null;
    }
    return parsed;
  } catch {
    window.sessionStorage.removeItem(LAST_APPROVED_ORDER_STORAGE_KEY);
    return null;
  }
}

function storeApprovedCheckout(checkout: CheckoutConfirmResponse | null) {
  if (typeof window === "undefined") return;
  if (!checkout || Number(checkout.orden_id) <= 0 || !isApprovedOrderState(checkout.estado)) {
    window.sessionStorage.removeItem(LAST_APPROVED_ORDER_STORAGE_KEY);
    return;
  }
  window.sessionStorage.setItem(LAST_APPROVED_ORDER_STORAGE_KEY, JSON.stringify(checkout));
}

function money(value: number | string | null | undefined): string {
  const n = Number(value ?? 0);
  return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" }).format(Number.isFinite(n) ? n : 0);
}

function cartPromoLabel(item: CartItem): string {
  return item.promo_eventbar_label || item.promo_eventbar_tipo?.toUpperCase() || "Promo";
}

function estadoPedidoLabel(estado: string): string {
  const normalized = estado.trim().toLowerCase();
  const labels: Record<string, string> = {
    borrador: "Pendiente de pago",
    pendiente_pago: "Pendiente de pago",
    pagada: "Pago aprobado",
    preparandose: "Preparando pedido",
    preparada: "Pedido preparado",
    enviada: "En camino",
    entregando: "Entregando pedido",
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
    if (value === "payment_method_not_allowed_types" || value === "payment_method_not_in_allowed_types") {
    return "Ese medio de pago no está habilitado para esta compra. Probá con otra tarjeta, una prepaga, débito, crédito o usá Abrir Mercado Pago.";
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
              creditCard: "all",
              debitCard: "all",
              prepaidCard: "all",
              mercadoPago: "wallet_purchase",
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
  const navigate = useNavigate();
  const { confirmToast, showToast } = useToast();
  const user = useAuthStore((state) => state.user);
  const [searchParams, setSearchParams] = useSearchParams();
  const hasProcessedReturnRef = useRef(false);
  const storedApprovedCheckoutRef = useRef<CheckoutConfirmResponse | null>(readStoredApprovedCheckout());
  const resumeOrderId = searchParams.get("pagar_orden");
  const sucursalId = usePickupStore((state) => state.sucursalRetiroId);
  const setSucursalId = usePickupStore((state) => state.setSucursalRetiroId);
  const [paymentId, setPaymentId] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [needsProfile, setNeedsProfile] = useState(false);
  const [confirmed, setConfirmed] = useState<CheckoutConfirmResponse | null>(storedApprovedCheckoutRef.current);
  const [paymentApproved, setPaymentApproved] = useState(() => isApprovedOrderState(storedApprovedCheckoutRef.current?.estado));
  const [paymentNotice, setPaymentNotice] = useState<PaymentNotice | null>(null);
  const [cartToast, setCartToast] = useState<CartToast | null>(null);
  const [pendingPaymentId, setPendingPaymentId] = useState("");
  const [deliveryMethod, setDeliveryMethod] = useState<"retiro" | "envio">("retiro");
  const [selectedAddressId, setSelectedAddressId] = useState<number | null>(null);
  const [selectedAddress, setSelectedAddress] = useState<UserAddress | null>(null);

  const hydrateConfirmedOrder = useCallback(async (ordenId: number) => {
    const orden = await api.get<CheckoutOrderDetail>(`/cliente/ordenes/${ordenId}`);
    const totalPuntosGanados = Number(orden.total_puntos_ganados ?? 0);
    const estadoNormalizado = orden.estado.trim().toLowerCase();
    const approvedState = isApprovedOrderState(estadoNormalizado);

    const nextConfirmed: CheckoutConfirmResponse = {
      orden_id: Number(orden.id),
      estado: orden.estado,
      total_dinero: Number(orden.total_dinero ?? 0),
      total_puntos_ganados: totalPuntosGanados,
      costo_envio: Number(orden.direccion_envio?.costo_envio ?? orden.direccion_envio?.envio?.costo_envio ?? 0),
      metodo_entrega: orden.direccion_envio ? "envio" : "retiro",
      envio: orden.direccion_envio?.envio ?? null,
      pago_pendiente: estadoNormalizado === "pendiente_pago" || estadoNormalizado === "borrador",
      pago: orden.pago
        ? {
            proveedor: orden.pago.proveedor,
            metodo: orden.pago.metodo,
            checkout_url: orden.pago.checkout_url ?? null,
            preference_id: null,
            public_key: null,
            qr_data: null,
            qr_image: null,
            expires_at: undefined,
            provider_payment_id: orden.pago.provider_payment_id ?? null,
            setup_status: null,
            setup_message: null,
          }
        : null,
    };
    setConfirmed(nextConfirmed);
    setPaymentApproved(approvedState);
    setMessage(null);
    setNeedsProfile(false);
    if (approvedState) {
      storeApprovedCheckout(nextConfirmed);
    }
  }, []);

  const cartQuery = useQuery({
    queryKey: ["cliente", "carrito-online"],
    queryFn: () => api.get<CartResponse>("/cliente/carrito"),
    staleTime: 0,
    refetchOnMount: "always",
    refetchInterval: 5000,
    refetchIntervalInBackground: true,
  });

  const sucursalesQuery = useQuery({
    queryKey: ["cliente", "sucursales-retiro"],
    queryFn: () => api.get<SucursalRetiro[]>("/cliente/sucursales"),
    refetchInterval: 15000,
    refetchIntervalInBackground: true,
  });

  const paymentOptionsQuery = useQuery({
    queryKey: ["cliente", "payment-options"],
    queryFn: () => api.get<PaymentOptionsResponse>("/cliente/checkout/payment-options"),
    refetchInterval: 15000,
    refetchIntervalInBackground: true,
  });

  const shippingQuoteQuery = useQuery({
    queryKey: ["cliente", "shipping-quote", selectedAddressId],
    queryFn: () => api.get<ShippingQuote>(`/cliente/checkout/shipping-quote?direccion_id=${selectedAddressId}`),
    enabled: deliveryMethod === "envio" && Boolean(selectedAddressId),
    retry: false,
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
  const noEnviables = useMemo(
    () => cartItems.filter((item) => !(item.permite_envio === true || Number(item.permite_envio ?? 0) === 1)),
    [cartItems],
  );
  const canUseShipping = noEnviables.length === 0;
  const hasFreeShippingByProducts = canUseShipping && cartItems.length > 0 && cartItems.every((item) => item.envio_gratis === true || Number(item.envio_gratis ?? 0) === 1);
  const total = cartItems.reduce((acc, item) => acc + Number(item.subtotal_dinero ?? 0), 0);
  const freeShippingMinimum = Number(cartQuery.data?.resumen.envio_gratis_monto_minimo ?? 0);
  const hasFreeShippingByAmount = canUseShipping && freeShippingMinimum > 0 && total >= freeShippingMinimum;
  const hasFreeShippingCart = hasFreeShippingByProducts || hasFreeShippingByAmount || Boolean(shippingQuoteQuery.data?.envio_gratis);
  const freeShippingRemaining = freeShippingMinimum > 0 ? Math.max(0, freeShippingMinimum - total) : 0;
  const shippingQuote = deliveryMethod === "envio" ? shippingQuoteQuery.data : null;
  const shippingCost = shippingQuote?.disponible ? (hasFreeShippingCart ? 0 : Number(shippingQuote.costo_envio ?? 0)) : 0;
  const totalConEnvio = Math.round((total + shippingCost + Number.EPSILON) * 100) / 100;
  const totalUnidades = cartItems.reduce((acc, item) => acc + Number(item.cantidad ?? 0), 0);
  const sucursales = sucursalesQuery.data ?? [];
  const sucursalSeleccionada =
    (sucursalId ? sucursales.find((s) => String(s.id) === sucursalId) : undefined) ||
    (sucursales.length === 1 ? sucursales[0] : undefined);
  const paymentOptions = paymentOptionsQuery.data?.options ?? [];
  const selectedPayment =
    paymentOptions.find((option) => option.id === (paymentId || paymentOptionsQuery.data?.default_option)) ??
    paymentOptions[0];
  const handleAddressChange = useCallback((addressId: number | null, address?: UserAddress | null) => {
    setSelectedAddressId(addressId);
    setSelectedAddress(address ?? null);
  }, []);
  const shouldPollMercadoPagoOrder = Boolean(
    confirmed?.orden_id &&
    confirmed.pago_pendiente &&
    !paymentApproved &&
    confirmed.pago?.proveedor === "mercadopago",
  );
  const isCashOrder = confirmed?.pago?.proveedor === "efectivo" || confirmed?.pago?.metodo === "cash";
  const hasRealOrder = Number(confirmed?.orden_id ?? 0) > 0;
  const isPendingCheckoutRef = Number(confirmed?.orden_id ?? 0) < 0;
  const confirmedEstado = confirmed?.estado.trim().toLowerCase() ?? "";
  const confirmedIsPaidState = isApprovedOrderState(confirmed?.estado);
  const confirmedPendingPayment = confirmedEstado === "pendiente_pago" || confirmedEstado === "borrador";
  const confirmedPaymentApproved = Boolean(confirmed && (paymentApproved || confirmedIsPaidState));
  const confirmedTitle =
    confirmedEstado === "cancelada"
      ? "Pedido cancelado"
      : confirmedEstado === "expirada"
        ? "Pedido expirado"
        : confirmedPaymentApproved
          ? "Pago aprobado"
          : isCashOrder
            ? "Pedido reservado"
            : "Pedido pendiente de pago";
  const confirmedHasShipping = Boolean(confirmed && (confirmed.metodo_entrega === "envio" || deliveryMethod === "envio" || confirmed.envio));
  const confirmedTrackingPath = confirmed && hasRealOrder ? `/mis-pedidos?pedido=${confirmed.orden_id}` : "/mis-pedidos";
  const currentPendingPaymentId = confirmed?.pago
    ? paymentOptions.find((option) => option.provider === confirmed.pago?.proveedor && option.method === confirmed.pago?.metodo)?.id ?? ""
    : "";
  const pendingPaymentOptions = useMemo(
    () => paymentOptions.filter((option) => option.enabled && !(confirmedHasShipping && option.provider === "efectivo")),
    [confirmedHasShipping, paymentOptions],
  );
  const selectedPendingPayment =
    pendingPaymentOptions.find((option) => option.id === (pendingPaymentId || currentPendingPaymentId)) ??
    pendingPaymentOptions[0];
  const canChangePendingPayment = Boolean(
    confirmed?.orden_id &&
    confirmedPendingPayment &&
    selectedPendingPayment &&
    selectedPendingPayment.id !== currentPendingPaymentId,
  );

  const confirmedOrderQuery = useQuery({
    queryKey: ["cliente", "orden-payment-status", confirmed?.orden_id],
    queryFn: () => api.get<OrdenCheckoutStatus>(`/cliente/checkout/ordenes/${confirmed?.orden_id}/payment-status`),
    enabled: shouldPollMercadoPagoOrder,
    refetchInterval: (query) => {
      if (!shouldPollMercadoPagoOrder || !confirmed?.orden_id) return false;
      const currentOrder = query.state.data;
      return !currentOrder || currentOrder.estado === "pendiente_pago" || currentOrder.estado === "borrador" ? 5000 : false;
    },
    refetchIntervalInBackground: true,
  });

  const confirmReturnMutation = useMutation({
    mutationFn: (payload: { payment_id?: string | null; external_reference?: string | null; status?: string | null }) =>
      api.post<MercadoPagoReturnResponse>("/cliente/checkout/mercadopago/confirm-return", payload),
    onSuccess: async (response) => {
      if (Number(response.orden_id) > 0) {
        await hydrateConfirmedOrder(response.orden_id);
        await queryClient.invalidateQueries({ queryKey: ["cliente", "carrito-online"] });
        await queryClient.invalidateQueries({ queryKey: ["cliente", "ordenes"] });
        await queryClient.invalidateQueries({ queryKey: ["cliente", "perfil"] });
        return;
      }

      setConfirmed((prev) =>
        prev
          ? {
              ...prev,
              orden_id: response.orden_id,
              estado: response.estado,
              pago_pendiente: response.estado === "pendiente_pago",
            }
          : prev,
      );
    },
    onError: (error: Error) => {
      setMessage(error.message || "No pudimos recuperar el estado del pago.");
    },
  });

  useEffect(() => {
    if (!resumeOrderId) return;
    if (resumePaymentQuery.data) {
      setConfirmed(resumePaymentQuery.data);
      setPaymentApproved(isApprovedOrderState(resumePaymentQuery.data.estado));
      if (isApprovedOrderState(resumePaymentQuery.data.estado)) {
        storeApprovedCheckout(resumePaymentQuery.data);
      }
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
    if (confirmed || resumeOrderId || confirmReturnMutation.isPending) return;
    const storedApprovedCheckout = readStoredApprovedCheckout();
    if (!storedApprovedCheckout) return;

    setConfirmed(storedApprovedCheckout);
    setPaymentApproved(true);
    void hydrateConfirmedOrder(storedApprovedCheckout.orden_id).catch(() => {
      storeApprovedCheckout(storedApprovedCheckout);
    });
  }, [confirmReturnMutation.isPending, confirmed, hydrateConfirmedOrder, resumeOrderId]);

  useEffect(() => {
    const paymentId = searchParams.get("payment_id") || searchParams.get("collection_id");
    const externalReference = searchParams.get("external_reference");
    const status = searchParams.get("status") || searchParams.get("collection_status");

    if (hasProcessedReturnRef.current) return;
    if (!paymentId && !externalReference) return;

    hasProcessedReturnRef.current = true;
    confirmReturnMutation.mutate(
      {
        payment_id: paymentId,
        external_reference: externalReference,
        status,
      },
      {
        onSettled: () => {
          const nextParams = new URLSearchParams(searchParams);
          [
            "payment_id",
            "collection_id",
            "collection_status",
            "status",
            "external_reference",
            "merchant_order_id",
            "preference_id",
            "mp_return",
          ].forEach((key) => nextParams.delete(key));
          setSearchParams(nextParams, { replace: true });
        },
      },
    );
  }, [confirmReturnMutation, searchParams, setSearchParams]);

  useEffect(() => {
    if (currentPendingPaymentId) {
      setPendingPaymentId(currentPendingPaymentId);
    }
  }, [currentPendingPaymentId]);

  useEffect(() => {
    if (!sucursales.length) return;
    if (!sucursalId || !sucursales.some((sucursal) => String(sucursal.id) === sucursalId)) {
      setSucursalId(String(sucursales[0].id));
    }
  }, [sucursalId, sucursales]);

  useEffect(() => {
    if (deliveryMethod === "envio" && !canUseShipping) {
      setDeliveryMethod("retiro");
    }
  }, [canUseShipping, deliveryMethod]);

  useEffect(() => {
    if (deliveryMethod !== "envio" || selectedPayment?.provider !== "efectivo") return;
    const nextPayment = paymentOptions.find((option) => option.enabled && option.provider !== "efectivo");
    if (nextPayment) setPaymentId(nextPayment.id);
  }, [deliveryMethod, paymentOptions, selectedPayment?.provider]);

  useEffect(() => {
    if (!confirmed?.orden_id || !confirmedOrderQuery.data) return;
    const currentOrder = confirmedOrderQuery.data;
    const nextState = currentOrder?.estado?.trim().toLowerCase();
    if (!nextState || nextState === "pendiente_pago" || nextState === "borrador") return;

    if (isApprovedOrderState(nextState)) {
      if (!paymentApproved || !confirmedIsPaidState) {
        setPaymentApproved(true);
        const pts = Number(currentOrder.total_puntos_ganados ?? 0);
        setPaymentNotice({
          variant: "success",
          msg: pts > 0
            ? `Pago aprobado. Se acreditaron ${pts} puntos en tu cuenta.`
            : "Pago aprobado. Ya registramos tu pedido y el equipo va a prepararlo.",
        });
        setConfirmed((prev) => {
          const nextConfirmed =
            prev && Number(prev.orden_id) === Number(confirmed.orden_id)
              ? {
                  ...prev,
                  orden_id: Number(currentOrder.orden_id ?? prev.orden_id),
                  estado: currentOrder.estado || prev.estado,
                  pago_pendiente: false,
                  total_puntos_ganados: pts,
                }
              : prev;
          storeApprovedCheckout(nextConfirmed);
          return nextConfirmed;
        });
        void queryClient.invalidateQueries({ queryKey: ["cliente", "carrito-online"] });
        void queryClient.invalidateQueries({ queryKey: ["cliente", "ordenes"] });
        void queryClient.invalidateQueries({ queryKey: ["cliente", "perfil"] });
      }
      return;
    }

    if (nextState === "cancelada" || nextState === "expirada") {
      storeApprovedCheckout(null);
      setPaymentNotice({
        variant: "error",
        msg: nextState === "expirada"
          ? "El pago expiro en Mercado Pago. Puedes generar una compra nueva cuando quieras."
          : "Mercado Pago rechazo o cancelo el pago.",
      });
      setConfirmed((prev) =>
        prev && Number(prev.orden_id) === Number(confirmed.orden_id)
          ? { ...prev, orden_id: Number(currentOrder.orden_id ?? prev.orden_id), estado: nextState, pago_pendiente: false }
          : prev,
      );
    }
  }, [
    confirmed?.estado,
    confirmed?.orden_id,
    confirmedIsPaidState,
    confirmedOrderQuery.data,
    paymentApproved,
    queryClient,
  ]);

  useEffect(() => {
    if (!cartToast) return;
    const timer = window.setTimeout(() => setCartToast(null), 2600);
    return () => window.clearTimeout(timer);
  }, [cartToast]);

  useEffect(() => {
    if (!confirmed?.orden_id || !confirmedHasShipping || !confirmedPaymentApproved) return;

    const storageKey = `nande-shipping-tracking-toast-${confirmed.orden_id}`;
    if (window.sessionStorage.getItem(storageKey) === "shown") return;
    window.sessionStorage.setItem(storageKey, "shown");

    showToast({
      tone: "success",
      variant: "order-sales",
      icon: <span className="order-sales-toast-icon-mark">OK</span>,
      title: "Seguimiento de envio activo",
      message: (
        <div className="checkout-tracking-toast-copy">
          <p>Tu compra ya fue aprobada. Podes ver como avanza el envio desde Mis pedidos.</p>
        </div>
      ),
      actionLabel: "Ir a Mis pedidos",
      onAction: () => navigate(confirmedTrackingPath),
      secondaryActionLabel: "Cerrar",
      onSecondaryAction: () => undefined,
      duration: 15000,
    });
  }, [
    confirmed?.orden_id,
    confirmedHasShipping,
    confirmedPaymentApproved,
    confirmedTrackingPath,
    navigate,
    showToast,
  ]);

  const updateQuantity = useMutation({
    mutationFn: ({ itemId, cantidad }: { itemId: number; cantidad: number }) =>
      api.patch<{ ok: true }>(`/cliente/carrito/items/${itemId}`, {
        cantidad,
        sucursal_id: sucursalSeleccionada?.id ?? null,
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["cliente", "carrito-online"] }),
    onError: (error: Error) => {
      setMessage(error.message || "No se pudo actualizar la cantidad.");
    },
  });

  const deleteItem = useMutation({
    mutationFn: (itemId: number) => api.delete<{ ok: true }>(`/cliente/carrito/items/${itemId}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["cliente", "carrito-online"] }),
  });
  
  const clearCart = useMutation({
    mutationFn: () => api.delete<{ ok: true }>("/cliente/carrito/vaciar"),
    onSuccess: async () => {
      setMessage(null);
      setCartToast({ variant: "success", msg: "Carrito vaciado." });
      await queryClient.invalidateQueries({ queryKey: ["cliente", "carrito-online"] });
    },
    onError: (error: Error) => {
      const msg = error.message || "No se pudo vaciar el carrito.";
      setMessage(msg);
      setCartToast({ variant: "error", msg });
    },
  });

  const confirmCheckout = useMutation({
    mutationFn: () =>
      api.post<CheckoutConfirmResponse>("/cliente/checkout/confirm", {
        sucursal_id: sucursalSeleccionada?.id,
        metodo_entrega: deliveryMethod,
        direccion_id: deliveryMethod === "envio" ? selectedAddressId : null,
        direccion_envio: null,
        pago: selectedPayment ? { provider: selectedPayment.provider, method: selectedPayment.method } : undefined,
      }),
    onSuccess: async (data) => {
      setConfirmed(data);
      setPaymentApproved(isApprovedOrderState(data.estado));
      if (isApprovedOrderState(data.estado)) {
        storeApprovedCheckout(data);
      }
      if (isApprovedOrderState(data.estado)) {
        const pts = Number(data.total_puntos_ganados ?? 0);
        setPaymentNotice({
          variant: "success",
          msg: pts > 0
            ? `Pago aprobado. Se acreditaron ${pts} puntos en tu cuenta.`
            : "Pago aprobado. Ya registramos tu pedido y el equipo va a prepararlo.",
        });
        void queryClient.invalidateQueries({ queryKey: ["cliente", "perfil"] });
      } else {
        setPaymentNotice(null);
      }
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

  const changePaymentMethod = useMutation({
    mutationFn: (option: PaymentOption) => {
      if (!confirmed?.orden_id) throw new Error("No hay una orden pendiente para actualizar.");
      return api.post<CheckoutConfirmResponse>(`/cliente/checkout/ordenes/${confirmed.orden_id}/change-payment-method`, {
        pago: { provider: option.provider, method: option.method },
      });
    },
    onSuccess: async (data) => {
      setConfirmed(data);
      setPaymentApproved(isApprovedOrderState(data.estado));
      setPaymentNotice({
        variant: "info",
        msg: data.pago?.metodo === "qr"
          ? "Listo, generamos un QR nuevo para este pedido."
          : data.pago?.metodo === "wallet"
            ? "Listo, ahora podes pagar esta compra desde Mercado Pago app."
            : "Listo, actualizamos el medio de pago de este pedido.",
      });
      setMessage(null);
      await queryClient.invalidateQueries({ queryKey: ["cliente", "orden-payment-status", data.orden_id] });
      await queryClient.invalidateQueries({ queryKey: ["cliente", "ordenes"] });
    },
    onError: (error: Error) => {
      setPaymentNotice({ variant: "error", msg: error.message || "No se pudo cambiar el medio de pago." });
    },
  });

  const cancelConfirmedOrder = useMutation({
    mutationFn: (ordenId: number) =>
      api.post<{ ok: true; orden_id: number; estado: string }>(
        ordenId < 0 ? `/cliente/checkout/ordenes/${ordenId}/cancelar` : `/cliente/ordenes/${ordenId}/cancelar`,
        {},
      ),
    onSuccess: async (data) => {
      setConfirmed((prev) =>
        prev && Number(prev.orden_id) === Number(data.orden_id)
          ? { ...prev, estado: "cancelada", pago_pendiente: false }
          : prev,
      );
      setPaymentApproved(false);
      setPaymentNotice({
        variant: "info",
        msg: `Pedido #${data.orden_id} cancelado. Por cualquier consulta comuniquese a traves de la mensajeria. Vuelva pronto.`,
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["cliente", "ordenes"] }),
        queryClient.invalidateQueries({ queryKey: ["cliente", "orden-payment-status", data.orden_id] }),
        queryClient.invalidateQueries({ queryKey: ["productos"] }),
      ]);
    },
    onError: (error: Error) => {
      setPaymentNotice({ variant: "error", msg: error.message || "No se pudo cancelar el pedido." });
    },
  });

  function confirmar() {
    if (!cartItems.length) {
      setMessage("Tu carrito esta vacio.");
      return;
    }
    if (sucursales.length > 1 && !sucursalSeleccionada) {
      setMessage(deliveryMethod === "envio" ? "Selecciona una sucursal para preparar el pedido." : "Selecciona una sucursal para reservar stock.");
      return;
    }
    if (deliveryMethod === "envio") {
      if (!canUseShipping) {
        setMessage(`Hay productos que no permiten envio: ${noEnviables.map((item) => item.nombre).join(", ")}.`);
        return;
      }
      if (!selectedAddressId) {
        setMessage("Selecciona una direccion de envio.");
        return;
      }
      if (shippingQuoteQuery.isFetching) {
        setMessage("Esperando la cotizacion de envio.");
        return;
      }
      if (shippingQuoteQuery.error instanceof Error) {
        setMessage(shippingQuoteQuery.error.message);
        return;
      }
      if (!shippingQuote?.disponible) {
        setMessage(shippingQuote?.error || "La direccion seleccionada no esta dentro de una zona de envio activa.");
        return;
      }
      if (selectedPayment?.provider === "efectivo") {
        setMessage("El pago en efectivo solo esta disponible para retiro en sucursal.");
        return;
      }
    }
    if (deliveryMethod === "retiro" && selectedPayment?.provider === "efectivo" && !sucursalSeleccionada) {
      setMessage("Selecciona una sucursal para pagar al retirar.");
      return;
    }
    setMessage(null);
    setNeedsProfile(false);
    confirmCheckout.mutate();
  }

  if (confirmed) {
    const estadoLabel = estadoPedidoLabel(confirmed.estado);
    const isShippingConfirmed = deliveryMethod === "envio" || Boolean(confirmed.envio);
    const confirmedReferenceLabel = hasRealOrder
      ? `Orden #${confirmed.orden_id}`
      : `Referencia de pago #${Math.abs(Number(confirmed.orden_id ?? 0))}`;
    if (confirmedPaymentApproved) {
      return (
        <section className="catalog-page catalog-canje-page">
          <div className="catalog-products-shell">
            <div className="catalog-header">
              <h1 className="catalog-title">Pago aprobado</h1>
              <p className="catalog-subtitle">{confirmedReferenceLabel} - {money(confirmed.total_dinero)}</p>
            </div>

            <div className="checkout-approved-card" role="status" aria-live="polite">
              <img
                src="/nande_muchas_gracias.webp"
                alt="Pedido pagado con exito"
                className="store-order-thanks-image"
                loading="lazy"
                decoding="async"
              />
              <p className="checkout-approved-title">Muchas gracias por tu compra</p>
              <p className="checkout-approved-text">
                Pago aprobado. Ya registramos tu pedido y el equipo va a prepararlo.
              </p>
              {(confirmed.total_puntos_ganados ?? 0) > 0 ? (
                <p className="checkout-approved-text" style={{ color: "#8B5A30", fontWeight: 700, marginTop: "0.5rem" }}>
                  Se acreditaron {confirmed.total_puntos_ganados} puntos en tu cuenta.
                </p>
              ) : null}
            </div>

            <div className="catalog-confirm-branch-detail catalog-canje-block">
              <p><strong>Estado:</strong> {estadoLabel}</p>
              {isShippingConfirmed ? (
                <p className="catalog-confirm-hint">
                  El seguimiento queda activo hasta que el pedido sea marcado como entregado.
                </p>
              ) : null}
              <div className="catalog-float-toast-actions catalog-canje-actions">
                <Link to={isShippingConfirmed ? confirmedTrackingPath : "/mis-pedidos"} className="catalog-float-toast-btn-primary">{isShippingConfirmed ? "Ver seguimiento" : "Ver mis pedidos"}</Link>
                <Link to="/tienda" className="catalog-float-toast-btn-secondary">Volver a tienda</Link>
              </div>
            </div>
          </div>
        </section>
      );
    }

    return (
      <section className="catalog-page catalog-canje-page">
        <div className="catalog-products-shell">
          <div className="catalog-header">
            <h1 className="catalog-title">{confirmedTitle}</h1>
            <p className="catalog-subtitle">{confirmedReferenceLabel} - {money(confirmed.total_dinero)}</p>
          </div>
          {paymentNotice ? (
            <div className="catalog-canje-block" role="status" aria-live="polite">
              <p>{paymentNotice.msg}</p>
              <div className="catalog-float-toast-actions catalog-canje-actions">
                {paymentNotice.variant === "success" && hasRealOrder ? (
                  <Link to={isShippingConfirmed ? confirmedTrackingPath : "/mis-pedidos"} className="catalog-float-toast-btn-primary">
                    {isShippingConfirmed ? "Ver seguimiento" : "Ver mis pedidos"}
                  </Link>
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
                loading="lazy"
                decoding="async"
              />
              <p className="checkout-approved-title">Muchas gracias por tu compra</p>
              <p className="checkout-approved-text">
                Pago aprobado. Ya registramos tu pedido y el equipo va a prepararlo.
              </p>
              {(confirmed.total_puntos_ganados ?? 0) > 0 ? (
                <p className="checkout-approved-text" style={{ color: "#8B5A30", fontWeight: 700, marginTop: "0.5rem" }}>
                  Se acreditaron {confirmed.total_puntos_ganados} puntos en tu cuenta.
                </p>
              ) : null}
            </div>
          ) : isCashOrder ? (
            <div className="catalog-canje-block" role="status" aria-live="polite">
              <p><strong>Reservamos tu pedido.</strong> Lo pagas en efectivo al retirar en sucursal.</p>
              {(confirmed.total_puntos_ganados ?? 0) > 0 ? (
                <p style={{ marginTop: "0.4rem", color: "#8B5A30", fontWeight: 600 }}>
                  Cuando el pedido sea marcado como pagado, se acreditarán {confirmed.total_puntos_ganados} puntos en tu cuenta.
                </p>
              ) : null}
            </div>
          ) : (
            <div className="catalog-canje-block" role="status" aria-live="polite">
              <p><strong>Tu pedido todavia no esta confirmado.</strong> Se confirma automaticamente cuando Mercado Pago aprueba el pago.</p>
              {(confirmed.total_puntos_ganados ?? 0) > 0 ? (
                <p style={{ marginTop: "0.4rem", color: "#8B5A30", fontWeight: 600 }}>
                  Con esta compra ganás {confirmed.total_puntos_ganados} puntos cuando el pago sea aprobado.
                </p>
              ) : null}
            </div>
          )}
          <div className="catalog-confirm-branch-detail catalog-canje-block">
            <p><strong>Estado:</strong> {estadoLabel}</p>
            {isShippingConfirmed ? (
              <p className="catalog-confirm-hint">
                Cuando se confirme el pago, vas a poder seguir el envio desde Mis pedidos hasta que sea entregado.
              </p>
            ) : null}
            {shouldPollMercadoPagoOrder ? (
              <p className="catalog-confirm-hint">
                Si Mercado Pago abre la app, termina el pago ahi. Cuando llegue la confirmacion, esta pantalla se actualiza sola.
              </p>
            ) : null}
            {confirmedPendingPayment && pendingPaymentOptions.length > 1 ? (
              <div className="checkout-payment-switcher">
                <label className="catalog-confirm-label" htmlFor="checkout-pending-payment-method">
                  Cambiar medio de pago
                </label>
                <div className="checkout-payment-switcher-row">
                  <select
                    id="checkout-pending-payment-method"
                    className="catalog-pickup-select"
                    value={selectedPendingPayment?.id ?? ""}
                    onChange={(event) => setPendingPaymentId(event.target.value)}
                  >
                    {pendingPaymentOptions.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="catalog-float-toast-btn-secondary"
                    disabled={!selectedPendingPayment || !canChangePendingPayment || changePaymentMethod.isPending}
                    onClick={() => selectedPendingPayment && changePaymentMethod.mutate(selectedPendingPayment)}
                  >
                    {changePaymentMethod.isPending ? "Cambiando..." : "Cambiar"}
                  </button>
                </div>
                <p className="catalog-confirm-hint">
                  {isShippingConfirmed
                    ? "Para envios podes cambiar entre medios online. Efectivo no esta disponible para envio."
                    : "Podes cambiar el medio mientras la orden siga pendiente de pago."}
                </p>
              </div>
            ) : null}
            {confirmedPendingPayment && confirmed.pago?.metodo === "wallet" && confirmed.pago.checkout_url ? (
              <a className="product-card-btn product-card-btn-canjear" href={confirmed.pago.checkout_url} rel="noreferrer">
                Abrir Mercado Pago
              </a>
            ) : confirmedPendingPayment && confirmed.pago?.metodo === "qr" && confirmed.pago.qr_image ? (
              <div className="store-qr-payment-card">
                <p className="store-qr-payment-title">Escanea este QR con Mercado Pago</p>
                <img src={confirmed.pago.qr_image} alt={`QR de pago para la referencia ${Math.abs(Number(confirmed.orden_id))}`} />
                <p className="catalog-confirm-hint">
                  Cuando Mercado Pago apruebe el pago, el pedido se confirma automaticamente.
                  {confirmed.pago.expires_at ? " Si vence, genera una compra nueva." : ""}
                </p>
              </div>
            ) : confirmed.pago?.setup_message ? (
              <p>{confirmed.pago.setup_message}</p>
            ) : null}
            <div className="catalog-float-toast-actions catalog-canje-actions">
              {hasRealOrder ? (
                <Link to={isShippingConfirmed ? confirmedTrackingPath : "/mis-pedidos"} className="catalog-float-toast-btn-primary">
                  {isShippingConfirmed && confirmedPaymentApproved ? "Ver seguimiento" : "Ver en Mis pedidos"}
                </Link>
              ) : null}
              {confirmedPendingPayment ? (
                <button
                  type="button"
                  className="store-order-cancel-btn"
                  disabled={cancelConfirmedOrder.isPending}
                  onClick={() =>
                    confirmToast({
                      tone: "danger",
                      title: "Cancelar compra",
                      message: `Se va a cancelar el pedido #${confirmed.orden_id}. Esta accion libera la reserva y no se puede deshacer.`,
                      confirmLabel: cancelConfirmedOrder.isPending ? "Cancelando..." : "Cancelar compra",
                      cancelLabel: "Mantener pedido",
                      onConfirm: () => cancelConfirmedOrder.mutate(confirmed.orden_id),
                    })
                  }
                >
                  Cancelar compra
                </button>
              ) : null}
              <Link to="/tienda" className="catalog-float-toast-btn-secondary">Volver a tienda</Link>
            </div>
          </div>
          {confirmedPendingPayment && confirmed.pago?.metodo === "brick" && confirmed.pago.public_key && confirmed.pago.preference_id ? (
            <MercadoPagoBrick
              confirmed={confirmed}
              buyerEmail={user?.email ?? ""}
              onPaid={(response) =>
                setConfirmed((prev) => {
                  const nextConfirmed = prev
                    ? {
                        ...prev,
                        orden_id: response.orden_id,
                        estado: response.estado,
                        pago_pendiente: !isApprovedOrderState(response.estado),
                      }
                    : prev;
                  if (nextConfirmed && isApprovedOrderState(response.estado) && response.orden_id > 0) {
                    storeApprovedCheckout(nextConfirmed);
                  }
                  return nextConfirmed;
                })
              }
              onApproved={() => {
                setPaymentApproved(true);
                storeApprovedCheckout({
                  ...confirmed,
                  estado: "pagada",
                  pago_pendiente: false,
                });
                const pts = Number(confirmed.total_puntos_ganados ?? 0);
                setPaymentNotice({
                  variant: "success",
                  msg: pts > 0
                    ? `Pago aprobado. Se acreditaron ${pts} puntos en tu cuenta.`
                    : "Pago aprobado. Ya registramos tu pedido y el equipo va a prepararlo.",
                });
                void queryClient.invalidateQueries({ queryKey: ["cliente", "perfil"] });
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
          <div className="catalog-canje-block store-cart-empty-state">
            <p className="store-cart-empty-title">Tu carrito esta vacio.</p>
            <p className="store-cart-empty-copy">
              Cuando agregues productos, aqui vas a poder revisar la compra, elegir la entrega y confirmar el pago.
            </p>
            <div className="store-cart-empty-divider" aria-hidden="true" />
            <Link className="product-card-btn product-card-btn-canjear" to="/tienda">Ir a tienda</Link>
          </div>
        ) : (
          <>
            <div className="catalog-confirm-branch-detail catalog-canje-block catalog-canje-list">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem", paddingBottom: "0.5rem", borderBottom: "1px solid #f0dfca" }}>
                <h2 style={{ fontSize: "1.1rem", color: "#4A2C1A", margin: 0 }}>Tus productos</h2>
                <button 
                  className="adm-btn-danger" 
                  style={{
                    padding: "0.55rem 0.95rem",
                    fontSize: "0.82rem",
                    borderRadius: "999px",
                    boxShadow: "0 8px 18px rgba(155, 44, 44, 0.14)",
                  }}
                  disabled={clearCart.isPending || cartItems.length === 0}
                  onClick={() =>
                    confirmToast({
                      tone: "danger",
                      title: "Vaciar carrito",
                      message: "Se van a quitar todos los productos de tu carrito. Esta accion no se puede deshacer.",
                      confirmLabel: "Vaciar",
                      cancelLabel: "Conservar",
                      onConfirm: () => clearCart.mutate(),
                    })
                  }
                >
                  {clearCart.isPending ? "Vaciando..." : "Vaciar carrito"}
                </button>
              </div>
              {cartItems.map((item) => {
                const promoAplicada = Boolean(item.promo_eventbar_aplicada);
                const promoActiva = Boolean(item.promo_eventbar_activa && item.promo_eventbar_tipo);
                const promoLabel = cartPromoLabel(item);
                const promoRequired = Number(item.promo_eventbar_cantidad_requerida ?? 0);
                const promoPaid = Number(item.promo_eventbar_cantidad_paga ?? 0);
                return (
                <div key={item.id} className="catalog-canje-item">
                  <div>
                    <p style={{ margin: 0, fontWeight: 800 }}>{item.nombre}</p>
                    {item.sabores?.length ? (
                      <p style={{ margin: "0.1rem 0 0", color: "#6f4a2a", fontSize: "0.86rem" }}>
                        {item.sabores.map((sabor) => `${sabor.nombre} x${sabor.cantidad}`).join(" | ")}
                      </p>
                    ) : null}
                    {promoAplicada ? (
                      <>
                        <p style={{ margin: "0.18rem 0 0", color: "#7A3D1C", fontSize: "0.88rem", fontWeight: 850 }}>
                          Promo {promoLabel} aplicada: pagas {money(item.subtotal_dinero)}
                          {Number(item.promo_eventbar_subtotal_regular ?? 0) > Number(item.subtotal_dinero ?? 0)
                            ? ` en lugar de ${money(item.promo_eventbar_subtotal_regular)}`
                            : ""}
                        </p>
                        <p style={{ margin: "0.1rem 0 0", color: "#8B5A30", fontSize: "0.84rem" }}>
                          Precio promo aprox: {money(item.promo_eventbar_precio_unitario_efectivo)} c/u
                          {Number(item.promo_eventbar_ahorro ?? 0) > 0 ? ` - Ahorras ${money(item.promo_eventbar_ahorro)}` : ""}
                        </p>
                      </>
                    ) : (
                      <p style={{ margin: "0.1rem 0 0", color: "#8B5A30" }}>
                        {promoActiva && promoRequired > 0 && promoPaid > 0
                          ? `Promo ${promoLabel}: llevando ${promoRequired}, pagas ${promoPaid}. Subtotal actual: ${money(item.subtotal_dinero)}`
                          : money(item.subtotal_dinero)}
                      </p>
                    )}
                    {item.envio_gratis === true || Number(item.envio_gratis ?? 0) === 1 ? (
                      <p style={{ margin: "0.1rem 0 0", color: "#16633D", fontSize: "0.82rem", fontWeight: 800 }}>Envio gratis</p>
                    ) : null}
                  </div>
                  {item.sabores?.length ? (
                    <div className="catalog-canje-item-qty">
                      <span>{item.cantidad}</span>
                      <button
                        type="button"
                        disabled={deleteItem.isPending}
                        onClick={() => deleteItem.mutate(item.id)}
                      >
                        Quitar
                      </button>
                    </div>
                  ) : (
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
                  )}
                </div>
                );
              })}
            </div>

            <div className="catalog-confirm-branch-detail catalog-canje-block catalog-canje-summary">
              <p>Total de productos: <strong>{totalUnidades}</strong></p>
              <p>Subtotal: <strong>{money(total)}</strong></p>
              {deliveryMethod === "envio" ? (
                <>
                  <p>
                    Envio:{" "}
                    <strong>
                      {shippingQuoteQuery.isFetching
                        ? "Cotizando..."
                        : shippingQuote?.disponible
                          ? hasFreeShippingCart
                            ? "Gratis"
                            : money(shippingCost)
                          : "-"}
                    </strong>
                  </p>
                  {shippingQuote?.zona ? (
                    <p className="catalog-confirm-hint">Zona: {shippingQuote.zona.nombre}</p>
                  ) : shippingQuoteQuery.error instanceof Error ? (
                    <p className="catalog-confirm-hint" style={{ color: "#9B2C2C" }}>{shippingQuoteQuery.error.message}</p>
                  ) : shippingQuote?.error ? (
                    <p className="catalog-confirm-hint" style={{ color: "#9B2C2C" }}>{shippingQuote.error}</p>
                  ) : selectedAddressId ? null : (
                    <p className="catalog-confirm-hint">Selecciona una direccion para cotizar el envio.</p>
                  )}
                  {freeShippingMinimum > 0 && canUseShipping && !hasFreeShippingByProducts ? (
                    hasFreeShippingByAmount ? (
                      <p className="catalog-confirm-hint">Envio gratis aplicado por superar {money(freeShippingMinimum)} en productos.</p>
                    ) : (
                      <p className="catalog-confirm-hint">Te faltan {money(freeShippingRemaining)} para envio gratis.</p>
                    )
                  ) : null}
                </>
              ) : null}
              <p>Total a pagar: <strong>{money(totalConEnvio)}</strong></p>
              {(cartQuery.data?.resumen.total_puntos_ganados ?? 0) > 0 ? (
                <p style={{ color: "#8B5A30", fontWeight: 700, marginTop: "0.2rem" }}>
                  Con esta compra ganás {cartQuery.data?.resumen.total_puntos_ganados} puntos cuando el pago sea aprobado.
                </p>
              ) : null}
            </div>

            <div className="catalog-confirm-field catalog-canje-pickup">
              <label className="catalog-confirm-label">Forma de entrega</label>
              <div className="checkout-delivery-segment" role="group" aria-label="Forma de entrega">
                <button
                  type="button"
                  className={deliveryMethod === "retiro" ? "active" : ""}
                  onClick={() => setDeliveryMethod("retiro")}
                  disabled={confirmCheckout.isPending}
                >
                  Retiro
                </button>
                <button
                  type="button"
                  className={deliveryMethod === "envio" ? "active" : ""}
                  onClick={() => setDeliveryMethod("envio")}
                  disabled={confirmCheckout.isPending || !canUseShipping}
                >
                  Envio
                </button>
              </div>
              {!canUseShipping ? (
                <p className="catalog-confirm-hint">
                  Hay productos que no permiten envio: {noEnviables.map((item) => item.nombre).join(", ")}.
                </p>
              ) : null}
            </div>

            <div className="catalog-confirm-field catalog-canje-pickup">
              <label className="catalog-confirm-label" htmlFor="carrito-tienda-sucursal">
                {deliveryMethod === "envio" ? "Sucursal de preparacion" : "Sucursal de retiro"}
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

            {deliveryMethod === "envio" ? (
              <div className="catalog-confirm-field catalog-canje-pickup">
                <label className="catalog-confirm-label">Direccion de envio</label>
                <AddressSelector
                  selectedId={selectedAddressId}
                  onChange={handleAddressChange}
                  disabled={confirmCheckout.isPending}
                />
                {selectedAddress ? (
                  <p className="catalog-confirm-hint">
                    Se guardara una copia de esta direccion en el pedido.
                  </p>
                ) : null}
                {selectedAddress && shippingQuoteQuery.isFetching ? (
                  <p className="catalog-confirm-hint">Cotizando envio...</p>
                ) : null}
                {selectedAddress && shippingQuote?.disponible ? (
                  <p className="catalog-confirm-hint">
                    Envio {hasFreeShippingCart ? "gratis" : money(shippingCost)} - {shippingQuote.zona?.nombre}
                  </p>
                ) : null}
                {selectedAddress && shippingQuoteQuery.error instanceof Error ? (
                  <p className="catalog-confirm-hint" style={{ color: "#9B2C2C" }}>{shippingQuoteQuery.error.message}</p>
                ) : null}
                {selectedAddress && shippingQuote?.error ? (
                  <p className="catalog-confirm-hint" style={{ color: "#9B2C2C" }}>{shippingQuote.error}</p>
                ) : null}
              </div>
            ) : null}

            {paymentOptions.length ? (
              <div className="catalog-confirm-field catalog-canje-pickup">
                <label className="catalog-confirm-label" htmlFor="carrito-tienda-pago">Medio de pago</label>
                <select
                  id="carrito-tienda-pago"
                  className="catalog-pickup-select"
                  value={selectedPayment?.id || ""}
                  onChange={(event) => setPaymentId(event.target.value)}
                >
                  {paymentOptions.map((option) => (
                    <option key={option.id} value={option.id} disabled={!option.enabled || (deliveryMethod === "envio" && option.provider === "efectivo")}>
                      {option.label}{option.enabled && !(deliveryMethod === "envio" && option.provider === "efectivo") ? "" : " (no disponible)"}
                    </option>
                  ))}
                </select>
                {selectedPayment?.description ? (
                  <p className="catalog-confirm-hint">{selectedPayment.description}</p>
                ) : null}
                {selectedPayment?.provider === "efectivo" ? (
                  <p className="catalog-confirm-hint">Se reserva el pedido para retiro. El equipo no lo toma como pago aprobado hasta cobrarlo en sucursal.</p>
                ) : selectedPayment?.method === "brick" ? (
                  <p className="catalog-confirm-hint">Esta opcion deja el pago con tarjeta dentro del sitio. Si prefieres usar tu cuenta o la app, elige "Mercado Pago app".</p>
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
              <button
                className="catalog-float-toast-btn-primary"
                onClick={confirmar}
                disabled={
                  confirmCheckout.isPending ||
                  (deliveryMethod === "envio" && (!selectedAddressId || shippingQuoteQuery.isFetching || Boolean(shippingQuoteQuery.error) || !shippingQuote?.disponible))
                }
              >
                {confirmCheckout.isPending ? "Confirmando..." : "Confirmar compra"}
              </button>
              <Link className="catalog-float-toast-btn-secondary" to="/tienda">Seguir comprando</Link>
            </div>
          </>
        )}
      </div>
      {cartToast ? (
        <div className={`catalog-float-toast catalog-float-toast-${cartToast.variant}`}>
          <p className="catalog-float-toast-msg">{cartToast.msg}</p>
        </div>
      ) : null}
    </section>
  );
}
