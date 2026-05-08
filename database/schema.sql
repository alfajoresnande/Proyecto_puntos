-- ============================================================
--  SCHEMA COMPLETO: Sistema de Puntos Ñandé
--  Base de datos: MySQL 8.0

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
    rol                 ENUM('admin','superAdmin','vendedor','cliente') NOT NULL DEFAULT 'cliente',
    dni                 VARCHAR(20)     NULL,
    telefono            VARCHAR(25)     NULL,
    fecha_nacimiento    DATE            NULL,
    localidad           VARCHAR(120)    NULL,
    provincia           VARCHAR(120)    NULL,
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
    sku                 VARCHAR(64)     NULL UNIQUE,
    descripcion         TEXT            NULL,
    imagen_url          VARCHAR(255)    NULL,
    categoria           VARCHAR(100)    NULL,
    tipo_producto       ENUM('canje','venta','mixto')
                                        NOT NULL DEFAULT 'canje',
    puntos_requeridos   INT             NOT NULL,
    puntos_acumulables  INT             NULL,
    precio_dinero       DECIMAL(10,2)   NULL,
    precio_puntos       INT             NULL,
    puntos_para_canjear INT             NULL,
    puntaje_al_comprar  INT             NULL,
    stock_disponible    INT             NOT NULL DEFAULT 0,
    stock_reservado     INT             NOT NULL DEFAULT 0,
    track_stock         TINYINT(1)      NOT NULL DEFAULT 1,
    permite_envio       TINYINT(1)      NOT NULL DEFAULT 0,
    permite_retiro_local TINYINT(1)     NOT NULL DEFAULT 1,
    activo              TINYINT(1)      NOT NULL DEFAULT 1,
    created_at          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP
                                        ON UPDATE CURRENT_TIMESTAMP
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
-- TABLA: canje_items
-- Detalle de productos por canje (soporta carrito con multiples
-- productos y cantidades en un unico codigo de retiro).
-- ============================================================
CREATE TABLE IF NOT EXISTS canje_items (
    id                  INT             PRIMARY KEY AUTO_INCREMENT,
    canje_id            INT             NOT NULL,
    producto_id         INT             NOT NULL,
    cantidad            INT             NOT NULL DEFAULT 1,
    puntos_unitarios    INT             NOT NULL,
    puntos_total        INT             NOT NULL,
    created_at          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_canje_items_canje
        FOREIGN KEY (canje_id) REFERENCES canjes(id)
        ON DELETE CASCADE,
    CONSTRAINT fk_canje_items_producto
        FOREIGN KEY (producto_id) REFERENCES productos(id)
        ON DELETE RESTRICT,
    CONSTRAINT uq_canje_items_producto
        UNIQUE (canje_id, producto_id)
);

-- ============================================================
-- TABLA: inventario_sucursal
-- Stock disponible y reservado por sucursal/local.
-- ============================================================
CREATE TABLE IF NOT EXISTS inventario_sucursal (
    id                  BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
    producto_id         INT             NOT NULL,
    sucursal_id         INT             NOT NULL,
    stock_disponible    INT             NOT NULL DEFAULT 0,
    stock_reservado     INT             NOT NULL DEFAULT 0,
    created_at          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP
                                        ON UPDATE CURRENT_TIMESTAMP,

    CONSTRAINT fk_inventario_producto
        FOREIGN KEY (producto_id) REFERENCES productos(id)
        ON DELETE CASCADE,
    CONSTRAINT fk_inventario_sucursal
        FOREIGN KEY (sucursal_id) REFERENCES sucursales(id)
        ON DELETE CASCADE,
    CONSTRAINT uq_inventario_producto_sucursal
        UNIQUE (producto_id, sucursal_id)
);

-- ============================================================
-- TABLAS: carrito / ordenes / pagos
-- Soportan compra online con dinero, canje por puntos y ordenes mixtas.
-- ============================================================
CREATE TABLE IF NOT EXISTS carritos (
    id                  BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
    usuario_id          INT             NOT NULL,
    estado              ENUM('activo','convertido','abandonado')
                                        NOT NULL DEFAULT 'activo',
    created_at          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP
                                        ON UPDATE CURRENT_TIMESTAMP,

    CONSTRAINT fk_carrito_usuario
        FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
        ON DELETE CASCADE,
    INDEX idx_carritos_usuario_estado (usuario_id, estado, updated_at)
);

CREATE TABLE IF NOT EXISTS carrito_items (
    id                  BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
    carrito_id          BIGINT UNSIGNED NOT NULL,
    producto_id         INT             NOT NULL,
    cantidad            INT             NOT NULL DEFAULT 1,
    modo_compra         ENUM('dinero','puntos') NOT NULL,
    precio_dinero_unit  DECIMAL(10,2)   NULL,
    precio_puntos_unit  INT             NULL,
    subtotal_dinero     DECIMAL(10,2)   NOT NULL DEFAULT 0,
    subtotal_puntos     INT             NOT NULL DEFAULT 0,
    created_at          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP
                                        ON UPDATE CURRENT_TIMESTAMP,

    CONSTRAINT fk_carrito_items_carrito
        FOREIGN KEY (carrito_id) REFERENCES carritos(id)
        ON DELETE CASCADE,
    CONSTRAINT fk_carrito_items_producto
        FOREIGN KEY (producto_id) REFERENCES productos(id)
        ON DELETE RESTRICT,
    CONSTRAINT uq_carrito_item_producto_modo
        UNIQUE (carrito_id, producto_id, modo_compra)
);

CREATE TABLE IF NOT EXISTS ordenes (
    id                  BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
    usuario_id          INT             NOT NULL,
    carrito_id          BIGINT UNSIGNED NULL,
    canal               ENUM('web','admin','vendedor') NOT NULL DEFAULT 'web',
    tipo_orden          ENUM('canje','venta','mixta') NOT NULL DEFAULT 'canje',
    estado              ENUM('borrador','pendiente_pago','pagada','preparada','enviada','entregada','cancelada','expirada')
                                        NOT NULL DEFAULT 'borrador',
    moneda              VARCHAR(8)      NOT NULL DEFAULT 'ARS',
    total_dinero        DECIMAL(10,2)   NOT NULL DEFAULT 0,
    total_puntos        INT             NOT NULL DEFAULT 0,
    direccion_envio_json JSON           NULL,
    sucursal_retiro_id  INT             NULL,
    notas               TEXT            NULL,
    created_at          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP
                                        ON UPDATE CURRENT_TIMESTAMP,

    CONSTRAINT fk_orden_usuario
        FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
        ON DELETE RESTRICT,
    CONSTRAINT fk_orden_carrito
        FOREIGN KEY (carrito_id) REFERENCES carritos(id)
        ON DELETE SET NULL,
    CONSTRAINT fk_orden_sucursal
        FOREIGN KEY (sucursal_retiro_id) REFERENCES sucursales(id)
        ON DELETE SET NULL,
    INDEX idx_ordenes_usuario_created_at (usuario_id, created_at),
    INDEX idx_ordenes_estado_created_at (estado, created_at)
);

CREATE TABLE IF NOT EXISTS orden_items (
    id                  BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
    orden_id            BIGINT UNSIGNED NOT NULL,
    producto_id         INT             NOT NULL,
    cantidad            INT             NOT NULL DEFAULT 1,
    modo_compra         ENUM('dinero','puntos') NOT NULL,
    precio_dinero_unit  DECIMAL(10,2)   NULL,
    precio_puntos_unit  INT             NULL,
    subtotal_dinero     DECIMAL(10,2)   NOT NULL DEFAULT 0,
    subtotal_puntos     INT             NOT NULL DEFAULT 0,
    created_at          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_orden_items_orden
        FOREIGN KEY (orden_id) REFERENCES ordenes(id)
        ON DELETE CASCADE,
    CONSTRAINT fk_orden_items_producto
        FOREIGN KEY (producto_id) REFERENCES productos(id)
        ON DELETE RESTRICT,
    CONSTRAINT uq_orden_item_producto_modo
        UNIQUE (orden_id, producto_id, modo_compra)
);

CREATE TABLE IF NOT EXISTS pagos (
    id                  BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
    orden_id            BIGINT UNSIGNED NOT NULL,
    proveedor           VARCHAR(40)     NOT NULL,
    metodo              VARCHAR(40)     NULL,
    estado              ENUM('iniciado','aprobado','rechazado','reembolsado')
                                        NOT NULL DEFAULT 'iniciado',
    monto               DECIMAL(10,2)   NOT NULL,
    moneda              VARCHAR(8)      NOT NULL DEFAULT 'ARS',
    provider_payment_id VARCHAR(120)    NULL,
    checkout_url        VARCHAR(500)    NULL,
    payload_json        JSON            NULL,
    created_at          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP
                                        ON UPDATE CURRENT_TIMESTAMP,

    CONSTRAINT fk_pagos_orden
        FOREIGN KEY (orden_id) REFERENCES ordenes(id)
        ON DELETE CASCADE,
    INDEX idx_pagos_orden_estado (orden_id, estado),
    INDEX idx_pagos_provider_id (provider_payment_id),
    INDEX idx_pagos_proveedor_metodo (proveedor, metodo)
);

CREATE TABLE IF NOT EXISTS movimientos_stock (
    id                  BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
    producto_id         INT             NOT NULL,
    sucursal_id         INT             NULL,
    orden_id            BIGINT UNSIGNED NULL,
    tipo                ENUM('ingreso','reserva','liberacion','descuento','ajuste')
                                        NOT NULL,
    origen              ENUM('compra','canje','admin','devolucion')
                                        NOT NULL,
    cantidad            INT             NOT NULL,
    descripcion         VARCHAR(255)    NULL,
    creado_por          INT             NULL,
    created_at          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_mov_stock_producto
        FOREIGN KEY (producto_id) REFERENCES productos(id)
        ON DELETE RESTRICT,
    CONSTRAINT fk_mov_stock_sucursal
        FOREIGN KEY (sucursal_id) REFERENCES sucursales(id)
        ON DELETE SET NULL,
    CONSTRAINT fk_mov_stock_orden
        FOREIGN KEY (orden_id) REFERENCES ordenes(id)
        ON DELETE SET NULL,
    CONSTRAINT fk_mov_stock_creado_por
        FOREIGN KEY (creado_por) REFERENCES usuarios(id)
        ON DELETE SET NULL,
    INDEX idx_mov_stock_producto_fecha (producto_id, created_at),
    INDEX idx_mov_stock_orden (orden_id)
);

-- ============================================================
-- TABLAS: soporte interno
-- Inbox interno entre clientes y staff.
-- Los mensajes de admins/vendedores se exponen hacia el cliente
-- solo como "staff", sin revelar el rol real.
-- ============================================================
CREATE TABLE IF NOT EXISTS soporte_conversaciones (
    id                  BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
    usuario_id          INT             NOT NULL,
    asunto              VARCHAR(180)    NULL,
    estado              ENUM('abierta','respondida','cerrada')
                                        NOT NULL DEFAULT 'abierta',
    prioridad           ENUM('normal','alta')
                                        NOT NULL DEFAULT 'normal',
    asignado_a          INT             NULL,
    ultimo_mensaje_at   DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ultimo_staff_at     DATETIME        NULL,
    ultimo_cliente_at   DATETIME        NULL,
    created_at          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP
                                        ON UPDATE CURRENT_TIMESTAMP,

    CONSTRAINT fk_soporte_conversacion_usuario
        FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
        ON DELETE CASCADE,
    CONSTRAINT fk_soporte_conversacion_asignado
        FOREIGN KEY (asignado_a) REFERENCES usuarios(id)
        ON DELETE SET NULL,
    INDEX idx_soporte_conversaciones_usuario_estado (usuario_id, estado, updated_at),
    INDEX idx_soporte_conversaciones_estado_fecha (estado, ultimo_mensaje_at)
);

CREATE TABLE IF NOT EXISTS soporte_mensajes (
    id                  BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
    conversacion_id     BIGINT UNSIGNED NOT NULL,
    autor_usuario_id    INT             NULL,
    autor_tipo          ENUM('cliente','staff','sistema')
                                        NOT NULL,
    cuerpo              TEXT            NOT NULL,
    es_interno          TINYINT(1)      NOT NULL DEFAULT 0,
    leido_por_cliente_at DATETIME       NULL,
    leido_por_staff_at  DATETIME        NULL,
    created_at          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_soporte_mensaje_conversacion
        FOREIGN KEY (conversacion_id) REFERENCES soporte_conversaciones(id)
        ON DELETE CASCADE,
    CONSTRAINT fk_soporte_mensaje_autor
        FOREIGN KEY (autor_usuario_id) REFERENCES usuarios(id)
        ON DELETE SET NULL,
    INDEX idx_soporte_mensajes_conversacion_fecha (conversacion_id, created_at),
    INDEX idx_soporte_mensajes_autor (autor_usuario_id)
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
-- TABLA: eventos_seguridad
-- Auditoria de seguridad de accesos bloqueados y eventos clave.
-- ============================================================
CREATE TABLE IF NOT EXISTS eventos_seguridad (
    id                      BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
    evento                  VARCHAR(120)    NOT NULL,
    ip                      VARCHAR(64)     NOT NULL,
    metodo                  VARCHAR(12)     NOT NULL,
    ruta                    VARCHAR(255)    NOT NULL,
    origen                  VARCHAR(255)    NOT NULL,
    agente_usuario          VARCHAR(255)    NOT NULL,
    detalles_json           JSON            NULL,
    created_at              DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,

    INDEX idx_eventos_seguridad_created_at (created_at),
    INDEX idx_eventos_seguridad_evento_created_at (evento, created_at),
    INDEX idx_eventos_seguridad_ip_created_at (ip, created_at)
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


-- ============================================================
-- SEED: páginas de contenido para pushear
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
-- SEED: administradores iniciales (produccion)
-- NandeAlfajoresCorrentinos1@protonmail.com / Nande_2026_Alfajores1
-- NandeAlfajoresCorrentinos2@protonmail.com / Nande_2026_Alfajores2
-- ============================================================
INSERT INTO usuarios (nombre, email, password_hash, rol, activo) VALUES
(
    'Administrador 1',
    'NandeAlfajoresCorrentinos1@protonmail.com',
    '$2a$10$414cDd/a/On5MvCZCWQ9uuaAFOgv3zPboxokQt2Dya6XQU2VN.rN.',
    'admin',
    1
),
(
    'Administrador 2',
    'NandeAlfajoresCorrentinos2@protonmail.com',
    '$2a$10$vO0.sc08ZUwx/zcSgLevjeiwLEnzZqT4IuAwBeGsdEccKX73CTBuu',
    'admin',
    1
)
ON DUPLICATE KEY UPDATE email = email;
