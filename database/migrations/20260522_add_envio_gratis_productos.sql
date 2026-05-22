SET @add_envio_gratis := (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE productos ADD COLUMN envio_gratis TINYINT(1) NOT NULL DEFAULT 0 AFTER permite_envio',
    'SELECT 1'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'productos'
    AND COLUMN_NAME = 'envio_gratis'
);

PREPARE stmt FROM @add_envio_gratis;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

UPDATE productos
SET envio_gratis = 0
WHERE permite_envio = 0;
