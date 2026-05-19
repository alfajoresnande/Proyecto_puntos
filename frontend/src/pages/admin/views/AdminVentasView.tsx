import type { ReactNode } from "react";
import { AreaExplanation } from "../components/AreaExplanation";

export type AdminVentasViewKey = "pedidos" | "venta-local" | "reportes";

type AdminVentasViewProps = {
  currentView: AdminVentasViewKey;
  pedidosContent: ReactNode;
  ventaLocalContent: ReactNode;
  reportesContent: ReactNode;
};

const SALES_VIEWS: Array<{
  key: AdminVentasViewKey;
  label: string;
  explanation: string[];
}> = [
  {
    key: "pedidos",
    label: "Pedidos",
    explanation: [
      "Aca se revisan los pedidos web y su estado: pagado, preparado, entregado, cancelado o expirado.",
      "Usa esta vista para preparar pedidos, entregar compras, ver comprobantes y cancelar pedidos cuando haga falta avisando el motivo.",
      "Las fechas se muestran en horario Buenos Aires para que el control coincida con reportes y comprobantes.",
    ],
  },
  {
    key: "venta-local",
    label: "Venta local",
    explanation: [
      "Aca se cargan ventas presenciales del local, ya sea a un cliente web o a una persona manual con nombre, DNI y telefono opcional.",
      "La venta local descuenta stock compartido de la sucursal y suma en la caja diaria segun el medio de pago elegido.",
      "Si se elige un cliente web, se pueden aplicar sus descuentos y acreditar puntos cuando corresponda.",
    ],
  },
  {
    key: "reportes",
    label: "Reportes",
    explanation: [
      "Aca se descargan reportes de ventas para revisar lo vendido por canal y por fecha.",
      "Los reportes separan ventas web, ventas locales de admin y ventas locales de vendedor para no mezclar origenes.",
      "Los archivos salen en horario Buenos Aires y pueden descargarse en PDF o Excel.",
    ],
  },
];

export function AdminVentasView({
  currentView,
  pedidosContent,
  ventaLocalContent,
  reportesContent,
}: AdminVentasViewProps) {
  const activeView = SALES_VIEWS.find((view) => view.key === currentView) ?? SALES_VIEWS[0];

  return (
    <div className="adm-sales-shell">
      <SectionTitle title={activeView.label} />
      <AreaExplanation key={activeView.key} items={activeView.explanation} />

      <div style={{ display: "grid", gap: "1.5rem" }}>
        {currentView === "pedidos" ? pedidosContent : null}
        {currentView === "venta-local" ? ventaLocalContent : null}
        {currentView === "reportes" ? reportesContent : null}
      </div>
    </div>
  );
}

function SectionTitle({ title }: { title: string }) {
  return (
    <div className="admin-section-header" style={{ marginBottom: "0.25rem" }}>
      <div>
        <h2 className="admin-section-title" style={{ fontSize: "1.05rem" }}>Ventas / {title}</h2>
      </div>
    </div>
  );
}
