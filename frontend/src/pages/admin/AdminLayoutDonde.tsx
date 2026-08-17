import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api } from "../../api";
import { mediaUrl } from "../../lib/apiBase";

function SectionTitle({ title }: { title: string }) {
  return (
    <div className="admin-section-header">
      <h2 className="admin-section-title">{title}</h2>
    </div>
  );
}

type ConfiguracionItem = {
  clave: string;
  valor: string;
  descripcion: string | null;
};

type DondeDraft = {
  home_ubicacion_imagen_1_link: string;
  home_ubicacion_imagen_2_link: string;
  home_ubicacion_imagen_3_link: string;
  home_ubicacion_imagen_1_src: string;
  home_ubicacion_imagen_2_src: string;
  home_ubicacion_imagen_3_src: string;
};

export function AdminLayoutDonde() {
  const queryClient = useQueryClient();
  const configuracionQuery = useQuery({
    queryKey: ["admin", "configuracion"],
    queryFn: () => api.get<ConfiguracionItem[]>("/admin/configuracion"),
  });

  const [draft, setDraft] = useState<DondeDraft>({
    home_ubicacion_imagen_1_link: "",
    home_ubicacion_imagen_2_link: "",
    home_ubicacion_imagen_3_link: "",
    home_ubicacion_imagen_1_src: "",
    home_ubicacion_imagen_2_src: "",
    home_ubicacion_imagen_3_src: "",
  });

  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [okMsg, setOkMsg] = useState("");

  useEffect(() => {
    if (!configuracionQuery.data || loaded) return;
    const getConfig = (clave: string) => configuracionQuery.data.find((c) => c.clave === clave)?.valor ?? "";
    setDraft({
      home_ubicacion_imagen_1_link: getConfig("home_ubicacion_imagen_1_link"),
      home_ubicacion_imagen_2_link: getConfig("home_ubicacion_imagen_2_link"),
      home_ubicacion_imagen_3_link: getConfig("home_ubicacion_imagen_3_link"),
      home_ubicacion_imagen_1_src: getConfig("home_ubicacion_imagen_1_src"),
      home_ubicacion_imagen_2_src: getConfig("home_ubicacion_imagen_2_src"),
      home_ubicacion_imagen_3_src: getConfig("home_ubicacion_imagen_3_src"),
    });
    setLoaded(true);
  }, [configuracionQuery.data, loaded]);

  const commandMutation = useMutation({
    mutationFn: (args: { path: string; body: any }) => api.put(args.path, args.body),
  });

  const guardarCambios = async () => {
    setBusy(true);
    setOkMsg("");
    try {
      const updates = [
        { clave: "home_ubicacion_imagen_1_link", valor: draft.home_ubicacion_imagen_1_link },
        { clave: "home_ubicacion_imagen_2_link", valor: draft.home_ubicacion_imagen_2_link },
        { clave: "home_ubicacion_imagen_3_link", valor: draft.home_ubicacion_imagen_3_link },
        { clave: "home_ubicacion_imagen_1_src", valor: draft.home_ubicacion_imagen_1_src },
        { clave: "home_ubicacion_imagen_2_src", valor: draft.home_ubicacion_imagen_2_src },
        { clave: "home_ubicacion_imagen_3_src", valor: draft.home_ubicacion_imagen_3_src },
      ];

      await Promise.all(
        updates.map((item) =>
          commandMutation.mutateAsync({
            path: `/admin/configuracion/${item.clave}`,
            body: { valor: item.valor, descripcion: `Configuración para ${item.clave}` },
          }),
        ),
      );
      setOkMsg("Configuración guardada correctamente.");
      await queryClient.invalidateQueries({ queryKey: ["admin", "configuracion"] });
    } catch (e) {
      alert("Error al guardar: " + (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const subirImagenConfig = async (key: keyof DondeDraft, file: File) => {
    const formData = new FormData();
    formData.append("imagen", file);
    setBusy(true);
    try {
      const { url } = await api.post<{ url: string }>("/admin/productos/upload", formData);
      setDraft((prev) => ({ ...prev, [key]: url }));
    } catch (err) {
      alert("Error al subir imagen");
    } finally {
      setBusy(false);
    }
  };

  const img1 = draft.home_ubicacion_imagen_1_src ? (draft.home_ubicacion_imagen_1_src.startsWith("http") ? draft.home_ubicacion_imagen_1_src : mediaUrl(draft.home_ubicacion_imagen_1_src)) : "/mercado-sabores-frente.jpg";
  const img2 = draft.home_ubicacion_imagen_2_src ? (draft.home_ubicacion_imagen_2_src.startsWith("http") ? draft.home_ubicacion_imagen_2_src : mediaUrl(draft.home_ubicacion_imagen_2_src)) : "/nande-la-unidad-puesto.jpg";
  const img3 = draft.home_ubicacion_imagen_3_src ? (draft.home_ubicacion_imagen_3_src.startsWith("http") ? draft.home_ubicacion_imagen_3_src : mediaUrl(draft.home_ubicacion_imagen_3_src)) : "/nande-la-unidad-productos.jpg";

  return (
    <>
      <SectionTitle title="Dónde encontrarnos" />
      <p className="adm-page-desc">
        Configura las tres imágenes que aparecen en la sección "Dónde encontrarnos" en el inicio de la app.
        Puedes cambiar la foto y el enlace hacia donde dirigen al hacer clic.
      </p>

      {/* PREVIEW */}
      <div className="admin-card" style={{ padding: "1.5rem", marginBottom: "2rem" }}>
        <h3 style={{ marginBottom: "1rem" }}>Vista Previa del Layout</h3>
        <div style={{ 
          display: "grid", 
          gridTemplateColumns: "1fr 1fr", 
          gridTemplateRows: "150px 150px", 
          gap: "1rem", 
          maxWidth: "600px", 
          margin: "0 auto",
          background: "#fff",
          padding: "1rem",
          borderRadius: "8px",
          border: "1px solid #eee"
        }}>
          {/* Imagen 1: Izquierda (ocupa 2 filas) */}
          <div style={{ gridRow: "1 / span 2", position: "relative", borderRadius: "8px", overflow: "hidden", background: "#f0f0f0" }}>
            <img src={img1} alt="Prev 1" style={{ width: "100%", height: "100%", objectFit: "cover" }} loading="lazy" decoding="async" />
            <div style={{ position: "absolute", top: 0, left: 0, background: "rgba(0,0,0,0.6)", color: "#fff", padding: "4px 8px", fontSize: "12px", borderBottomRightRadius: "8px" }}>1. Izquierda</div>
          </div>
          {/* Imagen 2: Superior derecha */}
          <div style={{ position: "relative", borderRadius: "8px", overflow: "hidden", background: "#f0f0f0" }}>
            <img src={img2} alt="Prev 2" style={{ width: "100%", height: "100%", objectFit: "cover" }} loading="lazy" decoding="async" />
            <div style={{ position: "absolute", top: 0, left: 0, background: "rgba(0,0,0,0.6)", color: "#fff", padding: "4px 8px", fontSize: "12px", borderBottomRightRadius: "8px" }}>2. Sup. Derecha</div>
          </div>
          {/* Imagen 3: Inferior derecha */}
          <div style={{ position: "relative", borderRadius: "8px", overflow: "hidden", background: "#f0f0f0" }}>
            <img src={img3} alt="Prev 3" style={{ width: "100%", height: "100%", objectFit: "cover" }} loading="lazy" decoding="async" />
            <div style={{ position: "absolute", top: 0, left: 0, background: "rgba(0,0,0,0.6)", color: "#fff", padding: "4px 8px", fontSize: "12px", borderBottomRightRadius: "8px" }}>3. Inf. Derecha</div>
          </div>
        </div>
      </div>

      <div className="admin-card" style={{ padding: "1.5rem", display: "grid", gap: "2rem" }}>
        
        {/* EDIT 1 */}
        <div style={{ paddingBottom: "1.5rem", borderBottom: "1px solid #eee" }}>
          <h4>1. Imagen Izquierda (Principal)</h4>
          <p style={{ fontSize: "0.9rem", color: "#666", marginBottom: "1rem" }}>
            Recomendado: <strong>Proporción Vertical o Cuadrada (ej. 800x1200px o 1000x1000px)</strong>. Es la más grande.
          </p>
          <div className="adm-form-grid">
            <label>
              <span className="adm-label">Link de destino (Opcional)</span>
              <input className="adm-input" placeholder="Ej: /tienda o https://..." value={draft.home_ubicacion_imagen_1_link} onChange={e => setDraft({...draft, home_ubicacion_imagen_1_link: e.target.value})} />
            </label>
            <label>
              <span className="adm-label">Cambiar Imagen</span>
              <input type="file" accept="image/*" disabled={busy} onChange={e => { if (e.target.files?.[0]) subirImagenConfig("home_ubicacion_imagen_1_src", e.target.files[0]) }} />
            </label>
          </div>
        </div>

        {/* EDIT 2 */}
        <div style={{ paddingBottom: "1.5rem", borderBottom: "1px solid #eee" }}>
          <h4>2. Imagen Superior Derecha</h4>
          <p style={{ fontSize: "0.9rem", color: "#666", marginBottom: "1rem" }}>
            Recomendado: <strong>Proporción Horizontal (ej. 1200x800px o 16:9)</strong>.
          </p>
          <div className="adm-form-grid">
            <label>
              <span className="adm-label">Link de destino (Opcional)</span>
              <input className="adm-input" placeholder="Ej: /catalogo o https://..." value={draft.home_ubicacion_imagen_2_link} onChange={e => setDraft({...draft, home_ubicacion_imagen_2_link: e.target.value})} />
            </label>
            <label>
              <span className="adm-label">Cambiar Imagen</span>
              <input type="file" accept="image/*" disabled={busy} onChange={e => { if (e.target.files?.[0]) subirImagenConfig("home_ubicacion_imagen_2_src", e.target.files[0]) }} />
            </label>
          </div>
        </div>

        {/* EDIT 3 */}
        <div>
          <h4>3. Imagen Inferior Derecha</h4>
          <p style={{ fontSize: "0.9rem", color: "#666", marginBottom: "1rem" }}>
            Recomendado: <strong>Proporción Horizontal (ej. 1200x800px o 16:9)</strong>.
          </p>
          <div className="adm-form-grid">
            <label>
              <span className="adm-label">Link de destino (Opcional)</span>
              <input className="adm-input" placeholder="Ej: https://maps... o #seccion" value={draft.home_ubicacion_imagen_3_link} onChange={e => setDraft({...draft, home_ubicacion_imagen_3_link: e.target.value})} />
            </label>
            <label>
              <span className="adm-label">Cambiar Imagen</span>
              <input type="file" accept="image/*" disabled={busy} onChange={e => { if (e.target.files?.[0]) subirImagenConfig("home_ubicacion_imagen_3_src", e.target.files[0]) }} />
            </label>
          </div>
        </div>

        <div>
          <button className="adm-btn-primary" onClick={guardarCambios} disabled={busy}>
            {busy ? "Guardando..." : "Guardar todos los cambios"}
          </button>
          {okMsg && <span style={{ marginLeft: "1rem", color: "green", fontWeight: "bold" }}>{okMsg}</span>}
        </div>
      </div>
    </>
  );
}
