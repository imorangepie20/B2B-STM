# SDTPL_ADM 전면 테마 이식 Implementation Plan

상태: 구현·검증 완료. 관리자·창고·거래처 16개 화면의 데스크톱·모바일 검증은 32/32입니다.

> **For agentic workers:** REQUIRED SUB-SKILL: Use `executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `SDTPL_ADM`의 밝은 shadcn 대시보드 경험으로 B2B 시스템의 인증·관리자·거래처·창고 UI 전체를 교체한다.

**Architecture:** 참조 테마에서 필요한 Tailwind 4 토큰과 최소 shadcn 컴포넌트를 `apps/web`으로 복사한다. B2B 전용 `AdminShell`, `PortalShell`, `WarehouseShell`은 기존 API 호출과 상태 관리를 감싸며, 도메인 로직은 변경하지 않는다.

**Tech Stack:** Next.js 16, React 19, Tailwind CSS 4, shadcn/base-ui, Lucide, Pretendard, Playwright

**Spec:** `docs/superpowers/specs/2026-09-07-sdtpl-admin-theme-adoption-design.md`

## Global Constraints

- `SDTPL_ADM/`은 사용자가 복사를 허용한 참조 원본이며 수정하지 않는다.
- 복사·수정하는 모든 파일은 `apps/web`에 둔다.
- light mode만 제공하고 `Pretendard Variable`을 유지한다.
- 기존 API endpoint, 권한, CSRF, requestId, 주문·재고·출고·반품·정산 동작은 변경하지 않는다.

---

### Task 1: 테마 기반 이식

**Files:**
- Modify: `apps/web/package.json`, `apps/web/tsconfig.json`, `apps/web/postcss.config.mjs`, `apps/web/src/app/globals.css`, `apps/web/src/app/layout.tsx`
- Create: `apps/web/src/lib/utils.ts`, `apps/web/src/hooks/use-mobile.ts`, `apps/web/src/components/ui/*`

**Produces:** Tailwind 4, shadcn 토큰, `cn`, Button/Card/Badge/Input/Select/Textarea/Dialog/Sheet/Sidebar/Tooltip/Skeleton 컴포넌트.

- [ ] Install the minimal reference-compatible dependencies and configure `@/*` imports and the Tailwind PostCSS plugin.
- [ ] Copy the selected reference UI primitives and `utils.ts` into `apps/web`, preserving only light-mode tokens in `globals.css`.
- [ ] Run `npm.cmd run build:web`; the build must discover Tailwind classes and resolve every copied import.

### Task 2: B2B application shells

**Files:**
- Create: `apps/web/src/components/layout/admin-shell.tsx`, `apps/web/src/components/layout/portal-shell.tsx`, `apps/web/src/components/layout/warehouse-shell.tsx`, `apps/web/src/lib/navigation.ts`
- Modify: all files under `apps/web/src/app/admin/**/page.tsx`, `apps/web/src/app/portal/**/page.tsx`, `apps/web/src/app/warehouse/**/page.tsx`

**Produces:** `AdminShell({ title, description, children })`, `PortalShell({ title, children })`, `WarehouseShell({ title, children })`; Korean B2B navigation labels and active paths.

- [ ] Build an `AdminShell` from the copied sidebar/header primitives with catalog, order, inventory, return, settlement, payment and account-security routes.
- [ ] Build portal and warehouse shells with role-appropriate navigation and mobile sheet navigation.
- [ ] Replace per-page outer wrappers without changing fetches, submit handlers, form fields or route URLs.
- [ ] Run API-independent page rendering checks at 1280px and 390px.

### Task 3: Authentication and MFA UI replacement

**Files:**
- Modify: `apps/web/src/app/page.tsx`, `apps/web/src/app/globals.css`
- Create: `apps/web/src/components/auth/auth-card.tsx`, `apps/web/src/components/auth/mfa-steps.tsx`

**Produces:** shadcn Card/Input/Button/Alert based login and MFA enrollment, verification and recovery-code display.

- [ ] Preserve all current login/MFA requests and replace only markup and styling with the copied primitives.
- [ ] Add an automated browser assertion that login, MFA enrollment and recovery-code confirmation controls remain reachable at 390px.
- [ ] Run `npm.cmd run test:e2e --workspace=@b2b-stm/web`.

### Task 4: Administrator dashboard and operations UI replacement

**Files:**
- Modify: `apps/web/src/app/admin/page.tsx`, `apps/web/src/app/admin/orders/page.tsx`, `apps/web/src/app/admin/inventory-adjustments/page.tsx`, `apps/web/src/app/admin/pricing/page.tsx`, `apps/web/src/app/admin/return-credits/page.tsx`, `apps/web/src/app/admin/settlements/page.tsx`, `apps/web/src/app/admin/settlement-drafts/page.tsx`, `apps/web/src/app/admin/payments/page.tsx`, `apps/web/src/app/admin/account-security/page.tsx`
- Remove: obsolete page-specific admin CSS after each page has equivalent Tailwind classes.

**Produces:** dashboard KPI cards, data tables, forms, status badges and destructive-action dialogs inside `AdminShell`.

- [ ] Rebuild `/admin` and `/admin/orders` first; preserve current dashboard and order API data.
- [ ] Rebuild inventory, catalog/pricing, return, settlement, payment and security pages using the same Card/Table/Badge/Form patterns.
- [ ] Add confirmation dialogs to irreversible user actions already exposed by the UI, without changing API semantics.
- [ ] Run administrator browser flow and capture `/admin`, `/admin/orders`, `/admin/account-security` at 1280px and 390px.

### Task 5: Portal and warehouse UI replacement

**Files:**
- Modify: `apps/web/src/app/portal/orders/page.tsx`, `apps/web/src/app/portal/returns/page.tsx`, `apps/web/src/app/portal/settlements/page.tsx`, `apps/web/src/app/warehouse/shipments/page.tsx`, `apps/web/src/app/warehouse/returns/page.tsx`
- Remove: obsolete portal and warehouse page CSS after each page has equivalent Tailwind classes.

**Produces:** consistent customer order/return/settlement cards and warehouse touch-friendly shipment/inspection work lists.

- [ ] Replace outer page structures with `PortalShell` or `WarehouseShell`, preserving field names and business API requests.
- [ ] Use responsive cards on mobile and tables/lists on desktop.
- [ ] Run the existing real browser order-to-settlement E2E unchanged and add visual captures for three role shells.

### Task 6: Verification and records

**Files:**
- Create: `docs/changes/2026-09-07-sdtpl-admin-theme-adoption.md`
- Modify: `docs/overview/current-development-context.md`

- [ ] Run `npm.cmd run build:api`, `npm.cmd run build:web`, `npm.cmd run test:foundation`, `npm.cmd run db:verify`, and `npm.cmd run test:e2e --workspace=@b2b-stm/web`.
- [ ] Record copied reference components, excluded reference content, verification commands, and desktop/mobile screenshots in `docs/`.
