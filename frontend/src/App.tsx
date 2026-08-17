import { useEffect, useState } from "react";
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
import { Admin } from "./pages/admin/Admin";
import { EnviosAdmin } from "./pages/admin/EnviosAdmin";
import { SucursalesAdmin } from "./pages/admin/SucursalesAdmin";
import { ForgotPassword } from "./pages/auth/ForgotPassword";
import { Login } from "./pages/auth/Login";
import { Registro } from "./pages/auth/Registro";
import { ResetPassword } from "./pages/auth/ResetPassword";
import { Cliente } from "./pages/cliente/Cliente";
import { CarritoTienda } from "./pages/cliente/CarritoTienda";
import { ConfirmarCanje } from "./pages/cliente/ConfirmarCanje";
import { MisCanjes } from "./pages/cliente/MisCanjes";
import { ComprobanteCanje } from "./pages/cliente/ComprobanteCanje";
import { MisDirecciones } from "./pages/cliente/MisDirecciones";
import { MisPedidos } from "./pages/cliente/MisPedidos";
import { ComprobantePedido } from "./pages/cliente/ComprobantePedido";
import { MiPerfil } from "./pages/cliente/MiPerfil";
import { SoporteCliente } from "./pages/cliente/SoporteCliente";
import { Catalogo } from "./pages/public/Catalogo";
import { Home } from "./pages/public/Home";
import { BotonArrepentimiento } from "./pages/public/BotonArrepentimiento";
import { PoliticaPrivacidad } from "./pages/public/PoliticaPrivacidad";
import { SobreNosotros } from "./pages/public/SobreNosotros";
import { TiendaOnline } from "./pages/public/TiendaOnline";
import { Terminos } from "./pages/public/Terminos";
import { SoporteStaff } from "./pages/staff/SoporteStaff";
import { ComprobantePedidoVendedor } from "./pages/vendedor/ComprobantePedidoVendedor";
import { PedidosMapa } from "./pages/vendedor/PedidosMapa";
import { Vendedor } from "./pages/vendedor/Vendedor";
import { VendedorPedidos } from "./pages/vendedor/VendedorPedidos";

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
        </main>
        <Footer />
      </div>
      {chatbotEnabled === true ? <AiChatWidget /> : null}
      {chatbotEnabled === false ? <FloatingWhatsApp /> : null}
    </>
  );
}
