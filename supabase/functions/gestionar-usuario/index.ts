// Edge Function: gestión de usuarios internos (necesita service_role, por eso vive en el servidor).
//
// POST /functions/v1/gestionar-usuario
//   { "accion": "invitar", "email", "nombre", "apellido", "rol", "redirect" }
//   { "accion": "estado",  "user_id", "estado": "activo" | "suspendido" }
//
// Requiere el permiso usuarios.gestionar. Sólo un superadmin puede invitar superadmins.
import { clienteAdmin, ErrorHttp, exigirPermiso, json, manejar } from "../_shared/comun.ts";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const ROLES_INTERNOS = ["superadmin", "administrador", "operador", "contable", "consulta"];

Deno.serve(manejar(async (req) => {
  const { userId, db } = await exigirPermiso(req, "usuarios.gestionar");
  const admin = clienteAdmin();
  const body = await req.json().catch(() => ({}));
  const { data: yo } = await admin.from("perfiles").select("rol").eq("id", userId).single();

  if (body.accion === "invitar") {
    const email = String(body.email ?? "").trim().toLowerCase();
    const rol = String(body.rol ?? "");
    if (!EMAIL.test(email)) throw new ErrorHttp(400, "Email inválido");
    if (!ROLES_INTERNOS.includes(rol)) throw new ErrorHttp(400, "Rol inválido");
    if (rol === "superadmin" && yo?.rol !== "superadmin") throw new ErrorHttp(403, "Sólo un superadministrador puede invitar a otro");

    const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
      data: { nombre: String(body.nombre ?? "").slice(0, 80), apellido: String(body.apellido ?? "").slice(0, 80) },
      redirectTo: typeof body.redirect === "string" ? body.redirect : undefined,
    });
    if (error) throw new ErrorHttp(400, error.message);

    // El trigger creó el perfil como pendiente: se le asigna el rol interno.
    await admin.auth.admin.updateUserById(data.user.id, { app_metadata: { bbx_rol: rol } });
    const { error: e2 } = await admin.from("perfiles")
      .update({ rol, estado: "activo", nombre: body.nombre ?? null, apellido: body.apellido ?? null, cliente_id: null })
      .eq("id", data.user.id);
    if (e2) throw new ErrorHttp(500, "Usuario invitado, pero no se pudo asignar el rol");
    return json(req, { ok: true, user_id: data.user.id });
  }

  if (body.accion === "estado") {
    const estado = body.estado === "suspendido" ? "suspendido" : "activo";
    if (body.user_id === userId) throw new ErrorHttp(400, "No podés suspender tu propio usuario");
    const { data: p } = await admin.from("perfiles").select("rol, cliente_id").eq("id", body.user_id).single();
    if (!p) throw new ErrorHttp(404, "Usuario inexistente");
    // La regla de negocio (quién puede cambiar a quién) la valida la RPC con la sesión del usuario.
    const { error } = await db.rpc("admin_actualizar_usuario", {
      p_id: body.user_id, p_rol: p.rol, p_estado: estado, p_cliente_id: p.cliente_id,
    });
    if (error) throw new ErrorHttp(400, error.message);
    // Además se bloquea el login y se invalidan las sesiones en Supabase Auth.
    await admin.auth.admin.updateUserById(body.user_id, { ban_duration: estado === "suspendido" ? "876000h" : "none" });
    return json(req, { ok: true });
  }

  throw new ErrorHttp(400, "Acción inválida");
}));
