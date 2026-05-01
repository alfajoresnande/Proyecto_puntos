import { Navigate, Route, Routes } from "react-router-dom";
import { Footer } from "./components/Footer";
import { FloatingWhatsApp } from "./components/FloatingWhatsApp";
import { Navbar } from "./components/Navbar";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { Admin } from "./pages/admin/Admin";
import { ForgotPassword } from "./pages/auth/ForgotPassword";
import { Login } from "./pages/auth/Login";
import { Registro } from "./pages/auth/Registro";
import { ResetPassword } from "./pages/auth/ResetPassword";
import { Cliente } from "./pages/cliente/Cliente";
import { ConfirmarCanje } from "./pages/cliente/ConfirmarCanje";
import { MisCanjes } from "./pages/cliente/MisCanjes";
import { MiPerfil } from "./pages/cliente/MiPerfil";
import { Catalogo } from "./pages/public/Catalogo";
import { SobreNosotros } from "./pages/public/SobreNosotros";
import { Terminos } from "./pages/public/Terminos";
import { Vendedor } from "./pages/vendedor/Vendedor";

export default function App() {
  return (
    <>
      <Navbar />
      <div className="app-main">
        <main>
          <Routes>
            <Route path="/" element={<Navigate to="/catalogo" replace />} />
            <Route path="/catalogo" element={<Catalogo />} />
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
              path="/carrito-canjes"
              element={
                <ProtectedRoute rol="cliente">
                  <ConfirmarCanje />
                </ProtectedRoute>
              }
            />
            <Route path="/confirmar-canje" element={<Navigate to="/carrito-canjes" replace />} />
            <Route
              path="/vendedor"
              element={
                <ProtectedRoute rol={["vendedor", "admin"]}>
                  <Vendedor />
                </ProtectedRoute>
              }
            />
            <Route
              path="/admin"
              element={
                <ProtectedRoute rol="admin">
                  <Admin />
                </ProtectedRoute>
              }
            />
            <Route path="/sobre-nosotros" element={<SobreNosotros />} />
            <Route path="/terminos" element={<Terminos />} />
            <Route path="*" element={<Navigate to="/catalogo" replace />} />
          </Routes>
        </main>
        <Footer />
      </div>
      <FloatingWhatsApp />
    </>
  );
}
