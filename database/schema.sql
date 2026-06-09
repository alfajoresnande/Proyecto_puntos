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
    email_verificado    TINYINT(1)      NOT NULL DEFAULT 0,
    email_verificado_at DATETIME        NULL,
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
-- TABLA: usuario_direcciones
-- Direcciones de envio guardadas por cada cliente.
-- Las coordenadas quedan listas para calcular zonas de envio.
-- ============================================================
CREATE TABLE IF NOT EXISTS usuario_direcciones (
    id                      BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
    usuario_id              INT             NOT NULL,
    alias                   VARCHAR(80)     NULL,
    receptor_nombre         VARCHAR(120)    NULL,
    receptor_telefono       VARCHAR(40)     NULL,
    direccion_formateada    VARCHAR(255)    NOT NULL,
    calle                   VARCHAR(140)    NULL,
    numero                  VARCHAR(30)     NULL,
    piso_departamento       VARCHAR(80)     NULL,
    barrio                  VARCHAR(120)    NULL,
    localidad               VARCHAR(120)    NULL,
    provincia               VARCHAR(120)    NULL,
    codigo_postal           VARCHAR(20)     NULL,
    pais                    VARCHAR(80)     NOT NULL DEFAULT 'Argentina',
    lat                     DECIMAL(10,7)   NOT NULL,
    lng                     DECIMAL(10,7)   NOT NULL,
    provider                ENUM('manual','geoapify','google') NOT NULL DEFAULT 'manual',
    provider_place_id       VARCHAR(255)    NULL,
    provider_raw_json       JSON            NULL,
    instrucciones_entrega   TEXT            NULL,
    es_predeterminada       TINYINT(1)      NOT NULL DEFAULT 0,
    activo                  TINYINT(1)      NOT NULL DEFAULT 1,
    created_at              DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at              DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP
                                            ON UPDATE CURRENT_TIMESTAMP,

    CONSTRAINT fk_usuario_direcciones_usuario
        FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
        ON DELETE CASCADE,
    CONSTRAINT chk_usuario_direcciones_lat
        CHECK (lat >= -90 AND lat <= 90),
    CONSTRAINT chk_usuario_direcciones_lng
        CHECK (lng >= -180 AND lng <= 180),

    INDEX idx_usuario_direcciones_usuario_activo (usuario_id, activo, updated_at),
    INDEX idx_usuario_direcciones_usuario_predeterminada (usuario_id, es_predeterminada, activo),
    INDEX idx_usuario_direcciones_lat_lng (lat, lng)
);

-- ============================================================
-- TABLA: envio_zonas
-- Poligonos activos para cotizar envios por ubicacion.
-- polygon_geojson guarda geometria GeoJSON tipo Polygon ([lng, lat]).
-- ============================================================
CREATE TABLE IF NOT EXISTS envio_zonas (
    id                  INT             PRIMARY KEY AUTO_INCREMENT,
    nombre              VARCHAR(120)    NOT NULL,
    descripcion         TEXT            NULL,
    precio              DECIMAL(10,2)   NOT NULL DEFAULT 0,
    prioridad           INT             NOT NULL DEFAULT 0,
    color               VARCHAR(16)     NOT NULL DEFAULT '#6B8F71',
    polygon_geojson     JSON            NOT NULL,
    activo              TINYINT(1)      NOT NULL DEFAULT 1,
    created_by          INT             NULL,
    updated_by          INT             NULL,
    created_at          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP
                                        ON UPDATE CURRENT_TIMESTAMP,

    CONSTRAINT fk_envio_zonas_created_by
        FOREIGN KEY (created_by) REFERENCES usuarios(id)
        ON DELETE SET NULL,
    CONSTRAINT fk_envio_zonas_updated_by
        FOREIGN KEY (updated_by) REFERENCES usuarios(id)
        ON DELETE SET NULL,
    INDEX idx_envio_zonas_activo_prioridad (activo, prioridad, id)
);

-- ============================================================
-- TABLA: postulaciones_cv
-- Postulaciones laborales recibidas desde el home.
-- Los archivos se guardan fuera del directorio publico.
-- ============================================================
CREATE TABLE IF NOT EXISTS postulaciones_cv (
    id                  INT             PRIMARY KEY AUTO_INCREMENT,
    nombre              VARCHAR(160)    NOT NULL,
    email               VARCHAR(160)    NOT NULL,
    telefono            VARCHAR(40)     NULL,
    mensaje             TEXT            NOT NULL,
    archivo_original    VARCHAR(255)    NOT NULL,
    archivo_guardado    VARCHAR(255)    NOT NULL,
    mime_type           VARCHAR(120)    NULL,
    size_bytes          INT             NOT NULL DEFAULT 0,
    estado              ENUM('nueva','vista','archivada') NOT NULL DEFAULT 'nueva',
    created_at          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP
                                    ON UPDATE CURRENT_TIMESTAMP,

    INDEX idx_postulaciones_estado_created_at (estado, created_at),
    INDEX idx_postulaciones_email_created_at (email, created_at)
);

-- ============================================================
-- TABLA: email_verification_codes
-- Codigos de un solo uso para verificar el email al registrarse.
-- Se almacena hash del codigo (nunca el codigo en claro).
-- ============================================================
CREATE TABLE IF NOT EXISTS email_verification_codes (
    id                      BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
    usuario_id              INT             NOT NULL,
    codigo_hash             CHAR(64)        NOT NULL,
    expires_at              DATETIME        NOT NULL,
    used_at                 DATETIME        NULL,
    attempts                TINYINT UNSIGNED NOT NULL DEFAULT 0,
    requested_ip            VARCHAR(64)     NULL,
    requested_user_agent    VARCHAR(255)    NULL,
    created_at              DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_email_verification_usuario
        FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
        ON DELETE CASCADE
);

CREATE INDEX idx_email_verification_usuario_estado
    ON email_verification_codes (usuario_id, used_at, expires_at);

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
    envio_gratis        TINYINT(1)      NOT NULL DEFAULT 0,
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
    puntaje_al_comprar_unitario INT     NOT NULL DEFAULT 0,
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
    estado              ENUM('borrador','pendiente_pago','pagada','preparandose','preparada','enviada','entregando','entregada','cancelada','expirada')
                                        NOT NULL DEFAULT 'borrador',
    moneda              VARCHAR(8)      NOT NULL DEFAULT 'ARS',
    total_dinero        DECIMAL(10,2)   NOT NULL DEFAULT 0,
    total_puntos        INT             NOT NULL DEFAULT 0,
    direccion_envio_json JSON           NULL,
    sucursal_retiro_id  INT             NULL,
    envio_zona_id       INT             NULL,
    envio_costo         DECIMAL(10,2)   NOT NULL DEFAULT 0,
    envio_cotizacion_json JSON          NULL,
    notas               TEXT            NULL,
    receipt_email_sent_at DATETIME      NULL,
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
    CONSTRAINT fk_orden_envio_zona
        FOREIGN KEY (envio_zona_id) REFERENCES envio_zonas(id)
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
    puntaje_al_comprar_unitario INT     NOT NULL DEFAULT 0,
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
    estado              ENUM('abierta','respondida','cerrada','archivada')
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
                            'acreditacion_compra',
                            'vencimiento_puntos',
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
        FOREIGN KEY (creado_por)  REFERENCES usuarios(id),
    CONSTRAINT uq_mov_referencia
        UNIQUE (referencia_tipo, referencia_id, tipo)
);

-- ============================================================
-- TABLAS: puntos_lotes / puntos_lote_consumos
-- Cada acreditacion positiva crea un lote con vencimiento propio.
-- Los consumos descuentan primero los lotes mas proximos a vencer.
-- ============================================================
CREATE TABLE IF NOT EXISTS puntos_lotes (
    id                  BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
    usuario_id          INT             NOT NULL,
    movimiento_id       INT             NULL,
    puntos_originales   INT             NOT NULL,
    puntos_disponibles  INT             NOT NULL,
    expires_at          DATETIME        NOT NULL,
    origen_tipo         VARCHAR(50)     NULL,
    origen_id           INT             NULL,
    created_at          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_puntos_lotes_usuario
        FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
        ON DELETE CASCADE,
    CONSTRAINT fk_puntos_lotes_movimiento
        FOREIGN KEY (movimiento_id) REFERENCES movimientos_puntos(id)
        ON DELETE SET NULL,
    CONSTRAINT uq_puntos_lotes_movimiento
        UNIQUE (movimiento_id),
    INDEX idx_puntos_lotes_usuario_vencimiento (usuario_id, expires_at, puntos_disponibles),
    INDEX idx_puntos_lotes_origen (origen_tipo, origen_id)
);

CREATE TABLE IF NOT EXISTS puntos_lote_consumos (
    id                  BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
    usuario_id          INT             NOT NULL,
    lote_id             BIGINT UNSIGNED NOT NULL,
    movimiento_id       INT             NOT NULL,
    puntos              INT             NOT NULL,
    created_at          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_puntos_consumos_usuario
        FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
        ON DELETE CASCADE,
    CONSTRAINT fk_puntos_consumos_lote
        FOREIGN KEY (lote_id) REFERENCES puntos_lotes(id)
        ON DELETE CASCADE,
    CONSTRAINT fk_puntos_consumos_movimiento
        FOREIGN KEY (movimiento_id) REFERENCES movimientos_puntos(id)
        ON DELETE CASCADE,
    INDEX idx_puntos_consumos_movimiento (movimiento_id),
    INDEX idx_puntos_consumos_lote (lote_id),
    INDEX idx_puntos_consumos_usuario (usuario_id, created_at)
);

-- ============================================================
-- TABLA: app_presencia_registros
-- Presencia de visitantes anonimos y clientes en ventanas
-- de 30 minutos para el panel admin "Personas en app".
-- ============================================================
CREATE TABLE IF NOT EXISTS app_presencia_registros (
    id                  BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
    identity_key        VARCHAR(80)     NOT NULL,
    visitor_id          CHAR(36)        NOT NULL,
    session_id          CHAR(36)        NOT NULL,
    usuario_id          INT             NULL,
    visitante_tipo      ENUM('anonimo','cliente') NOT NULL DEFAULT 'anonimo',
    bucket_start        DATETIME        NOT NULL,
    bucket_end          DATETIME        NOT NULL,
    first_seen_at       DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_seen_at        DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    first_path          VARCHAR(255)    NOT NULL,
    last_path           VARCHAR(255)    NOT NULL,
    page_title          VARCHAR(255)    NULL,
    referrer            VARCHAR(255)    NULL,
    ip                  VARCHAR(64)     NOT NULL,
    user_agent          VARCHAR(255)    NULL,
    page_views          INT UNSIGNED    NOT NULL DEFAULT 1,
    created_at          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    CONSTRAINT fk_app_presencia_usuario
        FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
        ON DELETE SET NULL,
    UNIQUE KEY uq_app_presencia_bucket_identity (session_id, bucket_start, identity_key),
    INDEX idx_app_presencia_session (session_id, bucket_start),
    INDEX idx_app_presencia_last_seen (last_seen_at),
    INDEX idx_app_presencia_bucket (bucket_start),
    INDEX idx_app_presencia_visitor (visitor_id, last_seen_at),
    INDEX idx_app_presencia_usuario (usuario_id, last_seen_at),
    INDEX idx_app_presencia_tipo (visitante_tipo, last_seen_at)
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
    activo              TINYINT(1)      NOT NULL DEFAULT 1,
    created_at          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP
                                        ON UPDATE CURRENT_TIMESTAMP
);

-- ============================================================
-- TABLA: descuentos_tipo_producto
-- Descuentos puntuales por perfil de cliente y producto.
-- ============================================================
CREATE TABLE IF NOT EXISTS descuentos_tipo_producto (
    id                      INT             PRIMARY KEY AUTO_INCREMENT,
    tipo_cliente            ENUM('cliente','mayorista','empleado') NOT NULL,
    producto_id             INT             NOT NULL,
    descuento_porcentaje    DECIMAL(5,2)    NOT NULL DEFAULT 0,
    activo                  TINYINT(1)      NOT NULL DEFAULT 1,
    created_at              DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at              DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP
                                            ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT uq_descuento_tipo_producto
        UNIQUE (tipo_cliente, producto_id),
    INDEX idx_descuentos_tipo_producto_producto (producto_id),
    CONSTRAINT fk_descuentos_tipo_producto_producto
        FOREIGN KEY (producto_id) REFERENCES productos(id)
        ON DELETE CASCADE
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
    ('puntos_monto_base', '1000',
        'Monto de compra que habilita un tramo de puntos'),
    ('puntos_por_monto', '20',
        'Puntos que se acreditan por cada tramo de monto configurado'),
    ('puntos_vencimiento_meses', '6',
        'Cantidad de meses de vigencia para cada lote de puntos acreditado'),
    ('puntos_alerta_pre_vencimiento_valor', '1',
        'Cantidad de semanas o meses de anticipacion para avisar que los puntos estan por vencer'),
    ('puntos_alerta_pre_vencimiento_unidad', 'meses',
        'Unidad de anticipacion para avisar puntos por vencer: semanas o meses'),
    ('home_ubicacion_imagen_1_link', '',
        'Link opcional para la imagen principal izquierda de la seccion Donde encontrarnos del home'),
    ('home_ubicacion_imagen_2_link', '',
        'Link opcional para la imagen superior derecha de la seccion Donde encontrarnos del home'),
    ('home_ubicacion_imagen_3_link', '',
        'Link opcional para la imagen inferior derecha de la seccion Donde encontrarnos del home'),
    ('lugar_retiro_canje', 'Corrientes, Argentina',
        'Lugar físico donde el cliente debe retirar productos canjeados'),
    ('longitud_codigo_invitacion', '9',
        'Longitud del código de invitación generado automáticamente'),
    ('envio_gratis_monto_minimo', '0',
        'Monto mínimo de productos para que el envío sea gratis. 0 desactiva la regla'),
    ('limite_compra_cliente', '100',
        'Cantidad maxima por producto para clientes comunes. 0 significa sin tope comercial.'),
    ('limite_compra_mayorista', '100',
        'Cantidad maxima por producto para clientes mayoristas. 0 significa sin tope comercial.'),
    ('limite_compra_empleado', '100',
        'Cantidad maxima por producto para clientes empleados. 0 significa sin tope comercial.'),
    ('eventbar_activo', '0',
        'Activa o desactiva la barra superior de evento temporal.'),
    ('eventbar_titulo', '',
        'Texto principal que se muestra en la barra superior de evento.'),
    ('eventbar_subtitulo', '',
        'Texto secundario que se muestra debajo del titulo en la barra superior de evento.'),
    ('eventbar_fecha_fin', '',
        'Fecha y hora ISO en la que termina el evento de la barra superior.'),
    ('eventbar_color_fondo', '#2D1A0D',
        'Color de fondo de la barra superior de evento.'),
    ('eventbar_color_texto', '#F3C47B',
        'Color de texto de la barra superior de evento.'),
    ('eventbar_descuento_especial_activo', '0',
        'Activa el descuento especial de la eventbar para precios de tienda online.'),
    ('eventbar_descuento_especial_tipo', 'none',
        'Tipo de descuento especial de la eventbar: none, 2x1, 3x2 o 4x3.')
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
  '# Términos y Condiciones de Uso, Compra, Canje y Programa de Puntos

**Ñandé / Alfajores Correntinos**

*Última actualización: 6 de junio de 2026*

Este documento regula el uso del sitio web, la tienda online, el catálogo de canjes, el programa de puntos, la mensajería de soporte y demás servicios digitales de **Ñandé / Alfajores Correntinos**.

Al navegar por la plataforma, registrarte, comprar, canjear puntos o comunicarte con la empresa, aceptás estos Términos y Condiciones. Si no estás de acuerdo, te pedimos que no utilices la plataforma.

## Índice del documento

1. Datos del proveedor
2. Alcance del servicio
3. Registro y uso de la cuenta
4. Productos, imágenes y disponibilidad
5. Precios, promociones y errores
6. Compras y confirmación de pedidos
7. Medios de pago
8. Retiros, entregas y envíos
9. Política de cancelaciones, cambios y reembolsos
10. Programa de puntos
11. Canjes
12. Soporte y canales de comunicación
13. Datos personales
14. Propiedad intelectual
15. Suspensión o limitación del servicio
16. Modificaciones de los términos
17. Ley aplicable
18. Aceptación final

## 1. Datos del proveedor

Antes de publicar la versión definitiva, completar o confirmar estos datos:

- **Titular o razón social:** [completar]
- **CUIT:** [completar]
- **Domicilio legal o comercial:** [completar]
- **Correo de atención:** [completar]
- **WhatsApp oficial:** +54 9 379 463-2610
- **Instagram oficial:** https://www.instagram.com/alfajorescorrentinos/
- **Sitio web:** https://alfajorescorrentinos.com

## 2. Alcance del servicio

La plataforma puede permitir, según disponibilidad:

- ver productos, precios, imágenes, sabores, promociones y stock;
- comprar productos para retiro en sucursal o envío, cuando esa modalidad esté habilitada;
- pagar por medios digitales y, en ciertos casos, en efectivo al retirar;
- acumular puntos por compras o acciones promocionales;
- canjear puntos por productos habilitados;
- consultar pedidos, canjes, comprobantes y movimientos;
- comunicarse con soporte por la sección **Mensajes**, WhatsApp o redes sociales oficiales.

## 3. Registro y uso de la cuenta

Para acceder a determinadas funciones puede ser necesario crear una cuenta. El usuario debe brindar datos verdaderos, actualizados y completos.

Cada usuario es responsable por la confidencialidad de su contraseña y por las acciones realizadas desde su cuenta. No está permitido:

- usar datos falsos o de terceros sin autorización;
- compartir cuentas;
- manipular precios, stock, puntos o canjes;
- utilizar bots, automatizaciones abusivas o cualquier mecanismo que afecte el funcionamiento de la plataforma;
- realizar conductas fraudulentas, ofensivas o contrarias a la ley.

Ñandé podrá suspender o cancelar cuentas ante incumplimientos, uso abusivo, fraude, intentos de manipulación o requerimientos legales.

## 4. Productos, imágenes y disponibilidad

Las imágenes y descripciones tienen carácter informativo y comercial. Puede haber variaciones razonables de presentación, empaque, lote, sabor o estética del producto final.

La disponibilidad puede cambiar sin previo aviso por stock, demanda, producción, reservas pendientes, errores de carga o cuestiones operativas. Agregar productos al carrito no garantiza la disponibilidad definitiva hasta la confirmación del pedido.

## 5. Precios, promociones y errores

Los precios se expresan en pesos argentinos, salvo indicación distinta. Pueden modificarse sin previo aviso hasta la confirmación de la operación.

Las promociones, descuentos, cupones, beneficios por puntos y condiciones comerciales pueden tener:

- vigencia limitada;
- stock limitado;
- restricciones por usuario, sucursal, canal o medio de pago;
- condiciones especiales de uso.

Si existiera un error evidente en precios, stock, puntaje, publicación o configuración, Ñandé podrá dejar sin efecto la operación, corregirla o proponer una alternativa razonable.

## 6. Compras y confirmación de pedidos

Todo pedido queda sujeto a validación de stock, datos del usuario, disponibilidad de sucursal o envío, confirmación del pago y controles internos de seguridad.

El pedido podrá reflejar distintos estados operativos, tales como pendiente, pagado, en preparación, listo para retirar, enviado, entregado, cancelado o vencido. Dichos estados son informativos y podrán actualizarse de manera automática o manual.

## 7. Medios de pago

La plataforma puede ofrecer medios de pago como tarjeta de crédito, tarjeta de débito, Mercado Pago, QR u otros medios digitales habilitados. El pago en efectivo podrá estar disponible solo para ciertos casos de retiro en sucursal.

Cuando el pago sea procesado por terceros, también aplicarán los términos y políticas del proveedor de pago correspondiente.

## 8. Retiros, entregas y envíos

En los pedidos con retiro, el usuario deberá presentarse dentro del plazo informado, con los datos necesarios para identificar la operación.

En los pedidos con envío, el usuario debe cargar correctamente dirección, localidad, provincia, teléfono y referencias necesarias. Los plazos de entrega son estimativos y pueden verse afectados por causas ajenas a Ñandé, incluyendo demoras logísticas, clima, alta demanda, feriados o problemas de terceros.

Si la entrega no pudiera concretarse por datos incorrectos, ausencia, falta de respuesta o rechazo injustificado, la empresa podrá reprogramar, cancelar o aplicar condiciones operativas razonables según el caso.

## 9. Política de cancelaciones, cambios y reembolsos

Como regla general, **Ñandé no realiza devoluciones de dinero ni reembolsos** por compras confirmadas, pedidos preparados, productos retirados o entregados, canjes efectuados, errores imputables al usuario, falta de retiro dentro del plazo, cambios de opinión posteriores a la confirmación o cualquier situación ordinaria vinculada a la operatoria habitual del negocio.

Toda solicitud vinculada con cancelaciones, revisión de importes abonados, cambios excepcionales o incidencias deberá ser analizada **caso por caso** por la empresa.

Solo en situaciones **muy excepcionales, extraordinarias o debidamente justificadas**, y siempre a exclusivo criterio de Ñandé o cuando la normativa aplicable así lo exija, podrá evaluarse una solución particular. En esos supuestos, la persona usuaria deberá comunicarse exclusivamente por alguno de estos canales oficiales:

- la sección **Mensajes** de la app;
- el **WhatsApp oficial** de la empresa;
- el **Instagram oficial** u otra red social oficial que la empresa tenga habilitada.

La sola recepción del reclamo o mensaje **no implica aceptación automática** de devolución, reintegro, compensación ni reconocimiento de responsabilidad.

Cuando corresponda una revisión excepcional, la empresa podrá solicitar comprobantes, número de pedido, identidad del titular de la compra, imágenes del producto, descripción del inconveniente y cualquier otro dato razonable para evaluar el caso.

Lo anterior se aplica **sin perjuicio de los derechos irrenunciables del consumidor previstos por la legislación argentina**, incluyendo los supuestos legales de revocación en contrataciones a distancia cuando resulten aplicables.

## 10. Programa de puntos

El programa de puntos es un beneficio promocional y comercial de Ñandé. Los puntos:

- no constituyen dinero;
- no son reembolsables en efectivo;
- no generan intereses;
- no son transferibles, salvo autorización expresa;
- no pueden venderse, cederse ni comercializarse.

La empresa podrá otorgar, descontar, ajustar, bloquear o dejar sin efecto puntos cuando detecte errores, fraude, duplicaciones, abusos, devoluciones, cancelaciones o incumplimientos.

## 11. Canjes

Los puntos podrán canjearse únicamente por productos habilitados, con stock disponible y bajo las condiciones vigentes al momento del canje.

Una vez confirmado el canje:

- los puntos se descuentan automáticamente;
- el stock puede quedar reservado por un plazo determinado;
- el usuario deberá retirar dentro del tiempo informado.

Si el usuario no retira dentro del plazo indicado, el canje podrá vencer y los puntos podrán no ser reintegrados, salvo decisión comercial excepcional de la empresa.

## 12. Soporte y canales de comunicación

Los canales oficiales de atención son únicamente los habilitados por la empresa, incluyendo la sección **Mensajes** de la app, WhatsApp oficial y redes sociales oficiales.

Toda persona usuaria debe mantener un trato respetuoso. No se permite enviar mensajes ofensivos, amenazantes, discriminatorios, falsos, fraudulentos o ajenos a la finalidad del canal.

Ñandé podrá conservar registros de conversaciones y utilizarlos para seguimiento de pedidos, seguridad, control de calidad y resolución de incidencias.

## 13. Datos personales

La empresa podrá recopilar y tratar datos personales necesarios para:

- crear y administrar cuentas;
- procesar compras, pagos, retiros, envíos y canjes;
- gestionar puntos, promociones y soporte;
- prevenir fraude y reforzar la seguridad;
- cumplir obligaciones legales y administrativas.

El tratamiento de datos deberá realizarse conforme a la normativa aplicable en la República Argentina. El usuario podrá solicitar la actualización, rectificación o supresión de sus datos a través de los canales oficiales de contacto, sin perjuicio de las obligaciones legales de conservación que correspondan.

## 14. Propiedad intelectual

Todos los contenidos de la plataforma, incluyendo marca, nombre comercial, imágenes, textos, diseños, logotipos, código, catálogos y piezas publicitarias, pertenecen a Ñandé o a sus respectivos titulares y no pueden ser reproducidos, modificados ni explotados sin autorización previa y por escrito.

## 15. Suspensión o limitación del servicio

Ñandé podrá interrumpir, limitar, actualizar o modificar la plataforma por tareas de mantenimiento, seguridad, mejoras técnicas, problemas operativos, fuerza mayor o decisiones comerciales.

La empresa no garantiza disponibilidad ininterrumpida ni ausencia total de errores.

## 16. Modificaciones de los términos

Ñandé podrá modificar estos Términos y Condiciones en cualquier momento para adaptarlos a cambios comerciales, operativos, tecnológicos o legales. La versión actualizada será la publicada en los canales oficiales de la empresa.

## 17. Ley aplicable

Estos Términos y Condiciones se rigen por las leyes de la República Argentina.

En caso de duda interpretativa o conflicto, se aplicarán también las normas imperativas de defensa del consumidor y demás disposiciones legales vigentes que resulten obligatorias.

## 18. Aceptación final

El uso de la plataforma implica que la persona usuaria declara haber leído, comprendido y aceptado estos Términos y Condiciones.

## Nota importante para publicación

Este borrador ya contempla la política comercial de **no reembolso** que pediste, pero conviene que antes de publicarlo se revisen y completen los datos legales faltantes y se valide internamente que el texto final coincida con la operatoria real de la empresa.

Documento generado a partir del borrador de Términos y Condiciones de Ñandé / Alfajores Correntinos.'
)
ON DUPLICATE KEY UPDATE slug = slug;

-- ============================================================
-- SEED: administradores iniciales (produccion)
-- NandeAlfajoresCorrentinos1@protonmail.com / Nande_2026_Alfajores1
-- NandeAlfajoresCorrentinos2@protonmail.com / Nande_2026_Alfajores2
-- ============================================================
INSERT INTO usuarios (nombre, email, email_verificado, email_verificado_at, password_hash, rol, activo) VALUES
(
    'Administrador 1',
    'NandeAlfajoresCorrentinos1@protonmail.com',
    1,
    NOW(),
    '$2a$10$414cDd/a/On5MvCZCWQ9uuaAFOgv3zPboxokQt2Dya6XQU2VN.rN.',
    'admin',
    1
),
(
    'Administrador 2',
    'NandeAlfajoresCorrentinos2@protonmail.com',
    1,
    NOW(),
    '$2a$10$vO0.sc08ZUwx/zcSgLevjeiwLEnzZqT4IuAwBeGsdEccKX73CTBuu',
    'admin',
    1
)
ON DUPLICATE KEY UPDATE email = email;
