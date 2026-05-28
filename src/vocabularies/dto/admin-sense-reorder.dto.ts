import { ArrayMaxSize, ArrayMinSize, IsArray, IsUUID } from 'class-validator';

export class AdminSenseReorderDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(16)
  @IsUUID('4', { each: true })
  senseIds!: string[];
}
