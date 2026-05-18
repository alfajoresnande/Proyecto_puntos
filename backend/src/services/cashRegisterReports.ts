import PDFDocument from "pdfkit";
import { Queryable, qAll, qOne } from "../db";
import { formatCashDateStamp, getCajaSesionSummary, normalizeCashPaymentMethod, type CajaSesionSummary } from "./cashRegister";

const BUENOS_AIRES_TIME_ZONE = "America/Argentina/Buenos_Aires";

type CajaReportSession = {
  id: number;
  sucursal_id: number;
  sucursal_nombre: string;
  usuario_nombre: string;
  fecha_operativa: string;
  estado: "abierta" | "cerrada";
  monto_apertura: number;
  monto_cierre_sistema: number | null;
  monto_cierre_declarado: number | null;
  diferencia_cierre: number | null;
  apertura_at: string;
  cierre_at: string | null;
};

type CajaReportMovement = {
  tipo: "venta" | "gasto";
  medio_pago: string;
  monto: number;
  descripcion: string | null;
  creado_por_nombre: string;
  created_at: string;
};

type CajaReportExpense = {
  id: number;
  proveedor_nombre: string | null;
  tercero_nombre: string | null;
  categoria: string;
  descripcion: string;
  medio_pago: string;
  monto: number;
  fecha_gasto: string;
  creado_por_nombre: string;
};

type CajaReportSale = {
  orden_id: number;
  fecha: string;
  cliente: string;
  estado: string;
  medio_pago: string;
  monto: number;
  creado_por_nombre: string;
};

export type CajaReportData = {
  session: CajaReportSession;
  summary: CajaSesionSummary;
  movements: CajaReportMovement[];
  expenses: CajaReportExpense[];
  sales: CajaReportSale[];
};

function assertDateStamp(value: string): string {
  const fecha = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
    throw new Error("Fecha invalida. Usa formato YYYY-MM-DD.");
  }
  return fecha;
}

function formatBuenosAiresDateTime(value: string | Date | null | undefined): string {
  if (!value) return "-";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("es-AR", {
    timeZone: BUENOS_AIRES_TIME_ZONE,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function money(value: number | string | null | undefined): string {
  const amount = Number(value ?? 0);
  return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" }).format(Number.isFinite(amount) ? amount : 0);
}

function methodLabel(value: string | null | undefined): string {
  const method = normalizeCashPaymentMethod(value);
  const labels: Record<string, string> = {
    cash: "Efectivo",
    transferencia: "Transferencia",
    tarjeta: "Tarjeta",
    qr: "QR",
    otro: "Otro",
  };
  return labels[method] ?? method;
}

function cleanText(value: unknown): string {
  return String(value ?? "-").replace(/\s+/g, " ").trim() || "-";
}

export async function getCajaReportData(
  conn: Queryable,
  input: { sucursalId: number; fecha: string },
): Promise<CajaReportData> {
  const fecha = assertDateStamp(input.fecha);
  const session = await qOne<CajaReportSession>(
    conn,
    `SELECT cs.id, cs.sucursal_id, s.nombre AS sucursal_nombre,
            COALESCE(u.nombre, 'Sistema') AS usuario_nombre,
            cs.fecha_operativa, cs.estado, cs.monto_apertura, cs.monto_cierre_sistema,
            cs.monto_cierre_declarado, cs.diferencia_cierre, cs.apertura_at, cs.cierre_at
     FROM caja_sesiones cs
     JOIN sucursales s ON s.id = cs.sucursal_id
     LEFT JOIN usuarios u ON u.id = cs.usuario_id
     WHERE cs.sucursal_id = ? AND cs.fecha_operativa = ?
     ORDER BY cs.id DESC
     LIMIT 1`,
    [input.sucursalId, fecha],
  );

  if (!session) {
    throw new Error("No hay caja registrada para esa sucursal y fecha.");
  }

  const summary = await getCajaSesionSummary(conn, Number(session.id));
  const movements = await qAll<CajaReportMovement>(
    conn,
    `SELECT cm.tipo, cm.medio_pago, cm.monto, cm.descripcion, cm.created_at,
            COALESCE(u.nombre, 'Sistema') AS creado_por_nombre
     FROM caja_movimientos cm
     LEFT JOIN usuarios u ON u.id = cm.creado_por
     WHERE cm.caja_sesion_id = ?
     ORDER BY cm.created_at ASC, cm.id ASC`,
    [session.id],
  );

  const expenses = await qAll<CajaReportExpense>(
    conn,
    `SELECT g.id, p.nombre AS proveedor_nombre, g.tercero_nombre, g.categoria, g.descripcion,
            g.medio_pago, g.monto, g.fecha_gasto, COALESCE(u.nombre, 'Sistema') AS creado_por_nombre
     FROM gastos g
     LEFT JOIN proveedores p ON p.id = g.proveedor_id
     LEFT JOIN usuarios u ON u.id = g.creado_por
     WHERE g.caja_sesion_id = ?
     ORDER BY g.fecha_gasto ASC, g.id ASC`,
    [session.id],
  );

  const sales = await qAll<CajaReportSale>(
    conn,
    `SELECT o.id AS orden_id, o.created_at AS fecha,
            COALESCE(uc.nombre, cl.nombre, 'Cliente local') AS cliente,
            o.estado, cm.medio_pago, cm.monto,
            COALESCE(us.nombre, 'Sistema') AS creado_por_nombre
     FROM caja_movimientos cm
     JOIN ordenes o ON cm.referencia_tipo = 'ordenes' AND cm.referencia_id = o.id
     LEFT JOIN usuarios uc ON uc.id = o.usuario_id
     LEFT JOIN clientes_locales cl ON cl.id = o.cliente_local_id
     LEFT JOIN usuarios us ON us.id = cm.creado_por
     WHERE cm.caja_sesion_id = ? AND cm.tipo = 'venta'
     ORDER BY cm.created_at ASC, cm.id ASC`,
    [session.id],
  );

  return {
    session: {
      ...session,
      fecha_operativa: formatCashDateStamp(session.fecha_operativa),
      monto_apertura: Number(session.monto_apertura ?? 0),
      monto_cierre_sistema: session.monto_cierre_sistema === null ? null : Number(session.monto_cierre_sistema),
      monto_cierre_declarado: session.monto_cierre_declarado === null ? null : Number(session.monto_cierre_declarado),
      diferencia_cierre: session.diferencia_cierre === null ? null : Number(session.diferencia_cierre),
    },
    summary,
    movements: movements.map((item) => ({ ...item, monto: Number(item.monto ?? 0) })),
    expenses: expenses.map((item) => ({ ...item, monto: Number(item.monto ?? 0) })),
    sales: sales.map((item) => ({ ...item, monto: Number(item.monto ?? 0) })),
  };
}

export function renderCajaPdfBuffer(data: CajaReportData): Promise<Buffer> {
  const generadoEn = formatBuenosAiresDateTime(new Date());

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margin: 34,
      info: {
        Title: "Reporte de caja",
        Subject: "Caja diaria",
        Author: "Nande Alfajores Correntinos",
      },
    });
    const chunks: Buffer[] = [];

    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const left = doc.page.margins.left;
    const rightLimit = doc.page.width - doc.page.margins.right;
    const bottomLimit = doc.page.height - doc.page.margins.bottom;

    function ensureSpace(height: number) {
      if (doc.y + height > bottomLimit) doc.addPage();
    }

    function sectionTitle(title: string) {
      ensureSpace(26);
      doc.moveDown(0.7);
      doc.font("Helvetica-Bold").fontSize(12).fillColor("#7a3b0c").text(title, left, doc.y);
      doc.moveDown(0.25);
    }

    function summaryBox(label: string, value: string, x: number, y: number, width: number) {
      doc.roundedRect(x, y, width, 44, 6).fillAndStroke("#fff4e8", "#e3c7ad");
      doc.font("Helvetica").fontSize(8).fillColor("#755236").text(label, x + 8, y + 8, { width: width - 16 });
      doc.font("Helvetica-Bold").fontSize(11).fillColor("#2b1606").text(value, x + 8, y + 23, { width: width - 16 });
    }

    function table(
      title: string,
      columns: Array<{ label: string; width: number; align?: "left" | "right" }>,
      rows: string[][],
    ) {
      sectionTitle(title);
      const tableWidth = columns.reduce((acc, column) => acc + column.width, 0);
      const headerHeight = 18;

      function drawHeader() {
        ensureSpace(headerHeight + 8);
        const headerY = doc.y;
        doc.rect(left, headerY, tableWidth, headerHeight).fillAndStroke("#f8ead9", "#e3c7ad");
        let x = left;
        doc.font("Helvetica-Bold").fontSize(7).fillColor("#6b2e08");
        for (const column of columns) {
          doc.text(column.label, x + 4, headerY + 5, { width: column.width - 8 });
          x += column.width;
        }
        doc.y = headerY + headerHeight;
      }

      drawHeader();

      if (!rows.length) {
        ensureSpace(24);
        doc.font("Helvetica").fontSize(8).fillColor("#755236").text("Sin datos para mostrar.", left + 6, doc.y + 7);
        doc.y += 26;
        return;
      }

      rows.forEach((row, index) => {
        doc.font("Helvetica").fontSize(7).fillColor("#2b1606");
        const rowHeight = Math.max(
          20,
          ...row.map((value, columnIndex) =>
            doc.heightOfString(cleanText(value), { width: columns[columnIndex].width - 8, align: columns[columnIndex].align ?? "left" }) + 10,
          ),
        );
        if (doc.y + rowHeight > bottomLimit) {
          doc.addPage();
          drawHeader();
        }
        const rowY = doc.y;
        if (index % 2 === 1) doc.rect(left, rowY, tableWidth, rowHeight).fill("#fffaf5");
        doc.rect(left, rowY, tableWidth, rowHeight).strokeColor("#e3c7ad").stroke();
        let x = left;
        row.forEach((value, columnIndex) => {
          const column = columns[columnIndex];
          doc.font("Helvetica").fontSize(7).fillColor("#2b1606").text(cleanText(value), x + 4, rowY + 5, {
            width: column.width - 8,
            align: column.align ?? "left",
          });
          doc.moveTo(x, rowY).lineTo(x, rowY + rowHeight).strokeColor("#e3c7ad").stroke();
          x += column.width;
        });
        doc.moveTo(left + tableWidth, rowY).lineTo(left + tableWidth, rowY + rowHeight).strokeColor("#e3c7ad").stroke();
        doc.y = rowY + rowHeight;
      });
    }

    doc.font("Helvetica-Bold").fontSize(18).fillColor("#7a3b0c").text("Reporte de caja", left, 34, { width: rightLimit - left });
    doc.font("Helvetica").fontSize(9).fillColor("#755236")
      .text(`Sucursal: ${data.session.sucursal_nombre}`, left, 58)
      .text(`Fecha operativa: ${data.session.fecha_operativa} - Estado: ${data.session.estado}`, left, 72)
      .text(`Horario Argentina, Buenos Aires. Generado: ${generadoEn}`, left, 86);

    const boxY = 108;
    const boxWidth = (rightLimit - left - 20) / 3;
    summaryBox("Ventas", money(data.summary.totalVentas), left, boxY, boxWidth);
    summaryBox("Gastos", money(data.summary.totalGastos), left + boxWidth + 10, boxY, boxWidth);
    summaryBox("Efectivo sistema", money(data.summary.efectivoSistema), left + (boxWidth + 10) * 2, boxY, boxWidth);
    doc.y = boxY + 55;

    table(
      "Resumen por medio",
      [
        { label: "Medio", width: 120 },
        { label: "Ventas", width: 110, align: "right" },
        { label: "Gastos", width: 110, align: "right" },
      ],
      (["cash", "transferencia", "tarjeta", "qr", "otro"] as const).map((medio) => [
        methodLabel(medio),
        money(data.summary.ventasPorMedio[medio]),
        money(data.summary.gastosPorMedio[medio]),
      ]),
    );

    table(
      "Ventas de caja",
      [
        { label: "Orden", width: 48 },
        { label: "Fecha", width: 74 },
        { label: "Cliente", width: 130 },
        { label: "Estado", width: 70 },
        { label: "Medio", width: 70 },
        { label: "Monto", width: 72, align: "right" },
      ],
      data.sales.map((sale) => [
        `#${sale.orden_id}`,
        formatBuenosAiresDateTime(sale.fecha),
        sale.cliente,
        sale.estado,
        methodLabel(sale.medio_pago),
        money(sale.monto),
      ]),
    );

    table(
      "Gastos de caja",
      [
        { label: "Fecha", width: 74 },
        { label: "Categoria", width: 82 },
        { label: "Descripcion", width: 138 },
        { label: "Proveedor/Tercero", width: 105 },
        { label: "Medio", width: 60 },
        { label: "Monto", width: 60, align: "right" },
      ],
      data.expenses.map((expense) => [
        formatBuenosAiresDateTime(expense.fecha_gasto),
        expense.categoria,
        expense.descripcion,
        expense.proveedor_nombre || expense.tercero_nombre || "-",
        methodLabel(expense.medio_pago),
        money(expense.monto),
      ]),
    );

    table(
      "Movimientos",
      [
        { label: "Fecha", width: 74 },
        { label: "Tipo", width: 52 },
        { label: "Medio", width: 68 },
        { label: "Descripcion", width: 190 },
        { label: "Usuario", width: 80 },
        { label: "Monto", width: 60, align: "right" },
      ],
      data.movements.map((movement) => [
        formatBuenosAiresDateTime(movement.created_at),
        movement.tipo,
        methodLabel(movement.medio_pago),
        movement.descripcion || "-",
        movement.creado_por_nombre,
        money(movement.monto),
      ]),
    );

    doc.end();
  });
}
