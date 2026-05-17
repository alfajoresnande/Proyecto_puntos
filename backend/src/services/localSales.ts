import crypto from "crypto";
import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";
import { Queryable, qAll, qOne, qRun } from "../db";
import { acreditarPuntosPorCompra } from "./points";

export type LocalSaleChannel = "admin" | "vendedor";

export type LocalSaleFlavorInput = {
  sabor_id: number;
  cantidad: number;
};

export type LocalSaleItemInput = {
  producto_id: number;
  cantidad: number;
  sabores?: LocalSaleFlavorInput[];
};

type ProductForLocalSale = {
  id: number;
  nombre: string;
  activo: number;
  tipo_producto: "canje" | "venta" | "mixto";
  configuracion_tipo: "simple" | "caja_sabores";
  capacidad_sabores: number | null;
  precio_dinero: number | null;
  puntaje_al_comprar: number | null;
};

type PreparedFlavor = {
  sabor_id: number;
  nombre: string;
  cantidad: number;
};

type PreparedItem = {
  producto_id: number;
  producto_nombre: string;
  cantidad: number;
  precio_dinero_unit: number;
  puntaje_al_comprar_unitario: number;
  subtotal_dinero: number;
  config_hash: string;
  sabores: PreparedFlavor[];
};

export type RegisterLocalSaleInput = {
  canal: LocalSaleChannel;
  usuarioId: number;
  sucursalId: number;
  metodoPago: string;
  notas?: string | null;
  acreditarPuntos?: boolean;
  creadoPor: number;
  items: LocalSaleItemInput[];
};

export type RegisterLocalSaleResult = {
  ordenId: number;
  totalDinero: number;
  totalUnidades: number;
  totalPuntosGanados: number;
};

export type VentaReporteFilter = {
  desde?: string | null;
  hasta?: string | null;
  canal?: "web" | "admin" | "vendedor" | null;
  estado?: string | null;
};

export type VentaReporteRow = {
  id: number;
  fecha: string;
  canal: "web" | "admin" | "vendedor";
  estado: string;
  cliente: string;
  email: string;
  sucursal: string;
  metodo_pago: string;
  total_dinero: number;
  total_puntos: number;
  total_unidades: number;
  productos: string;
  notas: string;
};

const VALID_PAYMENT_METHODS = new Set(["cash", "transferencia", "tarjeta", "qr", "otro"]);
const BUENOS_AIRES_TIME_ZONE = "America/Argentina/Buenos_Aires";

function toMoney(value: number): number {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function normalizePaymentMethod(value: string): string {
  const method = value.trim().toLowerCase();
  return VALID_PAYMENT_METHODS.has(method) ? method : "cash";
}

function getTimeZoneParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);

  const values = Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  ) as Record<string, string>;

  return {
    year: values.year,
    month: values.month,
    day: values.day,
    hour: values.hour,
    minute: values.minute,
    second: values.second,
  };
}

function getTimeZoneOffsetMillis(date: Date, timeZone: string): number {
  const parts = getTimeZoneParts(date, timeZone);
  const utcEquivalent = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return utcEquivalent - date.getTime();
}

function toMysqlDateTimeFromUtc(timestamp: number): string {
  const date = new Date(timestamp);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  const hour = String(date.getUTCHours()).padStart(2, "0");
  const minute = String(date.getUTCMinutes()).padStart(2, "0");
  const second = String(date.getUTCSeconds()).padStart(2, "0");
  return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
}

function buenosAiresMidnightToUtcMysql(value: string, dayOffset: number): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const utcGuess = Date.UTC(year, month - 1, day + dayOffset, 0, 0, 0);
  const firstOffset = getTimeZoneOffsetMillis(new Date(utcGuess), BUENOS_AIRES_TIME_ZONE);
  const firstPass = utcGuess - firstOffset;
  const finalOffset = getTimeZoneOffsetMillis(new Date(firstPass), BUENOS_AIRES_TIME_ZONE);
  return toMysqlDateTimeFromUtc(utcGuess - finalOffset);
}

function formatBuenosAiresDateTime(value: string | Date): string {
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

export function getBuenosAiresDateStamp(value: Date = new Date()): string {
  const parts = getTimeZoneParts(value, BUENOS_AIRES_TIME_ZONE);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function normalizeFlavorSelection(sabores: LocalSaleFlavorInput[] | undefined): LocalSaleFlavorInput[] {
  const map = new Map<number, number>();
  for (const item of sabores ?? []) {
    const flavorId = Number(item.sabor_id);
    const quantity = Number(item.cantidad);
    if (!Number.isInteger(flavorId) || flavorId <= 0) continue;
    if (!Number.isInteger(quantity) || quantity <= 0) continue;
    map.set(flavorId, (map.get(flavorId) ?? 0) + quantity);
  }
  return Array.from(map.entries())
    .map(([sabor_id, cantidad]) => ({ sabor_id, cantidad }))
    .sort((a, b) => a.sabor_id - b.sabor_id);
}

function buildFlavorConfigHash(productId: number, sabores: LocalSaleFlavorInput[]): string {
  if (!sabores.length) return "";
  const signature = sabores.map((item) => `${item.sabor_id}:${item.cantidad}`).join("|");
  return crypto.createHash("sha256").update(`${productId}|${signature}`).digest("hex");
}

async function validateFlavorSelectionForLocalSale(
  conn: Queryable,
  producto: ProductForLocalSale,
  sabores: LocalSaleFlavorInput[],
  cantidadCajas: number,
): Promise<PreparedFlavor[]> {
  if (producto.configuracion_tipo !== "caja_sabores") {
    if (sabores.length) {
      throw new Error("Este producto no permite seleccion de sabores.");
    }
    return [];
  }

  const capacidad = Number(producto.capacidad_sabores ?? 0);
  if (!Number.isInteger(capacidad) || capacidad <= 0) {
    throw new Error(`La caja ${producto.nombre} no tiene capacidad configurada.`);
  }
  if (!Number.isInteger(cantidadCajas) || cantidadCajas <= 0) {
    throw new Error("La cantidad de cajas debe ser un entero mayor a 0.");
  }

  const totalRequerido = capacidad * cantidadCajas;
  const totalSeleccionado = sabores.reduce((acc, item) => acc + Number(item.cantidad), 0);
  if (totalSeleccionado !== totalRequerido) {
    throw new Error(`Selecciona exactamente ${totalRequerido} alfajores para ${cantidadCajas} caja${cantidadCajas === 1 ? "" : "s"} de ${producto.nombre}.`);
  }

  const allowedRows = await qAll<{ id: number; nombre: string; activo: number }>(
    conn,
    `SELECT s.id, s.nombre, s.activo
     FROM producto_sabores ps
     JOIN sabores s ON s.id = ps.sabor_id
     WHERE ps.producto_id = ? AND ps.activo = 1
     ORDER BY ps.orden ASC, s.nombre ASC`,
    [producto.id],
  );
  const allowed = new Map(allowedRows.map((row) => [Number(row.id), row]));

  return sabores.map((item) => {
    const row = allowed.get(Number(item.sabor_id));
    if (!row || Number(row.activo ?? 0) !== 1) {
      throw new Error("Uno de los sabores elegidos no esta disponible para esta caja.");
    }
    return {
      sabor_id: Number(row.id),
      nombre: row.nombre,
      cantidad: Number(item.cantidad),
    };
  });
}

function mergePreparedItems(items: PreparedItem[]): PreparedItem[] {
  const merged = new Map<string, PreparedItem>();
  for (const item of items) {
    const key = `${item.producto_id}:${item.config_hash}`;
    const current = merged.get(key);
    if (!current) {
      merged.set(key, { ...item, sabores: item.sabores.map((sabor) => ({ ...sabor })) });
      continue;
    }
    current.cantidad += item.cantidad;
    current.subtotal_dinero = toMoney(current.subtotal_dinero + item.subtotal_dinero);
    for (const flavor of item.sabores) {
      const existing = current.sabores.find((sabor) => sabor.sabor_id === flavor.sabor_id);
      if (existing) existing.cantidad += flavor.cantidad;
      else current.sabores.push({ ...flavor });
    }
  }
  return Array.from(merged.values());
}

async function prepareLocalSaleItems(conn: Queryable, items: LocalSaleItemInput[]): Promise<PreparedItem[]> {
  const prepared: PreparedItem[] = [];

  for (const item of items) {
    const productId = Number(item.producto_id);
    const quantity = Number(item.cantidad);
    if (!Number.isInteger(productId) || productId <= 0) {
      throw new Error("Producto invalido en la venta local.");
    }
    if (!Number.isInteger(quantity) || quantity <= 0 || quantity > 200) {
      throw new Error("La cantidad debe ser un entero entre 1 y 200.");
    }

    const producto = await qOne<ProductForLocalSale>(
      conn,
      `SELECT id, nombre, activo, tipo_producto, configuracion_tipo, capacidad_sabores,
              precio_dinero, puntaje_al_comprar
       FROM productos
       WHERE id = ?
       LIMIT 1`,
      [productId],
    );
    if (!producto || Number(producto.activo ?? 0) !== 1) {
      throw new Error(`El producto #${productId} no existe o esta inactivo.`);
    }
    if (producto.tipo_producto !== "venta" && producto.tipo_producto !== "mixto") {
      throw new Error(`${producto.nombre} no esta configurado para venta.`);
    }

    const unitPrice = Number(producto.precio_dinero ?? 0);
    if (!Number.isFinite(unitPrice) || unitPrice <= 0) {
      throw new Error(`${producto.nombre} no tiene precio de venta configurado.`);
    }

    const sabores = normalizeFlavorSelection(item.sabores);
    const saboresDetalle = await validateFlavorSelectionForLocalSale(conn, producto, sabores, quantity);
    const subtotal = toMoney(unitPrice * quantity);
    prepared.push({
      producto_id: Number(producto.id),
      producto_nombre: producto.nombre,
      cantidad: quantity,
      precio_dinero_unit: toMoney(unitPrice),
      puntaje_al_comprar_unitario: Number(producto.puntaje_al_comprar ?? 0),
      subtotal_dinero: subtotal,
      config_hash: buildFlavorConfigHash(Number(producto.id), sabores),
      sabores: saboresDetalle,
    });
  }

  return mergePreparedItems(prepared);
}

export async function registerLocalSale(
  conn: Queryable,
  input: RegisterLocalSaleInput,
): Promise<RegisterLocalSaleResult> {
  const cliente = await qOne<{ id: number }>(
    conn,
    "SELECT id FROM usuarios WHERE id = ? AND rol = 'cliente' AND activo = 1 LIMIT 1",
    [input.usuarioId],
  );
  if (!cliente) {
    throw new Error("Selecciona un cliente activo para registrar la venta local.");
  }

  const sucursal = await qOne<{ id: number }>(
    conn,
    "SELECT id FROM sucursales WHERE id = ? AND activo = 1 LIMIT 1",
    [input.sucursalId],
  );
  if (!sucursal) {
    throw new Error("Selecciona una sucursal activa para registrar la venta local.");
  }

  const preparedItems = await prepareLocalSaleItems(conn, input.items);
  if (!preparedItems.length) {
    throw new Error("Agrega al menos un producto a la venta local.");
  }

  const totalDinero = toMoney(preparedItems.reduce((acc, item) => acc + item.subtotal_dinero, 0));
  const totalUnidades = preparedItems.reduce((acc, item) => acc + item.cantidad, 0);
  const totalPuntosGanados = preparedItems.reduce(
    (acc, item) => acc + item.cantidad * item.puntaje_al_comprar_unitario,
    0,
  );
  const metodoPago = normalizePaymentMethod(input.metodoPago || "cash");
  const notas = [
    `Venta local registrada desde panel ${input.canal}.`,
    input.notas?.trim() ? input.notas.trim() : null,
  ].filter(Boolean).join(" ");

  const insertedOrder = await qRun(
    conn,
    `INSERT INTO ordenes
      (usuario_id, canal, tipo_orden, estado, moneda, total_dinero, total_puntos, sucursal_retiro_id, notas)
     VALUES (?, ?, 'venta', 'pagada', 'ARS', ?, 0, ?, ?)`,
    [Number(cliente.id), input.canal, totalDinero, Number(sucursal.id), notas || null],
  );
  const ordenId = insertedOrder.insertId;

  for (const item of preparedItems) {
    const insertedItem = await qRun(
      conn,
      `INSERT INTO orden_items
        (orden_id, producto_id, cantidad, modo_compra, config_hash, precio_dinero_unit,
         precio_puntos_unit, subtotal_dinero, subtotal_puntos, puntaje_al_comprar_unitario)
       VALUES (?, ?, ?, 'dinero', ?, ?, NULL, ?, 0, ?)`,
      [
        ordenId,
        item.producto_id,
        item.cantidad,
        item.config_hash,
        item.precio_dinero_unit,
        item.subtotal_dinero,
        item.puntaje_al_comprar_unitario,
      ],
    );

    for (const sabor of item.sabores) {
      await qRun(
        conn,
        `INSERT INTO orden_item_sabores (orden_item_id, sabor_id, sabor_nombre, cantidad)
         VALUES (?, ?, ?, ?)`,
        [insertedItem.insertId, sabor.sabor_id, sabor.nombre, sabor.cantidad],
      );
    }
  }

  await qRun(
    conn,
    `INSERT INTO pagos (orden_id, proveedor, metodo, estado, monto, moneda, provider_payment_id, payload_json)
     VALUES (?, 'local', ?, 'aprobado', ?, 'ARS', ?, ?)`,
    [
      ordenId,
      metodoPago,
      totalDinero,
      `local-${input.canal}-${ordenId}`,
      JSON.stringify({
        canal: input.canal,
        metodo_pago: metodoPago,
        creado_por: input.creadoPor,
        mueve_stock_web: false,
      }),
    ],
  );

  if (input.acreditarPuntos) {
    await acreditarPuntosPorCompra(conn, ordenId);
  }

  return {
    ordenId,
    totalDinero,
    totalUnidades,
    totalPuntosGanados,
  };
}

function normalizeDateStart(value?: string | null): string | null {
  if (!value) return null;
  return buenosAiresMidnightToUtcMysql(value, 0);
}

function normalizeDateEnd(value?: string | null): string | null {
  if (!value) return null;
  return buenosAiresMidnightToUtcMysql(value, 1);
}

export async function getVentasReporteRows(
  conn: Queryable,
  filters: VentaReporteFilter = {},
): Promise<VentaReporteRow[]> {
  const where = ["o.tipo_orden IN ('venta', 'mixta')"];
  const params: Array<string | number> = [];

  const desde = normalizeDateStart(filters.desde);
  const hasta = normalizeDateEnd(filters.hasta);
  if (desde) {
    where.push("o.created_at >= ?");
    params.push(desde);
  }
  if (hasta) {
    where.push("o.created_at < ?");
    params.push(hasta);
  }
  if (filters.canal === "web" || filters.canal === "admin" || filters.canal === "vendedor") {
    where.push("o.canal = ?");
    params.push(filters.canal);
  }
  if (filters.estado?.trim()) {
    where.push("o.estado = ?");
    params.push(filters.estado.trim());
  }

  const rows = await qAll<{
    id: number;
    fecha: string;
    canal: "web" | "admin" | "vendedor";
    estado: string;
    cliente: string;
    email: string;
    sucursal: string | null;
    proveedor: string | null;
    metodo: string | null;
    total_dinero: number;
    total_puntos: number;
    notas: string | null;
  }>(
    conn,
    `SELECT o.id, o.created_at AS fecha, o.canal, o.estado,
            u.nombre AS cliente, u.email,
            COALESCE(s.nombre, '') AS sucursal,
            pay.proveedor, pay.metodo,
            o.total_dinero, o.total_puntos, o.notas
     FROM ordenes o
     JOIN usuarios u ON u.id = o.usuario_id
     LEFT JOIN sucursales s ON s.id = o.sucursal_retiro_id
     LEFT JOIN (
       SELECT p1.orden_id, p1.proveedor, p1.metodo
       FROM pagos p1
       JOIN (
         SELECT orden_id, MAX(id) AS last_id
         FROM pagos
         GROUP BY orden_id
       ) last_pay ON last_pay.last_id = p1.id
     ) pay ON pay.orden_id = o.id
     WHERE ${where.join(" AND ")}
     ORDER BY o.created_at DESC, o.id DESC
     LIMIT 2000`,
    params,
  );

  if (!rows.length) return [];

  const orderIds = rows.map((row) => Number(row.id));
  const placeholders = orderIds.map(() => "?").join(", ");
  const itemRows = await qAll<{
    orden_id: number;
    item_id: number;
    producto: string;
    cantidad: number;
    subtotal_dinero: number;
    sabor_nombre: string | null;
    sabor_cantidad: number | null;
  }>(
    conn,
    `SELECT oi.orden_id, oi.id AS item_id, p.nombre AS producto, oi.cantidad, oi.subtotal_dinero,
            ois.sabor_nombre, ois.cantidad AS sabor_cantidad
     FROM orden_items oi
     JOIN productos p ON p.id = oi.producto_id
     LEFT JOIN orden_item_sabores ois ON ois.orden_item_id = oi.id
     WHERE oi.orden_id IN (${placeholders})
     ORDER BY oi.orden_id ASC, oi.id ASC, ois.id ASC`,
    orderIds,
  );

  const itemMap = new Map<number, Map<number, { texto: string; cantidad: number; sabores: string[] }>>();
  for (const item of itemRows) {
    const orderId = Number(item.orden_id);
    const itemId = Number(item.item_id);
    const byOrder = itemMap.get(orderId) ?? new Map<number, { texto: string; cantidad: number; sabores: string[] }>();
    const current = byOrder.get(itemId) ?? {
      texto: `${item.producto} x${Number(item.cantidad)}`,
      cantidad: Number(item.cantidad ?? 0),
      sabores: [],
    };
    if (item.sabor_nombre) {
      current.sabores.push(`${item.sabor_nombre} x${Number(item.sabor_cantidad ?? 0)}`);
    }
    byOrder.set(itemId, current);
    itemMap.set(orderId, byOrder);
  }

  return rows.map((row) => {
    const items = Array.from(itemMap.get(Number(row.id))?.values() ?? []);
    const productos = items
      .map((item) => item.sabores.length ? `${item.texto} (${item.sabores.join(", ")})` : item.texto)
      .join(" | ");
    return {
      id: Number(row.id),
      fecha: formatBuenosAiresDateTime(String(row.fecha)),
      canal: row.canal,
      estado: row.estado,
      cliente: row.cliente,
      email: row.email,
      sucursal: row.sucursal || "-",
      metodo_pago: [row.proveedor, row.metodo].filter(Boolean).join(" / ") || "-",
      total_dinero: Number(row.total_dinero ?? 0),
      total_puntos: Number(row.total_puntos ?? 0),
      total_unidades: items.reduce((acc, item) => acc + item.cantidad, 0),
      productos,
      notas: row.notas ?? "",
    };
  });
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function money(value: number): string {
  return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" }).format(Number(value ?? 0));
}

function pdfText(value: unknown): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

export function renderVentasPdfBuffer(rows: VentaReporteRow[]): Promise<Buffer> {
  const total = rows.reduce((acc, row) => acc + row.total_dinero, 0);
  const generadoEn = formatBuenosAiresDateTime(new Date());

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      layout: "landscape",
      margin: 24,
      info: {
        Title: "Reporte de ventas",
        Subject: "Ventas web y locales",
        Author: "Nande Alfajores Correntinos",
      },
    });
    const chunks: Buffer[] = [];

    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const columns = [
      { label: "Orden", width: 42, value: (row: VentaReporteRow) => `#${row.id}` },
      { label: "Fecha", width: 78, value: (row: VentaReporteRow) => row.fecha },
      { label: "Canal", width: 48, value: (row: VentaReporteRow) => row.canal },
      { label: "Estado", width: 62, value: (row: VentaReporteRow) => row.estado },
      { label: "Cliente", width: 96, value: (row: VentaReporteRow) => row.cliente },
      { label: "Sucursal", width: 82, value: (row: VentaReporteRow) => row.sucursal },
      { label: "Pago", width: 88, value: (row: VentaReporteRow) => row.metodo_pago },
      { label: "Unid.", width: 34, value: (row: VentaReporteRow) => String(row.total_unidades), align: "right" as const },
      { label: "Total", width: 70, value: (row: VentaReporteRow) => money(row.total_dinero), align: "right" as const },
      { label: "Productos", width: 184, value: (row: VentaReporteRow) => row.productos },
    ];

    const left = doc.page.margins.left;
    const rightLimit = doc.page.width - doc.page.margins.right;
    const bottomLimit = doc.page.height - doc.page.margins.bottom;
    const tableWidth = columns.reduce((acc, column) => acc + column.width, 0);
    const headerHeight = 18;

    function drawReportHeader() {
      doc
        .font("Helvetica-Bold")
        .fontSize(18)
        .fillColor("#7a3b0c")
        .text("Reporte de ventas", left, 24, { width: rightLimit - left });

      doc
        .font("Helvetica")
        .fontSize(9)
        .fillColor("#755236")
        .text("Ventas web y locales registradas en el sistema.", left, 47)
        .text(`Horario Argentina, Buenos Aires. Generado: ${generadoEn}`, left, 61);

      doc
        .roundedRect(left, 80, tableWidth, 24, 2)
        .fillAndStroke("#fff4e8", "#e3c7ad")
        .fillColor("#2b1606")
        .font("Helvetica-Bold")
        .fontSize(9)
        .text(`Total: ${money(total)}    Ordenes: ${rows.length}`, left + 8, 88);
    }

    function drawTableHeader(y: number): number {
      doc.rect(left, y, tableWidth, headerHeight).fillAndStroke("#f8ead9", "#e3c7ad");
      let x = left;
      doc.font("Helvetica-Bold").fontSize(7).fillColor("#6b2e08");
      for (const column of columns) {
        doc.text(column.label, x + 3, y + 5, { width: column.width - 6 });
        doc.moveTo(x, y).lineTo(x, y + headerHeight).strokeColor("#e3c7ad").stroke();
        x += column.width;
      }
      doc.moveTo(left + tableWidth, y).lineTo(left + tableWidth, y + headerHeight).strokeColor("#e3c7ad").stroke();
      return y + headerHeight;
    }

    function newTablePage(): number {
      doc.addPage();
      return drawTableHeader(doc.page.margins.top);
    }

    drawReportHeader();
    let y = drawTableHeader(116);

    if (!rows.length) {
      doc.font("Helvetica").fontSize(9).fillColor("#2b1606").text("Sin ventas para mostrar.", left + 6, y + 8);
      doc.end();
      return;
    }

    rows.forEach((row, index) => {
      doc.font("Helvetica").fontSize(7).fillColor("#2b1606");
      const rowValues = columns.map((column) => pdfText(column.value(row)));
      const rowHeight = Math.max(
        20,
        ...rowValues.map((value, columnIndex) =>
          doc.heightOfString(value || "-", { width: columns[columnIndex].width - 6, align: columns[columnIndex].align ?? "left" }) + 10,
        ),
      );

      if (y + rowHeight > bottomLimit) {
        y = newTablePage();
      }

      if (index % 2 === 1) {
        doc.rect(left, y, tableWidth, rowHeight).fill("#fffaf5");
      }

      doc.rect(left, y, tableWidth, rowHeight).strokeColor("#e3c7ad").stroke();
      let x = left;
      rowValues.forEach((value, columnIndex) => {
        const column = columns[columnIndex];
        doc
          .fillColor("#2b1606")
          .font("Helvetica")
          .fontSize(7)
          .text(value || "-", x + 3, y + 5, {
            width: column.width - 6,
            align: column.align ?? "left",
          });
        doc.moveTo(x, y).lineTo(x, y + rowHeight).strokeColor("#e3c7ad").stroke();
        x += column.width;
      });
      doc.moveTo(left + tableWidth, y).lineTo(left + tableWidth, y + rowHeight).strokeColor("#e3c7ad").stroke();
      y += rowHeight;
    });

    doc.end();
  });
}

function renderTableRows(rows: VentaReporteRow[]): string {
  return rows.map((row) => `
    <tr>
      <td>#${escapeHtml(row.id)}</td>
      <td>${escapeHtml(row.fecha)}</td>
      <td>${escapeHtml(row.canal)}</td>
      <td>${escapeHtml(row.estado)}</td>
      <td>${escapeHtml(row.cliente)}</td>
      <td>${escapeHtml(row.email)}</td>
      <td>${escapeHtml(row.sucursal)}</td>
      <td>${escapeHtml(row.metodo_pago)}</td>
      <td>${escapeHtml(row.total_unidades)}</td>
      <td>${escapeHtml(money(row.total_dinero))}</td>
      <td>${escapeHtml(row.productos)}</td>
      <td>${escapeHtml(row.notas)}</td>
    </tr>
  `).join("");
}

export async function renderVentasExcelBuffer(rows: VentaReporteRow[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Nande Alfajores Correntinos";
  workbook.created = new Date();

  const sheet = workbook.addWorksheet("Ventas", {
    views: [{ state: "frozen", ySplit: 1 }],
  });

  sheet.columns = [
    { header: "Orden", key: "orden", width: 10 },
    { header: "Fecha", key: "fecha", width: 20 },
    { header: "Canal", key: "canal", width: 16 },
    { header: "Estado", key: "estado", width: 18 },
    { header: "Cliente", key: "cliente", width: 28 },
    { header: "Email", key: "email", width: 34 },
    { header: "Sucursal", key: "sucursal", width: 24 },
    { header: "Pago", key: "pago", width: 24 },
    { header: "Unidades", key: "unidades", width: 12 },
    { header: "Total", key: "total", width: 16 },
    { header: "Productos", key: "productos", width: 58 },
    { header: "Notas", key: "notas", width: 32 },
  ];

  sheet.getRow(1).eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FF6B2E08" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF8EAD9" } };
    cell.border = { bottom: { style: "thin", color: { argb: "FFE3C7AD" } } };
  });

  rows.forEach((row) => {
    sheet.addRow({
      orden: row.id,
      fecha: row.fecha,
      canal: row.canal,
      estado: row.estado,
      cliente: row.cliente,
      email: row.email,
      sucursal: row.sucursal,
      pago: row.metodo_pago,
      unidades: row.total_unidades,
      total: row.total_dinero,
      productos: row.productos,
      notas: row.notas,
    });
  });

  sheet.getColumn("total").numFmt = '"$"#,##0.00';
  sheet.eachRow((row, rowNumber) => {
    row.eachCell((cell) => {
      cell.alignment = {
        vertical: "top",
        wrapText: rowNumber > 1,
      };
    });
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
}

export function renderVentasPrintableHtml(rows: VentaReporteRow[]): string {
  const total = rows.reduce((acc, row) => acc + row.total_dinero, 0);
  const generadoEn = formatBuenosAiresDateTime(new Date());
  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <title>Reporte de ventas</title>
  <style>
    body { font-family: Arial, sans-serif; color: #2b1606; margin: 24px; }
    h1 { margin: 0 0 8px; color: #7a3b0c; }
    p { margin: 0 0 16px; color: #755236; }
    .meta { font-size: 12px; color: #8b5a30; margin-top: -6px; }
    table { border-collapse: collapse; width: 100%; font-size: 12px; }
    th, td { border: 1px solid #e3c7ad; padding: 8px; text-align: left; vertical-align: top; }
    th { background: #f8ead9; color: #6b2e08; }
    .summary { margin: 16px 0; padding: 12px; background: #fff4e8; border: 1px solid #e3c7ad; }
    @media print { button { display: none; } body { margin: 12mm; } }
  </style>
</head>
<body>
  <button onclick="window.print()">Imprimir / guardar PDF</button>
  <h1>Reporte de ventas</h1>
  <p>Ventas web y locales registradas en el sistema.</p>
  <p class="meta">Horario Argentina, Buenos Aires. Generado: ${escapeHtml(generadoEn)}</p>
  <div class="summary"><strong>Total:</strong> ${escapeHtml(money(total))} &nbsp; <strong>Ordenes:</strong> ${rows.length}</div>
  <table>
    <thead>
      <tr>
        <th>Orden</th><th>Fecha</th><th>Canal</th><th>Estado</th><th>Cliente</th><th>Email</th>
        <th>Sucursal</th><th>Pago</th><th>Unidades</th><th>Total</th><th>Productos</th><th>Notas</th>
      </tr>
    </thead>
    <tbody>${renderTableRows(rows) || `<tr><td colspan="12">Sin ventas para mostrar.</td></tr>`}</tbody>
  </table>
</body>
</html>`;
}

export function renderVentasExcelHtml(rows: VentaReporteRow[]): string {
  return `\ufeff<!doctype html>
<html lang="es">
<head><meta charset="utf-8" /></head>
<body>
  <table>
    <thead>
      <tr>
        <th>Orden</th><th>Fecha</th><th>Canal</th><th>Estado</th><th>Cliente</th><th>Email</th>
        <th>Sucursal</th><th>Pago</th><th>Unidades</th><th>Total</th><th>Productos</th><th>Notas</th>
      </tr>
    </thead>
    <tbody>${renderTableRows(rows)}</tbody>
  </table>
</body>
</html>`;
}
