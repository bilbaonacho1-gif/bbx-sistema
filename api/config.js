// Vercel Function: entrega al navegador la configuración PÚBLICA de Supabase,
// leída de las variables de entorno del proyecto en Vercel:
//   SUPABASE_URL       → https://<proyecto>.supabase.co
//   SUPABASE_ANON_KEY  → clave "anon" o "publishable" (pública por diseño; la protege RLS)
// Jamás devuelve la service_role: si por error se configuró, responde con error.
module.exports = (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("X-Content-Type-Options", "nosniff");

  const supabaseUrl = (process.env.SUPABASE_URL || "").trim();
  const supabaseAnonKey = (process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY || "").trim();

  const esServiceRole = (() => {
    if (supabaseAnonKey.startsWith("sb_secret_")) return true;
    try {
      const payload = JSON.parse(Buffer.from(supabaseAnonKey.split(".")[1], "base64url").toString("utf8"));
      return payload.role === "service_role";
    } catch {
      return false;
    }
  })();

  if (esServiceRole) {
    res.statusCode = 500;
    return res.end(JSON.stringify({ error: "SUPABASE_ANON_KEY contiene una clave secreta. Usá la clave anon/publishable." }));
  }
  if (supabaseUrl && !/^https:\/\/[a-z0-9-]+\.supabase\.(co|in)$|^https:\/\/[a-z0-9.-]+$/i.test(supabaseUrl)) {
    res.statusCode = 500;
    return res.end(JSON.stringify({ error: "SUPABASE_URL inválida" }));
  }
  res.statusCode = 200;
  res.end(JSON.stringify({ supabaseUrl, supabaseAnonKey }));
};
