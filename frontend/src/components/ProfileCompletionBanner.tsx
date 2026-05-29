import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "react-router-dom";
import { api } from "../api";
import { getProfileCompletion, type ProfileCompletionUser } from "../lib/profileCompletion";
import { useAuthStore } from "../store/authStore";

type ClienteMe = ProfileCompletionUser & {
  id: number;
  puntos_saldo: number;
  codigo_invitacion: string | null;
  referido_por: number | null;
};

export function ProfileCompletionBanner() {
  const location = useLocation();
  const user = useAuthStore((state) => state.user);
  const authReady = useAuthStore((state) => state.hasRestoredSession && !state.isRestoringSession);
  const canShow = authReady && user?.rol === "cliente";

  const perfilQuery = useQuery({
    queryKey: ["cliente", "perfil"],
    queryFn: () => api.get<ClienteMe>("/cliente/me"),
    enabled: canShow,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });

  if (!canShow) return null;

  const perfil = perfilQuery.data ?? user;
  const completion = getProfileCompletion(perfil);
  if (completion.isComplete) return null;

  const missingLabels = completion.missing.map((field) => field.label).join(", ");
  const isProfilePage = location.pathname === "/mi-perfil";

  return (
    <div className="profile-completion-band" role="status" aria-live="polite">
      <div className="profile-completion-inner">
        <div className="profile-completion-copy">
          <div className="profile-completion-head">
            <strong>Debes completar estos datos para la compra</strong>
            <span>{completion.completedPercent}% completo</span>
          </div>
          <p>
            Faltan {completion.missing.length} de {completion.total} datos ({completion.missingPercent}%):
            {" "}
            {missingLabels}.
          </p>
          <div className="profile-completion-track" aria-hidden="true">
            <span style={{ width: `${completion.completedPercent}%` }} />
          </div>
        </div>

        <Link
          to="/mi-perfil"
          className="profile-completion-action"
          aria-current={isProfilePage ? "page" : undefined}
        >
          Completar datos
        </Link>
      </div>
    </div>
  );
}
