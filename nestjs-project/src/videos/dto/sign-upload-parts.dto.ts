import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsInt,
  Max,
  Min,
} from 'class-validator';
import {
  MAX_PART_NUMBER,
  MAX_PARTS_PER_SIGN_REQUEST,
} from '../videos.constants';

export class SignUploadPartsDto {
  /** Part numbers to sign (1-based, up to 100 per request). */
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_PARTS_PER_SIGN_REQUEST)
  @ArrayUnique()
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(MAX_PART_NUMBER, { each: true })
  part_numbers: number[];
}
