import { DomainException } from '../common/exceptions/domain.exception';

export class VideoNotFoundException extends DomainException {
  constructor() {
    super('VIDEO_NOT_FOUND', 404, 'Video not found');
  }
}

export class VideoNotUploadableException extends DomainException {
  constructor() {
    super('VIDEO_NOT_UPLOADABLE', 409, 'Video is not accepting uploads');
  }
}

export class InvalidPartNumberException extends DomainException {
  constructor() {
    super(
      'INVALID_PART_NUMBER',
      400,
      'Part number exceeds the video part count',
    );
  }
}

export class UploadIncompleteException extends DomainException {
  constructor() {
    super('UPLOAD_INCOMPLETE', 409, 'Upload is incomplete');
  }
}
