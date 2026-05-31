import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { api } from "../../api";
import { mediaUrl } from "../../lib/apiBase";
import { useAuthStore } from "../../store/authStore";
import type { Producto } from "../../types";

type TimelineEntry = {
  id: number;
  badge_text: string | null;
  titulo: string;
  descripcion: string | null;
  imagen_url: string | null;
  orden: number;
};

type CategoriaHome = {
  id: number;
  nombre: string;
  descripcion: string | null;
  imagen_url: string | null;
};

type LocationImage = {
  src: string;
  alt: string;
  link?: string | null;
};

type HomeLayoutConfigResponse = {
  location_image_links: Array<string | null>;
  location_image_srcs: Array<string | null>;
};

const HOME_LOCATION_GALLERY_BASE: LocationImage[] = [
  { src: "/mercado-sabores-frente.jpg", alt: "Frente de Mercado de Sabores en La Unidad" },
  { src: "/nande-la-unidad-puesto.jpg", alt: "Puesto de Ñandé dentro de La Unidad" },
  { src: "/nande-la-unidad-productos.jpg", alt: "Productos de Ñandé en Mercado de Sabores" },
];

type MapPoint = {
  id: string;
  name: string;
  city: string;
  address: string;
  contact: string;
  mapsUrl: string;
};

function productImage(producto: Producto): string {
  const image = producto.imagenes?.find(Boolean) || producto.imagen_url;
  return image ? mediaUrl(image) : "/logo.png";
}

function hasProductImage(producto: Producto): boolean {
  const image = producto.imagenes?.find(Boolean) || producto.imagen_url || "";
  return Boolean(image && !image.endsWith("/logo.png") && image !== "logo.png");
}

function money(value: number | string | null | undefined): string {
  const n = Number(value ?? 0);
  return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" }).format(Number.isFinite(n) ? n : 0);
}

function canEarnPurchasePoints(producto: Producto): boolean {
  const price = Number(producto.precio_dinero ?? 0);
  return Number.isFinite(price) && price > 0;
}

function hasFreeShipping(producto: Producto): boolean {
  return Boolean(producto.permite_envio && producto.envio_gratis);
}

function isInternalNavigationLink(value: string): boolean {
  return value.startsWith("/");
}

export function Home() {
  const user = useAuthStore((state) => state.user);
  const cvFileInputRef = useRef<HTMLInputElement | null>(null);
  const shouldShowCvSection = !user || user.rol === "cliente";
  const [cvForm, setCvForm] = useState({
    nombre: "",
    email: "",
    telefono: "",
    mensaje: "",
  });
  const [cvFile, setCvFile] = useState<File | null>(null);
  const [cvStatus, setCvStatus] = useState<{ type: "ok" | "error"; text: string } | null>(null);
  const [cvSending, setCvSending] = useState(false);
  const mapPoints: MapPoint[] = [
    {
      id: "la-unidad",
      name: "Ñandé - Mercado de Sabores",
      city: "Corrientes, Corrientes",
      address: "Padre Borgatti 1474-1600, La Unidad, Mercado de Sabores, puesto 3",
      contact: "+54 379 463-2610",
      mapsUrl: "https://maps.app.goo.gl/wo9r1LGXSsh4Bmht7",
    },
  ];
  const selectedMapPoint = mapPoints[0];
  const mapEmbedUrl = "https://www.openstreetmap.org/export/embed.html?bbox=-58.8588%2C-27.4788%2C-58.8422%2C-27.4676&layer=mapnik&marker=-27.47298%2C-58.85053";

  useEffect(() => {
    document.body.classList.add("home-background");
    return () => {
      document.body.classList.remove("home-background");
    };
  }, []);

  function handleCvFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    setCvFile(file);
    setCvStatus(null);
  }

  async function handleCvSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCvStatus(null);

    if (!cvFile) {
      setCvStatus({ type: "error", text: "Adjunta tu CV en PDF, DOC o DOCX." });
      return;
    }

    const formData = new FormData();
    formData.append("nombre", cvForm.nombre);
    formData.append("email", cvForm.email);
    formData.append("telefono", cvForm.telefono);
    formData.append("mensaje", cvForm.mensaje);
    formData.append("cv", cvFile);

    try {
      setCvSending(true);
      await api.post<{ ok: boolean; id: number }>("/postulaciones", formData);
      setCvForm({ nombre: "", email: "", telefono: "", mensaje: "" });
      setCvFile(null);
      if (cvFileInputRef.current) cvFileInputRef.current.value = "";
      setCvStatus({ type: "ok", text: "Recibimos tu postulacion. Gracias por acercarte a Nande." });
    } catch (err) {
      setCvStatus({ type: "error", text: err instanceof Error ? err.message : "No pudimos enviar la postulacion." });
    } finally {
      setCvSending(false);
    }
  }

  const [selectedCategoria, setSelectedCategoria] = useState<string>("Alfajores");

  const productosDestacadosQuery = useQuery({
    queryKey: ["home", "productos", "destacados"],
    queryFn: () => api.get<Producto[]>("/productos/destacados?limit=12"),
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const homeLayoutConfigQuery = useQuery({
    queryKey: ["home", "layout-config"],
    queryFn: () => api.get<HomeLayoutConfigResponse>("/productos/home-layout-config"),
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const timelineQuery = useQuery({
    queryKey: ["home", "timeline"],
    queryFn: () => api.get<TimelineEntry[]>("/layout/timeline"),
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const categoriasQuery = useQuery({
    queryKey: ["home", "categorias"],
    queryFn: () => api.get<CategoriaHome[]>("/layout/categorias"),
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const productosCategoriaQuery = useQuery({
    queryKey: ["home", "productos", "categoria", selectedCategoria],
    queryFn: () => api.get<Producto[]>(`/productos?categoria=${encodeURIComponent(selectedCategoria)}&modo=venta`),
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
    enabled: Boolean(selectedCategoria),
  });

  const productosDestacados = useMemo(() => {
    const productos = productosDestacadosQuery.data ?? [];
    return productos.filter(hasProductImage);
  }, [productosDestacadosQuery.data]);

  const categoriasHome = categoriasQuery.data ?? [];

  useEffect(() => {
    if (!categoriasHome.length) return;
    if (categoriasHome.some((categoria) => categoria.nombre === selectedCategoria)) return;

    const alfajores = categoriasHome.find((categoria) => categoria.nombre.trim().toLowerCase() === "alfajores");
    setSelectedCategoria(alfajores?.nombre ?? categoriasHome[0].nombre);
  }, [categoriasHome, selectedCategoria]);

  const productosCategoria = useMemo(() => {
    const productos = productosCategoriaQuery.data ?? [];
    return productos.filter(hasProductImage);
  }, [productosCategoriaQuery.data]);

  const productosCarouselSource = selectedCategoria ? productosCategoria : productosDestacados;

  const productosDestacadosCarousel = useMemo(() => {
    return productosCarouselSource.length > 1 ? [...productosCarouselSource, ...productosCarouselSource] : productosCarouselSource;
  }, [productosCarouselSource]);

  const heroImage = "/hero.webp";
  const locationGalleryBase: LocationImage[] = HOME_LOCATION_GALLERY_BASE.slice(0, 1).concat([
    { src: "/nande-la-unidad-puesto.jpg", alt: "Puesto de Ñandé dentro de La Unidad" },
    { src: "/nande-la-unidad-productos.jpg", alt: "Productos de Ñandé en Mercado de Sabores" },
  ]);
  const locationGallery = useMemo(
    () =>
      locationGalleryBase.map((image, index) => {
        const customSrc = homeLayoutConfigQuery.data?.location_image_srcs?.[index];
        return {
          ...image,
          src: customSrc ? (customSrc.startsWith("http") ? customSrc : mediaUrl(customSrc)) : image.src,
          link: homeLayoutConfigQuery.data?.location_image_links?.[index] ?? null,
        };
      }),
    [homeLayoutConfigQuery.data?.location_image_links, homeLayoutConfigQuery.data?.location_image_srcs],
  );

  const timelineEntries: TimelineEntry[] = timelineQuery.data ?? [];

  useEffect(() => {
    const items = Array.from(document.querySelectorAll<HTMLElement>(".home-timeline-card"));
    if (!items.length) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        });
      },
      { threshold: 0.22, rootMargin: "0px 0px -8% 0px" },
    );

    items.forEach((item) => observer.observe(item));
    return () => observer.disconnect();
  }, [timelineEntries.length]);

  return (
    <div className="home-page">
      <section className="home-hero" aria-label="Imagen principal de Ñandé">
        <img src={heroImage} alt="Imagen principal de Ñandé Alfajores Correntinos" className="home-hero-image" />
        <button
          type="button"
          className="home-hero-scroll-hint"
          aria-label="Desplazarse hacia abajo"
          onClick={() => {
            const shell = document.querySelector(".home-content-shell");
            if (shell) shell.scrollIntoView({ behavior: "smooth" });
          }}
        >
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>
      </section>

      <div className="home-content-shell">
        <section className="home-location-section home-section home-section-location">
          <div className="home-location-head">
            <span className="home-kicker">Dónde encontrarnos</span>
          </div>

          {locationGallery.map((image, index) => (
            <figure
              key={image.src}
              className={`home-location-photo home-location-photo-${index + 1}${image.link ? " has-link" : ""}`}
            >
              {image.link ? (
                isInternalNavigationLink(image.link) ? (
                  <Link to={image.link} className="home-location-photo-link">
                    <img
                      src={image.src}
                      alt={image.alt}
                      onError={(event) => {
                        event.currentTarget.src = "/logo.png";
                        event.currentTarget.classList.add("is-placeholder");
                      }}
                    />
                  </Link>
                ) : (
                  <a
                    href={image.link}
                    className="home-location-photo-link"
                    target={image.link.startsWith("#") ? undefined : "_blank"}
                    rel={image.link.startsWith("#") ? undefined : "noreferrer"}
                  >
                    <img
                      src={image.src}
                      alt={image.alt}
                      onError={(event) => {
                        event.currentTarget.src = "/logo.png";
                        event.currentTarget.classList.add("is-placeholder");
                      }}
                    />
                  </a>
                )
              ) : (
                <img
                  src={image.src}
                  alt={image.alt}
                  onError={(event) => {
                    event.currentTarget.src = "/logo.png";
                    event.currentTarget.classList.add("is-placeholder");
                  }}
                />
              )}
            </figure>
          ))}

          <p className="home-location-text">
            Nuestro espacio principal hoy está en La Unidad, un punto ideal para descubrir productos, encontrarnos con la gente y vivir de cerca el sabor de Ñandé.
          </p>
        </section>

        <section className="home-map-section home-section home-section-map">
          <div className="home-map-shell">
            <div className="home-map-card">
              <div className="home-map-frame">
                <iframe
                  title="Mapa de puntos Ñandé"
                  src={mapEmbedUrl}
                  loading="lazy"
                  referrerPolicy="no-referrer-when-downgrade"
                />
              </div>
              <p>La vista muestra Mercado de Sabores dentro de La Unidad.</p>
              <p>Base cartográfica: OpenStreetMap.</p>
            </div>

            <aside className="home-map-detail" aria-live="polite">
              <span className="home-map-kicker">Punto seleccionado</span>
              <h2>{selectedMapPoint.name}</h2>
              <p>{selectedMapPoint.city}</p>

              <div className="home-map-info">
                <span>Dirección</span>
                <strong>{selectedMapPoint.address}</strong>
              </div>

              <div className="home-map-info">
                <span>Contacto</span>
                <strong>{selectedMapPoint.contact}</strong>
              </div>

              <a className="home-map-link" href={selectedMapPoint.mapsUrl} target="_blank" rel="noreferrer">
                Ver en Google Maps
              </a>
            </aside>
          </div>
        </section>

        <section id="como-funciona" className="home-flow-section home-section home-section-flow">
          <div className="home-section-head home-flow-head">
            <span className="home-kicker home-kicker-accent">Para vos</span>
            <h2>Comprá, acumulá puntos y volvé cuando quieras</h2>
            <p>Te dejamos una guía simple para que entiendas rápido cómo comprar y cómo usar tus puntos dentro de Ñandé.</p>
          </div>

          <div className="home-flow-steps">
            <div className="home-flow-step">
              <article className="home-flow-card">
                <span className="home-flow-number">01</span>
                <p>Comprás desde la tienda, elegís tus productos y acumulás puntos con cada compra.</p>
              </article>
              <article className="home-flow-detail-card">
                <h3>¿Cómo comprás?</h3>
                <p>Entrás a la tienda online, elegís los productos que querés, confirmás tu pedido para retiro en sucursal y con cada compra acumulás puntos para canjearlos más adelante por otros productos.</p>
                <Link to="/tienda" className="home-flow-action">Comprar</Link>
              </article>
            </div>
            <div className="home-flow-step">
              <article className="home-flow-card">
                <span className="home-flow-number">02</span>
                <p>Canjeás tus puntos por productos y los retirás en la sucursal que selecciones.</p>
              </article>
              <article className="home-flow-detail-card">
                <h3>¿Cómo canjeás?</h3>
                <p>Entrás al catálogo de canjes, elegís el producto que querés usar con tus puntos, lo reservás desde tu cuenta y después lo retirás en la sucursal seleccionada.</p>
                <Link to="/catalogo" className="home-flow-action">Canjear</Link>
              </article>
            </div>
          </div>
        </section>

        {categoriasHome.length > 0 || productosCarouselSource.length > 0 ? (
          <section id="productos-destacados" className="home-section home-section-products">
            <div className="home-section-head home-products-head">
              <h2>Descubri nuestros productos</h2>
            </div>

            {categoriasHome.length > 0 ? (
              <div className="home-category-chips" role="tablist" aria-label="Categorias destacadas">
                {categoriasHome.map((cat) => (
                  <button
                    key={cat.id}
                    className={`home-category-chip${selectedCategoria === cat.nombre ? " is-active" : ""}`}
                    onClick={() => setSelectedCategoria(cat.nombre)}
                    type="button"
                    role="tab"
                    aria-selected={selectedCategoria === cat.nombre}
                  >
                    <span className="home-category-chip-icon" aria-hidden="true">
                      <span className="home-category-chip-icon-inner">
                        {cat.imagen_url ? (
                          <img
                            src={cat.imagen_url.startsWith("http") ? cat.imagen_url : mediaUrl(cat.imagen_url)}
                            alt=""
                            className="home-category-chip-img"
                          />
                        ) : (
                          <span className="home-category-chip-fallback">{cat.nombre.slice(0, 1).toUpperCase()}</span>
                        )}
                      </span>
                    </span>
                    <span className="home-category-chip-label">{cat.nombre}</span>
                  </button>
                ))}
              </div>
            ) : null}

            {productosCarouselSource.length > 0 ? (
              <div className="home-products-carousel" aria-label={selectedCategoria || "Productos destacados"} key={selectedCategoria}>
                <div className={`home-products-grid${productosCarouselSource.length > 1 ? " is-animated" : ""}`}>
                  {productosDestacadosCarousel.map((producto, index) => {
                    const isDuplicate = index >= productosCarouselSource.length;
                    const duplicateTabIndex = isDuplicate ? -1 : undefined;

                    return (
                      <article key={`${producto.id}-${index}`} className="home-product-card" aria-hidden={isDuplicate || undefined}>
                    <div className="home-product-media">
                      <img src={productImage(producto)} alt={producto.nombre} className="home-product-image" />
                      <span className="home-product-category">{producto.categoria || "Ñandé"}</span>
                    </div>
                    <div className="home-product-body">
                      <h3>{producto.nombre}</h3>
                      <p>{producto.descripcion || "Producto disponible para comprar online."}</p>
                      <div className="home-product-meta home-product-meta-static">
                        <div className="home-product-price-row">
                          <span>Precio</span>
                          <strong>{money(producto.precio_dinero)}</strong>
                        </div>
                        {hasFreeShipping(producto) ? (
                          <span className="home-product-free-shipping">Envio gratis</span>
                        ) : null}
                        {canEarnPurchasePoints(producto) ? (
                          <span className="home-product-earned-points">Suma puntos segun el total de la compra</span>
                        ) : null}
                      </div>
                      <div className="home-product-actions">
                        <Link
                          to={`/tienda?producto=${producto.id}`}
                          className="home-product-action home-product-action-secondary"
                          tabIndex={duplicateTabIndex}
                        >
                          Ver producto
                        </Link>
                        <Link
                          to={user ? `/tienda?producto=${producto.id}` : "/login"}
                          className="home-product-action home-product-action-primary"
                          tabIndex={duplicateTabIndex}
                        >
                          Agregar al carrito de compras
                        </Link>
                      </div>
                    </div>
                      </article>
                    );
                  })}
                </div>
              </div>
            ) : productosCategoriaQuery.isFetching ? (
              <div style={{ textAlign: "center", padding: "2rem", color: "#7a5a45" }}>Cargando productos...</div>
            ) : (
              <div style={{ textAlign: "center", padding: "2rem", color: "#7a5a45" }}>No hay productos en esta categoría.</div>
            )}

            <div className="home-products-footer">
              <Link to={selectedCategoria ? `/tienda?categoria=${encodeURIComponent(selectedCategoria)}` : "/tienda"} className="home-flow-action">
                Ver todos los productos{selectedCategoria ? ` de ${selectedCategoria}` : ""}
              </Link>
            </div>
          </section>
        ) : null}

        <section className="home-section home-timeline-section home-section-timeline">
          <div className="home-section-head">
            <span className="home-kicker">Competencias, ferias y presencia</span>
            <h2>Un recorrido visual para contar cómo Ñandé representa su identidad</h2>
            <p>Momentos que definen nuestra historia y nuestra presencia regional.</p>
          </div>

          <div className="home-timeline">
            <div className="home-timeline-line" aria-hidden="true" />
            {timelineEntries.map((entry, index) => (
              <div key={entry.id} className={`home-timeline-row${index % 2 === 1 ? " is-right" : " is-left"}`}>
                <article className="home-timeline-card">
                  <div className="home-timeline-media">
                    {entry.imagen_url ? (
                      <img src={entry.imagen_url.startsWith("http") ? entry.imagen_url : mediaUrl(entry.imagen_url)} alt={entry.titulo} />
                    ) : (
                      <div className="home-timeline-media-placeholder"></div>
                    )}
                  </div>
                  <div className="home-timeline-copy">
                    {entry.badge_text ? <span className="home-timeline-year">{entry.badge_text}</span> : null}
                    <h3>{entry.titulo}</h3>
                    {entry.descripcion ? (
                      <div style={{ whiteSpace: "pre-wrap" }}>{entry.descripcion}</div>
                    ) : null}
                  </div>
                </article>
                <span className="home-timeline-dot" aria-hidden="true" />
              </div>
            ))}
          </div>
        </section>

        {shouldShowCvSection ? (
          <section id="trabaja-con-nosotros" className="home-section home-section-cv">
            <div className="home-cv-shell">
              <div className="home-cv-copy">
                <span className="home-kicker home-kicker-accent">Trabaja con nosotros</span>
                <h2>Dejanos tu CV</h2>
                <p>Si queres sumarte al equipo, podes enviar tus datos y un archivo en PDF, DOC o DOCX. Lo vamos a revisar desde el panel interno.</p>
              </div>

              <form className="home-cv-form" onSubmit={handleCvSubmit}>
                <label className="home-cv-file">
                  <span>{cvFile ? cvFile.name : "Sin archivo seleccionado"}</span>
                  <strong>Seleccionar archivo</strong>
                  <input
                    ref={cvFileInputRef}
                    type="file"
                    accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                    onChange={handleCvFileChange}
                  />
                </label>

                <div className="home-cv-grid">
                  <label>
                    <span>Nombre y apellido*</span>
                    <input
                      required
                      value={cvForm.nombre}
                      onChange={(event) => setCvForm((prev) => ({ ...prev, nombre: event.target.value }))}
                    />
                  </label>
                  <label>
                    <span>E-mail*</span>
                    <input
                      required
                      type="email"
                      value={cvForm.email}
                      onChange={(event) => setCvForm((prev) => ({ ...prev, email: event.target.value }))}
                    />
                  </label>
                </div>

                <label>
                  <span>Telefono</span>
                  <input
                    value={cvForm.telefono}
                    onChange={(event) => setCvForm((prev) => ({ ...prev, telefono: event.target.value }))}
                  />
                </label>

                <label>
                  <span>Mensaje o comentario*</span>
                  <textarea
                    required
                    rows={4}
                    value={cvForm.mensaje}
                    onChange={(event) => setCvForm((prev) => ({ ...prev, mensaje: event.target.value }))}
                  />
                </label>

                <div className="home-cv-actions">
                  <button type="submit" disabled={cvSending}>{cvSending ? "Enviando..." : "Enviar"}</button>
                  {cvStatus ? <p className={`home-cv-status ${cvStatus.type}`}>{cvStatus.text}</p> : null}
                </div>
              </form>
            </div>
          </section>
        ) : null}
      </div>
    </div>
  );
}
