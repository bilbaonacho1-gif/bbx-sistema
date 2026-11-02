-- =====================================================================
-- 04 · Supabase Storage: buckets privados y políticas
--
--   documentos/   {cliente_id}/{uuid}-{archivo}   documentación de clientes y operaciones
--   plantillas/   {codigo}/{archivo}              modelos de formularios descargables
--   comprobantes/ {cliente_id}/{archivo}          comprobantes contables y facturas
--
-- Ningún bucket es público: los archivos se descargan con URLs firmadas
-- de corta duración, que sólo se generan si la política lo permite.
-- =====================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('documentos',   'documentos',   false, 15728640,
   array['application/pdf','image/jpeg','image/png','image/webp',
         'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
         'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']),
  ('plantillas',   'plantillas',   false, 15728640,
   array['application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document']),
  ('comprobantes', 'comprobantes', false, 15728640,
   array['application/pdf','image/jpeg','image/png'])
on conflict (id) do update set public = false,
  file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- documentos
create policy "documentos: leer" on storage.objects for select to authenticated
  using (bucket_id = 'documentos' and (
    public.tiene_permiso('documentos.ver')
    or (
      (storage.foldername(name))[1] = public.mi_cliente_id()::text
      -- el cliente sólo puede bajar archivos registrados y visibles para él
      and exists (select 1 from public.documentos d
                   where d.storage_bucket = 'documentos' and d.storage_path = name and d.visible_cliente)
    )));

create policy "documentos: subir" on storage.objects for insert to authenticated
  with check (bucket_id = 'documentos' and (
    public.tiene_permiso('documentos.editar')
    or (storage.foldername(name))[1] = public.mi_cliente_id()::text));

create policy "documentos: modificar" on storage.objects for update to authenticated
  using (bucket_id = 'documentos' and public.tiene_permiso('documentos.editar'))
  with check (bucket_id = 'documentos' and public.tiene_permiso('documentos.editar'));

create policy "documentos: borrar" on storage.objects for delete to authenticated
  using (bucket_id = 'documentos' and public.tiene_permiso('documentos.editar'));

-- plantillas
create policy "plantillas: leer" on storage.objects for select to authenticated
  using (bucket_id = 'plantillas' and (public.es_staff() or public.mi_cliente_id() is not null));
create policy "plantillas: escribir" on storage.objects for all to authenticated
  using (bucket_id = 'plantillas' and public.tiene_permiso('configuracion.editar'))
  with check (bucket_id = 'plantillas' and public.tiene_permiso('configuracion.editar'));

-- comprobantes
create policy "comprobantes: leer" on storage.objects for select to authenticated
  using (bucket_id = 'comprobantes' and (
    public.tiene_permiso('contabilidad.ver') or public.tiene_permiso('facturacion.ver')
    or (storage.foldername(name))[1] = public.mi_cliente_id()::text));
create policy "comprobantes: escribir" on storage.objects for insert to authenticated
  with check (bucket_id = 'comprobantes' and (public.tiene_permiso('contabilidad.editar') or public.tiene_permiso('facturacion.emitir')));
