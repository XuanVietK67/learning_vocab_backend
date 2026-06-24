import { PartialType } from '@nestjs/mapped-types';
import { CreateScenarioDto } from '@/speaking-room/dto/create-scenario.dto';

// Every field is optional on edit. Editing a published scenario bumps its
// `version` (see ScenariosService) so Phase 2 in-flight sessions keep the spec
// they started with.
export class UpdateScenarioDto extends PartialType(CreateScenarioDto) {}
