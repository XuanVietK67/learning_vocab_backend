---
name: nestjs-api-design
description: Apply when designing or modifying the NestJS REST API surface in this repo — creating/editing controllers, DTOs, modules, guards, interceptors, exception filters, adding endpoints, or wiring validation, auth, pagination, versioning, Swagger, config, logging. SKIP for pure business-logic edits inside an existing service body, DB migrations, infra config, or non-HTTP code.
---

# NestJS API Design Rules

This skill enforces the API conventions for `learning-vocab` (NestJS 11). Rules are non-negotiable defaults. If a rule cannot be followed (e.g. required package not installed), STOP and tell the user before generating code that violates it.

## Prerequisite packages

Before generating code that uses these, check `package.json`. If missing, tell the user and offer to install. Do not write `import` statements for uninstalled packages.

| Capability | Package | Currently installed? |
|---|---|---|
| Validation | `class-validator`, `class-transformer` | NO |
| DTO helpers | `@nestjs/mapped-types` | NO |
| Config | `@nestjs/config`, `joi` | NO |
| Auth | `@nestjs/passport`, `@nestjs/jwt`, `passport`, `passport-jwt` | NO |
| Throttling | `@nestjs/throttler` | NO |
| Swagger | `@nestjs/swagger` | NO |
| Security headers | `helmet` | NO |
| ORM | `typeorm` + `@nestjs/typeorm` OR `prisma` + `@prisma/client` | NO |

Re-check `package.json` each session — this table reflects state at skill creation only.

## 1. Module layout — feature-first

```
src/
  users/
    users.controller.ts
    users.service.ts
    users.module.ts
    dto/
      create-user.dto.ts
      update-user.dto.ts
      user-response.dto.ts
    entities/
      user.entity.ts
    guards/
  shared/        # cross-cutting: filters, interceptors, pipes, decorators
  config/        # typed config namespaces
```

Never create top-level `controllers/`, `services/`, `dtos/` folders.

## 2. REST conventions

| Action | Verb | Status | Path |
|---|---|---|---|
| List | GET | 200 | `/users` |
| Read one | GET | 200 / 404 | `/users/:id` |
| Create | POST | 201 | `/users` |
| Full update | PUT | 200 | `/users/:id` |
| Partial update | PATCH | 200 | `/users/:id` |
| Delete | DELETE | 204 | `/users/:id` |
| Nested | GET | 200 | `/users/:id/orders` |

- Plural nouns only. No verbs in paths (`/users/:id/activate` is acceptable; `/getUser` is not).
- Use `@HttpCode(204)` on DELETE handlers that return void.
- 422 for validation failures (handled by `ValidationPipe` → `BadRequestException` by default — override via exception factory if 422 is required).

## 3. DTOs — one per operation, never expose entities

```ts
// dto/create-user.dto.ts
export class CreateUserDto {
  @IsEmail() email: string;
  @IsString() @MinLength(8) password: string;
}

// dto/update-user.dto.ts
import { PartialType } from '@nestjs/mapped-types';
export class UpdateUserDto extends PartialType(CreateUserDto) {}

// dto/user-response.dto.ts
export class UserResponseDto {
  @Expose() id: string;
  @Expose() email: string;
  // password is NOT exposed
}
```

- Controllers return `UserResponseDto`, never the entity.
- Use `PartialType`, `PickType`, `OmitType` from `@nestjs/mapped-types` — do not duplicate fields.
- Map entity → response DTO in the service or via `ClassSerializerInterceptor` + `@Expose()/@Exclude()`.

## 4. Validation — global, strict

In `main.ts`:

```ts
app.useGlobalPipes(new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
  transformOptions: { enableImplicitConversion: true },
}));
```

- Every DTO property gets at least one validator (`@IsString`, `@IsEmail`, `@IsOptional`, `@MinLength`, etc.).
- Nested DTOs require `@ValidateNested()` + `@Type(() => ChildDto)`.
- Domain rules → custom validator class, not inline in the controller/service.

## 5. Errors — built-ins + global filter

- Throw `NotFoundException`, `BadRequestException`, `ConflictException`, `UnauthorizedException`, `ForbiddenException`. Never throw raw `HttpException` or `Error` from a controller/service.
- Register a global `AllExceptionsFilter` in `shared/filters/` that returns:

```json
{ "statusCode": 404, "message": "User not found", "error": "Not Found",
  "timestamp": "2026-05-24T10:00:00.000Z", "path": "/v1/users/abc" }
```

- Never leak stack traces in production (`process.env.NODE_ENV === 'production'`).

## 6. Auth — JWT, global guard, opt-out decorator

- `AuthModule` owns all auth code. No JWT logic outside it.
- Global `JwtAuthGuard` via `APP_GUARD`. Use `@Public()` (custom decorator with `SetMetadata('isPublic', true)`) to mark open endpoints.
- Authorization: `RolesGuard` + `@Roles('admin')`. Roles live in an enum, not magic strings.

## 7. Config — typed, validated at startup

```ts
// config/database.config.ts
export default registerAs('database', () => ({
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT, 10),
}));
```

- Load with `ConfigModule.forRoot({ isGlobal: true, load: [databaseConfig], validationSchema: Joi.object({...}) })`.
- Inject with `ConfigService` or `@Inject(databaseConfig.KEY)`. Never read `process.env` outside `config/`.
- `.env` is git-ignored. `.env.example` is committed.

## 8. Database & ORM

- Service holds all DB calls. Controller never touches the repository.
- Migrations only — `synchronize: true` is forbidden outside local dev.
- Declare relations explicitly. Decide eager vs lazy per relation; document the choice.
- Index every column used in `WHERE`, `ORDER BY`, or `JOIN`.

## 9. Pagination, filtering, sorting

```ts
// shared/dto/pagination.dto.ts
export class PaginationDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 20;
  @IsOptional() @IsString() sortBy?: string;
  @IsOptional() @IsIn(['ASC', 'DESC']) sortOrder: 'ASC' | 'DESC' = 'ASC';
}
```

Response shape:

```ts
{ data: T[], meta: { total, page, limit, totalPages } }
```

- Hard cap `limit ≤ 100`. Never trust a client value past that.
- Filter params validated against an allow-list — no raw `req.query` into the ORM.

## 10. Versioning — enable from day one

```ts
app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
// Controller: @Controller({ path: 'users', version: '1' })  →  /v1/users
```

## 11. Serialization & response shaping

- Either `ClassSerializerInterceptor` globally with `@Expose()/@Exclude()` on response DTOs, OR a custom `TransformInterceptor` wrapping every response as `{ success: true, data: ... }`. Pick one and apply consistently.
- Date/enum/nested-object transforms happen in the interceptor or DTO, not in service business logic.

## 12. Security, logging, testing, Swagger

**Security** (in `main.ts`):
- `app.use(helmet())`
- `app.enableCors({ origin: configService.get('CORS_ORIGINS').split(',') })` — never `origin: '*'` in prod.
- `ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }])` + global `ThrottlerGuard`.

**Logging**:
- Use Nest's built-in `Logger` (or Pino/Winston if added). Levels: `error` for failures, `warn` for recoverable, `log`/`debug` for flow.
- `CorrelationIdMiddleware` in `shared/` sets `x-correlation-id` from header or generates UUID. Attach to every log.

**Testing**:
- Service unit tests: mock the repository. Test happy path + each thrown exception.
- Controller e2e tests: `@nestjs/testing` + `supertest`. Send invalid DTOs to assert validation. Test guards in isolation.

**Swagger**:
- `@ApiTags()` on every controller, `@ApiOperation({ summary })` on every method, `@ApiResponse({ status, type })` for each documented status.
- `@ApiProperty()` on every response/request DTO field. `@ApiPropertyOptional()` for optional.
- Auto-generated OpenAPI is the API contract — keep it in sync.

## 13. Layering — controllers are thin

- Controller: parse request → call service → return DTO. No business logic, no DB.
- Service: business logic + orchestration. Depends on repositories and other services via DI.
- Cross-cutting concerns belong to:
  - **Interceptors**: response transform, caching, logging.
  - **Pipes**: transformation/validation.
  - **Guards**: authn/authz.
  - **Middleware**: correlation IDs, request-level setup.

## Before completing any endpoint task

Run through [checklist.md](checklist.md) before declaring the work done.
