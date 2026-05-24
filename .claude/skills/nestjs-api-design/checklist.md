# Endpoint Completion Checklist

Run this before declaring any endpoint task done. If any item fails, fix or flag to the user.

## Module & file layout
- [ ] Files live under `src/<feature>/` (controller, service, module, dto/, entities/).
- [ ] No top-level `controllers/` or `services/` folders introduced.
- [ ] Feature module is imported by `AppModule` (or its parent).

## Route
- [ ] HTTP verb matches intent (GET/POST/PUT/PATCH/DELETE).
- [ ] Path uses plural noun, no verbs.
- [ ] Versioned (`@Controller({ path, version })`).
- [ ] Correct status code (201 create, 204 delete-void). `@HttpCode()` if overriding.

## DTOs
- [ ] Separate Create / Update / Response DTOs.
- [ ] Update DTO uses `PartialType` of Create (or `PickType`/`OmitType`).
- [ ] Every request-DTO field has at least one validator.
- [ ] Nested DTOs use `@ValidateNested()` + `@Type()`.
- [ ] Response is a DTO, NOT the entity. Sensitive fields excluded.

## Validation & errors
- [ ] Endpoint relies on global `ValidationPipe` (no inline `if (!body.x) throw`).
- [ ] Domain errors use built-in exceptions (`NotFoundException` etc.), not raw `HttpException`.
- [ ] No stack-trace leaks to client.

## Auth
- [ ] Endpoint protected by global `JwtAuthGuard`, OR explicitly marked `@Public()`.
- [ ] Role-restricted endpoints have `@Roles(...)`.

## Service layer
- [ ] Controller body ≤ ~5 lines: parse → call service → return.
- [ ] No DB calls in controller.
- [ ] No `process.env` reads outside `config/`.

## Pagination (list endpoints)
- [ ] Accepts `PaginationDto`. Limit capped at 100.
- [ ] Returns `{ data, meta: { total, page, limit, totalPages } }`.
- [ ] Filter/sort params validated against allow-list.

## Documentation
- [ ] `@ApiTags` on controller, `@ApiOperation` on method.
- [ ] `@ApiResponse` for each documented status (200/201/400/401/403/404).
- [ ] `@ApiProperty` / `@ApiPropertyOptional` on every DTO field.

## Tests
- [ ] Service unit test for happy path.
- [ ] Service unit test for each thrown exception.
- [ ] Controller e2e test with invalid DTO → expect 400.
- [ ] If auth-protected: e2e test without token → expect 401.

## Final
- [ ] `npm run lint` clean.
- [ ] `npm run build` succeeds (type-check).
- [ ] No secrets, no `.env` content, no hard-coded URLs in committed files.
