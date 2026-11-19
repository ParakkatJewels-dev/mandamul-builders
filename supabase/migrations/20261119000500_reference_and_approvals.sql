-- M Andamul Development OS · 0500 reference configuration, organisation bootstrap, approval engine, events

-- Plan templates and budget profiles are configuration (not demo data): they seed a new project.
create table public.plan_templates (
  profile text not null, key text not null, seq integer not null, phase text not null, name text not null,
  duration_days integer not null check (duration_days >= 0), preds text[] not null default '{}', is_milestone boolean not null default false,
  primary key (profile, key), unique (profile, seq)
);
insert into public.plan_templates (profile, key, seq, phase, name, duration_days, preds, is_milestone) values
 ('resort','T01',1,'Pre-construction','Site survey & soil investigation',20,'{}',false),
 ('resort','T02',2,'Pre-construction','Building permit & statutory approvals',45,'{T01}',false),
 ('resort','M01',3,'Pre-construction','Permit received',0,'{T02}',true),
 ('resort','T03',4,'Pre-construction','Site mobilisation & temporary works',15,'{M01}',false),
 ('resort','T04',5,'Substructure','Earthwork & excavation',30,'{T03}',false),
 ('resort','T05',6,'Substructure','Foundations — guest units & clubhouse',45,'{T04}',false),
 ('resort','T06',7,'Superstructure','RCC frame — clubhouse & spa',75,'{T05}',false),
 ('resort','T07',8,'Superstructure','RCC frame — guest units',90,'{T05}',false),
 ('resort','T08',9,'Superstructure','Roofing & waterproofing',45,'{T06,T07}',false),
 ('resort','M02',10,'Superstructure','Structure complete',0,'{T08}',true),
 ('resort','T09',11,'MEP & finishes','MEP rough-in',60,'{T07}',false),
 ('resort','T10',12,'MEP & finishes','Masonry & plaster',60,'{T07}',false),
 ('resort','T11',13,'MEP & finishes','Flooring, tiling & painting',60,'{T09,T10}',false),
 ('resort','T12',14,'MEP & finishes','Doors, windows & glazing',40,'{T10}',false),
 ('resort','T13',15,'External works','Landscape & external works',60,'{M02}',false),
 ('resort','T14',16,'External works','Pools & water features',50,'{T05}',false),
 ('resort','T15',17,'Handover','Testing & commissioning',25,'{T11,T12}',false),
 ('resort','M03',18,'Handover','Ready for handover',0,'{T13,T14,T15}',true),
 ('glamp','G01',1,'Pre-construction','Topographic survey & tent layout',12,'{}',false),
 ('glamp','G02',2,'Pre-construction','Panchayat permit & forest NOC',35,'{G01}',false),
 ('glamp','M01',3,'Pre-construction','Permits received',0,'{G02}',true),
 ('glamp','G03',4,'Site works','Access paths & site clearing',20,'{M01}',false),
 ('glamp','G04',5,'Site works','Timber deck platforms',35,'{G03}',false),
 ('glamp','G05',6,'Site works','Utilities — power, water, STP',30,'{G03}',false),
 ('glamp','G06',7,'Installation','Tent structures & fit-out',30,'{G04}',false),
 ('glamp','G07',8,'Installation','Bathroom pods & plumbing',25,'{G04,G05}',false),
 ('glamp','G08',9,'Installation','Landscape & lighting',25,'{G06}',false),
 ('glamp','G09',10,'Handover','Testing & soft-opening checks',10,'{G07,G08}',false),
 ('glamp','M02',11,'Handover','Ready for handover',0,'{G09}',true);

create table public.budget_profiles (profile text not null, code text not null, pct numeric(6,3) not null check (pct >= 0), primary key (profile, code));
insert into public.budget_profiles values
 ('resort','01',3.5),('resort','02',9),('resort','03',19),('resort','04',7),('resort','05',6),('resort','06',8),('resort','07',8.5),('resort','08',10),('resort','09',5),('resort','10',5),('resort','11',3),('resort','12',11),
 ('glamp','01',6),('glamp','02',4),('glamp','03',8),('glamp','04',2),('glamp','05',3),('glamp','06',9),('glamp','07',11),('glamp','08',4),('glamp','09',2),('glamp','10',12),('glamp','11',0),('glamp','12',32);

-- Default roles, permissions, cost codes, readiness templates and automation rules for a new organisation.
create or replace function app.bootstrap_org(p_org uuid) returns void
language plpgsql security definer set search_path = public, app as $$
declare r record;
begin
  insert into org_settings (org_id) values (p_org) on conflict do nothing;
  insert into roles (org_id, id, name, active) values
    (p_org,'super_admin','Super Admin',true),(p_org,'md','Managing Director',true),(p_org,'pd','Project Director',true),
    (p_org,'pm','Project Manager',true),(p_org,'architect','Architect',true),(p_org,'site_sup','Site Supervisor',true),
    (p_org,'qs','Quantity Surveyor',true),(p_org,'proc','Procurement Manager',true),(p_org,'finance','Finance Manager',true),
    (p_org,'quality','Quality Engineer',true),(p_org,'interior','Interior Designer',false),(p_org,'civil','Civil Engineer',false),
    (p_org,'store','Store Manager',false),(p_org,'hr','HR / Labour Manager',false),(p_org,'vendor','Contractor / Vendor',false),(p_org,'client','Client / Investor',false)
  on conflict do nothing;
  for r in select * from (values
    ('super_admin','{dashboard,projects,schedule,site,boq,budget,procurement,contracts,payments,quality,handover,documents,settings,audit}','{view,create,edit,export}'),
    ('super_admin','{approvals}','{view}'),
    ('md','{dashboard,projects,schedule,site,boq,budget,procurement,contracts,payments,quality,handover,approvals,documents,audit}','{view,export}'),
    ('md','{budget,procurement,contracts,payments,documents,approvals,handover}','{approve}'),
    ('md','{projects}','{create}'),
    ('pd','{dashboard,projects,schedule,site,boq,budget,procurement,contracts,payments,quality,handover,approvals,documents,audit}','{view,export}'),
    ('pd','{projects,schedule,documents,contracts}','{create,edit}'),
    ('pd','{schedule,site,procurement,contracts,payments,documents,approvals,quality,handover}','{approve}'),
    ('pd','{budget}','{create}'),
    ('pm','{dashboard,projects,schedule,site,boq,budget,procurement,contracts,quality,handover,approvals,documents}','{view}'),
    ('pm','{schedule,site,procurement,contracts,documents,quality,handover}','{create,edit}'),
    ('pm','{site,procurement,contracts,approvals,quality}','{approve}'),
    ('pm','{budget}','{create}'),
    ('architect','{projects,schedule,documents,approvals,quality}','{view}'),('architect','{documents}','{create,edit}'),
    ('site_sup','{projects,schedule,site,procurement,documents,quality,handover}','{view}'),('site_sup','{site,procurement,quality}','{create}'),('site_sup','{procurement}','{edit}'),
    ('qs','{dashboard,projects,schedule,site,boq,budget,procurement,contracts,approvals,documents}','{view}'),('qs','{boq,budget,contracts}','{create,edit}'),('qs','{boq,approvals}','{approve}'),
    ('proc','{dashboard,projects,boq,budget,procurement,approvals,documents}','{view}'),('proc','{procurement}','{create,edit}'),
    ('finance','{dashboard,projects,boq,budget,procurement,contracts,payments,approvals,documents,audit}','{view}'),('finance','{payments}','{create,edit}'),('finance','{budget,payments,approvals}','{approve}'),
    ('quality','{projects,schedule,site,quality,handover,documents,approvals}','{view}'),('quality','{quality,handover}','{create,edit,approve}'),('quality','{approvals}','{approve}')
  ) as t(role_id, mods, acts) loop
    insert into role_permissions (org_id, role_id, module, action)
    select p_org, r.role_id, m, a from unnest(r.mods::text[]) m, unnest(r.acts::text[]) a on conflict do nothing;
  end loop;
  insert into cost_codes (org_id, code, name, is_contingency) values
    (p_org,'01','Preliminaries & site setup',false),(p_org,'02','Earthwork & foundations',false),(p_org,'03','Superstructure (RCC & steel)',false),
    (p_org,'04','Masonry & plaster',false),(p_org,'05','Roofing & waterproofing',false),(p_org,'06','Electrical & ELV',false),
    (p_org,'07','Plumbing, HVAC & fire',false),(p_org,'08','Flooring, painting & finishes',false),(p_org,'09','Doors, windows & glazing',false),
    (p_org,'10','Landscape & external works',false),(p_org,'11','Pools & water bodies',false),(p_org,'12','FF&E and OS&E',false),(p_org,'13','Contingency',true)
  on conflict do nothing;
  insert into stage_templates (org_id, id, name) values (p_org,'villa','Villa / cottage'),(p_org,'room','Guest room'),(p_org,'amenity','Restaurant, spa or common area'),(p_org,'tent','Glamping tent') on conflict do nothing;
  insert into template_stages (org_id, template_id, seq, stage_key, label)
  select p_org, t, s.seq, s.k, s.l from unnest(array['villa','amenity']) t,
    (values (1,'foundation','Foundation'),(2,'structure','Structure'),(3,'roofing','Roofing'),(4,'mep_rough','MEP rough-in'),(5,'plaster','Plastering'),
            (6,'flooring','Flooring'),(7,'painting','Painting'),(8,'doors_windows','Doors and windows'),(9,'bathrooms','Bathroom installation'),
            (10,'furniture','Furniture installation'),(11,'cleaning','Final cleaning')) s(seq,k,l)
  on conflict do nothing;
  insert into template_stages (org_id, template_id, seq, stage_key, label) values
    (p_org,'room',1,'mep_rough','MEP rough-in'),(p_org,'room',2,'plaster','Plastering'),(p_org,'room',3,'flooring','Flooring'),(p_org,'room',4,'painting','Painting'),
    (p_org,'room',5,'bathrooms','Bathroom installation'),(p_org,'room',6,'furniture','Furniture installation'),(p_org,'room',7,'cleaning','Final cleaning'),
    (p_org,'tent',1,'platform','Deck platform'),(p_org,'tent',2,'structure','Tent structure'),(p_org,'tent',3,'bath_pod','Bathroom pod'),(p_org,'tent',4,'furniture','Furniture installation'),(p_org,'tent',5,'cleaning','Final cleaning')
  on conflict do nothing;
  insert into automation_rules (org_id, id, name, event, notify_roles, escalate_role, escalate_after_hours, channels, creates_risk) values
    (p_org,'budget_overrun','Budget overrun','budget_overrun','{pm,finance}','md',48,'{in_app,email}',true),
    (p_org,'critical_delay','Critical activity late','critical_delay','{pm,pd}','md',72,'{in_app}',true),
    (p_org,'missing_report','Missing daily site report','missing_report','{site_sup,pm}','pd',24,'{in_app,whatsapp}',false),
    (p_org,'material_shortage','Material shortage reported','material_shortage','{proc,pm}',null,null,'{in_app,whatsapp}',false),
    (p_org,'approval_requested','Approval waiting','approval_requested','{}','md',48,'{in_app}',false),
    (p_org,'safety_defect','Safety-critical defect','safety_defect','{pd,quality,pm}','md',4,'{in_app,whatsapp,email}',true),
    (p_org,'drawing_revision','Drawing revision approved','drawing_revision','{pm,qs,proc,site_sup}',null,null,'{in_app}',false),
    (p_org,'contractor_bill','Contractor bill submitted','contractor_bill','{qs,finance}',null,null,'{in_app}',false),
    (p_org,'milestone_done','Critical milestone completed','milestone_done','{md,pd}',null,null,'{in_app,email}',false),
    (p_org,'unit_ready','Unit ready for handover','unit_ready','{pd,quality}',null,null,'{in_app}',false)
  on conflict do nothing;
  insert into channel_config (org_id, channel, provider, enabled) values (p_org,'email',null,false),(p_org,'whatsapp',null,false) on conflict do nothing;
end $$;

-- ---------- events (automation queue) ----------
create or replace function app.emit(p_project text, p_event text, p_dedupe text, p_payload jsonb default '{}'::jsonb) returns bigint
language plpgsql security definer set search_path = public, app as $$
declare v_id bigint; v_org uuid := coalesce(app.org(), (select org_id from projects where id = p_project));
begin
  insert into automation_events (org_id, project_id, event, dedupe_key, payload) values (v_org, p_project, p_event, p_dedupe, p_payload)
  on conflict (org_id, dedupe_key) do nothing returning id into v_id;
  return v_id;   -- null = duplicate, suppressed
end $$;

create or replace function app.notify_role(p_project text, p_role text, p_text text, p_link text, p_event bigint default null) returns integer
language plpgsql security definer set search_path = public, app as $$
declare n integer;
begin
  insert into notifications (org_id, user_id, text, link, event_id)
  select p.org_id, p.user_id, p_text, p_link, p_event from profiles p
  where p.role_id = p_role and p.active and p.org_id = (select org_id from projects where id = p_project)
    and (p.all_projects or exists (select 1 from project_members m where m.project_id = p_project and m.user_id = p.user_id));
  get diagnostics n = row_count; return n;
end $$;

-- ---------- approval engine ----------
create or replace function app.po_steps(p_org uuid, p_total numeric, p_over numeric, p_module text default 'procurement') returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare s org_settings; v jsonb := jsonb_build_array(jsonb_build_object('role','pm','module',p_module,'label','Review & approve'));
begin
  select * into s from org_settings where org_id = p_org;
  if p_total > s.po_pm_limit then v := v || jsonb_build_object('role','pd','module',p_module,'label','Approve'); end if;
  if p_total > s.po_pd_limit then v := v || jsonb_build_object('role','md','module',case when p_over > 0 then 'budget' else p_module end,'label',case when p_over > 0 then 'Approve with budget override' else 'Approve' end);
  elsif p_over > 0 then v := v || jsonb_build_object('role','md','module','budget','label','Budget override'); end if;
  return v;
end $$;

create or replace function app.create_approval(p_kind text, p_ref text, p_project text, p_title text, p_amount numeric, p_steps jsonb, p_ctx jsonb default '{}'::jsonb)
returns text language plpgsql security definer set search_path = public, app as $$
declare v_id text := app.next_no(app.org(), 'AP'); s jsonb; i integer := 0;
begin
  insert into approvals (id, org_id, project_id, kind, ref, title, amount, requested_by, ctx)
  values (v_id, app.org(), p_project, p_kind, p_ref, p_title, p_amount, auth.uid(), p_ctx);
  for s in select * from jsonb_array_elements(p_steps) loop
    i := i + 1;
    insert into approval_steps (approval_id, seq, role_id, module, label, status)
    values (v_id, i, s ->> 'role', s ->> 'module', s ->> 'label', case when i = 1 then 'pending' else 'waiting' end);
  end loop;
  perform app.notify_role(p_project, p_steps -> 0 ->> 'role', p_kind || ' ' || p_ref || ' needs your ' || lower(p_steps -> 0 ->> 'label'), 'approvals');
  perform app.emit(p_project, 'approval_requested', 'approval:' || v_id, jsonb_build_object('approval_id', v_id, 'kind', p_kind, 'ref', p_ref));
  return v_id;
end $$;

create or replace function app.consume_etc(p_project text, p_code text, p_amount numeric, p_ref text) returns void
language plpgsql security definer set search_path = public, app as $$
declare v_before numeric;
begin
  select amount into v_before from etc_estimates where project_id = p_project and code = p_code for update;
  if v_before is null then return; end if;
  -- a commitment converts estimate into committed cost; the reduction is capped at the estimate (never negative) and logged
  update etc_estimates set amount = greatest(0, v_before - p_amount), basis = 'Reduced by commitment ' || p_ref, updated_by = auth.uid(), updated_at = now()
  where project_id = p_project and code = p_code;
  perform app.log(p_project, 'Estimate consumed', format('%s: estimate %s → %s by %s', p_code, v_before, greatest(0, v_before - p_amount), p_ref), p_ref);
end $$;

create or replace function api.decide(p_approval text, p_decision text, p_comment text default null, p_expected_seq integer default null) returns text
language plpgsql security definer set search_path = public, app as $$
declare a approvals; st approval_steps; nxt approval_steps;
begin
  if p_decision not in ('approve','reject') then raise exception 'decision must be approve or reject'; end if;
  select * into a from approvals where id = p_approval for update;            -- serialises concurrent decisions
  if not found then raise exception 'approval % not found', p_approval; end if;
  if a.status <> 'Pending' then raise exception 'approval % is already %', p_approval, lower(a.status) using errcode = 'P0003'; end if;
  select * into st from approval_steps where approval_id = a.id and status = 'pending' order by seq limit 1;
  if p_expected_seq is not null and p_expected_seq <> st.seq then raise exception 'step % was already decided; refresh and try again', p_expected_seq using errcode = 'P0003'; end if;
  if not app.has_project(a.project_id) then raise exception 'no access to project %', a.project_id using errcode = '42501'; end if;
  if app.role() <> st.role_id then raise exception 'this step needs %', st.role_id using errcode = '42501'; end if;
  perform app.require_perm(st.module, 'approve');
  if a.requested_by = auth.uid() then raise exception 'you raised this request; another person must approve it' using errcode = '42501'; end if;
  if exists (select 1 from approval_steps where approval_id = a.id and decided_by = auth.uid()) then raise exception 'you already approved an earlier step' using errcode = '42501'; end if;
  if p_decision = 'reject' and coalesce(length(trim(p_comment)), 0) < 3 then raise exception 'a comment is required to reject'; end if;

  update approval_steps set status = case when p_decision = 'approve' then 'approved' else 'rejected' end,
         decided_by = auth.uid(), decided_at = now(), comment = p_comment
   where approval_id = a.id and seq = st.seq;
  if p_decision = 'approve' then
    select * into nxt from approval_steps where approval_id = a.id and status = 'waiting' order by seq limit 1;
    if found then
      update approval_steps set status = 'pending' where approval_id = a.id and seq = nxt.seq;
      perform app.notify_role(a.project_id, nxt.role_id, a.kind || ' ' || a.ref || ' needs your ' || lower(nxt.label), 'approvals');
      return 'next:' || nxt.role_id;
    end if;
    update approvals set status = 'Approved', closed_at = now() where id = a.id;
    perform app.on_decided(a, true, p_comment);
    return 'approved';
  end if;
  update approval_steps set status = 'skipped' where approval_id = a.id and status = 'waiting';
  update approvals set status = 'Rejected', closed_at = now() where id = a.id;
  perform app.on_decided(a, false, p_comment);
  return 'rejected';
end $$;
