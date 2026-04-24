import { Navigate, useLocation } from "react-router-dom";
import { defaultRouteForRole } from "../lib/auth";
import { useAuthStore } from "../store/authStore";
import type { Rol } from "../types";

type ProtectedRouteProps = {
  rol: Rol | Rol[];
  children: React.ReactElement;
};

export function ProtectedRoute({ rol, children }: ProtectedRouteProps) {
  const user = useAuthStore((state) => state.user);
  const location = useLocation();

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  const allowedRoles = Array.isArray(rol) ? rol : [rol];
  if (!allowedRoles.includes(user.rol)) {
    return <Navigate to={defaultRouteForRole(user.rol)} replace />;
  }

  return children;
}
