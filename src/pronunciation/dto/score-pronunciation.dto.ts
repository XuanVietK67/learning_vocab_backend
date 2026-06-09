import {
  IsOptional,
  IsString,
  IsUUID,
  Length,
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
} from 'class-validator';

/**
 * Class-level rule: exactly one of the listed properties must be present
 * (non-empty). Attached to an always-defined anchor so it runs even when both
 * target fields are absent (an `@IsOptional` field would short-circuit it).
 */
function ExactlyOneOf(props: string[], options?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'exactlyOneOf',
      target: object.constructor,
      propertyName,
      constraints: [props],
      options,
      validator: {
        validate(_value: unknown, args: ValidationArguments): boolean {
          const obj = args.object as Record<string, unknown>;
          const present = props.filter((p) => {
            const v = obj[p];
            return v !== undefined && v !== null && v !== '';
          });
          return present.length === 1;
        },
        defaultMessage(): string {
          return `provide exactly one of: ${props.join(', ')}`;
        },
      },
    });
  };
}

/**
 * Body for POST /v1/pronunciation/score (multipart; the audio file is handled
 * by the FileInterceptor, not this DTO). Either score a catalog vocabulary by
 * id, or a free-text word — exactly one.
 */
export class ScorePronunciationDto {
  @IsOptional()
  @IsUUID()
  vocabularyId?: string;

  @IsOptional()
  @IsString()
  @Length(1, 128)
  word?: string;

  // Always-defined validation anchor for the cross-field rule above.
  @ExactlyOneOf(['vocabularyId', 'word'])
  readonly target = true as const;
}
