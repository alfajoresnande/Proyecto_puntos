type OrderSalesToastKind = "order" | "sale";

type OrderSalesToastProps = {
  kind: OrderSalesToastKind;
  customer: string;
  total: string;
  method: string;
  orderId: number;
  count?: number;
};

export function OrderSalesToastIcon({ kind }: { kind: OrderSalesToastKind }) {
  return (
    <span className="order-sales-toast-icon-mark" aria-hidden="true">
      {kind === "sale" ? "$" : "N"}
    </span>
  );
}

export function OrderSalesToast({ kind, customer, total, method, orderId, count = 1 }: OrderSalesToastProps) {
  const orderLabel = kind === "sale" ? "Venta" : "Pedido";
  return (
    <div className="order-sales-toast-content">
      <div className="order-sales-toast-topline">
        <span className="order-sales-toast-badge">Ahora</span>
        <span className="order-sales-toast-id">
          {count > 1 ? `${count} novedades` : `${orderLabel} #${orderId}`}
        </span>
      </div>
      <dl className="order-sales-toast-details">
        <div>
          <dt>Cliente</dt>
          <dd>{customer}</dd>
        </div>
        <div>
          <dt>Total</dt>
          <dd>{total}</dd>
        </div>
        <div>
          <dt>Metodo</dt>
          <dd>{method}</dd>
        </div>
      </dl>
    </div>
  );
}
