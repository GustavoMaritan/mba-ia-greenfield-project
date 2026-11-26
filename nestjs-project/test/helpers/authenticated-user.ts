import { randomBytes } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UsersService } from '../../src/users/users.service';

export interface AuthenticatedUser {
  userId: string;
  channelId: string;
  accessToken: string;
}

// cria usuário com canal pelos serviços da aplicação e emite o access token
// do mesmo jeito que o login (payload { sub, email })
export async function createAuthenticatedUser(
  app: INestApplication,
): Promise<AuthenticatedUser> {
  const email = `videos_${randomBytes(4).toString('hex')}@example.com`;
  const user = await app
    .get(UsersService)
    .createUserWithChannel(email, 'not-used-in-video-tests');

  const accessToken = await app
    .get(JwtService)
    .signAsync({ sub: user.id, email });

  return { userId: user.id, channelId: user.channel.id, accessToken };
}
