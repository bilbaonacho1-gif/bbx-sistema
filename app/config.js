// Configuración pública del frontend (desarrollo local).
// En Vercel no hace falta editar este archivo: se usan las variables de entorno
// SUPABASE_URL y SUPABASE_ANON_KEY a través de /api/config.
//
// La "anon key" (o "publishable key") es pública por diseño: la seguridad la dan
// las políticas RLS. NUNCA pongas acá la service_role key.
window.BBX_CONFIG = window.BBX_CONFIG || {
  supabaseUrl: "",
  supabaseAnonKey: "",
};
