import { useEffect } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { Footer } from "./components/Footer";
import { FloatingWhatsApp } from "./components/FloatingWhatsApp";
import { Navbar } from "./components/Navbar";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { RealtimeBridge } from "./components/RealtimeBridge";
import { SeoRouteMeta } from "./components/SeoRouteMeta";
import { scrollPageToTop } from "./lib/scrollTop";
import { Admin } from "./pages/admin/Admin";
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
import { MisPedidos } from "./pages/cliente/MisPedidos";
import { ComprobantePedido } from "./pages/cliente/ComprobantePedido";
import { MiPerfil } from "./pages/cliente/MiPerfil";
import { SoporteCliente } from "./pages/cliente/SoporteCliente";
import { Catalogo } from "./pages/public/Catalogo";
import { Home } from "./pages/public/Home";
import { SobreNosotros } from "./pages/public/SobreNosotros";
import { TiendaOnline } from "./pages/public/TiendaOnline";
import { Terminos } from "./pages/public/Terminos";
import { SoporteStaff } from "./pages/staff/SoporteStaff";
import { ComprobantePedidoVendedor } from "./pages/vendedor/ComprobantePedidoVendedor";
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

export default function App() {
  return (
    <>
      <RealtimeBridge />
      <SeoRouteMeta />
      <ScrollToTop />
      <Navbar />
      <div className="app-main">
        <main>
          <Routes>
            <Route path="/" element={<Navigate to="/inicio" replace />} />
            <Route path="/inicio" element={<Home />} />
            <Route path="/catalogo" element={<Catalogo />} />
            <Route path="/tienda" element={<TiendaOnline />} />
            <Route path="/login" element={<Login />} />
            <Route path="/registro" element={<Registro />} />
            <Route path="/forgot-password" element={<ForgotPassword />} />
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route
              path="/cliente"
              element={
                <ProtectedRoute rol="cliente">
                  <Cliente />
                </ProtectedRoute>
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
                <ProtectedRoute rol="cliente">
                  <MisCanjes />
                </ProtectedRoute>
              }
            />
            <Route
              path="/mis-canjes/:id"
              element={
                <ProtectedRoute rol="cliente">
                  <ComprobanteCanje />
                </ProtectedRoute>
              }
            />
            <Route
              path="/carrito-canjes"
              element={
                <ProtectedRoute rol="cliente">
                  <ConfirmarCanje />
                </ProtectedRoute>
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
                <ProtectedRoute rol={["vendedor", "admin", "superAdmin"]}>
                  <Vendedor />
                </ProtectedRoute>
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
              path="/vendedor/pedidos/:id"
              element={
                <ProtectedRoute rol={["vendedor", "admin", "superAdmin"]}>
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
            <Route path="*" element={<Navigate to="/inicio" replace />} />
          </Routes>
        </main>
        <Footer />
      </div>
      <FloatingWhatsApp />
    </>
  );
}
