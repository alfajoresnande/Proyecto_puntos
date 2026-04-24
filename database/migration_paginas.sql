-- Ejecutar este script si la tabla paginas_contenido no existe todavía
-- docker exec -i <contenedor_mysql> mysql -u root -p nande_puntos < migration_paginas.sql

CREATE TABLE IF NOT EXISTS paginas_contenido (
    slug        VARCHAR(50)     PRIMARY KEY,
    titulo      VARCHAR(200)    NOT NULL,
    contenido   LONGTEXT        NOT NULL,
    updated_at  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP
                                ON UPDATE CURRENT_TIMESTAMP
);

INSERT INTO paginas_contenido (slug, titulo, contenido) VALUES
(
  'sobre-nosotros',
  'Sobre Nosotros',
  '# Sobre Nosotros\n\nÑandé nació en 1987 como un pequeño emprendimiento familiar dedicado a la elaboración artesanal de alfajores, dulces y chocolates en el Nordeste Argentino. El nombre "Ñandé" proviene del guaraní y significa **"nuestro"** — porque creemos que el sabor y la tradición nos pertenecen a todos.\n\n## Nuestra Misión\n\nElaborar productos artesanales de la más alta calidad, preservando las recetas tradicionales y el sabor auténtico que nos caracteriza, generando un vínculo real con quienes eligen Ñandé.\n\n## Programa de Puntos\n\nEl Programa de Puntos Ñandé nació para recompensar la fidelidad de nuestros clientes. Cada compra acumula puntos que podés canjear por productos exclusivos de nuestra casa.\n\n## Contacto\n\n- 📍 Corrientes, Argentina\n- 📞 +54 379 463-2610\n- 📸 [@alfajorescorrentinos](https://www.instagram.com/alfajorescorrentinos/)'
),
(
  'terminos',
  'Términos y Condiciones',
  '# Términos y Condiciones del Programa de Puntos\n\n*Última actualización: 2025*\n\n## 1. Aceptación\n\nAl registrarse en el Programa de Puntos Ñandé, el usuario acepta los presentes términos y condiciones en su totalidad.\n\n## 2. Acumulación de Puntos\n\nLos puntos se acumulan por compras realizadas en locales habilitados de Ñandé. El valor de los puntos por producto es determinado por Ñandé y puede modificarse sin previo aviso.\n\n## 3. Canje de Puntos\n\nLos puntos pueden canjearse por productos disponibles en el catálogo de la plataforma. Para completar el canje, el cliente debe retirar el producto en el local dentro del plazo establecido.\n\n## 4. Vencimiento de Canjes\n\nUna vez solicitado el canje, el cliente tiene **7 días hábiles** para retirar el producto. Transcurrido ese plazo, el canje expira y los puntos **no serán reintegrados**.\n\n## 5. Códigos Promocionales\n\nLos códigos promocionales son de uso personal e intransferible. Cada código puede utilizarse una sola vez por usuario, salvo indicación contraria.\n\n## 6. Códigos de Referidos\n\nAl compartir tu código de invitación, podés ganar puntos cada vez que un nuevo usuario se registre. Los puntos se acreditan automáticamente.\n\n## 7. Modificaciones\n\nÑandé se reserva el derecho de modificar los presentes términos en cualquier momento, notificando a los usuarios a través de la plataforma.\n\n## 8. Contacto\n\nPara consultas, contactarse a través de WhatsApp al +54 379 463-2610.'
)
ON DUPLICATE KEY UPDATE slug = slug;
