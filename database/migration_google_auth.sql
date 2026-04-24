-- Agrega soporte para iniciar sesion con Google en bases existentes.
-- Uso:
--   docker exec -i nande_mysql mysql -u root -prootpassword nande_puntos < database/migration_google_auth.sql

USE nande_puntos;

SET @column_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'usuarios'
    AND COLUMN_NAME = 'google_id'
);

SET @sql := IF(
  @column_exists = 0,
  'ALTER TABLE usuarios ADD COLUMN google_id VARCHAR(255) NULL AFTER email',
  'SELECT 1'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @index_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'usuarios'
    AND COLUMN_NAME = 'google_id'
    AND NON_UNIQUE = 0
);

SET @sql := IF(
  @index_exists = 0,
  'CREATE UNIQUE INDEX ux_usuarios_google_id ON usuarios (google_id)',
  'SELECT 1'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
