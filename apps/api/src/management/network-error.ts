import { HttpException } from '@nestjs/common';
export function networkError(error:unknown):string {
  const status=error instanceof HttpException?error.getStatus():0;
  if(error instanceof HttpException && /rechazó las credenciales|permisos de consulta/.test(error.message))return 'Autenticación o permisos rechazados. Revisa la cuenta del router.';
  if(status===401||status===403)return 'Autenticación o permisos rechazados. Revisa la cuenta del router.';
  if(status===400||status===409||status===422)return error instanceof HttpException?error.message:'Configuración de red inválida.';
  const code=(error as {code?:string})?.code;
  if(code==='ETIMEDOUT'||(error as Error)?.name==='TimeoutError')return 'El router excedió el tiempo de respuesta.';
  if(['ECONNREFUSED','EHOSTUNREACH','ENETUNREACH','ENOTFOUND'].includes(code||''))return 'Router inaccesible. Revisa la conexión LAN/VPN y el puerto.';
  if(status===502||status===503||status===504)return 'No se pudo consultar el router. Revisa disponibilidad y permisos de su API.';
  return 'No se pudo completar la sincronización. Revisa la conexión y los permisos del router.';
}
