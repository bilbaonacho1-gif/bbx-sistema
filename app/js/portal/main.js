// Portal privado del cliente.
import { proteger } from "../core.js";
import { iniciarShell } from "../shell.js";

const ctx = await proteger("portal");
if (ctx) {
  const { sb } = ctx;
  const nav = [
    { path: "/cuenta", label: "Mi cuenta", icon: "user" },
    { path: "/operaciones", label: "Mis operaciones", icon: "transfer" },
    { path: "/estado-cuenta", label: "Estado de cuenta", icon: "file" },
    { path: "/documentacion", label: "Documentación", icon: "folder",
      badge: async () => (await sb.from("documentos_requeridos").select("id", { count: "exact", head: true }).eq("estado", "pendiente")).count || 0 },
    { path: "/formularios", label: "Formularios", icon: "pen",
      badge: async () => (await sb.from("formularios").select("id", { count: "exact", head: true }).in("estado", ["pendiente", "rechazado", "completado"])).count || 0 },
  ];
  const rutas = [
    { path: "/cuenta", view: () => import("./cuenta.js") },
    { path: "/operaciones", view: () => import("./operaciones.js") },
    { path: "/operaciones/:id", view: () => import("./operacion.js") },
    { path: "/estado-cuenta", view: () => import("./estado-cuenta.js") },
    { path: "/documentacion", view: () => import("./documentacion.js") },
    { path: "/formularios", view: () => import("./formularios.js") },
  ];
  iniciarShell({ sb, area: "portal", nav, rutas, inicio: "cuenta" });
}
