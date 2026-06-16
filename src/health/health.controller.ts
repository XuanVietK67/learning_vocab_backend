import { Controller, Get, VERSION_NEUTRAL } from '@nestjs/common';

/**
 * Liveness probe for the platform healthcheck (Railway). Version-neutral, so it
 * answers at `/health` rather than `/v1/health` — URI versioning otherwise
 * prefixes every route with the version.
 */
@Controller({ path: 'health', version: VERSION_NEUTRAL })
export class HealthController {
  @Get()
  check(): { status: string } {
    return { status: 'ok' };
  }
}
