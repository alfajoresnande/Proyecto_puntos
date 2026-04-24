import { useEffect } from "react";
import { Route, Routes } from "react-router-dom";
import { Footer } from "./components/Footer";
import { FloatingWhatsApp } from "./components/FloatingWhatsApp";
import { Navbar } from "./components/Navbar";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { parseJwtExp } from "./lib/auth";
import { Admin } from "./pages/admin/Admin";
import { Login } from "./pages/auth/Login";
import { Registro } from "./pages/auth/Registro";
import { Cliente } from "./pages/cliente/Cliente";
import { MiPerfil } from "./pages/cliente/MiPerfil";
import { Catalogo } from "./pages/public/Catalogo";
import { SobreNosotros } from "./pages/public/SobreNosotros";
import { Terminos } from "./pages/public/Terminos";
import { Vendedor } from "./pages/vendedor/Vendedor";
import { useAuthStore } from "./store/authStore";

export default function App() {
  const token = useAuthStore((state) => state.token);
  const logout = useAuthStore((state) => state.logout);

  useEffect(() => {
    const exp = parseJwtExp(token);
    if (!exp) return;

    const ms = exp * 1000 - Date.now();
    if (ms <= 0) {
      logout();
      return;
    }

    const timer = window.setTimeout(() => {
      logout();
      alert("Tu sesion expiro. Inicia sesion nuevamente.");
    }, ms);

    return () => window.clearTimeout(timer);
  }, [token, logout]);

  return (
    <>
      <Navbar />
      <div className="app-main">
        <main>
          <Routes>
            <Route path="/" element={<Catalogo />} />
            <Route path="/login" element={<Login />} />
            <Route path="/registro" element={<Registro />} />
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
          </Routes>
        </main>
        <Footer />
      </div>
      <FloatingWhatsApp />
    </>
  );
}
