USE nande_puntos;

SET @has_codigo_col := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'canjes'
    AND COLUMN_NAME = 'codigo_retiro'
);

SET @sql := IF(
  @has_codigo_col = 0,
  'ALTER TABLE canjes ADD COLUMN codigo_retiro VARCHAR(9) NULL AFTER producto_id',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

UPDATE canjes
SET codigo_retiro = UPPER(SUBSTRING(REPLACE(UUID(), '-', ''), 1, 9))
WHERE codigo_retiro IS NULL
   OR codigo_retiro = ''
   OR codigo_retiro REGEXP '^C0{2,}[A-Z0-9]*$';

ALTER TABLE canjes
  MODIFY COLUMN codigo_retiro VARCHAR(9) NOT NULL;

SET @has_codigo_idx := (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'canjes'
    AND INDEX_NAME = 'uq_canjes_codigo_retiro'
);

SET @sql := IF(
  @has_codigo_idx = 0,
  'ALTER TABLE canjes ADD UNIQUE INDEX uq_canjes_codigo_retiro (codigo_retiro)',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
