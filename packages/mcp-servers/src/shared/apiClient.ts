import { z } from 'zod';

const API_BASE = process.env.PARTYHOUSE_API_URL || 'http://localhost:8001/api';
const STATIC_JWT_TOKEN = process.env.PARTYHOUSE_JWT_TOKEN || '';

export async function api(path: string, init?: RequestInit & { jwt?: string }) {
  const jwt = init?.jwt || STATIC_JWT_TOKEN;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init?.headers as any || {})
  };
  if (jwt) headers['Authorization'] = `Bearer ${jwt}`;
  const res = await fetch(`${API_BASE}${path.startsWith('/') ? path : '/' + path}`, { ...init, headers });
  return res;
}
