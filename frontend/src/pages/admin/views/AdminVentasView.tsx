import type { ReactNode } from "react";

export type AdminVentasViewKey = "pedidos" | "venta-local" | "reportes";

type AdminVentasViewProps = {
  currentView: AdminVentasViewKey;
  onChangeView: (view: AdminVentasViewKey) => void;
  orderAttentionCount: number;
  localDraftCount: number;
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
  onChangeView,
  orderAttentionCount,
  localDraftCount,
  pedidosContent,
  ventaLocalContent,
  reportesContent,
}: AdminVentasViewProps) {
  const activeView = SALES_VIEWS.find((view) => view.key === currentView) ?? SALES_VIEWS[0];

  return (
    <div className="adm-sales-shell">
      <SectionTitle />

      <div className="adm-sales-summary">
        <article className="adm-sales-summary-card">
          <span className="adm-sales-summary-label">Pedidos con atencion</span>
          <strong className="adm-sales-summary-value">{orderAttentionCount}</strong>
          <p className="adm-sales-summary-text">Pagados, preparados o reservas pendientes de revisar.</p>
        </article>
        <article className="adm-sales-summary-card">
          <span className="adm-sales-summary-label">Borrador venta local</span>
          <strong className="adm-sales-summary-value">{localDraftCount}</strong>
          <p className="adm-sales-summary-text">Productos cargados antes de confirmar la venta presencial.</p>
        </article>
        <article className="adm-sales-summary-card">
          <span className="adm-sales-summary-label">Vista activa</span>
          <strong className="adm-sales-summary-value">{activeView.label}</strong>
          <p className="adm-sales-summary-text">{activeView.description}</p>
        </article>
      </div>

      <div className="admin-card admin-card-padded adm-sales-switcher-card">
        <div className="adm-sales-switcher-head">
          <div>
            <p className="adm-sales-switcher-title">Vistas de ventas</p>
            <p className="adm-inline-tip" style={{ margin: 0 }}>
              Separado por tareas para que pedidos, venta local y reportes no queden mezclados.
            </p>
          </div>
        </div>

        <div className="adm-sales-switcher">
          {SALES_VIEWS.map((view) => (
            <button
              key={view.key}
              type="button"
              className={`adm-sales-switcher-btn${currentView === view.key ? " active" : ""}`}
              onClick={() => onChangeView(view.key)}
            >
              <span className="adm-sales-switcher-btn-title">{view.label}</span>
              <span className="adm-sales-switcher-btn-desc">{view.description}</span>
            </button>
          ))}
        </div>
      </div>

      <div style={{ display: "grid", gap: "1.5rem" }}>
        {currentView === "pedidos" ? pedidosContent : null}
        {currentView === "venta-local" ? ventaLocalContent : null}
        {currentView === "reportes" ? reportesContent : null}
      </div>
    </div>
  );
}

function SectionTitle() {
  return (
    <div className="admin-section-header" style={{ marginBottom: "0.25rem" }}>
      <div>
        <h2 className="admin-section-title" style={{ fontSize: "1.05rem" }}>Ventas</h2>
        <p className="adm-inline-tip" style={{ margin: "0.35rem 0 0" }}>
          Todo se muestra en horario de Buenos Aires para que pedidos, reportes y comprobantes coincidan.
        </p>
      </div>
    </div>
  );
}
