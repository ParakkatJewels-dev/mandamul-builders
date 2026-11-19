-- M Andamul Development OS · 0900 file storage and scheduled jobs
-- Both blocks are guarded: they only run where Supabase Storage / pg_cron exist.

-- ---------- private bucket for drawings, contracts, site photos, test reports ----------
-- Path convention: <project_id>/<folder>/<document_id>/<rev>/<file>, e.g. MA-2026-001/drawings/DOC-26-0004/R2/site-plan.pdf
-- Files are never public; the app serves them with short-lived signed URLs after the RLS check.
do $$ begin
  if to_regclass('storage.objects') is null then raise notice 'storage schema not present — bucket and policies skipped'; return; end if;
  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('project-files', 'project-files', false, 52428800,
          array['application/pdf','image/jpeg','image/png','image/webp','image/heic','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                'application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.ms-excel','text/csv','application/acad','image/vnd.dwg','application/dxf'])
  on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

  -- read: anyone who can view documents on that project (first path segment is the project id)
  execute $p$create policy project_files_read on storage.objects for select to authenticated
    using (bucket_id = 'project-files' and app.can((storage.foldername(name))[1], 'documents', 'view'))$p$;
  -- upload: people who may add documents (same check as api.add_document_version); site teams who may create
  -- daily reports or defects may upload into <project>/site/ only (photos)
  execute $p$create policy project_files_upload on storage.objects for insert to authenticated
    with check (bucket_id = 'project-files' and (
      app.can((storage.foldername(name))[1], 'documents', 'create')
      or ((storage.foldername(name))[2] = 'site' and (app.can((storage.foldername(name))[1], 'site', 'create') or app.can((storage.foldername(name))[1], 'quality', 'create')))))$p$;
  -- no update or delete policy: a file is never replaced in place; a new revision is a new object
end $$;

-- ---------- scheduler: exception scan every 15 minutes, event queue every minute ----------
do $$ begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    raise notice 'pg_cron not available — schedule api.scan_exceptions() and api.process_events() externally (see docs/DEPLOYMENT.md)'; return;
  end if;
  create extension if not exists pg_cron;
  perform cron.schedule('mandamul-scan-exceptions', '*/15 * * * *', 'select api.scan_exceptions()');
  perform cron.schedule('mandamul-process-events', '* * * * *', 'select api.process_events(200)');
end $$;
