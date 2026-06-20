CREATE TABLE IF NOT EXISTS arrepentimiento_solicitudes (
  codigo_tramite CHAR(36) PRIMARY KEY,
  numero_orden VARCHAR(80) NOT NULL,
  nombre_apellido VARCHAR(160) NOT NULL,
  email VARCHAR(160) NOT NULL,
  telefono VARCHAR(40) NOT NULL,
  mensaje TEXT NOT NULL,
  estado ENUM('pendiente','revisado','resuelto') NOT NULL DEFAULT 'pendiente',
  ip_origen VARCHAR(64) NULL,
  user_agent VARCHAR(255) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_arrepentimiento_created_at (created_at),
  INDEX idx_arrepentimiento_email_created_at (email, created_at),
  INDEX idx_arrepentimiento_numero_orden (numero_orden),
  INDEX idx_arrepentimiento_estado_created_at (estado, created_at)
);

INSERT INTO paginas_contenido (slug, titulo, contenido) VALUES
(
  'politica-privacidad',
  'Politica de Privacidad',
  '# Politica de Privacidad

*Ultima actualizacion: 20 de junio de 2026*

En esta seccion puedes publicar como Nande / Alfajores Correntinos recopila, usa, comparte, protege y conserva los datos personales de clientes y visitantes.

## Que datos se pueden recopilar

- Datos de registro y contacto.
- Informacion de compras, pedidos y canjes.
- Datos necesarios para soporte, envios y facturacion.

## Para que se usan

- Gestionar pedidos, canjes y consultas.
- Coordinar envios, retiros y soporte.
- Mejorar el funcionamiento del sitio y cumplir obligaciones legales.

## Derechos de la persona usuaria

Puedes solicitar actualizacion, rectificacion o eliminacion de datos cuando corresponda segun la normativa aplicable.

## Contacto

Para consultas sobre privacidad, puedes comunicarte por los canales oficiales publicados en la tienda.'
)
ON DUPLICATE KEY UPDATE slug = slug;
