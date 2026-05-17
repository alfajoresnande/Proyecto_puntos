import type { ReactNode } from "react";

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
  description: string;
}> = [
  {
    key: "pedidos",
    label: "Pedidos",
    description: "Seguimiento de ventas web, estados y reservas.",
  },
  {
    key: "venta-local",
    label: "Venta local",
    description: "Registro separado para ventas presenciales.",
  },
  {
    key: "reportes",
    label: "Reportes",
    description: "Exportacion y cierre de ventas.",
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
      <SectionTitle title={activeView.label} description={activeView.description} />

      <div style={{ display: "grid", gap: "1.5rem" }}>
        {currentView === "pedidos" ? pedidosContent : null}
        {currentView === "venta-local" ? ventaLocalContent : null}
        {currentView === "reportes" ? reportesContent : null}
      </div>
    </div>
  );
}

function SectionTitle({ title, description }: { title: string; description: string }) {
  return (
    <div className="admin-section-header" style={{ marginBottom: "0.25rem" }}>
      <div>
        <h2 className="admin-section-title" style={{ fontSize: "1.05rem" }}>Ventas / {title}</h2>
        <p className="adm-inline-tip" style={{ margin: "0.35rem 0 0" }}>
          {description} Todo se muestra en horario de Buenos Aires para que pedidos, reportes y comprobantes coincidan.
        </p>
      </div>
    </div>
  );
}
