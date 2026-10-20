import { applyDecorators } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { Matches } from 'class-validator';

/** Décimal exact reçu en texte (ou en nombre JSON, converti en texte) : jamais de flottant côté calcul. */
export function Dec(maxDecimals = 4) {
  return applyDecorators(
    Transform(({ value }) => (typeof value === 'number' ? String(value) : value)),
    Matches(new RegExp(`^\\d{1,14}(\\.\\d{1,${maxDecimals}})?$`), {
      message: `doit être un nombre décimal positif (max ${maxDecimals} décimales)`,
    }),
  );
}

export const isUniqueViolation = (e: any) => e?.code === '23505';
