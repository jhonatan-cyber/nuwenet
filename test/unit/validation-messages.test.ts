import { ValidationPipe } from '@nestjs/common';
import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { VALIDATION_PIPE_OPTIONS, validationMessages } from '../../apps/api/dist/common/validation.js';
import { CreateUserDto } from '../../apps/api/dist/auth/auth.dto.js';
import { CreatePlanDto, PayDto } from '../../apps/api/dist/management/dto.js';
import { NetworkDesignDto } from '../../apps/api/dist/management/network-design.dto.js';

// El pipe real de la API, con los DTO reales: lo que aquí se afirma es lo que
// recibe el panel cuando rechaza un formulario.
const pipe = new ValidationPipe(VALIDATION_PIPE_OPTIONS);

async function rejection(metatype, value) {
  try {
    await pipe.transform(value, { type: 'body', metatype });
    return null;
  } catch (error) {
    const body = error.getResponse();
    return Array.isArray(body.message) ? body.message : [body.message];
  }
}

const admin = { username: 'ana@ejemplo.com', password: 'Admin-local-2026', role: 'admin', ci: '12345678', first_name: 'Ana', last_name: 'Pérez', address: 'Av. Siempre Viva 742' };

test('Los rechazos de validación llegan en español y nombran el campo', async () => {
  assert.deepEqual(await rejection(CreateUserDto, { ...admin, username: 'ana.perez' }), ['Usuario: debe ser un correo electrónico.']);
  assert.deepEqual(await rejection(CreateUserDto, { ...admin, password: 'corta' }), ['Contraseña: debe tener al menos 8 caracteres.']);
  assert.deepEqual(await rejection(CreateUserDto, { ...admin, first_name: '   ' }), ['Nombre: no puede estar vacío.']);
  assert.deepEqual(await rejection(CreateUserDto, { ...admin, last_name: 'x'.repeat(81) }), ['Apellido: no debe superar los 80 caracteres.']);
  assert.deepEqual(await rejection(CreateUserDto, { ...admin, ...{ intruso: 1 } }), ['intruso: no es un campo permitido.']);
  // Varios fallos del mismo envío salen juntos, cada uno con su campo.
  assert.deepEqual(await rejection(CreateUserDto, { ...admin, username: 'ana', ci: '' }), ['Usuario: debe ser un correo electrónico.', 'CI: no puede estar vacío.']);
  // Las reglas numéricas conservan su argumento y las de lista, sus valores.
  assert.deepEqual(await rejection(CreatePlanDto, { name: 'Plan', down: 50, up: 10, price: 100.005 }), ['Precio: debe ser un número con hasta 2 decimales.']);
  assert.deepEqual(await rejection(CreatePlanDto, { name: 'Plan', down: 50, up: 10, price: -1 }), ['Precio: no puede ser menor que 0.']);
  assert.deepEqual(await rejection(CreatePlanDto, { name: '', down: 0, up: 10, price: 100 }), ['Nombre: no puede estar vacío.', 'Bajada: no puede ser menor que 1.']);
  assert.deepEqual(await rejection(PayDto, { id: '0199c3d2-6a1f-7000-8000-000000000001', method: 'transfer' }), ['Método de pago: debe ser uno de: cash, other.']);
  // Equipo con IP y plan con identificador: formatos con nombre propio.
  assert.deepEqual(await rejection(CreatePlanDto, { name: 'Plan', down: 50, up: 10, price: 100, building_id: '7' }), ['Edificio: debe ser un identificador válido.']);
});

test('Los datos anidados dicen en qué elemento fallaron', async () => {
  assert.deepEqual(await rejection(NetworkDesignDto, { nodes: [{ id: 'n1', name: 'Central', role: 'inexistente' }], links: [], services: [] }), ['Rol (nodes.0.role): debe ser uno de: provider, central, switch, access.']);
  assert.deepEqual(await rejection(NetworkDesignDto, { nodes: [], links: [], services: [{ customer_id: '7', vlan: 5000 }] }), ['Departamento (services.0.customer_id): debe ser un identificador válido.', 'VLAN (services.0.vlan): no puede ser mayor que 4094.']);
});

test('Una regla sin traducir se nombra en vez de inventar texto', () => {
  assert.deepEqual(validationMessages([{ property: 'foo', constraints: { isRara: 'foo must be rare' }, target: { constructor: class {} } }]), ['foo: no cumple la regla «isRara».']);
});
