import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { RouterCredentials } from './router.types';

@Injectable()
export class CredentialVault {
  private key?: Buffer;
  private getKey(): Buffer {
    if (this.key) return this.key;
    const encoded = process.env.ROUTER_ENCRYPTION_KEY;
    const key = Buffer.from(encoded || '', 'base64');
    if (key.length !== 32) throw new ServiceUnavailableException('Configura ROUTER_ENCRYPTION_KEY con una clave de 32 bytes en base64.');
    this.key = key;
    return key;
  }

  seal(credentials: RouterCredentials): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.getKey(), iv);
    const encrypted = Buffer.concat([cipher.update(JSON.stringify(credentials), 'utf8'), cipher.final()]);
    return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), encrypted.toString('base64')].join('.');
  }

  open(value: string): RouterCredentials {
    const key = this.getKey();
    try {
      const [version, iv, tag, encrypted] = value.split('.');
      if (version !== 'v1') throw new Error('Unsupported encryption version');
      const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
      decipher.setAuthTag(Buffer.from(tag, 'base64'));
      return JSON.parse(Buffer.concat([decipher.update(Buffer.from(encrypted, 'base64')), decipher.final()]).toString('utf8'));
    } catch {
      throw new ServiceUnavailableException('No se pueden abrir las credenciales. Restaura la clave de cifrado o actualiza las credenciales.');
    }
  }
}
