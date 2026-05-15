import { Navigate, Route, Routes } from "react-router-dom";
import { Footer } from "./components/Footer";
import { FloatingWhatsApp } from "./components/FloatingWhatsApp";
import { Navbar } from "./components/Navbar";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { RealtimeBridge } from "./components/RealtimeBridge";
import { SeoRouteMeta } from "./components/SeoRouteMeta";
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

export default function App() {
  return (
    <>
      <RealtimeBridge />
      <SeoRouteMeta />
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
            <Route
              path="/vendedor/pedidos"
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
