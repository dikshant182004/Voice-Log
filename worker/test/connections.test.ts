import { describe, expect, it } from 'vitest';
import { ConnectionSchema } from '../src/connections/types';

describe('connection contracts', () => {
  it('allows managed D1 connections without an external URL', () => {
    expect(ConnectionSchema.parse({
      id: 'managed',
      name: 'Managed D1',
      type: 'd1',
    })).toMatchObject({
      id: 'managed',
      type: 'd1',
      enabled: true,
      config: {},
    });
  });

  it('accepts customer-owned HTTP and vector connections', () => {
    expect(ConnectionSchema.parse({
      id: 'policy-api',
      name: 'Policy API',
      type: 'http_json',
      base_url: 'https://customer.example.com',
      secret_ref: 'POLICY_API',
    })).toMatchObject({
      type: 'http_json',
      base_url: 'https://customer.example.com',
    });

    expect(ConnectionSchema.parse({
      id: 'vector',
      name: 'Vector Gateway',
      type: 'vector_rest',
      base_url: 'https://search.example.com',
    })).toMatchObject({
      type: 'vector_rest',
    });
  });

  it('rejects malformed external URLs', () => {
    expect(() => ConnectionSchema.parse({
      id: 'bad',
      name: 'Bad',
      type: 'http_json',
      base_url: 'not-a-url',
    })).toThrow();
  });
});
