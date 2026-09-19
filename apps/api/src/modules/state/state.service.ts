import { ForbiddenException, Injectable } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { ScopeService } from '../shared/scope.service';
import { SettingsService } from '../settings/settings.service';
import { readSnapshot } from './snapshot';
import { isSystem, requestContext } from '../../common/request-context';
import { StateQuery } from './state.dto';

/** Estado agregado del panel. Solo lectura + filtrado por edificio. */
@Injectable()
export class StateService {
  constructor(
    private readonly database: DatabaseService,
    private readonly scope: ScopeService,
    private readonly settings: SettingsService,
  ) {}

  async snapshot(query: StateQuery = {}) {
    return this.database.read(async (tx) => {
      const actor = requestContext.getStore();
      const allowed = await this.scope.actorBuildings(tx);
      let bid: string | null = query.building_id || null;
      if (bid) await this.scope.requireBuilding(tx, bid);
      else if (actor && !isSystem(actor) && actor?.role !== 'superadmin') {
        if (!allowed.length) throw new ForbiddenException('No tienes edificios asignados.');
        bid = allowed[0];
      }
      const snap = await readSnapshot(tx, await this.settings.settings(tx), { ...query, building_id: bid || undefined }, this.database.driver);
      const buildings =
        !actor || isSystem(actor) || actor.role === 'superadmin'
          ? await tx`SELECT * FROM buildings ORDER BY id`
          : await tx`SELECT b.* FROM buildings b JOIN user_buildings ub ON ub.building_id=b.id WHERE ub.user_id=${actor.id} ORDER BY b.id`;
      // B5: el estado nunca expone el enlace completo; solo metadatos y un
      // indicador de existencia. El token solo se entrega una vez al emitirlo.
      const customers = (snap.customers as unknown as Record<string, unknown>[]).map((c) => {
        const { access_token, access_token_hash, ...safe } = c;
        void access_token;
        void access_token_hash;
        return { ...safe, has_portal_link: true };
      });
      return { ...snap, customers, buildings, active_building_id: bid || null };
    });
  }
}
