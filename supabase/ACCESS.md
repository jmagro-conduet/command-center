# Access profiles: who can open which page

Before, five fixed roles each had a hard-coded sidebar, and only Roadmap and Strategy could be granted per person.
Now every page is a permission, and access is configurable in **Admin settings, Roles & access** and **Users, Pages**.

## Concepts

| Term | Meaning |
| --- | --- |
| **Role** (`users.role`) | agent, qa, admin, superadmin, operator. Still decides *data* scope and in-page behaviour. Unchanged. |
| **Page** | Something you can open. Level is `none`, `view` or `edit`. Only Roadmap and Strategy have a real edit level; the rest are on or off. |
| **Access profile** | A named bundle of page levels. Built in: Agent, QA, Admin, SuperAdmin, Operator (seeded to match exactly what those roles could open before). Add your own, for example **ELT** with only Roadmap and Strategy. |
| **Override** | A per-person level for one page (including `none`) that beats their profile. |

A person's page level = their override, else their profile's level. Their profile defaults to the one named after their role,
so existing users see no change. Operators are fixed to the Operator profile; nothing can widen them.

Example from the request: an ELT member who should only see Roadmap and Strategy gets role **agent** (least data access) and
access profile **ELT**.

## Safety

- **Lockout guard:** a change that would leave nobody with the *Users and access* page is refused (profile edits, per-person
  changes, role changes and user deletion all check it).
- **Fallback-safe:** if the tables are missing, the app uses the built-in defaults, which reproduce the old behaviour.
- **SuperAdmin** is configurable but defaults to every page. Anyone with *Users and access* can change anyone's access
  (including their own), so grant it deliberately.
- **Enforcement:** Roadmap and Strategy data are protected by row-level security through `has_page_access()`, which now
  resolves profiles and overrides. For the other pages this controls what the app shows; those pages still read data with the
  app's service client, so that part is UI-level until the service-role-key work lands.

## Pieces

| Piece | File |
| --- | --- |
| Migration (tables, seeds, resolver, RLS helper) | `supabase/migrations/20261125_access_profiles.sql` |
| Page registry, built-in defaults, resolver, lockout guard (pure, tested) | `src/lib/access/core.ts`, `core.test.mjs` |
| Loading a user's access, admin data | `src/lib/pageAccess.ts` |
| Roles & access tab | `src/pages/RolesAccess.tsx` |
| Per-person profile + overrides | `src/pages/AccessModal.tsx`, wired in `src/pages/Users.tsx` |
| Edge functions resolve edit access via `page_level_for_email` | `roadmap-sprint-draft`, `strategy-draft-review` |

## Adding a page later

Add it to `PAGES` in `core.ts` (and to the sidebar icon map / App route), then ship a migration that inserts its rows into
`access_profile_pages` for the profiles that should have it (SuperAdmin at least). A page with no rows is simply off for everyone.

## Rollout order

1. Run the migration. 2. Deploy the two edge functions. 3. Release the app. The app and functions work before the migration too
(built-in defaults), so the order is forgiving.

```powershell
node --test src/lib/access/core.test.mjs
```
