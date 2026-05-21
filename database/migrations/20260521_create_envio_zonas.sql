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

SET @add_envio_zona_id := (
    SELECT IF(
        COUNT(*) = 0,
        'ALTER TABLE ordenes ADD COLUMN envio_zona_id INT NULL AFTER sucursal_retiro_id',
        'SELECT 1'
    )
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'ordenes'
      AND COLUMN_NAME = 'envio_zona_id'
);
PREPARE stmt FROM @add_envio_zona_id;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @add_envio_costo := (
    SELECT IF(
        COUNT(*) = 0,
        'ALTER TABLE ordenes ADD COLUMN envio_costo DECIMAL(10,2) NOT NULL DEFAULT 0 AFTER envio_zona_id',
        'SELECT 1'
    )
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'ordenes'
      AND COLUMN_NAME = 'envio_costo'
);
PREPARE stmt FROM @add_envio_costo;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @add_envio_cotizacion_json := (
    SELECT IF(
        COUNT(*) = 0,
        'ALTER TABLE ordenes ADD COLUMN envio_cotizacion_json JSON NULL AFTER envio_costo',
        'SELECT 1'
    )
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'ordenes'
      AND COLUMN_NAME = 'envio_cotizacion_json'
);
PREPARE stmt FROM @add_envio_cotizacion_json;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @add_fk_orden_envio_zona := (
    SELECT IF(
        COUNT(*) = 0,
        'ALTER TABLE ordenes ADD CONSTRAINT fk_orden_envio_zona FOREIGN KEY (envio_zona_id) REFERENCES envio_zonas(id) ON DELETE SET NULL',
        'SELECT 1'
    )
    FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'ordenes'
      AND CONSTRAINT_NAME = 'fk_orden_envio_zona'
);
PREPARE stmt FROM @add_fk_orden_envio_zona;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
