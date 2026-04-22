import Alpine from "alpinejs";
import { marked } from "marked";
import { api } from "./api.js";
import "./styles.css";
import "./login.css";
import "./layout.css";
import "./catalog.css";
import "./admin.css";

// ── Importar vistas como HTML crudo ──────────────────────────────
import catalogHtml       from "./views/catalog.html?raw";
import loginHtml         from "./views/login.html?raw";
import registroHtml      from "./views/registro.html?raw";
import clienteHtml       from "./views/cliente.html?raw";
import vendedorHtml      from "./views/vendedor.html?raw";
import adminHtml         from "./views/admin.html?raw";
import sobreNosotrosHtml from "./views/sobre-nosotros.html?raw";
import terminosHtml      from "./views/terminos.html?raw";

// Mapa ruta → HTML: solo se inyecta la vista activa en cada navegación
const viewMap = {
  "/":              catalogHtml,
  "/login":         loginHtml,
  "/registro":      registroHtml,
  "/cliente":       clienteHtml,
  "/vendedor":      vendedorHtml,
  "/admin":         adminHtml,
  "/sobre-nosotros": sobreNosotrosHtml,
  "/terminos":      terminosHtml,
};

window.Alpine = Alpine;

// ── Configurar marked (markdown renderer) ─────────────────────────
marked.setOptions({ breaks: true, gfm: true });

// ── Decodificar JWT payload (sin verificar firma — solo para UI) ───
function getTokenExpiry() {
  const t = localStorage.getItem("token");
  if (!t) return null;
  try {
    const payload = JSON.parse(atob(t.split(".")[1]));
    return payload.exp ? payload.exp * 1000 : null;
  } catch { return null; }
}

Alpine.store("auth", {
  user: JSON.parse(localStorage.getItem("user") || "null"),
  loading: false,
  error: "",

  persist(user, tokenValue) {
    if (user) {
      localStorage.setItem("user", JSON.stringify(user));
      if (tokenValue) localStorage.setItem("token", tokenValue);
    } else {
      localStorage.removeItem("user");
      localStorage.removeItem("token");
    }
    this.user = user;
  },

  async login(email, password) {
    this.loading = true;
    this.error = "";
    try {
      const { token, user } = await api.post("/auth/login", { email, password });
      this.persist(user, token);
      scheduleSessionExpiry();
      navigate(defaultRouteFor(user.rol));
    } catch (e) {
      this.error = e.message;
    } finally {
      this.loading = false;
    }
  },

  async register(data) {
    this.loading = true;
    this.error = "";
    try {
      const { token, user } = await api.post("/auth/register", data);
      this.persist(user, token);
      scheduleSessionExpiry();
      navigate("/cliente");
    } catch (e) {
      this.error = e.message;
    } finally {
      this.loading = false;
    }
  },

  logout() {
    this.persist(null);
    navigate("/login");
  },
});

Alpine.store("router", {
  current: "/login",
});

function parseHash() {
  const h = location.hash.slice(1) || "/";
  return h.startsWith("/") ? h : "/" + h;
}

function defaultRouteFor(rol) {
  if (rol === "vendedor") return "/vendedor";
  if (rol === "admin") return "/admin";
  return "/cliente";
}

function navigate(path) {
  if (location.hash !== "#" + path) location.hash = path;
  else applyRoute();
}

// ── Sesión: auto-logout cuando expira el JWT ──────────────────────
let sessionTimer = null;
function scheduleSessionExpiry() {
  if (sessionTimer) clearTimeout(sessionTimer);
  const exp = getTokenExpiry();
  if (!exp) return;
  const ms = exp - Date.now();
  if (ms <= 0) {
    Alpine.store("auth").logout();
    return;
  }
  sessionTimer = setTimeout(() => {
    Alpine.store("auth").logout();
    alert("Tu sesión expiró. Iniciá sesión nuevamente.");
  }, ms);
}

// Verificar token al cargar si ya había sesión
if (Alpine.store("auth").user) scheduleSessionExpiry();

function setView(path) {
  Alpine.store("router").current = path;
  const outlet = document.getElementById("views-outlet");
  if (outlet) outlet.innerHTML = viewMap[path] || "";
}

function applyRoute() {
  const path = parseHash();
  const user = Alpine.store("auth").user;

  // Rutas públicas: no requieren autenticación
  const publicRoutes = ["/", "/sobre-nosotros", "/terminos"];
  if (publicRoutes.includes(path)) { setView(path); return; }

  const authOnlyRoutes = ["/login", "/registro"];
  const rolRoutes = {
    cliente:  ["/cliente"],
    vendedor: ["/vendedor"],
    admin:    ["/admin", "/vendedor"],
  };

  if (!user && !authOnlyRoutes.includes(path)) return (location.hash = "/login");
  if (user && authOnlyRoutes.includes(path))   return (location.hash = defaultRouteFor(user.rol));
  if (user && !rolRoutes[user.rol]?.includes(path)) return (location.hash = defaultRouteFor(user.rol));

  setView(path);
}

window.addEventListener("hashchange", applyRoute);
window.navigate = navigate;

// ---------- Helpers UI ----------

const formatMoney = (n) =>
  (n ?? 0).toLocaleString("es-AR", { minimumFractionDigits: 2 });
const formatDate = (s) =>
  new Date(s).toLocaleString("es-AR", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

// ---------- Componentes ----------

Alpine.data("loginForm", () => ({
  email: "",
  password: "",
  showPassword: false,
  remember: false,
  submit() {
    Alpine.store("auth").login(this.email, this.password);
  },
}));

Alpine.data("registroForm", () => ({
  nombre: "",
  dni: "",
  email: "",
  password: "",
  confirmPassword: "",
  codigoInvitacion: "",
  showPassword: false,
  showConfirmPassword: false,
  localError: "",
  submit() {
    this.localError = "";
    if (this.password !== this.confirmPassword) {
      this.localError = "Las contraseñas no coinciden.";
      return;
    }
    if (this.password.length < 6) {
      this.localError = "La contraseña debe tener al menos 6 caracteres.";
      return;
    }
    Alpine.store("auth").register({
      nombre: this.nombre,
      dni: this.dni,
      email: this.email,
      password: this.password,
      codigo_invitacion_usado: this.codigoInvitacion || null,
    });
  },
}));

Alpine.data("catalogView", () => ({
  productos: [],
  categorias: [],
  categoriaActiva: "",
  maxPuntos: 0,
  puntosMax: 1000,
  loading: true,

  async init() {
    try {
      const [prods, cats] = await Promise.all([
        api.get("/productos"),
        api.get("/productos/categorias"),
      ]);
      this.productos = prods;
      this.categorias = cats;
      // Calcular el máximo de puntos para el slider
      if (prods.length) {
        this.puntosMax = Math.max(...prods.map(p => p.puntos_requeridos));
        // Redondear arriba al siguiente multiplo de 50
        this.puntosMax = Math.ceil(this.puntosMax / 50) * 50;
      }
      this.maxPuntos = this.puntosMax; // slider arranca en el máximo (sin filtrar)
    } catch {
      this.productos = [];
    } finally {
      this.loading = false;
    }
  },

  get productosFiltrados() {
    return this.productos.filter(p => {
      const matchCat = !this.categoriaActiva || p.categoria === this.categoriaActiva;
      const matchPts = Number(this.maxPuntos) >= this.puntosMax || p.puntos_requeridos <= Number(this.maxPuntos);
      return matchCat && matchPts;
    });
  },

  limpiarFiltros() {
    this.categoriaActiva = "";
    this.maxPuntos = this.puntosMax;
  },

  async canjear(producto) {
    if (!Alpine.store("auth").user) {
      navigate("/login");
      return;
    }
    if (!confirm(`¿Querés canjear ${producto.puntos_requeridos} puntos por ${producto.nombre}?`)) return;
    try {
      const resp = await api.post("/cliente/canjear-producto", { producto_id: producto.id });
      alert(`¡Canje exitoso! Tu código de retiro es: ${resp.canje_id || 'generado'}. Revisa "Mis Canjes" en tu perfil.`);
      // Actualizar puntos en el store global
      const user = Alpine.store("auth").user;
      Alpine.store("auth").persist({ ...user, puntos_saldo: resp.nuevo_saldo }, null);
      navigate("/cliente");
    } catch (e) {
      alert(e.message);
    }
  },
}));

Alpine.data("clienteView", () => ({
  me: null,
  movs: [],
  canjes: [],
  loading: true,
  codigoInput: "",
  codigoLoading: false,
  codigoOk: "",
  codigoError: "",
  formatMoney,
  formatDate,

  async init() {
    this.loading = true;
    try {
      const [me, movs, canjes] = await Promise.all([
        api.get("/cliente/me"),
        api.get("/cliente/movimientos"),
        api.get("/cliente/canjes"),
      ]);
      this.me = me;
      this.movs = movs;
      this.canjes = canjes;
    } catch {} finally {
      this.loading = false;
    }
  },

  async canjearCodigo() {
    this.codigoOk = "";
    this.codigoError = "";
    const codigo = this.codigoInput.trim().toUpperCase();
    if (!codigo) {
      this.codigoError = "Ingresá un código.";
      return;
    }
    this.codigoLoading = true;
    try {
      const res = await api.post("/cliente/canjear-codigo", { codigo });
      this.codigoOk = `¡Canjeado! +${res.puntos_ganados} puntos. Nuevo saldo: ${res.nuevo_saldo} pts.`;
      this.codigoInput = "";
      const me = await api.get("/cliente/me");
      this.me = me;
      const user = Alpine.store("auth").user;
      if (user) {
        Alpine.store("auth").persist({ ...user, puntos_saldo: me.puntos_saldo }, null);
      }
      const movs = await api.get("/cliente/movimientos");
      this.movs = movs;
    } catch (e) {
      this.codigoError = e.message || "Código inválido o ya utilizado.";
    } finally {
      this.codigoLoading = false;
    }
  },
}));

Alpine.data("vendedorView", () => ({
  dni: "",
  queryCliente: "",
  resultadosClientes: [],
  descripcion: "",
  cliente: null,
  productos: [],
  filtro: "",
  cart: {},
  error: "",
  ok: "",
  busy: false,
  formatMoney,

  async init() {
    try {
      this.productos = await api.get("/productos");
    } catch (e) {
      this.error = "No pude cargar el catálogo";
    }
  },

  get productosFiltrados() {
    const q = this.filtro.trim().toLowerCase();
    if (!q) return this.productos;
    return this.productos.filter((p) => p.nombre.toLowerCase().includes(q));
  },

  get cartItems() {
    return this.productos
      .filter((p) => this.cart[p.id])
      .map((p) => ({
        ...p,
        cantidad: this.cart[p.id],
        subtotal_puntos: (p.puntos_acumulables || 0) * this.cart[p.id],
      }));
  },

  get totalPuntos() {
    return this.cartItems.reduce((a, i) => a + i.subtotal_puntos, 0);
  },

  add(p) { this.cart = { ...this.cart, [p.id]: (this.cart[p.id] || 0) + 1 }; },
  inc(id) { this.cart = { ...this.cart, [id]: (this.cart[id] || 0) + 1 }; },
  dec(id) {
    const next = (this.cart[id] || 0) - 1;
    const copy = { ...this.cart };
    if (next <= 0) delete copy[id];
    else copy[id] = next;
    this.cart = copy;
  },
  clear() { this.cart = {}; this.descripcion = ""; },

  async buscarClientesRealTime() {
    this.error = ""; this.ok = "";
    const q = this.queryCliente.trim();
    if (q.length < 2) {
      this.resultadosClientes = [];
      return;
    }
    try {
      this.resultadosClientes = await api.get(`/vendedor/clientes/buscar?q=${encodeURIComponent(q)}`);
    } catch (e) {
      this.resultadosClientes = [];
    }
  },

  seleccionarCliente(u) {
    this.cliente = u;
    this.dni = u.dni;
    this.queryCliente = u.nombre;
    this.resultadosClientes = [];
  },

  async buscar() {
    this.error = ""; this.ok = ""; this.cliente = null;
    if (!this.dni) return;
    try { this.cliente = await api.get(`/vendedor/cliente/${this.dni}`); }
    catch (e) { this.error = e.message; }
  },

  async confirmar() {
    this.error = ""; this.ok = "";
    if (!this.cliente) return (this.error = "Buscá primero un cliente por DNI");
    if (this.cartItems.length === 0) return (this.error = "Agregá al menos un producto");
    this.busy = true;
    try {
      const items = Object.entries(this.cart).map(([producto_id, cantidad]) => ({
        producto_id: Number(producto_id), cantidad,
      }));
      const resp = await api.post("/vendedor/cargar", {
        dni: this.cliente.dni, items, descripcion: this.descripcion || undefined,
      });
      this.ok = `+${resp.puntos_acreditados} puntos. Saldo: ${resp.nuevo_saldo}`;
      this.cliente.puntos = resp.nuevo_saldo;
      this.clear();
    } catch (e) {
      this.error = e.message;
    } finally {
      this.busy = false;
    }
  },
}));

Alpine.data("adminView", () => ({
  tab: "inicio",
  stats: null,
  usuarios: [],
  txs: [],
  productos: [],
  paginas: [],
  codigos: [],
  categorias: [],
  canjes: [],
  sobreDraft:    { titulo: "", contenido: "", okMsg: "", errMsg: "", saving: false, imagenUploading: false },
  terminosDraft: { titulo: "", contenido: "", okMsg: "", errMsg: "", saving: false },
  nuevaCategoria: { nombre: "", descripcion: "" },
  nuevoCodigo: { codigo: "", puntos_valor: 0, usos_maximos: 1, fecha_expiracion: "" },
  nuevoUsuario: { email: "", password: "", nombre: "", rol: "vendedor", dni: "" },
  nuevoProducto: {
    nombre: "", descripcion: "", categoria: "",
    puntos_requeridos: 0, puntos_acumulables: null,
    imagen_url: null, imagen_preview: null, imagen_file: null,
  },
  editId: null,
  editDraft: {
    nombre: "", descripcion: "", categoria: "",
    puntos_requeridos: 0, puntos_acumulables: null,
    imagen_url: null, imagen_preview: null, imagen_file: null,
  },
  okMsg: "",
  errMsg: "",
  busy: false,
  formatMoney,
  formatDate,

  get sobreHtml()    { return marked(this.sobreDraft.contenido   || ""); },
  get terminosHtml() { return marked(this.terminosDraft.contenido || ""); },

  async init() {
    await this.refresh();
    await this.loadPaginasEditor();
  },

  async refresh() {
    /* Promise.allSettled: si UNA falla no bloquea el resto */
    const results = await Promise.allSettled([
      api.get("/admin/stats"),
      api.get("/admin/usuarios"),
      api.get("/admin/movimientos"),
      api.get("/admin/productos"),
      api.get("/admin/paginas"),
      api.get("/admin/codigos"),
      api.get("/admin/categorias"),
      api.get("/admin/canjes"),
    ]);
    const ok = (r) => (r.status === "fulfilled" ? r.value : null);
    const [stats, usuarios, txs, productos, paginas, codigos, categorias, canjes] = results.map(ok);
    if (stats)    this.stats    = stats;
    if (usuarios) this.usuarios = usuarios;
    if (txs)      this.txs      = txs;
    if (productos) this.productos = productos;
    if (paginas)  this.paginas  = paginas;
    if (codigos)  this.codigos  = codigos;
    if (categorias) this.categorias = categorias;
    if (canjes)     this.canjes     = canjes;
  },

  async loadPaginasEditor() {
    try {
      const s = await api.get("/admin/paginas/sobre-nosotros");
      this.sobreDraft.titulo   = s.titulo;
      this.sobreDraft.contenido = s.contenido;
    } catch (_) {}
    try {
      const t = await api.get("/admin/paginas/terminos");
      this.terminosDraft.titulo   = t.titulo;
      this.terminosDraft.contenido = t.contenido;
    } catch (_) {}
  },

  async subirImagenSobre(event) {
    const file = event.target.files[0];
    if (!file) return;
    this.sobreDraft.imagenUploading = true;
    this.sobreDraft.errMsg = "";
    try {
      const url = await this.subirImagen(file);
      this.sobreDraft.contenido += `\n\n![imagen](${url})\n`;
    } catch (e) {
      this.sobreDraft.errMsg = "Error al subir imagen.";
    } finally {
      this.sobreDraft.imagenUploading = false;
      event.target.value = "";
    }
  },

  async guardarPaginaSlug(slug, draft) {
    draft.errMsg = ""; draft.okMsg = "";
    draft.saving = true;
    try {
      await api.put(`/admin/paginas/${slug}`, { titulo: draft.titulo, contenido: draft.contenido });
      draft.okMsg = "¡Guardado!";
      setTimeout(() => { draft.okMsg = ""; }, 3000);
    } catch (e) { draft.errMsg = e.message; }
    finally { draft.saving = false; }
  },

  // Previsualiza la imagen seleccionada antes de subir
  seleccionarImagen(event, target) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      if (target === "nuevo") {
        this.nuevoProducto.imagen_file = file;
        this.nuevoProducto.imagen_preview = e.target.result;
      } else {
        this.editDraft.imagen_file = file;
        this.editDraft.imagen_preview = e.target.result;
      }
    };
    reader.readAsDataURL(file);
  },

  // Sube la imagen al servidor y devuelve la URL
  async subirImagen(file) {
    const token = localStorage.getItem("token");
    const form = new FormData();
    form.append("imagen", file);
    const res = await fetch("/api/admin/productos/upload", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || "Error al subir imagen");
    }
    const { url } = await res.json();
    return url;
  },

  async editarPagina(slug) {
    this.paginaEditando = slug;
    const page = await api.get(`/admin/paginas/${slug}`);
    this.paginaDraft = { titulo: page.titulo, contenido: page.contenido };
  },

  get paginaHtml() {
    return marked(this.paginaDraft.contenido || "");
  },

  async guardarPagina() {
    this.okMsg = ""; this.errMsg = "";
    try {
      await api.put(`/admin/paginas/${this.paginaEditando}`, this.paginaDraft);
      this.okMsg = "Página guardada correctamente.";
      this.paginaEditando = null;
      await this.refresh();
    } catch (e) { this.errMsg = e.message; }
  },

  async crearCodigo() {
    this.okMsg = ""; this.errMsg = "";
    const c = this.nuevoCodigo;
    if (!c.codigo.trim()) return (this.errMsg = "El código es obligatorio");
    if (!c.puntos_valor || Number(c.puntos_valor) <= 0) return (this.errMsg = "Los puntos deben ser mayores a 0");
    this.busy = true;
    try {
      await api.post("/admin/codigos", {
        codigo:           c.codigo.trim().toUpperCase(),
        puntos_valor:     Number(c.puntos_valor),
        usos_maximos:     Number(c.usos_maximos) >= 0 ? Number(c.usos_maximos) : 1,
        fecha_expiracion: c.fecha_expiracion ? new Date(c.fecha_expiracion).toISOString() : null,
      });
      this.okMsg = `Código ${c.codigo.toUpperCase()} creado`;
      this.nuevoCodigo = { codigo: "", puntos_valor: 0, usos_maximos: 1, fecha_expiracion: "" };
      await this.refresh();
    } catch (e) { this.errMsg = e.message; }
    finally { this.busy = false; }
  },

  async toggleCodigo(c) {
    try {
      await api.patch(`/admin/codigos/${c.id}`, { activo: !c.activo });
      await this.refresh();
    } catch (e) { this.errMsg = e.message; }
  },

  async crearUsuario() {
    this.okMsg = ""; this.errMsg = ""; this.busy = true;
    try {
      await api.post("/admin/usuarios", {
        ...this.nuevoUsuario,
        dni: this.nuevoUsuario.rol === "cliente" ? this.nuevoUsuario.dni : undefined,
      });
      this.okMsg = "Usuario creado";
      this.nuevoUsuario = { email: "", password: "", nombre: "", rol: "vendedor", dni: "" };
      await this.refresh();
    } catch (e) { this.errMsg = e.message; }
    finally { this.busy = false; }
  },

  async crearCategoria() {
    this.okMsg = ""; this.errMsg = "";
    if (!this.nuevaCategoria.nombre.trim()) return (this.errMsg = "El nombre es obligatorio");
    this.busy = true;
    try {
      await api.post("/admin/categorias", {
        nombre: this.nuevaCategoria.nombre.trim(),
        descripcion: this.nuevaCategoria.descripcion || null
      });
      this.okMsg = "Categoría creada";
      this.nuevaCategoria = { nombre: "", descripcion: "" };
      await this.refresh();
    } catch (e) { this.errMsg = e.message; }
    finally { this.busy = false; }
  },

  async eliminarCategoria(id) {
    if (!confirm("¿Estás seguro de eliminar esta categoría?")) return;
    try {
      await api.delete(`/admin/categorias/${id}`);
      await this.refresh();
    } catch (e) { alert(e.message); }
  },

  async actualizarEstadoCanje(id, estado) {
    if (!confirm(`¿Cambiar estado a ${estado}?`)) return;
    try {
      await api.patch(`/admin/canjes/${id}`, { estado });
      await this.refresh();
    } catch (e) { alert(e.message); }
  },

  async crearProducto() {
    this.okMsg = ""; this.errMsg = "";
    const p = this.nuevoProducto;
    if (!p.nombre.trim()) return (this.errMsg = "El nombre es obligatorio");
    if (!p.puntos_requeridos || p.puntos_requeridos <= 0) return (this.errMsg = "Puntos requeridos debe ser mayor a 0");
    this.busy = true;
    try {
      let imagen_url = p.imagen_url;
      if (p.imagen_file) imagen_url = await this.subirImagen(p.imagen_file);

      await api.post("/admin/productos", {
        nombre:             p.nombre.trim(),
        descripcion:        p.descripcion || null,
        categoria:          p.categoria || null,
        puntos_requeridos:  Number(p.puntos_requeridos),
        puntos_acumulables: p.puntos_acumulables ? Number(p.puntos_acumulables) : null,
        imagen_url:         imagen_url || null,
      });
      this.okMsg = "Producto creado correctamente";
      this.nuevoProducto = {
        nombre: "", descripcion: "", categoria: "",
        puntos_requeridos: 0, puntos_acumulables: null,
        imagen_url: null, imagen_preview: null, imagen_file: null,
      };
      await this.refresh();
    } catch (e) { this.errMsg = e.message; }
    finally { this.busy = false; }
  },

  startEdit(p) {
    this.editId = p.id;
    this.editDraft = {
      nombre:             p.nombre,
      descripcion:        p.descripcion || "",
      categoria:          p.categoria || "",
      puntos_requeridos:  p.puntos_requeridos,
      puntos_acumulables: p.puntos_acumulables,
      imagen_url:         p.imagen_url,
      imagen_preview:     null,
      imagen_file:        null,
    };
  },
  cancelEdit() { this.editId = null; },

  async saveEdit(p) {
    this.errMsg = ""; this.busy = true;
    try {
      let imagen_url = this.editDraft.imagen_url;
      if (this.editDraft.imagen_file) imagen_url = await this.subirImagen(this.editDraft.imagen_file);

      await api.put(`/admin/productos/${p.id}`, {
        nombre:             this.editDraft.nombre.trim(),
        descripcion:        this.editDraft.descripcion || null,
        categoria:          this.editDraft.categoria || null,
        puntos_requeridos:  Number(this.editDraft.puntos_requeridos),
        puntos_acumulables: this.editDraft.puntos_acumulables ? Number(this.editDraft.puntos_acumulables) : null,
        imagen_url:         imagen_url || null,
        activo:             !!p.activo,
      });
      this.editId = null;
      this.okMsg = "Producto actualizado";
      await this.refresh();
    } catch (e) { this.errMsg = e.message; }
    finally { this.busy = false; }
  },

  async toggleActivo(p) {
    try {
      await api.patch(`/admin/productos/${p.id}/activo`, { activo: !p.activo });
      await this.refresh();
    } catch (e) { this.errMsg = e.message; }
  },
}));

Alpine.data("paginaView", () => ({
  slug: "",
  titulo: "",
  contenido: "",
  loading: true,
  error: "",

  get html() {
    return marked(this.contenido || "");
  },

  async init() {
    // Determinar el slug según la ruta actual
    const route = Alpine.store("router").current;
    this.slug = route === "/sobre-nosotros" ? "sobre-nosotros" : "terminos";
    try {
      const page = await api.get(`/paginas/${this.slug}`);
      this.titulo = page.titulo;
      this.contenido = page.contenido;
    } catch (e) {
      this.error = "No se pudo cargar el contenido.";
    } finally {
      this.loading = false;
    }
  },
}));

Alpine.start();
applyRoute();
