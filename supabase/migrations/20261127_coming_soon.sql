-- Planned pages (Customer Success, Client Status): visible with a "Soon" tag to the profiles that are
-- granted them, so the ELT can see what is being built. Additive and safe to re-run.
-- SuperAdmin gets them by default. Give them to an ELT profile in Admin settings, Roles & access.
insert into public.access_profile_pages (profile_key, page_key, level)
values ('superadmin', 'customer-success', 'view'), ('superadmin', 'client-status', 'view')
on conflict (profile_key, page_key) do nothing;
