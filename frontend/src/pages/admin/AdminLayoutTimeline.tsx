import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../../api";
import { mediaUrl } from "../../lib/apiBase";
import { useToast } from "../../components/ToastProvider";
function SectionTitle({ title }: { title: string }) {
  return (
    <div className="admin-section-header">
      <h2 className="admin-section-title">{title}</h2>
    </div>
  );
}
type TimelineEvento = {
  id: number;
  badge_text: string | null;
  titulo: string;
  descripcion: string | null;
  imagen_url: string | null;
  orden: number;
  activo: boolean;
};

export function AdminLayoutTimeline() {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const timelineQuery = useQuery({
    queryKey: ["admin", "layout-timeline"],
    queryFn: () => api.get<TimelineEvento[]>("/admin/layout/timeline"),
  });

  const [eventoNuevo, setEventoNuevo] = useState<Partial<TimelineEvento>>({
    badge_text: "",
    titulo: "",
    descripcion: "",
    imagen_url: "",
    activo: true,
  });
  
  const [eventoEditando, setEventoEditando] = useState<Partial<TimelineEvento> | null>(null);

  const crearMutation = useMutation({
    mutationFn: (data: Partial<TimelineEvento>) => api.post("/admin/layout/timeline", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "layout-timeline"] });
      setEventoNuevo({ badge_text: "", titulo: "", descripcion: "", imagen_url: "", activo: true });
      showToast({ tone: "success", title: "Evento creado", message: "El evento se guardó correctamente" });
    },
    onError: (err) => {
      showToast({ tone: "danger", title: "Error al crear evento", message: err instanceof Error ? err.message : "Error desconocido" });
    }
  });

  const actualizarMutation = useMutation({
    mutationFn: (data: Partial<TimelineEvento>) => api.put(`/admin/layout/timeline/${data.id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "layout-timeline"] });
      setEventoEditando(null);
      showToast({ tone: "success", title: "Evento actualizado", message: "Los cambios se guardaron correctamente" });
    },
    onError: (err) => {
      showToast({ tone: "danger", title: "Error al actualizar", message: err instanceof Error ? err.message : "Error desconocido" });
    }
  });

  const eliminarMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/admin/layout/timeline/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "layout-timeline"] });
      showToast({ tone: "success", title: "Evento eliminado" });
    },
    onError: (err) => {
      showToast({ tone: "danger", title: "Error al eliminar", message: err instanceof Error ? err.message : "Error desconocido" });
    }
  });

  const subirImagen = async (file: File, esEdicion: boolean) => {
    const formData = new FormData();
    formData.append("imagen", file);
    try {
      const { url } = await api.post<{ url: string }>("/admin/productos/upload", formData);
      if (esEdicion && eventoEditando) {
        setEventoEditando({ ...eventoEditando, imagen_url: url });
      } else {
        setEventoNuevo({ ...eventoNuevo, imagen_url: url });
      }
      showToast({ tone: "success", title: "Imagen subida", message: "La imagen se procesó correctamente" });
    } catch (err) {
      showToast({ tone: "danger", title: "Error al subir la imagen", message: err instanceof Error ? err.message : "Error desconocido", duration: 15000 });
    }
  };

  const eventos = timelineQuery.data ?? [];

  return (
    <>
      <SectionTitle title="Línea de Tiempo Dinámica" />
      <p className="adm-page-desc">
        Configura los eventos de la línea de tiempo que se muestran en el inicio de la página. 
        Puedes cambiar textos, imágenes y el orden en el que aparecen.
      </p>

      <div className="admin-card" style={{ padding: "1.5rem", marginBottom: "2rem" }}>
        <h3>Agregar nuevo evento</h3>
        <div className="adm-form-grid" style={{ marginTop: "1rem" }}>
          <label>
            <span className="adm-label">Insignia / Año (Ej: 2025 o Ferias)</span>
            <input className="adm-input" value={eventoNuevo.badge_text ?? ""} onChange={(e) => setEventoNuevo({ ...eventoNuevo, badge_text: e.target.value })} />
          </label>
          <label>
            <span className="adm-label">Título *</span>
            <input className="adm-input" value={eventoNuevo.titulo ?? ""} onChange={(e) => setEventoNuevo({ ...eventoNuevo, titulo: e.target.value })} />
          </label>
          <label style={{ gridColumn: "1 / -1" }}>
            <span className="adm-label">Descripción</span>
            <textarea className="adm-input" rows={3} value={eventoNuevo.descripcion ?? ""} onChange={(e) => setEventoNuevo({ ...eventoNuevo, descripcion: e.target.value })} />
          </label>
          <label>
            <span className="adm-label">Orden</span>
            <div style={{ color: "#666", fontSize: "0.9rem", padding: "0.4rem 0" }}>Se asignará al final automáticamente</div>
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <input type="checkbox" checked={eventoNuevo.activo ?? true} onChange={(e) => setEventoNuevo({ ...eventoNuevo, activo: e.target.checked })} />
            <strong>Activo (visible al público)</strong>
          </label>
          
          <label style={{ gridColumn: "1 / -1" }}>
            <span className="adm-label">Imagen (Recomendado 16:9 / Ej: 1280x720px)</span>
            <div style={{ display: "flex", gap: "1rem", alignItems: "center" }}>
              <input type="file" accept="image/*" onChange={(e) => {
                if (e.target.files?.[0]) subirImagen(e.target.files[0], false);
              }} />
              {eventoNuevo.imagen_url && <img src={eventoNuevo.imagen_url.startsWith("http") ? eventoNuevo.imagen_url : mediaUrl(eventoNuevo.imagen_url)} alt="preview" style={{ height: "60px", borderRadius: "4px" }} loading="lazy" decoding="async" />}
            </div>
          </label>
        </div>
        <button 
          className="adm-btn-primary" 
          style={{ marginTop: "1rem" }}
          disabled={!eventoNuevo.titulo || crearMutation.isPending}
          onClick={() => {
            const maxOrden = eventos.length > 0 ? Math.max(...eventos.map(e => e.orden)) : 0;
            crearMutation.mutate({ ...eventoNuevo, orden: maxOrden + 1 });
          }}
        >
          {crearMutation.isPending ? "Guardando..." : "Crear evento"}
        </button>
      </div>

      <div style={{ display: "grid", gap: "1rem" }}>
        {eventos.map((evento) => (
          <div key={evento.id} className="admin-card" style={{ padding: "1.5rem", display: "flex", gap: "1.5rem", alignItems: "flex-start" }}>
            {evento.imagen_url ? (
              <img src={evento.imagen_url.startsWith("http") ? evento.imagen_url : mediaUrl(evento.imagen_url)} alt={evento.titulo} style={{ width: "120px", height: "120px", objectFit: "cover", borderRadius: "8px" }} loading="lazy" decoding="async" />
            ) : (
              <div style={{ width: "120px", height: "120px", background: "#f0f0f0", borderRadius: "8px", display: "flex", alignItems: "center", justifyContent: "center" }}>Sin imagen</div>
            )}
            
            {eventoEditando?.id === evento.id ? (
              <div style={{ flex: 1, display: "grid", gap: "1rem" }}>
                <div className="adm-form-grid">
                  <label><span className="adm-label">Insignia</span><input className="adm-input" value={eventoEditando.badge_text ?? ""} onChange={(e) => setEventoEditando({ ...eventoEditando, badge_text: e.target.value })} /></label>
                  <label><span className="adm-label">Título</span><input className="adm-input" value={eventoEditando.titulo ?? ""} onChange={(e) => setEventoEditando({ ...eventoEditando, titulo: e.target.value })} /></label>
                  <label style={{ gridColumn: "1 / -1" }}><span className="adm-label">Descripción</span><textarea className="adm-input" value={eventoEditando.descripcion ?? ""} onChange={(e) => setEventoEditando({ ...eventoEditando, descripcion: e.target.value })} /></label>
                  <label><span className="adm-label">Orden</span><input className="adm-input" type="number" value={eventoEditando.orden ?? 0} onChange={(e) => setEventoEditando({ ...eventoEditando, orden: Number(e.target.value) })} /></label>
                  <label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}><input type="checkbox" checked={eventoEditando.activo} onChange={(e) => setEventoEditando({ ...eventoEditando, activo: e.target.checked })} /> Activo</label>
                  <label style={{ gridColumn: "1 / -1" }}>
                    <span className="adm-label">Cambiar Imagen</span>
                    <input type="file" accept="image/*" onChange={(e) => {
                      if (e.target.files?.[0]) subirImagen(e.target.files[0], true);
                    }} />
                  </label>
                </div>
                <div style={{ display: "flex", gap: "0.5rem" }}>
                  <button className="adm-btn-primary" onClick={() => actualizarMutation.mutate(eventoEditando)} disabled={actualizarMutation.isPending}>Guardar cambios</button>
                  <button className="adm-btn-secondary" onClick={() => setEventoEditando(null)}>Cancelar</button>
                </div>
              </div>
            ) : (
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.5rem" }}>
                  <div style={{ display: "flex", flexDirection: "column", gap: "2px", marginRight: "0.5rem" }}>
                    <button 
                      onClick={() => actualizarMutation.mutate({ ...evento, orden: evento.orden - 1 })}
                      style={{ background: "#eee", border: "none", borderRadius: "4px", padding: "2px 8px", cursor: "pointer", fontSize: "12px" }}
                      title="Subir"
                    >▲</button>
                    <button 
                      onClick={() => actualizarMutation.mutate({ ...evento, orden: evento.orden + 1 })}
                      style={{ background: "#eee", border: "none", borderRadius: "4px", padding: "2px 8px", cursor: "pointer", fontSize: "12px" }}
                      title="Bajar"
                    >▼</button>
                  </div>
                  <span style={{ background: "#eee", padding: "0.2rem 0.5rem", borderRadius: "4px", fontSize: "0.8rem", fontWeight: "bold" }}>#{evento.orden}</span>
                  {evento.badge_text && <span style={{ background: "#ddd", padding: "0.2rem 0.5rem", borderRadius: "4px", fontSize: "0.8rem" }}>{evento.badge_text}</span>}
                  <h4 style={{ margin: 0 }}>{evento.titulo}</h4>
                  {!evento.activo && <span style={{ color: "red", fontSize: "0.8rem", marginLeft: "auto" }}>Pausado</span>}
                </div>
                <p style={{ margin: "0 0 1rem", color: "#666", whiteSpace: "pre-wrap" }}>{evento.descripcion}</p>
                <div style={{ display: "flex", gap: "0.5rem" }}>
                  <button className="adm-btn-secondary" onClick={() => setEventoEditando(evento)}>Editar</button>
                  <button className="adm-btn-danger" onClick={() => { if(confirm("¿Seguro que deseas eliminar este evento?")) eliminarMutation.mutate(evento.id); }}>Eliminar</button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </>
  );
}
