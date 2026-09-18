import { BadRequestException, HttpException, Injectable, UnauthorizedException } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { uuidv7 } from '../common/uuid';
import { DatabaseService } from '../database/database.service';
import { ChangePasswordDto, CreateUserDto, LoginDto, SetupDto, UpdateUserDto } from './auth.dto';

export interface SessionUser { id: string; username: string; role: string }
export const SESSION_COOKIE = 'nuwenet_session';

@Injectable()
export class AuthService {
  private readonly ttlHours: number;

  constructor(private readonly database: DatabaseService) {
    const parsed = Number(process.env.SESSION_TTL_HOURS || 72);
    this.ttlHours = Number.isFinite(parsed) && parsed > 0 ? parsed : 72;
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  parseCookies(header: string | undefined): Record<string, string> {
    const out: Record<string, string> = {};
    for (const part of (header || '').split(';')) {
      const index = part.indexOf('=');
      if (index < 0) continue;
      try { out[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim()); } catch { /* Ignore malformed cookies. */ }
    }
    return out;
  }

  sessionCookie(token: string, secure = false): string {
    return `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=Strict; Max-Age=${this.ttlHours * 3600}${secure || process.env.COOKIE_SECURE === 'true' ? '; Secure' : ''}`;
  }

  clearCookie(): string {
    return `${SESSION_COOKIE}=; HttpOnly; Path=/; SameSite=Strict; Max-Age=0`;
  }

  async userCount(): Promise<number> {
    const rows = await this.database.read(tx => tx<{ count: number }[]>`SELECT COUNT(*) count FROM users`);
    return Number(rows[0]?.count || 0);
  }

  async setup(dto: SetupDto): Promise<SessionUser> {
    // El primer usuario del sistema es el super-admin único y global.
    // Requiere SETUP_TOKEN si está definido (acceso remoto). Solo puede existir uno.
    const passwordHash = await Bun.password.hash(dto.password);
    const rows = await this.database.write(async tx => {
      const [count] = await tx`SELECT COUNT(*) count FROM users`;
      if (Number(count.count)) throw new BadRequestException('Ya existe un administrador. Inicia sesión.');
      const [superCount] = await tx`SELECT COUNT(*) count FROM users WHERE role='superadmin'`;
      if (Number(superCount.count)) throw new BadRequestException('Ya existe un super-admin.');
      return tx<{ id: string }[]>`INSERT INTO users(id,username,password_hash,role,created_at) VALUES (${uuidv7()},${dto.username.trim()}, ${passwordHash}, 'superadmin', ${new Date().toISOString()}) RETURNING id`;
    });
    const newId = rows[0].id;
    // El super-admin no se vincula a ningún edificio: ve todo por rol.
    return { id: newId, username: dto.username.trim(), role: 'superadmin' };
  }

  async login(dto: LoginDto): Promise<{ user: SessionUser; token: string }> {
    const [row] = await this.database.read(tx => tx<{ id: string; username: string; password_hash: string; role: string }[]>`SELECT * FROM users WHERE username=${dto.username.trim()}`);
    if (!row || (row as typeof row & { disabled: number }).disabled || !(await Bun.password.verify(dto.password, row.password_hash))) {
      throw new UnauthorizedException('Usuario o contraseña incorrectos.');
    }
    const token = randomBytes(32).toString('hex');
    const now = new Date();
    const expires = new Date(now.getTime() + this.ttlHours * 3600 * 1000).toISOString();
    await this.database.write(tx => tx`INSERT INTO sessions(id,token_hash,user_id,created_at,expires_at) VALUES (${uuidv7()},${this.hashToken(token)}, ${row.id}, ${now.toISOString()}, ${expires})`);
    return { user: { id: row.id, username: row.username, role: row.role }, token };
  }

  async validate(token: string | undefined): Promise<SessionUser | null> {
    if (!token) return null;
    const [row] = await this.database.read(tx => tx<{ user_id: string; expires_at: string; username: string; role: string }[]>`SELECT s.user_id, s.expires_at, u.username, u.role FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=${this.hashToken(token)} AND u.disabled=0`);
    if (!row) return null;
    if (row.expires_at < new Date().toISOString()) {
      await this.database.write(tx => tx`DELETE FROM sessions WHERE token_hash=${this.hashToken(token as string)}`);
      return null;
    }
    return { id: row.user_id, username: row.username, role: row.role };
  }

  async logout(token: string | undefined): Promise<void> {
    if (!token) return;
    await this.database.write(tx => tx`DELETE FROM sessions WHERE token_hash=${this.hashToken(token)}`);
  }

  async throttle(ip: string) {
    const now = new Date().toISOString();
    const reset = new Date(Date.now() + 10 * 60000).toISOString();
    const allowed = await this.database.write(async tx => {
      await tx`DELETE FROM login_attempts WHERE resets_at < ${now}`;
      const [row] = await tx`SELECT attempts FROM login_attempts WHERE key=${ip}`;
      if (Number(row?.attempts || 0) >= 30) return false;
      await tx`INSERT INTO login_attempts(id,key,attempts,resets_at) VALUES (${uuidv7()},${ip},1,${reset}) ON CONFLICT(key) DO UPDATE SET attempts=login_attempts.attempts+1`;
      return true;
    });
    if (!allowed) throw new HttpException('Demasiados intentos. Espera 10 minutos.', 429);
  }

  users() { return this.database.read(async tx => {
    const users = await tx`SELECT id,username,role,disabled,created_at,ci,first_name,last_name,address,phone FROM users ORDER BY id`;
    const assignments = await tx`SELECT user_id,building_id FROM user_buildings ORDER BY user_id,building_id`;
    const byUser = new Map<string, string[]>();
    for (const a of assignments as unknown as { user_id: string; building_id: string }[]) {
      if (!byUser.has(a.user_id)) byUser.set(a.user_id, []);
      byUser.get(a.user_id)!.push(a.building_id);
    }
    return (users as unknown as { id: string }[]).map(u => ({ ...u, building_ids: byUser.get(u.id) || [] }));
  }); }

  async createUser(dto: CreateUserDto) {
    const hash = await Bun.password.hash(dto.password);
    await this.database.write(async tx => {
      const rows = await tx`SELECT id FROM users WHERE username=${dto.username}`;
      if (rows.length) throw new BadRequestException('El usuario ya existe.');
      if (dto.role === 'superadmin') {
        const [count] = await tx`SELECT COUNT(*) count FROM users WHERE role='superadmin'`;
        if (Number(count.count)) throw new BadRequestException('Ya existe un super-admin. Solo puede haber uno.');
      }
      await tx`INSERT INTO users(id,username,password_hash,role,ci,first_name,last_name,address,phone,created_at) VALUES (${uuidv7()},${dto.username},${hash},${dto.role},${dto.role === 'admin' ? dto.ci.trim() : ''},${dto.role === 'admin' ? dto.first_name.trim() : ''},${dto.role === 'admin' ? dto.last_name.trim() : ''},${dto.role === 'admin' ? dto.address.trim() : ''},${dto.role === 'admin' && dto.phone ? dto.phone.trim() : ''},${new Date().toISOString()})`;
    });
    return this.users();
  }

  async updateUser(id: string, dto: UpdateUserDto) {
    await this.database.write(async tx => {
      const [user] = await tx`SELECT * FROM users WHERE id=${id}`;
      if (!user) throw new BadRequestException('Usuario no encontrado.');
      if (dto.role === 'superadmin' && user.role !== 'superadmin') {
        const [count] = await tx`SELECT COUNT(*) count FROM users WHERE role='superadmin'`;
        if (Number(count.count)) throw new BadRequestException('Ya existe un super-admin. Solo puede haber uno.');
      }
      if (user.role === 'superadmin' && !user.disabled && (dto.role !== 'superadmin' || dto.disabled)) {
        const [count] = await tx`SELECT COUNT(*) count FROM users WHERE role='superadmin' AND disabled=0`;
        if (Number(count.count) <= 1) throw new BadRequestException('Debe quedar al menos un super-admin (administrador global) habilitado.');
      }
      // Los administradores sí pueden deshabilitarse aunque sea el último: el
      // super-admin conserva el control total y puede reactivarlos.
      if (dto.username !== undefined && dto.username !== user.username) {
        const [taken] = await tx`SELECT id FROM users WHERE username=${dto.username} AND id<>${id}`;
        if (taken) throw new BadRequestException('Ese correo ya está en uso por otro usuario.');
      }
      await tx`UPDATE users SET role=${dto.role},disabled=${dto.disabled ? 1 : 0},
        username=${dto.username ?? user.username},
        ci=${dto.ci?.trim() ?? user.ci},
        first_name=${dto.first_name?.trim() ?? user.first_name},
        last_name=${dto.last_name?.trim() ?? user.last_name},
        address=${dto.address?.trim() ?? user.address},
        phone=${dto.phone !== undefined ? dto.phone.trim() : user.phone}
        WHERE id=${id}`;
      if (dto.role === 'superadmin') await tx`DELETE FROM user_buildings WHERE user_id=${id}`;
      await tx`DELETE FROM sessions WHERE user_id=${id}`;
    });
    return this.users();
  }

  async deleteUser(id: string, actorId?: string) {
    await this.database.write(async tx => {
      const [user] = await tx`SELECT * FROM users WHERE id=${id}`;
      if (!user) throw new BadRequestException('Usuario no encontrado.');
      if (actorId && actorId === id) throw new BadRequestException('No puedes eliminar tu propia cuenta.');
      if (user.role === 'superadmin') {
        const [count] = await tx`SELECT COUNT(*) count FROM users WHERE role='superadmin' AND disabled=0`;
        if (Number(count.count) <= 1) throw new BadRequestException('Debe quedar al menos un super-admin (administrador global) habilitado.');
      }
      await tx`DELETE FROM sessions WHERE user_id=${id}`;
      await tx`DELETE FROM users WHERE id=${id}`;
    });
    return this.users();
  }

  async changePassword(id: string, dto: ChangePasswordDto) {
    const [user] = await this.database.read(tx => tx`SELECT password_hash FROM users WHERE id=${id}`);
    if (!user || !await Bun.password.verify(dto.current_password, user.password_hash)) throw new UnauthorizedException('Contraseña actual incorrecta.');
    const hash = await Bun.password.hash(dto.password);
    await this.database.write(async tx => {
      const updated = await tx`UPDATE users SET password_hash=${hash} WHERE id=${id} AND password_hash=${user.password_hash} RETURNING id`;
      if (!updated.length) throw new BadRequestException('La contraseña cambió. Vuelve a iniciar sesión.');
      await tx`DELETE FROM sessions WHERE user_id=${id}`;
    });
    return { ok: true };
  }
}
