"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const points_1 = require("../services/points");
/**
 * Test del guard del toggle `puntos_activo`, sin base de datos: usa una
 * conexión falsa que responde `puntos_activo = 0` (programa apagado).
 *
 * Cubre los dos lados:
 *   - los tipos que SUMAN puntos se rechazan con PointsProgramDisabledError
 *   - `ajuste` y `devolucion_canje` (correcciones) pasan igual
 *   - acreditarPuntosPorCompra y expirarPuntosVencidos hacen early return
 *
 * Uso: npx tsx src/scripts/testPointsToggle.ts
 */
function fakeConn(puntosActivo) {
    return {
        query: async (sql) => {
            const s = String(sql);
            if (s.includes("clave = 'puntos_activo'"))
                return [[{ valor: puntosActivo }], []];
            if (s.trimStart().toUpperCase().startsWith("SELECT"))
                return [[], []];
            return [{ insertId: 1, affectedRows: 1 }, []];
        },
    };
}
let failures = 0;
function check(label, ok) {
    console.log(`${ok ? "OK " : "FAIL"}  ${label}`);
    if (!ok)
        failures += 1;
}
async function expectBlocked(conn, tipo) {
    try {
        await (0, points_1.registrarMovimientoPuntos)(conn, { usuarioId: 1, tipo, puntos: 10 });
        check(`${tipo} se bloquea con el programa apagado`, false);
    }
    catch (error) {
        check(`${tipo} se bloquea con el programa apagado`, error instanceof points_1.PointsProgramDisabledError);
    }
}
async function expectAllowed(conn, tipo) {
    try {
        // puntos: 0 -> pasa el guard y sale por el atajo de recalculo,
        // suficiente para probar que el guard NO rechaza este tipo.
        await (0, points_1.registrarMovimientoPuntos)(conn, { usuarioId: 1, tipo, puntos: 0 });
        check(`${tipo} sigue permitido con el programa apagado`, true);
    }
    catch (error) {
        check(`${tipo} sigue permitido con el programa apagado (${error.message})`, false);
    }
}
async function main() {
    const off = fakeConn("0");
    const on = fakeConn("1");
    check("isPointsProgramEnabled=false con puntos_activo=0", (await (0, points_1.isPointsProgramEnabled)(off)) === false);
    check("isPointsProgramEnabled=true con puntos_activo=1", (await (0, points_1.isPointsProgramEnabled)(on)) === true);
    // Tipos que hacen entrar puntos: bloqueados.
    for (const tipo of [
        "acreditacion_compra",
        "asignacion_manual",
        "codigo_canje",
        "referido_invitador",
        "referido_invitado",
        "canje_producto",
    ]) {
        await expectBlocked(off, tipo);
    }
    // Correcciones: permitidas.
    await expectAllowed(off, "ajuste");
    await expectAllowed(off, "devolucion_canje");
    await expectAllowed(off, "vencimiento_puntos");
    // Con el programa prendido, un tipo bloqueable pasa el guard (falla después
    // recién en la DB real; acá la conexión falsa lo deja completar).
    try {
        await (0, points_1.registrarMovimientoPuntos)(on, { usuarioId: 1, tipo: "acreditacion_compra", puntos: 0 });
        check("acreditacion_compra pasa el guard con el programa prendido", true);
    }
    catch {
        check("acreditacion_compra pasa el guard con el programa prendido", false);
    }
    // Early returns.
    await (0, points_1.acreditarPuntosPorCompra)(off, 123); // no debe tirar
    check("acreditarPuntosPorCompra hace early return apagado", true);
    check("expirarPuntosVencidos devuelve 0 apagado", (await (0, points_1.expirarPuntosVencidos)(off)) === 0);
    console.log(failures === 0 ? "\nTodos los checks pasaron." : `\n${failures} check(s) fallaron.`);
    if (failures > 0)
        process.exit(1);
}
main().catch((err) => {
    console.error(err);
    process.exit(1);
});
