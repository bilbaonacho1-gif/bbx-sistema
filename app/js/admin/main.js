// Panel administrativo interno de BBX.
import { proteger, tiene } from "../core.js";
import { iniciarShell } from "../shell.js";

const ctx = await proteger("admin");
if (ctx) {
  const { sb } = ctx;
  const contar = (tabla, filtro) => async () => {
    let q = sb.from(tabla).select("id", { count: "exact", head: true });
    q = filtro(q);
    const { count } = await q;
    return count || 0;
  };

  const nav = [
    { path: "/dashboard", label: "Dashboard", icon: "dashboard", permiso: "dashboard.ver" },
    { grupo: "Gestión" },
    { path: "/clientes", label: "Clientes", icon: "users", permiso: "clientes.ver" },
    { path: "/solicitudes", label: "Solicitudes", icon: "userPlus", permiso: "registros.aprobar", badge: contar("solicitudes_registro", (q) => q.eq("estado", "pendiente")) },
    { path: "/operaciones", label: "Operaciones", icon: "transfer", permiso: "operaciones.ver" },
    { path: "/documentacion", label: "Documentación", icon: "folder", permiso: "documentos.ver", badge: contar("documentos", (q) => q.eq("estado", "en_revision")) },
    { path: "/formularios", label: "Formularios", icon: "pen", permiso: "formularios.ver", badge: contar("formularios", (q) => q.in("estado", ["completado", "firmado"])) },
    { grupo: "Finanzas" },
    { path: "/contabilidad", label: "Contabilidad", icon: "calculator", permiso: "contabilidad.ver" },
    { path: "/facturacion", label: "Facturación", icon: "receipt", permiso: "facturacion.ver" },
    { path: "/reportes", label: "Reportes", icon: "chart", permiso: "reportes.ver" },
    { grupo: "Sistema" },
    { path: "/usuarios", label: "Usuarios", icon: "user", permiso: "usuarios.ver" },
    { path: "/configuracion", label: "Configuración", icon: "settings", permiso: "configuracion.editar" },
    { path: "/auditoria", label: "Auditoría", icon: "shield", permiso: "auditoria.ver" },
  ];

  const rutas = [
    { path: "/dashboard", permiso: "dashboard.ver", view: () => import("./dashboard.js") },
    { path: "/clientes", permiso: "clientes.ver", view: () => import("./clientes.js") },
    { path: "/clientes/:id", permiso: "clientes.ver", view: () => import("./cliente-ficha.js") },
    { path: "/solicitudes", permiso: "registros.aprobar", view: () => import("./solicitudes.js") },
    { path: "/operaciones", permiso: "operaciones.ver", view: () => import("./operaciones.js") },
    { path: "/operaciones/nueva", permiso: "operaciones.editar", view: () => import("./operacion-form.js") },
    { path: "/operaciones/:id/editar", permiso: "operaciones.editar", view: () => import("./operacion-form.js") },
    { path: "/operaciones/:id", permiso: "operaciones.ver", view: () => import("./operacion-detalle.js") },
    { path: "/documentacion", permiso: "documentos.ver", view: () => import("./documentacion.js") },
    { path: "/formularios", permiso: "formularios.ver", view: () => import("./formularios.js") },
    { path: "/contabilidad", permiso: "contabilidad.ver", view: () => import("./contabilidad.js") },
    { path: "/facturacion", permiso: "facturacion.ver", view: () => import("./facturacion.js") },
    { path: "/facturacion/:id", permiso: "facturacion.ver", view: () => import("./factura-detalle.js") },
    { path: "/reportes", permiso: "reportes.ver", view: () => import("./reportes.js") },
    { path: "/usuarios", permiso: "usuarios.ver", view: () => import("./usuarios.js") },
    { path: "/configuracion", permiso: "configuracion.editar", view: () => import("./configuracion.js") },
    { path: "/auditoria", permiso: "auditoria.ver", view: () => import("./auditoria.js") },
  ];

  const inicio = (nav.find((n) => n.path && tiene(n.permiso))?.path ?? "/dashboard").slice(1);
  iniciarShell({ sb, area: "admin", nav, rutas, inicio });
}
