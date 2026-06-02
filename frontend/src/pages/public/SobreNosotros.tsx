import { useEffect, useRef } from "react";
import "../../styles/parallax-nosotros.css";

// Un simple hook para animar elementos al hacer scroll
function useFadeInOnScroll() {
  const refs = useRef<(HTMLElement | null)[]>([]);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("fade-in-visible");
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.2 } // Se dispara cuando el 20% del elemento es visible
    );

    refs.current.forEach((ref) => {
      if (ref) observer.observe(ref);
    });

    return () => observer.disconnect();
  }, []);

  return refs;
}

export function SobreNosotros() {
  const animatedRefs = useFadeInOnScroll();

  useEffect(() => {
    document.body.classList.remove("catalogo-background");
  }, []);

  // Helper para asignar los refs dinámicamente
  const setRef = (index: number) => (el: HTMLElement | null) => {
    animatedRefs.current[index] = el;
  };

  return (
    <div className="parallax-container">
      {/* SECCIÓN 1: Introducción */}
      <section className="parallax-section bg-intro">
        <div className="parallax-content transparent-box" ref={setRef(0)}>
          <h2 className="animated-title">ORGULLOSAMENTE CORRENTINOS</h2>
          <p className="lead-text">
            Nacimos en 2010 como un sueño familiar: crear un alfajor que nos represente. 
            Materia prima regional, sabores autóctonos y el corazón de Corrientes en cada bocado.
          </p>
        </div>
      </section>

      {/* SECCIÓN 2: Elaboración */}
      <section className="parallax-section bg-elaboracion">
        <div className="parallax-content floating-box" ref={setRef(1)}>
          <h2 className="animated-title">ARTESANALES & LIVIANOS</h2>
          <p>
            Hechos a base de fécula de mandioca y harina de trigo. Reducidos en gluten, 
            más livianos y fáciles de digerir. Una alternativa diferente pensada para disfrutar.
          </p>
        </div>
      </section>

      {/* SECCIÓN 3: Significado y Diferencia */}
      <section className="parallax-section bg-significado">
        <div className="parallax-content transparent-box" ref={setRef(2)}>
          <h2 className="animated-title">ÑANDÉ: LO NUESTRO</h2>
          <p className="lead-text">
            Elaboramos con un 90% de ingredientes de suelo correntino: mamón, maracuyá, yerba mate y guayaba. 
            Incentivamos la producción local para ofrecer un sabor auténtico.
          </p>
        </div>
      </section>

      {/* SECCIÓN 4: Calidad y Sabor */}
      <section className="parallax-section bg-calidad">
        <div className="parallax-content floating-box" ref={setRef(3)}>
          <h2 className="animated-title">CALIDAD INIGUALABLE</h2>
          <p>
            Recetas originales y estrictos controles en cada etapa. Logramos la proporción exacta 
            de humedad y sabor para que tu experiencia siempre sea placentera.
          </p>
        </div>
      </section>
      {/* SECCIÓN 5: Bienvenida a la familia */}
      <section className="parallax-section bg-familia">
        <div className="parallax-content transparent-box" ref={setRef(4)}>
          <h2 className="animated-title">¡BIENVENIDOS A LA FAMILIA ÑANDÉ!</h2>
        </div>
      </section>
    </div>
  );
}
