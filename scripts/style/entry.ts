// נקודת כניסה לקומפילציה עם esbuild: מריצה את אותה תבנית שהאפליקציה משתמשת בה
import { toHouseStyledHtml, type PsakMeta } from '@/lib/psakDinHtmlTemplate';

export type Meta = PsakMeta;

export function buildStyledHtml(rawText: string, meta: Meta = {}): string {
  return toHouseStyledHtml(rawText, meta);
}
