import { useEffect } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { apiUrl } from "../lib/apiBase";
import { getCsrfToken } from "../lib/csrf";
import { defaultRouteForRole } from "../lib/auth";
import { useAuthStore } from "../store/authStore";
import type { Rol } from "../types";

type ProtectedRouteProps = {
  rol: Rol | Rol[];
  children: React.ReactElement;
};

type BlockedRouteRedirectProps = {
  to: string;
  navigateState?: Record<string, unknown>;
  attemptedPath: string;
  requiredRoles: Rol[];
  notice?: string;
};

function reportAccessDeniedAttempt(attemptedPath: string, requiredRoles: Rol[]): void {
  void fetch(apiUrl("/api/diagnostico/access-denied"), {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      "X-CSRF-Token": getCsrfToken(),
    },
    body: JSON.stringify({
      attempted_path: attemptedPath,
      required_roles: requiredRoles,
    }),
  }).catch(() => {
    // No bloqueamos la navegacion si falla el tracking.
  });
}

function BlockedRouteRedirect({ to, navigateState, attemptedPath, requiredRoles, notice }: BlockedRouteRedirectProps) {
  const navigate = useNavigate();

  useEffect(() => {
    reportAccessDeniedAttempt(attemptedPath, requiredRoles);

    navigate(to, {
      replace: true,
      state: notice ? { ...(navigateState ?? {}), accessDeniedNotice: notice } : navigateState,
    });
  }, [attemptedPath, navigate, navigateState, notice, requiredRoles, to]);

  return null;
}

export function ProtectedRoute({ rol, children }: ProtectedRouteProps) {
  const user = useAuthStore((state) => state.user);
  const location = useLocation();
  const allowedRoles = Array.isArray(rol) ? rol : [rol];

  const isRestrictedPanelPath =
    location.pathname.startsWith("/admin") || location.pathname.startsWith("/vendedor");

  if (!user) {
    if (isRestrictedPanelPath) {
      return (
        <BlockedRouteRedirect
          to="/login"
          navigateState={{ from: location.pathname }}
          attemptedPath={location.pathname}
          requiredRoles={allowedRoles}
        />
      );
    }

    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  if (!allowedRoles.includes(user.rol)) {
    const isClienteTryingRestricted = user.rol === "cliente" && isRestrictedPanelPath;

    if (isClienteTryingRestricted) {
      return (
        <BlockedRouteRedirect
          to="/catalogo"
          attemptedPath={location.pathname}
          requiredRoles={allowedRoles}
          notice="No tienes permiso / tu IP fue enviada para investigacion"
        />
      );
    }

    return (
      <BlockedRouteRedirect
        to={defaultRouteForRole(user.rol)}
        attemptedPath={location.pathname}
        requiredRoles={allowedRoles}
      />
    );
  }

  return children;
}
