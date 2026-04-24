USE nande_puntos;

SET @has_telefono_col := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'usuarios'
    AND COLUMN_NAME = 'telefono'
);

SET @sql := IF(
  @has_telefono_col = 0,
  'ALTER TABLE usuarios ADD COLUMN telefono VARCHAR(25) NULL AFTER dni',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
