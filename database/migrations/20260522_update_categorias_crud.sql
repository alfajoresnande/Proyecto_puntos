SET @add_categoria_descripcion := (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE categorias ADD COLUMN descripcion TEXT NULL AFTER nombre',
    'SELECT 1'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'categorias'
    AND COLUMN_NAME = 'descripcion'
);
PREPARE stmt FROM @add_categoria_descripcion;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @add_categoria_activo := (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE categorias ADD COLUMN activo TINYINT(1) NOT NULL DEFAULT 1 AFTER descripcion',
    'SELECT 1'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'categorias'
    AND COLUMN_NAME = 'activo'
);
PREPARE stmt FROM @add_categoria_activo;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @add_categoria_updated_at := (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE categorias ADD COLUMN updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER created_at',
    'SELECT 1'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'categorias'
    AND COLUMN_NAME = 'updated_at'
);
PREPARE stmt FROM @add_categoria_updated_at;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
