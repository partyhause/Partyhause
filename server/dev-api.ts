import dotenv from 'dotenv';
dotenv.config();

// Enable dev bypass auth for local development
process.env.AUTH_BYPASS = process.env.AUTH_BYPASS || 'true';

// Development defaults for required secrets
process.env.INVITATION_TOKEN_SECRET = process.env.INVITATION_TOKEN_SECRET || 'dev-invitation-token-secret-32-chars-minimum-length';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'dev-jwt-secret-32-characters-minimum-length-abcdef';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://localhost:5432/partyhause_dev';

// Start the production Express server. Every route goes through Prisma.
import('./index');
