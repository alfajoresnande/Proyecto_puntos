import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
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
  provider: "mercadopago" | "pagos360";
  method: "wallet" | "qr" | "credit_card" | "debit_card";
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
    checkout_url: string | null;
    setup_status: "ready" | "requires_configuration" | null;
    setup_message: string | null;
  };
};

function money(value: number | string | null | undefined): string {
  const n = Number(value ?? 0);
  return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" }).format(Number.isFinite(n) ? n : 0);
}

export function CarritoTienda() {
  const queryClient = useQueryClient();
  const user = useAuthStore((state) => state.user);
  const [sucursalId, setSucursalId] = useState("");
  const [paymentId, setPaymentId] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [needsProfile, setNeedsProfile] = useState(false);
  const [confirmed, setConfirmed] = useState<CheckoutConfirmResponse | null>(null);

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
  const selectedPayment = paymentOptions.find((option) => option.id === (paymentId || paymentOptionsQuery.data?.default_option)) ?? paymentOptions[0];

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
        pago: selectedPayment ? { provider: selectedPayment.provider, method: selectedPayment.method } : undefined,
      }),
    onSuccess: async (data) => {
      setConfirmed(data);
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
      setMessage("Selecciona una sucursal para reservar stock.");
      return;
    }
    setMessage(null);
    setNeedsProfile(false);
    confirmCheckout.mutate();
  }

  if (confirmed) {
    return (
      <section className="catalog-page catalog-canje-page">
        <div className="catalog-products-shell">
          <div className="catalog-header">
            <h1 className="catalog-title">Pedido confirmado</h1>
            <p className="catalog-subtitle">Orden #{confirmed.orden_id} - {money(confirmed.total_dinero)}</p>
          </div>
          <div className="catalog-confirm-branch-detail catalog-canje-block">
            <p><strong>Estado:</strong> {confirmed.estado}</p>
            {confirmed.pago?.checkout_url ? (
              <a className="product-card-btn product-card-btn-canjear" href={confirmed.pago.checkout_url} rel="noreferrer">
                Abrir pago seguro
              </a>
            ) : confirmed.pago?.setup_message ? (
              <p>{confirmed.pago.setup_message}</p>
            ) : null}
            <div className="catalog-float-toast-actions catalog-canje-actions">
              <Link to="/mis-pedidos" className="catalog-float-toast-btn-primary">Ver mis pedidos</Link>
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
          <h1 className="catalog-title">Carrito tienda</h1>
          <p className="catalog-subtitle">Revisa tu compra, elegi retiro y confirma el pago</p>
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
              <label className="catalog-confirm-label" htmlFor="carrito-tienda-sucursal">Sucursal de retiro</label>
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

            {paymentOptions.length ? (
              <div className="catalog-confirm-field catalog-canje-pickup">
                <label className="catalog-confirm-label" htmlFor="carrito-tienda-pago">Medio de pago</label>
                <select
                  id="carrito-tienda-pago"
                  className="catalog-pickup-select"
                  value={paymentId || paymentOptionsQuery.data?.default_option || paymentOptions[0]?.id || ""}
                  onChange={(event) => setPaymentId(event.target.value)}
                >
                  {paymentOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}{option.enabled ? "" : ` (${option.reason_disabled})`}
                    </option>
                  ))}
                </select>
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
