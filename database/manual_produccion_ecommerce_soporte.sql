-- Parche manual para una base ya existente en produccion.
-- Crea tablas y columnas necesarias para ecommerce + inbox interno.
-- Compatible con MySQL 8.

DROP PROCEDURE IF EXISTS aplicar_parche_ecommerce_soporte;
DELIMITER $$

CREATE PROCEDURE aplicar_parche_ecommerce_soporte()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'productos' AND COLUMN_NAME = 'tipo_producto'
  ) THEN
    ALTER TABLE productos
      ADD COLUMN tipo_producto ENUM('canje','venta','mixto') NOT NULL DEFAULT 'canje' AFTER categoria;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'productos' AND COLUMN_NAME = 'sku'
  ) THEN
    ALTER TABLE productos
      ADD COLUMN sku VARCHAR(64) NULL AFTER nombre;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'productos' AND COLUMN_NAME = 'precio_dinero'
  ) THEN
    ALTER TABLE productos
      ADD COLUMN precio_dinero DECIMAL(10,2) NULL AFTER puntos_acumulables;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'productos' AND COLUMN_NAME = 'precio_puntos'
  ) THEN
    ALTER TABLE productos
      ADD COLUMN precio_puntos INT NULL AFTER precio_dinero;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'productos' AND COLUMN_NAME = 'puntos_para_canjear'
  ) THEN
    ALTER TABLE productos
      ADD COLUMN puntos_para_canjear INT NULL AFTER precio_puntos;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'productos' AND COLUMN_NAME = 'puntaje_al_comprar'
  ) THEN
    ALTER TABLE productos
      ADD COLUMN puntaje_al_comprar INT NULL AFTER puntos_para_canjear;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'productos' AND COLUMN_NAME = 'stock_disponible'
  ) THEN
    ALTER TABLE productos
      ADD COLUMN stock_disponible INT NOT NULL DEFAULT 0 AFTER puntaje_al_comprar;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'productos' AND COLUMN_NAME = 'stock_reservado'
  ) THEN
    ALTER TABLE productos
      ADD COLUMN stock_reservado INT NOT NULL DEFAULT 0 AFTER stock_disponible;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'productos' AND COLUMN_NAME = 'track_stock'
  ) THEN
    ALTER TABLE productos
      ADD COLUMN track_stock TINYINT(1) NOT NULL DEFAULT 1 AFTER stock_reservado;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'productos' AND COLUMN_NAME = 'permite_envio'
  ) THEN
    ALTER TABLE productos
      ADD COLUMN permite_envio TINYINT(1) NOT NULL DEFAULT 0 AFTER track_stock;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'productos' AND COLUMN_NAME = 'envio_gratis'
  ) THEN
    ALTER TABLE productos
      ADD COLUMN envio_gratis TINYINT(1) NOT NULL DEFAULT 0 AFTER permite_envio;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'productos' AND COLUMN_NAME = 'permite_retiro_local'
  ) THEN
    ALTER TABLE productos
      ADD COLUMN permite_retiro_local TINYINT(1) NOT NULL DEFAULT 1 AFTER envio_gratis;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'productos' AND COLUMN_NAME = 'updated_at'
  ) THEN
    ALTER TABLE productos
      ADD COLUMN updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER created_at;
  END IF;

  UPDATE productos
  SET precio_puntos = puntos_requeridos
  WHERE precio_puntos IS NULL;

  UPDATE productos
  SET puntos_para_canjear = COALESCE(puntos_para_canjear, precio_puntos, puntos_requeridos),
      puntaje_al_comprar = COALESCE(puntaje_al_comprar, puntos_acumulables);

  UPDATE productos
  SET envio_gratis = 0
  WHERE permite_envio = 0;

  CREATE TABLE IF NOT EXISTS sucursales (
    id INT PRIMARY KEY AUTO_INCREMENT,
    nombre VARCHAR(120) NOT NULL,
    direccion VARCHAR(180) NOT NULL,
    piso VARCHAR(30) NULL,
    localidad VARCHAR(120) NOT NULL,
    provincia VARCHAR(120) NOT NULL,
    activo TINYINT(1) NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS inventario_sucursal (
    id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
    producto_id INT NOT NULL,
    sucursal_id INT NOT NULL,
    stock_disponible INT NOT NULL DEFAULT 0,
    stock_reservado INT NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_inventario_producto
      FOREIGN KEY (producto_id) REFERENCES productos(id)
      ON DELETE CASCADE,
    CONSTRAINT fk_inventario_sucursal
      FOREIGN KEY (sucursal_id) REFERENCES sucursales(id)
      ON DELETE CASCADE,
    CONSTRAINT uq_inventario_producto_sucursal
      UNIQUE (producto_id, sucursal_id)
  );

  CREATE TABLE IF NOT EXISTS carritos (
    id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
    usuario_id INT NOT NULL,
    estado ENUM('activo','convertido','abandonado') NOT NULL DEFAULT 'activo',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_carrito_usuario
      FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
      ON DELETE CASCADE,
    INDEX idx_carritos_usuario_estado (usuario_id, estado, updated_at)
  );

  CREATE TABLE IF NOT EXISTS carrito_items (
    id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
    carrito_id BIGINT UNSIGNED NOT NULL,
    producto_id INT NOT NULL,
    cantidad INT NOT NULL DEFAULT 1,
    modo_compra ENUM('dinero','puntos') NOT NULL,
    precio_dinero_unit DECIMAL(10,2) NULL,
    precio_puntos_unit INT NULL,
    subtotal_dinero DECIMAL(10,2) NOT NULL DEFAULT 0,
    subtotal_puntos INT NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
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
    id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
    usuario_id INT NOT NULL,
    carrito_id BIGINT UNSIGNED NULL,
    canal ENUM('web','admin','vendedor') NOT NULL DEFAULT 'web',
    tipo_orden ENUM('canje','venta','mixta') NOT NULL DEFAULT 'canje',
    estado ENUM('borrador','pendiente_pago','pagada','preparada','enviada','entregada','cancelada','expirada')
      NOT NULL DEFAULT 'borrador',
    moneda VARCHAR(8) NOT NULL DEFAULT 'ARS',
    total_dinero DECIMAL(10,2) NOT NULL DEFAULT 0,
    total_puntos INT NOT NULL DEFAULT 0,
    direccion_envio_json JSON NULL,
    sucursal_retiro_id INT NULL,
    notas TEXT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
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
    id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
    orden_id BIGINT UNSIGNED NOT NULL,
    producto_id INT NOT NULL,
    cantidad INT NOT NULL DEFAULT 1,
    modo_compra ENUM('dinero','puntos') NOT NULL,
    precio_dinero_unit DECIMAL(10,2) NULL,
    precio_puntos_unit INT NULL,
    subtotal_dinero DECIMAL(10,2) NOT NULL DEFAULT 0,
    subtotal_puntos INT NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
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
    id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
    orden_id BIGINT UNSIGNED NOT NULL,
    proveedor VARCHAR(40) NOT NULL,
    estado ENUM('iniciado','aprobado','rechazado','reembolsado') NOT NULL DEFAULT 'iniciado',
    monto DECIMAL(10,2) NOT NULL,
    moneda VARCHAR(8) NOT NULL DEFAULT 'ARS',
    provider_payment_id VARCHAR(120) NULL,
    payload_json JSON NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_pagos_orden
      FOREIGN KEY (orden_id) REFERENCES ordenes(id)
      ON DELETE CASCADE,
    INDEX idx_pagos_orden_estado (orden_id, estado),
    INDEX idx_pagos_provider_id (provider_payment_id)
  );

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pagos' AND COLUMN_NAME = 'metodo'
  ) THEN
    ALTER TABLE pagos
      ADD COLUMN metodo VARCHAR(40) NULL AFTER proveedor;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pagos' AND COLUMN_NAME = 'checkout_url'
  ) THEN
    ALTER TABLE pagos
      ADD COLUMN checkout_url VARCHAR(500) NULL AFTER provider_payment_id;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pagos' AND INDEX_NAME = 'idx_pagos_proveedor_metodo'
  ) THEN
    ALTER TABLE pagos
      ADD INDEX idx_pagos_proveedor_metodo (proveedor, metodo);
  END IF;

  CREATE TABLE IF NOT EXISTS movimientos_stock (
    id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
    producto_id INT NOT NULL,
    sucursal_id INT NULL,
    orden_id BIGINT UNSIGNED NULL,
    tipo ENUM('ingreso','reserva','liberacion','descuento','ajuste') NOT NULL,
    origen ENUM('compra','canje','admin','devolucion') NOT NULL,
    cantidad INT NOT NULL,
    descripcion VARCHAR(255) NULL,
    creado_por INT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
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

  CREATE TABLE IF NOT EXISTS soporte_conversaciones (
    id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
    usuario_id INT NOT NULL,
    asunto VARCHAR(180) NULL,
    estado ENUM('abierta','respondida','cerrada','archivada') NOT NULL DEFAULT 'abierta',
    prioridad ENUM('normal','alta') NOT NULL DEFAULT 'normal',
    asignado_a INT NULL,
    ultimo_mensaje_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ultimo_staff_at DATETIME NULL,
    ultimo_cliente_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
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
    id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
    conversacion_id BIGINT UNSIGNED NOT NULL,
    autor_usuario_id INT NULL,
    autor_tipo ENUM('cliente','staff','sistema') NOT NULL,
    cuerpo TEXT NOT NULL,
    es_interno TINYINT(1) NOT NULL DEFAULT 0,
    leido_por_cliente_at DATETIME NULL,
    leido_por_staff_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_soporte_mensaje_conversacion
      FOREIGN KEY (conversacion_id) REFERENCES soporte_conversaciones(id)
      ON DELETE CASCADE,
    CONSTRAINT fk_soporte_mensaje_autor
      FOREIGN KEY (autor_usuario_id) REFERENCES usuarios(id)
      ON DELETE SET NULL,
    INDEX idx_soporte_mensajes_conversacion_fecha (conversacion_id, created_at),
    INDEX idx_soporte_mensajes_autor (autor_usuario_id)
  );

  ALTER TABLE soporte_conversaciones
    MODIFY estado ENUM('abierta','respondida','cerrada','archivada') NOT NULL DEFAULT 'abierta';

  INSERT INTO configuracion (clave, valor, descripcion)
  VALUES (
    'envio_gratis_monto_minimo',
    '0',
    'Monto minimo de productos para que el envio sea gratis. 0 desactiva la regla'
  )
  ON DUPLICATE KEY UPDATE
    descripcion = VALUES(descripcion);

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'categorias' AND COLUMN_NAME = 'descripcion'
  ) THEN
    ALTER TABLE categorias
      ADD COLUMN descripcion TEXT NULL AFTER nombre;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'categorias' AND COLUMN_NAME = 'activo'
  ) THEN
    ALTER TABLE categorias
      ADD COLUMN activo TINYINT(1) NOT NULL DEFAULT 1 AFTER descripcion;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'categorias' AND COLUMN_NAME = 'updated_at'
  ) THEN
    ALTER TABLE categorias
      ADD COLUMN updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER created_at;
  END IF;
END $$

DELIMITER ;

CALL aplicar_parche_ecommerce_soporte();
DROP PROCEDURE aplicar_parche_ecommerce_soporte;
