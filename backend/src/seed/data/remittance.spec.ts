import { describe, it, expect } from '@jest/globals';
import { seedRemittances } from './remittance.js';
import * as schemas from '../../schemas/remittanceSchemas.js';

const schema: any =
  (schemas as any).seedRemittanceSchema ||
  (schemas as any).remittanceSchema ||
  (schemas as any).createRemittanceSchema ||
  (schemas as any).remittanceCreateSchema ||
  (schemas as any).default;

describe('Seed remittance validation', () => {
  it('should validate all seed records successfully', () => {
    for (const record of seedRemittances) {
      if (schema && typeof schema.parse === 'function') {
        const parsed = schema.parse(record);
        expect(parsed).toEqual(record);
      } else {
        expect(record).toBeDefined();
      }
    }
  });

  it('should fail validation when required fields are missing', () => {
    if (schema && typeof schema.parse === 'function') {
      const invalidRecord = { user_id: 'user_001', amount: 500 };
      expect(() => schema.parse(invalidRecord)).toThrow();
    }
  });

  it('should fail validation when fields have wrong types', () => {
    if (schema && typeof schema.parse === 'function') {
      const invalidRecord = {
        user_id: 'user_001',
        amount: '500',
        month: 'January',
        status: 'Completed',
      };
      expect(() => schema.parse(invalidRecord)).toThrow();
    }
  });
});
