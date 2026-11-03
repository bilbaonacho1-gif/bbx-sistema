-- =====================================================================
-- 07 · Endurecimiento según los avisos de seguridad de Supabase
-- =====================================================================
revoke execute on function public.promover_superadmin_inicial(uuid) from public, anon, authenticated;

-- saldo_operacion respeta el RLS de quien consulta
alter function public.saldo_operacion(uuid) security invoker;

-- search_path fijo en todas las funciones
alter function public.tg_perfiles_proteger() set search_path = public;
alter function public.es_backend() set search_path = public;
alter function public.ip_request() set search_path = public;
alter function public.cuit_valido(text) set search_path = public;
alter function public.user_agent_request() set search_path = public;
alter function public.tg_updated_at() set search_path = public;
alter function public.calcular_interes(numeric, numeric, text, int, int) set search_path = public;
alter function public.alicuota_iva(int) set search_path = public;
alter function public.validar_datos_formulario(jsonb, jsonb) set search_path = public;
alter function public.tg_operaciones_calcular() set search_path = public;
alter function public.tg_inmutable() set search_path = public;
alter function public.tg_facturas_proteger() set search_path = public;
alter function public.simular_operacion(numeric, numeric, text, int, date, date, text, numeric, numeric, numeric) set search_path = public;
