import { IsIn, IsUUID } from 'class-validator';

export class AccessDto {
  @IsUUID('7') id!: string;
  @IsIn(['active', 'suspended']) status!: 'active' | 'suspended';
}
