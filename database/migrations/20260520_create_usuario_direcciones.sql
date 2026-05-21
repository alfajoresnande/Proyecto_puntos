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
