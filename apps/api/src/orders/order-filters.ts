import { BadRequestException } from '@nestjs/common';
export type OrderFilters={query:string;status:string;from?:string;to?:string};
const validDate=(value:string)=>/^\d{4}-\d{2}-\d{2}$/.test(value)&&new Date(`${value}T00:00:00Z`).toISOString().slice(0,10)===value;
export function parseOrderFilters(query:string|undefined,status:string|undefined,from:string|undefined,to:string|undefined,allowed:readonly string[]):OrderFilters{
  const normalized=query?.trim()??'', selected=status??'all';
  if(normalized.length>100||!['all',...allowed].includes(selected)||(from!==undefined&&!validDate(from))||(to!==undefined&&!validDate(to))||(from&&to&&from>to)) throw new BadRequestException('Invalid order filters');
  return {query:normalized,status:selected,...(from?{from}:{}),...(to?{to}:{})};
}
