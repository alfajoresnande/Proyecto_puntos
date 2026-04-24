-- ============================================================
--  MIGRACIÓN: tabla categorias
--  Ejecutar en phpMyAdmin sobre la base nande_puntos,
--  o via Docker:
--    docker exec -i nande_mysql mysql -u root -prootpassword nande_puntos < database/migration_categorias.sql
-- ============================================================

USE nande_puntos;

CREATE TABLE IF NOT EXISTS categorias (
    id                  INT             PRIMARY KEY AUTO_INCREMENT,
    nombre              VARCHAR(100)    NOT NULL UNIQUE,
    descripcion         TEXT            NULL,
    created_at          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP
);
