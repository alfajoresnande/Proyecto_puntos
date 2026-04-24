-- ============================================================
--  SCHEMA COMPLETO: Sistema de Puntos Ñandé
--  Base de datos: MySQL 8.0
--
--  USO:
--    Docker  → se ejecuta automáticamente al primer arranque
--    phpMyAdmin → Importar este archivo directamente
--
--  Para reset completo: ejecutar primero la sección DOWN,
--  luego la sección UP (o importar este archivo entero).
-- ============================================================

CREATE DATABASE IF NOT EXISTS nande_puntos
    CHARACTER SET utf8mb4
    COLLATE utf8mb4_unicode_ci;

USE nande_puntos;

-- ============================================================
-- DOWN — elimina todo en orden inverso de dependencias
-- ============================================================

SET FOREIGN_KEY_CHECKS = 0;

DROP TABLE IF EXISTS movimientos_puntos;
DROP TABLE IF EXISTS canjes;
DROP TABLE IF EXISTS sucursales;
DROP TABLE IF EXISTS referidos;
DROP TABLE IF EXISTS usos_codigos;
DROP TABLE IF EXISTS codigos_puntos;
DROP TABLE IF EXISTS password_reset_tokens;
DROP TABLE IF EXISTS categorias;
DROP TABLE IF EXISTS paginas_contenido;
DROP TABLE IF EXISTS configuracion;
DROP TABLE IF EXISTS producto_imagenes;
DROP TABLE IF EXISTS productos;
DROP TABLE IF EXISTS usuarios;

SET FOREIGN_KEY_CHECKS = 1;

-- ============================================================
-- UP — crea todas las tablas
-- ============================================================

-- ============================================================
-- TABLA: usuarios
-- Almacena admins, vendedores y clientes.
-- codigo_invitacion: código único que cada cliente puede
--   compartir para invitar a otros (generado al registrarse).
-- referido_por: quién lo invitó. Solo se setea una vez.
-- ============================================================
CREATE TABLE IF NOT EXISTS usuarios (
    id                  INT             PRIMARY KEY AUTO_INCREMENT,
    nombre              VARCHAR(100)    NOT NULL,
    email               VARCHAR(150)    NOT NULL UNIQUE,
    google_id           VARCHAR(255)    NULL UNIQUE,
    password_hash       VARCHAR(255)    NOT NULL,
    rol                 ENUM('admin','vendedor','cliente') NOT NULL DEFAULT 'cliente',
    dni                 VARCHAR(20)     NULL,
    telefono            VARCHAR(25)     NULL,
    puntos_saldo        INT             NOT NULL DEFAULT 0,
    codigo_invitacion   VARCHAR(20)     NULL UNIQUE,
    referido_por        INT             NULL,
    activo              TINYINT(1)      NOT NULL DEFAULT 1,
    created_at          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_usuario_referido
        FOREIGN KEY (referido_por) REFERENCES usuarios(id)
        ON DELETE SET NULL
);

-- ============================================================
-- TABLA: password_reset_tokens
-- Tokens de un solo uso para recuperacion segura de contrasena.
-- Se almacena hash del token (nunca el token en claro).
-- ============================================================
CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id                      BIGINT          PRIMARY KEY AUTO_INCREMENT,
    usuario_id              INT             NOT NULL,
    token_hash              CHAR(64)        NOT NULL UNIQUE,
    expires_at              DATETIME        NOT NULL,
    used_at                 DATETIME        NULL,
    requested_ip            VARCHAR(64)     NULL,
    requested_user_agent    VARCHAR(255)    NULL,
    created_at              DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_pwd_reset_usuario
        FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
        ON DELETE CASCADE
);

CREATE INDEX idx_pwd_reset_usuario_estado
    ON password_reset_tokens (usuario_id, used_at, expires_at);

-- ============================================================
-- TABLA: productos
-- Sin stock. La disponibilidad se gestiona en cada canje.
-- activo = 0 oculta el producto del catálogo.
-- ============================================================
CREATE TABLE IF NOT EXISTS productos (
    id                  INT             PRIMARY KEY AUTO_INCREMENT,
    nombre              VARCHAR(150)    NOT NULL,
    descripcion         TEXT            NULL,
    imagen_url          VARCHAR(255)    NULL,
    categoria           VARCHAR(100)    NULL,
    puntos_requeridos   INT             NOT NULL,
    puntos_acumulables  INT             NULL,
    activo              TINYINT(1)      NOT NULL DEFAULT 1,
    created_at          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- TABLA: producto_imagenes
-- Hasta 3 imagenes por producto ordenadas (1..3).
-- ============================================================
CREATE TABLE IF NOT EXISTS producto_imagenes (
    id                  INT             PRIMARY KEY AUTO_INCREMENT,
    producto_id         INT             NOT NULL,
    imagen_url          VARCHAR(255)    NOT NULL,
    orden               TINYINT UNSIGNED NOT NULL DEFAULT 1,
    created_at          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_producto_imagenes_producto
        FOREIGN KEY (producto_id) REFERENCES productos(id)
        ON DELETE CASCADE,
    CONSTRAINT uq_producto_imagen_orden
        UNIQUE (producto_id, orden)
);

-- ============================================================
-- TABLA: codigos_puntos
-- Códigos generados por el admin con valor en puntos.
-- usos_maximos = 0 significa ilimitado.
-- fecha_expiracion NULL = sin vencimiento.
-- ============================================================
CREATE TABLE IF NOT EXISTS codigos_puntos (
    id                  INT             PRIMARY KEY AUTO_INCREMENT,
    codigo              VARCHAR(50)     NOT NULL UNIQUE,
    puntos_valor        INT             NOT NULL,
    usos_maximos        INT             NOT NULL DEFAULT 1,
    usos_actuales       INT             NOT NULL DEFAULT 0,
    fecha_expiracion    DATETIME        NULL,
    creado_por          INT             NOT NULL,
    activo              TINYINT(1)      NOT NULL DEFAULT 1,
    created_at          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_codigo_creador
        FOREIGN KEY (creado_por) REFERENCES usuarios(id)
);

-- ============================================================
-- TABLA: usos_codigos
-- Registro de qué usuario usó qué código y cuándo.
-- La constraint UNIQUE evita que el mismo usuario
--   use el mismo código más de una vez.
-- ============================================================
CREATE TABLE IF NOT EXISTS usos_codigos (
    id                  INT             PRIMARY KEY AUTO_INCREMENT,
    codigo_id           INT             NOT NULL,
    usuario_id          INT             NOT NULL,
    created_at          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_uso_codigo
        FOREIGN KEY (codigo_id)   REFERENCES codigos_puntos(id),
    CONSTRAINT fk_uso_usuario
        FOREIGN KEY (usuario_id)  REFERENCES usuarios(id),
    CONSTRAINT uq_uso_unico
        UNIQUE (codigo_id, usuario_id)
);

-- ============================================================
-- TABLA: referidos
-- Registra cada relación invitador → invitado.
-- invitado_id es UNIQUE: un usuario solo puede haber
--   sido invitado una vez.
-- ============================================================
CREATE TABLE IF NOT EXISTS referidos (
    id                  INT             PRIMARY KEY AUTO_INCREMENT,
    invitador_id        INT             NOT NULL,
    invitado_id         INT             NOT NULL UNIQUE,
    puntos_invitador    INT             NOT NULL,
    puntos_invitado     INT             NOT NULL,
    created_at          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_ref_invitador
        FOREIGN KEY (invitador_id) REFERENCES usuarios(id),
    CONSTRAINT fk_ref_invitado
        FOREIGN KEY (invitado_id)  REFERENCES usuarios(id)
);

-- ============================================================
-- TABLA: sucursales
-- Sucursales físicas donde se retiran canjes.
-- ============================================================
CREATE TABLE IF NOT EXISTS sucursales (
    id                  INT             PRIMARY KEY AUTO_INCREMENT,
    nombre              VARCHAR(120)    NOT NULL,
    direccion           VARCHAR(180)    NOT NULL,
    piso                VARCHAR(30)     NULL,
    localidad           VARCHAR(120)    NOT NULL,
    provincia           VARCHAR(120)    NOT NULL,
    activo              TINYINT(1)      NOT NULL DEFAULT 1,
    created_at          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP
                                        ON UPDATE CURRENT_TIMESTAMP
);

-- ============================================================
-- TABLA: canjes
-- Solicitudes de canje de puntos por productos.
--
-- Estados:
--   pendiente     → solicitado, esperando retiro        (no devuelve puntos)
--   entregado     → el cliente retiró el producto       (no devuelve puntos)
--   no_disponible → no había disponibilidad al retirar  (SÍ devuelve puntos)
--   expirado      → venció el plazo de retiro           (no devuelve puntos)
--   cancelado     → cancelado                           (SÍ devuelve puntos)
-- ============================================================
CREATE TABLE IF NOT EXISTS canjes (
    id                  INT             PRIMARY KEY AUTO_INCREMENT,
    usuario_id          INT             NOT NULL,
    producto_id         INT             NOT NULL,
    sucursal_id         INT             NULL,
    codigo_retiro       VARCHAR(9)      NOT NULL UNIQUE,
    puntos_usados       INT             NOT NULL,
    estado              ENUM('pendiente','entregado','no_disponible','expirado','cancelado')
                                        NOT NULL DEFAULT 'pendiente',
    fecha_limite_retiro DATETIME        NOT NULL,
    notas               TEXT            NULL,
    created_at          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP
                                        ON UPDATE CURRENT_TIMESTAMP,

    CONSTRAINT fk_canje_usuario
        FOREIGN KEY (usuario_id)  REFERENCES usuarios(id),
    CONSTRAINT fk_canje_producto
        FOREIGN KEY (producto_id) REFERENCES productos(id),
    CONSTRAINT fk_canje_sucursal
        FOREIGN KEY (sucursal_id) REFERENCES sucursales(id)
        ON DELETE SET NULL
);

-- ============================================================
-- TABLA: movimientos_puntos
-- Historial completo e inmutable de todos los movimientos.
--
-- Tipos:
--   asignacion_manual   → admin suma/resta puntos directo
--   codigo_canje        → cliente canjeó un código de puntos
--   referido_invitador  → puntos por haber invitado a alguien
--   referido_invitado   → puntos por haberse registrado con código
--   canje_producto      → puntos descontados al pedir un producto
--   devolucion_canje    → puntos reintegrados (no_disponible/cancelado)
--   ajuste              → corrección manual sin categoría específica
-- ============================================================
CREATE TABLE IF NOT EXISTS movimientos_puntos (
    id                  INT             PRIMARY KEY AUTO_INCREMENT,
    usuario_id          INT             NOT NULL,
    tipo                ENUM(
                            'asignacion_manual',
                            'codigo_canje',
                            'referido_invitador',
                            'referido_invitado',
                            'canje_producto',
                            'devolucion_canje',
                            'ajuste'
                        )               NOT NULL,
    puntos              INT             NOT NULL,
    descripcion         VARCHAR(255)    NULL,
    referencia_id       INT             NULL,
    referencia_tipo     VARCHAR(50)     NULL,
    creado_por          INT             NULL,
    created_at          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_mov_usuario
        FOREIGN KEY (usuario_id)  REFERENCES usuarios(id),
    CONSTRAINT fk_mov_creador
        FOREIGN KEY (creado_por)  REFERENCES usuarios(id)
);

-- ============================================================
-- TABLA: configuracion
-- Parámetros globales del sistema editables desde el panel.
-- ============================================================
CREATE TABLE IF NOT EXISTS configuracion (
    clave               VARCHAR(100)    PRIMARY KEY,
    valor               VARCHAR(255)    NOT NULL,
    descripcion         TEXT            NULL
);

-- ============================================================
-- TABLA: categorias
-- Categorías de productos gestionadas desde el panel admin.
-- ============================================================
CREATE TABLE IF NOT EXISTS categorias (
    id                  INT             PRIMARY KEY AUTO_INCREMENT,
    nombre              VARCHAR(100)    NOT NULL UNIQUE,
    descripcion         TEXT            NULL,
    created_at          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- TABLA: paginas_contenido
-- Páginas editables desde el panel admin (markdown).
-- slug: identificador único ('sobre-nosotros', 'terminos').
-- ============================================================
CREATE TABLE IF NOT EXISTS paginas_contenido (
    slug        VARCHAR(50)     PRIMARY KEY,
    titulo      VARCHAR(200)    NOT NULL,
    contenido   LONGTEXT        NOT NULL,
    updated_at  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP
                                ON UPDATE CURRENT_TIMESTAMP
);

-- ============================================================
-- SEED: configuración global
-- ============================================================

INSERT INTO configuracion (clave, valor, descripcion) VALUES
    ('puntos_referido_invitador', '50',
        'Puntos que recibe el usuario que compartió su código de invitación'),
    ('puntos_referido_invitado', '30',
        'Puntos que recibe el nuevo usuario al registrarse con un código'),
    ('dias_limite_retiro', '7',
        'Días que tiene el cliente para retirar un producto canjeado'),
    ('lugar_retiro_canje', 'Corrientes, Argentina',
        'Lugar físico donde el cliente debe retirar productos canjeados'),
    ('longitud_codigo_invitacion', '9',
        'Longitud del código de invitación generado automáticamente')
ON DUPLICATE KEY UPDATE valor = VALUES(valor);

INSERT INTO sucursales (nombre, direccion, piso, localidad, provincia, activo)
SELECT
  'Sucursal principal',
  'Corrientes 1234',
  NULL,
  'Corrientes',
  'Corrientes',
  1
WHERE NOT EXISTS (SELECT 1 FROM sucursales);

-- ============================================================
-- SEED: páginas de contenido
-- ============================================================

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

-- ============================================================
-- SEED: usuarios de prueba
--
-- admin      → email: admin@nande.com      / pass: admin123
-- vendedor   → email: vendedor@nande.com   / pass: vendedor123
-- cliente    → email: cliente@nande.com    / pass: cliente123
--
-- ¡Cambiar contraseñas antes de producción!
-- ============================================================

INSERT INTO usuarios (nombre, email, password_hash, rol, activo) VALUES
(
    'Administrador',
    'admin@nande.com',
    '$2a$10$HEM7Iz0RkrdFwrHLQG0tqONTOohsDZiZnmjDfSIJNOufn0xX/1LlS',
    'admin',
    1
),
(
    'Vendedor Demo',
    'vendedor@nande.com',
    '$2a$10$ieKqT4knbgcClgVfOKEeE.IxAXQM95q76j3KGFtpY1W7XyQQ0wyK6',
    'vendedor',
    1
),
(
    'Cliente Demo',
    'cliente@nande.com',
    '$2a$10$6yOzuxgZ6g4PqPOeGVXYoOwEr7I0NVEbuJU7744z3qqZbxglkF1Jy',
    'cliente',
    1
)
ON DUPLICATE KEY UPDATE email = email;
