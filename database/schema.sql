-- ============================================================
--  SCHEMA COMPLETO: Sistema de Puntos Ñandé
--  Base de datos: MySQL 8.0
--
--  USO:
--    Docker  → se ejecuta automáticamente al primer arranque
--    phpMyAdmin → Importar este archivo directamente (ya incluye
--                 CREATE DATABASE y USE)
-- ============================================================

CREATE DATABASE IF NOT EXISTS nande_puntos
    CHARACTER SET utf8mb4
    COLLATE utf8mb4_unicode_ci;

USE nande_puntos;

SET FOREIGN_KEY_CHECKS = 0;

-- ============================================================
-- TABLA: usuarios
-- Almacena admins y clientes.
-- codigo_invitacion: código único que cada cliente puede
--   compartir para invitar a otros (generado al registrarse).
-- referido_por: quién lo invitó. Solo se setea una vez.
-- ============================================================
CREATE TABLE IF NOT EXISTS usuarios (
    id                  INT             PRIMARY KEY AUTO_INCREMENT,
    nombre              VARCHAR(100)    NOT NULL,
    email               VARCHAR(150)    NOT NULL UNIQUE,
    password_hash       VARCHAR(255)    NOT NULL,
    rol                 ENUM('admin','cliente') NOT NULL DEFAULT 'cliente',
    dni                 VARCHAR(20)     NULL,
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
        FOREIGN KEY (producto_id) REFERENCES productos(id)
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
-- El campo categoria en productos referencia el nombre aquí.
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

SET FOREIGN_KEY_CHECKS = 1;

-- ============================================================
-- DML: DATOS INICIALES
-- ============================================================

INSERT INTO configuracion (clave, valor, descripcion) VALUES
    ('puntos_referido_invitador', '50',
        'Puntos que recibe el usuario que compartió su código de invitación'),
    ('puntos_referido_invitado', '30',
        'Puntos que recibe el nuevo usuario al registrarse con un código'),
    ('dias_limite_retiro', '7',
        'Días que tiene el cliente para retirar un producto canjeado'),
    ('longitud_codigo_invitacion', '8',
        'Longitud del código de invitación generado automáticamente')
ON DUPLICATE KEY UPDATE clave = clave;

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
-- ADMIN POR DEFECTO
-- Contraseña: admin123 (hash bcrypt rounds=10)
-- Cambiar desde el panel en producción.
-- ============================================================
INSERT INTO usuarios (nombre, email, password_hash, rol, activo)
VALUES (
    'Administrador',
    'admin@nande.com',
    '$2a$10$HEM7Iz0RkrdFwrHLQG0tqONTOohsDZiZnmjDfSIJNOufn0xX/1LlS',
    'admin',
    1
) ON DUPLICATE KEY UPDATE email = email;
