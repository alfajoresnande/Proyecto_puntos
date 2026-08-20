import { lazy, Suspense, useEffect, useState } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { api } from "./api";
import { Footer } from "./components/Footer";
import { FloatingWhatsApp } from "./components/FloatingWhatsApp";
import { AiChatWidget } from "./components/AiChatWidget";
import { AppPresenceTracker } from "./components/AppPresenceTracker";
import { EventBar } from "./components/EventBar";
import { Navbar } from "./components/Navbar";
import { ProfileCompletionBanner } from "./components/ProfileCompletionBanner";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { RealtimeBridge } from "./components/RealtimeBridge";
import { SeoRouteMeta } from "./components/SeoRouteMeta";
import { scrollPageToTop } from "./lib/scrollTop";
import { usePointsEnabled } from "./lib/pointsProgram";
import { AppVersionChecker } from "./components/AppVersionChecker";
const Admin = lazy(() => import("./pages/admin/Admin").then((module) => ({ default: module.Admin })));
const EnviosAdmin = lazy(() => import("./pages/admin/EnviosAdmin").then((module) => ({ default: module.EnviosAdmin })));
const SucursalesAdmin = lazy(() => import("./pages/admin/SucursalesAdmin").then((module) => ({ default: module.SucursalesAdmin })));
const ForgotPassword = lazy(() => import("./pages/auth/ForgotPassword").then((module) => ({ default: module.ForgotPassword })));
const Login = lazy(() => import("./pages/auth/Login").then((module) => ({ default: module.Login })));
const Registro = lazy(() => import("./pages/auth/Registro").then((module) => ({ default: module.Registro })));
const ResetPassword = lazy(() => import("./pages/auth/ResetPassword").then((module) => ({ default: module.ResetPassword })));
const Cliente = lazy(() => import("./pages/cliente/Cliente").then((module) => ({ default: module.Cliente })));
const CarritoTienda = lazy(() => import("./pages/cliente/CarritoTienda").then((module) => ({ default: module.CarritoTienda })));
const ConfirmarCanje = lazy(() => import("./pages/cliente/ConfirmarCanje").then((module) => ({ default: module.ConfirmarCanje })));
const MisCanjes = lazy(() => import("./pages/cliente/MisCanjes").then((module) => ({ default: module.MisCanjes })));
const ComprobanteCanje = lazy(() => import("./pages/cliente/ComprobanteCanje").then((module) => ({ default: module.ComprobanteCanje })));
const MisDirecciones = lazy(() => import("./pages/cliente/MisDirecciones").then((module) => ({ default: module.MisDirecciones })));
const MisPedidos = lazy(() => import("./pages/cliente/MisPedidos").then((module) => ({ default: module.MisPedidos })));
const ComprobantePedido = lazy(() => import("./pages/cliente/ComprobantePedido").then((module) => ({ default: module.ComprobantePedido })));
const MiPerfil = lazy(() => import("./pages/cliente/MiPerfil").then((module) => ({ default: module.MiPerfil })));
const SoporteCliente = lazy(() => import("./pages/cliente/SoporteCliente").then((module) => ({ default: module.SoporteCliente })));
const Catalogo = lazy(() => import("./pages/public/Catalogo").then((module) => ({ default: module.Catalogo })));
const Home = lazy(() => import("./pages/public/Home").then((module) => ({ default: module.Home })));
const BotonArrepentimiento = lazy(() => import("./pages/public/BotonArrepentimiento").then((module) => ({ default: module.BotonArrepentimiento })));
const PoliticaPrivacidad = lazy(() => import("./pages/public/PoliticaPrivacidad").then((module) => ({ default: module.PoliticaPrivacidad })));
const SobreNosotros = lazy(() => import("./pages/public/SobreNosotros").then((module) => ({ default: module.SobreNosotros })));
const TiendaOnline = lazy(() => import("./pages/public/TiendaOnline").then((module) => ({ default: module.TiendaOnline })));
const Terminos = lazy(() => import("./pages/public/Terminos").then((module) => ({ default: module.Terminos })));
const SoporteStaff = lazy(() => import("./pages/staff/SoporteStaff").then((module) => ({ default: module.SoporteStaff })));
const ComprobantePedidoVendedor = lazy(() => import("./pages/vendedor/ComprobantePedidoVendedor").then((module) => ({ default: module.ComprobantePedidoVendedor })));
const PedidosMapa = lazy(() => import("./pages/vendedor/PedidosMapa").then((module) => ({ default: module.PedidosMapa })));
const Vendedor = lazy(() => import("./pages/vendedor/Vendedor").then((module) => ({ default: module.Vendedor })));
const VendedorPedidos = lazy(() => import("./pages/vendedor/VendedorPedidos").then((module) => ({ default: module.VendedorPedidos })));

function ScrollToTop() {
  const { pathname, search } = useLocation();

  useEffect(() => {
    scrollPageToTop("auto");
  }, [pathname, search]);

  useEffect(() => {
    function onInternalNavigationClick(event: MouseEvent) {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.altKey || event.ctrlKey || event.shiftKey) {
        return;
      }

      const target = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null;
      if (!target || target.target && target.target !== "_self" || target.hasAttribute("download")) return;

      const href = target.getAttribute("href");
      if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) return;

      const nextUrl = new URL(href, window.location.href);
      if (nextUrl.origin !== window.location.origin) return;
      if (nextUrl.hash && nextUrl.pathname === window.location.pathname && nextUrl.search === window.location.search) return;

      scrollPageToTop();
    }

    document.addEventListener("click", onInternalNavigationClick);
    return () => document.removeEventListener("click", onInternalNavigationClick);
  }, []);

  return null;
}

function NumberInputGuards() {
  useEffect(() => {
    function isNumberInput(target: EventTarget | null): target is HTMLInputElement {
      return target instanceof HTMLInputElement && target.type === "number";
    }

    function onWheel(event: WheelEvent) {
      if (!isNumberInput(event.target) || document.activeElement !== event.target) return;
      event.preventDefault();
    }

    function onKeyDown(event: KeyboardEvent) {
      if (!isNumberInput(event.target)) return;
      if (event.key === "ArrowUp" || event.key === "ArrowDown") {
        event.preventDefault();
      }
    }

    function onBeforeInput(event: InputEvent) {
      if (!isNumberInput(event.target) || !event.data) return;
      if (/[eE+-]/.test(event.data)) {
        event.preventDefault();
      }
    }

    function onInput(event: Event) {
      if (!isNumberInput(event.target)) return;
      const input = event.target;
      if (input.value === "") return;

      const numeric = Number(input.value);
      if (!Number.isFinite(numeric)) {
        input.value = "";
        return;
      }

      if (numeric < 0) {
        input.value = "0";
      }
    }

    document.addEventListener("wheel", onWheel, { capture: true, passive: false });
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("beforeinput", onBeforeInput, true);
    document.addEventListener("input", onInput, true);

    return () => {
      document.removeEventListener("wheel", onWheel, true);
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("beforeinput", onBeforeInput, true);
      document.removeEventListener("input", onInput, true);
    };
  }, []);

  return null;
}

/**
 * Envuelve las rutas del programa de puntos: si el superAdmin lo apagó,
 * redirige a la tienda. Mientras el estado carga (null) renderiza normal
 * para no cortar la navegación con un flash de redirect.
 */
function PointsRoute({ children, to = "/tienda" }: { children: JSX.Element; to?: string }) {
  const pointsEnabled = usePointsEnabled();
  if (pointsEnabled === false) return <Navigate to={to} replace />;
  return children;
}

function RouteLoading() {
  return (
    <div
      role="status"
      aria-live="polite"
      style={{ minHeight: "40vh", display: "grid", placeItems: "center", padding: "2rem" }}
    >
      Cargando...
    </div>
  );
}

export default function App() {
  const [chatbotEnabled, setChatbotEnabled] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .get<{ enabled: boolean }>("/ai/status")
      .then((data) => {
        if (!cancelled) setChatbotEnabled(data.enabled);
      })
      .catch(() => {
        if (!cancelled) setChatbotEnabled(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <>
      <RealtimeBridge />
      <SeoRouteMeta />
      <AppVersionChecker />
      <ScrollToTop />
      <NumberInputGuards />
      <AppPresenceTracker />
      <EventBar />
      <Navbar />
      <div className="app-main">
        <ProfileCompletionBanner />
        <main>
          <Suspense fallback={<RouteLoading />}>
            <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/inicio" element={<Navigate to="/" replace />} />
            <Route path="/catalogo" element={<PointsRoute><Catalogo /></PointsRoute>} />
            <Route path="/tienda" element={<TiendaOnline />} />
            <Route path="/login" element={<Login />} />
            <Route path="/registro" element={<Registro />} />
            <Route path="/forgot-password" element={<ForgotPassword />} />
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route
              path="/cliente"
              element={
                <PointsRoute>
                  <ProtectedRoute rol="cliente">
                    <Cliente />
                  </ProtectedRoute>
                </PointsRoute>
              }
            />
            <Route
              path="/mi-perfil"
              element={
                <ProtectedRoute rol="cliente">
                  <MiPerfil />
                </ProtectedRoute>
              }
            />
            <Route
              path="/mis-canjes"
              element={
                <PointsRoute>
                  <ProtectedRoute rol="cliente">
                    <MisCanjes />
                  </ProtectedRoute>
                </PointsRoute>
              }
            />
            <Route
              path="/mis-canjes/:id"
              element={
                <PointsRoute>
                  <ProtectedRoute rol="cliente">
                    <ComprobanteCanje />
                  </ProtectedRoute>
                </PointsRoute>
              }
            />
            <Route
              path="/mis-direcciones"
              element={
                <ProtectedRoute rol="cliente">
                  <MisDirecciones />
                </ProtectedRoute>
              }
            />
            <Route
              path="/carrito-canjes"
              element={
                <PointsRoute>
                  <ProtectedRoute rol="cliente">
                    <ConfirmarCanje />
                  </ProtectedRoute>
                </PointsRoute>
              }
            />
            <Route
              path="/carrito-tienda"
              element={
                <ProtectedRoute rol="cliente">
                  <CarritoTienda />
                </ProtectedRoute>
              }
            />
            <Route
              path="/mis-pedidos"
              element={
                <ProtectedRoute rol="cliente">
                  <MisPedidos />
                </ProtectedRoute>
              }
            />
            <Route
              path="/mis-pedidos/:id"
              element={
                <ProtectedRoute rol="cliente">
                  <ComprobantePedido />
                </ProtectedRoute>
              }
            />
            <Route
              path="/soporte"
              element={
                <ProtectedRoute rol="cliente">
                  <SoporteCliente />
                </ProtectedRoute>
              }
            />
            <Route path="/confirmar-canje" element={<Navigate to="/carrito-canjes" replace />} />
            <Route
              path="/staff/soporte"
              element={
                <ProtectedRoute rol={["vendedor", "admin", "superAdmin"]}>
                  <SoporteStaff />
                </ProtectedRoute>
              }
            />
            <Route
              path="/vendedor"
              element={
                <PointsRoute to="/vendedor/ventas/pedidos">
                  <ProtectedRoute rol={["vendedor", "admin", "superAdmin"]}>
                    <Vendedor />
                  </ProtectedRoute>
                </PointsRoute>
              }
            />
            <Route path="/vendedor/ventas" element={<Navigate to="/vendedor/ventas/pedidos" replace />} />
            <Route
              path="/vendedor/pedidos"
              element={<Navigate to="/vendedor/ventas/pedidos" replace />}
            />
            <Route
              path="/vendedor/ventas/:ventasPage"
              element={
                <ProtectedRoute rol={["vendedor", "admin", "superAdmin"]}>
                  <VendedorPedidos />
                </ProtectedRoute>
              }
            />
            <Route
              path="/vendedor/mapa-pedidos"
              element={
                <ProtectedRoute rol={["vendedor", "admin", "superAdmin"]}>
                  <PedidosMapa />
                </ProtectedRoute>
              }
            />
            <Route
              path="/vendedor/envios"
              element={
                <ProtectedRoute rol={["vendedor", "admin", "superAdmin"]}>
                  <EnviosAdmin />
                </ProtectedRoute>
              }
            />
            <Route
              path="/vendedor/pedidos/:id"
              element={
                <ProtectedRoute rol={["vendedor", "admin", "superAdmin"]}>
                  <ComprobantePedidoVendedor />
                </ProtectedRoute>
              }
            />
            <Route
              path="/admin/pedidos/:id"
              element={
                <ProtectedRoute rol={["admin", "superAdmin"]}>
                  <ComprobantePedidoVendedor />
                </ProtectedRoute>
              }
            />
            <Route
              path="/superadmin/pedidos/:id"
              element={
                <ProtectedRoute rol="superAdmin">
                  <ComprobantePedidoVendedor />
                </ProtectedRoute>
              }
            />
            <Route
              path="/admin/sucursales"
              element={
                <ProtectedRoute rol={["admin", "superAdmin"]}>
                  <SucursalesAdmin />
                </ProtectedRoute>
              }
            />
            <Route
              path="/superadmin/sucursales"
              element={
                <ProtectedRoute rol="superAdmin">
                  <SucursalesAdmin />
                </ProtectedRoute>
              }
            />
            <Route
              path="/admin/envios"
              element={
                <ProtectedRoute rol={["admin", "superAdmin"]}>
                  <EnviosAdmin />
                </ProtectedRoute>
              }
            />
            <Route
              path="/admin/mapa-pedidos"
              element={
                <ProtectedRoute rol={["admin", "superAdmin"]}>
                  <PedidosMapa />
                </ProtectedRoute>
              }
            />
            <Route
              path="/superadmin/envios"
              element={
                <ProtectedRoute rol="superAdmin">
                  <EnviosAdmin />
                </ProtectedRoute>
              }
            />
            <Route
              path="/superadmin/mapa-pedidos"
              element={
                <ProtectedRoute rol="superAdmin">
                  <PedidosMapa />
                </ProtectedRoute>
              }
            />
            <Route path="/admin/ventas" element={<Navigate to="/admin/ventas/pedidos" replace />} />
            <Route
              path="/admin/productos"
              element={
                <ProtectedRoute rol={["admin", "superAdmin"]}>
                  <Admin />
                </ProtectedRoute>
              }
            />
            <Route
              path="/admin/productos/:productosPage"
              element={
                <ProtectedRoute rol={["admin", "superAdmin"]}>
                  <Admin />
                </ProtectedRoute>
              }
            />
            <Route
              path="/admin/caja"
              element={
                <ProtectedRoute rol={["admin", "superAdmin"]}>
                  <Admin />
                </ProtectedRoute>
              }
            />
            <Route
              path="/admin/gastos"
              element={
                <ProtectedRoute rol={["admin", "superAdmin"]}>
                  <Admin />
                </ProtectedRoute>
              }
            />
            <Route
              path="/admin/proveedores"
              element={
                <ProtectedRoute rol={["admin", "superAdmin"]}>
                  <Admin />
                </ProtectedRoute>
              }
            />
            <Route
              path="/admin/cobros"
              element={
                <ProtectedRoute rol={["admin", "superAdmin"]}>
                  <Admin />
                </ProtectedRoute>
              }
            />
            <Route
              path="/admin/descuentos"
              element={
                <ProtectedRoute rol={["admin", "superAdmin"]}>
                  <Admin />
                </ProtectedRoute>
              }
            />
            <Route
              path="/admin/postulaciones"
              element={
                <ProtectedRoute rol={["admin", "superAdmin"]}>
                  <Admin />
                </ProtectedRoute>
              }
            />
            <Route
              path="/admin/personas-app"
              element={
                <ProtectedRoute rol={["admin", "superAdmin"]}>
                  <Admin />
                </ProtectedRoute>
              }
            />
            <Route
              path="/admin/cumpleanos"
              element={
                <ProtectedRoute rol={["admin", "superAdmin"]}>
                  <Admin />
                </ProtectedRoute>
              }
            />
            <Route
              path="/admin/ventas/:ventasPage"
              element={
                <ProtectedRoute rol={["admin", "superAdmin"]}>
                  <Admin />
                </ProtectedRoute>
              }
            />
            <Route path="/superadmin/ventas" element={<Navigate to="/superadmin/ventas/pedidos" replace />} />
            <Route
              path="/superadmin/productos"
              element={
                <ProtectedRoute rol="superAdmin">
                  <Admin />
                </ProtectedRoute>
              }
            />
            <Route
              path="/superadmin/productos/:productosPage"
              element={
                <ProtectedRoute rol="superAdmin">
                  <Admin />
                </ProtectedRoute>
              }
            />
            <Route
              path="/superadmin/caja"
              element={
                <ProtectedRoute rol="superAdmin">
                  <Admin />
                </ProtectedRoute>
              }
            />
            <Route
              path="/superadmin/gastos"
              element={
                <ProtectedRoute rol="superAdmin">
                  <Admin />
                </ProtectedRoute>
              }
            />
            <Route
              path="/superadmin/proveedores"
              element={
                <ProtectedRoute rol="superAdmin">
                  <Admin />
                </ProtectedRoute>
              }
            />
            <Route
              path="/superadmin/cobros"
              element={
                <ProtectedRoute rol="superAdmin">
                  <Admin />
                </ProtectedRoute>
              }
            />
            <Route
              path="/superadmin/descuentos"
              element={
                <ProtectedRoute rol="superAdmin">
                  <Admin />
                </ProtectedRoute>
              }
            />
            <Route
              path="/superadmin/postulaciones"
              element={
                <ProtectedRoute rol="superAdmin">
                  <Admin />
                </ProtectedRoute>
              }
            />
            <Route
              path="/superadmin/personas-app"
              element={
                <ProtectedRoute rol="superAdmin">
                  <Admin />
                </ProtectedRoute>
              }
            />
            <Route
              path="/superadmin/cumpleanos"
              element={
                <ProtectedRoute rol="superAdmin">
                  <Admin />
                </ProtectedRoute>
              }
            />
            <Route
              path="/superadmin/ventas/:ventasPage"
              element={
                <ProtectedRoute rol="superAdmin">
                  <Admin />
                </ProtectedRoute>
              }
            />
            <Route
              path="/admin"
              element={
                <ProtectedRoute rol={["admin", "superAdmin"]}>
                  <Admin />
                </ProtectedRoute>
              }
            />
            <Route
              path="/superadmin"
              element={
                <ProtectedRoute rol="superAdmin">
                  <Admin />
                </ProtectedRoute>
              }
            />
            <Route path="/sobre-nosotros" element={<SobreNosotros />} />
            <Route path="/terminos" element={<Terminos />} />
            <Route path="/politica-privacidad" element={<PoliticaPrivacidad />} />
            <Route path="/boton-arrepentimiento" element={<BotonArrepentimiento />} />
            <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
        </main>
        <Footer />
      </div>
      {chatbotEnabled === true ? <AiChatWidget /> : null}
      {chatbotEnabled === false ? <FloatingWhatsApp /> : null}
    </>
  );
}
