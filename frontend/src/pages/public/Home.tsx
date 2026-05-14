import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { api } from "../../api";
import type { Producto } from "../../types";

type TimelineEntry = {
  year: string;
  title: string;
  text: string;
  detail: string;
  image: string;
};

type LocationImage = {
  src: string;
  alt: string;
};

function productImage(producto: Producto): string {
  return producto.imagenes?.find(Boolean) || producto.imagen_url || "/logo.png";
}

function money(value: number | string | null | undefined): string {
  const n = Number(value ?? 0);
  return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" }).format(Number.isFinite(n) ? n : 0);
}

function rewardPoints(producto: Producto): number {
  const value = Number(producto.puntos_requeridos ?? producto.precio_puntos ?? producto.puntos_para_canjear ?? 0);
  return Number.isFinite(value) ? value : 0;
}

export function Home() {
  useEffect(() => {
    document.body.classList.add("home-background");
    return () => {
      document.body.classList.remove("home-background");
    };
  }, []);

  const productosVentaQuery = useQuery({
    queryKey: ["home", "productos", "venta"],
    queryFn: () => api.get<Producto[]>("/productos?modo=venta"),
    refetchInterval: 15000,
    refetchIntervalInBackground: true,
  });

  const productosDestacados = useMemo(() => {
    const productos = productosVentaQuery.data ?? [];
    const conImagen = productos.filter((producto) => Boolean(producto.imagen_url || producto.imagenes?.length));
    const destacados = conImagen.filter((producto) => producto.destacado_home);
    return (destacados.length ? destacados : conImagen.length ? conImagen : productos).slice(0, 4);
  }, [productosVentaQuery.data]);

  const heroImage = "/hero.webp";
  const locationGallery: LocationImage[] = [
    { src: "/mercado-sabores-frente.jpg", alt: "Frente de Mercado de Sabores en La Unidad" },
    { src: "/nande-la-unidad-puesto.jpg", alt: "Puesto de Ñandé dentro de La Unidad" },
    { src: "/nande-la-unidad-productos.jpg", alt: "Productos de Ñandé en Mercado de Sabores" },
  ];

  const timelineEntries: TimelineEntry[] = [
    {
      year: "2025",
      title: "Representación regional en La Rural Palermo",
      text: "Ñandé participó como representante regional de Corrientes dentro del universo de alfajores en Buenos Aires.",
      detail: "Cuando nos pases las fotos reales de esa presencia, este bloque va a contar la historia con mucha más fuerza visual.",
      image: "/nande_muchas_gracias.webp",
    },
    {
      year: "Ferias",
      title: "Presencia en ferias y encuentros",
      text: "La idea es mostrar movimiento, marca y producto: que se note que Ñandé también representa.",
      detail: "Este bloque ya está preparado para que las imágenes vayan apareciendo mientras el usuario baja por la página.",
      image: "/fondoseguro.png",
    },
    {
      year: "Próximo",
      title: "Más experiencias para contar",
      text: "A medida que carguemos más material, esta línea de tiempo va a quedar mucho más viva y emocional.",
      detail: "Así evitamos una grilla plana y construimos una sección con más ritmo y presencia.",
      image: "/fondocat.png",
    },
  ];

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
  }, []);

  return (
    <div className="home-page">
      <section className="home-hero" aria-label="Imagen principal de Ñandé">
        <img src={heroImage} alt="Imagen principal de Ñandé Alfajores Correntinos" className="home-hero-image" />
      </section>

      <div className="home-content-shell">
        <section className="home-location-section">
          <div className="home-location-head">
            <span className="home-kicker">Dónde encontrarnos</span>
          </div>

          {locationGallery.map((image, index) => (
            <figure key={image.src} className={`home-location-photo home-location-photo-${index + 1}`}>
              <img
                src={image.src}
                alt={image.alt}
                onError={(event) => {
                  event.currentTarget.src = "/logo.png";
                  event.currentTarget.classList.add("is-placeholder");
                }}
              />
            </figure>
          ))}

          <p className="home-location-text">
            Nuestro espacio principal hoy está en La Unidad, un punto ideal para descubrir productos, encontrarnos con la gente y vivir de cerca el sabor de Ñandé.
          </p>
        </section>

        <section id="como-funciona" className="home-flow-section">
          <div className="home-section-head home-flow-head">
            <span className="home-kicker home-kicker-accent">Instrucciones para vos</span>
            <h2>Comprá, acumulá puntos y volvé cuando quieras</h2>
            <p>Te dejamos una guía simple para que entiendas rápido cómo comprar y cómo usar tus puntos dentro de Ñandé.</p>
          </div>

          <div className="home-flow-grid">
            <article className="home-flow-card">
              <span className="home-flow-number">01</span>
              <p>Comprás desde la tienda, elegís tus productos y acumulás puntos con cada compra.</p>
            </article>
            <article className="home-flow-card">
              <span className="home-flow-number">02</span>
              <p>Canjeás tus puntos por productos y los retirás en la sucursal que selecciones.</p>
            </article>
          </div>

          <div className="home-flow-detail-grid">
            <article className="home-flow-detail-card">
              <h3>¿Cómo comprás?</h3>
              <p>Entrás a la tienda online, elegís los productos que querés, confirmás tu pedido para retiro en sucursal y con cada compra acumulás puntos para canjearlos más adelante por otros productos.</p>
            </article>
            <article className="home-flow-detail-card">
              <h3>¿Cómo canjeás?</h3>
              <p>Entrás al catálogo de canjes, elegís el producto que querés usar con tus puntos, lo reservás desde tu cuenta y después lo retirás en la sucursal seleccionada.</p>
            </article>
          </div>
        </section>

        <section id="productos-destacados" className="home-section">
          <div className="home-section-head">
            <span className="home-kicker">Productos destacados</span>
            <h2>Lo que mejor presenta a Ñandé en esta primera vista</h2>
            <p>Acá conviene que elijas productos marcados como destacados para que la selección del home quede realmente curada.</p>
          </div>

          <div className="home-products-grid">
            {productosDestacados.length ? (
              productosDestacados.map((producto) => (
                <article key={producto.id} className="home-product-card">
                  <div className="home-product-media">
                    <img src={productImage(producto)} alt={producto.nombre} className="home-product-image" />
                  </div>
                  <div className="home-product-body">
                    <span className="home-product-category">{producto.categoria || "Ñandé"}</span>
                    <h3>{producto.nombre}</h3>
                    <p>{producto.descripcion || "Producto destacado del catálogo de Ñandé."}</p>
                    <div className="home-product-meta home-product-meta-static">
                      <strong>{money(producto.precio_dinero)}</strong>
                      <span>{rewardPoints(producto) > 0 ? `+${rewardPoints(producto)} pts` : "Selección destacada"}</span>
                    </div>
                  </div>
                </article>
              ))
            ) : (
              Array.from({ length: 4 }).map((_, index) => (
                <article key={`placeholder-${index}`} className="home-product-card">
                  <div className="home-product-media home-product-media-placeholder">
                    <img src="/logo.png" alt="Producto destacado" className="home-product-image home-product-image-placeholder" />
                  </div>
                  <div className="home-product-body">
                    <span className="home-product-category">Ñandé</span>
                    <h3>Producto destacado</h3>
                    <p>Esta tarjeta se va poblando sola con tus productos reales.</p>
                    <div className="home-product-meta home-product-meta-static">
                      <strong>Próximamente</strong>
                      <span>Selección de la casa</span>
                    </div>
                  </div>
                </article>
              ))
            )}
          </div>
        </section>

        <section className="home-section home-timeline-section">
          <div className="home-section-head">
            <span className="home-kicker">Competencias, ferias y presencia</span>
            <h2>Un recorrido visual para contar cómo Ñandé representa su identidad</h2>
            <p>La idea es que mientras bajás, las historias y fotos aparezcan con ritmo, casi como una línea de tiempo viva.</p>
          </div>

          <div className="home-timeline">
            <div className="home-timeline-line" aria-hidden="true" />
            {timelineEntries.map((entry, index) => (
              <article key={`${entry.year}-${entry.title}`} className={`home-timeline-card${index % 2 === 1 ? " is-right" : " is-left"}`}>
                <div className="home-timeline-media">
                  <img src={entry.image} alt={entry.title} />
                </div>
                <div className="home-timeline-copy">
                  <span className="home-timeline-year">{entry.year}</span>
                  <h3>{entry.title}</h3>
                  <p>{entry.text}</p>
                  <p>{entry.detail}</p>
                </div>
              </article>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
