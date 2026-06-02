import { useEffect } from "react";
import "../../styles/parallax-nosotros.css";

export function SobreNosotros() {
  useEffect(() => {
    // Optionally remove any background classes that might interfere from the body
    document.body.classList.remove("catalogo-background");
  }, []);

  return (
    <div className="parallax-container">
      {/* SECCIÓN 1: Introducción */}
      <section className="parallax-section bg-intro">
        <div className="parallax-content">
          <h2>¿Quiénes Somos?</h2>
          <p>
            Nuestra empresa surgió en 2010 como un emprendimiento familiar, elaborando diferentes 
            productos de pastelería, con la idea de siempre utilizar materia prima regional y, 
            particularmente, crear un producto que llegue a representarnos como CORRENTINOS.
          </p>
          <p>
            De ahí decidimos crear alfajores ya que era un producto destacado en cada provincia 
            Argentina, y porqué no?, tener uno propio de Corrientes, no solo queríamos hacer los 
            clásicos de chocolate y dulce de leche, sino también de otros sabores como el Mamón, el 
            Maracuyá y la Yerba Mate. Estos productos típicos y característicos de la región, hacen a 
            nuestros alfajores únicos y representativos de nuestra provincia.
          </p>
          <p>
            Nuestros alfajores son elaborados artesanalmente, están hechos a base de fécula de 
            mandioca y harina de trigo, son reducidos en gluten, eso los hace más 
            livianos favoreciendo la digestión y proponen ser una alternativa deliciosa y diferente.
          </p>
          <p>
            Los Alfajores regionales Ñandé son ideales para obsequiar o llevarse como recuerdo de 
            Corrientes, así como para disfrutar en el momento del postre, para acompañar con un mate,
            un té, un café, con amigos y familiares. También ofrecemos combos y hacemos acciones
            colaborativas con productos de otras empresas.
          </p>
        </div>
      </section>

      {/* SECCIÓN 2: Elaboración */}
      <section className="parallax-section bg-elaboracion">
        <div className="parallax-content">
          <h2>Nuestra Elaboración</h2>
          <p>
            En cuanto a nuestros productos, procuramos lograr excelentes alimentos. Para ello, utilizamos
            únicamente insumos de primera calidad, materia prima regional dentro de lo posible,
            siguiendo estrictas normas de higiene en cada proceso, así como controles del estado del 
            producto en cada etapa de su elaboración.
          </p>
          <p>
            Todos nuestros productos pasan por estrictas pruebas
            de laboratorio, tienen sus registros y permisos habilitados (RNPA / RNE). Buscamos que todo lo
            que hacemos se destaque por su buen sabor así como por la presentación. Así pretendemos
            que la experiencia de consumir nuestros productos sea grata y placentera desde el primer momento.
          </p>
        </div>
      </section>

      {/* SECCIÓN 3: Significado y Diferencia */}
      <section className="parallax-section bg-significado">
        <div className="parallax-content">
          <h2>Ñandé: Lo Nuestro</h2>
          <p>
            En guaraní, "ñandé" significa "nuestro” / “nosotros" en un sentido inclusivo, es decir, que 
            elegimos este nombre por la utilización de materia prima prácticamente en un 80 a 90 % 
            propias de suelo Correntino, incentivando a productores locales a seguir produciendo
            frutas, y productos locales tales como el maracuyá, Hibiscus, mamón, pitanga, guayaba y 
            fécula de mandioca entre otros.
          </p>
          <h2 style={{ marginTop: '2rem', fontSize: '2rem' }}>Diferentes</h2>
          <p>
            Cuando decidimos que queríamos hacer un alfajor, teníamos una meta clara,
            y era hacer algo que se distinguiera de los alfajores convencionales y a la vez que nos 
            representara como Provincia. Es por eso que decidimos, no solo fabricar alfajores, 
            sino también utilizar materias primas de nuestra región.
          </p>
        </div>
      </section>

      {/* SECCIÓN 4: Calidad y Sabor */}
      <section className="parallax-section bg-calidad">
        <div className="parallax-content">
          <h2>Calidad y Sabor</h2>
          <p>
            <strong>Calidad:</strong> Nuestra intención en cada producto elaborado es mantener al máximo la calidad, procuramos 
            usar las mejores materias primas, así como controlar los alfajores en cada etapa de su 
            fabricación. De esta manera pretendemos que la experiencia del consumidor sea lo más 
            perfecta posible.
          </p>
          <p>
            <strong>Sabor:</strong> Las recetas de nuestros alfajores artesanales son completamente originales. Cada 
            ingrediente, mermeladas y cremas con las que elaboramos los rellenos son calculados 
            para que tengan la proporción justa. Los chocolates, la humedad lograda en la galleta 
            producto de la proporción exacta de Fécula de Mandioca y Harina de Trigo, así como la 
            calidad de cada insumo utilizado, son medidos con el mejor de los cuidados 
            para que en cada tanda de elaboración siempre sea lo mismo.
          </p>
        </div>
      </section>
    </div>
  );
}
