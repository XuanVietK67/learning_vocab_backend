import { IsOptional, IsString, Length, Matches } from 'class-validator';

// Attaches the result of the (out-of-band) HyperFrames render to a scenario.
// Phase 1 does NOT run the render — an admin supplies the finished MP4 URL here
// once it exists, optionally updating the script that produced it. This is the
// "attach the video URL when the render completes" step from the plan (§4).
export class AttachIntroVideoDto {
  @IsString()
  @Length(1, 512)
  @Matches(/^https?:\/\//, {
    message: 'introVideoUrl must be an http(s) URL',
  })
  introVideoUrl!: string;

  @IsOptional()
  @IsString()
  @Length(1, 5000)
  introVideoScript?: string;
}
