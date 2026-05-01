import { useMutation, useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../api";
import { useAuthStore } from "../../store/authStore";
import { useCartStore } from "../../store/cartStore";

type SucursalRetiro = {
  id: number;
  nombre: string;
  direccion: string;
  piso?: string | null;
  localidad: string;
  provincia: string;
};

type CanjeCarritoResponse = {
  canje_codigo?: string | null;
  codigo_retiro?: string | null;
  nuevo_saldo: number;
  total_unidades?: number;
  dias_limite_retiro?: number;
  sucursal_id?: number | null;
  sucursal?: SucursalRetiro | null;
  lugar_retiro?: string | null;
};

type ConfirmadoData = {
  codigo: string;
  totalUnidades: number;
  diasLimiteRetiro: number | null;
  sucursal: SucursalRetiro | null;
  lugarRetiro: string;
};

function isLegacyCanjeCode(code?: string | null): boolean {
  return Boolean(code && /^C0{2,}[A-Z0-9]*$/.test(code));
}

function getCanjeCode(data: CanjeCarritoResponse): string | null {
  if (data.canje_codigo && !isLegacyCanjeCode(data.canje_codigo)) return data.canje_codigo;
  if (data.codigo_retiro && !isLegacyCanjeCode(data.codigo_retiro)) return data.codigo_retiro;
  return null;
}

function formatSucursalLabel(sucursal: SucursalRetiro): string {
  const piso = sucursal.piso ? `, Piso ${sucursal.piso}` : "";
  return `${sucursal.nombre} - ${sucursal.direccion}${piso}, ${sucursal.localidad}, ${sucursal.provincia}`;
}

export function ConfirmarCanje() {
  const user = useAuthStore((state) => state.user);
  const updateUserPoints = useAuthStore((state) => state.updateUserPoints);
  const cartItemsMap = useCartStore((state) => state.items);
  const cartIncrement = useCartStore((state) => state.increment);
  const cartDecrement = useCartStore((state) => state.decrement);
  const cartClear = useCartStore((state) => state.clear);
  const [sucursalRetiroId, setSucursalRetiroId] = useState("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [needsProfileCompletion, setNeedsProfileCompletion] = useState(false);
  const [canjeConfirmado, setCanjeConfirmado] = useState<ConfirmadoData | null>(null);

  const sucursalesQuery = useQuery({
    queryKey: ["cliente", "sucursales-retiro"],
    queryFn: () => api.get<SucursalRetiro[]>("/cliente/sucursales"),
    enabled: user?.rol === "cliente",
  });

  const sucursalesRetiro = sucursalesQuery.data ?? [];
  const cartItems = useMemo(() => Object.values(cartItemsMap), [cartItemsMap]);
  const totalPuntos = useMemo(
    () => cartItems.reduce((acc, item) => acc + item.puntos_requeridos * item.cantidad, 0),
    [cartItems],
  );
  const totalUnidades = useMemo(
    () => cartItems.reduce((acc, item) => acc + item.cantidad, 0),
    [cartItems],
  );
  const sucursalRetiroSeleccionada =
    (sucursalRetiroId ? sucursalesRetiro.find((item) => String(item.id) === sucursalRetiroId) : undefined) ||
    (sucursalesRetiro.length === 1 ? sucursalesRetiro[0] : undefined);

  const canjearMutation = useMutation({
    mutationFn: () =>
      api.post<CanjeCarritoResponse>("/cliente/canjear-carrito", {
        items: cartItems.map((item) => ({
          producto_id: item.producto_id,
          cantidad: item.cantidad,
        })),
        sucursal_id: sucursalRetiroSeleccionada?.id,
      }),
    onSuccess: (data) => {
      updateUserPoints(data.nuevo_saldo);
      cartClear();
      const sucursal =
        data.sucursal ?? (data.sucursal_id ? sucursalesRetiro.find((item) => item.id === data.sucursal_id) ?? null : null);
      setCanjeConfirmado({
        codigo: getCanjeCode(data) ?? "Disponible en Mis Canjes",
        totalUnidades: typeof data.total_unidades === "number" && data.total_unidades > 0 ? data.total_unidades : totalUnidades,
        diasLimiteRetiro:
          typeof data.dias_limite_retiro === "number" && data.dias_limite_retiro > 0 ? data.dias_limite_retiro : null,
        sucursal,
        lugarRetiro: sucursal
          ? formatSucursalLabel(sucursal)
          : (data.lugar_retiro || "informada por la administracion").trim(),
      });
      setErrorMsg(null);
      setNeedsProfileCompletion(false);
    },
    onError: (error: Error) => {
      const message = error.message || "No se pudo confirmar el canje.";
      setErrorMsg(message);
      setNeedsProfileCompletion(message.toLowerCase().includes("completa tus datos obligatorios"));
    },
  });

  function confirmarCanje() {
    if (!cartItems.length) {
      setErrorMsg("Agrega productos al carrito para poder confirmar el canje.");
      return;
    }

    if (!sucursalesRetiro.length) {
      setErrorMsg("No hay sucursales de retiro disponibles en este momento.");
      return;
    }

    if (sucursalesRetiro.length > 1 && !sucursalRetiroSeleccionada) {
      setErrorMsg("Selecciona una sucursal de retiro antes de confirmar.");
      return;
    }

    setNeedsProfileCompletion(false);
    setErrorMsg(null);
    canjearMutation.mutate();
  }

  return (
    <section className="catalog-page catalog-canje-page">
      <div className="catalog-products-shell">
        <div className="catalog-header">
          <h1 className="catalog-title">Tu carrito de canjes</h1>
          <p className="catalog-subtitle">Lista tus productos, ajusta cantidades y confirma el canje</p>
        </div>

        {canjeConfirmado ? (
          <div className="catalog-confirm-branch-detail catalog-canje-block catalog-canje-confirmed" style={{ gap: "0.45rem" }}>
            <p><strong>Canje confirmado.</strong></p>
            <p>Productos canjeados: <strong>{canjeConfirmado.totalUnidades}</strong></p>
            <p>Codigo de canje: <strong>{canjeConfirmado.codigo}</strong></p>
            {canjeConfirmado.sucursal ? (
              <>
                <p><strong>Sucursal:</strong> {canjeConfirmado.sucursal.nombre}</p>
                <p><strong>Direccion:</strong> {canjeConfirmado.sucursal.direccion}</p>
                {canjeConfirmado.sucursal.piso ? <p><strong>Piso:</strong> {canjeConfirmado.sucursal.piso}</p> : null}
                <p><strong>Localidad:</strong> {canjeConfirmado.sucursal.localidad}</p>
                <p><strong>Provincia:</strong> {canjeConfirmado.sucursal.provincia}</p>
              </>
            ) : (
              <p><strong>Retiro:</strong> {canjeConfirmado.lugarRetiro}</p>
            )}
            {canjeConfirmado.diasLimiteRetiro ? (
              <p>Tenes <strong>{canjeConfirmado.diasLimiteRetiro} dias</strong> para retirar este canje.</p>
            ) : null}
            <div className="catalog-float-toast-actions catalog-canje-actions" style={{ marginTop: "0.45rem" }}>
              <Link to="/mis-canjes" className="product-card-btn product-card-btn-canjear" style={{ textAlign: "center", textDecoration: "none" }}>
                Ver mis canjes
              </Link>
              <Link to="/catalogo" className="catalog-float-toast-btn-secondary" style={{ textDecoration: "none", textAlign: "center" }}>
                Volver al catalogo
              </Link>
            </div>
          </div>
        ) : (
          <>
            {cartItems.length === 0 ? (
              <div className="catalog-confirm-branch-detail catalog-canje-block">
                <p>Tu carrito esta vacio.</p>
                <div className="catalog-float-toast-actions catalog-canje-actions" style={{ marginTop: "0.3rem" }}>
                  <Link to="/catalogo" className="product-card-btn product-card-btn-canjear" style={{ textDecoration: "none", textAlign: "center" }}>
                    Ir al catalogo
                  </Link>
                </div>
              </div>
            ) : (
              <>
                <div className="catalog-confirm-branch-detail catalog-canje-block catalog-canje-list">
                  {cartItems.map((item) => (
                    <div key={item.producto_id} className="catalog-canje-item">
                      <div style={{ minWidth: 0 }}>
                        <p style={{ margin: 0, fontWeight: 700 }}>{item.nombre}</p>
                        <p style={{ margin: "0.1rem 0 0", color: "#8B5A30" }}>
                          {item.puntos_requeridos * item.cantidad} pts
                        </p>
                      </div>
                      <div className="catalog-canje-item-qty">
                        <button type="button" onClick={() => cartDecrement(item.producto_id)} disabled={canjearMutation.isPending}>-</button>
                        <span>{item.cantidad}</span>
                        <button type="button" onClick={() => cartIncrement(item.producto_id)} disabled={canjearMutation.isPending}>+</button>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="catalog-confirm-branch-detail catalog-canje-block catalog-canje-summary" style={{ gap: "0.2rem" }}>
                  <p>Total de productos: <strong>{totalUnidades}</strong></p>
                  <p>Total de puntos: <strong>{totalPuntos} pts</strong></p>
                </div>

                <div className="catalog-confirm-field catalog-canje-pickup">
                  <label className="catalog-confirm-label" htmlFor="carrito-canjes-sucursal">
                    Sucursal donde vas a retirar
                  </label>
                  <select
                    id="carrito-canjes-sucursal"
                    className="catalog-pickup-select"
                    value={sucursalRetiroId}
                    onChange={(event) => setSucursalRetiroId(event.target.value)}
                    disabled={sucursalesQuery.isLoading || canjearMutation.isPending || !sucursalesRetiro.length}
                  >
                    {sucursalesRetiro.length > 1 ? <option value="">Selecciona una sucursal</option> : null}
                    {sucursalesRetiro.map((sucursal) => (
                      <option key={sucursal.id} value={sucursal.id}>
                        {sucursal.nombre}
                      </option>
                    ))}
                  </select>
                </div>

                {sucursalRetiroSeleccionada ? (
                  <div className="catalog-confirm-branch-detail catalog-canje-block catalog-canje-branch">
                    <p><strong>Nombre:</strong> {sucursalRetiroSeleccionada.nombre}</p>
                    <p><strong>Direccion:</strong> {sucursalRetiroSeleccionada.direccion}</p>
                    {sucursalRetiroSeleccionada.piso ? <p><strong>Piso:</strong> {sucursalRetiroSeleccionada.piso}</p> : null}
                    <p><strong>Localidad:</strong> {sucursalRetiroSeleccionada.localidad}</p>
                    <p><strong>Provincia:</strong> {sucursalRetiroSeleccionada.provincia}</p>
                  </div>
                ) : null}

                {errorMsg ? <p className="catalog-confirm-hint" style={{ color: "#9B2C2C" }}>{errorMsg}</p> : null}

                {needsProfileCompletion ? (
                  <div className="catalog-float-toast-actions catalog-canje-actions">
                    <Link to="/mi-perfil" className="product-card-btn product-card-btn-canjear" style={{ textDecoration: "none", textAlign: "center" }}>
                      Completar mi perfil
                    </Link>
                  </div>
                ) : null}

                <div className="catalog-float-toast-actions catalog-canje-actions">
                  <button
                    className="catalog-float-toast-btn-primary"
                    onClick={confirmarCanje}
                    disabled={canjearMutation.isPending || sucursalesQuery.isLoading}
                  >
                    {canjearMutation.isPending ? "Procesando..." : "Confirmar canje"}
                  </button>
                  <button className="catalog-float-toast-btn-secondary" onClick={() => cartClear()} disabled={canjearMutation.isPending}>
                    Vaciar carrito
                  </button>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </section>
  );
}
